/**
 * @fleetos/agent — AgentRuntime composition layer (W010 + W020).
 *
 * A thin composition layer wiring the device-adapters runtime contract
 * modules into a single `AgentRuntime` entry type. The runtime is the
 * agent's top-level object: it holds the agent's identity, declared
 * capabilities, observation collector, command receipt tracker, and
 * local signed-policy cache, and exposes the operations an agent
 * performs against the control plane.
 *
 * W020 extends the composition with the endpoint adapter SDK: the
 * runtime owns an `AdapterRegistry` (registration + lookup of endpoint
 * adapters) and exposes `dispatchCommand` — capability-aware, idempotent
 * command dispatch to the registered adapters (see
 * `@fleetos/device-adapters` dispatch.ts). The runtime supplies the
 * defaults the SDK requires: the target device (its own identity) and
 * the policy-cache freshness signal (its own signed-policy cache).
 *
 * The runtime is intentionally THIN: every operation delegates to one
 * of the device-adapters modules. The runtime does NOT add domain
 * logic; it composes. This keeps the lane's contract surface in one
 * place (device-adapters) and the agent's process orchestration in
 * another (apps/agent).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every timestamp is injected by the caller.
 */

import {
  type AdapterCapabilities,
  type CommandEnvelope,
  type CommandId,
  type CorrelationId,
  type DeviceId,
  type EventEnvelope,
  type IdempotencyKey,
  type ObservationBatch,
  type ValidationError,
} from "@fleetos/contracts";
import {
  type AgentIdentity,
  type AgentVersionInfo,
  type AuthorizeConsequentialResult,
  type CapabilityNegotiationRequest,
  type CapabilityNegotiationResult,
  type CheckInAckEventPayload,
  type CheckInCommandPayload,
  type CheckInResult,
  type CommandReceiptTracker,
  type DeclaredAgentCapabilities,
  type FlushResult,
  type ObservationCollector,
  type PolicyCache,
  type PolicySignatureVerifier,
  type PolicyStalenessRules,
  type SessionToken,
  type AdapterId,
  type AdapterDispatchOutcome,
  type AdapterRegistry,
  type EndpointAdapter,
  CHECKIN_COMMAND_TYPE,
  createAdapterCommandDispatcher,
  createAdapterRegistry,
  createCommandReceiptTracker,
  createObservationCollector,
  createPolicyCache,
  declareAgentCapabilities,
  deriveBatchIdempotencyKey,
  negotiateCapability,
  projectCheckInAck,
  validateCheckInCommand,
  wrapCheckInCommand,
} from "@fleetos/device-adapters";

// ---------------------------------------------------------------------------
// AgentRuntime — composition entry type
// ---------------------------------------------------------------------------

/**
 * The agent runtime. Composes the device-adapters modules into a single
 * entry type. The runtime is tenant-scoped (the agent runs under exactly
 * one tenant) and device-scoped (the agent runs on exactly one device).
 *
 * The runtime does NOT execute network I/O — that is the deployment
 * layer's responsibility. The runtime provides:
 *   - Pure helpers for assembling check-in commands and projecting acks.
 *   - The stateful pieces the agent needs at runtime: the observation
 *     collector, the command receipt tracker, the local policy cache.
 *   - The capability negotiation seam (delegates to device-adapters).
 */
export interface AgentRuntime {
  /** The agent's identity (device + tenant + adapter family). */
  readonly identity: AgentIdentity;
  /** The agent's self-reported version. */
  readonly agent: AgentVersionInfo;
  /** The agent's declared capabilities. */
  readonly declaredCapabilities: DeclaredAgentCapabilities;
  /** The observation collector (D3). */
  readonly collector: ObservationCollector;
  /** The command receipt tracker (D4). */
  readonly receipts: CommandReceiptTracker;
  /** The local signed-policy cache (D5). */
  readonly policyCache: PolicyCache;

  /**
   * Compose a check-in command envelope for the control plane. Pure: the
   * runtime assembles the envelope from its identity, version, and the
   * supplied inputs; it does NOT execute the network call.
   *
   * The runtime validates the assembled envelope via the frozen
   * `validateCheckInCommand` and returns either a valid-by-construction
   * command or a ValidationError.
   */
  composeCheckInCommand(
    inputs: CheckInCommandInputs,
  ): { ok: true; command: CommandEnvelope<CheckInCommandPayload> } | { ok: false; error: ValidationError };

  /**
   * Project a check-in ack event into a CheckInResult. Pure helper.
   */
  projectCheckInAck(event: EventEnvelope<CheckInAckEventPayload>): CheckInResult;

  /**
   * Negotiate a capability invocation against the declared capabilities
   * and the local policy cache state. Delegates to the frozen
   * `negotiateCapability` from device-adapters.
   */
  negotiateCapability(
    request: CapabilityNegotiationRequest,
  ): CapabilityNegotiationResult;

  /**
   * Authorize a consequential (destructive) action via the local policy
   * cache. Delegates to the cache's `authorizeConsequential`.
   */
  authorizeConsequential(
    at: string,
    correlationId?: CorrelationId,
  ): AuthorizeConsequentialResult;

  /**
   * Acknowledge receipt of a command envelope. Delegates to the receipt
   * tracker's `acknowledge`. Idempotent by command idempotency key.
   */
  acknowledgeCommand(
    command: CommandEnvelope<unknown>,
    receivedAt: string,
    rejectReason?: "malformed" | "unauthorized" | "unsupported",
  ): ReturnType<CommandReceiptTracker["acknowledge"]>;

  /**
   * Flush a batch of observations from the collector. Delegates to the
   * collector's `flush`.
   */
  flushObservations(
    observedAt: string,
    correlationId?: CorrelationId,
  ): FlushResult;

  /**
   * Derive an idempotency key for a batch (deterministic). Delegates to
   * the device-adapters helper.
   */
  deriveBatchIdempotencyKey(batch: ObservationBatch): IdempotencyKey;

  // -----------------------------------------------------------------------
  // W020 — endpoint adapter SDK composition
  // -----------------------------------------------------------------------

  /**
   * The endpoint adapter registry (W020 D4). Adapters may be registered
   * at construction (`options.adapters`) or later through this handle.
   */
  readonly adapterRegistry: AdapterRegistry;

  /**
   * Dispatch a command envelope to the adapter fronting its target
   * device. Capability-aware and idempotent: unsupported or unauthorized
   * destructive commands are refused before any platform call (never
   * emulated); a redelivery replays the ORIGINAL result and never
   * re-executes. The runtime injects its own defaults: the target device
   * is its identity's device, and the policy-cache readiness signal is
   * derived from its own signed-policy cache at `executedAt` unless the
   * caller overrides it.
   */
  dispatchCommand(
    command: CommandEnvelope<unknown>,
    inputs: AgentDispatchCommandInputs,
  ): AdapterDispatchOutcome;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Inputs needed to compose a check-in command. The runtime supplies the
 * payload (identity + version + optional session token); the caller
 * supplies the envelope-level ids and timestamps.
 */
export interface CheckInCommandInputs {
  readonly id: CommandId;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly issuedAt: string;
  /** The current session token, when renewing; absent on first enrollment. */
  readonly sessionToken?: SessionToken;
}

/**
 * Options for `createAgentRuntime`.
 */
export interface AgentRuntimeOptions {
  /** The agent's identity (device + tenant + adapter family). */
  readonly identity: AgentIdentity;
  /** The agent's self-reported version. */
  readonly agent: AgentVersionInfo;
  /** The agent's declared capabilities (frozen flag set from contracts). */
  readonly capabilities: AdapterCapabilities;
  /** The signature verifier for the local policy cache (REQUIRED). */
  readonly policyVerifier: PolicySignatureVerifier;
  /** Optional staleness rules for the policy cache (default: 5min/1hour). */
  readonly policyStaleness?: PolicyStalenessRules;
  /** Optional observation collector id seed (default: the device id). */
  readonly observationIdSeed?: string;
  /** Optional observation collector max batch size (default: 500). */
  readonly maxBatchSize?: number;
  /**
   * W020: endpoint adapters registered into the runtime's adapter
   * registry at construction (default: none — register later through
   * `runtime.adapterRegistry`).
   */
  readonly adapters?: readonly EndpointAdapter[];
}

/**
 * Inputs a `dispatchCommand` call needs beyond the command envelope.
 * Every timestamp is INJECTED (never the system clock).
 */
export interface AgentDispatchCommandInputs {
  /** ISO 8601 timestamp the command was received (receipt time). */
  readonly receivedAt: string;
  /** ISO 8601 timestamp execution began. */
  readonly executedAt: string;
  /** ISO 8601 timestamp the terminal result completed. */
  readonly completedAt: string;
  /**
   * Target device override (default: the runtime's identity device).
   * The registry resolves the adapter fronting the device.
   */
  readonly deviceId?: DeviceId;
  /** Target adapter id (takes precedence over deviceId). */
  readonly adapterId?: AdapterId;
  /**
   * Explicit policy grant for a destructive capability (default: false —
   * fail-closed).
   */
  readonly policyGrant?: boolean;
  /**
   * Policy-cache readiness override. When absent, the runtime derives it
   * from its own local signed-policy cache at `executedAt` (fresh +
   * signature-verified => true; anything else => false, which
   * default-denies destructive capabilities).
   */
  readonly policyCacheReady?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an `AgentRuntime`. Wires together the device-adapters modules
 * into a single composition root. W020: the runtime also owns an
 * adapter registry and a capability-aware command dispatcher wired to
 * the runtime's receipt tracker.
 *
 * @throws Error when construction options are invalid (delegated to the
 *   underlying factories: observation collector, policy cache), or when
 *   an adapter in `options.adapters` fails registry validation.
 */
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const declaredCapabilities = declareAgentCapabilities({
    tenantId: options.identity.tenantId,
    adapterFamily: options.identity.adapterFamily,
    capabilities: options.capabilities,
    declaredAt: options.agent.moduleVersion,
    deviceId: options.identity.deviceId,
  });

  const collector = createObservationCollector({
    tenantId: options.identity.tenantId,
    deviceId: options.identity.deviceId,
    idSeed: options.observationIdSeed,
    maxBatchSize: options.maxBatchSize,
  });

  const receipts = createCommandReceiptTracker();

  const policyCache = createPolicyCache({
    tenantId: options.identity.tenantId,
    verifier: options.policyVerifier,
    staleness: options.policyStaleness,
  });

  // W020: the endpoint adapter registry + the capability-aware command
  // dispatcher wired to the runtime's receipt tracker.
  const adapterRegistry = createAdapterRegistry();
  for (const adapter of options.adapters ?? []) {
    const registration = adapterRegistry.register(adapter);
    if (!registration.ok) {
      throw new Error(
        `createAgentRuntime: adapter "${adapter.descriptor.adapterId}" failed registry validation: ${registration.error.message}`,
      );
    }
  }
  const dispatcher = createAdapterCommandDispatcher({
    registry: adapterRegistry,
    tracker: receipts,
  });

  function composeCheckInCommand(inputs: CheckInCommandInputs):
    { ok: true; command: CommandEnvelope<CheckInCommandPayload> } | { ok: false; error: ValidationError } {
    const payload: CheckInCommandPayload = {
      identity: options.identity,
      agent: options.agent,
      sessionToken: inputs.sessionToken,
    };
    const command = wrapCheckInCommand(payload, {
      id: inputs.id,
      idempotencyKey: inputs.idempotencyKey,
      correlationId: inputs.correlationId,
      issuedAt: inputs.issuedAt,
      tenantId: options.identity.tenantId,
    });
    const validation = validateCheckInCommand(command);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }
    return { ok: true, command };
  }

  return {
    identity: options.identity,
    agent: options.agent,
    declaredCapabilities,
    collector,
    receipts,
    policyCache,

    composeCheckInCommand,
    projectCheckInAck: (event) => projectCheckInAck(event),
    negotiateCapability: (request) => negotiateCapability(declaredCapabilities, request),
    authorizeConsequential: (at, correlationId) => policyCache.authorizeConsequential(at, correlationId),
    acknowledgeCommand: (command, receivedAt, rejectReason) =>
      receipts.acknowledge(command, receivedAt, rejectReason),
    flushObservations: (observedAt, correlationId) =>
      collector.flush(observedAt, correlationId),
    deriveBatchIdempotencyKey: (batch) => deriveBatchIdempotencyKey(batch),

    adapterRegistry,
    dispatchCommand: (command, inputs) =>
      dispatcher.dispatch(command, {
        receivedAt: inputs.receivedAt,
        executedAt: inputs.executedAt,
        completedAt: inputs.completedAt,
        deviceId: inputs.deviceId ?? options.identity.deviceId,
        adapterId: inputs.adapterId,
        policyGrant: inputs.policyGrant ?? false,
        policyCacheReady:
          inputs.policyCacheReady ??
          policyCache.staleness(inputs.executedAt) === "fresh",
      }),
  };
}

/**
 * The check-in command type string this runtime emits. Re-exported from
 * device-adapters for convenience.
 */
export const AGENT_CHECKIN_COMMAND_TYPE = CHECKIN_COMMAND_TYPE;
