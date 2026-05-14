# SCORING_RUBRIC.md — SylLab-Forensics

## Final Formula v6

```
base  = 0.22×C1 + 0.30×C2 + 0.22×C3 + 0.14×C4 + 0.06×C5 + 0.06×C6
boost = 0.40 × (|{C ∈ {C2, C3, C4} : C > 0.30}| / 3)
score = clamp01(base × (1 + boost) × consecutive_mult)
```

All z-scores are **student-specific** — computed against the student's own historical mean and std dev, not a universal norm. This implements the "prove NOT YOU" principle.

---

## Components

| Component | Weight | Description |
|-----------|--------|-------------|
| C1 — Lexical fingerprint | **0.22** | `0.50×norm(z_comment_density) + 0.35×norm(z_naming_verbosity) + 0.15×import_style_shift` |
| C2 — Structural fingerprint | **0.30** | `0.40×sz(error_handling) + 0.40×sz(architecture) + 0.20×sz(control_flow)` |
| C3 — Trajectory jump | **0.22** | `clamp01((actual/expected − 1) / 2)` where `expected = base × 1.15^(week−1)` |
| C4 — Genealogy violation depth | **0.14** | `violations / course_max_violations` |
| C5 — Cohort outlier | **0.06** | `clamp01(max(z_cohort, 0) / 3)` |
| C6 — Regression × corroboration | **0.06** | `reg_raw × (0.4 + 0.6 × below_curve_factor)` |

### sz() — Student-specific structural deviation (FIX 2)
```
sz(cur, base, std, scale):
  if std < 0.05:  return clamp01(|cur − base| / scale)   # no variance → any change is notable
  else:           return clamp01(|cur − base| / (std × 3)) # 3-sigma normalization
```

### Convergence boost
Each additional corroborating signal among {C2, C3, C4} exponentially increases confidence:

| Signals above 0.30 | Multiplier |
|--------------------|-----------|
| 0 | ×1.00 |
| 1 | ×1.13 |
| 2 | ×1.27 |
| 3 | ×1.40 |

### Consecutive multiplier (FIX 3)
Applied after base × boost:

| Previous submission score | Multiplier |
|--------------------------|-----------|
| ≥ 0.50 | ×1.50 |
| ≥ 0.27 | ×1.18 |
| < 0.27 | ×1.00 |

---

## Flag Thresholds

| Score range | Flag level | Action |
|-------------|-----------|--------|
| 0.00 – 0.26 | **NORMAL** | No action |
| 0.27 – 0.49 | **MONITOR** | Log entry, monitor next submission |
| 0.50 – 0.64 | **REVIEW** | Instructor reviews forensic report |
| 0.65 – 0.79 | **INTERVIEW** | Gemini guidance generated, oral interview suggested |
| 0.80 – 1.00 | **INTERVIEW** | Immediate instructor action |

---

## Profile Maturity Gates

| Submissions | Status | Behavior |
|-------------|--------|----------|
| 0 – 2 | **INSUFFICIENT_BASELINE** | No score emitted. Returns error. |
| 3 – 4 | Preliminary | Scoring active, conservative auto-threshold |
| 5 – 8 | Established | Full capability |
| 9+ | Mature | Enhanced trend detection |

---

## All Indicators

### C1 — Lexical Fingerprint (weight 0.22)

```
C1 = clamp01(norm(|z_cd|/3)×0.50 + norm(|z_nv|/3)×0.35 + (imp/2)×0.15)
```

All z-scores are student-specific: deviation from student's own baseline mean divided by own historical std dev.

**`commentDensity`** — float, comments per 10 lines
- Python: counts `#` lines + docstring lines (`"""..."""`, `'''...'''`)
- JS/TS: counts `//` lines + `/* */` block lines

**`namingVerbosity`** — float, average identifier length in characters
- Scans `def/class/for/=` (Python) or `const/let/var/function` (JS/TS)
- Single-letter names and language keywords are excluded

**`importStyleShift`** — ordinal 0 / 1 / 2
- Python: `0` plain import · `1` from…import · `2` wildcard `import *`
- JS/TS: `0` normal · `1` dynamic `import()` · `2` mixed require + ESM

---

### C2 — Structural Fingerprint (weight 0.30)

```
C2 = clamp01(sz(eh)×0.40 + sz(arch)×0.40 + sz(cf)×0.20)
```

Each `sz()` uses the student's own historical std dev (see sz() definition above).

**`errorHandlingTier`** — int 0–3
```
0  no try/catch at all
1  basic try/catch present
2  custom exception class defined
3  ≥2 exception hierarchy classes
```

**`architectureTier`** — int 0–3
```
0  flat functions only
1  at least one class
2  Service / Repository / Manager class name suffix
3  design pattern detected (Factory/Singleton/Observer/Strategy/Builder/Facade / @Injectable / getInstance)
```

**`controlFlowPref`** — int 0–2
```
0  imperative dominant (for/while > map/filter/reduce)
1  mixed
2  functional dominant (.map/.filter/.reduce)
```

---

### C3 — Trajectory Jump (weight 0.22)

```
expected  = baseline × 1.15^(week−1)
jumpRatio = current / expected
C3        = clamp01((jumpRatio − 1) / 2)
```

**`totalScore`** (current) — sophistication score 0–100, see breakdown below

**`totalScore`** (baseline) — locked at enrolment, never changes

**`expectedScore`** — `baseline × 1.15^(week−1)`, 15% max organic growth per week

**`jumpRatio`** — `current / expected`, stored in `submissionFeatures`

---

### C4 — Genealogy Violation Depth (weight 0.14)

```
C4 = clamp01(gv / max_gv)
```

**`gv`** — count of prerequisite violations for techniques used in the submission

**`max_gv`** — course-level ceiling (`course.maxViolations`, default 8)

**`detectedTechniques`** — string array, full set of advanced patterns found

#### Detectable techniques — Python

```
classes              ^class \w+
inheritance          class \w+(\w+)  with a parent
error_handling_basic try:
custom_exceptions    class \w+(Exception|Error)
decorators           @\w+
context_managers     with \w+  or  __enter__
abstract_base_classes  from abc import  or  @abstractmethod
custom_metaclasses   metaclass=
async_basics         async def
async_await_advanced await asyncio / async for / async with
type_hints_basic     : str|int|float|bool|Optional
type_hints_advanced  TypeVar / Generic[
dataclasses          @dataclass
service_layer        class \w+Service|Repository
functions_advanced   lambda  or  functools
dependency_injection .inject / @inject / container.
circuit_breaker      circuit_breaker / @retry / tenacity
repository_pattern   Repository class + abstract
```

#### Detectable techniques — JavaScript / TypeScript

```
classes              class \w+
inheritance          class \w+ extends
interfaces           interface \w+
error_handling_basic try {
custom_exceptions    class \w+ extends \w*Error
abstract_base_classes  abstract class
async_basics         async function / async (
async_await_advanced await Promise.all / for await
type_hints_basic     : string|number|boolean|void
type_hints_advanced  <[A-Z]\w*>  generics
service_layer        class \w+Service|Repository|Controller
custom_metaclasses   Proxy( / Symbol.
design_patterns      getInstance / private static instance
dependency_injection constructor(\w+: \w+)  typed params
```

---

### C5 — Cohort Outlier (weight 0.06)

```
z_coh = (current − cohort_mean) / cohort_std
C5    = clamp01(max(z_coh, 0) / 3)
```

Only upward outliers are flagged. Cohort stats (mean, std, p10, p50, p90) are updated asynchronously after each submission.

**`cohort_mean`** — mean sophistication score of all students in this course+week

**`cohort_std`** — std dev of sophistication scores in this course+week

**`trajectoryZ`** — cohort z-score, stored per submission

**`cohortPercentile`** — `round(50 × (1 + tanh(z_coh × 0.7)))`, stored per submission

---

### C6 — Regression × Corroboration (weight 0.06)

```
reg_raw    = current / prev                          triggers when < 0.70
belowCurve = max(0, (expected − current) / expected)
C6         = (reg_raw < 0.7 ? clamp01((0.7 − reg_raw)/0.7) : 0)
           × (0.4 + 0.6 × clamp01(belowCurve × 3))
```

C6 is zero when `reg_raw ≥ 0.70`. Without trajectory underperformance the corroboration factor caps C6 at ×0.40 of maximum.

**`regressionRatio`** — `currentScore / prevScore`, stored per submission

**`soph_prev`** — previous submission's sophistication score (or baseline if first)

**below-curve factor** — computed only, not stored: `max(0, (expected − current) / expected)`

---

### Sophistication Score (0–100)

Used as input to C3 (trajectory), C5 (cohort comparison), C6 (regression). Capped at 100.

```
architectureTier  (0–3)    × 6.67   → max 20 pts
errorHandlingTier (0–3)    × 6.00   → max 18 pts
typeSafetyScore   (0–3)    × 3.33   → max 10 pts
controlFlowPref   (0–2)    × 4.00   → max  8 pts
hasDecorators              +5 pts   binary
hasAsync                   +5 pts   binary
hasAbstractClasses         +5 pts   binary
hasDependencyInjection     +5 pts   binary
hasContextManagers         +4 pts   binary
hasMetaclasses             +4 pts   binary
commentDensity             min(d/20,1)×6  → max  6 pts
namingVerbosity            min(l/20,1)×4  → max  4 pts
hasDataclasses             +3 pts   binary
cyclomaticAvg              min(avg/10,1)×3 → max 3 pts
maxNestingDepth            stored only, not scored
```

---

### All Stored Fields — `submissionFeatures`

```
Field                  Type        Component
──────────────────────────────────────────────────────
totalScore             int 0–100   C3 / C5 / C6 input
errorHandlingTier      int 0–3     C2 sub-indicator
architectureTier       int 0–3     C2 sub-indicator
controlFlowPref        int 0–2     C2 sub-indicator
typeSafetyScore        int 0–3     sophistication
hasDecorators          bool        sophistication
hasAsync               bool        sophistication
hasContextManagers     bool        sophistication
hasMetaclasses         bool        sophistication
hasDependencyInjection bool        sophistication
hasAbstractClasses     bool        sophistication
hasDataclasses         bool        sophistication
namingVerbosity        float       C1 sub-indicator
commentDensity         float       C1 sub-indicator
cyclomaticAvg          float       sophistication
maxNestingDepth        int         stored, not scored
expectedScore          int         C3 reference
jumpRatio              float       C3 intermediate
regressionRatio        float       C6 intermediate
trajectoryZ            float       C5 intermediate
cohortPercentile       int 0–100   C5 intermediate
weeksCompressed        float       alias of jumpRatio
zCommentDensity        float       C1 intermediate
zNamingVerbosity       float       C1 intermediate
detectedTechniques     string[]    C4 input
```

---

## Weight Justification

| Component | Source |
|-----------|--------|
| C1 Lexical (0.22) | SHAP-validated: comment density + naming are top discriminators (Technical Report §3.2). Weight lower than C2 because lexical style can be mimicked. |
| C2 Structural (0.30) | Hardest to fake consistently. AST-derived features carry stable authorial fingerprints (CLAVE 0.9782 AUC). |
| C3 Trajectory (0.22) | 15%/week max organic growth from Forensics Plan §3.2. Objective mathematical signal. |
| C4 Genealogy (0.14) | Technique prerequisite graph. Course-relative normalization. Unfalsifiable logical signal. |
| C5 Cohort (0.06) | Low weight prevents false positives when entire cohort adopts AI tools (Plan §7 — cohort recalibration). |
| C6 Regression (0.06) | Raised from 0.03. Amplified only when score is also below expected trajectory curve. Alone = ambiguous. |

---

## Explicitly Excluded Metrics

| Excluded | Reason |
|----------|--------|
| **Perplexity** | Measures model surprise, not authorship. Penalises students following best practices. (Report §2.1.1) |
| **Burstiness** | Vulnerable to prompt engineering. Structurally inevitable in all code. (Report §2.1.2) |
| **Universal naming threshold** | Non-native speakers tend verbose — false positive bias. All thresholds are student-specific. (Report §2.2.3) |
| **LLM as classifier** | LLM (Gemini) role = explanation and interview question generation only. Never primary classifier. (Report §4.3.1) |

---

## Test Results (Validation Suite)

| Test | Score | Flag | Result |
|------|-------|------|--------|
| T1 Normal student | 0.009 | NORMAL | ✓ |
| T2 Obvious AI cheat | 1.000 | INTERVIEW | ✓ |
| T3 Regression alone | 0.045 | NORMAL | ✓ (ambiguous alone per §8.2.1) |
| T4 Non-native naming | 0.086 | NORMAL | ✓ (relative to own baseline) |
| T5 Tutorial follower | 0.275 | MONITOR | ✓ |
| T6 Arch jump (weak alone) | 0.089 | NORMAL | ✓ |
| T7 Consecutive 2nd anomaly | 0.756 | INTERVIEW | ✓ |
| T8 Cheat mimics lexical | 0.617 | REVIEW | ✓ (structural still catches) |
| T9 Cohort-wide AI | 0.124 | NORMAL | ✓ (recalibration works) |

**False positive rate (10,000 simulated normal students): 1.23%**
