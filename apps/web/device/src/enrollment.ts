/**
 * @fleetos/web-device — D5 (W090A): the existing-fleet ENROLLMENT journey
 * view-model — the ❌ journey gap the UX simulation found ("The
 * architecture requires independently enrolled fleets, but the current
 * shell has no explicit enrollment/onboarding journey").
 *
 * A PURE, DETERMINISTIC multi-step journey machine over the operator's
 * enrollment draft:
 *
 *   initiate  ->  review  ->  confirm  ->  verified | failed
 *
 * Presentation rules (frozen by this surface contract):
 *   - The journey is a FORM-INTENT flow, never a fire-and-forget form:
 *     the terminal state is a VERIFIED enrollment outcome derived from
 *     the Device Twin source (the SAME structural `DeviceTwinSource`
 *     seam the roster/detail surfaces consume), with the evidence made
 *     visible: the enrollment record, the first observation, and the
 *     append-only revision trail.
 *   - `confirm` produces a COMMAND VIEW (an intent descriptor), never
 *     an execution: the shell converts it into the REAL domain command
 *     (`enrollDevice` + `createTwin` + first observation ingestion at
 *     the binding site). The UI surface never performs enrollment.
 *   - The scope acknowledgment (tenant / BYOD vs corporate-owned) is an
 *     explicit accepted/rejected fact on the draft — the BYOD/corporate
 *     distinction is the frozen architecture's (`spec/ARCHITECTURE-
 *     LOCK.md` item 15); the surface only makes the acceptance VISIBLE.
 *   - Validation follows the established `{ path, reason }` discipline
 *     with machine-stable reason codes (surfaced verbatim by the
 *     rendered screen).
 *
 * PURE + DETERMINISTIC: no clock (instants are injected), no randomness,
 * no I/O. No `any` in public signatures. Strict TS. src/ imports:
 * `@fleetos/contracts` ONLY + this package's own structural seams.
 */

import type { DeviceId, DeviceLifecycleState, TenantId } from "@fleetos/contracts";
import { frozen, frozenArray } from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import type { DeviceTwinRevisionLike, DeviceTwinSource } from "./seams";

// ---------------------------------------------------------------------------
// The journey stages + the draft
// ---------------------------------------------------------------------------

/**
 * The enrollment journey stages. `initiate` collects the draft, `review`
 * shows the exact command that will be recorded, `confirm` is the
 * submitted state awaiting the domain outcome, and `verified` / `failed`
 * are the outcome-derived terminal states (verified is the journey's
 * goal — evidence visible, never fire-and-forget).
 */
export type EnrollmentStage = "initiate" | "review" | "confirm" | "verified" | "failed";

/** The canonical stage order (for stepper/timeline display). */
export const ENROLLMENT_STAGE_ORDER: readonly EnrollmentStage[] = Object.freeze([
  "initiate",
  "review",
  "confirm",
  "verified",
] as const);

/** The operator's enrollment draft (the initiate-step input). */
export interface EnrollmentDraft {
  readonly tenantId: TenantId;
  /** The device id the enrollment will record (allocated by the connector / asset record). */
  readonly deviceId: string;
  /** The device class: the adapter family that will manage the device. */
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
  };
  /** Has the operator accepted the tenant/BYOD telemetry scope? */
  readonly scopeAccepted: boolean;
}

/** One machine-stable validation failure (the established discipline). */
export interface EnrollmentFailure {
  readonly path: string;
  readonly reason: string;
}

/** A partial draft patch (top-level fields + sub-record merges). */
export interface EnrollmentDraftPatch {
  readonly deviceId?: string;
  readonly adapterFamily?: string;
  readonly hardware?: Partial<EnrollmentDraft["hardware"]>;
  readonly ownership?: Partial<EnrollmentDraft["ownership"]>;
  readonly scopeAccepted?: boolean;
}

/** The initial (empty) draft for a tenant. PURE. */
export function initialEnrollmentDraft(tenantId: TenantId): EnrollmentDraft {
  return frozen({
    tenantId,
    deviceId: "",
    adapterFamily: "",
    hardware: frozen({ manufacturer: "", model: "", serialNumber: undefined, assetTag: undefined }),
    ownership: frozen({ ownerType: "", assignedUserId: undefined, assignedTeam: undefined }),
    scopeAccepted: false,
  });
}

/**
 * Validate the draft's FIELD completeness (not the scope acceptance —
 * that is the review step's gate). Empty failure list = valid. PURE.
 */
export function validateEnrollmentDraft(draft: EnrollmentDraft): readonly EnrollmentFailure[] {
  const failures: EnrollmentFailure[] = [];
  if (typeof draft?.deviceId !== "string" || draft.deviceId.trim().length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof draft?.adapterFamily !== "string" || draft.adapterFamily.trim().length === 0) {
    failures.push({ path: "/adapterFamily", reason: "required" });
  }
  if (!draft?.hardware || typeof draft.hardware.manufacturer !== "string" || draft.hardware.manufacturer.trim().length === 0) {
    failures.push({ path: "/hardware/manufacturer", reason: "required" });
  }
  if (!draft?.hardware || typeof draft.hardware.model !== "string" || draft.hardware.model.trim().length === 0) {
    failures.push({ path: "/hardware/model", reason: "required" });
  }
  if (!draft?.ownership || typeof draft.ownership.ownerType !== "string" || draft.ownership.ownerType.trim().length === 0) {
    failures.push({ path: "/ownership/ownerType", reason: "required" });
  }
  return frozenArray(failures);
}

// ---------------------------------------------------------------------------
// The journey state machine (pure)
// ---------------------------------------------------------------------------

/** The journey state: the current stage + the draft. PURE value. */
export interface EnrollmentJourneyState {
  readonly stage: EnrollmentStage;
  readonly draft: EnrollmentDraft;
}

/** The initial journey state for a tenant (initiate + empty draft). PURE. */
export function initialEnrollmentJourney(tenantId: TenantId): EnrollmentJourneyState {
  return frozen({ stage: "initiate", draft: initialEnrollmentDraft(tenantId) });
}

/** Apply a partial draft patch (returns a NEW state; PURE). */
export function updateEnrollmentDraft(
  state: EnrollmentJourneyState,
  patch: EnrollmentDraftPatch,
): EnrollmentJourneyState {
  const draft = state.draft;
  const next: EnrollmentDraft = frozen({
    ...draft,
    ...(patch.deviceId !== undefined ? { deviceId: patch.deviceId } : {}),
    ...(patch.adapterFamily !== undefined ? { adapterFamily: patch.adapterFamily } : {}),
    hardware: frozen({
      ...draft.hardware,
      ...(patch.hardware ?? {}),
    }),
    ownership: frozen({
      ...draft.ownership,
      ...(patch.ownership ?? {}),
    }),
    ...(patch.scopeAccepted !== undefined ? { scopeAccepted: patch.scopeAccepted } : {}),
  });
  return frozen({ ...state, draft: next });
}

/** The tagged advance result. */
export type EnrollmentAdvance =
  | { readonly ok: true; readonly state: EnrollmentJourneyState }
  | { readonly ok: false; readonly failures: readonly EnrollmentFailure[] };

/**
 * Advance the journey one step. PURE:
 *   - initiate -> review requires complete draft fields;
 *   - review -> confirm requires the scope acknowledgment;
 *   - confirm is terminal for the FORM (the outcome — verified/failed —
 *     arrives through `enrollmentOutcome`, driven by the domain);
 *   - verified/failed are terminal.
 */
export function advanceEnrollmentJourney(state: EnrollmentJourneyState): EnrollmentAdvance {
  switch (state.stage) {
    case "initiate": {
      const failures = validateEnrollmentDraft(state.draft);
      if (failures.length > 0) return { ok: false, failures };
      return { ok: true, state: frozen({ ...state, stage: "review" }) };
    }
    case "review": {
      const failures = validateEnrollmentDraft(state.draft);
      if (failures.length > 0) return { ok: false, failures };
      if (state.draft.scopeAccepted !== true) {
        return { ok: false, failures: frozenArray([{ path: "/scopeAccepted", reason: "acceptance_required" }]) };
      }
      return { ok: true, state: frozen({ ...state, stage: "confirm" }) };
    }
    case "confirm":
    case "verified":
    case "failed":
      return { ok: false, failures: frozenArray([{ path: "/stage", reason: "terminal_stage" }]) };
  }
}

/** Step back one step (review -> initiate; confirm/failed -> review). PURE. */
export function backEnrollmentJourney(state: EnrollmentJourneyState): EnrollmentJourneyState {
  switch (state.stage) {
    case "review":
      return frozen({ ...state, stage: "initiate" });
    case "confirm":
    case "failed":
      return frozen({ ...state, stage: "review" });
    case "initiate":
    case "verified":
      return state;
  }
}

/** The domain outcome applied to a submitted journey. PURE. */
export function enrollmentOutcome(
  state: EnrollmentJourneyState,
  outcome: { readonly ok: true } | { readonly ok: false; readonly reason: string },
): EnrollmentJourneyState {
  if (state.stage !== "confirm") return state;
  return frozen({ ...state, stage: outcome.ok ? "verified" : "failed" });
}

/** The failure reason a failed journey carries (rendered verbatim). PURE. */
export function enrollmentFailureNote(state: EnrollmentJourneyState): string | undefined {
  return state.stage === "failed" ? "enrollment_refused" : undefined;
}

// ---------------------------------------------------------------------------
// The review projection + the command view (an INTENT, never an execution)
// ---------------------------------------------------------------------------

/** The read-only review projection of the draft (what will be recorded). */
export interface EnrollmentReviewView {
  readonly deviceId: string;
  readonly adapterFamily: string;
  readonly hardware: EnrollmentDraft["hardware"];
  readonly ownership: EnrollmentDraft["ownership"];
  readonly scopeAccepted: boolean;
  /**
   * The telemetry-scope note keyed on the ownership type: BYOD devices
   * enter as CUSTOMER_OWNED (the frozen domain mapping) — displayed,
   * never re-derived.
   */
  readonly scopeKind: "byod" | "corporate";
  readonly fieldFailures: readonly EnrollmentFailure[];
}

/** Project the draft for the review step. PURE. */
export function enrollmentReview(state: EnrollmentJourneyState): EnrollmentReviewView {
  return frozen({
    deviceId: state.draft.deviceId,
    adapterFamily: state.draft.adapterFamily,
    hardware: state.draft.hardware,
    ownership: state.draft.ownership,
    scopeAccepted: state.draft.scopeAccepted,
    scopeKind: state.draft.ownership.ownerType === "CUSTOMER_OWNED" ? "byod" : "corporate",
    fieldFailures: validateEnrollmentDraft(state.draft),
  });
}

/**
 * The enrollment COMMAND view: the exact intent descriptor the shell
 * converts into the REAL domain command at the boundary. This is a
 * PROPOSAL-shaped value — it is never an execution and never a twin.
 */
export interface EnrollmentCommandView {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly adapterFamily: string;
  readonly hardware: EnrollmentDraft["hardware"];
  readonly ownership: EnrollmentDraft["ownership"];
  readonly scopeAccepted: true;
}

/**
 * Derive the command view from a journey whose draft is complete AND
 * scope-accepted; `undefined` otherwise (the journey is not submittable
 * yet — the surface refuses to fabricate a command). PURE.
 */
export function enrollmentCommand(state: EnrollmentJourneyState): EnrollmentCommandView | undefined {
  if (validateEnrollmentDraft(state.draft).length > 0) return undefined;
  if (state.draft.scopeAccepted !== true) return undefined;
  return frozen({
    tenantId: state.draft.tenantId,
    deviceId: state.draft.deviceId.trim() as DeviceId,
    adapterFamily: state.draft.adapterFamily.trim(),
    hardware: state.draft.hardware,
    ownership: state.draft.ownership,
    scopeAccepted: true,
  });
}

// ---------------------------------------------------------------------------
// The VERIFIED enrollment outcome (derived from the twin source)
// ---------------------------------------------------------------------------

/** One verification check (machine-stable id + met/unmet state). */
export interface EnrollmentCheck {
  readonly id: "device_enrolled" | "first_observation" | "evidence_trail";
  readonly label: string;
  readonly state: "met" | "unmet";
}

/** The evidence block of a verification (present when the twin exists). */
export interface EnrollmentEvidenceView {
  readonly enrolledAt: string | undefined;
  readonly adapterFamily: string | undefined;
  readonly hardware: {
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber?: string;
    readonly assetTag?: string;
  } | undefined;
  readonly ownership: { readonly ownerType: string; readonly assignedTeam?: string } | undefined;
  readonly lifecycleState: DeviceLifecycleState | undefined;
  readonly observationCount: number;
  readonly lastObservedAt: string | null | undefined;
  readonly revisionCount: number;
  readonly revisions: readonly DeviceTwinRevisionLike[];
}

/** The verification view-model. `verified` is the journey's terminal goal. */
export interface EnrollmentVerification {
  readonly deviceId: DeviceId;
  readonly status: "unknown_device" | "unverified" | "verified";
  readonly checks: readonly EnrollmentCheck[];
  readonly evidence: EnrollmentEvidenceView;
}

const ENROLLMENT_CHECK_LABELS: Readonly<Record<EnrollmentCheck["id"], string>> = Object.freeze({
  device_enrolled: "Device identity recorded in your fleet",
  first_observation: "First observation received from the device",
  evidence_trail: "Append-only evidence trail started",
});

/**
 * Verify an enrollment against the injected Device Twin source. PURE
 * and DETERMINISTIC: the same (source, deviceId) always produce the
 * same checks + evidence. A device that exists only in another
 * tenant's partition is indistinguishable from an unknown one
 * (`unknown_device` — no existence side channel).
 *
 * The three checks are the journey's definition of VERIFIED:
 *   1. the twin exists (the enrollment record is durable);
 *   2. the device has reported at least one observation;
 *   3. the twin carries an append-only revision trail.
 */
export function verifyEnrollment(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  deviceId: DeviceId,
): EnrollmentVerification {
  const scopeRecord =
    scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  const actingTenant =
    typeof scopeRecord?.tenantId === "string" && scopeRecord.tenantId.length > 0
      ? (scopeRecord.tenantId as TenantId)
      : null;

  const empty: EnrollmentVerification = frozen({
    deviceId,
    status: "unknown_device",
    checks: frozenArray(
      (Object.keys(ENROLLMENT_CHECK_LABELS) as EnrollmentCheck["id"][]).map((id) =>
        frozen<EnrollmentCheck>({ id, label: ENROLLMENT_CHECK_LABELS[id], state: "unmet" }),
      ),
    ),
    evidence: frozen({
      enrolledAt: undefined,
      adapterFamily: undefined,
      hardware: undefined,
      ownership: undefined,
      lifecycleState: undefined,
      observationCount: 0,
      lastObservedAt: undefined,
      revisionCount: 0,
      revisions: frozenArray([]),
    }),
  });

  if (actingTenant === null) return empty;
  const twin = source.get(actingTenant, deviceId);
  if (twin === undefined) return empty;

  const revisions = twin.revisions ?? [];
  const checks: readonly EnrollmentCheck[] = frozenArray([
    frozen<EnrollmentCheck>({ id: "device_enrolled", label: ENROLLMENT_CHECK_LABELS.device_enrolled, state: "met" }),
    frozen<EnrollmentCheck>({
      id: "first_observation",
      label: ENROLLMENT_CHECK_LABELS.first_observation,
      state: twin.telemetry.observationCount >= 1 ? "met" : "unmet",
    }),
    frozen<EnrollmentCheck>({
      id: "evidence_trail",
      label: ENROLLMENT_CHECK_LABELS.evidence_trail,
      state: revisions.length > 0 ? "met" : "unmet",
    }),
  ]);
  const verified = checks.every((check) => check.state === "met");

  return frozen({
    deviceId,
    status: verified ? "verified" : "unverified",
    checks,
    evidence: frozen({
      enrolledAt: twin.identity.enrolledAt,
      adapterFamily: twin.identity.enrollment.adapterFamily,
      hardware: frozen({
        manufacturer: twin.identity.enrollment.hardware.manufacturer,
        model: twin.identity.enrollment.hardware.model,
        ...(twin.identity.enrollment.hardware.serialNumber !== undefined
          ? { serialNumber: twin.identity.enrollment.hardware.serialNumber }
          : {}),
        ...(twin.identity.enrollment.hardware.assetTag !== undefined
          ? { assetTag: twin.identity.enrollment.hardware.assetTag }
          : {}),
      }),
      ownership: frozen({
        ownerType: twin.identity.ownership.ownerType,
        ...(twin.identity.ownership.assignedTeam !== undefined
          ? { assignedTeam: twin.identity.ownership.assignedTeam }
          : {}),
      }),
      lifecycleState: twin.identity.lifecycleState,
      observationCount: twin.telemetry.observationCount,
      lastObservedAt: twin.telemetry.lastObservedAt,
      revisionCount: revisions.length,
      revisions: frozenArray(revisions),
    }),
  });
}
