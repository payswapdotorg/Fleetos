/**
 * @fleetos/web — W152 Fix 1 (R2 residual): the SEARCH-DECISION OVERLAY.
 *
 * The R2 residual (sim-c-report.md §4.9.3): after an approve execution,
 * the global search (Ctrl+K) for `pln_fb564c1e` STILL returns the seeded
 * title `Parked plan — w091-demo-enable-encryption`. The approvals queue
 * card / Security Doctor / Evidence & Audit index all overlay the
 * executed-decision state (the W149 propagation); the search index does
 * NOT. The minimal actionable cause (verbatim from the report): "the
 * search index should overlay the executed-decision state on the record
 * label (or the label should carry a `(decided: APPROVED)` suffix
 * in-session)."
 *
 * This module is the PURE overlay: a function
 * `(records, executed) => records` that maps records whose `area ===
 * "actions"` and whose `recordId` is in `executed.recordsByPlan` to an
 * overlaid title `Decided plan (APPROVED|REJECTED) — <name>` (the name
 * derived from the existing title's suffix after `"Parked plan — "`),
 * with the keywords extended by `"decided"` + the lowercase status.
 *
 * Records NOT decided pass through with their original object identity
 * preserved where possible (the overlay NEVER mangles an unrecognized
 * title — if the title does not match the `Parked plan — ` shape, the
 * suffix ` (decided: APPROVED)` is appended instead).
 *
 * PURE + DETERMINISTIC: no clock, no I/O, no `any` in public
 * signatures. Strict TS. The overlay reads the executed-decision
 * state's own derivation (the W149 `deriveExecutedDecisionState`'s
 * `recordsByPlan`); nothing is fabricated.
 */

import type { ShellRecordSummary } from "../../shell/src/seams";
import type { ExecutedDecisionState } from "./executed-decision-state";

// ---------------------------------------------------------------------------
// The parked-plan title shape (the seeded search-index record's title)
// ---------------------------------------------------------------------------

/**
 * The seeded parked-plan record's title prefix (the demo fleet's
 * `Parked plan — <name>` shape — `apps/web/src/runtime/demo-fleet.ts`
 * L587). The overlay derives the plan's name from the suffix after
 * this prefix; if the title does NOT match this shape, the overlay
 * appends a ` (decided: APPROVED)` suffix instead (never mangles an
 * unrecognized title).
 */
const PARKED_PLAN_TITLE_PREFIX = "Parked plan — ";

/**
 * Test whether a title carries the seeded parked-plan shape. PURE.
 */
function isParkedPlanTitle(title: string): boolean {
  return title.startsWith(PARKED_PLAN_TITLE_PREFIX) &&
    title.length > PARKED_PLAN_TITLE_PREFIX.length;
}

/**
 * Derive the plan's name from a parked-plan title (the suffix after
 * `Parked plan — `). Returns `null` when the title does not match
 * the parked-plan shape (the overlay's "append suffix" fallback).
 * PURE.
 */
function parkedPlanName(title: string): string | null {
  if (!isParkedPlanTitle(title)) return null;
  return title.slice(PARKED_PLAN_TITLE_PREFIX.length);
}

// ---------------------------------------------------------------------------
// The overlay (the search-index record's executed-decision projection)
// ---------------------------------------------------------------------------

/**
 * The overlay's per-record transformation. PURE: returns a NEW
 * `ShellRecordSummary` whose title + keywords reflect the executed
 * decision's status. The record's `area` + `recordId` are preserved
 * (the search index's structural identity is unchanged — only the
 * label surface is overlaid).
 *
 * The transformation rules (the report's sanctioned overlay):
 *
 *   - If the title carries the `Parked plan — <name>` shape, the
 *     overlaid title is `Decided plan (APPROVED|REJECTED) — <name>`
 *     (the plan's name preserved verbatim; the prefix replaced to
 *     reflect the executed decision).
 *   - Otherwise (an unrecognized title shape — never mangled), the
 *     overlaid title is `<original> (decided: APPROVED|REJECTED)`
 *     (the suffix carries the executed status; the original title
 *     preserved verbatim).
 *   - The keywords are EXTENDED by `decided` + the lowercase status
 *     (so the search for `decided` or `approved`/`rejected` surfaces
 *     the overlaid record). The original keywords are preserved.
 *
 * @param record the search-index record to overlay
 * @param status the executed decision's status (APPROVED or REJECTED)
 * @returns a NEW `ShellRecordSummary` with the overlaid title + keywords
 */
function overlayDecidedRecord(
  record: ShellRecordSummary,
  status: "APPROVED" | "REJECTED",
): ShellRecordSummary {
  const lowerStatus = status.toLowerCase();
  const name = parkedPlanName(record.title);
  const title = name !== null
    ? `Decided plan (${status}) — ${name}`
    : `${record.title} (decided: ${status})`;
  // The keywords are EXTENDED (the original tokens preserved; the
  // `decided` + lowercase status appended iff not already present).
  const extendedKeywords: string[] = [];
  const seen = new Set<string>();
  for (const keyword of record.keywords) {
    if (!seen.has(keyword)) {
      seen.add(keyword);
      extendedKeywords.push(keyword);
    }
  }
  for (const additional of ["decided", lowerStatus] as const) {
    if (!seen.has(additional)) {
      seen.add(additional);
      extendedKeywords.push(additional);
    }
  }
  return {
    area: record.area,
    recordId: record.recordId,
    title,
    keywords: Object.freeze(extendedKeywords) as readonly string[],
  };
}

// ---------------------------------------------------------------------------
// The public overlay (the search-index record array's projection)
// ---------------------------------------------------------------------------

/**
 * W152 Fix 1 — overlay the executed-decision state on the search-index
 * records' labels. PURE + DETERMINISTIC: same inputs always produce
 * the same output; no clock, no I/O, no `any` in the public signature.
 *
 * The overlay maps records whose `area === "actions"` AND whose
 * `recordId` is in `executed.recordsByPlan` to an overlaid title
 * `Decided plan (APPROVED|REJECTED) — <name>` (or the suffix fallback
 * for unrecognized title shapes) + extended keywords. Records NOT
 * decided pass through with their ORIGINAL object identity preserved
 * (the overlay never copies a record it does not transform — the
 * downstream consumer's referential equality holds for untouched
 * records).
 *
 * Honesty: the overlay NEVER fabricates a decision. A record is
 * overlaid IFF `executed.recordsByPlan[record.recordId]` carries a
 * real `ExecutedDecisionRecord` (the W149 derivation's own per-plan
 * record — the boundary's own status + approver + transitioned-at
 * instant). The empty executed-decision state (no decisions) yields
 * the input array unchanged (every record passes through).
 *
 * @param records the search-index records to overlay
 * @param executed the executed-decision state (the W149 derivation)
 * @returns a NEW array with the overlaid records (untouched records
 *   preserve their original object identity)
 */
export function overlaySearchRecordsWithExecutedDecisions(
  records: readonly ShellRecordSummary[],
  executed: ExecutedDecisionState,
): readonly ShellRecordSummary[] {
  // The empty executed-decision state: no overlay (the input array
  // passes through unchanged — referential equality preserved).
  if (executed.decidedPlanIds.length === 0) {
    return records;
  }
  const recordsByPlan = executed.recordsByPlan;
  // The overlay maps ONLY records whose `area === "actions"` AND
  // whose `recordId` is in `recordsByPlan`. Records NOT matching
  // both predicates pass through with their original identity.
  let touched = false;
  const overlaid: ShellRecordSummary[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === undefined) continue;
    if (record.area !== "actions") {
      overlaid.push(record);
      continue;
    }
    const decision = recordsByPlan[record.recordId];
    if (decision === undefined) {
      overlaid.push(record);
      continue;
    }
    overlaid.push(overlayDecidedRecord(record, decision.status));
    touched = true;
  }
  // If no record was overlaid (the executed plan ids did not match
  // any search-index record), return the input array unchanged — the
  // referential-equality guarantee holds for the no-op case.
  return touched ? Object.freeze(overlaid) as readonly ShellRecordSummary[] : records;
}
