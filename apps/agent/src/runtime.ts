/**
 * @fleetos/agent — AgentRuntime composition layer (W010).
 *
 * A thin composition layer wiring the device-adapters runtime contract
 * modules into a single `AgentRuntime` entry type. The runtime is the
 * agent's top-level object: it holds the agent's identity, declared
 * capabilities, observation collector, command receipt tracker, and
 * local signed-policy cache, and exposes the operations an agent
 * performs against the control plane.
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
  CHECKIN_COMMAND_TYPE,
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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an `AgentRuntime`. Wires together the device-adapters modules
 * into a single composition root.
 *
 * @throws Error when construction options are invalid (delegated to the
 *   underlying factories: observation collector, policy cache).
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
  };
}

/**
 * The check-in command type string this runtime emits. Re-exported from
 * device-adapters for convenience.
 */
export const AGENT_CHECKIN_COMMAND_TYPE = CHECKIN_COMMAND_TYPE;
