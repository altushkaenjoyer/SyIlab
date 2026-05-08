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
