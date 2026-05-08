'use strict';

/**
 * SylLab-Forensics Scoring Engine — Final Formula v6
 *
 * Formula:
 *   base  = 0.22×C1 + 0.30×C2 + 0.22×C3 + 0.14×C4 + 0.06×C5 + 0.06×C6
 *   boost = 0.40 × (|{C∈{C2,C3,C4}: C>0.30}| / 3)   ← convergence multiplier
 *   score = clamp01(base × (1+boost) × consecutive_mult)
 *
 * Thresholds: WATCH≥0.27  REVIEW≥0.50  ESCALATE≥0.65  HIGH RISK≥0.80
 *
 * FIX 1: C6 weight raised (0.03→0.06), amplified when below expected curve
 * FIX 2: C2 uses student-specific std dev (sz() function)
 * FIX 3: Consecutive multiplier ×1.50/×1.18
 * FIX 4: C4 normalized by course maxViolations (not hardcoded /8)
 */

const env = require('../config/env');

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp01(v) { return Math.min(Math.max(v, 0), 1); }

/**
 * Student-specific structural z-score (FIX 2)
 * std=0: any change is maximally suspicious (no historical variance)
 * std>0: normalize by 3×std (3-sigma normalization)
 */
function sz(cur, base, std, scale) {
  const diff = Math.abs(cur - base);
  if (diff === 0) return 0;
  if (std < 0.05) return clamp01(diff / scale);
  return clamp01(diff / (std * 3));
}

// ── Sophistication score from raw AST features ─────────────────────────────

/**
 * Computes 0-100 sophistication score from extracted AST features.
 * Used for both baseline and submission scoring.
 */
function computeSophisticationScore(features) {
  const {
    errorHandlingTier = 0,   // 0-3
    architectureTier  = 0,   // 0-3
    typeSafetyScore   = 0,   // 0-3
    controlFlowPref   = 0,   // 0-2
    hasDecorators     = false,
    hasAsync          = false,
    hasContextManagers = false,
    hasMetaclasses    = false,
    hasDependencyInjection = false,
    hasAbstractClasses = false,
    hasDataclasses    = false,
    namingVerbosity   = 5,   // avg chars
    commentDensity    = 0,   // comments per 10 lines
    cyclomaticAvg     = 1,
    maxNestingDepth   = 1,
  } = features;

  let score = 0;
  score += (errorHandlingTier  / 3) * 18;
  score += (architectureTier   / 3) * 20;
  score += (typeSafetyScore    / 3) * 10;
  score += (controlFlowPref    / 2) * 8;
  score += Math.min(commentDensity / 20, 1) * 6;
  score += Math.min(namingVerbosity / 20, 1) * 4;
  score += hasDecorators         ? 5 : 0;
  score += hasAsync               ? 5 : 0;
  score += hasContextManagers     ? 4 : 0;
  score += hasAbstractClasses     ? 5 : 0;
  score += hasDependencyInjection ? 5 : 0;
  score += hasMetaclasses         ? 4 : 0;
  score += hasDataclasses         ? 3 : 0;
  score += Math.min(cyclomaticAvg / 10, 1) * 3;

  return Math.round(Math.min(score, 100));
}

// ── Main ensemble scoring function ────────────────────────────────────────

/**
 * @param {Object} p - scoring parameters
 * @param {number} p.hist - number of authenticated submissions
 * @param {number} p.week - current week number (1-15)
 *
 * C1 Lexical:
 * @param {number} p.cd_cur   - comment density current
 * @param {number} p.cd_base  - comment density baseline mean
 * @param {number} p.cd_std   - comment density historical std dev
 * @param {number} p.nv_cur   - naming verbosity current
 * @param {number} p.nv_base  - naming verbosity baseline mean
 * @param {number} p.nv_std   - naming verbosity historical std dev
 * @param {number} p.imp      - import style shift (0,1,2)
 *
 * C2 Structural:
 * @param {number} p.eh_cur   - error handling tier current
 * @param {number} p.eh_base  - error handling tier baseline
 * @param {number} p.eh_std   - error handling historical std dev
 * @param {number} p.arch_cur - architecture tier current
 * @param {number} p.arch_base - architecture tier baseline
 * @param {number} p.arch_std - architecture historical std dev
 * @param {number} p.cf_cur   - control flow pref current
 * @param {number} p.cf_base  - control flow pref baseline
 * @param {number} p.cf_std   - control flow historical std dev
 *
 * C3 Trajectory:
 * @param {number} p.soph_base - baseline sophistication (Week 1, locked)
 * @param {number} p.soph_cur  - current sophistication
 *
 * C4 Genealogy:
 * @param {number} p.gv        - genealogy violations count
 * @param {number} p.max_gv    - course max violations (FIX 4)
 *
 * C5 Cohort:
 * @param {number} p.cohort_mean - cohort mean this week
 * @param {number} p.cohort_std  - cohort std dev this week
 *
 * C6 Regression (FIX 1):
 * @param {number} p.soph_prev - previous week sophistication
 *
 * Consecutive (FIX 3):
 * @param {number} p.prev_ensemble_score - previous submission score (0 if first)
 */
function computeEnsemble(p) {
  if (p.hist < 3) {
    return {
      score: null,
      flagLevel: 'INSUFFICIENT_BASELINE',
      components: null,
      message: `Insufficient baseline: ${p.hist}/3 authenticated submissions required`,
    };
  }

  // ── C1: Lexical fingerprint ──────────────────────────────────
  const z_cd = (p.cd_cur - p.cd_base) / Math.max(p.cd_std, 1);
  const z_nv = (p.nv_cur - p.nv_base) / Math.max(p.nv_std, 1);
  const C1 = clamp01(
    clamp01(Math.abs(z_cd) / 3) * 0.50 +
    clamp01(Math.abs(z_nv) / 3) * 0.35 +
    ((p.imp || 0) / 2) * 0.15
  );

  // ── C2: Structural fingerprint (FIX 2 — student std dev) ─────
  const eh_z   = sz(p.eh_cur,   p.eh_base,   p.eh_std   || 0.3, 3);
  const arch_z = sz(p.arch_cur, p.arch_base, p.arch_std || 0.3, 3);
  const cf_z   = sz(p.cf_cur   || 0, p.cf_base  || 0, p.cf_std  || 0.2, 2);
  const C2 = clamp01(eh_z * 0.40 + arch_z * 0.40 + cf_z * 0.20);

  // ── C3: Trajectory jump ───────────────────────────────────────
  const expected = p.soph_base * Math.pow(1.15, p.week - 1);
  const jumpRatio = p.soph_cur / Math.max(expected, 1);
  const C3 = clamp01((jumpRatio - 1) / 2);

  // ── C4: Genealogy depth (FIX 4 — course-relative) ────────────
  const maxGv = p.max_gv || 8;
  const C4 = clamp01(p.gv / Math.max(maxGv, 1));

  // ── C5: Cohort outlier ────────────────────────────────────────
  const z_coh = (p.soph_cur - p.cohort_mean) / Math.max(p.cohort_std, 1);
  const C5 = clamp01(Math.max(z_coh, 0) / 3);

  // ── C6: Regression × corroboration (FIX 1) ───────────────────
  const reg = p.soph_cur / Math.max(p.soph_prev || p.soph_cur, 1);
  const belowCurve = Math.max(0, (expected - p.soph_cur) / Math.max(expected, 1));
  const C6 = (reg < 0.7 ? clamp01((0.7 - reg) / 0.7) : 0) *
             (0.4 + 0.6 * clamp01(belowCurve * 3));

  // ── Convergence boost ─────────────────────────────────────────
  const nCorroborating = [C2, C3, C4].filter(s => s > 0.30).length;
  const boost = 0.40 * (nCorroborating / 3);

  // ── Base score ────────────────────────────────────────────────
  const base = 0.22*C1 + 0.30*C2 + 0.22*C3 + 0.14*C4 + 0.06*C5 + 0.06*C6;
  const afterBoost = base * (1 + boost);

  // ── Consecutive multiplier (FIX 3) ───────────────────────────
  const prevScore = p.prev_ensemble_score || 0;
  const consecutiveMult = prevScore >= 0.50 ? 1.50 : prevScore >= 0.27 ? 1.18 : 1.0;

  const score = clamp01(afterBoost * consecutiveMult);

  // ── Flag level ────────────────────────────────────────────────
  const T = {
    watch:    env.THRESHOLD_WATCH    || 0.27,
    review:   env.THRESHOLD_REVIEW   || 0.50,
    escalate: env.THRESHOLD_ESCALATE || 0.65,
    highRisk: env.THRESHOLD_HIGH_RISK || 0.80,
  };
  let flagLevel;
  if (score >= T.highRisk)  flagLevel = 'INTERVIEW';    // maps to FlagLevel enum
  else if (score >= T.escalate) flagLevel = 'REVIEW';
  else if (score >= T.review)   flagLevel = 'MONITOR';
  else if (score >= T.watch)    flagLevel = 'MONITOR';
  else                          flagLevel = 'NORMAL';

  // Instructor queue trigger
  const needsQueue = score >= T.review;
  const needsGemini = score >= T.escalate;

  return {
    score,
    flagLevel,
    needsQueue,
    needsGemini,
    components: { C1, C2, C3, C4, C5, C6 },
    breakdown: {
      base,
      boost,
      n_corroborating: nCorroborating,
      convergence_multiplier: 1 + boost,
      consecutive_multiplier: consecutiveMult,
      expected_soph: Math.round(expected),
      jump_ratio: Math.round(jumpRatio * 100) / 100,
      z_comment_density: Math.round(z_cd * 100) / 100,
      z_naming_verbosity: Math.round(z_nv * 100) / 100,
    },
  };
}

/**
 * Maps ensemble score to FlagLevel enum value for DB storage
 */
function scoreToFlagLevel(score) {
  const T = {
    watch:    env.THRESHOLD_WATCH    || 0.27,
    review:   env.THRESHOLD_REVIEW   || 0.50,
    escalate: env.THRESHOLD_ESCALATE || 0.65,
    highRisk: env.THRESHOLD_HIGH_RISK || 0.80,
  };
  if (score >= T.highRisk)  return 'INTERVIEW';
  if (score >= T.escalate)  return 'REVIEW';
  if (score >= T.watch)     return 'MONITOR';
  return 'NORMAL';
}

module.exports = { computeEnsemble, computeSophisticationScore, scoreToFlagLevel };
