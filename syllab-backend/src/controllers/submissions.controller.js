'use strict';

const { getClient } = require('../config/database');
const { extractFeatures } = require('../services/astExtractor.service');
const { computeSophisticationScore, computeEnsemble, scoreToFlagLevel } = require('../services/scoring.service');
const { checkGenealogyViolations } = require('../services/genealogy.service');
const { parseCursor, encodeCursor } = require('../utils/pagination');
const { enqueueEmail } = require('../config/queue');

// ── POST /submissions/analyze ──────────────────────────────────────────────

async function analyze(req, res, next) {
  try {
    const prisma = getClient();
    const { course_id, week_number, language, code } = req.body;
    const studentId = req.user.id;

    // 1. Fetch locked baseline (INSUFFICIENT_BASELINE gate)
    const baseline = await prisma.baselineSession.findUnique({
      where: { studentId_courseId: { studentId, courseId: course_id } },
      include: { features: true },
    });
    if (!baseline || !baseline.lockedAt) {
      return res.status(404).json({
        error: 'BASELINE_NOT_FOUND',
        message: `No locked baseline found for student in course ${course_id}`,
        status: 404,
      });
    }

    // 2. Count previous submissions (for confidence gate)
    const histCount = await prisma.submission.count({
      where: { studentId, courseId: course_id },
    });

    // 3. Extract features from current code
    const currentFeatures = extractFeatures(code, language);
    const currentScore = computeSophisticationScore(currentFeatures);

    // 4. Get previous submission score (for consecutive multiplier — FIX 3)
    const prevSubmission = await prisma.submission.findFirst({
      where: { studentId, courseId: course_id },
      orderBy: { submittedAt: 'desc' },
      select: { ensembleScore: true, features: { select: { totalScore: true } } },
    });
    const prevSophScore = prevSubmission?.features?.totalScore ?? baseline.features.totalScore;
    const prevEnsembleScore = prevSubmission?.ensembleScore ?? 0;

    // 5. Get cohort stats for this week
    const course = await prisma.course.findUnique({
      where: { id: course_id },
      include: {
        cohort: {
          include: {
            stats: { where: { weekNumber: week_number } },
          },
        },
      },
    });
    const cohortStat = course?.cohort?.stats?.[0];
    const cohortMean = cohortStat?.meanScore ?? currentScore; // fallback to self
    const cohortStd  = cohortStat?.stdDev ?? 10;

    // 6. Get historical std devs for C2 (FIX 2 — student-specific)
    const allSubmissions = await prisma.submissionFeatures.findMany({
      where: { submission: { studentId, courseId: course_id } },
      select: { errorHandlingTier: true, architectureTier: true, controlFlowPref: true,
                commentDensity: true, namingVerbosity: true },
    });

    function std(arr) {
      if (arr.length < 2) return 0.3; // default
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return Math.sqrt(arr.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / arr.length);
    }

    const eh_std   = std(allSubmissions.map(s => s.errorHandlingTier));
    const arch_std = std(allSubmissions.map(s => s.architectureTier));
    const cf_std   = std(allSubmissions.map(s => s.controlFlowPref));
    const cd_std   = std(allSubmissions.map(s => s.commentDensity));
    const nv_std   = std(allSubmissions.map(s => s.namingVerbosity));

    const baselineF = baseline.features;

    // 7. Build historical techniques from all past submissions' detected techniques
    const historicalTechniques = allSubmissions.length > 0
      ? (await prisma.submissionFeatures.findMany({
          where: { submission: { studentId, courseId: course_id } },
          select: { detectedTechniques: true },
        })).flatMap(f => f.detectedTechniques)
      : [];

    const genealogyViolations = await checkGenealogyViolations(
      currentFeatures.detectedTechniques || [],
      historicalTechniques
    );

    // 8. Build scoring params and compute ensemble (Final Formula v6)
    const scoringParams = {
      hist: histCount,
      week: week_number,

      // C1 Lexical
      cd_cur:  currentFeatures.commentDensity,
      cd_base: baselineF.commentDensity,
      cd_std,
      nv_cur:  currentFeatures.namingVerbosity,
      nv_base: baselineF.namingVerbosity,
      nv_std,
      imp:     currentFeatures.importStyleShift || 0,

      // C2 Structural (FIX 2)
      eh_cur:   currentFeatures.errorHandlingTier,
      eh_base:  baselineF.errorHandlingTier,
      eh_std,
      arch_cur: currentFeatures.architectureTier,
      arch_base: baselineF.architectureTier,
      arch_std,
      cf_cur:   currentFeatures.controlFlowPref,
      cf_base:  baselineF.controlFlowPref,
      cf_std,

      // C3 Trajectory
      soph_base: baselineF.totalScore,
      soph_cur:  currentScore,

      // C4 Genealogy (FIX 4)
      gv: genealogyViolations.length,
      max_gv: course?.maxViolations ?? 8,

      // C5 Cohort
      cohort_mean: cohortMean,
      cohort_std:  cohortStd,

      // C6 Regression (FIX 1)
      soph_prev: prevSophScore,

      // FIX 3 Consecutive
      prev_ensemble_score: prevEnsembleScore,
    };

    const result = computeEnsemble(scoringParams);

    // 9. Persist submission in transaction (always — histCount must grow)
    const isInsufficient = result.flagLevel === 'INSUFFICIENT_BASELINE';
    const flagLevel = isInsufficient ? 'NORMAL' : scoreToFlagLevel(result.score);
    const expectedScore = baselineF.totalScore * Math.pow(1.15, week_number - 1);
    const z_cd = cd_std > 0 ? (currentFeatures.commentDensity - baselineF.commentDensity) / cd_std : 0;
    const z_nv = nv_std > 0 ? (currentFeatures.namingVerbosity - baselineF.namingVerbosity) / nv_std : 0;
    const z_coh = cohortStd > 0 ? (currentScore - cohortMean) / cohortStd : 0;
    const pct = Math.round(50 * (1 + Math.tanh(z_coh * 0.7)));

    const submission = await prisma.$transaction(async (tx) => {
      const sub = await tx.submission.create({
        data: {
          studentId,
          courseId: course_id,
          weekNumber: week_number,
          language,
          ensembleScore: isInsufficient ? null : result.score,
          flagLevel,
        },
      });

      await tx.submissionFeatures.create({
        data: {
          submissionId: sub.id,
          totalScore: currentScore,
          errorHandlingTier:   currentFeatures.errorHandlingTier,
          architectureTier:    currentFeatures.architectureTier,
          typeSafetyScore:     currentFeatures.typeSafetyScore,
          controlFlowPref:     currentFeatures.controlFlowPref,
          hasDecorators:       currentFeatures.hasDecorators,
          hasAsync:            currentFeatures.hasAsync,
          hasContextManagers:  currentFeatures.hasContextManagers,
          hasMetaclasses:      currentFeatures.hasMetaclasses,
          hasDependencyInjection: currentFeatures.hasDependencyInjection,
          hasAbstractClasses:  currentFeatures.hasAbstractClasses,
          hasDataclasses:      currentFeatures.hasDataclasses,
          namingVerbosity:     currentFeatures.namingVerbosity,
          commentDensity:      currentFeatures.commentDensity,
          cyclomaticAvg:       currentFeatures.cyclomaticAvg,
          maxNestingDepth:     currentFeatures.maxNestingDepth,
          expectedScore:       Math.round(expectedScore),
          jumpRatio:           isInsufficient ? 1.0 : result.breakdown.jump_ratio,
          trajectoryZ:         isInsufficient ? 0 : z_coh,
          cohortPercentile:    isInsufficient ? 50 : pct,
          weeksCompressed:     isInsufficient ? 0 : result.breakdown.jump_ratio,
          regressionRatio:     prevSophScore > 0 ? currentScore / prevSophScore : 1,
          zCommentDensity:     z_cd,
          zNamingVerbosity:    z_nv,
          detectedTechniques:  currentFeatures.detectedTechniques || [],
        },
      });

      // Store genealogy violations
      if (genealogyViolations.length > 0) {
        await tx.genealogyViolation.createMany({
          data: genealogyViolations.map(v => ({
            submissionId: sub.id,
            technique: v.technique,
            missingPrerequisite: v.missingPrerequisite,
            severityWeight: v.severityWeight,
          })),
        });
      }

      // Auto-queue if REVIEW+
      if (result.needsQueue) {
        await tx.instructorQueue.create({
          data: {
            submissionId: sub.id,
            priorityScore: result.score,
            status: 'PENDING',
          },
        });
      }

      return sub;
    });

    if (isInsufficient) {
      return res.status(200).json({
        data: {
          flag_level: 'NORMAL',
          ensemble_score: 0,
          message: result.message,
          sophistication: { total_score: currentScore },
        },
      });
    }

    // 10. Update cohort stats asynchronously (fire and forget)
    updateCohortStats(course_id, week_number, course?.cohortId).catch(() => {});

    // 11. Notify instructor if submission is flagged REVIEW or INTERVIEW
    if (result.needsQueue && course?.instructorId) {
      notifyInstructorFlagged({
        submissionId: submission.id,
        instructorId: course.instructorId,
        studentName: req.user.email,
        courseId: course_id,
        flagLevel,
        ensembleScore: result.score,
      }).catch(() => {});
    }

    return res.status(200).json({
      data: {
        submission_id: submission.id,
        flag_level: flagLevel,
        ensemble_score: result.score,
        score_breakdown: {
          ...result.components,
          base: result.breakdown.base,
          boost: result.breakdown.boost,
          n_corroborating: result.breakdown.n_corroborating,
          convergence_multiplier: result.breakdown.convergence_multiplier,
          consecutive_multiplier: result.breakdown.consecutive_multiplier,
        },
        sophistication: {
          total_score: currentScore,
          error_handling_tier: currentFeatures.errorHandlingTier,
          architecture_tier: currentFeatures.architectureTier,
          type_safety_score: currentFeatures.typeSafetyScore,
          has_decorators: currentFeatures.hasDecorators,
          has_async: currentFeatures.hasAsync,
          has_context_managers: currentFeatures.hasContextManagers,
          has_metaclasses: currentFeatures.hasMetaclasses,
        },
        genealogy_violations: genealogyViolations.map(v => ({
          technique: v.technique,
          missing_prerequisite: v.missingPrerequisite,
          severity: v.severityWeight,
        })),
        cohort_position: {
          week_number,
          percentile: pct,
          cohort_mean: cohortMean,
          cohort_std: cohortStd,
        },
        baseline_score: baselineF.totalScore,
        expected_score: Math.round(expectedScore),
        jump_ratio: result.breakdown.jump_ratio,
        needs_interview: result.needsGemini,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /submissions/:id ───────────────────────────────────────────────────

async function getSubmission(req, res, next) {
  try {
    const prisma = getClient();
    const { submission_id } = req.params;

    const sub = await prisma.submission.findUnique({
      where: { id: submission_id },
      include: {
        features: true,
        violations: true,
        queueItem: true,
        student: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!sub) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Submission not found', status: 404 });
    }

    // RBAC: students can only see their own
    if (req.user.role === 'STUDENT' && sub.studentId !== req.user.id) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied', status: 403 });
    }

    return res.status(200).json({ data: sub });
  } catch (err) {
    next(err);
  }
}

// ── GET /submissions ───────────────────────────────────────────────────────

async function listSubmissions(req, res, next) {
  try {
    const prisma = getClient();
    const { student_id, course_id, week_number, flag_level, sort = '-created_at', cursor, limit = '20' } = req.query;
    const take = Math.min(parseInt(limit), 50);
    const cursorWhere = parseCursor(cursor);

    // Students can only list their own
    const effectiveStudentId = req.user.role === 'STUDENT' ? req.user.id : student_id;

    const where = {
      ...(effectiveStudentId && { studentId: effectiveStudentId }),
      ...(course_id && { courseId: course_id }),
      ...(week_number && { weekNumber: parseInt(week_number) }),
      ...(flag_level && { flagLevel: flag_level }),
    };

    const orderBy = sort === 'ensemble_score' ? { ensembleScore: 'asc' }
      : sort === '-ensemble_score' ? { ensembleScore: 'desc' }
      : sort === 'created_at' ? { submittedAt: 'asc' }
      : { submittedAt: 'desc' };

    const submissions = await prisma.submission.findMany({
      where,
      ...cursorWhere,
      take: take + 1,
      orderBy,
      include: { features: { select: { totalScore: true, jumpRatio: true, cohortPercentile: true } } },
    });

    const hasMore = submissions.length > take;
    const data = hasMore ? submissions.slice(0, take) : submissions;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1].id) : null;

    return res.status(200).json({
      data: data.map(s => ({
        id: s.id,
        student_id: s.studentId,
        course_id: s.courseId,
        week_number: s.weekNumber,
        language: s.language,
        ensemble_score: s.ensembleScore,
        flag_level: s.flagLevel,
        submitted_at: s.submittedAt,
        sophistication_score: s.features?.totalScore,
        jump_ratio: s.features?.jumpRatio,
        cohort_percentile: s.features?.cohortPercentile,
      })),
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    });
  } catch (err) {
    next(err);
  }
}

// ── Cohort stats updater (background) ─────────────────────────────────────

async function updateCohortStats(courseId, weekNumber, cohortId) {
  if (!cohortId) return;
  const prisma = getClient();

  const features = await prisma.submissionFeatures.findMany({
    where: { submission: { courseId, weekNumber } },
    select: { totalScore: true },
  });

  if (features.length === 0) return;

  const scores = features.map(f => f.totalScore).sort((a, b) => a - b);
  const n = scores.length;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(scores.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / n);
  const p10 = scores[Math.floor(n * 0.1)];
  const p50 = scores[Math.floor(n * 0.5)];
  const p90 = scores[Math.floor(n * 0.9)];

  await prisma.cohortStats.upsert({
    where: { cohortId_weekNumber: { cohortId, weekNumber } },
    update: { meanScore: mean, stdDev, p10, p50, p90, p90Threshold: p90, submissionCount: n },
    create: { cohortId, weekNumber, meanScore: mean, stdDev, p10, p50, p90, p90Threshold: p90, submissionCount: n },
  });
}

async function notifyInstructorFlagged({ submissionId, instructorId, studentName, courseId, flagLevel, ensembleScore }) {
  const prisma = getClient();
  const instructor = await prisma.user.findUnique({
    where: { id: instructorId },
    select: { email: true, fullName: true },
  });
  if (!instructor) return;

  await enqueueEmail('submission-flagged', {
    to: instructor.email,
    instructorName: instructor.fullName,
    studentName,
    courseId,
    submissionId,
    flagLevel,
    ensembleScore,
  });
}

module.exports = { analyze, getSubmission, listSubmissions };
