/**
 * @fleetos/device-adapters — D4: Command receipt + execution result.
 *
 * When the control plane delivers a `CommandEnvelope` to the agent, the
 * agent:
 *
 *   1. Acknowledges receipt with a `CommandReceipt` carrying a status of
 *      `accepted` (the command is well-formed and will be executed) or
 *      `rejected` (the command is malformed, unauthorized, or unsupported).
 *   2. Transitions to `executing` when execution begins.
 *   3. Records a `CommandResult` with a terminal status of `succeeded` or
 *      `failed`, plus optional evidence and a `FleetError` on failure.
 *
 * **Idempotency (contracts duplicate-suppression contract):** two
 * commands with the same `(tenantId, idempotencyKey)` pair MUST produce
 * the same logical effect exactly once. The receipt tracker returns the
 * ORIGINAL receipt/result on replay — never re-executes, never partially
 * applies. A DIFFERENT command under the same key is an idempotency
 * conflict (ConflictError).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import {
  validateCommand,
  type CommandEnvelope,
  type CommandId,
  type CorrelationId,
  type EvidenceRef,
  type FleetError,
  type IdempotencyKey,
  type TenantId,
} from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import {
  ERROR_CODES,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeAdapterError,
  makeAuthorizationError,
  makeConflictError,
  makeDomainError,
  makePolicyError,
  makeValidationError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D4.1 — Receipt + result status
// ---------------------------------------------------------------------------

/**
 * The status of a command at the agent. The non-terminal status is
 * `accepted` (the command is well-formed and will be executed) and
 * `executing` (execution has begun). The terminal statuses are
 * `succeeded`, `failed`, and `rejected`.
 *
 *   accepted -> executing -> succeeded
 *                         -> failed
 *   accepted -> rejected (early refusal: malformed, unauthorized, unsupported)
 *
 * Note: this is the AGENT-SIDE status, distinct from the IntentStatus
 * lifecycle in `@fleetos/contracts` (which spans the full control loop).
 * The agent only sees its slice of the loop.
 */
export type CommandStatus = "accepted" | "executing" | "succeeded" | "failed" | "rejected";

/**
 * The non-terminal statuses (the agent may transition out of these).
 */
export const NON_TERMINAL_COMMAND_STATUSES: readonly CommandStatus[] = frozenArray([
  "accepted",
  "executing",
] as const);

/**
 * The terminal statuses (no outgoing transitions).
 */
export const TERMINAL_COMMAND_STATUSES: readonly CommandStatus[] = frozenArray([
  "succeeded",
  "failed",
  "rejected",
] as const);

/**
 * Pure predicate: is the given status terminal?
 */
export function isTerminalCommandStatus(status: CommandStatus): boolean {
  return TERMINAL_COMMAND_STATUSES.includes(status);
}

/**
 * The legal transitions on the agent-side status table.
 *
 *   accepted    -> executing | rejected
 *   executing   -> succeeded | failed
 *   succeeded   -> (none, terminal)
 *   failed      -> (none, terminal)
 *   rejected    -> (none, terminal)
 */
export const COMMAND_STATUS_TRANSITIONS: Readonly<Record<CommandStatus, readonly CommandStatus[]>> = frozen({
  accepted: frozenArray(["executing", "rejected"] as const),
  executing: frozenArray(["succeeded", "failed"] as const),
  succeeded: frozenArray([] as const),
  failed: frozenArray([] as const),
  rejected: frozenArray([] as const),
} as const);

/**
 * Pure predicate: is the `from -> to` transition legal?
 */
export function canTransitionCommandStatus(from: CommandStatus, to: CommandStatus): boolean {
  return COMMAND_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// D4.2 — Command receipt
// ---------------------------------------------------------------------------

/**
 * The receipt the agent returns on command delivery. The receipt carries
 * the assigned `status`, the traceability ids, and the receive timestamp.
 */
export interface CommandReceipt extends TenantScoped {
  /** The command id (echoed from the envelope). */
  readonly commandId: CommandId;
  /** The idempotency key (echoed from the envelope). */
  readonly idempotencyKey: IdempotencyKey;
  /** The receipt status (always `accepted` or `rejected` at receipt time). */
  readonly status: CommandStatus;
  /** ISO 8601 receive timestamp (injected). */
  readonly receivedAt: string;
  /** Correlation id (echoed from the envelope). */
  readonly correlationId: CorrelationId;
}

// ---------------------------------------------------------------------------
// D4.3 — Command result
// ---------------------------------------------------------------------------

/**
 * The execution result. Terminal: `succeeded` or `failed`. On failure,
 * the `error` field carries a `FleetError` mapped onto the contracts
 * taxonomy. Optional `evidence` references artifacts the agent produced
 * during execution (logs, screenshots, etc.) — the control plane does
 * not interpret evidence contents, only records that they exist.
 */
export interface CommandResult extends TenantScoped {
  /** The command id (echoed from the envelope). */
  readonly commandId: CommandId;
  /** The idempotency key (echoed from the envelope). */
  readonly idempotencyKey: IdempotencyKey;
  /** The terminal status (`succeeded` or `failed`). */
  readonly status: CommandStatus;
  /** ISO 8601 completion timestamp (injected). */
  readonly completedAt: string;
  /** Correlation id (echoed from the envelope). */
  readonly correlationId: CorrelationId;
  /** Optional evidence artifacts. */
  readonly evidence: readonly EvidenceRef[];
  /** The error, on failure. Absent on success. */
  readonly error?: FleetError;
}

// ---------------------------------------------------------------------------
// D4.4 — Receipt tracker
// ---------------------------------------------------------------------------

/**
 * The agent-side command receipt tracker. Enforces the contracts
 * duplicate-suppression contract: same `(tenantId, idempotencyKey)` =>
 * same logical effect once; replays return the ORIGINAL receipt/result;
 * a different command under the same key is an idempotency conflict.
 */
export interface CommandReceiptTracker {
  /**
   * Acknowledge receipt of a command envelope. Returns the receipt
   * (newly-created or replayed). On idempotency conflict (same key,
   * different command), returns a ConflictError.
   *
   * The receipt status is `accepted` (the command is well-formed and
   * will be executed) or `rejected` (the command is malformed,
   * unauthorized, or unsupported — caller decides via `rejectReason`).
   */
  acknowledge(
    command: CommandEnvelope<unknown>,
    receivedAt: string,
    rejectReason?: "malformed" | "unauthorized" | "unsupported",
  ): { ok: true; receipt: CommandReceipt; replayed: boolean } | { ok: false; error: ReturnType<typeof makeConflictError> | ReturnType<typeof makeValidationError> };

  /**
   * Transition a command's status. Returns the new receipt/result
   * projection. Refuses illegal transitions with a DomainError.
   */
  transition(
    idempotencyKey: IdempotencyKey,
    to: CommandStatus,
    at: string,
    evidence?: readonly EvidenceRef[],
    error?: FleetError,
    tenantId?: TenantId,
    correlationId?: CorrelationId,
  ): { ok: true; status: CommandStatus } | { ok: false; error: ReturnType<typeof makeDomainError> | ReturnType<typeof makeValidationError> };

  /**
   * Record the terminal result. Idempotent: a second call with the same
   * idempotency key returns the ORIGINAL result — never re-executed,
   * never partially applied.
   */
  recordResult(
    idempotencyKey: IdempotencyKey,
    result: Omit<CommandResult, "idempotencyKey">,
  ): { ok: true; result: CommandResult; replayed: boolean } | { ok: false; error: ReturnType<typeof makeConflictError> | ReturnType<typeof makeDomainError> };

  /**
   * Look up the receipt and (if any) result for an idempotency key.
   * Tenant-scoped: a tenant-A lookup cannot observe a tenant-B entry.
   */
  lookup(
    tenantId: TenantId,
    idempotencyKey: IdempotencyKey,
  ): { receipt?: CommandReceipt; result?: CommandResult };

  /** The number of tracked commands (across all tenants). */
  size(): number;
}

// ---------------------------------------------------------------------------
// D4.5 — Factory
// ---------------------------------------------------------------------------

interface TrackedEntry {
  readonly tenantId: TenantId;
  readonly canonicalCommand: string;
  readonly receipt: CommandReceipt;
  result?: CommandResult;
}

/**
 * Create an agent-side command receipt tracker.
 *
 * The tracker enforces the contracts duplicate-suppression contract:
 *   - Same `(tenantId, idempotencyKey)` + same command => replay the
 *     original receipt/result.
 *   - Same `(tenantId, idempotencyKey)` + DIFFERENT command => ConflictError.
 *   - Different `(tenantId, idempotencyKey)` => independent tracking.
 *
 * Tenant isolation is structural: the tracker's `lookup` is scoped by
 * `tenantId`; a tenant-A lookup cannot observe a tenant-B entry.
 */
export function createCommandReceiptTracker(): CommandReceiptTracker {
  const entries = new Map<string, TrackedEntry>();

  function key(tenantId: TenantId, idempotencyKey: IdempotencyKey): string {
    return `${tenantId as string}|${idempotencyKey as string}`;
  }

  function acknowledge(
    command: CommandEnvelope<unknown>,
    receivedAt: string,
    rejectReason?: "malformed" | "unauthorized" | "unsupported",
  ): { ok: true; receipt: CommandReceipt; replayed: boolean } | { ok: false; error: ReturnType<typeof makeConflictError> | ReturnType<typeof makeValidationError> } {
    const trace: ErrorTrace = {
      tenantId: command.tenantId,
      correlationId: command.correlationId,
    };
    // 1. Validate the envelope (frozen contracts invariants).
    const envelopeValidation = validateCommand(command);
    if (!envelopeValidation.ok) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.commandRejected,
          `command envelope is invalid: ${envelopeValidation.reason}`,
          trace,
          [{ path: "/", reason: envelopeValidation.reason }],
        ),
      };
    }
    // 2. Validate the receive timestamp.
    if (typeof receivedAt !== "string" || !looksLikeIso(receivedAt)) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.commandRejected,
          "command receive timestamp is not ISO 8601",
          trace,
          [{ path: "/receivedAt", reason: "not_iso" }],
        ),
      };
    }
    // 3. Idempotency check.
    const k = key(command.tenantId, command.idempotencyKey);
    const canonical = canonicalJson(command);
    const existing = entries.get(k);
    if (existing !== undefined) {
      if (existing.canonicalCommand !== canonical) {
        return {
          ok: false,
          error: makeConflictError(
            ERROR_CODES.commandIdempotencyConflict,
            "idempotency key was already used for a DIFFERENT command",
            trace,
            `command:${command.idempotencyKey as string}`,
          ),
        };
      }
      // Replay: return the original receipt.
      return { ok: true, receipt: existing.receipt, replayed: true };
    }
    // 4. New receipt.
    const status: CommandStatus = rejectReason ? "rejected" : "accepted";
    const receipt: CommandReceipt = frozen({
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      status,
      receivedAt,
      tenantId: command.tenantId,
      correlationId: command.correlationId,
    });
    entries.set(k, {
      tenantId: command.tenantId,
      canonicalCommand: canonical,
      receipt,
    });
    return { ok: true, receipt, replayed: false };
  }

  function transition(
    idempotencyKey: IdempotencyKey,
    to: CommandStatus,
    at: string,
    evidence?: readonly EvidenceRef[],
    error?: FleetError,
    tenantId?: TenantId,
    correlationId?: CorrelationId,
  ): { ok: true; status: CommandStatus } | { ok: false; error: ReturnType<typeof makeDomainError> | ReturnType<typeof makeValidationError> } {
    // We cannot transition without a tenant scope; the caller must supply one.
    if (tenantId === undefined) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.commandUnknown,
          "transition requires a tenantId (no entry context available)",
          { tenantId: "" as TenantId, correlationId: (correlationId ?? "") as CorrelationId },
          [{ path: "/tenantId", reason: "required" }],
        ),
      };
    }
    const k = key(tenantId, idempotencyKey);
    const entry = entries.get(k);
    if (entry === undefined) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.commandUnknown,
          "no tracked command for this idempotency key",
          { tenantId, correlationId: (correlationId ?? "") as CorrelationId },
          "device-adapters.commands",
          "no_tracked_command",
        ),
      };
    }
    if (!canTransitionCommandStatus(entry.receipt.status, to)) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.commandRejected,
          `illegal command status transition: ${entry.receipt.status} -> ${to}`,
          { tenantId, correlationId: entry.receipt.correlationId },
          "device-adapters.commands",
          "illegal_transition",
        ),
      };
    }
    if (typeof at !== "string" || !looksLikeIso(at)) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.commandRejected,
          "transition timestamp is not ISO 8601",
          { tenantId, correlationId: entry.receipt.correlationId },
          [{ path: "/at", reason: "not_iso" }],
        ),
      };
    }
    // If transitioning to a terminal status, record the result.
    if (isTerminalCommandStatus(to)) {
      const result: CommandResult = frozen({
        commandId: entry.receipt.commandId,
        idempotencyKey: entry.receipt.idempotencyKey,
        status: to,
        completedAt: at,
        tenantId: entry.receipt.tenantId,
        correlationId: entry.receipt.correlationId,
        evidence: evidence ? frozenArray(evidence) : frozenArray([]),
        error,
      });
      entry.result = result;
      // The receipt's status mirrors the terminal status for query convenience.
      const newReceipt: CommandReceipt = frozen({
        ...entry.receipt,
        status: to,
      });
      entries.set(k, { ...entry, receipt: newReceipt, result });
    } else {
      // Non-terminal transition: update the receipt's status.
      const newReceipt: CommandReceipt = frozen({
        ...entry.receipt,
        status: to,
      });
      entries.set(k, { ...entry, receipt: newReceipt });
    }
    return { ok: true, status: to };
  }

  function recordResult(
    idempotencyKey: IdempotencyKey,
    result: Omit<CommandResult, "idempotencyKey">,
  ): { ok: true; result: CommandResult; replayed: boolean } | { ok: false; error: ReturnType<typeof makeConflictError> | ReturnType<typeof makeDomainError> } {
    const k = key(result.tenantId, idempotencyKey);
    const entry = entries.get(k);
    if (entry === undefined) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.commandUnknown,
          "no tracked command for this idempotency key",
          { tenantId: result.tenantId, correlationId: result.correlationId },
          "device-adapters.commands",
          "no_tracked_command",
        ),
      };
    }
    if (entry.result !== undefined) {
      // Idempotent replay: return the ORIGINAL result.
      return { ok: true, result: entry.result, replayed: true };
    }
    if (!isTerminalCommandStatus(result.status)) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.commandRejected,
          `recordResult requires a terminal status; got ${result.status}`,
          { tenantId: result.tenantId, correlationId: result.correlationId },
          "device-adapters.commands",
          "non_terminal_result",
        ),
      };
    }
    const finalResult: CommandResult = frozen({
      commandId: result.commandId,
      idempotencyKey,
      status: result.status,
      completedAt: result.completedAt,
      tenantId: result.tenantId,
      correlationId: result.correlationId,
      evidence: result.evidence ? frozenArray(result.evidence) : frozenArray([]),
      error: result.error,
    });
    const newReceipt: CommandReceipt = frozen({
      ...entry.receipt,
      status: result.status,
    });
    entries.set(k, { ...entry, receipt: newReceipt, result: finalResult });
    return { ok: true, result: finalResult, replayed: false };
  }

  function lookup(
    tenantId: TenantId,
    idempotencyKey: IdempotencyKey,
  ): { receipt?: CommandReceipt; result?: CommandResult } {
    const entry = entries.get(key(tenantId, idempotencyKey));
    if (entry === undefined) return {};
    return { receipt: entry.receipt, result: entry.result };
  }

  return frozen({
    acknowledge,
    transition,
    recordResult,
    lookup,
    size: () => entries.size,
  }) as CommandReceiptTracker;
}

// ---------------------------------------------------------------------------
// D4.6 — Convenience: FleetError mapping from agent execution failures
// ---------------------------------------------------------------------------

/**
 * The kind of agent execution failure. Each kind maps onto a specific
 * FleetError subclass from the contracts taxonomy.
 */
export type AgentExecutionFailureKind =
  | "malformed_payload"
  | "unauthorized"
  | "unsupported_capability"
  | "destructive_unauthorized"
  | "destructive_offline_default_deny"
  | "adapter_internal"
  | "timeout"
  | "unknown";

/**
 * Map an agent execution failure kind onto a `FleetError`. The caller
 * supplies the trace (tenant + correlation ids); the lane constructs the
 * appropriate error subclass.
 *
 * This is the single seam where agent-internal failure modes become
 * first-class `FleetError` values for the control plane's audit trail.
 */
export function mapAgentFailure(
  kind: AgentExecutionFailureKind,
  message: string,
  trace: ErrorTrace,
  context?: {
    readonly capability?: string;
    readonly adapterFamily?: string;
    readonly deviceId?: string;
    readonly ruleIds?: readonly string[];
  },
): FleetError {
  switch (kind) {
    case "malformed_payload":
      return makeValidationError(
        ERROR_CODES.commandRejected,
        message,
        trace,
        [{ path: "/payload", reason: "malformed" }],
      );
    case "unauthorized":
      return makeAuthorizationError(
        ERROR_CODES.commandRejected,
        message,
        trace,
        context?.deviceId ?? "agent",
        "agent.command.execute",
        "unauthorized",
      );
    case "unsupported_capability":
      return makeAdapterError(
        ERROR_CODES.capabilityUnsupported,
        message,
        trace,
        context?.capability ?? "unknown",
        context?.adapterFamily ?? "unknown",
        false,
        context?.deviceId,
      );
    case "destructive_unauthorized":
      return makePolicyError(
        ERROR_CODES.capabilityDestructiveUnauthorized,
        message,
        trace,
        "REQUIRE_APPROVAL",
        context?.ruleIds ?? [],
      );
    case "destructive_offline_default_deny":
      return makePolicyError(
        ERROR_CODES.capabilityDestructiveOfflineDefaultDeny,
        message,
        trace,
        "BLOCK",
        context?.ruleIds ?? ["policy.cache.stale"],
      );
    case "adapter_internal":
      return makeAdapterError(
        ERROR_CODES.commandRejected,
        message,
        trace,
        context?.capability ?? "unknown",
        context?.adapterFamily ?? "unknown",
        true,
        context?.deviceId,
      );
    case "timeout":
      return makeDomainError(
        ERROR_CODES.commandRejected,
        message,
        trace,
        "device-adapters.commands",
        "timeout",
      );
    case "unknown":
      return makeDomainError(
        ERROR_CODES.commandRejected,
        message,
        trace,
        "device-adapters.commands",
        "unknown",
      );
  }
}

/**
 * Convenience: compute a stable digest for a command envelope. Used for
 * idempotency-conflict diagnostics.
 */
export function commandDigest(command: CommandEnvelope<unknown>): string {
  return fnv1a32Hex(canonicalJson(command));
}
