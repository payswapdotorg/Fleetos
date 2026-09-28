/**
 * @fleetos/web-device — D2: the device detail header + the lifecycle
 * state machine surface (READ-ONLY).
 *
 * The device lifecycle transition table is FROZEN in `@fleetos/contracts`
 * (`DEVICE_LIFECYCLE_TRANSITIONS`: strict linear progression ENROLL ->
 * ... -> LEARN; LEARN is terminal and re-enters OBSERVE via observation
 * INGESTION, not via a table transition). This module surfaces that
 * machine READ-ONLY: the view-model derives what the frozen table
 * asserts and NEVER proposes, performs, or re-derives a transition —
 * transitions belong to the domain boundary (W011 ingestion), and the
 * UI surface only makes the state and its legal continuations VISIBLE
 * (`spec/ARCHITECTURE-LOCK.md` item 19).
 *
 * The detail header consumes the SAME structural `DeviceTwinSource`
 * seam as the roster (the real TwinStore at the binding site). A device
 * that exists only in another tenant's partition is indistinguishable
 * from an unknown one: the header is `undefined` — no existence side
 * channel (`spec/ARCHITECTURE-LOCK.md` item 17).
 *
 * PURE + DETERMINISTIC: no clock (the staleness reference instant is
 * injected), no randomness, no I/O. No `any` in public signatures.
 */

import {
  DEVICE_LIFECYCLE_ORDER,
  DEVICE_LIFECYCLE_TRANSITIONS,
  LEARN,
  OBSERVE,
} from "@fleetos/contracts";
import type { DeviceId, DeviceLifecycleState, TenantId } from "@fleetos/contracts";
import { frozen, frozenArray, parseIsoMs } from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import type { DeviceTwinRevisionLike, DeviceTwinSource } from "./seams";
import { classifyTelemetryBand } from "./device-list";
import type { StalenessBands } from "./device-list";

// ---------------------------------------------------------------------------
// The lifecycle state machine surface (read-only)
// ---------------------------------------------------------------------------

/**
 * The READ-ONLY lifecycle machine view of one device's current state:
 * the frozen canonical order, the legal next states (derived from the
 * FROZEN transition table — never a proposal), the terminal flag, the
 * position in the canonical order, and the documented loop-closure note
 * (a LEARNED device re-enters OBSERVE via observation ingestion — the
 * re-entry is NOT a table transition and is surfaced as such).
 */
export interface LifecycleMachineView {
  readonly current: DeviceLifecycleState;
  /** The frozen canonical order (verbatim from @fleetos/contracts). */
  readonly order: readonly DeviceLifecycleState[];
  /** The legal next states per the FROZEN table (0 or 1 — strict linear). */
  readonly nextLegal: readonly DeviceLifecycleState[];
  /** Is the current state terminal (LEARN)? */
  readonly isTerminal: boolean;
  /** 0-based position in the canonical order (-1 when unknown). */
  readonly position: number;
  /**
   * The loop-closure note: `"observation_cycle"` exactly when current is
   * LEARN (the next cycle re-enters OBSERVE via ingestion — read-only
   * documentation of the frozen contract); `"none"` otherwise.
   */
  readonly loopClosure: "observation_cycle" | "none";
}

/**
 * Derive the read-only lifecycle machine view for a state. PURE: a
 * direct read of the FROZEN `DEVICE_LIFECYCLE_TRANSITIONS` table —
 * this function can never widen, reorder, or invent transitions.
 */
export function lifecycleMachineView(current: DeviceLifecycleState): LifecycleMachineView {
  const nextLegal = DEVICE_LIFECYCLE_TRANSITIONS[current] ?? [];
  return frozen({
    current,
    order: DEVICE_LIFECYCLE_ORDER,
    nextLegal: frozenArray(nextLegal as readonly DeviceLifecycleState[]),
    isTerminal: current === LEARN,
    position: DEVICE_LIFECYCLE_ORDER.indexOf(current),
    loopClosure: current === LEARN ? "observation_cycle" : "none",
  });
}

// ---------------------------------------------------------------------------
// The device detail header
// ---------------------------------------------------------------------------

/** The telemetry summary block of the detail header. */
export interface DetailTelemetry {
  readonly lastObservedAt: string | null;
  readonly observationCount: number;
  /** The display staleness band (derived at the injected instant). */
  readonly staleness: "never_observed" | "fresh" | "unknown" | "stale";
}

/** The read-only provenance timeline (the twin's append-only revision log). */
export interface DetailProvenance {
  readonly revisionCount: number;
  readonly entries: readonly DeviceTwinRevisionLike[];
}

/**
 * The device detail header view-model: the identity/ownership/hardware
 * summary, the telemetry summary, the posture summary, the workload +
 * action references, the read-only lifecycle machine surface, and the
 * read-only provenance timeline — everything the W061 shell needs to
 * render a device header WITHOUT any domain re-derivation.
 */
export interface DeviceDetailHeader {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly displayName: string;
  readonly enrolledAt: string;
  readonly adapterFamily: string;
  readonly hardware: {
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber?: string;
    readonly assetTag?: string;
  };
  readonly ownership: {
    readonly ownerType: string;
    readonly assignedUserId?: string;
    readonly assignedTeam?: string;
    readonly assignedAt: string;
  };
  readonly revision: number;
  readonly lifecycle: LifecycleMachineView;
  readonly telemetry: DetailTelemetry;
  readonly posture: { readonly summary: string; readonly findingCount: number };
  readonly workload: { readonly assignedWorkloadIds: readonly string[] };
  readonly actions: {
    readonly activeActionIds: readonly string[];
    readonly recoveryState: string;
  };
  readonly provenance: DetailProvenance;
}

/** Options: the injected staleness reference + band thresholds. */
export interface DeviceDetailOptions extends StalenessBands {
  /** The injected "now" (ISO 8601) — the staleness banding reference. */
  readonly now: string;
}

/**
 * Build the device detail header. PURE: a projection of the twin's
 * consumed sections plus the read-only lifecycle machine surface.
 * Returns `undefined` when the device is not in the ACTING tenant's
 * partition (foreign/unknown are indistinguishable — no existence side
 * channel).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the injected device twin source
 * @param deviceId the device whose header is requested
 * @param options the injected staleness reference + bands
 * @returns the header view-model, or undefined when absent
 */
export function buildDeviceDetailHeader(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  deviceId: DeviceId,
  options: DeviceDetailOptions,
): DeviceDetailHeader | undefined {
  if (typeof options?.now !== "string" || Number.isNaN(parseIsoMs(options.now))) {
    return undefined;
  }
  const actingTenant = typeof scope?.tenantId === "string" ? scope.tenantId : null;
  if (actingTenant === null) return undefined;
  const twin = source.get(actingTenant, deviceId);
  if (twin === undefined) return undefined;

  const revisions = twin.revisions ?? [];
  return frozen({
    tenantId: twin.tenantId,
    deviceId: twin.deviceId,
    displayName: `${twin.identity.enrollment.hardware.manufacturer} ${twin.identity.enrollment.hardware.model}`,
    enrolledAt: twin.identity.enrolledAt,
    adapterFamily: twin.identity.enrollment.adapterFamily,
    hardware: frozen({
      manufacturer: twin.identity.enrollment.hardware.manufacturer,
      model: twin.identity.enrollment.hardware.model,
      serialNumber: twin.identity.enrollment.hardware.serialNumber,
      assetTag: twin.identity.enrollment.hardware.assetTag,
    }),
    ownership: frozen({
      ownerType: twin.identity.ownership.ownerType,
      assignedUserId: twin.identity.ownership.assignedUserId as string | undefined,
      assignedTeam: twin.identity.ownership.assignedTeam,
      assignedAt: twin.identity.ownership.assignedAt,
    }),
    revision: twin.revision,
    lifecycle: lifecycleMachineView(twin.identity.lifecycleState),
    telemetry: frozen({
      lastObservedAt: twin.telemetry.lastObservedAt,
      observationCount: twin.telemetry.observationCount,
      staleness: classifyTelemetryBand(twin.telemetry.lastObservedAt, options.now, options),
    }),
    posture: frozen({
      summary: twin.securityPosture.postureSummary,
      findingCount: twin.securityPosture.findingCount,
    }),
    workload: frozen({ assignedWorkloadIds: frozenArray(twin.workload.assignedWorkloadIds as readonly string[]) }),
    actions: frozen({
      activeActionIds: frozenArray(twin.actions.activeActionIds),
      recoveryState: twin.actions.recoveryState,
    }),
    provenance: frozen({
      revisionCount: revisions.length,
      entries: frozenArray(revisions),
    }),
  });
}

/** Exported read-only for consumers that need the frozen table itself. */
export { DEVICE_LIFECYCLE_TRANSITIONS, DEVICE_LIFECYCLE_ORDER, LEARN, OBSERVE };
