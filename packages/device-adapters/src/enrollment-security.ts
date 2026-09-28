/**
 * @fleetos/device-adapters — W071: enrollment security + BYOD scoping.
 *
 * Typed enrollment policies riding the existing check-in validation
 * surface (checkin.ts — the W010 D1 handshake, untouched) as a NEW
 * ADDITIVE policy module:
 *
 *   - **Ownership classes.** An enrollment carries an ownership class —
 *     `corporate` | `managed` | `byod` — reflecting ARCHITECTURE-LOCK.md
 *     item 15 ("Telemetry is minimized and purpose-bound; BYOD and
 *     corporate-owned scopes are distinct").
 *   - **BYOD scoping.** A BYOD-scoped device REFUSES management
 *     capabilities outside the BYOD allow-set (the read-only/telemetry
 *     set: identify, observe, diagnose, health) with the machine-stable
 *     refusal `byod_capability_not_permitted`. Corporate and managed
 *     scopes carry no capability restriction at this layer (their
 *     restrictions live in the policy layer, which is not this seam).
 *   - **Replay refusal.** Enrollment validation refuses replayed/
 *     duplicate enrollments deterministically by ENROLLMENT DIGEST —
 *     the FNV-1a over the canonical form of the enrollment identity
 *     (tenant, device, adapter family, agent module/version/protocol).
 *     A first enrollment (a check-in WITHOUT a session token) whose
 *     digest is already recorded is refused `enrollment_replayed`;
 *     renewals (check-ins WITH a session token) are NOT enrollments
 *     and pass this layer untouched (session validation remains the
 *     existing check-in layer's job).
 *
 * Every refusal and admission is auditable through the injected
 * `EnrollmentAuditSink` seam (the W011/W021/W022/W031/W040/W041
 * structural-twin pattern: `{ tenantId, action, subject, occurredAt,
 * correlationId, causationId?, details }`). The sink is INJECTED,
 * never a global; the default is the no-op sink.
 *
 * Tenant isolation is by construction: the enrollment ledger is
 * partitioned per tenant; every operation takes the acting
 * `{ tenantId }` scope FIRST and a foreign enrollment is
 * indistinguishable from an unknown one.
 *
 * ADDITIVE ONLY: the existing check-in shapes/validators are consumed
 * verbatim (`validateCheckInCommand` runs FIRST — its behavior is
 * preserved exactly); this module adds the policy layer beside them.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import { ALL_ADAPTER_CAPABILITIES } from "@fleetos/contracts";
import type {
  AdapterCapabilities,
  CommandEnvelope,
  CorrelationId,
  CausationId,
  DeviceId,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import { validateCheckInCommand } from "./checkin";
import type { CheckInCommandPayload } from "./checkin";
import {
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
} from "./internal";
import type { ErrorTrace } from "./internal";
import { makeValidationError } from "./internal";

/** Synthetic tenant stamped on refusals that predate tenant attribution. */
const SYNTHETIC_ENROLLMENT_TENANT: TenantId = "tnt_system" as TenantId;

// ---------------------------------------------------------------------------
// W071.1 — Ownership classes + the BYOD allow-set
// ---------------------------------------------------------------------------

/**
 * The device ownership classes (ARCHITECTURE-LOCK item 15: BYOD and
 * corporate-owned scopes are distinct).
 */
export type DeviceOwnershipClass = "corporate" | "managed" | "byod";

/** The full ownership-class set, frozen, for validation + iteration. */
export const ALL_DEVICE_OWNERSHIP_CLASSES: readonly DeviceOwnershipClass[] = frozenArray([
  "corporate",
  "managed",
  "byod",
]);

/** Pure predicate: is the value a known ownership class? */
export function isDeviceOwnershipClass(value: unknown): value is DeviceOwnershipClass {
  return (
    typeof value === "string" &&
    (ALL_DEVICE_OWNERSHIP_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * The BYOD capability allow-set: the read-only / telemetry capabilities
 * a personally-owned device may carry under management. Everything
 * else — the management/destructive set (enforce, remediate, lock,
 * locate, wipe, reboot, update) — is REFUSED on BYOD scope with
 * `byod_capability_not_permitted` (a tenant may not silently manage a
 * device it does not own).
 */
export const BYOD_CAPABILITY_ALLOW_SET: readonly (keyof AdapterCapabilities)[] = frozenArray([
  "identify",
  "observe",
  "diagnose",
  "health",
]);

/**
 * The capabilities a BYOD-scoped device REFUSES — the complement of the
 * allow-set over the frozen `ALL_ADAPTER_CAPABILITIES` (derived at
 * module load, never hand-maintained).
 */
export const BYOD_FORBIDDEN_CAPABILITIES: readonly (keyof AdapterCapabilities)[] =
  frozenArray(
    ALL_ADAPTER_CAPABILITIES.filter(
      (capability) => !(BYOD_CAPABILITY_ALLOW_SET as readonly string[]).includes(capability),
    ),
  );

/** Pure predicate: is the capability permitted on BYOD scope? */
export function isByodPermittedCapability(
  capability: keyof AdapterCapabilities,
): boolean {
  return (BYOD_CAPABILITY_ALLOW_SET as readonly string[]).includes(capability);
}

// ---------------------------------------------------------------------------
// W071.2 — Machine-stable refusal taxonomy + error codes
// ---------------------------------------------------------------------------

/**
 * The machine-stable refusal reasons of the enrollment-security layer.
 * `invalid_request` covers a malformed injected admission instant (the
 * fail-safe shape discipline every lane store follows — refuse before
 * any mutation).
 */
export type EnrollmentSecurityRefusalReason =
  | "unknown_ownership_class"
  | "byod_capability_not_permitted"
  | "enrollment_replayed"
  | "enrollment_tenant_mismatch"
  | "invalid_request";

/** Every refusal reason, frozen, for validation + iteration. */
export const ALL_ENROLLMENT_SECURITY_REFUSAL_REASONS: readonly EnrollmentSecurityRefusalReason[] =
  frozenArray([
    "unknown_ownership_class",
    "byod_capability_not_permitted",
    "enrollment_replayed",
    "enrollment_tenant_mismatch",
    "invalid_request",
  ]);

/**
 * Stable machine error codes for the enrollment-security layer.
 * Module-local (the existing `ERROR_CODES` map in internal.ts is not
 * edited — additive-only discipline).
 */
export const ENROLLMENT_SECURITY_ERROR_CODES = {
  ownershipRefused: "agent.enrollment.ownership_refused",
  byodCapabilityNotPermitted: "agent.enrollment.byod_capability_not_permitted",
  enrollmentReplayed: "agent.enrollment.replayed",
  tenantMismatch: "agent.enrollment.tenant_mismatch",
} as const;

/** A machine-stable enrollment-security refusal. */
export interface EnrollmentSecurityRefusal {
  /** The tenant the refusal is attributed to (the acting scope's tenant; synthetic when unattributable). */
  readonly tenantId: TenantId;
  /** The machine-stable refusal reason. */
  readonly reason: EnrollmentSecurityRefusalReason;
  /** The offending capabilities, sorted, when the refusal concerns capabilities. */
  readonly capabilities?: readonly (keyof AdapterCapabilities)[];
  /** The enrollment digest, when the refusal is a replay. */
  readonly digest?: string;
  /** The first-seen instant of the replayed enrollment, when known. */
  readonly firstSeenAt?: string;
}

// ---------------------------------------------------------------------------
// W071.3 — The typed enrollment policy (ownership + capability scope)
// ---------------------------------------------------------------------------

/** Inputs for an enrollment ownership policy. */
export interface EnrollmentOwnershipPolicyInputs {
  /** The ownership class the device enrolls under. */
  readonly ownershipClass: DeviceOwnershipClass;
  /** The capability set the enrollment requests (frozen flag shape from contracts). */
  readonly capabilities: AdapterCapabilities;
}

/** A VALIDATED enrollment ownership policy (valid by construction). */
export interface ValidatedEnrollmentOwnershipPolicy {
  readonly ownershipClass: DeviceOwnershipClass;
  readonly capabilities: AdapterCapabilities;
  /**
   * The permitted capability set, derived: the requested set on
   * corporate/managed scope; the BYOD allow-set-limited set on BYOD.
   */
  readonly permitted: readonly (keyof AdapterCapabilities)[];
}

/** The result of ownership-policy validation. */
export type EnrollmentOwnershipValidation =
  | { readonly ok: true; readonly policy: ValidatedEnrollmentOwnershipPolicy }
  | { readonly ok: false; readonly refusal: EnrollmentSecurityRefusal };

/**
 * Validate an enrollment ownership policy. Machine-stable refusals:
 *   - `unknown_ownership_class` — the class is not one of the three;
 *   - `byod_capability_not_permitted` — a BYOD-scoped enrollment
 *     requests a capability outside the BYOD allow-set. The offending
 *     capabilities are reported SORTED (deterministic).
 *
 * Corporate/managed enrollments carry no capability restriction at this
 * layer. PURE: no store, no clock, no side effects.
 */
export function validateEnrollmentOwnershipPolicy(
  inputs: unknown,
): EnrollmentOwnershipValidation {
  if (inputs === null || typeof inputs !== "object") {
    return {
      ok: false,
      refusal: frozen({
        tenantId: SYNTHETIC_ENROLLMENT_TENANT,
        reason: "unknown_ownership_class",
      }),
    };
  }
  const candidate = inputs as { ownershipClass?: unknown; capabilities?: unknown };
  if (!isDeviceOwnershipClass(candidate.ownershipClass)) {
    return {
      ok: false,
      refusal: frozen({
        tenantId: SYNTHETIC_ENROLLMENT_TENANT,
        reason: "unknown_ownership_class",
      }),
    };
  }
  const capabilities: AdapterCapabilities =
    candidate.capabilities !== null && typeof candidate.capabilities === "object"
      ? (candidate.capabilities as AdapterCapabilities)
      : ({} as AdapterCapabilities);
  if (candidate.ownershipClass === "byod") {
    const offending = ALL_ADAPTER_CAPABILITIES.filter(
      (capability) =>
        capabilities[capability] === true && !isByodPermittedCapability(capability),
    ).sort();
    if (offending.length > 0) {
      return {
        ok: false,
        refusal: frozen({
          tenantId: SYNTHETIC_ENROLLMENT_TENANT,
          reason: "byod_capability_not_permitted",
          capabilities: frozenArray(offending),
        }),
      };
    }
    const permitted = ALL_ADAPTER_CAPABILITIES.filter(
      (capability) => capabilities[capability] === true,
    ).sort();
    return {
      ok: true,
      policy: frozen({
        ownershipClass: "byod",
        capabilities: frozen({ ...capabilities }) as AdapterCapabilities,
        permitted: frozenArray(permitted),
      }),
    };
  }
  const permitted = ALL_ADAPTER_CAPABILITIES.filter(
    (capability) => capabilities[capability] === true,
  ).sort();
  return {
    ok: true,
    policy: frozen({
      ownershipClass: candidate.ownershipClass,
      capabilities: frozen({ ...capabilities }) as AdapterCapabilities,
      permitted: frozenArray(permitted),
    }),
  };
}

/**
 * Enforce the BYOD scope at the capability boundary (runtime refusal):
 * a BYOD-scoped device REFUSES a management capability outside the
 * allow-set with the machine-stable `byod_capability_not_permitted`.
 * Corporate/managed scopes permit every capability at this layer.
 */
export function enforceByodCapability(
  ownershipClass: DeviceOwnershipClass,
  capability: keyof AdapterCapabilities,
): {
  readonly ok: true;
} | {
  readonly ok: false;
  readonly reason: "byod_capability_not_permitted";
  readonly capability: keyof AdapterCapabilities;
} {
  if (ownershipClass === "byod" && !isByodPermittedCapability(capability)) {
    return { ok: false, reason: "byod_capability_not_permitted", capability };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// W071.4 — The enrollment digest (deterministic replay identity)
// ---------------------------------------------------------------------------

/**
 * The deterministic enrollment digest: `enr_` + FNV-1a over the
 * canonical form of the enrollment identity — (tenantId, deviceId,
 * adapterFamily, moduleName, moduleVersion, protocolVersion). Two
 * structurally equal check-in commands produce the same digest
 * byte-identically (canonical JSON, sorted keys); ANY identity-field
 * difference produces a different digest. Never for security.
 */
export function enrollmentDigest(command: CommandEnvelope<CheckInCommandPayload>): string {
  const identity = command.payload.identity;
  const agent = command.payload.agent;
  return `enr_${fnv1a32Hex(
    canonicalJson([
      command.tenantId,
      identity.deviceId,
      identity.adapterFamily,
      agent.moduleName,
      agent.moduleVersion,
      agent.protocolVersion,
    ]),
  )}`;
}

// ---------------------------------------------------------------------------
// W071.5 — The audit sink seam (injected; the structural-twin pattern)
// ---------------------------------------------------------------------------

/** An append-only enrollment audit record (the W011/W040 structural twin). */
export interface EnrollmentAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "agent.enrollment.admitted"). */
  readonly action: string;
  /** The entity the record is about (the device id), or null. */
  readonly subject: string | null;
  /** ISO 8601 timestamp (injected by the emitter — no clock reads). */
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  /** JSON-serializable action context. */
  readonly details: Readonly<Record<string, unknown>>;
}

/** The minimal injected audit sink (append-only; MUST NOT drop records). */
export interface EnrollmentAuditSink {
  append(record: EnrollmentAuditRecord): void;
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_ENROLLMENT_AUDIT_SINK: EnrollmentAuditSink = frozen({
  append: (_record: EnrollmentAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryEnrollmentAuditSink(): EnrollmentAuditSink & {
  readonly records: readonly EnrollmentAuditRecord[];
} {
  const records: EnrollmentAuditRecord[] = [];
  return frozen({
    append(record: EnrollmentAuditRecord): void {
      records.push(record);
    },
    get records(): readonly EnrollmentAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the enrollment-security layer.
 * Emission policy (mirrors the lane's documented judgment call): every
 * ADMISSION and every REFUSAL is audited — the boundary holding is
 * evidence; pure predicates and pure validations that never reached a
 * store are not.
 */
export const ENROLLMENT_AUDIT_ACTIONS = frozen({
  /** An enrollment was admitted (digest recorded, first sighting). */
  admitted: "agent.enrollment.admitted",
  /** An enrollment was refused at the ownership/BYOD policy layer. */
  ownershipRefused: "agent.enrollment.ownership_refused",
  /** An enrollment was refused as a replayed/duplicate digest. */
  replayRefused: "agent.enrollment.replay_refused",
  /** A capability invocation was refused by the BYOD scope. */
  byodCapabilityRefused: "agent.enrollment.byod_capability_refused",
} as const);

// ---------------------------------------------------------------------------
// W071.6 — The enrollment ledger (tenant-partitioned, replay refusal)
// ---------------------------------------------------------------------------

/** The recorded admission of an enrollment digest. */
export interface EnrollmentLedgerRecord extends TenantScoped {
  /** The deterministic enrollment digest. */
  readonly digest: string;
  /** The enrolled device. */
  readonly deviceId: DeviceId;
  /** The adapter family the agent declared. */
  readonly adapterFamily: string;
  /** The injected admission instant (ISO 8601). */
  readonly recordedAt: string;
}

/** The acting tenant scope for enrollment-ledger operations. */
export interface EnrollmentTenantScope {
  readonly tenantId: TenantId;
  readonly correlationId?: CorrelationId;
}

/**
 * The tenant-partitioned enrollment ledger: the recorded admission
 * digests. Every operation takes the acting scope FIRST and touches
 * only the acting tenant's partition. Admission digests are
 * append-only per tenant (the replay VALIDATION refuses a duplicate
 * before any second admission is recorded).
 */
export interface EnrollmentLedger {
  /** Validate + record a first enrollment atomically (replay => refusal). */
  admit(
    scope: EnrollmentTenantScope,
    command: CommandEnvelope<CheckInCommandPayload>,
    at: string,
    options?: EnrollmentAdmitOptions,
  ): EnrollmentAdmissionResult;
  /** Has this digest been admitted (own partition only)? */
  hasDigest(scope: EnrollmentTenantScope, digest: string): boolean;
  /** The admission record for a digest (own partition only). */
  lookup(scope: EnrollmentTenantScope, digest: string): EnrollmentLedgerRecord | undefined;
  /** All admitted digests in the acting partition (sorted). */
  listDigests(scope: EnrollmentTenantScope): readonly string[];
  /** The number of admitted enrollments in the acting partition. */
  size(scope: EnrollmentTenantScope): number;
}

/** Options for `admit`. */
export interface EnrollmentAdmitOptions {
  /** The injected audit sink (admission + refusals emit; default: no-op). */
  readonly auditSink?: EnrollmentAuditSink;
}

/** The result of an admission attempt. */
export type EnrollmentAdmissionResult =
  | { readonly ok: true; readonly record: EnrollmentLedgerRecord }
  | { readonly ok: false; readonly refusal: EnrollmentSecurityRefusal };

/**
 * Create the in-memory reference enrollment ledger. Storage is
 * partitioned by tenant id; admission digests are append-only per
 * tenant. Renewals (check-ins carrying a session token) are NOT
 * enrollments: `admit` returns an admission result WITHOUT recording a
 * digest (they are re-admissions of an existing enrollment — the
 * replay window is the FIRST-enrollment handshake only; renewals are
 * the existing session layer's concern).
 */
export function createInMemoryEnrollmentLedger(): EnrollmentLedger {
  /** tenantId -> (digest -> EnrollmentLedgerRecord). */
  const partitions = new Map<string, Map<string, EnrollmentLedgerRecord>>();

  function partitionOf(tenantId: string): Map<string, EnrollmentLedgerRecord> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, EnrollmentLedgerRecord>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  return frozen({
    admit(
      scope: EnrollmentTenantScope,
      command: CommandEnvelope<CheckInCommandPayload>,
      at: string,
      options?: EnrollmentAdmitOptions,
    ): EnrollmentAdmissionResult {
      const sink: EnrollmentAuditSink = options?.auditSink ?? NOOP_ENROLLMENT_AUDIT_SINK;
      const correlationId: CorrelationId = scope.correlationId ?? ("" as CorrelationId);
      // The envelope's tenant scope MUST match the acting scope (tenant
      // isolation by construction — a foreign command is refused before
      // any digest is even computed).
      if ((command.tenantId as string) !== (scope.tenantId as string)) {
        const refusal: EnrollmentSecurityRefusal = frozen({
          tenantId: scope.tenantId,
          reason: "enrollment_tenant_mismatch",
        });
        sink.append(
          frozen({
            action: ENROLLMENT_AUDIT_ACTIONS.replayRefused,
            tenantId: scope.tenantId,
            subject: null,
            occurredAt: typeof at === "string" ? at : "",
            correlationId,
            details: frozen({
              reason: refusal.reason,
              commandTenantId: command.tenantId as string,
            }),
          }),
        );
        return { ok: false, refusal };
      }
      if (typeof at !== "string" || !looksLikeIso(at)) {
        // Malformed injected instant: refuse before any mutation
        // (fail-safe; the shape discipline every lane store follows).
        return {
          ok: false,
          refusal: frozen<EnrollmentSecurityRefusal>({
            tenantId: scope.tenantId,
            reason: "invalid_request",
            digest: enrollmentDigest(command),
          }),
        };
      }
      const digest = enrollmentDigest(command);
      // Renewal check FIRST: a check-in carrying a session token is a
      // RENEWAL, not a first enrollment — its digest is BY CONSTRUCTION
      // the digest of the already-enrolled identity, so the replay
      // window must not apply. No digest is recorded (the replay window
      // is the first-enrollment handshake; renewals are the existing
      // session layer's concern). The admission result still reports ok
      // (the command is a valid re-admission of an enrolled identity).
      const isRenewal = command.payload.sessionToken !== undefined;
      if (isRenewal) {
        const renewalRecord: EnrollmentLedgerRecord = frozen({
          tenantId: scope.tenantId,
          digest,
          deviceId: command.payload.identity.deviceId,
          adapterFamily: command.payload.identity.adapterFamily,
          recordedAt: at,
        });
        sink.append(
          frozen({
            action: ENROLLMENT_AUDIT_ACTIONS.admitted,
            tenantId: scope.tenantId,
            subject: renewalRecord.deviceId as string,
            occurredAt: at,
            correlationId,
            details: frozen({
              digest,
              deviceId: renewalRecord.deviceId as string,
              adapterFamily: renewalRecord.adapterFamily,
              renewal: true,
            }),
          }),
        );
        return { ok: true, record: renewalRecord };
      }
      const partition = partitionOf(scope.tenantId as string);
      const existing = partition.get(digest);
      if (existing !== undefined) {
        // Replayed/duplicate enrollment: refused machine-stably,
        // deterministically by digest, and audited.
        const refusal: EnrollmentSecurityRefusal = frozen({
          tenantId: scope.tenantId,
          reason: "enrollment_replayed",
          digest,
          firstSeenAt: existing.recordedAt,
        });
        sink.append(
          frozen({
            action: ENROLLMENT_AUDIT_ACTIONS.replayRefused,
            tenantId: scope.tenantId,
            subject: command.payload.identity.deviceId as string,
            occurredAt: at,
            correlationId,
            details: frozen({
              reason: refusal.reason,
              digest,
              deviceId: command.payload.identity.deviceId as string,
              firstSeenAt: existing.recordedAt,
            }),
          }),
        );
        return { ok: false, refusal };
      }
      const record: EnrollmentLedgerRecord = frozen({
        tenantId: scope.tenantId,
        digest,
        deviceId: command.payload.identity.deviceId,
        adapterFamily: command.payload.identity.adapterFamily,
        recordedAt: at,
      });
      partition.set(digest, record);
      sink.append(
        frozen({
          action: ENROLLMENT_AUDIT_ACTIONS.admitted,
          tenantId: scope.tenantId,
          subject: record.deviceId as string,
          occurredAt: at,
          correlationId,
          details: frozen({
            digest,
            deviceId: record.deviceId as string,
            adapterFamily: record.adapterFamily,
            renewal: false,
          }),
        }),
      );
      return { ok: true, record };
    },
    hasDigest(scope: EnrollmentTenantScope, digest: string): boolean {
      return partitions.get(scope.tenantId as string)?.has(digest) ?? false;
    },
    lookup(scope: EnrollmentTenantScope, digest: string): EnrollmentLedgerRecord | undefined {
      return partitions.get(scope.tenantId as string)?.get(digest);
    },
    listDigests(scope: EnrollmentTenantScope): readonly string[] {
      const partition = partitions.get(scope.tenantId as string);
      if (partition === undefined) return frozenArray([]);
      return frozenArray([...partition.keys()].sort());
    },
    size(scope: EnrollmentTenantScope): number {
      return partitions.get(scope.tenantId as string)?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// W071.7 — The check-in composition (the policy rides the handshake)
// ---------------------------------------------------------------------------

/**
 * The result of a check-in validated with the enrollment ownership
 * policy riding it: the existing check-in validation shape plus the
 * validated policy on success.
 */
export type CheckInEnrollmentValidation =
  | {
      readonly ok: true;
      readonly policy: ValidatedEnrollmentOwnershipPolicy;
    }
  | { readonly ok: false; readonly error: ReturnType<typeof makeValidationError> };

/**
 * Validate a check-in command END-TO-END with the enrollment ownership
 * policy riding it: the EXISTING frozen `validateCheckInCommand` runs
 * FIRST (its behavior preserved verbatim — an invalid check-in
 * surfaces the existing ValidationError untouched), then the ownership
 * policy validates (ownership class + BYOD scope). Fail-fast on the
 * existing surface first.
 */
export function validateCheckInWithOwnership(
  command: CommandEnvelope<CheckInCommandPayload>,
  policyInputs: EnrollmentOwnershipPolicyInputs,
): CheckInEnrollmentValidation {
  const existing = validateCheckInCommand(command);
  if (!existing.ok) {
    return { ok: false, error: existing.error };
  }
  const ownership = validateEnrollmentOwnershipPolicy(policyInputs);
  if (!ownership.ok) {
    const trace: ErrorTrace = {
      tenantId: command.tenantId,
      correlationId: command.correlationId,
    };
    return {
      ok: false,
      error: makeValidationError(
        ENROLLMENT_SECURITY_ERROR_CODES.ownershipRefused,
        `enrollment ownership policy refused the check-in (${ownership.refusal.reason})`,
        trace,
        [
          {
            path: "/policy",
            reason: ownership.refusal.reason,
          },
        ],
      ),
    };
  }
  return { ok: true, policy: ownership.policy };
}
