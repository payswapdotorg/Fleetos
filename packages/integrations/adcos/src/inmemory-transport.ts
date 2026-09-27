/**
 * @fleetos/integration-adcos — D2: the in-memory DETERMINISTIC reference
 * transport.
 *
 * The reference implementation of `AdcosTransportPort` — the test-side
 * provider stand-in. Design rules (the W020 in-memory seam pattern):
 *
 *   - DETERMINISTIC: handles + connectivity ids are FNV-1a digests of
 *     the request content (the same request produces the same handle
 *     every run); NO `Math.random()`, NO `Date.now()` — every timestamp
 *     is injected by the caller through the options;
 *   - NO network I/O: everything is in-memory;
 *   - INVOCATION RECORDING: every submit/fetchStatus/terminate call is
 *     recorded (tests prove gated refusals NEVER reach the transport,
 *     and replayed submissions never re-execute);
 *   - PROGRAMMABLE: refusals are enqueued as a deterministic script
 *     (consumed in order); provider-side status reports are pushed and
 *     become fetchable by handle.
 *
 * The boundary discipline: everything this implementation returns is
 * provider-neutral plain data — no topology, no credentials, no SDK
 * objects (proven by the D2 boundary tests walking every produced
 * value).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AdcosConnectivityRequest } from "./request-model";
import type { AdcosStatusReport } from "./status-model";
import type { AdcosProviderHandle } from "./provider-boundary";
import { asAdcosProviderHandle } from "./provider-boundary";
import type {
  AdcosProviderRefusal,
  AdcosSubmissionAck,
  AdcosTerminationAck,
  AdcosTransportOptions,
  AdcosTransportPort,
} from "./transport-seam";
import { fnv1a32Hex, frozen, frozenArray } from "./internal";

// ---------------------------------------------------------------------------
// Invocation recording
// ---------------------------------------------------------------------------

/** A recorded submit call (the request + the injected options). */
export interface RecordedAdcosSubmit {
  readonly request: AdcosConnectivityRequest;
  readonly options: Readonly<AdcosTransportOptions>;
}

/** A recorded status-fetch call. */
export interface RecordedAdcosStatusFetch {
  readonly handle: AdcosProviderHandle;
  readonly options: Readonly<AdcosTransportOptions>;
}

/** A recorded termination call. */
export interface RecordedAdcosTermination {
  readonly handle: AdcosProviderHandle;
  readonly options: Readonly<AdcosTransportOptions>;
}

// ---------------------------------------------------------------------------
// The reference implementation
// ---------------------------------------------------------------------------

/** A programmable next-outcome for submit (acceptance or refusal). */
export type AdcosSubmitScriptEntry =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly refusal: AdcosProviderRefusal };

/**
 * The in-memory deterministic reference transport. Extends the neutral
 * `AdcosTransportPort` with programming + recording surfaces (test-side
 * only — a production binding implements the port, not this interface).
 */
export interface InMemoryAdcosTransport extends AdcosTransportPort {
  /** Every submit call, in order (the proof surface for gate tests). */
  readonly submissions: readonly RecordedAdcosSubmit[];
  /** Every status-fetch call, in order. */
  readonly statusFetches: readonly RecordedAdcosStatusFetch[];
  /** Every termination call, in order. */
  readonly terminations: readonly RecordedAdcosTermination[];
  /** Enqueue the next submit outcome(s) — consumed in order; default accept. */
  enqueueSubmitOutcome(entry: AdcosSubmitScriptEntry): void;
  /** Push a provider-side status report (becomes fetchable by its handle). */
  pushStatusReport(report: AdcosStatusReport): void;
}

/** Options for the reference transport (none required — fully deterministic). */
export interface InMemoryAdcosTransportOptions {
  /**
   * Initial submit refusals, enqueued in order (same as calling
   * `enqueueSubmitOutcome` per entry). Default: none (all accepted).
   */
  readonly submitScript?: readonly AdcosSubmitScriptEntry[];
}

/**
 * Create the in-memory deterministic reference transport. No network, no
 * clock: handles/connectivity ids are content digests of the request;
 * every reported instant is injected by the caller.
 *
 * @param opts optional programming (initial submit script)
 * @returns the frozen reference transport
 */
export function createInMemoryAdcosTransport(
  opts: InMemoryAdcosTransportOptions = {},
): InMemoryAdcosTransport {
  const submissions: RecordedAdcosSubmit[] = [];
  const statusFetches: RecordedAdcosStatusFetch[] = [];
  const terminations: RecordedAdcosTermination[] = [];
  const submitScript: AdcosSubmitScriptEntry[] = [...(opts.submitScript ?? [])];
  /** Provider-side state: handle -> latest status report. */
  const reportsByHandle = new Map<string, AdcosStatusReport>();
  /** Accepted connectivity: connectivityId -> handle (for idempotent resubmission detection). */
  const handleByConnectivityId = new Map<string, string>();

  const impl = {
    submit(request: AdcosConnectivityRequest, options: AdcosTransportOptions): AdcosSubmissionAck {
      submissions.push(frozen({ request, options: frozen({ ...options }) }));

      const next = submitScript.shift();
      if (next !== undefined && !next.accepted) {
        return frozen({ ok: false, refusal: frozen({ ...next.refusal }) });
      }

      // Deterministic provider identity: the handle + connectivity id are
      // content digests of the request (tenant-scoped — cross-tenant
      // requests with identical content produce distinct ids).
      const identity = fnv1a32Hex(
        `${request.tenantId}|${request.intentRef.intentId}|${request.requestDigest}`,
      );
      const handle = asAdcosProviderHandle(`adcos-h-${identity}`);
      const connectivityId = `adcos-c-${identity}`;

      // Idempotent resubmission of the SAME request: return the existing
      // handle (never re-provisions — mirrors the FleetOS idempotency
      // discipline at the provider edge).
      const existing = handleByConnectivityId.get(connectivityId);
      if (existing !== undefined) {
        const prior = reportsByHandle.get(existing);
        if (prior !== undefined) {
          return frozen({
            ok: true,
            handle: asAdcosProviderHandle(existing),
            connectivityId,
            initialState: prior.executionState,
            acceptedRequirements: prior.acceptedRequirements,
          });
        }
      }

      // The initial provider-side report (the accepted contract echo).
      const initialReport: AdcosStatusReport = frozen({
        connectivityId,
        handle,
        executionState: "PROVISIONING",
        acceptedRequirements: frozen({
          outcome: request.outcome.canonical,
          properties: request.properties,
          constraints: request.constraints,
          duration: request.duration,
          security: request.security,
        }),
        measurements: [],
        degradation: frozen({ kind: "none" }),
        failure: frozen({ kind: "none" }),
        termination: null,
        reportedAt: options.at,
      });
      reportsByHandle.set(handle, initialReport);
      handleByConnectivityId.set(connectivityId, handle);

      return frozen({
        ok: true,
        handle,
        connectivityId,
        initialState: "PROVISIONING",
        acceptedRequirements: initialReport.acceptedRequirements,
      });
    },

    fetchStatus(
      handle: AdcosProviderHandle,
      options: AdcosTransportOptions,
    ): AdcosStatusReport | null {
      statusFetches.push(frozen({ handle, options: frozen({ ...options }) }));
      const report = reportsByHandle.get(handle);
      return report === undefined ? null : report;
    },

    terminate(handle: AdcosProviderHandle, options: AdcosTransportOptions): AdcosTerminationAck {
      terminations.push(frozen({ handle, options: frozen({ ...options }) }));
      const report = reportsByHandle.get(handle);
      if (report === undefined) {
        return frozen({
          ok: false,
          refusal: frozen({ reason: "tenant_not_registered" as const, detail: "unknown handle" }),
        });
      }
      if (report.executionState === "TERMINATED") {
        // Terminating a terminated connectivity: idempotent — return the
        // final report unchanged (never a second termination record).
        return frozen({ ok: true, finalReport: report });
      }
      const finalReport: AdcosStatusReport = frozen({
        ...report,
        executionState: "TERMINATED",
        degradation: frozen({ kind: "none" }),
        termination: frozen({
          reason: "tenant_requested",
          terminatedAt: options.at,
        }),
        reportedAt: options.at,
      });
      reportsByHandle.set(handle, finalReport);
      return frozen({ ok: true, finalReport });
    },

    enqueueSubmitOutcome(entry: AdcosSubmitScriptEntry): void {
      submitScript.push(entry);
    },

    pushStatusReport(report: AdcosStatusReport): void {
      reportsByHandle.set(report.handle, report);
      handleByConnectivityId.set(report.connectivityId, report.handle);
    },
  };

  const transport: InMemoryAdcosTransport = frozen({
    ...impl,
    get submissions(): readonly RecordedAdcosSubmit[] {
      return frozenArray(submissions);
    },
    get statusFetches(): readonly RecordedAdcosStatusFetch[] {
      return frozenArray(statusFetches);
    },
    get terminations(): readonly RecordedAdcosTermination[] {
      return frozenArray(terminations);
    },
  });
  return transport;
}

// ---------------------------------------------------------------------------
// Deterministic provider-side report builder (test helper surface)
// ---------------------------------------------------------------------------

/** Options for `providerStatusReport` — every facet injected, no clock. */
export interface ProviderStatusReportInput {
  readonly connectivityId: string;
  readonly handle: AdcosProviderHandle;
  readonly executionState: AdcosStatusReport["executionState"];
  readonly acceptedRequirements: AdcosStatusReport["acceptedRequirements"];
  readonly measurements?: AdcosStatusReport["measurements"];
  readonly degradation?: AdcosStatusReport["degradation"];
  readonly failure?: AdcosStatusReport["failure"];
  readonly termination?: AdcosStatusReport["termination"];
  readonly reportedAt: string;
}

/**
 * Build a deterministic provider-side status report (the typed,
 * provider-neutral shape the transport returns). Every value is injected
 * — a pure constructor for tests and reference flows.
 */
export function providerStatusReport(input: ProviderStatusReportInput): AdcosStatusReport {
  return frozen({
    connectivityId: input.connectivityId,
    handle: input.handle,
    executionState: input.executionState,
    acceptedRequirements: input.acceptedRequirements,
    measurements: frozenArray(input.measurements ?? []),
    degradation: frozen({ ...(input.degradation ?? { kind: "none" as const }) }),
    failure: frozen({ ...(input.failure ?? { kind: "none" as const }) }),
    termination:
      input.termination === undefined || input.termination === null
        ? null
        : frozen({
            reason: input.termination.reason,
            terminatedAt: input.termination.terminatedAt,
          }),
    reportedAt: input.reportedAt,
  });
}
