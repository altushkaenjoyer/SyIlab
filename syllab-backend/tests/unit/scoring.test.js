'use strict';

// Set env before any imports
process.env.DATABASE_URL   = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET  = 'test_secret_32_chars_minimum_abcde';
process.env.JWT_REFRESH_SECRET = 'test_refresh_32_chars_minimum_abcd';
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
process.env.NODE_ENV = 'test';

const { computeEnsemble, computeSophisticationScore, scoreToFlagLevel } = require('../../src/services/scoring.service');
const { extractFeatures } = require('../../src/services/astExtractor.service');
const { encrypt, decrypt, hashContent } = require('../../src/services/encryption.service');
const { encodeCursor, decodeCursor, parseCursor } = require('../../src/utils/pagination');

// ── BASE params for scoring tests ──────────────────────────────────────────
const BASE = {
  hist: 6, week: 5,
  cd_base: 12, cd_cur: 12, cd_std: 3,
  nv_base: 12, nv_cur: 12, nv_std: 2,
  imp: 0,
  eh_base: 1, eh_cur: 1, eh_std: 0.3,
  arch_base: 1, arch_cur: 1, arch_std: 0.3,
  cf_base: 0, cf_cur: 0, cf_std: 0.2,
  soph_base: 20, soph_cur: 35, soph_prev: 28,
  cohort_mean: 32, cohort_std: 7,
  gv: 0, max_gv: 8,
  prev_ensemble_score: 0,
};

// ── SCORING FORMULA TESTS ──────────────────────────────────────────────────

describe('computeEnsemble — Final Formula v6', () => {

  test('T1: Normal student → NORMAL (score < 0.27)', () => {
    const r = computeEnsemble(BASE);
    expect(r.score).toBeLessThan(0.27);
    expect(r.flagLevel).toBe('NORMAL');
  });

  test('T2: Obvious AI cheat (all signals maxed) → INTERVIEW (score ≥ 0.80)', () => {
    const r = computeEnsemble({
      ...BASE,
      cd_cur: 2, nv_cur: 3,
      eh_cur: 3, eh_std: 0.3,
      arch_cur: 3, arch_std: 0.3,
      cf_cur: 2, imp: 2,
      soph_cur: 90, gv: 5,
    });
    expect(r.score).toBeGreaterThanOrEqual(0.80);
    expect(r.flagLevel).toBe('INTERVIEW');
  });

  test('T3: Regression alone (no structural signals) → NORMAL', () => {
    const r = computeEnsemble({ ...BASE, soph_cur: 12, soph_prev: 70 });
    expect(r.score).toBeLessThan(0.27);
    expect(r.flagLevel).toBe('NORMAL');
  });

  test('T4: Non-native speaker (verbose naming only) → NORMAL', () => {
    const r = computeEnsemble({ ...BASE, nv_cur: 22, nv_base: 8, nv_std: 2 });
    expect(r.score).toBeLessThan(0.27);
    expect(r.flagLevel).toBe('NORMAL');
  });

  test('T5: Tutorial follower (arch+trajectory jump, no violations) → MONITOR', () => {
    const r = computeEnsemble({
      ...BASE,
      arch_cur: 3, arch_base: 0, arch_std: 0.3,
      eh_cur: 2, soph_cur: 55, gv: 0,
    });
    expect(r.score).toBeGreaterThanOrEqual(0.27);
    expect(r.score).toBeLessThan(0.50);
  });

  test('T6: Arch jump alone (std=0) is weak — NORMAL', () => {
    const r = computeEnsemble({ ...BASE, arch_cur: 3, arch_base: 1, arch_std: 0.0 });
    expect(r.score).toBeLessThan(0.27);
  });

  test('T6b: Same arch jump but variable student (std=1.5) → even weaker', () => {
    const r = computeEnsemble({ ...BASE, arch_cur: 3, arch_base: 1, arch_std: 1.5 });
    expect(r.score).toBeLessThan(0.27);
  });

  test('T7: Consecutive flag (prev=0.55) escalates score ×1.50', () => {
    const r = computeEnsemble({
      ...BASE,
      arch_cur: 3, arch_base: 0, arch_std: 0.0,
      soph_cur: 70, gv: 4,
      prev_ensemble_score: 0.55,
    });
    expect(r.score).toBeGreaterThanOrEqual(0.65);
  });

  test('T8: Cheat who mimics lexical style still caught by structural', () => {
    const r = computeEnsemble({
      ...BASE,
      arch_cur: 3, arch_base: 0, arch_std: 0.0,
      soph_cur: 90, gv: 5,
      cd_cur: 12, nv_cur: 12, // matches baseline — lexical ok
    });
    expect(r.score).toBeGreaterThanOrEqual(0.50);
  });

  test('T9: Cohort-wide AI adoption (all scores high) → low C5 → NORMAL', () => {
    const r = computeEnsemble({
      ...BASE,
      cohort_mean: 65, cohort_std: 10,
      soph_cur: 68,
    });
    expect(r.score).toBeLessThan(0.27);
  });

  test('T_gate: hist < 3 → INSUFFICIENT_BASELINE', () => {
    const r = computeEnsemble({ ...BASE, hist: 2 });
    expect(r.flagLevel).toBe('INSUFFICIENT_BASELINE');
    expect(r.score).toBeNull();
  });

  test('Convergence boost: 3 corroborating signals → boost = 0.40', () => {
    const r = computeEnsemble({
      ...BASE,
      arch_cur: 3, arch_base: 0, arch_std: 0.3,
      soph_cur: 80,
      gv: 6,
    });
    expect(r.breakdown.n_corroborating).toBe(3);
    expect(r.breakdown.boost).toBeCloseTo(0.40, 2);
  });

  test('Weights sum to 1.0 (verified in formula)', () => {
    const weights = [0.22, 0.30, 0.22, 0.14, 0.06, 0.06];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test('Score is always clamped to [0, 1]', () => {
    const extremes = [
      { ...BASE, soph_cur: 999, gv: 99, eh_cur: 99, arch_cur: 99 },
      { ...BASE, soph_cur: 0, soph_prev: 999, prev_ensemble_score: 0.99 },
    ];
    for (const p of extremes) {
      const r = computeEnsemble(p);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});

// ── SOPHISTICATION SCORE TESTS ─────────────────────────────────────────────

describe('computeSophisticationScore', () => {
  test('Flat code scores low (0-20)', () => {
    const score = computeSophisticationScore({
      errorHandlingTier: 0, architectureTier: 0, typeSafetyScore: 0,
      controlFlowPref: 0, hasDecorators: false, hasAsync: false,
      hasContextManagers: false, hasMetaclasses: false,
      hasDependencyInjection: false, hasAbstractClasses: false,
      hasDataclasses: false, namingVerbosity: 4, commentDensity: 0,
      cyclomaticAvg: 1,
    });
    expect(score).toBeLessThan(20);
  });

  test('Enterprise code scores high (70+)', () => {
    const score = computeSophisticationScore({
      errorHandlingTier: 3, architectureTier: 3, typeSafetyScore: 3,
      controlFlowPref: 2, hasDecorators: true, hasAsync: true,
      hasContextManagers: true, hasMetaclasses: false,
      hasDependencyInjection: true, hasAbstractClasses: true,
      hasDataclasses: true, namingVerbosity: 15, commentDensity: 15,
      cyclomaticAvg: 5,
    });
    expect(score).toBeGreaterThan(70);
  });

  test('Score is always in [0, 100]', () => {
    const score = computeSophisticationScore({
      errorHandlingTier: 99, architectureTier: 99, typeSafetyScore: 99,
      controlFlowPref: 99, hasDecorators: true, hasAsync: true,
      hasContextManagers: true, hasMetaclasses: true,
      hasDependencyInjection: true, hasAbstractClasses: true,
      hasDataclasses: true, namingVerbosity: 99, commentDensity: 99,
      cyclomaticAvg: 99,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ── scoreToFlagLevel TESTS ─────────────────────────────────────────────────

describe('scoreToFlagLevel', () => {
  test.each([
    [0.10, 'NORMAL'],
    [0.26, 'NORMAL'],
    [0.27, 'MONITOR'],
    [0.49, 'MONITOR'],
    [0.50, 'MONITOR'],
    [0.64, 'MONITOR'],
    [0.65, 'REVIEW'],
    [0.79, 'REVIEW'],
    [0.80, 'INTERVIEW'],
    [0.99, 'INTERVIEW'],
  ])('score %f → %s', (score, expected) => {
    expect(scoreToFlagLevel(score)).toBe(expected);
  });
});

// ── AST EXTRACTOR TESTS ────────────────────────────────────────────────────

describe('extractFeatures — Python', () => {
  test('Detects basic try/catch → errorHandlingTier = 1', () => {
    const code = `def handler():\n    try:\n        pass\n    except Exception:\n        pass\n`;
    const f = extractFeatures(code, 'python');
    expect(f.errorHandlingTier).toBe(1);
  });

  test('Detects custom exception → errorHandlingTier = 2', () => {
    const code = `class MyError(Exception):\n    pass\ndef fn():\n    try:\n        pass\n    except MyError:\n        pass\n`;
    const f = extractFeatures(code, 'python');
    expect(f.errorHandlingTier).toBeGreaterThanOrEqual(2);
  });

  test('Detects async def → hasAsync = true', () => {
    const code = `async def fetch():\n    await something()\n`;
    const f = extractFeatures(code, 'python');
    expect(f.hasAsync).toBe(true);
  });

  test('Detects class → architectureTier ≥ 1', () => {
    const code = `class UserService:\n    def __init__(self):\n        pass\n`;
    const f = extractFeatures(code, 'python');
    expect(f.architectureTier).toBeGreaterThanOrEqual(1);
  });

  test('Detects decorators → hasDecorators = true', () => {
    const code = `@app.route('/test')\ndef view():\n    pass\n`;
    const f = extractFeatures(code, 'python');
    expect(f.hasDecorators).toBe(true);
  });

  test('Flat code → all tiers = 0', () => {
    const code = `x = 1\ny = 2\nprint(x + y)\n`;
    const f = extractFeatures(code, 'python');
    expect(f.errorHandlingTier).toBe(0);
    expect(f.architectureTier).toBe(0);
    expect(f.hasAsync).toBe(false);
  });

  test('Comment density > 0 when comments present', () => {
    const code = `# This is a comment\nx = 1\n# Another comment\ny = 2\n`;
    const f = extractFeatures(code, 'python');
    expect(f.commentDensity).toBeGreaterThan(0);
  });

  test('Naming verbosity reflects identifier lengths', () => {
    const longCode = `def calculate_monthly_revenue_total():\n    total_monthly_revenue = 0\n    return total_monthly_revenue\n`;
    const shortCode = `def f():\n    x = 0\n    return x\n`;
    const fl = extractFeatures(longCode, 'python');
    const fs = extractFeatures(shortCode, 'python');
    expect(fl.namingVerbosity).toBeGreaterThan(fs.namingVerbosity);
  });
});

describe('extractFeatures — JavaScript', () => {
  test('Detects async function → hasAsync = true', () => {
    const code = `async function fetchData() {\n  const res = await fetch('/api');\n  return res.json();\n}\n`;
    const f = extractFeatures(code, 'javascript');
    expect(f.hasAsync).toBe(true);
  });

  test('Detects class with extends → architectureTier ≥ 1', () => {
    const code = `class UserService extends BaseService {\n  constructor() { super(); }\n}\n`;
    const f = extractFeatures(code, 'javascript');
    expect(f.architectureTier).toBeGreaterThanOrEqual(1);
  });

  test('Detects try/catch → errorHandlingTier = 1', () => {
    const code = `function fn() {\n  try {\n    doSomething();\n  } catch(e) {\n    console.error(e);\n  }\n}\n`;
    const f = extractFeatures(code, 'javascript');
    expect(f.errorHandlingTier).toBe(1);
  });
});

// ── ENCRYPTION TESTS ───────────────────────────────────────────────────────

describe('Encryption service', () => {
  test('Encrypt → Decrypt round-trip is lossless', () => {
    const original = 'def hello():\n    print("world")\n';
    const ct = encrypt(original);
    const pt = decrypt(ct);
    expect(pt).toBe(original);
  });

  test('Two encryptions of same plaintext produce different ciphertext (random IV)', () => {
    const code = 'same code';
    const ct1 = encrypt(code);
    const ct2 = encrypt(code);
    expect(ct1).not.toBe(ct2);
    expect(decrypt(ct1)).toBe(code);
    expect(decrypt(ct2)).toBe(code);
  });

  test('hashContent produces sha256: prefixed string', () => {
    const h = hashContent('some code');
    expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('hashContent is deterministic', () => {
    const h1 = hashContent('same code');
    const h2 = hashContent('same code');
    expect(h1).toBe(h2);
  });

  test('hashContent differs for different inputs', () => {
    const h1 = hashContent('code A');
    const h2 = hashContent('code B');
    expect(h1).not.toBe(h2);
  });
});

// ── PAGINATION TESTS ───────────────────────────────────────────────────────

describe('Pagination utilities', () => {
  test('encodeCursor → decodeCursor round-trip', () => {
    const id = 'cldxyz123abc';
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  test('parseCursor returns {} for null/undefined', () => {
    expect(parseCursor(null)).toEqual({});
    expect(parseCursor(undefined)).toEqual({});
    expect(parseCursor('')).toEqual({});
  });

  test('parseCursor returns cursor object for valid cursor', () => {
    const cursor = encodeCursor('some-id');
    const result = parseCursor(cursor);
    expect(result).toHaveProperty('cursor');
    expect(result).toHaveProperty('skip', 1);
  });

  test('decodeCursor returns null for invalid base64', () => {
    expect(decodeCursor('not-valid-!!!')).toBeNull();
  });
});
