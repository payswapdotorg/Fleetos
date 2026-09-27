/**
 * @fleetos/recovery — D2: recovery cases + the typed state machine.
 *
 * A recovery case is opened per device from evidence/triggers:
 *   - a lost/stolen report input (operator evidence — an observable
 *     report, never an inferred intent, per ARCHITECTURE-LOCK item 11);
 *   - a security-posture escalation via the module edge to
 *     `@fleetos/security`'s posture findings. The `recovery -> security`
 *     module-map edge is honored via a STRUCTURAL input shape (the
 *     posture status union + the finding record-id refs) — the ownership
 *     gate forbids importing `@fleetos/security` (worker-b's lane) from
 *     this lane-A package, so the caller injects the security package's
 *     REAL derived values at the binding site (structural typing; proven
 *     by test with `@fleetos/security`'s `assessSecurityPosture` output).
 *
 * The case records the evidence basis: the last-seen record it was
 * opened from (D1) + the posture-finding refs (the security edge).
 *
 * Typed state machine (machine-stable states + closure reasons):
 *
 *   OPENED -> SECURING | ESCALATED | CLOSED
 *   SECURING -> SECURED | ESCALATED | CLOSED
 *   SECURED -> ESCALATED | CLOSED
 *   ESCALATED -> REPLACEMENT_PROPOSED | CLOSED
 *   REPLACEMENT_PROPOSED -> CLOSED
 *   CLOSED -> (terminal)
 *
 * Versioned PROPOSAL-gated transitions: a transition appends a NEW
 * revision (version = prior + 1) with a deterministic content digest —
 * appending never rewrites prior revisions (versioned-interpretation
 * discipline, ARCHITECTURE-LOCK item 3), and a transition that is not in
 * the typed table is refused with a machine-stable DomainError. Every
 * case revision is a PROPOSAL-grade record: nothing in this module
 * executes anything — consequential actions go through the D3 gate.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern): every operation
 * takes the acting `RecoveryTenantScope` FIRST; storage is partitioned
 * per tenant; a foreign case id is indistinguishable from an unknown one.
 *
 * Audit (D5): a case opened emits `recovery.case.opened`; a transition
 * emits `recovery.case.transitioned`. Pure reads never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, CausationId, DeviceId, FleetError, TenantId, UserId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { RecoveryAuditSink } from "./audit-seam";
import { NOOP_RECOVERY_AUDIT_SINK, RECOVERY_AUDIT_ACTIONS } from "./audit-seam";
import {
  ERROR_CODES,
  RECOVERY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { RecoveryTenantScope } from "./internal";
import { checkRecoveryTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// The typed state machine
// ---------------------------------------------------------------------------

export const CASE_OPENED = "OPENED" as const;
export const CASE_SECURING = "SECURING" as const;
export const CASE_SECURED = "SECURED" as const;
export const CASE_ESCALATED = "ESCALATED" as const;
export const CASE_REPLACEMENT_PROPOSED = "REPLACEMENT_PROPOSED" as const;
export const CASE_CLOSED = "CLOSED" as const;

/** The status of a recovery case (machine-stable). */
export type RecoveryCaseStatus =
  | typeof CASE_OPENED
  | typeof CASE_SECURING
  | typeof CASE_SECURED
  | typeof CASE_ESCALATED
  | typeof CASE_REPLACEMENT_PROPOSED
  | typeof CASE_CLOSED;

/**
 * The typed transition table. Each key is a "from" state; each value is
 * the frozen set of states that may legally follow it. `CLOSED` is
 * terminal. The work order's canonical flow — `opened -> securing ->
 * secured / escalated -> replacement-proposed / closed` — plus the
 * documented departures (a case may close from any live state; a secured
 * device may still escalate for replacement when the hardware is
 * damaged).
 */
export const RECOVERY_CASE_TRANSITIONS: Readonly<
  Record<RecoveryCaseStatus, readonly RecoveryCaseStatus[]>
> = Object.freeze({
  [CASE_OPENED]: Object.freeze([CASE_SECURING, CASE_ESCALATED, CASE_CLOSED]),
  [CASE_SECURING]: Object.freeze([CASE_SECURED, CASE_ESCALATED, CASE_CLOSED]),
  [CASE_SECURED]: Object.freeze([CASE_ESCALATED, CASE_CLOSED]),
  [CASE_ESCALATED]: Object.freeze([CASE_REPLACEMENT_PROPOSED, CASE_CLOSED]),
  [CASE_REPLACEMENT_PROPOSED]: Object.freeze([CASE_CLOSED]),
  [CASE_CLOSED]: Object.freeze([]),
});

/** Terminal case statuses (no outgoing transitions). */
export const TERMINAL_RECOVERY_CASE_STATUSES: readonly RecoveryCaseStatus[] = Object.freeze([
  CASE_CLOSED,
]);

/** The statuses an active recovery effort (the D3 gate requires one of these). */
export const ACTIVE_RECOVERY_CASE_STATUSES: readonly RecoveryCaseStatus[] = Object.freeze([
  CASE_OPENED,
  CASE_SECURING,
]);

/**
 * Pure transition predicate. Returns true if `from -> to` is a legal
 * recovery-case transition per `RECOVERY_CASE_TRANSITIONS`.
 *
 * @param from the current status
 * @param to the proposed next status
 * @returns true if the transition is legal
 */
export function canTransitionRecoveryCase(from: RecoveryCaseStatus, to: RecoveryCaseStatus): boolean {
  const allowed = RECOVERY_CASE_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Machine-stable closure reasons
// ---------------------------------------------------------------------------

/**
 * The machine-stable closure reasons. Every CLOSED revision carries
 * exactly one (enforced at the transition boundary).
 */
export type RecoveryClosureReason =
  | "device_recovered"
  | "replacement_proposed"
  | "operator_cancelled"
  | "evidence_stale";

/** All closure reasons (for validation + iteration). */
export const ALL_RECOVERY_CLOSURE_REASONS: readonly RecoveryClosureReason[] = Object.freeze([
  "device_recovered",
  "replacement_proposed",
  "operator_cancelled",
  "evidence_stale",
]);

// ---------------------------------------------------------------------------
// Triggers (the observable inputs that open a case)
// ---------------------------------------------------------------------------

/**
 * The security-posture status union — a STRUCTURAL twin of
 * `@fleetos/security`'s `SecurityPostureStatus` (the `recovery ->
 * security` module-map edge honored via a typed structural shape; the
 * ownership gate forbids the cross-lane import — the binding site
 * injects the security package's real derived value, proven by test).
 */
export type RecoveryPostureStatus = "HEALTHY" | "DEGRADED" | "AT_RISK" | "CRITICAL";

/** All posture statuses (for validation + iteration). */
export const ALL_RECOVERY_POSTURE_STATUSES: readonly RecoveryPostureStatus[] = Object.freeze([
  "HEALTHY",
  "DEGRADED",
  "AT_RISK",
  "CRITICAL",
]);

/**
 * The observable trigger that opens a recovery case. Lost/stolen reports
 * are OPERATOR evidence (a report is an observable fact about the world,
 * not an inferred intent); posture escalations cite the security
 * package's finding record ids (typed refs, never re-derived here).
 */
export type RecoveryTrigger =
  | {
      readonly kind: "lost_report";
      readonly reportedAt: string;
      readonly reportedBy?: UserId;
      readonly note?: string;
    }
  | {
      readonly kind: "stolen_report";
      readonly reportedAt: string;
      readonly reportedBy?: UserId;
      readonly note?: string;
    }
  | {
      readonly kind: "posture_escalation";
      readonly postureStatus: RecoveryPostureStatus;
      /** The `@fleetos/security` finding RECORD ids the escalation cites (typed refs). */
      readonly findingRefs: readonly string[];
      readonly assessedAt: string;
      readonly reportedBy?: UserId;
    };

/** All trigger kinds (for validation + iteration). */
export const ALL_RECOVERY_TRIGGER_KINDS: readonly RecoveryTrigger["kind"][] = Object.freeze([
  "lost_report",
  "stolen_report",
  "posture_escalation",
]);

/**
 * The evidence basis a case records: the last-seen record (D1) it was
 * opened from, and the security posture-finding refs (the module edge).
 * Both are typed REFS — the recovery package never re-derives security
 * or observation state; it cites it.
 */
export interface RecoveryCaseEvidence {
  /** The D1 last-seen record the case was opened from, when evidence existed. */
  readonly lastSeenRecordId?: string;
  /** That record's last-seen instant. */
  readonly lastSeenObservedAt?: string;
  /** The security finding record ids cited (the `recovery -> security` edge). */
  readonly postureFindingRefs: readonly string[];
}

// ---------------------------------------------------------------------------
// The versioned case record
// ---------------------------------------------------------------------------

/**
 * A versioned recovery-case record. Append-only: a transition appends
 * `version = prior + 1`; a prior revision is never rewritten. The case
 * identity (`caseId`) is the deterministic digest of (tenantId,
 * deviceId, trigger kind, openedAt, evidence basis) — stable across
 * revisions, unique per opening (a device may open a NEW case later with
 * a different trigger or instant).
 */
export interface RecoveryCaseRecord extends TenantScoped {
  /** Deterministic case identity: `rc_` + fnv1a32(tenant, device, trigger, openedAt, evidence). */
  readonly caseId: string;
  /** Deterministic revision id: `rcv_` + fnv1a32(caseId, version). */
  readonly recordId: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The append-only revision number (>= 1). */
  readonly version: number;
  /** The case status (OPENED at version 1; transitions append revisions). */
  readonly status: RecoveryCaseStatus;
  /** The observable trigger that opened the case. */
  readonly trigger: RecoveryTrigger;
  /** The evidence basis (last-seen + posture finding refs). */
  readonly evidence: RecoveryCaseEvidence;
  /** The injected opening timestamp. */
  readonly openedAt: string;
  /** The injected transition timestamp (absent on version 1). */
  readonly transitionedAt?: string;
  /** The machine-stable closure reason (present exactly on CLOSED revisions). */
  readonly closureReason?: RecoveryClosureReason;
  /** The injected closing timestamp (present exactly on CLOSED revisions). */
  readonly closedAt?: string;
  /** Canonical digest of the revision's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** The deterministic case identity. */
export function recoveryCaseId(
  tenantId: TenantId,
  deviceId: DeviceId,
  trigger: RecoveryTrigger,
  openedAt: string,
  evidence: RecoveryCaseEvidence,
): string {
  return `rc_${fnv1a32Hex(
    canonicalJson([
      tenantId,
      deviceId,
      trigger.kind,
      openedAt,
      evidence.lastSeenRecordId ?? null,
      evidence.postureFindingRefs,
    ]),
  )}`;
}

/** The deterministic case REVISION id. */
export function recoveryCaseRecordId(caseId: string, version: number): string {
  return `rcv_${fnv1a32Hex(canonicalJson([caseId, version]))}`;
}

/** The canonical content digest of a case revision's content fields. */
export function recoveryCaseContentDigest(
  record: Omit<RecoveryCaseRecord, "caseId" | "recordId" | "contentDigest">,
): string {
  return fnv1a32Hex(
    canonicalJson([
      record.tenantId,
      record.deviceId,
      record.version,
      record.status,
      record.trigger,
      record.evidence,
      record.openedAt,
      record.transitionedAt ?? null,
      record.closureReason ?? null,
      record.closedAt ?? null,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The tenant-partitioned case store
// ---------------------------------------------------------------------------

/** The tagged result of a case-store write. */
export type RecoveryCaseStoreWrite =
  | { readonly ok: true; readonly record: RecoveryCaseRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only recovery-case store. Every operation
 * takes the acting `RecoveryTenantScope` FIRST and touches only the
 * acting tenant's partition. Case revisions are append-only per case id.
 */
export interface RecoveryCaseStore {
  /** Append a case revision into the ACTING tenant's partition (tenant must match). */
  appendCase(scope: RecoveryTenantScope, record: RecoveryCaseRecord): RecoveryCaseStoreWrite;
  /** The LATEST revision of a case (own partition only; undefined when absent/foreign). */
  getLatestCase(scope: RecoveryTenantScope, caseId: string): RecoveryCaseRecord | undefined;
  /** A specific revision of a case (own partition only). */
  getCaseRevision(scope: RecoveryTenantScope, caseId: string, version: number): RecoveryCaseRecord | undefined;
  /** Every revision of a case, version order (own partition only). */
  listCaseRevisions(scope: RecoveryTenantScope, caseId: string): readonly RecoveryCaseRecord[];
  /** All case ids in the acting partition (sorted). */
  listCaseIds(scope: RecoveryTenantScope): readonly string[];
  /** The number of cases in the acting partition. */
  size(scope: RecoveryTenantScope): number;
}

/**
 * Create the in-memory reference `RecoveryCaseStore`. Storage is
 * partitioned by tenant id; case revisions are append-only per case id
 * (the prior is never rewritten — versioned-interpretation discipline).
 *
 * The store audits NOTHING: every consequential case mutation's audit
 * (opened / transitioned) is emitted by the domain boundary functions
 * (`openRecoveryCase`, `transitionRecoveryCase`) through THEIR injected
 * sinks — one coherent emission policy across the recovery package.
 */
export function createInMemoryRecoveryCaseStore(): RecoveryCaseStore {
  /** tenantId -> (caseId -> RecoveryCaseRecord[]). */
  const partitions = new Map<string, Map<string, RecoveryCaseRecord[]>>();

  function partitionOf(tenantId: string): Map<string, RecoveryCaseRecord[]> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, RecoveryCaseRecord[]>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function guarded(
    scope: RecoveryTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkRecoveryTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.caseStoreDomain,
          `recovery case store refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
          "recovery.case.store",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function trace(tenantId: string, correlationId: RecoveryTenantScope["correlationId"]) {
    return {
      tenantId: tenantId as TenantId,
      correlationId: correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
    };
  }

  return frozen({
    appendCase(scope: RecoveryTenantScope, record: RecoveryCaseRecord): RecoveryCaseStoreWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      if (record.tenantId !== tenantId) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.caseStoreDomain,
            "recovery case tenant does not match the acting tenant scope",
            trace(tenantId, scope.correlationId),
            "recovery.case.store",
            "tenant_mismatch",
          ),
        };
      }
      const partition = partitionOf(tenantId);
      let revisions = partition.get(record.caseId);
      if (revisions === undefined) {
        revisions = [];
        partition.set(record.caseId, revisions);
      }
      const existing = revisions.find((r) => r.version === record.version);
      if (existing !== undefined) {
        if (existing.contentDigest === record.contentDigest) {
          return { ok: true, record: existing };
        }
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.caseStoreDomain,
            "case version slot already holds different content (append-only)",
            trace(tenantId, scope.correlationId),
            "recovery.case.store",
            "version_slot_occupied",
          ),
        };
      }
      const expectedVersion =
        revisions.length === 0 ? record.version : revisions[revisions.length - 1].version + 1;
      if (record.version !== expectedVersion) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.caseStoreDomain,
            `case revision version out of sequence (expected ${expectedVersion}, got ${record.version})`,
            trace(tenantId, scope.correlationId),
            "recovery.case.store",
            "version_out_of_sequence",
          ),
        };
      }
      revisions.push(record);
      return { ok: true, record };
    },
    getLatestCase(scope: RecoveryTenantScope, caseId: string): RecoveryCaseRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(caseId);
      if (revisions === undefined || revisions.length === 0) return undefined;
      return revisions[revisions.length - 1];
    },
    getCaseRevision(
      scope: RecoveryTenantScope,
      caseId: string,
      version: number,
    ): RecoveryCaseRecord | undefined {
      const guard = guarded(scope);
      if (!guard.ok) return undefined;
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return undefined;
      const revisions = partition.get(caseId);
      if (revisions === undefined) return undefined;
      return revisions.find((r) => r.version === version);
    },
    listCaseRevisions(scope: RecoveryTenantScope, caseId: string): readonly RecoveryCaseRecord[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      const revisions = partition.get(caseId);
      if (revisions === undefined) return [];
      return Object.freeze([...revisions]);
    },
    listCaseIds(scope: RecoveryTenantScope): readonly string[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const partition = partitions.get(guard.tenantId);
      if (partition === undefined) return [];
      return Object.freeze([...partition.keys()].sort());
    },
    size(scope: RecoveryTenantScope): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      const partition = partitions.get(guard.tenantId);
      return partition?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Opening a case
// ---------------------------------------------------------------------------

/** The input of a case opening. */
export interface OpenRecoveryCaseInput {
  /** The device the case concerns. */
  readonly deviceId: DeviceId;
  /** The observable trigger that opens the case. */
  readonly trigger: RecoveryTrigger;
  /** The D1 last-seen record the case cites, when evidence existed. */
  readonly lastSeenRecordId?: string;
  /** That record's last-seen instant. */
  readonly lastSeenObservedAt?: string;
  /** The security posture-finding record ids cited (the security module edge). */
  readonly postureFindingRefs?: readonly string[];
}

/** Options for `openRecoveryCase`. */
export interface OpenRecoveryCaseOptions {
  /** The injected opening instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the opening request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the opening is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the opening emits; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
}

/** Validate a trigger (returns null on success; failure list otherwise). */
export function validateRecoveryTrigger(
  trigger: unknown,
  path: string,
): { path: string; reason: string }[] | null {
  const failures: { path: string; reason: string }[] = [];
  if (trigger === null || typeof trigger !== "object") {
    return [{ path, reason: "object_required" }];
  }
  const candidate = trigger as Record<string, unknown>;
  const kind = candidate["kind"];
  if (typeof kind !== "string" || !(ALL_RECOVERY_TRIGGER_KINDS as readonly string[]).includes(kind)) {
    return [{ path: `${path}/kind`, reason: "unknown_trigger_kind" }];
  }
  if (kind === "posture_escalation") {
    const status = candidate["postureStatus"];
    if (
      typeof status !== "string" ||
      !(ALL_RECOVERY_POSTURE_STATUSES as readonly string[]).includes(status)
    ) {
      failures.push({ path: `${path}/postureStatus`, reason: "unknown_posture_status" });
    }
    const refs = candidate["findingRefs"];
    if (!Array.isArray(refs) || !refs.every((r) => typeof r === "string" && r.length > 0)) {
      failures.push({ path: `${path}/findingRefs`, reason: "string_array_required" });
    }
    const assessedAt = candidate["assessedAt"];
    if (typeof assessedAt !== "string" || !looksLikeIso(assessedAt)) {
      failures.push({ path: `${path}/assessedAt`, reason: "not_iso" });
    }
  } else {
    const reportedAt = candidate["reportedAt"];
    if (typeof reportedAt !== "string" || !looksLikeIso(reportedAt)) {
      failures.push({ path: `${path}/reportedAt`, reason: "not_iso" });
    }
  }
  return failures.length === 0 ? null : failures;
}

/**
 * Open a recovery case per device from an evidence/triggers input.
 * DETERMINISTIC: the case identity + revision content are pure functions
 * of (tenant, device, trigger, openedAt, evidence basis) — re-opening
 * from the same inputs yields the same case id and a byte-identical
 * version-1 record. The opening appends revision 1 (status OPENED) into
 * the ACTING tenant's partition and audits `recovery.case.opened`.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the recovery-case store
 * @param input the opening input
 * @param options the injected options
 * @returns the tagged write result
 */
export function openRecoveryCase(
  scope: RecoveryTenantScope,
  store: RecoveryCaseStore,
  input: OpenRecoveryCaseInput,
  options: OpenRecoveryCaseOptions,
): RecoveryCaseStoreWrite {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.caseStoreDomain,
        `recovery case store refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
        "recovery.case.store",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
  };
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.deviceId !== "string" || input.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  const triggerFailures = validateRecoveryTrigger(input?.trigger, "/trigger");
  if (triggerFailures !== null) failures.push(...triggerFailures);
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (input?.postureFindingRefs !== undefined) {
    if (
      !Array.isArray(input.postureFindingRefs) ||
      !input.postureFindingRefs.every((r) => typeof r === "string" && r.length > 0)
    ) {
      failures.push({ path: "/postureFindingRefs", reason: "string_array_required" });
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(ERROR_CODES.caseInvalid, "recovery case opening is invalid", trace, failures),
    };
  }
  const evidence: RecoveryCaseEvidence = frozen({
    ...(input.lastSeenRecordId !== undefined ? { lastSeenRecordId: input.lastSeenRecordId } : {}),
    ...(input.lastSeenObservedAt !== undefined ? { lastSeenObservedAt: input.lastSeenObservedAt } : {}),
    postureFindingRefs: Object.freeze([...(input.postureFindingRefs ?? [])]),
  });
  const caseId = recoveryCaseId(guard.tenantId, input.deviceId, input.trigger, options.at, evidence);
  const content: Omit<RecoveryCaseRecord, "caseId" | "recordId" | "contentDigest"> = frozen({
    tenantId: guard.tenantId,
    deviceId: input.deviceId,
    version: 1,
    status: CASE_OPENED,
    trigger: input.trigger,
    evidence,
    openedAt: options.at,
  });
  const record: RecoveryCaseRecord = frozen({
    ...content,
    caseId,
    recordId: recoveryCaseRecordId(caseId, 1),
    contentDigest: recoveryCaseContentDigest(content),
  });
  const write = store.appendCase(scope, record);
  if (!write.ok) return write;
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.caseOpened,
      tenantId: record.tenantId,
      subject: record.caseId,
      occurredAt: record.openedAt,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        caseId: record.caseId,
        deviceId: record.deviceId as string,
        triggerKind: record.trigger.kind,
        status: record.status,
        lastSeenRecordId: record.evidence.lastSeenRecordId ?? null,
        postureFindingRefs: record.evidence.postureFindingRefs,
        contentDigest: record.contentDigest,
      }),
    }),
  );
  return write;
}

// ---------------------------------------------------------------------------
// Transitioning a case (versioned, proposal-gated)
// ---------------------------------------------------------------------------

/** Options for `transitionRecoveryCase`. */
export interface TransitionRecoveryCaseOptions {
  /** The injected transition instant (ISO 8601). */
  readonly at: string;
  /** The correlation id of the transition request. */
  readonly correlationId: CorrelationId;
  /** The machine-stable closure reason (required exactly when target is CLOSED). */
  readonly closureReason?: RecoveryClosureReason;
  /** The causation id, when the transition is caused by a specific command/event. */
  readonly causationId?: CausationId;
  /** The injected audit sink (the transition emits; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
}

/** The tagged result of a case transition. */
export type RecoveryCaseTransition =
  | { readonly ok: true; readonly record: RecoveryCaseRecord }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Transition a recovery case: append a NEW revision (version = prior + 1)
 * with the target status. PROPOSAL-gated by the typed transition table —
 * an illegal transition is refused with a machine-stable DomainError
 * (never a silent no-op, never a rewrite of the prior revision). Closing
 * requires a machine-stable closure reason (enforced).
 *
 * Audit: the transition emits `recovery.case.transitioned` to the
 * injected sink.
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param store the recovery-case store
 * @param prior the prior case revision (LATEST, from the acting partition)
 * @param target the target status
 * @param options the injected options
 * @returns the tagged transition result
 */
export function transitionRecoveryCase(
  scope: RecoveryTenantScope,
  store: RecoveryCaseStore,
  prior: RecoveryCaseRecord,
  target: RecoveryCaseStatus,
  options: TransitionRecoveryCaseOptions,
): RecoveryCaseTransition {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.caseStoreDomain,
        `recovery case store refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: RECOVERY_PIPELINE_CORRELATION_ID },
        "recovery.case.store",
        guard.reason,
      ),
    };
  }
  const trace = {
    tenantId: guard.tenantId,
    correlationId: options.correlationId ?? RECOVERY_PIPELINE_CORRELATION_ID,
  };
  const failures: { path: string; reason: string }[] = [];
  if (typeof options?.at !== "string" || !looksLikeIso(options.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (typeof options?.correlationId !== "string" || options.correlationId.length === 0) {
    failures.push({ path: "/correlationId", reason: "required" });
  }
  if (target === CASE_CLOSED) {
    if (
      options?.closureReason === undefined ||
      !(ALL_RECOVERY_CLOSURE_REASONS as readonly string[]).includes(options.closureReason)
    ) {
      failures.push({ path: "/closureReason", reason: "closure_reason_required" });
    }
  } else if (options?.closureReason !== undefined) {
    failures.push({ path: "/closureReason", reason: "closure_reason_only_on_close" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.caseInvalid,
        "recovery case transition request is invalid",
        trace,
        failures,
      ),
    };
  }
  if (prior.tenantId !== guard.tenantId) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.caseStoreDomain,
        "recovery case tenant does not match the acting tenant scope",
        trace,
        "recovery.case.transition",
        "tenant_mismatch",
      ),
    };
  }
  if (!canTransitionRecoveryCase(prior.status, target)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.caseTransitionIllegal,
        `recovery case transition ${prior.status} -> ${target} is not legal`,
        trace,
        "recovery.case.transition",
        "illegal_transition",
      ),
    };
  }
  const version = prior.version + 1;
  const content: Omit<RecoveryCaseRecord, "caseId" | "recordId" | "contentDigest"> = frozen({
    tenantId: prior.tenantId,
    deviceId: prior.deviceId,
    version,
    status: target,
    trigger: prior.trigger,
    evidence: prior.evidence,
    openedAt: prior.openedAt,
    transitionedAt: options.at,
    ...(target === CASE_CLOSED
      ? { closureReason: options.closureReason as RecoveryClosureReason, closedAt: options.at }
      : {}),
  });
  const record: RecoveryCaseRecord = frozen({
    ...content,
    caseId: prior.caseId,
    recordId: recoveryCaseRecordId(prior.caseId, version),
    contentDigest: recoveryCaseContentDigest(content),
  });
  const write = store.appendCase(scope, record);
  if (!write.ok) return write;
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  sink.append(
    frozen({
      action: RECOVERY_AUDIT_ACTIONS.caseTransitioned,
      tenantId: record.tenantId,
      subject: record.caseId,
      occurredAt: options.at,
      correlationId: trace.correlationId,
      causationId: options.causationId,
      details: frozen({
        caseId: record.caseId,
        deviceId: record.deviceId as string,
        version: record.version,
        from: prior.status,
        to: target,
        closureReason: record.closureReason ?? null,
        contentDigest: record.contentDigest,
      }),
    }),
  );
  return { ok: true, record };
}
