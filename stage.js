'use strict';

/*
 * Canonical use-case pipeline stage model — SINGLE source of truth.
 *
 * Every consumer (server portfolio read guard, gate-save write guard, tests,
 * and — via the same vocabulary — the kanban/dashboard front-end) must derive
 * stage ordering and ROI eligibility from HERE. Do NOT re-implement stage
 * ranking or ROI gating anywhere else.
 *
 * Pipeline order (rank ascending):
 *   intake -> bxt -> feasibility -> advisory -> summary -> panel -> approved
 *
 * ROI (roi_p10 / roi_p50 / roi_p90) only becomes real once a use case reaches
 * the Evaluation Summary gate (stage 'summary') or beyond (Panel / approved).
 * Below that, ROI must be null everywhere — persisted AND emitted.
 */

// Canonical ordered stage keys. Index === rank.
const STAGES = ['intake', 'bxt', 'feasibility', 'advisory', 'summary', 'panel', 'approved'];

// The first stage at which ROI is meaningful (Evaluation Summary).
const ROI_MIN_STAGE = 'summary';

/**
 * Normalize a free-form stage string to a canonical key.
 * Tolerates casing, spaces, and label variants used across the app
 * ("Evaluation Summary" -> summary, "Executive Panel" -> panel, etc.).
 * Unknown / empty values normalize to 'intake' (rank 0).
 */
function stageKey(stage) {
  const s = String(stage == null ? '' : stage).trim().toLowerCase();
  if (!s) return 'intake';
  // Exact canonical match first.
  if (STAGES.includes(s)) return s;
  // Label / substring aliases.
  if (s.indexOf('panel') !== -1) return 'panel';
  if (s.indexOf('summary') !== -1 || s.indexOf('evaluation') !== -1) return 'summary';
  if (s.indexOf('advisory') !== -1) return 'advisory';
  if (s.indexOf('feasib') !== -1) return 'feasibility';
  if (s.indexOf('bxt') !== -1) return 'bxt';
  if (s.indexOf('approv') !== -1) return 'approved';
  if (s.indexOf('intake') !== -1 || s.indexOf('screen') !== -1) return 'intake';
  return 'intake';
}

/** Numeric rank of a stage (0-based). Unknown -> 0 (intake). */
function stageRank(stage) {
  const idx = STAGES.indexOf(stageKey(stage));
  return idx === -1 ? 0 : idx;
}

/**
 * True when a use case at `stage` has reached the Evaluation Summary gate (or
 * beyond) and therefore has real ROI. Used by BOTH the portfolio read guard and
 * the gate-save write guard so they can never disagree.
 */
function roiEligible(stage) {
  return stageRank(stage) >= stageRank(ROI_MIN_STAGE);
}

module.exports = { STAGES, ROI_MIN_STAGE, stageKey, stageRank, roiEligible };
