'use strict';

const { getClient } = require('../config/database');
const { extractFeatures } = require('../services/astExtractor.service');
const { computeSophisticationScore } = require('../services/scoring.service');
const { encrypt, hashContent } = require('../services/encryption.service');
const { parseCursor, encodeCursor } = require('../utils/pagination');

// ── Proctored Session CRUD ─────────────────────────────────────────────────

async function createSession(req, res, next) {
  try {
    const prisma = getClient();
    const { course_id, scheduled_at, duration_minutes, room_label } = req.body;

    // Verify instructor owns the course
    const course = await prisma.course.findFirst({
      where: { id: course_id, instructorId: req.user.id },
    });
    if (!course && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not own this course',
        status: 403,
      });
    }

    const session = await prisma.proctoredSession.create({
      data: {
        courseId: course_id,
        scheduledAt: new Date(scheduled_at),
        durationMinutes: duration_minutes,
        roomLabel: room_label,
      },
    });

    return res.status(201).json({
      data: {
        id: session.id,
        course_id: session.courseId,
        status: session.status,
        scheduled_at: session.scheduledAt,
        duration_minutes: session.durationMinutes,
        room_label: session.roomLabel,
        created_at: session.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function listSessions(req, res, next) {
  try {
    const prisma = getClient();
    const { course_id, cursor, limit = '20' } = req.query;
    const take = Math.min(parseInt(limit), 50);
    const cursorWhere = parseCursor(cursor);

    const where = { ...(course_id && { courseId: course_id }) };
    const sessions = await prisma.proctoredSession.findMany({
      where,
      ...cursorWhere,
      take: take + 1,
      orderBy: { scheduledAt: 'desc' },
    });

    const hasMore = sessions.length > take;
    const data = hasMore ? sessions.slice(0, take) : sessions;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1].id) : null;

    return res.status(200).json({
      data: data.map(s => ({
        id: s.id,
        course_id: s.courseId,
        status: s.status,
        scheduled_at: s.scheduledAt,
        duration_minutes: s.durationMinutes,
        room_label: s.roomLabel,
        opened_at: s.openedAt,
        closed_at: s.closedAt,
        network_isolation_confirmed: s.networkIsolationConfirmed,
      })),
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    });
  } catch (err) {
    next(err);
  }
}

async function openSession(req, res, next) {
  try {
    const prisma = getClient();
    const { session_id } = req.params;
    const { network_isolation_confirmed } = req.body;

    const session = await prisma.proctoredSession.findUnique({
      where: { id: session_id },
      include: { course: true },
    });
    if (!session) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found', status: 404 });
    }
    if (session.course.instructorId !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'PROCTOR') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Not authorized for this session', status: 403 });
    }
    if (session.status !== 'SCHEDULED') {
      return res.status(409).json({ error: 'INVALID_STATE', message: `Session is already ${session.status}`, status: 409 });
    }

    const updated = await prisma.proctoredSession.update({
      where: { id: session_id },
      data: {
        status: 'OPEN',
        openedAt: new Date(),
        networkIsolationConfirmed: network_isolation_confirmed ?? false,
      },
    });

    return res.status(200).json({
      data: { id: updated.id, status: updated.status, opened_at: updated.openedAt },
    });
  } catch (err) {
    next(err);
  }
}

async function closeSession(req, res, next) {
  try {
    const prisma = getClient();
    const { session_id } = req.params;

    const session = await prisma.proctoredSession.findUnique({
      where: { id: session_id },
      include: { course: true },
    });
    if (!session) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found', status: 404 });
    }
    if (session.status !== 'OPEN') {
      return res.status(409).json({ error: 'INVALID_STATE', message: 'Session is not open', status: 409 });
    }

    const updated = await prisma.proctoredSession.update({
      where: { id: session_id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    return res.status(200).json({
      data: { id: updated.id, status: updated.status, closed_at: updated.closedAt },
    });
  } catch (err) {
    next(err);
  }
}

// ── Baseline Submission ────────────────────────────────────────────────────

async function submitBaseline(req, res, next) {
  try {
    const prisma = getClient();
    const { session_id } = req.params;
    const { code, language } = req.body;
    const studentId = req.user.id;

    // Session must be OPEN
    const session = await prisma.proctoredSession.findUnique({
      where: { id: session_id },
    });
    if (!session) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found', status: 404 });
    }
    if (session.status !== 'OPEN') {
      return res.status(409).json({
        error: 'SESSION_NOT_OPEN',
        message: 'This session is not accepting baseline submissions',
        status: 409,
      });
    }

    // One baseline per student per course
    const existing = await prisma.baselineSession.findUnique({
      where: { studentId_courseId: { studentId, courseId: session.courseId } },
    });
    if (existing) {
      return res.status(409).json({
        error: 'BASELINE_ALREADY_EXISTS',
        message: 'Student already has a locked baseline for this course',
        status: 409,
      });
    }

    // Extract features and compute sophistication
    const features = extractFeatures(code, language);
    const sophScore = computeSophisticationScore(features);

    // Encrypt code + hash for tamper detection
    const codeEncrypted = encrypt(code);
    const contentHash = hashContent(code);

    // Create baseline in transaction — lock immediately
    const baseline = await prisma.$transaction(async (tx) => {
      const b = await tx.baselineSession.create({
        data: {
          studentId,
          sessionId: session_id,
          courseId: session.courseId,
          codeEncrypted,
          contentHash,
          language,
          lockedAt: new Date(), // Lock immediately on creation
        },
      });

      await tx.baselineFeatures.create({
        data: {
          baselineId: b.id,
          totalScore: sophScore,
          errorHandlingTier:   features.errorHandlingTier,
          architectureTier:    features.architectureTier,
          typeSafetyScore:     features.typeSafetyScore,
          controlFlowPref:     features.controlFlowPref,
          hasDecorators:       features.hasDecorators,
          hasAsync:            features.hasAsync,
          hasContextManagers:  features.hasContextManagers,
          hasMetaclasses:      features.hasMetaclasses,
          hasDependencyInjection: features.hasDependencyInjection,
          hasAbstractClasses:  features.hasAbstractClasses,
          hasDataclasses:      features.hasDataclasses,
          namingVerbosity:     features.namingVerbosity,
          commentDensity:      features.commentDensity,
          cyclomaticAvg:       features.cyclomaticAvg,
          maxNestingDepth:     features.maxNestingDepth,
        },
      });

      return b;
    });

    return res.status(201).json({
      data: {
        id: baseline.id,
        student_id: baseline.studentId,
        session_id: baseline.sessionId,
        content_hash: baseline.contentHash,
        locked_at: baseline.lockedAt,
        sophistication_summary: {
          total_score: sophScore,
          error_handling_tier: features.errorHandlingTier,
          architecture_tier: features.architectureTier,
          type_safety_score: features.typeSafetyScore,
          has_decorators: features.hasDecorators,
          has_async: features.hasAsync,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Attendance Report ──────────────────────────────────────────────────────

async function getAttendance(req, res, next) {
  try {
    const prisma = getClient();
    const { session_id } = req.params;
    const { cursor, limit = '20' } = req.query;
    const take = Math.min(parseInt(limit), 50);
    const cursorWhere = parseCursor(cursor);

    const session = await prisma.proctoredSession.findUnique({
      where: { id: session_id },
      include: { course: { include: { enrollments: true } } },
    });
    if (!session) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found', status: 404 });
    }

    const baselines = await prisma.baselineSession.findMany({
      where: { sessionId: session_id },
      include: { student: { select: { id: true, fullName: true, email: true } } },
      ...cursorWhere,
      take: take + 1,
      orderBy: { createdAt: 'asc' },
    });

    const hasMore = baselines.length > take;
    const data = hasMore ? baselines.slice(0, take) : baselines;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1].id) : null;

    const enrolledCount = session.course.enrollments.length;
    const submittedCount = await prisma.baselineSession.count({ where: { sessionId: session_id } });

    return res.status(200).json({
      data: {
        session_id,
        enrolled_count: enrolledCount,
        submitted_count: submittedCount,
        completion_rate: enrolledCount > 0 ? Math.round((submittedCount / enrolledCount) * 100) : 0,
        submissions: data.map(b => ({
          student_id: b.student.id,
          student_name: b.student.fullName,
          email: b.student.email,
          submitted_at: b.createdAt,
          locked: !!b.lockedAt,
        })),
      },
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSession,
  listSessions,
  openSession,
  closeSession,
  submitBaseline,
  getAttendance,
};
