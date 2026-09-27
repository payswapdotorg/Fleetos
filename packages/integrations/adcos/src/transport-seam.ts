/**
 * @fleetos/integration-adcos — D2: the injected transport seam.
 *
 * ALL transport goes through this typed, provider-neutral port — the
 * ADCOS edge of the adapter. The real ADCOS provider binding is a LATER
 * work item (W051 integration convergence); this package ships:
 *
 *   - the port TYPES (`AdcosTransportPort`) — typed request/response
 *     surfaces every provider binding must satisfy STRUCTURALLY
 *     (TypeScript structural typing; the reference implementation
 *     satisfies them, proven by test);
 *   - the machine-stable provider-refusal taxonomy
 *     (`AdcosProviderRefusalReason`);
 *   - an in-memory DETERMINISTIC reference implementation
 *     (`createInMemoryAdcosTransport`, `inmemory-transport.ts`) for
 *     tests: no real network I/O, no clock reads (every timestamp is
 *     injected by the caller), invocation recording.
 *
 * The boundary invariant (`spec/ARCHITECTURE-LOCK.md` items 7-8 +
 * `spec/integration/ADCOS.md` Invariant): provider topology, native
 * credentials and provider SDK objects NEVER cross this seam. The
 * request/response shapes are provider-neutral plain data; the only
 * provider-originated value type is the OPAQUE `AdcosProviderHandle`
 * (a branded string). The gate and adoption paths ENFORCE the boundary
 * at runtime (`provider-boundary.ts`) — a non-neutral provider value is
 * refused with a machine-stable reason, never recorded.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, CausationId } from "@fleetos/contracts";
import type { AdcosConnectivityRequest } from "./request-model";
import type {
  AcceptedConnectivityRequirements,
  AdcosStatusReport,
  ConnectivityExecutionState,
} from "./status-model";
import type { AdcosProviderHandle } from "./provider-boundary";
import { frozen } from "./internal";

// ---------------------------------------------------------------------------
// The transport options (injected time + traceability)
// ---------------------------------------------------------------------------

/** Options for every transport call — timestamps injected, never read. */
export interface AdcosTransportOptions {
  /** The injected call instant (ISO 8601) — no clock reads. */
  readonly at: string;
  /** The correlation id of the originating request. */
  readonly correlationId: CorrelationId;
  /** The causation id, when the call is caused by a specific command/event. */
  readonly causationId?: CausationId;
}

// ---------------------------------------------------------------------------
// The machine-stable provider-refusal taxonomy
// ---------------------------------------------------------------------------

/**
 * The machine-stable reasons a provider may refuse a submission or
 * termination. A refusal is a typed, machine-stable result — never an
 * exception, never free text.
 */
export type AdcosProviderRefusalReason =
  | "unsupported_outcome"
  | "constraint_unsatisfiable"
  | "capacity_exhausted"
  | "tenant_not_registered"
  | "malformed_request";

/** The full refusal-reason set, for validation + iteration. */
export const ALL_ADCOS_PROVIDER_REFUSAL_REASONS: readonly AdcosProviderRefusalReason[] =
  Object.freeze([
    "unsupported_outcome",
    "constraint_unsatisfiable",
    "capacity_exhausted",
    "tenant_not_registered",
    "malformed_request",
  ]);

/** A typed provider refusal (machine-stable reason + optional detail). */
export interface AdcosProviderRefusal {
  readonly reason: AdcosProviderRefusalReason;
  readonly detail?: string;
}

/** Construct a frozen provider refusal. */
export function makeAdcosProviderRefusal(refusal: AdcosProviderRefusal): AdcosProviderRefusal {
  return frozen({ ...refusal });
}

// ---------------------------------------------------------------------------
// The submission ack (provider-neutral)
// ---------------------------------------------------------------------------

/**
 * The provider-neutral acknowledgment of a submitted connectivity
 * request: the opaque handle + the assigned connectivity id + the
 * initial execution state + the accepted-requirements echo (the
 * provider's typed commitment — what the connectivity contract
 * actually covers).
 */
export interface AdcosSubmissionAcceptance {
  readonly ok: true;
  /** The opaque provider handle (subsequent status fetches/termination). */
  readonly handle: AdcosProviderHandle;
  /** The provider-assigned connectivity contract id. */
  readonly connectivityId: string;
  /** The initial execution state. */
  readonly initialState: ConnectivityExecutionState;
  /** The accepted-requirements echo. */
  readonly acceptedRequirements: AcceptedConnectivityRequirements;
}

/** The tagged submission result: acceptance or typed refusal. */
export type AdcosSubmissionAck = AdcosSubmissionAcceptance | { readonly ok: false; readonly refusal: AdcosProviderRefusal };

// ---------------------------------------------------------------------------
// The termination ack
// ---------------------------------------------------------------------------

/** The tagged termination result: the final status report or a typed refusal. */
export type AdcosTerminationAck =
  | { readonly ok: true; readonly finalReport: AdcosStatusReport }
  | { readonly ok: false; readonly refusal: AdcosProviderRefusal };

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * The provider-neutral ADCOS transport port — the injected seam. Every
 * provider binding satisfies this interface STRUCTURALLY; the
 * in-memory reference implementation is the deterministic test double
 * (no network I/O, no clock reads — every timestamp is injected through
 * the options).
 */
export interface AdcosTransportPort {
  /**
   * Submit a translated connectivity request. Pure with respect to
   * injected time; returns a typed acceptance or a machine-stable
   * refusal — never throws for provider-side outcomes.
   */
  submit(request: AdcosConnectivityRequest, options: AdcosTransportOptions): AdcosSubmissionAck;
  /**
   * Fetch the current provider-side status report for a handle.
   * Returns `null` when the handle is unknown to the provider
   * (indistinguishable from a foreign handle — the provider never
   * discloses other tenants' state).
   */
  fetchStatus(
    handle: AdcosProviderHandle,
    options: AdcosTransportOptions,
  ): AdcosStatusReport | null;
  /**
   * Request tenant-initiated termination. Returns the final status
   * report (executionState TERMINATED) or a machine-stable refusal.
   */
  terminate(
    handle: AdcosProviderHandle,
    options: AdcosTransportOptions,
  ): AdcosTerminationAck;
}
