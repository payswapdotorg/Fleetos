/**
 * @fleetos/web-recovery — D1: the Find My Device view surface (W040).
 *
 * The last-seen evidence ledger surfaced READ-ONLY: the current
 * last-seen summary (staleness re-derived against the VIEW's injected
 * instant + bands), the derived last-known-location state, and the
 * append-only revision history. Machine-stable presentation rules:
 *
 *   - Absent location evidence is the machine-stable
 *     `no_location_evidence` — surfaced VERBATIM, never a guess, a
 *     default fix, or an interpolation (the frozen domain contract).
 *   - The location payload is NEVER carried into the view-model: the
 *     immutable observation's evidence ref (id), its timestamp and its
 *     staleness are the anchor. The surface therefore cannot interpret
 *     location payload bytes — the strongest form of opaque.
 *   - Evidence refs (observation ids) are opaque strings surfaced
 *     verbatim; counts are surfaced, contents are not.
 *   - A device that exists only in another tenant's partition is
 *     indistinguishable from an unknown one (the domain's discipline,
 *     preserved by the seam).
 *
 * PURE + DETERMINISTIC: no clock (the view instant is injected), no
 * randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import { SYNTHETIC_SYSTEM_TENANT, checkRecoveryUiTenantScope, compareStrings, frozen, frozenArray } from "./internal";
import type { RecoveryUiTenantScope } from "./internal";
import type { FindMyBands, FindMyDeviceSource } from "./seams";
import type { DeviceId, TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The machine-stable location states (re-exported display constants)
// ---------------------------------------------------------------------------

/** Absent location evidence — machine-stable, never a guess. */
export const NO_LOCATION_EVIDENCE = "no_location_evidence" as const;
/** Location evidence present — machine-stable. */
export const LOCATED = "located" as const;

// ---------------------------------------------------------------------------
// The view-models
// ---------------------------------------------------------------------------

/** The read-only last-seen summary block. */
export interface FindMyLastSeenView {
  readonly recordId: string;
  readonly observedAt: string;
  readonly recordedAt: string;
  /** Staleness re-derived against the VIEW's injected instant + bands. */
  readonly staleness: string;
  readonly evidenceCount: number;
}

/**
 * The derived last-known-location state. The `located` variant carries
 * the immutable observation's evidence ref + timestamp + staleness —
 * NEVER the payload bytes (opaque by omission).
 */
export type FindMyLocationView =
  | { readonly status: typeof NO_LOCATION_EVIDENCE }
  | {
      readonly status: typeof LOCATED;
      /** The evidence ref: the immutable location observation's id. */
      readonly observationId: string;
      readonly observedAt: string;
      readonly observationKind: string;
      /** Staleness re-derived at the view's injected instant. */
      readonly staleness: string;
      /** The last-seen record the location evidence was captured in. */
      readonly fromRecordId: string;
    };

/** One append-only ledger revision, surfaced read-only. */
export interface FindMyLedgerEntryView {
  readonly recordId: string;
  readonly version: number;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly staleness: string;
  readonly evidenceCount: number;
  /** Did this revision carry location-bearing evidence? */
  readonly locationBorne: boolean;
}

/**
 * The Find-My-Device view-model of one device: the last-seen summary,
 * the machine-stable location state, and the append-only evidence
 * ledger (read-only history, version order).
 */
export interface FindMyDeviceViewModel {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The injected view instant — the staleness reference (never a clock read). */
  readonly asOf: string;
  readonly lastSeen: FindMyLastSeenView | undefined;
  readonly location: FindMyLocationView;
  readonly ledger: readonly FindMyLedgerEntryView[];
  /** Machine-stable flag: is location evidence present at all? */
  readonly locationKnown: boolean;
}

/** Options: the injected view instant + staleness bands. */
export interface FindMyDeviceOptions extends FindMyBands {
  /** The injected "now" (ISO 8601) — the staleness banding reference. */
  readonly at: string;
}

/**
 * Build the Find-My-Device view-model. PURE and DETERMINISTIC: the
 * same (source, device, options) always produce a byte-identical view.
 * The source is the INJECTED structural seam (the REAL
 * `findMyDevice` + ledger at the binding site); a refused scope yields
 * the deterministic empty view (`no_location_evidence`, no ledger, no
 * data — no leak).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the injected Find-My-Device source
 * @param deviceId the device to locate
 * @param options the injected view instant + bands
 * @returns the view-model (never undefined — absence IS the view)
 */
export function buildFindMyDeviceViewModel(
  scope: RecoveryUiTenantScope,
  source: FindMyDeviceSource,
  deviceId: DeviceId,
  options: FindMyDeviceOptions,
): FindMyDeviceViewModel {
  const empty: FindMyDeviceViewModel = frozen({
    tenantId: SYNTHETIC_SYSTEM_TENANT,
    deviceId,
    asOf: options?.at ?? "",
    lastSeen: undefined,
    location: frozen({ status: NO_LOCATION_EVIDENCE }),
    ledger: frozenArray([]),
    locationKnown: false,
  });

  if (typeof options?.at !== "string" || options.at.length === 0) return empty;
  const guard = checkRecoveryUiTenantScope(scope);
  if (!guard.ok) return empty;

  const view = source.view(guard.tenantId, deviceId, options.at, options);
  const revisions = source.revisions(guard.tenantId, deviceId);

  const lastSeen: FindMyLastSeenView | undefined =
    view.lastSeen === undefined
      ? undefined
      : frozen({
          recordId: view.lastSeen.recordId,
          observedAt: view.lastSeen.observedAt,
          recordedAt: view.lastSeen.recordedAt,
          staleness: view.lastSeen.staleness,
          evidenceCount: view.lastSeen.evidence.length,
        });

  const location: FindMyLocationView =
    view.location.status === LOCATED
      ? frozen({
          status: LOCATED,
          observationId: view.location.observationId,
          observedAt: view.location.observedAt,
          observationKind: view.location.kind,
          staleness: view.location.staleness,
          fromRecordId: view.location.fromRecordId,
        })
      : frozen({ status: NO_LOCATION_EVIDENCE });

  const ledger: readonly FindMyLedgerEntryView[] = [...revisions]
    .sort((a, b) => a.version - b.version)
    .map((revision) =>
      frozen({
        recordId: revision.recordId,
        version: revision.version,
        observedAt: revision.observedAt,
        recordedAt: revision.recordedAt,
        staleness: revision.staleness,
        evidenceCount: revision.evidence.length,
        locationBorne: revision.hasLocationEvidence,
      }),
    );

  return frozen({
    tenantId: guard.tenantId,
    deviceId,
    asOf: options.at,
    lastSeen,
    location,
    ledger: frozenArray(ledger),
    locationKnown: location.status === LOCATED,
  });
}

/** Deterministic helper: the ledger entries that carried location evidence. */
export function locationBearingEntries(view: FindMyDeviceViewModel): readonly FindMyLedgerEntryView[] {
  return view.ledger.filter((entry) => entry.locationBorne);
}

/** Deterministic helper: compare two ledger entries by observed instant. */
export function byObservedAt(a: FindMyLedgerEntryView, b: FindMyLedgerEntryView): number {
  const delta = compareStrings(a.observedAt, b.observedAt);
  return delta !== 0 ? delta : compareStrings(a.recordId, b.recordId);
}
