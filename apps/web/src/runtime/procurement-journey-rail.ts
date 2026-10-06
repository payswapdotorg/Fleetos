/**
 * W151 — the procurement journey-rail adapter.
 *
 * The lane's declared public export `ProcurementCaseJourney` (the
 * seven-stage walk: need -> case -> vendor_context -> authorization ->
 * decision -> order -> evidence) carries per-stage state in the lane's
 * OWN vocabulary (`ProcurementCaseJourneyStageState`):
 *
 *   - "ready"              — the stage's records exist and are observed
 *   - "not_yet_observed"   — the stage has not been reached yet
 *   - "empty"              — the stage was reached but has no records
 *   - "blocked"            — the stage is blocked
 *   - "approval_required"  — the stage is waiting on an approval
 *
 * The `ProcurementScreen`'s `journey` prop takes the screen-level
 * `CommerceJourneyRailStage[]` (state vocabulary: "done" | "current" |
 * "pending" | "approval" | "blocked"). The W148/W149 binding shipped
 * `journey={null}` — the rail never rendered, so the seven-stage walk
 * was invisible even when the lane had composed it.
 *
 * This adapter is the PURE bridge: it maps the lane's journey to the
 * screen's rail vocabulary. It composes ONLY through the lane's
 * declared public exports; it never touches lane internals, never
 * fabricates state, and never throws.
 *
 * The state mapping (honest — no frozen table exists on the lane; the
 * mapping is the adapter's declared contract):
 *
 *   lane "ready"             -> rail "done"
 *   lane "not_yet_observed"  -> rail "pending"
 *   lane "empty"             -> rail "pending"
 *   lane "blocked"           -> rail "blocked"
 *   lane "approval_required" -> rail "approval"
 *
 * The "current" focus stage: the FIRST stage whose mapped state is
 * "pending" (i.e., the first not-yet-observed or honest-empty stage)
 * becomes "current" — the active stage the operator should focus on.
 * Stages carrying "blocked" or "approval" keep their own (more urgent)
 * state; the "current" marker is not applied to them. If every stage is
 * "done", no stage is marked "current" (the journey is complete).
 */

import type {
  CommerceJourneyRailStage,
  ProcurementCaseJourney,
  ProcurementCaseJourneyStage,
  ProcurementCaseJourneyStageState,
} from "@fleetos/web-commerce";

/**
 * Map one lane stage state to its rail state. PURE; total over the
 * lane's state vocabulary.
 */
function laneStateToRailState(
  state: ProcurementCaseJourneyStageState,
): CommerceJourneyRailStage["state"] {
  switch (state) {
    case "ready":
      return "done";
    case "not_yet_observed":
      return "pending";
    case "empty":
      return "pending";
    case "blocked":
      return "blocked";
    case "approval_required":
      return "approval";
  }
}

/**
 * Compose one rail stage's `summary` from the lane stage's detail rows.
 * PURE — joins "label: value" pairs with " · ". Empty rows yield "".
 */
function composeRailSummary(stage: ProcurementCaseJourneyStage): string {
  return stage.rows.map((row) => `${row.label}: ${row.value}`).join(" · ");
}

/**
 * Map the lane's `ProcurementCaseJourney` to the screen's
 * `CommerceJourneyRailStage[]`. PURE and total; never throws; never
 * fabricates state. The "current" focus stage is the first stage whose
 * mapped state is "pending"; "blocked" and "approval" stages keep
 * their own (more urgent) state.
 */
export function mapProcurementJourneyToRail(
  journey: ProcurementCaseJourney,
): readonly CommerceJourneyRailStage[] {
  const rail: CommerceJourneyRailStage[] = [];
  let currentAssigned = false;
  for (const stage of journey.stages) {
    const mapped = laneStateToRailState(stage.state);
    if (!currentAssigned && mapped === "pending") {
      rail.push({
        stageId: stage.id,
        title: stage.headline,
        state: "current",
        summary: composeRailSummary(stage),
        // The lane's stage type carries no record ref — the honest null.
        recordRef: null,
        // The lane's stage type carries no evidence refs — the honest
        // empty array.
        evidenceRefs: Object.freeze([]) as readonly string[],
      });
      currentAssigned = true;
    } else {
      rail.push({
        stageId: stage.id,
        title: stage.headline,
        state: mapped,
        summary: composeRailSummary(stage),
        recordRef: null,
        evidenceRefs: Object.freeze([]) as readonly string[],
      });
    }
  }
  return rail;
}
