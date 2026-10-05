/**
 * @fleetos/web-device — W145: the DECLARED-IMPORT surface view-model.
 *
 * The SIM-B ground truth this module fixes: a SMALL firm has no way to
 * begin tracking devices before agent rollout (the cold-start blocker —
 * "enrollment stays 'unbootstrapped — waiting' with no manual path").
 * This is the manual device-record entry path: a PURE, DETERMINISTIC
 * multi-step journey over the operator's declared-record draft.
 *
 *   enter  ->  review  ->  confirm  ->  recorded | refused
 *
 * Doctrine (frozen by this surface contract):
 *   - PROVENANCE MARKING, NOT EXCLUSION: a declared record is a REAL
 *     device record that flows into the SAME runtime state contract
 *     surfaces (roster, feeds, searches) with its origin marked
 *     DECLARED on every surface. The real-observations-only doctrine is
 *     respected by the mark — a declared record NEVER fabricates an
 *     observation: its telemetry stays honestly empty (Never observed)
 *     until a real agent checks in.
 *   - THE MARK IS A CONTRACT BETWEEN THIS LANE'S COMMAND VIEW AND ITS
 *     PROVENANCE DERIVATION: `declaredImportCommand` carries the exact
 *     enrollment provenance (`reason: fleetos.declared-import` + the
 *     declaring user actor) the binding site records VERBATIM through
 *     the REAL domain path (enrollDevice + createTwin + store), and
 *     `deviceRecordProvenance` derives DECLARED iff that marker is
 *     present. An agent-path record never carries the marker, so it
 *     derives OBSERVED — the two are never conflated, and a binding
 *     site that drops the marker is DETECTED
 *     (`verifyDeclaredImport` reports `present_not_declared`).
 *   - HONEST DUPLICATE HANDLING: a device id already in the acting
 *     tenant's partition is a BLOCKING duplicate (never overwritten,
 *     never silently merged — the existing record's summary is
 *     shown); a serial number already recorded is an ACKNOWLEDGEABLE
 *     duplicate (the operator must explicitly accept it before the
 *     import can proceed).
 *   - The command view is an INTENT, never an execution: the shell
 *     converts it into the REAL domain command at the boundary. This
 *     module performs, proposes and dispatches NOTHING.
 *
 * PURE + DETERMINISTIC: no clock (the declaration instant is injected),
 * no randomness, no I/O. No `any` in public signatures. Strict TS.
 * src/ imports: `@fleetos/contracts` ONLY + this package's own files.
 */

import type { CorrelationId, DeviceId, TenantId, UserId } from "@fleetos/contracts";
import { frozen, frozenArray } from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import type { DeviceTwinLike, DeviceTwinSource } from "./seams";

// ---------------------------------------------------------------------------
// The record-provenance vocabulary (DECLARED vs OBSERVED — the marking)
// ---------------------------------------------------------------------------

/**
 * How a device record entered the fleet. DECLARED: manually entered by
 * an operator (no agent performed the enrollment; provenance-flagged on
 * every surface). OBSERVED: the agent enrollment path — the record's
 * default origin (the real-observations-only doctrine's home lane).
 */
export type DeviceRecordProvenance = "DECLARED" | "OBSERVED";

/** The canonical display order of the provenance values (deterministic). */
export const DEVICE_RECORD_PROVENANCE_ORDER: readonly DeviceRecordProvenance[] = Object.freeze([
  "DECLARED",
  "OBSERVED",
] as const);

/** The human display label of each provenance value (always rendered). */
export const DEVICE_RECORD_PROVENANCE_LABEL: Readonly<Record<DeviceRecordProvenance, string>> =
  Object.freeze({
    DECLARED: "Declared",
    OBSERVED: "Observed",
  } as const);

/**
 * The machine-stable marker a declared import records in the enrollment
 * provenance's `reason`. This is the CONTRACT between
 * `declaredImportCommand` (which carries it) and
 * `deviceRecordProvenance` (which derives the DECLARED mark from it) —
 * both live in this lane, so the marking never depends on free-form
 * prose from the binding site.
 */
export const DECLARED_IMPORT_PROVENANCE_REASON = "fleetos.declared-import" as const;

/**
 * The adapter family recorded on a declared record. No adapter performed
 * the enrollment — the domain's enrollment input requires a non-empty
 * family, and `declared` states that fact machine-stably (it also keeps
 * declared records visibly distinct in the roster's platform facet).
 */
export const DECLARED_ADAPTER_FAMILY = "declared" as const;

/**
 * Derive a record's provenance from the twin's enrollment provenance:
 * DECLARED iff the enrollment carries this lane's declared-import
 * marker; OBSERVED otherwise (the agent enrollment path's default).
 * PURE — the default is the conservative OBSERVED, so a twin-like
 * without provenance is never presented as DECLARED.
 */
export function deviceRecordProvenance(twin: DeviceTwinLike): DeviceRecordProvenance {
  return twin.identity.enrollment.provenance?.reason === DECLARED_IMPORT_PROVENANCE_REASON
    ? "DECLARED"
    : "OBSERVED";
}

/** Is the record a declared import? PURE (the marking predicate). */
export function isDeclaredDeviceRecord(twin: DeviceTwinLike): boolean {
  return deviceRecordProvenance(twin) === "DECLARED";
}

/**
 * The declaring principal's user id, when a DECLARED record was declared
 * by a user. `undefined` for agent-path records (and system-declared
 * ones). PURE — surfaced on the roster row as `declaredBy`.
 */
export function declaredRecordBy(twin: DeviceTwinLike): UserId | undefined {
  if (deviceRecordProvenance(twin) !== "DECLARED") return undefined;
  const actor = twin.identity.enrollment.provenance?.actor;
  return actor?.kind === "user" && typeof actor.userId === "string"
    ? (actor.userId as UserId)
    : undefined;
}

// ---------------------------------------------------------------------------
// The declared-record draft (the enter step's input)
// ---------------------------------------------------------------------------

/**
 * The operator's declared-record draft. Mirrors the enrollment draft's
 * discipline (the same identity/ownership fields a SMALL firm can fill
 * from an asset spreadsheet), plus the two explicit acknowledgments the
 * honest path requires.
 */
export interface DeclaredDeviceDraft {
  readonly tenantId: TenantId;
  /** The device id the declared record will carry (copied from the asset record). */
  readonly deviceId: string;
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
  /** Has the operator acknowledged the DECLARED provenance contract? */
  readonly provenanceAcknowledged: boolean;
  /** Has the operator acknowledged a same-serial duplicate as intentional? */
  readonly duplicateSerialAcknowledged: boolean;
}

/** One machine-stable validation failure (the established discipline). */
export interface DeclaredImportFailure {
  readonly path: string;
  readonly reason: string;
}

/** A partial draft patch (top-level fields + sub-record merges). */
export interface DeclaredDeviceDraftPatch {
  readonly deviceId?: string;
  readonly hardware?: Partial<DeclaredDeviceDraft["hardware"]>;
  readonly ownership?: Partial<DeclaredDeviceDraft["ownership"]>;
  readonly provenanceAcknowledged?: boolean;
  readonly duplicateSerialAcknowledged?: boolean;
}

/** The initial (empty) declared-record draft for a tenant. PURE. */
export function initialDeclaredDeviceDraft(tenantId: TenantId): DeclaredDeviceDraft {
  return frozen({
    tenantId,
    deviceId: "",
    hardware: frozen({ manufacturer: "", model: "", serialNumber: undefined, assetTag: undefined }),
    ownership: frozen({ ownerType: "", assignedUserId: undefined, assignedTeam: undefined }),
    provenanceAcknowledged: false,
    duplicateSerialAcknowledged: false,
  });
}

/** Normalize an optional field: empty/whitespace-only becomes undefined. */
function optionalText(value: string | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Validate the draft's FIELD completeness. Empty failure list = valid.
 * Machine-stable reasons, surfaced verbatim by the rendered screen.
 * PURE.
 */
export function validateDeclaredDeviceDraft(draft: DeclaredDeviceDraft): readonly DeclaredImportFailure[] {
  const failures: DeclaredImportFailure[] = [];
  if (typeof draft?.deviceId !== "string" || draft.deviceId.trim().length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (
    typeof draft?.hardware !== "object" ||
    draft.hardware === null ||
    typeof draft.hardware.manufacturer !== "string" ||
    draft.hardware.manufacturer.trim().length === 0
  ) {
    failures.push({ path: "/hardware/manufacturer", reason: "required" });
  }
  if (
    typeof draft?.hardware !== "object" ||
    draft.hardware === null ||
    typeof draft.hardware.model !== "string" ||
    draft.hardware.model.trim().length === 0
  ) {
    failures.push({ path: "/hardware/model", reason: "required" });
  }
  if (
    typeof draft?.ownership !== "object" ||
    draft.ownership === null ||
    typeof draft.ownership.ownerType !== "string" ||
    draft.ownership.ownerType.trim().length === 0
  ) {
    failures.push({ path: "/ownership/ownerType", reason: "required" });
  }
  return frozenArray(failures);
}

// ---------------------------------------------------------------------------
// The honest duplicate review (over the injected twin source)
// ---------------------------------------------------------------------------

/**
 * One duplicate finding against the acting tenant's existing records.
 * `duplicate_device_id` is BLOCKING (the import refuses — an existing
 * record is never overwritten or merged); `duplicate_serial_number`
 * is ACKNOWLEDGEABLE (the operator must explicitly accept it).
 */
export interface DeclaredDuplicateFinding {
  readonly kind: "duplicate_device_id" | "duplicate_serial_number";
  /** The EXISTING record's device id. */
  readonly deviceId: DeviceId;
  /** The existing record's provenance (DECLARED / OBSERVED), shown verbatim. */
  readonly provenance: DeviceRecordProvenance;
  /** The existing record's display name ("<manufacturer> <model>"). */
  readonly displayName: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly serialNumber: string | undefined;
}

/**
 * Review the draft against the acting tenant's existing device records.
 * PURE and DETERMINISTIC: the same (scope, source, draft) always produce
 * the same findings in the same order (deviceId collisions first, then
 * serial collisions ordered by deviceId). A refused scope grammar yields
 * the deterministic EMPTY review (no data, no leak — the established
 * fail-closed guard; the enter/review steps' own field validation still
 * applies).
 */
export function reviewDeclaredDeviceDuplicates(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  draft: DeclaredDeviceDraft,
): readonly DeclaredDuplicateFinding[] {
  const scopeRecord =
    scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  const actingTenant =
    typeof scopeRecord?.tenantId === "string" && scopeRecord.tenantId.length > 0
      ? (scopeRecord.tenantId as TenantId)
      : null;
  if (actingTenant === null) return frozenArray([]);

  const findings: DeclaredDuplicateFinding[] = [];
  const draftDeviceId = draft?.deviceId?.trim() ?? "";
  const draftSerial = optionalText(draft?.hardware?.serialNumber);

  // The blocking check: an existing record with the SAME device id.
  if (draftDeviceId.length > 0) {
    const existing = source.get(actingTenant, draftDeviceId as DeviceId);
    if (existing !== undefined) {
      findings.push({
        kind: "duplicate_device_id",
        deviceId: existing.deviceId,
        provenance: deviceRecordProvenance(existing),
        displayName: `${existing.identity.enrollment.hardware.manufacturer} ${existing.identity.enrollment.hardware.model}`,
        manufacturer: existing.identity.enrollment.hardware.manufacturer,
        model: existing.identity.enrollment.hardware.model,
        serialNumber: existing.identity.enrollment.hardware.serialNumber,
      });
    }
  }

  // The acknowledgeable check: an existing record with the SAME serial
  // number (case-insensitive). Every existing record is listed — the
  // operator sees exactly what collides and decides.
  if (draftSerial !== undefined) {
    const needle = draftSerial.toLowerCase();
    const twins = source.list(actingTenant);
    for (const twin of twins) {
      const serial = twin.identity.enrollment.hardware.serialNumber;
      if (serial !== undefined && serial.toLowerCase() === needle) {
        findings.push({
          kind: "duplicate_serial_number",
          deviceId: twin.deviceId,
          provenance: deviceRecordProvenance(twin),
          displayName: `${twin.identity.enrollment.hardware.manufacturer} ${twin.identity.enrollment.hardware.model}`,
          manufacturer: twin.identity.enrollment.hardware.manufacturer,
          model: twin.identity.enrollment.hardware.model,
          serialNumber: serial,
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.kind === b.kind
      ? (a.deviceId as string) < (b.deviceId as string)
        ? -1
        : 1
      : a.kind === "duplicate_device_id"
        ? -1
        : 1,
  );
  return frozenArray(findings);
}

/** Is the given duplicate finding blocking? PURE. */
export function isBlockingDuplicate(finding: DeclaredDuplicateFinding): boolean {
  return finding.kind === "duplicate_device_id";
}

// ---------------------------------------------------------------------------
// The journey state machine (pure)
// ---------------------------------------------------------------------------

/**
 * The declared-import journey stages. `enter` collects the draft,
 * `review` shows the exact record + the duplicate report + the
 * provenance acknowledgment, `confirm` is the submitted state awaiting
 * the domain outcome, and `recorded` / `refused` are the outcome-derived
 * terminal states (recorded is the journey's goal — the DECLARED record
 * verified in the twin source with evidence).
 */
export type DeclaredImportStage = "enter" | "review" | "confirm" | "recorded" | "refused";

/** The canonical stage order (for stepper/timeline display). */
export const DECLARED_IMPORT_STAGE_ORDER: readonly DeclaredImportStage[] = Object.freeze([
  "enter",
  "review",
  "confirm",
  "recorded",
] as const);

/** The journey state: the current stage + the draft. PURE value. */
export interface DeclaredImportJourneyState {
  readonly stage: DeclaredImportStage;
  readonly draft: DeclaredDeviceDraft;
}

/** The initial journey state for a tenant (enter + empty draft). PURE. */
export function initialDeclaredImportJourney(tenantId: TenantId): DeclaredImportJourneyState {
  return frozen({ stage: "enter", draft: initialDeclaredDeviceDraft(tenantId) });
}

/** Apply a partial draft patch (returns a NEW state; PURE). */
export function updateDeclaredDeviceDraft(
  state: DeclaredImportJourneyState,
  patch: DeclaredDeviceDraftPatch,
): DeclaredImportJourneyState {
  const draft = state.draft;
  const next: DeclaredDeviceDraft = frozen({
    ...draft,
    ...(patch.deviceId !== undefined ? { deviceId: patch.deviceId } : {}),
    hardware: frozen({
      ...draft.hardware,
      ...(patch.hardware ?? {}),
    }),
    ownership: frozen({
      ...draft.ownership,
      ...(patch.ownership ?? {}),
    }),
    ...(patch.provenanceAcknowledged !== undefined
      ? { provenanceAcknowledged: patch.provenanceAcknowledged }
      : {}),
    ...(patch.duplicateSerialAcknowledged !== undefined
      ? { duplicateSerialAcknowledged: patch.duplicateSerialAcknowledged }
      : {}),
  });
  return frozen({ ...state, draft: next });
}

/** The tagged advance result. */
export type DeclaredImportAdvance =
  | { readonly ok: true; readonly state: DeclaredImportJourneyState }
  | { readonly ok: false; readonly failures: readonly DeclaredImportFailure[] };

/**
 * Advance the journey one step. PURE:
 *   - enter -> review requires complete draft fields;
 *   - review -> confirm requires complete fields + NO blocking
 *     duplicate + the serial-duplicate acknowledgment (when a same-serial
 *     record exists) + the provenance acknowledgment;
 *   - confirm is terminal for the FORM (the outcome — recorded/refused —
 *     arrives through `declaredImportOutcome`, driven by the domain);
 *   - recorded/refused are terminal.
 */
export function advanceDeclaredImportJourney(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  state: DeclaredImportJourneyState,
): DeclaredImportAdvance {
  switch (state.stage) {
    case "enter": {
      const failures = validateDeclaredDeviceDraft(state.draft);
      if (failures.length > 0) return { ok: false, failures };
      return { ok: true, state: frozen({ ...state, stage: "review" }) };
    }
    case "review": {
      const failures: DeclaredImportFailure[] = [
        ...validateDeclaredDeviceDraft(state.draft),
      ];
      const duplicates = reviewDeclaredDeviceDuplicates(scope, source, state.draft);
      if (duplicates.some(isBlockingDuplicate)) {
        failures.push({ path: "/duplicates/deviceId", reason: "duplicate_device_id" });
      }
      const serialDuplicate = duplicates.some((finding) => finding.kind === "duplicate_serial_number");
      if (serialDuplicate && state.draft.duplicateSerialAcknowledged !== true) {
        failures.push({ path: "/duplicates/serialNumber", reason: "duplicate_serial_acknowledgment_required" });
      }
      if (state.draft.provenanceAcknowledged !== true) {
        failures.push({ path: "/provenanceAcknowledged", reason: "acknowledgment_required" });
      }
      if (failures.length > 0) return { ok: false, failures: frozenArray(failures) };
      return { ok: true, state: frozen({ ...state, stage: "confirm" }) };
    }
    case "confirm":
    case "recorded":
    case "refused":
      return { ok: false, failures: frozenArray([{ path: "/stage", reason: "terminal_stage" }]) };
  }
}

/** Step back one step (review -> enter; confirm/refused -> review). PURE. */
export function backDeclaredImportJourney(state: DeclaredImportJourneyState): DeclaredImportJourneyState {
  switch (state.stage) {
    case "review":
      return frozen({ ...state, stage: "enter" });
    case "confirm":
    case "refused":
      return frozen({ ...state, stage: "review" });
    case "enter":
    case "recorded":
      return state;
  }
}

/** The domain outcome applied to a submitted journey. PURE. */
export function declaredImportOutcome(
  state: DeclaredImportJourneyState,
  outcome: { readonly ok: true } | { readonly ok: false; readonly reason: string },
): DeclaredImportJourneyState {
  if (state.stage !== "confirm") return state;
  return frozen({ ...state, stage: outcome.ok ? "recorded" : "refused" });
}

// ---------------------------------------------------------------------------
// The review projection + the command view (an INTENT, never an execution)
// ---------------------------------------------------------------------------

/** The read-only review projection of the draft (what will be recorded). */
export interface DeclaredImportReviewView {
  readonly deviceId: string;
  readonly adapterFamily: typeof DECLARED_ADAPTER_FAMILY;
  readonly hardware: DeclaredDeviceDraft["hardware"];
  readonly ownership: DeclaredDeviceDraft["ownership"];
  /** The provenance this record will carry — always DECLARED on this journey. */
  readonly provenance: "DECLARED";
  readonly provenanceAcknowledged: boolean;
  readonly duplicates: readonly DeclaredDuplicateFinding[];
  /** A blocking duplicate exists (the import refuses until the id changes). */
  readonly blockingDuplicate: boolean;
  /** A same-serial duplicate exists and is acknowledged. */
  readonly serialAcknowledged: boolean;
  /** Everything the confirm step requires is satisfied. PURE derivation. */
  readonly ready: boolean;
  readonly fieldFailures: readonly DeclaredImportFailure[];
}

/** Project the draft for the review step (with the duplicate report). PURE. */
export function declaredImportReview(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  state: DeclaredImportJourneyState,
): DeclaredImportReviewView {
  const draft = state.draft;
  const fieldFailures = validateDeclaredDeviceDraft(draft);
  const duplicates = reviewDeclaredDeviceDuplicates(scope, source, draft);
  const blockingDuplicate = duplicates.some(isBlockingDuplicate);
  const serialDuplicate = duplicates.some((finding) => finding.kind === "duplicate_serial_number");
  return frozen({
    deviceId: draft.deviceId.trim(),
    adapterFamily: DECLARED_ADAPTER_FAMILY,
    hardware: draft.hardware,
    ownership: draft.ownership,
    provenance: "DECLARED",
    provenanceAcknowledged: draft.provenanceAcknowledged === true,
    duplicates,
    blockingDuplicate,
    serialAcknowledged: !serialDuplicate || draft.duplicateSerialAcknowledged === true,
    ready:
      fieldFailures.length === 0 &&
      !blockingDuplicate &&
      (!serialDuplicate || draft.duplicateSerialAcknowledged === true) &&
      draft.provenanceAcknowledged === true,
    fieldFailures,
  });
}

/** The injected context the command derivation needs (never a clock read). */
export interface DeclaredImportCommandOptions {
  /** The injected declaration instant (ISO 8601). */
  readonly now: string;
  /** The causal-graph correlation id the binding site threads verbatim. */
  readonly correlationId: CorrelationId;
  /** The declaring principal, when a user is acting. */
  readonly declaredBy?: UserId;
}

/**
 * The declared-import COMMAND view: the exact intent descriptor the
 * shell converts into the REAL domain command at the boundary
 * (enrollDevice + createTwin + store.put). The `enrollmentProvenance`
 * block is the DECLARED MARK — the binding site records it VERBATIM, so
 * the record lands marked DECLARED (proven by test over the REAL
 * device-model path). This is a PROPOSAL-shaped value — never an
 * execution, never a twin.
 */
export interface DeclaredImportCommandView {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly adapterFamily: typeof DECLARED_ADAPTER_FAMILY;
  readonly hardware: DeclaredDeviceDraft["hardware"];
  readonly ownership: DeclaredDeviceDraft["ownership"];
  /** The injected declaration instant (recorded as the enrollment instant). */
  readonly declaredAt: string;
  readonly declaredBy: UserId | undefined;
  /**
   * The EXACT enrollment provenance the binding site passes to the REAL
   * `enrollDevice` boundary verbatim — the machine-stable DECLARED mark.
   */
  readonly enrollmentProvenance: {
    readonly correlationId: CorrelationId;
    readonly reason: typeof DECLARED_IMPORT_PROVENANCE_REASON;
    readonly actor:
      | { readonly kind: "user"; readonly userId: UserId }
      | { readonly kind: "system" };
  };
}

/**
 * Derive the command view from a journey whose draft is complete, free
 * of blocking duplicates, and fully acknowledged; `undefined` otherwise
 * (the surface REFUSES to fabricate a command). The duplicate gate is
 * re-evaluated against the injected source — a device id that appeared
 * since the review step refuses the command (fail-closed).
 * PURE and DETERMINISTIC.
 */
export function declaredImportCommand(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  state: DeclaredImportJourneyState,
  options: DeclaredImportCommandOptions,
): DeclaredImportCommandView | undefined {
  if (validateDeclaredDeviceDraft(state.draft).length > 0) return undefined;
  if (state.draft.provenanceAcknowledged !== true) return undefined;
  const duplicates = reviewDeclaredDeviceDuplicates(scope, source, state.draft);
  if (duplicates.some(isBlockingDuplicate)) return undefined;
  const serialDuplicate = duplicates.some((finding) => finding.kind === "duplicate_serial_number");
  if (serialDuplicate && state.draft.duplicateSerialAcknowledged !== true) return undefined;
  if (typeof options?.now !== "string" || options.now.length === 0) return undefined;
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    return undefined;
  }

  const declaredBy =
    typeof options.declaredBy === "string" && options.declaredBy.length > 0
      ? options.declaredBy
      : undefined;

  return frozen({
    tenantId: state.draft.tenantId,
    deviceId: state.draft.deviceId.trim() as DeviceId,
    adapterFamily: DECLARED_ADAPTER_FAMILY,
    hardware: frozen({
      manufacturer: state.draft.hardware.manufacturer.trim(),
      model: state.draft.hardware.model.trim(),
      ...(optionalText(state.draft.hardware.serialNumber) !== undefined
        ? { serialNumber: optionalText(state.draft.hardware.serialNumber) }
        : {}),
      ...(optionalText(state.draft.hardware.assetTag) !== undefined
        ? { assetTag: optionalText(state.draft.hardware.assetTag) }
        : {}),
    }),
    ownership: frozen({
      ownerType: state.draft.ownership.ownerType.trim(),
      ...(optionalText(state.draft.ownership.assignedUserId) !== undefined
        ? { assignedUserId: optionalText(state.draft.ownership.assignedUserId) }
        : {}),
      ...(optionalText(state.draft.ownership.assignedTeam) !== undefined
        ? { assignedTeam: optionalText(state.draft.ownership.assignedTeam) }
        : {}),
    }),
    declaredAt: options.now,
    declaredBy,
    enrollmentProvenance: frozen({
      correlationId: options.correlationId,
      reason: DECLARED_IMPORT_PROVENANCE_REASON,
      actor:
        declaredBy !== undefined
          ? frozen({ kind: "user", userId: declaredBy })
          : frozen({ kind: "system" }),
    }),
  });
}

// ---------------------------------------------------------------------------
// The RECORDED outcome (derived from the twin source — never
// fire-and-forget, and never a silent conflation)
// ---------------------------------------------------------------------------

/** One verification check (machine-stable id + met/unmet state). */
export interface DeclaredImportCheck {
  readonly id: "record_present" | "marked_declared" | "no_fabricated_observations";
  readonly label: string;
  readonly state: "met" | "unmet";
}

/** The evidence block of a verification (present when the twin exists). */
export interface DeclaredImportEvidenceView {
  readonly enrolledAt: string | undefined;
  readonly adapterFamily: string | undefined;
  readonly hardware:
    | {
        readonly manufacturer: string;
        readonly model: string;
        readonly serialNumber?: string;
        readonly assetTag?: string;
      }
    | undefined;
  readonly ownership: { readonly ownerType: string; readonly assignedTeam?: string } | undefined;
  /** The landed record's DERIVED provenance — the mark, made visible. */
  readonly provenance: DeviceRecordProvenance;
  readonly observationCount: number;
  readonly lastObservedAt: string | null | undefined;
  readonly revisionCount: number;
}

/**
 * The verification view-model. `recorded` is the journey's terminal
 * goal. `present_not_declared` is the CONFLATION DETECTOR: the record
 * exists but does not carry the DECLARED mark — the import contract was
 * violated somewhere and the surface says so, never silently showing a
 * declared import as an agent-observed record.
 */
export interface DeclaredImportVerification {
  readonly deviceId: DeviceId;
  readonly status: "unknown_device" | "declared" | "present_not_declared";
  readonly checks: readonly DeclaredImportCheck[];
  readonly evidence: DeclaredImportEvidenceView;
}

const DECLARED_IMPORT_CHECK_LABELS: Readonly<Record<DeclaredImportCheck["id"], string>> = Object.freeze({
  record_present: "Declared record present in your fleet",
  marked_declared: "Record carries the DECLARED provenance mark",
  no_fabricated_observations: "No observations fabricated by the import",
} as const);

/**
 * Verify a declared import against the injected Device Twin source.
 * PURE and DETERMINISTIC: the same (scope, source, deviceId) always
 * produce the same checks + evidence. A device that exists only in
 * another tenant's partition is indistinguishable from an unknown one
 * (`unknown_device` — no existence side channel).
 *
 * The three checks are the journey's definition of an honest DECLARED
 * import:
 *   1. the twin exists (the record is durable);
 *   2. the derived provenance IS DECLARED (the mark landed — an
 *      agent-path record would honestly fail this check);
 *   3. the import fabricated no observations (telemetry still empty —
 *      a real agent checking in later legitimately flips this, at
 *      which point the record is agent-OBSERVED while its ORIGIN stays
 *      DECLARED).
 */
export function verifyDeclaredImport(
  scope: DeviceUiTenantScope,
  source: DeviceTwinSource,
  deviceId: DeviceId,
): DeclaredImportVerification {
  const scopeRecord =
    scope !== null && typeof scope === "object" ? (scope as { tenantId?: unknown }) : null;
  const actingTenant =
    typeof scopeRecord?.tenantId === "string" && scopeRecord.tenantId.length > 0
      ? (scopeRecord.tenantId as TenantId)
      : null;

  const empty: DeclaredImportVerification = frozen({
    deviceId,
    status: "unknown_device",
    checks: frozenArray(
      (Object.keys(DECLARED_IMPORT_CHECK_LABELS) as DeclaredImportCheck["id"][]).map((id) =>
        frozen<DeclaredImportCheck>({ id, label: DECLARED_IMPORT_CHECK_LABELS[id], state: "unmet" }),
      ),
    ),
    evidence: frozen({
      enrolledAt: undefined,
      adapterFamily: undefined,
      hardware: undefined,
      ownership: undefined,
      provenance: "OBSERVED",
      observationCount: 0,
      lastObservedAt: undefined,
      revisionCount: 0,
    }),
  });

  if (actingTenant === null) return empty;
  const twin = source.get(actingTenant, deviceId);
  if (twin === undefined) return empty;

  const provenance = deviceRecordProvenance(twin);
  const checks: readonly DeclaredImportCheck[] = frozenArray([
    frozen<DeclaredImportCheck>({
      id: "record_present",
      label: DECLARED_IMPORT_CHECK_LABELS.record_present,
      state: "met",
    }),
    frozen<DeclaredImportCheck>({
      id: "marked_declared",
      label: DECLARED_IMPORT_CHECK_LABELS.marked_declared,
      state: provenance === "DECLARED" ? "met" : "unmet",
    }),
    frozen<DeclaredImportCheck>({
      id: "no_fabricated_observations",
      label: DECLARED_IMPORT_CHECK_LABELS.no_fabricated_observations,
      state: twin.telemetry.observationCount === 0 && twin.telemetry.lastObservedAt === null
        ? "met"
        : "unmet",
    }),
  ]);

  const status: DeclaredImportVerification["status"] =
    provenance === "DECLARED" ? "declared" : "present_not_declared";

  return frozen({
    deviceId,
    status,
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
      provenance,
      observationCount: twin.telemetry.observationCount,
      lastObservedAt: twin.telemetry.lastObservedAt,
      revisionCount: (twin.revisions ?? []).length,
    }),
  });
}
