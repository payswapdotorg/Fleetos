/**
 * @fleetos/device-adapters — W020 D4: Capability-aware command dispatch.
 *
 * The composition engine that carries a `CommandEnvelope` (frozen
 * contracts shape) from admission to a terminal agent-side result:
 *
 *   1. Envelope validation       (frozen `validateCommand`).
 *   2. Command type -> capability mapping (the normalized
 *      `device.command.<capability>` convention).
 *   3. Adapter resolution        (registry lookup by adapterId / device /
 *      singleton fallback).
 *   4. Capability negotiation    (W010 `negotiateCapability` — the frozen
 *      `assertSupported` semantics; the SDK REFUSES to route unsupported
 *      or unauthorized destructive commands).
 *   5. Idempotent receipt        (W010 `CommandReceiptTracker`: same
 *      (tenantId, idempotencyKey) replays the ORIGINAL result — never
 *      re-executes; a different command under the same key is a
 *      ConflictError).
 *   6. Capability-aware execution (the adapter's `invoke()` dispatches to
 *      the right per-capability adapter method).
 *   7. Result envelope           (status lifecycle accepted -> executing
 *      -> succeeded | failed, or born-rejected / accepted -> rejected;
 *      FleetError mapping onto the contracts taxonomy).
 *
 * The dispatcher is pure composition: it owns no domain logic, delegates
 * every concern to the W010/W020 modules, and never reads the clock.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  validateCommand,
  type CommandEnvelope,
  type FleetError,
} from "@fleetos/contracts";
import type { DeviceId, TenantId } from "@fleetos/contracts";
import { negotiateCapability } from "./capabilities";
import type { CommandReceipt, CommandReceiptTracker, CommandResult, CommandStatus } from "./commands";
import type { AdapterCapability, AdapterId, EndpointAdapter } from "./adapter";
import type { AdapterRegistry } from "./registry";
import {
  ERROR_CODES,
  frozen,
  looksLikeIso,
  makeAdapterError,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D4.1 — Command type <-> capability mapping
// ---------------------------------------------------------------------------

/**
 * The command-type convention for normalized adapter capabilities:
 * `device.command.<capability>`. The frozen contracts `CommandType` is a
 * namespaced string (`<module>.<subject>.<verb>`, e.g.
 * `device.command.lock`); this table is the lane's mapping of the
 * normalized capability commands.
 */
export const CAPABILITY_COMMAND_TYPES: Readonly<Record<AdapterCapability, string>> = frozen({
  identify: "device.command.identify",
  observe: "device.command.observe",
  diagnose: "device.command.diagnose",
  enforce: "device.command.enforce",
  remediate: "device.command.remediate",
  lock: "device.command.lock",
  locate: "device.command.locate",
  wipe: "device.command.wipe",
  reboot: "device.command.reboot",
  update: "device.command.update",
  health: "device.command.health",
} as const);

/**
 * Map a command type onto the normalized capability it exercises.
 * Returns `undefined` when the type is not a capability command this SDK
 * routes (the dispatcher rejects such commands as unsupported).
 */
export function capabilityForCommandType(type: string): AdapterCapability | undefined {
  for (const [capability, commandType] of Object.entries(CAPABILITY_COMMAND_TYPES)) {
    if (commandType === type) return capability as AdapterCapability;
  }
  return undefined;
}

/**
 * Map a normalized capability onto its command type (the inverse of
 * `capabilityForCommandType`).
 */
export function commandTypeForCapability(capability: AdapterCapability): string {
  return CAPABILITY_COMMAND_TYPES[capability];
}

// ---------------------------------------------------------------------------
// D4.2 — Dispatch inputs + outcome
// ---------------------------------------------------------------------------

/**
 * Inputs a dispatch needs beyond the command envelope itself. Every
 * timestamp is INJECTED (never the system clock).
 */
export interface AdapterDispatchInputs {
  /** ISO 8601 timestamp the command was received (receipt time). */
  readonly receivedAt: string;
  /** ISO 8601 timestamp execution began (the executing transition). */
  readonly executedAt: string;
  /** ISO 8601 timestamp the terminal result completed. */
  readonly completedAt: string;
  /** Target device (adapter resolution; registry lookup). */
  readonly deviceId?: DeviceId;
  /** Target adapter id (takes precedence over deviceId). */
  readonly adapterId?: AdapterId;
  /**
   * Whether the caller has an explicit policy grant for a destructive
   * capability (default: false — fail-closed).
   */
  readonly policyGrant?: boolean;
  /**
   * Whether the local signed-policy cache is fresh + signature-verified
   * (default: false — destructive default-deny).
   */
  readonly policyCacheReady?: boolean;
}

/**
 * The dispatch outcome. Tagged on `ok`; the `status` mirrors the
 * agent-side command statuses (W010 D4):
 *
 *   - `succeeded` — the command executed; `result` is terminal
 *     `succeeded` (a replay returns the ORIGINAL result with
 *     `replayed: true`).
 *   - `rejected` / `failed` — the command was refused (before execution)
 *     or failed (during execution); `error` carries the FleetError and
 *     `result` is the terminal record.
 *   - `malformed` — the envelope or the inputs are invalid; the tracker
 *     refused admission, so there is no receipt.
 *   - `conflict` — an idempotency conflict (same key, different command);
 *     no new receipt was issued.
 *   - `incomplete` — an internal invariant breach on the happy path
 *     (e.g. a replayed command whose result never completed). Fail-safe:
 *     the command is never re-executed.
 */
export type AdapterDispatchOutcome =
  | {
      readonly ok: true;
      readonly status: "succeeded";
      readonly receipt: CommandReceipt;
      readonly result: CommandResult;
      readonly replayed: boolean;
    }
  | {
      readonly ok: false;
      readonly status: "rejected" | "failed";
      readonly receipt: CommandReceipt;
      readonly result: CommandResult;
      readonly replayed: boolean;
      readonly error: FleetError;
    }
  | {
      readonly ok: false;
      readonly status: "malformed" | "conflict" | "incomplete";
      readonly receipt?: CommandReceipt;
      readonly error: FleetError;
    };

// ---------------------------------------------------------------------------
// D4.3 — Dispatcher interface + factory
// ---------------------------------------------------------------------------

/**
 * The capability-aware command dispatcher: routes commands to the
 * registered endpoint adapters with idempotent receipt and FleetError
 * result envelopes.
 */
export interface AdapterCommandDispatcher {
  /**
   * Dispatch a command envelope to the adapter that fronts its target.
   * Idempotent by (tenantId, idempotencyKey): a redelivery replays the
   * ORIGINAL result and never re-executes; a different command under the
   * same key is a conflict.
   */
  dispatch(command: CommandEnvelope<unknown>, inputs: AdapterDispatchInputs): AdapterDispatchOutcome;
}

/**
 * Options for `createAdapterCommandDispatcher`.
 */
export interface AdapterDispatcherOptions {
  /** The adapter registry to resolve adapters from. */
  readonly registry: AdapterRegistry;
  /** The command receipt tracker (idempotent admission + results). */
  readonly tracker: CommandReceiptTracker;
}

/**
 * Create an adapter command dispatcher. Pure composition over the
 * registry (adapter resolution), the W010 receipt tracker (idempotent
 * receipt/result), and the endpoint adapter (negotiation + execution).
 */
export function createAdapterCommandDispatcher(
  options: AdapterDispatcherOptions,
): AdapterCommandDispatcher {
  const { registry, tracker } = options;

  function dispatch(
    command: CommandEnvelope<unknown>,
    inputs: AdapterDispatchInputs,
  ): AdapterDispatchOutcome {
    const trace: ErrorTrace = {
      tenantId: command.tenantId,
      correlationId: command.correlationId,
    };

    // 1. Input sanity: every timestamp is injected and ISO 8601.
    const timestamps: readonly [string, string][] = [
      ["receivedAt", inputs.receivedAt],
      ["executedAt", inputs.executedAt],
      ["completedAt", inputs.completedAt],
    ];
    for (const [field, value] of timestamps) {
      if (typeof value !== "string" || !looksLikeIso(value)) {
        return {
          ok: false,
          status: "malformed",
          error: makeValidationError(
            ERROR_CODES.commandRejected,
            `dispatch input ${field} is not ISO 8601`,
            trace,
            [{ path: `/${field}`, reason: "not_iso" }],
          ),
        };
      }
    }

    // 2. Envelope validation (mirrors the tracker's own admission check).
    const envelopeValidation = validateCommand(command);
    if (!envelopeValidation.ok) {
      return {
        ok: false,
        status: "malformed",
        error: makeValidationError(
          ERROR_CODES.commandRejected,
          `command envelope is invalid: ${envelopeValidation.reason}`,
          trace,
          [{ path: "/", reason: envelopeValidation.reason }],
        ),
      };
    }

    // 3. Command type -> normalized capability; adapter resolution; and
    //    capability negotiation. A refusal here means the command is
    //    born-rejected: the receipt is created with the matching
    //    rejectReason and the platform seam is NEVER invoked.
    let adapter: EndpointAdapter | undefined;
    let capability: AdapterCapability | undefined;
    let refusalError: FleetError | undefined;
    let rejectReason: "malformed" | "unauthorized" | "unsupported" | undefined;
    const resolvedCapability = capabilityForCommandType(command.type);
    if (resolvedCapability === undefined) {
      // The command type does not map to a normalized capability: the
      // agent cannot route it at all.
      refusalError = makeAdapterError(
        ERROR_CODES.adapterUnknownCommandType,
        `command type "${command.type}" does not map to a normalized adapter capability`,
        trace,
        "unknown",
        "unknown",
        false,
        inputs.deviceId as string | undefined,
      );
      rejectReason = "unsupported";
    } else {
      const resolution = resolveAdapter(command.tenantId, resolvedCapability, inputs, trace);
      if (!resolution.ok) {
        refusalError = resolution.error;
        rejectReason = "unsupported";
      } else {
        adapter = resolution.adapter;
        capability = resolvedCapability;
        // Pre-negotiation with the adapter's DECLARED capabilities (the
        // adapter enforces the same negotiation inside invoke() —
        // defense in depth over the frozen assertSupported semantics).
        const negotiation = negotiateCapability(adapter.capabilities, {
          tenantId: command.tenantId,
          capability,
          policyGrant: inputs.policyGrant ?? false,
          policyCacheReady: inputs.policyCacheReady ?? false,
          correlationId: command.correlationId,
          deviceId: adapter.descriptor.deviceId,
        });
        if (!negotiation.ok) {
          refusalError = negotiation.error;
          rejectReason = negotiation.reason === "unsupported" ? "unsupported" : "unauthorized";
        }
      }
    }

    // 4. Idempotent admission. A replay returns the ORIGINAL receipt
    //    (and, below, the original result) — never re-executes. The
    //    pre-negotiation refusal does not override a completed command.
    const admission = tracker.acknowledge(command, inputs.receivedAt, rejectReason);
    if (!admission.ok) {
      return { ok: false, status: "conflict", error: admission.error };
    }
    const receipt = admission.receipt;
    if (admission.replayed) {
      const existing = tracker.lookup(command.tenantId, command.idempotencyKey);
      if (existing.result !== undefined) {
        return mirrorResult(existing.result, existing.receipt ?? receipt);
      }
      // A replayed command without a terminal result: fail-safe. The
      // command was already acknowledged; re-executing could double-apply.
      return {
        ok: false,
        status: "incomplete",
        receipt,
        error: makeDomainError(
          ERROR_CODES.dispatchIncomplete,
          "replayed command has no terminal result (acknowledged but never completed) — refusing to re-execute",
          trace,
          "device-adapters.dispatch",
          "replay_without_result",
        ),
      };
    }

    // 5. Born-rejected path: record the terminal rejected result with the
    //    refusal's FleetError. The seam was never invoked.
    if (refusalError !== undefined) {
      const recorded = tracker.recordResult(command.idempotencyKey, {
        commandId: command.id,
        status: "rejected",
        completedAt: inputs.completedAt,
        tenantId: command.tenantId,
        correlationId: command.correlationId,
        evidence: [],
        error: refusalError,
      });
      if (!recorded.ok) {
        return { ok: false, status: "incomplete", receipt, error: recorded.error };
      }
      return {
        ok: false,
        status: "rejected",
        // The receipt was born-rejected at admission (acknowledge carries
        // the rejectReason); recordResult attached the terminal result.
        receipt,
        result: recorded.result,
        replayed: false,
        error: refusalError,
      };
    }

    // 6. Capability-aware execution. adapter/capability are both defined
    //    on this path (the refusal branches returned above); the guard
    //    is a fail-safe for types TS cannot prove across the closure.
    if (adapter === undefined || capability === undefined) {
      return {
        ok: false,
        status: "incomplete",
        receipt,
        error: makeDomainError(
          ERROR_CODES.dispatchIncomplete,
          "internal dispatch invariant breached: no adapter resolved on the execution path",
          trace,
          "device-adapters.dispatch",
          "no_adapter_on_execution_path",
        ),
      };
    }

    const executing = tracker.transition(
      command.idempotencyKey,
      "executing",
      inputs.executedAt,
      undefined,
      undefined,
      command.tenantId,
      command.correlationId,
    );
    if (!executing.ok) {
      return { ok: false, status: "incomplete", receipt, error: executing.error };
    }

    const outcome = adapter.invoke(
      { capability, payload: command.payload },
      {
        tenantId: command.tenantId,
        correlationId: command.correlationId,
        executedAt: inputs.executedAt,
        deviceId: adapter.descriptor.deviceId,
        policyGrant: inputs.policyGrant ?? false,
        policyCacheReady: inputs.policyCacheReady ?? false,
      },
    );

    const finalStatus: CommandStatus = outcome.ok ? "succeeded" : outcome.status;
    const terminal = tracker.transition(
      command.idempotencyKey,
      finalStatus,
      inputs.completedAt,
      outcome.evidence,
      outcome.ok ? undefined : outcome.error,
      command.tenantId,
      command.correlationId,
    );
    if (!terminal.ok) {
      return { ok: false, status: "incomplete", receipt, error: terminal.error };
    }
    const entry = tracker.lookup(command.tenantId, command.idempotencyKey);
    if (entry.result === undefined || entry.receipt === undefined) {
      return {
        ok: false,
        status: "incomplete",
        receipt,
        error: makeDomainError(
          ERROR_CODES.dispatchIncomplete,
          "internal dispatch invariant breached: terminal result not recorded after execution",
          trace,
          "device-adapters.dispatch",
          "result_missing_after_execution",
        ),
      };
    }
    if (outcome.ok) {
      return {
        ok: true,
        status: "succeeded",
        receipt: entry.receipt,
        result: entry.result,
        replayed: false,
      };
    }
    return {
      ok: false,
      status: outcome.status,
      receipt: entry.receipt,
      result: entry.result,
      replayed: false,
      error: outcome.error,
    };
  }

  /**
   * Adapter resolution: explicit adapterId first, then the target device,
   * then the singleton fallback (exactly one registered adapter for the
   * tenant). Zero or ambiguous registrations are refusals.
   */
  function resolveAdapter(
    tenantId: TenantId,
    capability: AdapterCapability,
    inputs: AdapterDispatchInputs,
    trace: ErrorTrace,
  ): { ok: true; adapter: EndpointAdapter } | { ok: false; error: FleetError } {
    if (inputs.adapterId !== undefined) {
      const adapter = registry.get(tenantId, inputs.adapterId);
      if (adapter === undefined) {
        return {
          ok: false,
          error: makeAdapterError(
            ERROR_CODES.adapterNotFound,
            `no adapter registered with id "${inputs.adapterId}" for this tenant`,
            trace,
            capability as string,
            "unknown",
            false,
            inputs.deviceId as string | undefined,
          ),
        };
      }
      return { ok: true, adapter };
    }
    if (inputs.deviceId !== undefined) {
      const adapter = registry.forDevice(tenantId, inputs.deviceId);
      if (adapter === undefined) {
        return {
          ok: false,
          error: makeAdapterError(
            ERROR_CODES.adapterNotFound,
            `no adapter registered for device ${inputs.deviceId as string} in this tenant`,
            trace,
            capability as string,
            "unknown",
            false,
            inputs.deviceId as string,
          ),
        };
      }
      return { ok: true, adapter };
    }
    const registered = registry.list(tenantId);
    if (registered.length === 1) {
      return { ok: true, adapter: registered[0] };
    }
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.dispatchTargetUnresolved,
        `dispatch target unresolved: ${registered.length} adapters registered for this tenant — pass deviceId or adapterId`,
        trace,
        [{ path: "/deviceId", reason: "target_unresolved" }],
      ),
    };
  }

  /**
   * Mirror a recorded terminal result for an idempotent replay. The
   * ORIGINAL result is returned verbatim — never re-executed.
   */
  function mirrorResult(
    result: CommandResult,
    receipt: CommandReceipt,
  ): AdapterDispatchOutcome {
    if (result.status === "succeeded") {
      return { ok: true, status: "succeeded", receipt, result, replayed: true };
    }
    if (result.status === "rejected" || result.status === "failed") {
      const error: FleetError =
        result.error ??
        makeDomainError(
          ERROR_CODES.dispatchIncomplete,
          `replayed ${result.status} result carries no error`,
          { tenantId: result.tenantId, correlationId: result.correlationId },
          "device-adapters.dispatch",
          "replayed_result_without_error",
        );
      return { ok: false, status: result.status, receipt, result, replayed: true, error };
    }
    // Non-terminal recorded statuses cannot occur through this
    // dispatcher; fail-safe rather than re-execute.
    return {
      ok: false,
      status: "incomplete",
      receipt,
      error: makeDomainError(
        ERROR_CODES.dispatchIncomplete,
        `replayed command result has non-terminal status ${result.status}`,
        { tenantId: result.tenantId, correlationId: result.correlationId },
        "device-adapters.dispatch",
        "replayed_result_non_terminal",
      ),
    };
  }

  return frozen({ dispatch }) as AdapterCommandDispatcher;
}
