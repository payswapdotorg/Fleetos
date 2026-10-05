/**
 * @fleetos/web-device — W145: the MOBILE PRIORITY-CARD roster
 * view-model.
 *
 * The SIM-B ground truth this module fixes: the device roster's wide
 * (993px) table forces horizontal page scroll below ~480px — unusable
 * for field work on phones (390x844). When the shell composes the roster
 * narrow (the screen's `mobileRoster` signal — the viewport knowledge
 * the console runtime owns), the table is REPLACED by PRIORITY CARDS:
 * a severity-first card list over the SAME REAL runtime state the
 * table renders (the SAME `DeviceListViewModel` — same filter, same
 * query, same rows; nothing is re-fetched, nothing fabricated). The
 * card CSS is width-bounded (min-width: 0 + max-width: 100% +
 * overflow-wrap: anywhere), so no horizontal page scroll can occur at
 * 390x844; the desktop table composition is unchanged.
 *
 * The priority ladder (machine-stable, first match wins — the devices
 * that need attention FIRST surface FIRST):
 *
 *   critical      posture COMPROMISED, or an ACTIVE recovery case
 *   attention     posture AT_RISK
 *   stale         the last observation is stale
 *   never_observed  no observation ever (a declared record awaiting its
 *                 agent, or a freshly-enrolled device)
 *   indeterminate indeterminate evidence or unassessed posture
 *   healthy       posture HEALTHY on current observations
 *
 * Within a band the deterministic tiebreak is deviceId ascending (the
 * established roster discipline).
 *
 * PURE + DETERMINISTIC: no clock (the staleness bands are already
 * derived in the roster view at the injected instant), no randomness,
 * no I/O. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, DeviceLifecycleState } from "@fleetos/contracts";
import { DEVICE_RECORD_PROVENANCE_LABEL, DEVICE_RECORD_PROVENANCE_ORDER } from "./declared-import";
import type { DeviceRecordProvenance } from "./declared-import";
import { STALENESS_BAND_LABEL } from "./device-list";
import type { DeviceListViewModel, DeviceRowViewModel, StalenessBand } from "./device-list";
import type { ConsoleStatus } from "./ui/status";
import { postureConsoleStatus, stalenessConsoleStatus } from "./ui/status";

// ---------------------------------------------------------------------------
// The attention bands (the severity-first priority vocabulary)
// ---------------------------------------------------------------------------

/**
 * The machine-stable attention band of a device row — the mobile card
 * list's priority vocabulary (severity-first).
 */
export type DeviceAttentionBand =
  | "critical"
  | "attention"
  | "stale"
  | "never_observed"
  | "indeterminate"
  | "healthy";

/**
 * The canonical attention order (MOST attention first — the mobile card
 * list renders in exactly this order).
 */
export const DEVICE_ATTENTION_BAND_ORDER: readonly DeviceAttentionBand[] = Object.freeze([
  "critical",
  "attention",
  "stale",
  "never_observed",
  "indeterminate",
  "healthy",
] as const);

/** The human display label of each attention band (always rendered). */
export const DEVICE_ATTENTION_BAND_LABEL: Readonly<Record<DeviceAttentionBand, string>> =
  Object.freeze({
    critical: "Critical",
    attention: "Needs attention",
    stale: "Stale observations",
    never_observed: "Awaiting first observation",
    indeterminate: "Indeterminate",
    healthy: "Healthy",
  } as const);

/**
 * The console status vocabulary mapping (state is NEVER conveyed by
 * color alone — every card renders the band's text label alongside).
 */
export const DEVICE_ATTENTION_CONSOLE_STATUS: Readonly<Record<DeviceAttentionBand, ConsoleStatus>> =
  Object.freeze({
    critical: "blocked",
    attention: "needs_attention",
    stale: "needs_attention",
    never_observed: "informational",
    indeterminate: "unknown",
    healthy: "healthy",
  } as const);

/**
 * Derive a roster row's attention band — severity first, telemetry
 * honesty second (future-dated evidence is indeterminate, never a
 * guess). PURE: the same row always derives the same band.
 */
export function deviceAttentionBand(row: DeviceRowViewModel): DeviceAttentionBand {
  if (row.postureSummary === "COMPROMISED" || row.recoveryState === "ACTIVE") {
    return "critical";
  }
  if (row.postureSummary === "AT_RISK") {
    return "attention";
  }
  if (row.staleness === "stale") {
    return "stale";
  }
  if (row.staleness === "never_observed") {
    return "never_observed";
  }
  if (row.staleness === "unknown" || row.postureSummary === "UNKNOWN") {
    return "indeterminate";
  }
  return "healthy";
}

/** The attention band's rank (0 = most attention). PURE. */
export function deviceAttentionRank(band: DeviceAttentionBand): number {
  return DEVICE_ATTENTION_BAND_ORDER.indexOf(band);
}

// ---------------------------------------------------------------------------
// The mobile card view-model
// ---------------------------------------------------------------------------

/** One mobile priority card — the flattened, display-ready row projection. */
export interface MobileDeviceCard {
  readonly deviceId: DeviceId;
  readonly displayName: string;
  /** The severity-first priority (band + rank + label + console status). */
  readonly priority: {
    readonly band: DeviceAttentionBand;
    readonly rank: number;
    readonly label: string;
    readonly status: ConsoleStatus;
  };
  /** The record's origin marking — DECLARED/OBSERVED, never conflated. */
  readonly provenance: DeviceRecordProvenance;
  readonly provenanceLabel: string;
  /** The declaring principal, when the record is DECLARED by a user. */
  readonly declaredBy?: string;
  readonly lifecycleState: DeviceLifecycleState;
  readonly posture: {
    readonly summary: string;
    readonly status: ConsoleStatus;
  };
  readonly staleness: {
    readonly band: StalenessBand;
    readonly label: string;
    readonly status: ConsoleStatus;
  };
  readonly ownership: {
    readonly ownerType: string;
    readonly assignedTeam: string | undefined;
  };
  readonly findings: number;
  readonly workloads: number;
  readonly lastObservedAt: string | null;
  readonly recoveryState: string;
}

/** The mobile card-list view-model (over the roster's REAL runtime state). */
export interface MobileDeviceCards {
  /** The roster's injected reference instant (carried through verbatim). */
  readonly asOf: string;
  /** The number of cards (the current page's rows — same as the table). */
  readonly totalCards: number;
  /** The roster's matched total (carried through verbatim). */
  readonly totalMatches: number;
  readonly cards: readonly MobileDeviceCard[];
  /** Attention-band counts over the cards (guiding the field triage). */
  readonly byBand: readonly { readonly value: DeviceAttentionBand; readonly count: number }[];
}

/**
 * Build the mobile priority-card list from the roster view-model. PURE
 * and DETERMINISTIC: the same roster view always produces the same
 * cards in the same order (attention rank ascending, then deviceId
 * ascending). The cards carry the SAME rows the table renders — the
 * same REAL runtime state, re-projected for the small screen; the
 * provenance marking rides every card.
 */
export function buildMobileDeviceCards(view: DeviceListViewModel): MobileDeviceCards {
  const cards = view.rows.map((row): MobileDeviceCard => {
    const band = deviceAttentionBand(row);
    const declaredBy = row.declaredBy as string | undefined;
    return {
      deviceId: row.deviceId,
      displayName: row.displayName,
      priority: {
        band,
        rank: deviceAttentionRank(band),
        label: DEVICE_ATTENTION_BAND_LABEL[band],
        status: DEVICE_ATTENTION_CONSOLE_STATUS[band],
      },
      provenance: row.provenance,
      provenanceLabel: DEVICE_RECORD_PROVENANCE_LABEL[row.provenance],
      ...(declaredBy !== undefined ? { declaredBy } : {}),
      lifecycleState: row.lifecycleState,
      posture: {
        summary: row.postureSummary,
        status: postureConsoleStatus(row.postureSummary),
      },
      staleness: {
        band: row.staleness,
        label: STALENESS_BAND_LABEL[row.staleness],
        status: stalenessConsoleStatus(row.staleness),
      },
      ownership: {
        ownerType: row.ownership.ownerType,
        assignedTeam: row.ownership.assignedTeam,
      },
      findings: row.findingCount,
      workloads: row.workloadCount,
      lastObservedAt: row.lastObservedAt,
      recoveryState: row.recoveryState,
    };
  });

  // Severity-first ordering: attention rank ascending, deviceId ascending
  // as the deterministic tiebreak (the established roster discipline).
  const ordered = [...cards].sort((a, b) => {
    if (a.priority.rank !== b.priority.rank) {
      return a.priority.rank < b.priority.rank ? -1 : 1;
    }
    return (a.deviceId as string) < (b.deviceId as string) ? -1 : 1;
  });

  const bandCounts = new Map<DeviceAttentionBand, number>();
  for (const card of ordered) {
    bandCounts.set(card.priority.band, (bandCounts.get(card.priority.band) ?? 0) + 1);
  }
  const byBand = DEVICE_ATTENTION_BAND_ORDER.filter((band) => bandCounts.has(band)).map((band) => ({
    value: band,
    count: bandCounts.get(band) as number,
  }));

  return {
    asOf: view.asOf,
    totalCards: ordered.length,
    totalMatches: view.totalMatches,
    cards: Object.freeze(ordered) as readonly MobileDeviceCard[],
    byBand: Object.freeze(byBand) as readonly { value: DeviceAttentionBand; count: number }[],
  };
}

/** Re-exported for the card surfaces (the canonical order + labels). */
export {
  /** The canonical DECLARED/OBSERVED display order (facet ordering). */
  DEVICE_RECORD_PROVENANCE_ORDER as MOBILE_PROVENANCE_ORDER,
};
