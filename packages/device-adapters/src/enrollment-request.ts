/**
 * @fleetos/device-adapters — W100A: the enrollment-request flow (the
 * install contract's one-time bootstrap code).
 *
 * spec/install/INSTALL-AND-ENROLLMENT-CONTRACT.md: "An enrollment
 * request is tenant-bound, scope-bound, one-time, short-lived,
 * revocable, auditable. The server stores only the necessary
 * verifier/hash material for bootstrap credentials."
 *
 * This module is a NEW ADDITIVE policy/store module riding the W071
 * enrollment-security lane (ownership classes + audit sink reused, not
 * duplicated):
 *
 *   - **Ownership kinds.** The install contract's four UI distinctions
 *     (`corporate-owned | leased | BYOD | third-party managed`) as a
 *     presentation taxonomy that MAPS onto the frozen W071 ownership
 *     classes (`corporate | managed | byod`). The mapping is total and
 *     deterministic; the domain classes remain the W071 three.
 *   - **Verifier-only storage.** `createEnrollmentRequest` consumes the
 *     one-time bootstrap CODE and returns it exactly once for display;
 *     the persisted record carries ONLY the code verifier (a
 * deterministic digest over tenant + code). The code itself is never
 * stored, never logged, never echoed by the store.
 *   - **One-time redemption.** `redeem` marks the request fulfilled on
 *     first success; a second redemption is refused
 *     `code_already_used`. Expired requests refuse `code_expired`;
 *     revoked requests refuse `code_revoked`; an unknown request OR a
 *     code mismatch OR a foreign tenant's request all refuse
 *     `code_not_found` (indistinguishable — no existence side channel
 *     across tenants).
 *   - **Fail-closed refusals.** The redemption refusal taxonomy is the
 *     install contract's failure list, machine-stable, each with a
 *     human explanation carried alongside (the UI renders both
 *     verbatim): `code_expired` / `code_already_used` /
 *     `code_revoked` / `code_not_found` / `device_already_enrolled` /
 *     `tenant_role_mismatch` / `enrollment_refused_by_policy`.
 *   - **Auditable.** Every fulfilled redemption, refusal, revocation
 *     and observed expiry emits through the injected
 *     `EnrollmentAuditSink` (the W071 seam reused verbatim).
 *
 * After bootstrap the agent receives a device-scoped trust record (a
 * `SessionToken` — the frozen check-in shape) through this boundary;
 * nothing here creates a second authorization system (LOCK: agents are
 * untrusted and tenant-scoped; the trust record is the check-in
 * session layer's existing credential).
 *
 * PURE + DETERMINISTIC: no clock (instants injected), no entropy (the
 * caller supplies the code), no I/O. No `any` in public signatures.
 */

import type { CorrelationId, DeviceId, TenantId, TenantScoped } from "@fleetos/contracts";
import { frozen, frozenArray, canonicalJson, fnv1a32Hex } from "./internal";
import {
  isDeviceOwnershipClass,
  NOOP_ENROLLMENT_AUDIT_SINK,
  type DeviceOwnershipClass,
  type EnrollmentAuditSink,
} from "./enrollment-security";
import type { SessionToken } from "./checkin";

// ---------------------------------------------------------------------------
// W100A.1 — Ownership kinds (the install contract's four UI distinctions)
// ---------------------------------------------------------------------------

/**
 * The install contract's four ownership distinctions: corporate-owned,
 * leased, BYOD, third-party managed. A presentation taxonomy that maps
 * onto the frozen W071 ownership classes.
 */
export type DeviceOwnershipKind =
  | "corporate_owned"
  | "leased"
  | "byod"
  | "third_party_managed";

/** All ownership kinds in canonical (display) order. */
export const ALL_DEVICE_OWNERSHIP_KINDS: readonly DeviceOwnershipKind[] = frozenArray([
  "corporate_owned",
  "leased",
  "byod",
  "third_party_managed",
]);

/** Human labels for the ownership kinds (rendered verbatim by the UI). */
export const DEVICE_OWNERSHIP_KIND_LABELS: Readonly<
  Record<DeviceOwnershipKind, string>
> = Object.freeze({
  corporate_owned: "Corporate-owned",
  leased: "Leased",
  byod: "BYOD (bring your own device)",
  third_party_managed: "Third-party managed",
} as const);

/** Is the value one of the four ownership kinds? */
export function isDeviceOwnershipKind(value: unknown): value is DeviceOwnershipKind {
  return (
    value === "corporate_owned" ||
    value === "leased" ||
    value === "byod" ||
    value === "third_party_managed"
  );
}

/**
 * Map an ownership kind onto the frozen W071 ownership class.
 * Total + deterministic:
 *   - corporate-owned and leased assets are `corporate`;
 *   - BYOD is `byod` (the conservative, purpose-bound scope);
 *   - third-party managed devices are `managed`.
 */
export function ownershipClassOfKind(kind: DeviceOwnershipKind): DeviceOwnershipClass {
  switch (kind) {
    case "corporate_owned":
    case "leased":
      return "corporate";
    case "byod":
      return "byod";
    case "third_party_managed":
      return "managed";
  }
}

// ---------------------------------------------------------------------------
// W100A.2 — The refusal taxonomy (machine-stable + human explanation)
// ---------------------------------------------------------------------------

/**
 * The machine-stable refusal reasons for enrollment-request flows.
 * The install contract's failure list, closed and frozen by this
 * module: every refusal carries its reason AND its human explanation;
 * the UI renders both verbatim (never re-derived).
 */
export const ENROLLMENT_REQUEST_REFUSAL_REASONS = frozenArray([
  "code_expired",
  "code_already_used",
  "code_revoked",
  "code_not_found",
  "device_already_enrolled",
  "tenant_role_mismatch",
  "enrollment_refused_by_policy",
] as const);

export type EnrollmentRequestRefusalReason =
  (typeof ENROLLMENT_REQUEST_REFUSAL_REASONS)[number];

/** All reasons in canonical order. */
export const ALL_ENROLLMENT_REQUEST_REFUSAL_REASONS: readonly EnrollmentRequestRefusalReason[] =
  ENROLLMENT_REQUEST_REFUSAL_REASONS;

/**
 * The human explanation for each refusal reason — the install
 * contract's "Every refusal has a machine-stable reason and a human
 * explanation."
 */
export const ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS: Readonly<
  Record<EnrollmentRequestRefusalReason, string>
> = Object.freeze({
  code_expired:
    "This enrollment code has expired. Create a new enrollment request from the install center and try again.",
  code_already_used:
    "This enrollment code was already used. Enrollment codes are one-time; create a new request for the next device.",
  code_revoked:
    "This enrollment code was revoked by an operator. Create a new enrollment request if this device should enroll.",
  code_not_found:
    "This enrollment code is not valid for your workspace. Check the code and workspace, then try again.",
  device_already_enrolled:
    "This device is already enrolled in your fleet. Renew its session from the device instead of enrolling it again.",
  tenant_role_mismatch:
    "Your current role is not permitted to use this enrollment code. Ask a workspace operator to enroll this device.",
  enrollment_refused_by_policy:
    "Enrollment was refused by policy for this device in this workspace. Review the enrollment policy with your operator.",
} as const);

/** One enrollment-request refusal: machine-stable reason + human explanation. */
export interface EnrollmentRequestRefusal {
  /** The machine-stable refusal reason (rendered verbatim). */
  readonly reason: EnrollmentRequestRefusalReason;
  /** The human explanation (rendered verbatim, never re-derived). */
  readonly explanation: string;
  /** ISO 8601 instant the refusal was observed (injected). */
  readonly occurredAt: string;
  /** The correlation id of the refused attempt, when supplied. */
  readonly correlationId?: CorrelationId;
}

// ---------------------------------------------------------------------------
// W100A.3 — The enrollment request record (verifier-only storage)
// ---------------------------------------------------------------------------

/** The lifecycle status of an enrollment request. */
export type EnrollmentRequestStatus = "pending" | "fulfilled" | "revoked" | "expired";

/**
 * The enrollment request record. Tenant-bound (LOCK: tenant isolation),
 * scope-bound (ownership kind + optional enroller roles), one-time
 * (fulfilled is terminal), short-lived (expiresAt), revocable
 * (revoked is terminal).
 *
 * ONLY the code VERIFIER is stored — the one-time bootstrap code
 * itself is never persisted here (the install contract's
 * verifier/hash-material rule).
 */
export interface EnrollmentRequestRecord extends TenantScoped {
  /** Stable request identifier (allocated by the caller). */
  readonly requestId: string;
  /** The device the request is intended for, when pre-assigned. */
  readonly deviceId?: DeviceId;
  /** The ownership kind (the install contract's four distinctions). */
  readonly ownershipKind: DeviceOwnershipKind;
  /** The frozen W071 ownership class the kind maps onto. */
  readonly ownershipClass: DeviceOwnershipClass;
  /** Roles permitted to redeem this code (empty = any role in the tenant). */
  readonly allowedRoles: readonly string[];
  /** ISO 8601 creation instant (injected). */
  readonly createdAt: string;
  /** ISO 8601 expiry instant (createdAt + ttl; injected by the caller). */
  readonly expiresAt: string;
  /** The recorded lifecycle status. */
  readonly status: EnrollmentRequestStatus;
  /** The bootstrap-code VERIFIER (digest over tenant + code — never the code). */
  readonly codeVerifier: string;
  /** ISO 8601 fulfillment instant, when fulfilled. */
  readonly fulfilledAt?: string;
  /** The device that redeemed the code, when fulfilled. */
  readonly fulfilledDeviceId?: DeviceId;
  /** ISO 8601 revocation instant, when revoked. */
  readonly revokedAt?: string;
  /** The operator-supplied revocation reason, when revoked. */
  readonly revokedReason?: string;
  /** The correlation id of the creation attempt, when supplied. */
  readonly correlationId?: CorrelationId;
}

/** Inputs for `createEnrollmentRequest`. Every instant is INJECTED. */
export interface CreateEnrollmentRequestInputs {
  readonly tenantId: TenantId;
  /** Stable request identifier (non-empty). */
  readonly requestId: string;
  /** The one-time bootstrap code (non-empty, >= 8 chars). Returned once. */
  readonly code: string;
  /** The ownership kind for the enrolling device. */
  readonly ownershipKind: DeviceOwnershipKind;
  /** Roles permitted to redeem (empty = any role in the tenant). */
  readonly allowedRoles?: readonly string[];
  /** Time-to-live in milliseconds (> 0). */
  readonly ttlMs: number;
  /** The creation instant (ISO 8601, injected). */
  readonly now: string;
  /** The device the request is intended for, when pre-assigned. */
  readonly deviceId?: DeviceId;
  /** The creation correlation id, when supplied. */
  readonly correlationId?: CorrelationId;
}

/** The creation result: the record + the code, echoed exactly once. */
export type EnrollmentRequestCreation =
  | { readonly ok: true; readonly record: EnrollmentRequestRecord; readonly code: string }
  | { readonly ok: false; readonly error: { readonly path: string; readonly reason: string } };

/**
 * The deterministic bootstrap-code verifier: a digest over the
 * tenant-scoped code. The store persists ONLY this value — the code
 * itself never reaches a record, a log line, or an audit entry.
 */
export function bootstrapCodeVerifier(tenantId: TenantId, code: string): string {
  return fnv1a32Hex(canonicalJson({ code, tenantId: tenantId as string }));
}

/**
 * Create an enrollment request. PURE: the caller supplies the code and
 * every instant; the record stores only the code VERIFIER. The CODE is
 * returned exactly once for one-time display (the install center shows
 * it, the operator copies it, the agent redeems it — nothing persists
 * it).
 */
export function createEnrollmentRequest(
  inputs: CreateEnrollmentRequestInputs,
): EnrollmentRequestCreation {
  if (typeof inputs?.requestId !== "string" || inputs.requestId.trim().length === 0) {
    return { ok: false, error: { path: "/requestId", reason: "required" } };
  }
  if (typeof inputs?.code !== "string" || inputs.code.trim().length < 8) {
    return { ok: false, error: { path: "/code", reason: "min_length_8" } };
  }
  if (!isDeviceOwnershipKind(inputs?.ownershipKind)) {
    return { ok: false, error: { path: "/ownershipKind", reason: "unknown_ownership_kind" } };
  }
  if (!Number.isFinite(inputs?.ttlMs) || inputs.ttlMs <= 0) {
    return { ok: false, error: { path: "/ttlMs", reason: "positive_required" } };
  }
  if (typeof inputs?.now !== "string" || !Number.isFinite(Date.parse(inputs.now))) {
    return { ok: false, error: { path: "/now", reason: "not_iso" } };
  }
  const createdAtMs = Date.parse(inputs.now);
  const expiresAt = new Date(createdAtMs + inputs.ttlMs).toISOString();

  const record: EnrollmentRequestRecord = frozen({
    tenantId: inputs.tenantId,
    requestId: inputs.requestId,
    ...(inputs.deviceId !== undefined ? { deviceId: inputs.deviceId } : {}),
    ownershipKind: inputs.ownershipKind,
    ownershipClass: ownershipClassOfKind(inputs.ownershipKind),
    allowedRoles: frozenArray([...(inputs.allowedRoles ?? [])]),
    createdAt: inputs.now,
    expiresAt,
    status: "pending",
    codeVerifier: bootstrapCodeVerifier(inputs.tenantId, inputs.code),
    ...(inputs.correlationId !== undefined ? { correlationId: inputs.correlationId } : {}),
  });
  return { ok: true, record, code: inputs.code };
}

/**
 * The DERIVED lifecycle status of a record at an injected instant
 * (a pending request past its expiry reads `expired` even before the
 * store observes it). PURE.
 */
export function enrollmentRequestStatusAt(
  record: EnrollmentRequestRecord,
  now: string,
): EnrollmentRequestStatus {
  if (record.status === "revoked" || record.status === "fulfilled") return record.status;
  if (Date.parse(now) > Date.parse(record.expiresAt)) return "expired";
  return "pending";
}

// ---------------------------------------------------------------------------
// W100A.4 — The issued trust record (device-scoped, via the session layer)
// ---------------------------------------------------------------------------

/**
 * The device-scoped trust record issued on a successful bootstrap
 * redemption: a frozen `SessionToken` (the check-in session layer's
 * existing credential — NOT a second authorization system). Opaque to
 * the agent; the control plane is its sole validator.
 */
export interface BootstrapTrustRecord extends TenantScoped {
  /** The device this trust record is scoped to. */
  readonly deviceId: DeviceId;
  /** The session token issued for the device's first check-in. */
  readonly sessionToken: SessionToken;
  /** ISO 8601 issuance instant (injected). */
  readonly issuedAt: string;
  /** The enrollment request that was redeemed. */
  readonly enrollmentRequestId: string;
}

// ---------------------------------------------------------------------------
// W100A.5 — The store (tenant-partitioned, one-time redemption)
// ---------------------------------------------------------------------------

/** The acting tenant scope for enrollment-request operations. */
export interface EnrollmentRequestScope {
  readonly tenantId: TenantId;
  readonly correlationId?: CorrelationId;
}

/** The redemption presentation (what the agent presents at bootstrap). */
export interface EnrollmentRedemptionPresentation {
  /** The request being redeemed. */
  readonly requestId: string;
  /** The one-time bootstrap code. */
  readonly code: string;
  /** The device redeeming the code. */
  readonly deviceId: DeviceId;
  /** The presenter's role, when the control plane knows it. */
  readonly presenterRole?: string;
  /**
   * Control-plane policy inputs (the boundary decides; the store never
   * re-derives authority): `deviceAlreadyEnrolled` when the device is
   * known enrolled; `enrollmentAllowed: false` when enrollment policy
   * refuses this device. Both default to permissive — the POLICY layer
   * stays at the binding site.
   */
  readonly policy?: {
    readonly deviceAlreadyEnrolled?: boolean;
    readonly enrollmentAllowed?: boolean;
  };
}

/** The redemption result: the issued trust record or a machine-stable refusal. */
export type EnrollmentRedemptionResult =
  | { readonly ok: true; readonly trust: BootstrapTrustRecord }
  | { readonly ok: false; readonly refusal: EnrollmentRequestRefusal };

/** Options for store operations that emit audit records. */
export interface EnrollmentRequestStoreOptions {
  /** The injected audit sink (default: no-op — records are NOT dropped silently by default sinks in deployments that inject one). */
  readonly auditSink?: EnrollmentAuditSink;
}

/**
 * The tenant-partitioned enrollment-request store. Every operation
 * takes the acting scope FIRST and touches only the acting tenant's
 * partition; a request created in tenant A is INVISIBLE to tenant B
 * (reads and redemptions both refuse `code_not_found` — no existence
 * side channel).
 */
export interface EnrollmentRequestStore {
  /** Insert a created request into the acting partition (duplicate requestId refused). */
  put(
    scope: EnrollmentRequestScope,
    record: EnrollmentRequestRecord,
    options?: EnrollmentRequestStoreOptions,
  ): { readonly ok: true } | { readonly ok: false; readonly error: { readonly path: string; readonly reason: string } };
  /** Fetch a request by id (own partition only). */
  get(scope: EnrollmentRequestScope, requestId: string): EnrollmentRequestRecord | undefined;
  /** All requests in the acting partition (sorted by createdAt, then requestId). */
  list(scope: EnrollmentRequestScope): readonly EnrollmentRequestRecord[];
  /** Revoke a pending request (terminal; audited). */
  revoke(
    scope: EnrollmentRequestScope,
    requestId: string,
    reason: string,
    at: string,
    options?: EnrollmentRequestStoreOptions,
  ): { readonly ok: true; readonly record: EnrollmentRequestRecord } | { readonly ok: false; readonly error: { readonly path: string; readonly reason: string } };
  /** Redeem a bootstrap code (one-time; audited on success AND refusal). */
  redeem(
    scope: EnrollmentRequestScope,
    presentation: EnrollmentRedemptionPresentation,
    at: string,
    options?: EnrollmentRequestStoreOptions,
  ): EnrollmentRedemptionResult;
}

/**
 * Stable machine action names emitted by the enrollment-request store.
 * Emission policy (the W071 judgment call, reused): every FULFILLED
 * redemption, every REFUSAL, every REVOCATION and every OBSERVED
 * EXPIRY emits; pure reads never do.
 */
export const ENROLLMENT_REQUEST_AUDIT_ACTIONS = frozen({
  created: "enrollment.request.created",
  fulfilled: "enrollment.request.fulfilled",
  refused: "enrollment.request.refused",
  revoked: "enrollment.request.revoked",
  expired: "enrollment.request.expired",
} as const);

/**
 * Create the in-memory reference enrollment-request store. Storage is
 * partitioned by tenant id; redemption is one-time (the fulfilled
 * transition is recorded atomically with the trust issuance — a second
 * redemption of the same code reads the fulfilled record and refuses).
 *
 * The issued session token is a DETERMINISTIC digest over the request
 * + device + instant (opaque to the agent, validated only by the
 * control plane; deployments substitute their transport at the seam).
 */
export function createInMemoryEnrollmentRequestStore(): EnrollmentRequestStore {
  /** tenantId -> (requestId -> record). */
  const partitions = new Map<string, Map<string, EnrollmentRequestRecord>>();

  function partitionOf(tenantId: string): Map<string, EnrollmentRequestRecord> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, EnrollmentRequestRecord>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function refusal(
    reason: EnrollmentRequestRefusalReason,
    at: string,
    correlationId?: CorrelationId,
  ): EnrollmentRequestRefusal {
    return frozen({
      reason,
      explanation: ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS[reason],
      occurredAt: at,
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
  }

  function emit(
    sink: EnrollmentAuditSink | undefined,
    tenantId: TenantId,
    action: string,
    subject: string | null,
    at: string,
    correlationId: CorrelationId,
    details: Readonly<Record<string, unknown>>,
  ): void {
    (sink ?? NOOP_ENROLLMENT_AUDIT_SINK).append(
      frozen({
        tenantId,
        action,
        subject,
        occurredAt: at,
        correlationId,
        details,
      }),
    );
  }

  return frozen({
    put(
      scope: EnrollmentRequestScope,
      record: EnrollmentRequestRecord,
      options?: EnrollmentRequestStoreOptions,
    ): { readonly ok: true } | { readonly ok: false; readonly error: { readonly path: string; readonly reason: string } } {
      const partition = partitionOf(scope.tenantId as string);
      if (partition.has(record.requestId)) {
        return { ok: false, error: { path: "/requestId", reason: "duplicate_request" } };
      }
      partition.set(record.requestId, record);
      emit(
        options?.auditSink,
        scope.tenantId,
        ENROLLMENT_REQUEST_AUDIT_ACTIONS.created,
        record.requestId,
        record.createdAt,
        scope.correlationId ?? ("" as CorrelationId),
        frozen({
          ownershipKind: record.ownershipKind,
          ownershipClass: record.ownershipClass,
          expiresAt: record.expiresAt,
          allowedRoles: record.allowedRoles,
        }),
      );
      return { ok: true };
    },

    get(scope: EnrollmentRequestScope, requestId: string): EnrollmentRequestRecord | undefined {
      return partitionOf(scope.tenantId as string).get(requestId);
    },

    list(scope: EnrollmentRequestScope): readonly EnrollmentRequestRecord[] {
      const all = [...partitionOf(scope.tenantId as string).values()];
      all.sort(
        (a, b) =>
          compareIso(a.createdAt, b.createdAt) || compareStrings(a.requestId, b.requestId),
      );
      return frozenArray(all);
    },

    revoke(
      scope: EnrollmentRequestScope,
      requestId: string,
      reason: string,
      at: string,
      options?: EnrollmentRequestStoreOptions,
    ): { readonly ok: true; readonly record: EnrollmentRequestRecord } | { readonly ok: false; readonly error: { readonly path: string; readonly reason: string } } {
      const partition = partitionOf(scope.tenantId as string);
      const record = partition.get(requestId);
      if (record === undefined) {
        return { ok: false, error: { path: "/requestId", reason: "not_found" } };
      }
      if (record.status !== "pending") {
        return { ok: false, error: { path: "/status", reason: "not_pending" } };
      }
      const revoked: EnrollmentRequestRecord = frozen({
        ...record,
        status: "revoked",
        revokedAt: at,
        revokedReason: reason,
      });
      partition.set(requestId, revoked);
      emit(
        options?.auditSink,
        scope.tenantId,
        ENROLLMENT_REQUEST_AUDIT_ACTIONS.revoked,
        requestId,
        at,
        scope.correlationId ?? ("" as CorrelationId),
        frozen({ reason }),
      );
      return { ok: true, record: revoked };
    },

    redeem(
      scope: EnrollmentRequestScope,
      presentation: EnrollmentRedemptionPresentation,
      at: string,
      options?: EnrollmentRequestStoreOptions,
    ): EnrollmentRedemptionResult {
      const correlationId: CorrelationId = scope.correlationId ?? ("" as CorrelationId);
      const partition = partitionOf(scope.tenantId as string);
      const record = partition.get(presentation.requestId);

      // Unknown request OR code mismatch => the SAME refusal — no
      // existence side channel, and the verifier check keeps a leaked
      // request id from becoming an oracle.
      if (
        record === undefined ||
        record.codeVerifier !== bootstrapCodeVerifier(scope.tenantId, presentation.code)
      ) {
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
          presentation.requestId,
          at,
          correlationId,
          frozen({ reason: "code_not_found", deviceId: presentation.deviceId as string }),
        );
        return { ok: false, refusal: refusal("code_not_found", at, scope.correlationId) };
      }

      if (record.status === "revoked") {
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
          presentation.requestId,
          at,
          correlationId,
          frozen({ reason: "code_revoked", deviceId: presentation.deviceId as string }),
        );
        return { ok: false, refusal: refusal("code_revoked", at, scope.correlationId) };
      }

      if (record.status === "fulfilled") {
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
          presentation.requestId,
          at,
          correlationId,
          frozen({ reason: "code_already_used", deviceId: presentation.deviceId as string }),
        );
        return { ok: false, refusal: refusal("code_already_used", at, scope.correlationId) };
      }

      if (Date.parse(at) > Date.parse(record.expiresAt)) {
        // Lazily observe the expiry: the record transitions to expired
        // and the observation is audited (short-lived is a first-class
        // state, not just a read-time derivation).
        const expired: EnrollmentRequestRecord = frozen({ ...record, status: "expired" });
        partition.set(record.requestId, expired);
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.expired,
          record.requestId,
          at,
          correlationId,
          frozen({ expiresAt: record.expiresAt }),
        );
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
          presentation.requestId,
          at,
          correlationId,
          frozen({ reason: "code_expired", deviceId: presentation.deviceId as string }),
        );
        return { ok: false, refusal: refusal("code_expired", at, scope.correlationId) };
      }

      // Scope binding: when the request restricts enroller roles, the
      // presenter MUST carry one of them (fail-closed: no role
      // presented + restricted request => mismatch). The authority
      // itself lives at the boundary (the shell injects the real role);
      // this layer only ENFORCES the request's recorded scope.
      if (
        record.allowedRoles.length > 0 &&
        (presentation.presenterRole === undefined ||
          !record.allowedRoles.includes(presentation.presenterRole))
      ) {
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
          presentation.requestId,
          at,
          correlationId,
          frozen({
            reason: "tenant_role_mismatch",
            deviceId: presentation.deviceId as string,
            presenterRole: presentation.presenterRole ?? null,
          }),
        );
        return { ok: false, refusal: refusal("tenant_role_mismatch", at, scope.correlationId) };
      }

      // Control-plane policy inputs (the boundary decides; the store
      // never re-derives device state or enrollment policy).
      if (presentation.policy?.deviceAlreadyEnrolled === true) {
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
          presentation.requestId,
          at,
          correlationId,
          frozen({ reason: "device_already_enrolled", deviceId: presentation.deviceId as string }),
        );
        return { ok: false, refusal: refusal("device_already_enrolled", at, scope.correlationId) };
      }
      if (presentation.policy?.enrollmentAllowed === false) {
        emit(
          options?.auditSink,
          scope.tenantId,
          ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
          presentation.requestId,
          at,
          correlationId,
          frozen({ reason: "enrollment_refused_by_policy", deviceId: presentation.deviceId as string }),
        );
        return { ok: false, refusal: refusal("enrollment_refused_by_policy", at, scope.correlationId) };
      }

      // Success: the one-time fulfillment transition + the issued
      // trust record (deterministic, opaque token — the session
      // layer's existing credential shape).
      const fulfilled: EnrollmentRequestRecord = frozen({
        ...record,
        status: "fulfilled",
        fulfilledAt: at,
        fulfilledDeviceId: presentation.deviceId,
      });
      partition.set(record.requestId, fulfilled);

      const tokenValue = fnv1a32Hex(
        canonicalJson({
          at,
          deviceId: presentation.deviceId as string,
          requestId: presentation.requestId,
          verifier: record.codeVerifier,
        }),
      );
      const trust: BootstrapTrustRecord = frozen({
        tenantId: scope.tenantId,
        deviceId: presentation.deviceId,
        sessionToken: frozen({
          value: `fst_${tokenValue}`,
          issuedAt: at,
          // Session expiry rides the request expiry horizon (the
          // control plane refreshes on renewal; nothing here is a
          // permanent credential).
          expiresAt: record.expiresAt,
          issuer: "control-plane@fleetos",
        }),
        issuedAt: at,
        enrollmentRequestId: presentation.requestId,
      });

      emit(
        options?.auditSink,
        scope.tenantId,
        ENROLLMENT_REQUEST_AUDIT_ACTIONS.fulfilled,
        presentation.requestId,
        at,
        correlationId,
        frozen({
          deviceId: presentation.deviceId as string,
          ownershipKind: record.ownershipKind,
          ownershipClass: record.ownershipClass,
        }),
      );
      return { ok: true, trust };
    },
  });
}

// ---------------------------------------------------------------------------
// Local deterministic comparators (internal, not exported)
// ---------------------------------------------------------------------------

function compareIso(a: string, b: string): number {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (aMs < bMs) return -1;
  if (aMs > bMs) return 1;
  return 0;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
