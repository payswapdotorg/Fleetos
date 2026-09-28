/**
 * @fleetos/agent — W071: the agent trust-assertion layer.
 *
 * ARCHITECTURE-LOCK.md item 5: "Device agents are untrusted and
 * tenant-scoped." This module hardens the agent runtime's dispatch
 * surface with a typed trust-assertion layer:
 *
 *   - Every dispatched intent carries an **agent identity assertion**
 *     — the W020 check-in `AgentIdentity` shape consumed via a
 *     STRUCTURAL seam (`TrustedAgentIdentity`: tenant, device, adapter
 *     family — structurally satisfied by the real `AgentIdentity`; the
 *     binding site injects the real shape, proven by test).
 *   - The assertion carries a **capability claim set**, validated
 *     against the ENROLLED capability record (the W010
 *     `DeclaredAgentCapabilities` shape consumed via a structural seam
 *     — `EnrolledCapabilityRecordShape`; the real record satisfies it,
 *     proven by test).
 *   - Refusals are a **machine-stable taxonomy**:
 *     `assertion_malformed` / `unknown_agent` /
 *     `capability_not_enrolled`. An UNTRUSTED assertion NEVER reaches
 *     dispatch — the guard refuses before the dispatch surface is
 *     invoked, proven by test through the call-log (the dispatch
 *     wrapper records every invocation; refusal paths record zero) and
 *     the platform seam's own call recording.
 *
 * The enrolled records live in a tenant-partitioned trust store
 * (`AgentTrustStore`); the dispatch guard wraps any dispatch surface
 * satisfying the `TrustedDispatchSurface` structural seam (the real
 * `AgentRuntime` satisfies it — `dispatchCommand(command, inputs)`).
 *
 * Every trust GRANT and REFUSAL is audited through the injected
 * `AgentTrustAuditSink` seam (the W011/W021/W022/W031/W040/W041
 * structural-twin pattern). The sink is injected, never a global.
 *
 * Tenant isolation is by construction: the trust store is partitioned
 * per tenant; lookups under one tenant never see another tenant's
 * enrollments — a foreign assertion is `unknown_agent`.
 *
 * ADDITIVE ONLY: the `AgentRuntime` composition (runtime.ts) is
 * untouched; this module is new beside it and composes OVER the
 * runtime's dispatch surface structurally.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import {
  ALL_ADAPTER_CAPABILITIES,
  asTenantId,
} from "@fleetos/contracts";
import type {
  AdapterCapabilities,
  CommandEnvelope,
  CorrelationId,
  CausationId,
  DeviceId,
  TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  capabilityForCommandType,
} from "@fleetos/device-adapters";
import type { AdapterDispatchOutcome } from "@fleetos/device-adapters";
import type { AgentDispatchCommandInputs } from "./runtime";

/** Synthetic tenant stamped on refusals that predate tenant attribution. */
const AGENT_TRUST_SYSTEM_TENANT: TenantId = asTenantId("tnt_system");

// ---------------------------------------------------------------------------
// W071.1 — The structural seams
// ---------------------------------------------------------------------------

/**
 * The agent identity assertion shape — a STRUCTURAL seam over the W020
 * check-in `AgentIdentity` (tenant + device + adapter family). The
 * real `AgentIdentity` from `@fleetos/device-adapters` satisfies this
 * structurally; the binding site injects the real shape (proven by
 * test). Declared locally so the trust layer never imports the
 * check-in module's runtime surface — only the structure.
 */
export interface TrustedAgentIdentity {
  /** The tenant the agent is enrolled under. */
  readonly tenantId: TenantId;
  /** The device the agent runs on. */
  readonly deviceId: DeviceId;
  /** The adapter family backing the agent (windows/macos/linux/...). */
  readonly adapterFamily: string;
}

/**
 * The enrolled capability record shape — a STRUCTURAL seam over the
 * W010 `DeclaredAgentCapabilities` (tenant + family + the `supported`
 * enumerable set + declaredAt + optional device). The real record
 * satisfies this structurally; the trust layer validates claims
 * against it without importing the capabilities module's runtime
 * surface.
 */
export interface EnrolledCapabilityRecordShape {
  readonly tenantId: TenantId;
  readonly adapterFamily: string;
  readonly supported: readonly (keyof AdapterCapabilities)[];
  readonly declaredAt: string;
  readonly deviceId?: DeviceId;
}

/**
 * The dispatch surface the guard wraps — a STRUCTURAL seam satisfied
 * by the real `AgentRuntime` (`dispatchCommand(command, inputs)`).
 * Injected at the binding site; proven by test against the real
 * runtime.
 */
export interface TrustedDispatchSurface {
  dispatchCommand(
    command: CommandEnvelope<unknown>,
    inputs: AgentDispatchCommandInputs,
  ): AdapterDispatchOutcome;
}

// ---------------------------------------------------------------------------
// W071.2 — The trust assertion + refusal taxonomy
// ---------------------------------------------------------------------------

/**
 * The trust assertion every dispatched intent carries: the agent's
 * identity assertion plus the capability claim set the agent asserts
 * for this dispatch.
 */
export interface AgentTrustAssertion {
  /** The agent identity assertion (the structural AgentIdentity shape). */
  readonly identity: TrustedAgentIdentity;
  /** The capabilities the agent claims for this dispatch (subset of the enrolled set). */
  readonly claimedCapabilities: readonly (keyof AdapterCapabilities)[];
}

/** The machine-stable refusal taxonomy of the trust layer. */
export type AgentTrustRefusalReason =
  | "unknown_agent"
  | "capability_not_enrolled"
  | "assertion_malformed";

/** Every refusal reason, frozen, for validation + iteration. */
export const ALL_AGENT_TRUST_REFUSAL_REASONS: readonly AgentTrustRefusalReason[] = Object.freeze([
  "unknown_agent",
  "capability_not_enrolled",
  "assertion_malformed",
]);

/**
 * Stable machine error codes for the agent trust layer (module-local —
 * the lane's existing error-code maps are not edited).
 */
export const AGENT_TRUST_ERROR_CODES = {
  unknownAgent: "agent.trust.unknown_agent",
  capabilityNotEnrolled: "agent.trust.capability_not_enrolled",
  assertionMalformed: "agent.trust.assertion_malformed",
} as const;

/** A machine-stable trust refusal. */
export interface AgentTrustRefusal {
  /** The tenant the refusal is attributed to (synthetic when unattributable). */
  readonly tenantId: TenantId;
  /** The machine-stable refusal reason. */
  readonly reason: AgentTrustRefusalReason;
  /** The offending capabilities, sorted, on `capability_not_enrolled`. */
  readonly capabilities?: readonly (keyof AdapterCapabilities)[];
  /** The exercised capability, when a specific command exercise triggered the refusal. */
  readonly capability?: string;
  /** Machine-stable human-readable detail (deterministic per reason + inputs). */
  readonly detail: string;
}

/** A verified trust grant (valid by construction). */
export interface VerifiedAgentTrust {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly adapterFamily: string;
  /** The enrolled capability set (the ceiling on anything the agent may do). */
  readonly permittedCapabilities: readonly (keyof AdapterCapabilities)[];
  /** The injected verification instant. */
  readonly verifiedAt: string;
}

/** The result of trust verification. */
export type AgentTrustResult =
  | { readonly ok: true; readonly trust: VerifiedAgentTrust }
  | { readonly ok: false; readonly refusal: AgentTrustRefusal };

// ---------------------------------------------------------------------------
// W071.3 — The audit sink seam (injected; the structural-twin pattern)
// ---------------------------------------------------------------------------

/** An append-only agent-trust audit record (the W011/W040 structural twin). */
export interface AgentTrustAuditRecord extends TenantScoped {
  /** Stable machine action name (e.g. "agent.trust.granted"). */
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
export interface AgentTrustAuditSink {
  append(record: AgentTrustAuditRecord): void;
}

/** The default sink: discards records (used when no sink is injected). */
export const NOOP_AGENT_TRUST_AUDIT_SINK: AgentTrustAuditSink = Object.freeze({
  append: (_record: AgentTrustAuditRecord): void => undefined,
});

/** A collecting sink for tests and in-memory deployments. */
export function createInMemoryAgentTrustAuditSink(): AgentTrustAuditSink & {
  readonly records: readonly AgentTrustAuditRecord[];
} {
  const records: AgentTrustAuditRecord[] = [];
  return Object.freeze({
    append(record: AgentTrustAuditRecord): void {
      records.push(record);
    },
    get records(): readonly AgentTrustAuditRecord[] {
      return records;
    },
  });
}

/**
 * Stable machine action names emitted by the trust layer. Emission
 * policy (the established judgment call): every GRANT and every
 * REFUSAL is audited — the boundary holding is evidence.
 */
export const AGENT_TRUST_AUDIT_ACTIONS = Object.freeze({
  /** A trust assertion was verified and the dispatch proceeded. */
  granted: "agent.trust.granted",
  /** A trust assertion was refused; the dispatch was NEVER invoked. */
  refused: "agent.trust.refused",
} as const);

// ---------------------------------------------------------------------------
// W071.4 — The tenant-partitioned trust store
// ---------------------------------------------------------------------------

/** The enrolled agent record the trust layer validates assertions against. */
export interface EnrolledAgentRecord {
  /** The enrolled identity (the structural AgentIdentity shape). */
  readonly identity: TrustedAgentIdentity;
  /** The enrolled capability record (the structural DeclaredAgentCapabilities shape). */
  readonly capabilities: EnrolledCapabilityRecordShape;
  /** The injected enrollment instant (ISO 8601). */
  readonly enrolledAt: string;
}

/** The result of an enrollment attempt. */
export type AgentEnrollmentResult =
  | { readonly ok: true; readonly record: EnrolledAgentRecord }
  | { readonly ok: false; readonly reason: "duplicate_enrollment" | "enrollment_malformed"; readonly detail: string };

/**
 * The tenant-partitioned agent trust store: the enrolled agent records
 * (identity + capability record). Every operation takes the acting
 * tenant FIRST; lookups never cross partitions.
 */
export interface AgentTrustStore {
  /** Enroll an agent record under its own tenant partition. */
  enroll(record: unknown): AgentEnrollmentResult;
  /** The enrolled record for (tenant, device) — own partition only. */
  lookup(tenantId: TenantId, deviceId: DeviceId): EnrolledAgentRecord | undefined;
  /** Every enrolled device id in the acting partition (sorted). */
  listDeviceIds(tenantId: TenantId): readonly DeviceId[];
  /** The number of enrolled agents in the acting partition. */
  size(tenantId: TenantId): number;
}

/**
 * Create the in-memory reference agent trust store. Partitions are
 * keyed by tenant id; a (tenant, device) pair holds at most ONE
 * enrolled record (a duplicate enrollment with a different shape is
 * refused — the enrolled capability record is append-stable).
 */
export function createInMemoryAgentTrustStore(): AgentTrustStore {
  /** tenantId -> (deviceId -> EnrolledAgentRecord). */
  const partitions = new Map<string, Map<string, EnrolledAgentRecord>>();

  function partitionOf(tenantId: string): Map<string, EnrolledAgentRecord> {
    let partition = partitions.get(tenantId);
    if (partition === undefined) {
      partition = new Map<string, EnrolledAgentRecord>();
      partitions.set(tenantId, partition);
    }
    return partition;
  }

  function isEnrolledRecordShape(value: unknown): value is EnrolledAgentRecord {
    if (value === null || typeof value !== "object") return false;
    const candidate = value as {
      identity?: unknown;
      capabilities?: unknown;
      enrolledAt?: unknown;
    };
    const identity = candidate.identity as { tenantId?: unknown; deviceId?: unknown; adapterFamily?: unknown } | undefined;
    if (
      identity === null ||
      typeof identity !== "object" ||
      typeof identity.tenantId !== "string" ||
      identity.tenantId.length === 0 ||
      typeof identity.deviceId !== "string" ||
      identity.deviceId.length === 0 ||
      typeof identity.adapterFamily !== "string" ||
      identity.adapterFamily.length === 0
    ) {
      return false;
    }
    const capabilities = candidate.capabilities as
      | { tenantId?: unknown; adapterFamily?: unknown; supported?: unknown; declaredAt?: unknown }
      | undefined;
    if (
      capabilities === null ||
      typeof capabilities !== "object" ||
      typeof capabilities.tenantId !== "string" ||
      capabilities.tenantId.length === 0 ||
      typeof capabilities.adapterFamily !== "string" ||
      capabilities.adapterFamily.length === 0 ||
      !Array.isArray(capabilities.supported) ||
      capabilities.supported.some(
        (capability) =>
          typeof capability !== "string" ||
          !(ALL_ADAPTER_CAPABILITIES as readonly string[]).includes(capability),
      ) ||
      typeof capabilities.declaredAt !== "string" ||
      capabilities.declaredAt.length === 0
    ) {
      return false;
    }
    if (typeof candidate.enrolledAt !== "string" || candidate.enrolledAt.length === 0) {
      return false;
    }
    return true;
  }

  return Object.freeze({
    enroll(record: unknown): AgentEnrollmentResult {
      if (!isEnrolledRecordShape(record)) {
        return {
          ok: false,
          reason: "enrollment_malformed",
          detail: "enrolled record must carry identity, capabilities, enrolledAt",
        };
      }
      const identity = record.identity;
      const partition = partitionOf(identity.tenantId as string);
      const key = identity.deviceId as string;
      const existing = partition.get(key);
      if (existing !== undefined) {
        return {
          ok: false,
          reason: "duplicate_enrollment",
          detail: `agent ${key} is already enrolled under tenant ${identity.tenantId as string}`,
        };
      }
      const stored: EnrolledAgentRecord = Object.freeze({
        identity: Object.freeze({ ...identity }),
        capabilities: Object.freeze({
          ...record.capabilities,
          supported: Object.freeze([...record.capabilities.supported].sort()),
        }),
        enrolledAt: record.enrolledAt,
      });
      partition.set(key, stored);
      return { ok: true, record: stored };
    },
    lookup(tenantId: TenantId, deviceId: DeviceId): EnrolledAgentRecord | undefined {
      return partitions.get(tenantId as string)?.get(deviceId as string);
    },
    listDeviceIds(tenantId: TenantId): readonly DeviceId[] {
      const partition = partitions.get(tenantId as string);
      if (partition === undefined) return Object.freeze([]);
      return Object.freeze([...partition.keys()].sort()) as readonly DeviceId[];
    },
    size(tenantId: TenantId): number {
      return partitions.get(tenantId as string)?.size ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// W071.5 — Trust verification (parse-don't-validate; machine-stable)
// ---------------------------------------------------------------------------

/** Options for `verifyAgentTrust`. */
export interface VerifyAgentTrustOptions {
  /** The injected verification instant (ISO 8601). */
  readonly at: string;
  /** The capability the dispatched command exercises, when known. */
  readonly capability?: keyof AdapterCapabilities;
}

/**
 * Verify a trust assertion against the enrolled record. PURE + one
 * store READ (the lookup). Machine-stable refusal order:
 *
 *   1. `assertion_malformed` — the assertion's shape is invalid (the
 *      identity fields are not non-empty strings; the claim set is
 *      not a list of known capability names; the identity assertion
 *      is absent).
 *   2. `unknown_agent` — no enrolled record for (tenant, device), OR
 *      the enrolled record's adapter family disagrees with the
 *      assertion (the asserted identity triple is not the enrolled
 *      one), OR the enrolled capability record's tenant disagrees.
 *   3. `capability_not_enrolled` — a claimed capability is not in the
 *      ENROLLED record's supported set, or (when `capability` is
 *      provided) the exercised capability is not BOTH claimed and
 *      enrolled. Offending capabilities are reported sorted.
 *
 * On grant, the verified trust carries the ENROLLED capability set
 * (the ceiling — never the asserted superset) and the injected
 * verification instant.
 */
export function verifyAgentTrust(
  assertion: unknown,
  store: AgentTrustStore,
  options: VerifyAgentTrustOptions,
): AgentTrustResult {
  // --- 1. assertion_malformed ------------------------------------------
  if (assertion === null || typeof assertion !== "object") {
    return {
      ok: false,
      refusal: Object.freeze({
        tenantId: AGENT_TRUST_SYSTEM_TENANT,
        reason: "assertion_malformed",
        detail: "trust assertion is absent",
      }),
    };
  }
  const candidate = assertion as {
    identity?: unknown;
    claimedCapabilities?: unknown;
  };
  const identity = candidate.identity as
    | { tenantId?: unknown; deviceId?: unknown; adapterFamily?: unknown }
    | undefined;
  if (
    identity === null ||
    typeof identity !== "object" ||
    typeof identity.tenantId !== "string" ||
    identity.tenantId.length === 0 ||
    typeof identity.deviceId !== "string" ||
    identity.deviceId.length === 0 ||
    typeof identity.adapterFamily !== "string" ||
    identity.adapterFamily.length === 0
  ) {
    return {
      ok: false,
      refusal: Object.freeze({
        tenantId: AGENT_TRUST_SYSTEM_TENANT,
        reason: "assertion_malformed",
        detail: "trust assertion identity is malformed",
      }),
    };
  }
  if (!Array.isArray(candidate.claimedCapabilities)) {
    return {
      ok: false,
      refusal: Object.freeze({
        tenantId: AGENT_TRUST_SYSTEM_TENANT,
        reason: "assertion_malformed",
        detail: "trust assertion claimedCapabilities must be an array",
      }),
    };
  }
  const unknownClaims = candidate.claimedCapabilities.filter(
    (capability) =>
      typeof capability !== "string" ||
      !(ALL_ADAPTER_CAPABILITIES as readonly string[]).includes(capability),
  );
  if (unknownClaims.length > 0) {
    return {
      ok: false,
      refusal: Object.freeze({
        tenantId: AGENT_TRUST_SYSTEM_TENANT,
        reason: "assertion_malformed",
        detail: `trust assertion claims unknown capabilities: ${unknownClaims
          .map((capability) => String(capability))
          .sort()
          .join(", ")}`,
      }),
    };
  }
  const claimed = candidate.claimedCapabilities as (keyof AdapterCapabilities)[];

  // --- 2. unknown_agent --------------------------------------------------
  const enrolled = store.lookup(identity.tenantId as TenantId, identity.deviceId as DeviceId);
  if (
    enrolled === undefined ||
    enrolled.identity.adapterFamily !== identity.adapterFamily ||
    (enrolled.capabilities.tenantId as string) !== (identity.tenantId as string)
  ) {
    return {
      ok: false,
      refusal: Object.freeze({
        tenantId: identity.tenantId as TenantId,
        reason: "unknown_agent",
        detail: `no enrolled agent record matches identity (${identity.tenantId as string}, ${identity.deviceId as string}, ${identity.adapterFamily})`,
      }),
    };
  }

  // --- 3. capability_not_enrolled ----------------------------------------
  const supported = new Set<string>(enrolled.capabilities.supported as readonly string[]);
  const notEnrolled = claimed
    .filter((capability) => !supported.has(capability))
    .sort();
  if (options.capability !== undefined) {
    const exercised = options.capability as string;
    if (!claimed.includes(options.capability) || !supported.has(exercised)) {
      return {
        ok: false,
        refusal: Object.freeze({
          tenantId: identity.tenantId as TenantId,
          reason: "capability_not_enrolled",
          capability: exercised,
          capabilities: Object.freeze([options.capability]),
          detail: `capability "${exercised}" is not both claimed and enrolled`,
        }),
      };
    }
  }
  if (notEnrolled.length > 0) {
    return {
      ok: false,
      refusal: Object.freeze({
        tenantId: identity.tenantId as TenantId,
        reason: "capability_not_enrolled",
        capabilities: Object.freeze(notEnrolled),
        detail: `claimed capabilities not in the enrolled record: ${notEnrolled.join(", ")}`,
      }),
    };
  }

  // --- grant ---------------------------------------------------------------
  return {
    ok: true,
    trust: Object.freeze({
      tenantId: identity.tenantId as TenantId,
      deviceId: identity.deviceId as DeviceId,
      adapterFamily: identity.adapterFamily,
      permittedCapabilities: Object.freeze([...enrolled.capabilities.supported].sort()),
      verifiedAt: options.at,
    }),
  };
}

// ---------------------------------------------------------------------------
// W071.6 — The trusted dispatch guard (untrusted never reaches dispatch)
// ---------------------------------------------------------------------------

/** Inputs for the guarded dispatch: the trust assertion + the dispatch inputs. */
export interface TrustedDispatchInputs extends AgentDispatchCommandInputs {
  /** The trust assertion this dispatch carries. */
  readonly assertion: AgentTrustAssertion;
  /** The injected trust-verification + audit instant (ISO 8601). */
  readonly at: string;
  /** Correlation id stamped on the trust audit records. */
  readonly correlationId?: CorrelationId;
}

/** The outcome of a guarded dispatch. */
export type TrustedDispatchOutcome =
  | { readonly ok: true; readonly outcome: AdapterDispatchOutcome; readonly trust: VerifiedAgentTrust }
  | { readonly ok: false; readonly refusal: AgentTrustRefusal };

/** Options for `createTrustedDispatchGuard`. */
export interface TrustedDispatchGuardOptions {
  /** The enrolled-agent trust store (tenant-partitioned). */
  readonly store: AgentTrustStore;
  /** The dispatch surface being guarded (the real AgentRuntime at the binding site). */
  readonly dispatch: TrustedDispatchSurface;
  /** The injected audit sink (grants + refusals emit; default: no-op). */
  readonly auditSink?: AgentTrustAuditSink;
}

/**
 * Create the trusted dispatch guard: a typed trust-assertion layer OVER
 * a dispatch surface (structural — the real `AgentRuntime` satisfies
 * it). Every `dispatchWithTrust` call carries an agent identity
 * assertion + capability claim set; the assertion is verified against
 * the enrolled record BEFORE the dispatch surface is invoked. An
 * untrusted assertion (malformed / unknown agent / unenrolled
 * capability — including a command whose exercised capability is not
 * both claimed and enrolled, or whose type maps to no capability at
 * all) is refused machine-stably and the dispatch surface is NEVER
 * invoked — proven by test through the dispatch call-log.
 */
export function createTrustedDispatchGuard(
  options: TrustedDispatchGuardOptions,
): {
  dispatchWithTrust(
    command: CommandEnvelope<unknown>,
    inputs: TrustedDispatchInputs,
  ): TrustedDispatchOutcome;
} {
  if (!options.store || typeof options.store.lookup !== "function") {
    throw new Error("createTrustedDispatchGuard: store is required");
  }
  if (!options.dispatch || typeof options.dispatch.dispatchCommand !== "function") {
    throw new Error("createTrustedDispatchGuard: dispatch surface is required");
  }
  const store = options.store;
  const dispatch = options.dispatch;
  const sink: AgentTrustAuditSink = options.auditSink ?? NOOP_AGENT_TRUST_AUDIT_SINK;

  function audited(
    record: AgentTrustAuditRecord,
  ): void {
    sink.append(Object.freeze(record));
  }

  return Object.freeze({
    dispatchWithTrust(
      command: CommandEnvelope<unknown>,
      inputs: TrustedDispatchInputs,
    ): TrustedDispatchOutcome {
      const correlationId: CorrelationId = inputs.correlationId ?? ("" as CorrelationId);
      // The exercised capability for the command's type. A command
      // whose type maps to NO capability cannot carry a valid claim
      // set for it — the trust layer refuses fail-fast (the dispatcher
      // would refuse it downstream as unknown_command_type; the trust
      // boundary never lets it travel).
      const capability = capabilityForCommandType(command.type);
      if (capability === undefined) {
        const refusal: AgentTrustRefusal = Object.freeze({
          tenantId: AGENT_TRUST_SYSTEM_TENANT,
          reason: "assertion_malformed",
          detail: `command type "${command.type}" maps to no adapter capability`,
        });
        audited({
          action: AGENT_TRUST_AUDIT_ACTIONS.refused,
          tenantId: refusal.tenantId,
          subject: null,
          occurredAt: inputs.at,
          correlationId,
          details: Object.freeze({
            reason: refusal.reason,
            detail: refusal.detail,
            commandType: command.type,
          }),
        });
        return { ok: false, refusal };
      }
      const verification = verifyAgentTrust(inputs.assertion, store, {
        at: inputs.at,
        capability,
      });
      if (!verification.ok) {
        // UNTRUSTED: the dispatch surface is NEVER invoked.
        audited({
          action: AGENT_TRUST_AUDIT_ACTIONS.refused,
          tenantId: verification.refusal.tenantId,
          subject: null,
          occurredAt: inputs.at,
          correlationId,
          details: Object.freeze({
            reason: verification.refusal.reason,
            detail: verification.refusal.detail,
            capability: verification.refusal.capability ?? capability,
            capabilities: verification.refusal.capabilities ?? [],
            commandType: command.type,
          }),
        });
        return { ok: false, refusal: verification.refusal };
      }
      audited({
        action: AGENT_TRUST_AUDIT_ACTIONS.granted,
        tenantId: verification.trust.tenantId,
        subject: verification.trust.deviceId as string,
        occurredAt: inputs.at,
        correlationId,
        details: Object.freeze({
          deviceId: verification.trust.deviceId as string,
          adapterFamily: verification.trust.adapterFamily,
          capability,
          commandType: command.type,
          permittedCapabilityCount: verification.trust.permittedCapabilities.length,
        }),
      });
      const outcome = dispatch.dispatchCommand(command, inputs);
      return { ok: true, outcome, trust: verification.trust };
    },
  });
}
