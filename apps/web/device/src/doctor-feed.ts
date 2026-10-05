/**
 * @fleetos/web-device — W141: the Device Doctor RUNTIME FEED.
 *
 * The composition function that carries the runtime state contract into
 * the accepted deep screen's phase props. The console runtime (W144)
 * binds the REAL domain packages at its composition root and calls
 * `composeDeviceDoctorFeed`; the returned feed is everything the
 * DeviceDoctorScreen renders: the screen's exact `ScreenPhase` prop,
 * the machine-proven `lanePhase` (loading / empty / ready / blocked /
 * approval_required / error / unsupported — every transition honest),
 * the full nine-stage diagnosis JOURNEY (device -> observations ->
 * symptoms -> diagnosis -> remediation -> authorization -> action ->
 * result -> evidence), the per-treatment Guardian gating context, and
 * the per-treatment operator dispositions derived from REAL remediation
 * records.
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the injected
 *     sources (the REAL device-model twin store, the REAL health
 *     pipeline outputs, the REAL remediation records at the binding
 *     site). Nothing is fabricated; a fresh tenant composes the honest
 *     `empty` phase (no devices — never demo data).
 *   - NO EXISTENCE SIDE CHANNEL: a device outside the acting tenant's
 *     partition is `blocked` with the device-not-in-fleet reason —
 *     indistinguishable from unknown, and the doctor view-model stays
 *     `undefined` (the screen renders its honest not-found state).
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the feed's gating
 *     and disposition context only ever DESCRIBE records; this module
 *     performs, proposes and dispatches NOTHING.
 *   - Fail-closed: a refused scope grammar yields the deterministic
 *     `blocked` phase with the scope-refused reason — never data.
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import type { DeviceId } from "@fleetos/contracts";
import { frozen } from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import { buildDeviceDoctorViewModel } from "./doctor";
import type { DeviceDoctorViewModel } from "./doctor";
import { buildDeviceDoctorJourney } from "./doctor-journey";
import type { DeviceDoctorJourney } from "./doctor-journey";
import type { TreatmentGatingView } from "./screens/device-doctor-screen";
import type { TreatmentDisposition } from "./screens/device-doctor-screen";
import type { ScreenPhase } from "./ui/primitives";
import {
  DEVICE_LANE_REASONS,
  deviceLaneLoading,
  toDeviceScreenPhase,
} from "./lane-phase";
import type { DeviceLanePhase } from "./lane-phase";
import type {
  DeviceObservationSource,
  DeviceTwinSource,
  DoctorSources,
  RemediationRequestSource,
} from "./seams";

// ---------------------------------------------------------------------------
// The runtime state seam bundle (the lane's runtime state contract)
// ---------------------------------------------------------------------------

/**
 * The device lane's runtime state for the Device Doctor surface: the
 * tenant-partitioned sources the feed composes from. INJECTED at the
 * binding site (the console composition root binds the REAL packages;
 * the machine tests bind them the same way).
 */
export interface DeviceDoctorRuntimeState {
  /** The REAL Device Twin store (structural `DeviceTwinSource`). */
  readonly twins: DeviceTwinSource;
  /** The REAL health-pipeline outputs (structural `DoctorSources`). */
  readonly doctor: DoctorSources;
  /** The device's immutable observations (the journey's raw stage). */
  readonly observations: DeviceObservationSource;
  /** The durable remediation records (disposition/gating/result). */
  readonly remediation: RemediationRequestSource;
}

/** Options for the doctor feed composition. */
export interface DeviceDoctorFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
}

/** Resolve the acting tenant id (the scope guard, typed). PURE. */
function actingTenantId(scope: DeviceUiTenantScope): DeviceDoctorViewModel["tenantId"] | undefined {
  const record = scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  return typeof record?.tenantId === "string" && record.tenantId.length > 0
    ? (record.tenantId as DeviceDoctorViewModel["tenantId"])
    : undefined;
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

/**
 * The Device Doctor feed: everything the screen renders, composed from
 * real runtime state. `phase` is the screen's prop (derived);
 * `lanePhase` is the machine-proven semantic state.
 */
export interface DeviceDoctorFeed {
  /** The EXACT phase prop the DeviceDoctorScreen takes. */
  readonly phase: ScreenPhase<DeviceDoctorViewModel | undefined>;
  /** The machine-proven lane phase (the tests assert every transition). */
  readonly lanePhase: DeviceLanePhase<DeviceDoctorViewModel | undefined>;
  /** The full nine-stage diagnosis journey (undefined while loading/error). */
  readonly journey: DeviceDoctorJourney | undefined;
  /** Per-treatment Guardian gating (keyed by treatment id). */
  readonly treatmentGating: Readonly<Record<string, TreatmentGatingView>>;
  /** Per-treatment operator disposition (keyed by treatment id). */
  readonly treatmentDisposition: Readonly<Record<string, TreatmentDisposition>>;
}

/** The loading feed (the async tier's pre-resolution state). PURE. */
export function loadingDeviceDoctorFeed(): DeviceDoctorFeed {
  return frozen({
    phase: { kind: "loading" },
    lanePhase: deviceLaneLoading<DeviceDoctorViewModel | undefined>(),
    journey: undefined,
    treatmentGating: Object.freeze({}) as Readonly<Record<string, TreatmentGatingView>>,
    treatmentDisposition: Object.freeze({}) as Readonly<Record<string, TreatmentDisposition>>,
  });
}

/** The error feed (the source refused; machine-stable message). PURE. */
export function errorDeviceDoctorFeed(message: string): DeviceDoctorFeed {
  const lanePhase: DeviceLanePhase<DeviceDoctorViewModel | undefined> = {
    kind: "error",
    message,
  };
  return frozen({
    phase: { kind: "error", message },
    lanePhase,
    journey: undefined,
    treatmentGating: Object.freeze({}) as Readonly<Record<string, TreatmentGatingView>>,
    treatmentDisposition: Object.freeze({}) as Readonly<Record<string, TreatmentDisposition>>,
  });
}

/**
 * Compose the Device Doctor feed from the runtime state. PURE and
 * DETERMINISTIC: the same (scope, state, deviceId, options) produce a
 * byte-identical feed.
 *
 * Phase transitions (all machine-proven by the composition tests):
 *   - refused scope grammar        -> blocked (scope_refused; no data)
 *   - device not in the partition  -> blocked (device_not_in_fleet)
 *   - fresh tenant / no devices    -> empty only for the ROSTER feed;
 *     the doctor detail for an absent device stays blocked (honest)
 *   - device present               -> ready (the view + journey compose)
 *   - a PARKED remediation request -> approval_required (view composed)
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param state the injected runtime state (the REAL sources)
 * @param deviceId the device the doctor detail is requested for
 * @param options the injected reference instant
 */
export function composeDeviceDoctorFeed(
  scope: DeviceUiTenantScope,
  state: DeviceDoctorRuntimeState,
  deviceId: DeviceId,
  options: DeviceDoctorFeedOptions,
): DeviceDoctorFeed {
  // Fail-closed: an invalid instant or scope grammar never reaches a source.
  if (typeof options?.now !== "string" || options.now.length === 0) {
    return errorDeviceDoctorFeed("The doctor feed requires an injected reference instant.");
  }
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    const lanePhase: DeviceLanePhase<DeviceDoctorViewModel | undefined> = {
      kind: "blocked",
      reason: DEVICE_LANE_REASONS.scopeRefused,
      view: undefined,
    };
    return frozen({
      phase: toDeviceScreenPhase(lanePhase),
      lanePhase,
      journey: undefined,
      treatmentGating: Object.freeze({}) as Readonly<Record<string, TreatmentGatingView>>,
      treatmentDisposition: Object.freeze({}) as Readonly<Record<string, TreatmentDisposition>>,
    });
  }

  // The composition reads the REAL sources through the seams. A source
  // that throws refuses machine-stably -> the error feed (never data).
  let twin: ReturnType<DeviceTwinSource["get"]>;
  let remediationRecords: ReturnType<RemediationRequestSource["requests"]>;
  let observations: ReturnType<DeviceObservationSource["observations"]>;
  try {
    twin = state.twins.get(tenantId, deviceId);
    remediationRecords = state.remediation.requests(tenantId, deviceId);
    observations = state.observations.observations(tenantId, deviceId);
  } catch {
    return errorDeviceDoctorFeed("The doctor feed's runtime state refused to resolve.");
  }

  // The honest blocked state: the device is not in the acting tenant's
  // partition (no existence side channel; never fabricated).
  if (twin === undefined) {
    const lanePhase: DeviceLanePhase<DeviceDoctorViewModel | undefined> = {
      kind: "blocked",
      reason: DEVICE_LANE_REASONS.deviceNotInFleet,
      view: undefined,
    };
    const journey = buildDeviceDoctorJourney(scope, deviceId, {
      twin: undefined,
      observations: [],
      anomalies: [],
      diagnoses: [],
      treatments: [],
      remediationRequests: [],
      evidence: [],
      now: options.now,
    });
    return frozen({
      phase: toDeviceScreenPhase(lanePhase),
      lanePhase,
      journey,
      treatmentGating: Object.freeze({}) as Readonly<Record<string, TreatmentGatingView>>,
      treatmentDisposition: Object.freeze({}) as Readonly<Record<string, TreatmentDisposition>>,
    });
  }

  // READY: the doctor view-model over the REAL health pipeline state. A
  // refused build (the pure builder's own fail-closed guard) composes the
  // honest blocked feed — never a partial view.
  const view = buildDeviceDoctorViewModel(scope, state.doctor, deviceId, { now: options.now });
  if (view === undefined) {
    const refusedPhase: DeviceLanePhase<DeviceDoctorViewModel | undefined> = {
      kind: "blocked",
      reason: DEVICE_LANE_REASONS.compositionRefused,
      view: undefined,
    };
    return frozen({
      phase: toDeviceScreenPhase(refusedPhase),
      lanePhase: refusedPhase,
      journey: undefined,
      treatmentGating: Object.freeze({}) as Readonly<Record<string, TreatmentGatingView>>,
      treatmentDisposition: Object.freeze({}) as Readonly<Record<string, TreatmentDisposition>>,
    });
  }
  const journey = buildDeviceDoctorJourney(scope, deviceId, {
    twin,
    observations,
    anomalies: state.doctor.anomalies(view.tenantId, deviceId),
    diagnoses: state.doctor.diagnoses(view.tenantId, deviceId),
    treatments: state.doctor.treatments(view.tenantId, deviceId),
    remediationRequests: remediationRecords,
    evidence: state.doctor.evidenceRefs(view.tenantId, deviceId),
    now: options.now,
  });

  // The gating + disposition context from the REAL remediation records.
  const gating: Record<string, TreatmentGatingView> = {};
  const disposition: Record<string, TreatmentDisposition> = {};
  for (const record of remediationRecords) {
    if (record.decision !== undefined) {
      // The decision's matched rules surface as the machine-stable
      // reason codes (verbatim rule ids — never interpreted).
      gating[record.treatmentId] = frozen({
        decision: record.decision.decision,
        reasons: record.decision.rules.map((rule) =>
          frozen({ code: `rule_matched:${rule.ruleId as string}`, ruleId: rule.ruleId as string }),
        ),
      });
    }
    if (record.disposition === "accepted" || record.disposition === "dismissed") {
      disposition[record.treatmentId] = record.disposition;
    }
  }

  // The approval-required lane phase: a PARKED remediation request holds
  // a human decision (the honest semantic — the view still composes).
  const parked = remediationRecords.some((record) => record.status === "PARKED");
  const lanePhase: DeviceLanePhase<DeviceDoctorViewModel | undefined> = parked
    ? { kind: "approval_required", reason: DEVICE_LANE_REASONS.approvalPending, view }
    : { kind: "ready", view };

  return frozen({
    phase: toDeviceScreenPhase(lanePhase),
    lanePhase,
    journey,
    treatmentGating: Object.freeze(gating) as Readonly<Record<string, TreatmentGatingView>>,
    treatmentDisposition: Object.freeze(
      disposition,
    ) as Readonly<Record<string, TreatmentDisposition>>,
  });
}

/**
 * The device roster feed's honest semantic phase (W141's empty-state
 * proof for the LANE): a fresh tenant (no devices in the partition)
 * composes the machine-stable `empty` — never demo data.
 */
export function deviceRosterLanePhase(
  scope: DeviceUiTenantScope,
  twins: DeviceTwinSource,
): DeviceLanePhase<readonly unknown[]> {
  const tenantId = actingTenantId(scope);
  if (tenantId === undefined) {
    return {
      kind: "blocked",
      reason: DEVICE_LANE_REASONS.scopeRefused,
      view: [] as readonly unknown[],
    };
  }
  let listed: readonly unknown[];
  try {
    listed = twins.list(tenantId as never);
  } catch {
    return { kind: "error", message: "The roster's runtime state refused to resolve." };
  }
  if (listed.length === 0) {
    // The honest empty: a fresh tenant's roster IS the empty list —
    // never demo data, never a fabricated device.
    return { kind: "empty", reason: DEVICE_LANE_REASONS.noDevices, view: listed };
  }
  return { kind: "ready", view: listed };
}
