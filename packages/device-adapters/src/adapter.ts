/**
 * @fleetos/device-adapters — W020 D1: Normalized endpoint adapter contract.
 *
 * The platform-agnostic `EndpointAdapter` — ONE interface the platform
 * seams implement. Per `spec/ARCHITECTURE.md` § Device adapters, an
 * adapter exposes the normalized capability set:
 *
 *   identify, observe, diagnose, enforce, remediate, lock, locate, wipe,
 *   reboot, update, health.
 *
 * The interface carries one METHOD per normalized capability plus a
 * generic `invoke()` router, so capability-aware dispatch can map a
 * command onto the right adapter method. Every method is built on the
 * W010 runtime pieces:
 *
 *   - the capability record      (`DeclaredAgentCapabilities`,
 *     `declareAgentCapabilities` — W010 D2),
 *   - the observation producer   (`ObservationCollector` — W010 D3, used
 *     by `observe`),
 *   - the command failure mapper (`mapAgentFailure` — W010 D4, the seam
 *     where adapter failures become first-class FleetErrors).
 *
 * D3 — capability negotiation is enforced INSIDE every method: the
 * frozen `assertSupported` semantics (via W010 `negotiateCapability`)
 * refuse unsupported capabilities and destructive capabilities without
 * an explicit, cache-fresh policy grant. A refused invocation NEVER
 * reaches the platform seam — unsupported destructive behavior may
 * NEVER be emulated (ARCHITECTURE-LOCK.md item 16).
 *
 * Tenant isolation is enforced at the action boundary: a context whose
 * tenant does not match the adapter's descriptor tenant is refused with
 * an AuthorizationError before any seam call.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every timestamp is injected by the caller.
 */

import {
  ALL_ADAPTER_CAPABILITIES,
  isSupported,
  type AdapterCapabilities,
  type EvidenceRef,
  type FleetError,
  type ObservationBatch,
} from "@fleetos/contracts";
import type { CorrelationId, DeviceId, TenantId } from "@fleetos/contracts";
import { declareAgentCapabilities, negotiateCapability } from "./capabilities";
import type { DeclaredAgentCapabilities } from "./capabilities";
import { createObservationCollector } from "./observations";
import type { ObservationCollector, ObservationRecord } from "./observations";
import { mapAgentFailure } from "./commands";
import type { AdapterPlatform, PlatformSeams } from "./seams";
import { ADAPTER_PLATFORMS, isAdapterPlatform } from "./seams";
import {
  ERROR_CODES,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeAuthorizationError,
  makeValidationError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D1.1 — Capability + adapter identifiers
// ---------------------------------------------------------------------------

/**
 * A normalized adapter capability name — the keys of the frozen
 * `AdapterCapabilities` from `@fleetos/contracts` (the eleven
 * capabilities from `spec/ARCHITECTURE.md` § Device adapters).
 */
export type AdapterCapability = keyof AdapterCapabilities;

/**
 * An adapter identifier. Unique within a tenant's adapter registry
 * (see `registry.ts`); plain string — registry-local, not a cross-lane
 * branded contract id.
 */
export type AdapterId = string;

/**
 * The adapter's endpoint descriptor. Binds the adapter to one device
 * under one tenant on one platform. The registry keys registrations on
 * these fields.
 */
export interface EndpointAdapterDescriptor {
  /** Unique adapter id (within the tenant's registry). */
  readonly adapterId: AdapterId;
  /** The platform this adapter fronts (must match the seam's platform). */
  readonly platform: AdapterPlatform;
  /** The tenant the adapter's endpoint belongs to. */
  readonly tenantId: TenantId;
  /** The device the adapter's endpoint is. */
  readonly deviceId: DeviceId;
  /** The adapter implementation version. */
  readonly adapterVersion: string;
}

// ---------------------------------------------------------------------------
// D1.2 — Invocation shapes
// ---------------------------------------------------------------------------

/**
 * The context every adapter operation runs under. Tenant-scoped and
 * traceable; carries the two policy inputs D3's negotiation needs:
 *
 *   - `policyGrant` — whether the caller has an explicit policy grant
 *     for a destructive capability.
 *   - `policyCacheReady` — whether the local signed-policy cache is
 *     fresh and signature-verified (W010 D5). When false, destructive
 *     capabilities are default-denied.
 */
export interface AdapterCommandContext {
  /** The tenant the invocation runs under (must match the descriptor). */
  readonly tenantId: TenantId;
  /** Correlation id (threads across the causal graph). */
  readonly correlationId: CorrelationId;
  /** ISO 8601 timestamp of this operation (injected; never the clock). */
  readonly executedAt: string;
  /** Optional device id override (default: the descriptor's deviceId). */
  readonly deviceId?: DeviceId;
  /** Explicit policy grant for a destructive capability. */
  readonly policyGrant: boolean;
  /** Whether the local signed-policy cache is fresh + verified. */
  readonly policyCacheReady: boolean;
}

/**
 * The operation request passed to a capability method. The payload is
 * OPAQUE to the SDK — the platform seam interprets it.
 */
export interface AdapterOperationRequest {
  /** Opaque, JSON-serializable operation payload. */
  readonly payload?: unknown;
}

/**
 * The generic invocation request for `invoke()`: the capability plus the
 * opaque operation payload. The router dispatches to the capability's
 * method.
 */
export interface AdapterInvocationRequest extends AdapterOperationRequest {
  /** The normalized capability to invoke. */
  readonly capability: AdapterCapability;
}

/**
 * The normalized result envelope of an adapter operation. Tagged-union on
 * `ok`; the `status` mirrors the agent-side command statuses (W010 D4):
 *
 *   - `succeeded` — the platform executed the capability; evidence (and
 *     optionally output / an observation batch) are attached.
 *   - `rejected`  — the operation was REFUSED before execution
 *     (unsupported capability, destructive without grant / fresh cache,
 *     tenant mismatch, malformed request). The platform seam was never
 *     invoked. Never emulated.
 *   - `failed`    — the platform attempted execution and failed; the
 *     error is a FleetError mapped onto the contracts taxonomy.
 */
export type AdapterCommandOutcome =
  | {
      readonly ok: true;
      readonly status: "succeeded";
      readonly evidence: readonly EvidenceRef[];
      /** Opaque, JSON-serializable platform output. */
      readonly output?: unknown;
      /** The observation batch produced by `observe` (absent otherwise). */
      readonly batch?: ObservationBatch;
    }
  | {
      readonly ok: false;
      readonly status: "rejected" | "failed";
      readonly error: FleetError;
      readonly evidence: readonly EvidenceRef[];
    };

// ---------------------------------------------------------------------------
// D1.3 — The endpoint adapter interface
// ---------------------------------------------------------------------------

/**
 * The normalized endpoint adapter — ONE platform-agnostic interface the
 * platform seams (Windows/macOS/Linux) implement through
 * `createEndpointAdapter`. One method per normalized capability plus the
 * `invoke()` router.
 *
 * Capability support is EXPLICIT: each method consults the adapter's
 * declared capability record and refuses when the capability is not
 * declared — never emulated via a different code path.
 */
export interface EndpointAdapter {
  /** The endpoint this adapter fronts. */
  readonly descriptor: EndpointAdapterDescriptor;
  /** The declared capability record (W010 D2, built on contracts). */
  readonly capabilities: DeclaredAgentCapabilities;
  /** The observation batching producer backing `observe` (W010 D3). */
  readonly collector: ObservationCollector;
  /** Convenience accessor for `descriptor.platform`. */
  readonly platform: AdapterPlatform;

  // -- non-destructive capabilities -------------------------------------

  /** Identify the endpoint (identity inventory). */
  identify(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Poll the seam's observation sources and emit a batch (W010 D3). */
  observe(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Run a diagnostic routine on the endpoint. */
  diagnose(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Health check the endpoint. */
  health(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;

  // -- destructive capabilities (require grant + fresh policy cache) ----

  /** Enforce a configuration/compliance state on the endpoint. */
  enforce(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Remediate a finding on the endpoint. */
  remediate(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Lock the endpoint. */
  lock(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Locate the endpoint (location is destructive per contracts). */
  locate(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Wipe the endpoint. */
  wipe(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Reboot the endpoint. */
  reboot(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;
  /** Update software on the endpoint. */
  update(context: AdapterCommandContext, request?: AdapterOperationRequest): AdapterCommandOutcome;

  // -- generic router ----------------------------------------------------

  /**
   * Invoke a normalized capability by name. Dispatches to the matching
   * method above after validating the capability name. Refuses unknown
   * capability names with a ValidationError (malformed request).
   */
  invoke(
    request: AdapterInvocationRequest,
    context: AdapterCommandContext,
  ): AdapterCommandOutcome;
}

// ---------------------------------------------------------------------------
// D1.4 — Factory
// ---------------------------------------------------------------------------

/**
 * Options for `createEndpointAdapter`.
 */
export interface EndpointAdapterOptions {
  /** The endpoint descriptor (binds tenant, device, platform, version). */
  readonly descriptor: EndpointAdapterDescriptor;
  /** The platform seams the adapter routes through. */
  readonly seams: PlatformSeams;
  /** The frozen contracts capability flag set this adapter declares. */
  readonly capabilities: AdapterCapabilities;
  /** ISO 8601 timestamp of the capability declaration (injected). */
  readonly declaredAt: string;
  /** Optional injected observation collector (default: one is created). */
  readonly collector?: ObservationCollector;
  /** Optional collector id seed (default: the device id). */
  readonly observationIdSeed?: string;
  /** Optional collector max batch size (default: 500). */
  readonly maxBatchSize?: number;
}

const EMPTY_EVIDENCE: readonly EvidenceRef[] = frozenArray([]);

/**
 * Create a normalized `EndpointAdapter` from a descriptor, platform
 * seams, and the declared capability set. The adapter enforces D3's
 * negotiation inside every capability method (delegating to W010's
 * `negotiateCapability`, which delegates to the frozen
 * `assertSupported`), routes execution through the seam's normalized
 * command surface, and maps seam failures onto the FleetError taxonomy
 * via W010's `mapAgentFailure`.
 *
 * @throws Error when construction options are invalid (programmer
 *   error): descriptor fields empty, platform unknown or mismatched with
 *   the seams, `declaredAt` not ISO 8601.
 */
export function createEndpointAdapter(options: EndpointAdapterOptions): EndpointAdapter {
  const { descriptor, seams } = options;
  if (typeof descriptor.adapterId !== "string" || descriptor.adapterId.length === 0) {
    throw new Error("createEndpointAdapter: descriptor.adapterId must be a non-empty string");
  }
  if (typeof descriptor.adapterVersion !== "string" || descriptor.adapterVersion.length === 0) {
    throw new Error("createEndpointAdapter: descriptor.adapterVersion must be a non-empty string");
  }
  if (descriptor.tenantId === undefined || (descriptor.tenantId as string).length === 0) {
    throw new Error("createEndpointAdapter: descriptor.tenantId is required");
  }
  if (descriptor.deviceId === undefined || (descriptor.deviceId as string).length === 0) {
    throw new Error("createEndpointAdapter: descriptor.deviceId is required");
  }
  if (!isAdapterPlatform(descriptor.platform)) {
    throw new Error(
      `createEndpointAdapter: descriptor.platform must be one of ${ADAPTER_PLATFORMS.join("/")} (got "${descriptor.platform}")`,
    );
  }
  if (seams.platform !== descriptor.platform) {
    throw new Error(
      `createEndpointAdapter: seams.platform "${seams.platform}" does not match descriptor.platform "${descriptor.platform}"`,
    );
  }
  if (typeof options.declaredAt !== "string" || !looksLikeIso(options.declaredAt)) {
    throw new Error("createEndpointAdapter: declaredAt must be an ISO 8601 timestamp");
  }

  const declared = declareAgentCapabilities({
    tenantId: descriptor.tenantId,
    adapterFamily: descriptor.platform,
    capabilities: options.capabilities,
    declaredAt: options.declaredAt,
    deviceId: descriptor.deviceId,
  });
  const collector =
    options.collector ??
    createObservationCollector({
      tenantId: descriptor.tenantId,
      deviceId: descriptor.deviceId,
      idSeed: options.observationIdSeed,
      maxBatchSize: options.maxBatchSize,
    });

  function traceFor(context: AdapterCommandContext): ErrorTrace {
    return { tenantId: context.tenantId, correlationId: context.correlationId };
  }

  function refused(status: "rejected" | "failed", error: FleetError): AdapterCommandOutcome {
    return frozen({ ok: false as const, status, error, evidence: EMPTY_EVIDENCE });
  }

  /**
   * D3 gate: tenant isolation + capability negotiation. Returns the
   * refusal outcome, or `undefined` when the invocation may proceed.
   * Refused invocations NEVER reach the platform seam.
   */
  function negotiateOrRefuse(
    capability: AdapterCapability,
    context: AdapterCommandContext,
  ): AdapterCommandOutcome | undefined {
    const trace = traceFor(context);
    // 1. Tenant isolation at the action boundary: the context's tenant
    //    must match the adapter's descriptor tenant.
    if (context.tenantId !== descriptor.tenantId) {
      return refused(
        "rejected",
        makeAuthorizationError(
          ERROR_CODES.adapterTenantMismatch,
          `adapter ${descriptor.adapterId} serves tenant A but was invoked under a different tenant (tenant isolation)`,
          trace,
          descriptor.adapterId,
          `adapter.${capability as string}`,
          "tenant_mismatch",
        ),
      );
    }
    // 2. Capability negotiation — W010 D2 (frozen assertSupported inside):
    //    unsupported capabilities and destructive capabilities without an
    //    explicit, cache-fresh grant are refused. Never emulated.
    const negotiation = negotiateCapability(declared, {
      tenantId: context.tenantId,
      capability,
      policyGrant: context.policyGrant,
      policyCacheReady: context.policyCacheReady,
      correlationId: context.correlationId,
      deviceId: context.deviceId ?? descriptor.deviceId,
    });
    if (!negotiation.ok) {
      return refused("rejected", negotiation.error);
    }
    return undefined;
  }

  /**
   * Route a (non-observe) capability operation: negotiate, execute on
   * the seam, map failures onto the FleetError taxonomy.
   */
  function route(
    capability: AdapterCapability,
    context: AdapterCommandContext,
    request: AdapterOperationRequest | undefined,
  ): AdapterCommandOutcome {
    const refusal = negotiateOrRefuse(capability, context);
    if (refusal !== undefined) return refusal;

    const seamResult = seams.commands.execute({
      capability,
      payload: request?.payload,
    });
    if (seamResult.status === "failed") {
      const failure = seamResult.failure;
      const error = mapAgentFailure(
        failure?.kind ?? "adapter_internal",
        failure?.message ?? `platform command failed for capability "${capability as string}"`,
        traceFor(context),
        { capability: capability as string, adapterFamily: descriptor.platform, deviceId: descriptor.deviceId as string },
      );
      return frozen({
        ok: false as const,
        status: "failed" as const,
        error,
        evidence: seamResult.evidence,
      });
    }
    return frozen({
      ok: true as const,
      status: "succeeded" as const,
      evidence: seamResult.evidence,
      output: seamResult.output,
    });
  }

  /**
   * The observe operation: negotiate, drain the seam's observation
   * sources into the W010 collector (with mid-observe flush on
   * back-pressure), and flush a valid batch. A source record the
   * collector refuses fails the operation fail-closed (every
   * observation is schema-validated at the boundary).
   */
  function observe(
    context: AdapterCommandContext,
    request: AdapterOperationRequest | undefined,
  ): AdapterCommandOutcome {
    const refusal = negotiateOrRefuse("observe", context);
    if (refusal !== undefined) return refusal;

    const records: readonly ObservationRecord[] = seams.observationSources.poll();
    const batches: ObservationBatch[] = [];
    const evidence: EvidenceRef[] = [];
    let count = 0;

    // Flush the collector's pending observations, accumulating the batch
    // and its content-addressed evidence reference.
    function flushPending(): { ok: true } | { ok: false; error: FleetError } {
      if (collector.pending() === 0) return { ok: true };
      const flush = collector.flush(context.executedAt, context.correlationId);
      if (!flush.ok) return { ok: false, error: flush.error };
      batches.push(flush.batch);
      const canonical = canonicalJson(flush.batch);
      evidence.push(
        frozen<EvidenceRef>({
          key: `observations://${descriptor.deviceId as string}/${flush.digest}`,
          sizeBytes: canonical.length,
          hash: flush.digest,
          hashAlgorithm: "fnv1a32",
        }),
      );
      return { ok: true };
    }

    for (const record of records) {
      let recorded = collector.record(record);
      if (!recorded.ok && recorded.reason === "batch_full") {
        // Back-pressure: flush what we have, then retry the record.
        const flushed = flushPending();
        if (!flushed.ok) {
          return frozen({
            ok: false as const,
            status: "failed" as const,
            error: flushed.error,
            evidence: frozenArray(evidence),
          });
        }
        recorded = collector.record(record);
      }
      if (!recorded.ok) {
        // A malformed source record fails the observe fail-closed. The
        // records already collected remain pending in the collector for
        // the caller's diagnostics.
        return frozen({
          ok: false as const,
          status: "failed" as const,
          error: mapAgentFailure(
            "malformed_payload",
            `observation source produced a record the collector refused (${recorded.reason}${recorded.field ? ` at ${recorded.field}` : ""})`,
            traceFor(context),
            { capability: "observe", adapterFamily: descriptor.platform, deviceId: descriptor.deviceId as string },
          ),
          evidence: frozenArray(evidence),
        });
      }
      count += 1;
    }
    const finalFlush = flushPending();
    if (!finalFlush.ok) {
      return frozen({
        ok: false as const,
        status: "failed" as const,
        error: finalFlush.error,
        evidence: frozenArray(evidence),
      });
    }
    return frozen({
      ok: true as const,
      status: "succeeded" as const,
      evidence: frozenArray(evidence),
      batch: batches[0],
      output: frozen({ count, batches: batches.length }),
    });
  }

  // The dispatch table: every normalized capability routes to a method.
  const methods: Readonly<Record<AdapterCapability, (context: AdapterCommandContext, request: AdapterOperationRequest | undefined) => AdapterCommandOutcome>> = frozen({
    identify: (context, request) => route("identify", context, request),
    observe: (context, request) => observe(context, request),
    diagnose: (context, request) => route("diagnose", context, request),
    enforce: (context, request) => route("enforce", context, request),
    remediate: (context, request) => route("remediate", context, request),
    lock: (context, request) => route("lock", context, request),
    locate: (context, request) => route("locate", context, request),
    wipe: (context, request) => route("wipe", context, request),
    reboot: (context, request) => route("reboot", context, request),
    update: (context, request) => route("update", context, request),
    health: (context, request) => route("health", context, request),
  } as const);

  function invoke(
    request: AdapterInvocationRequest,
    context: AdapterCommandContext,
  ): AdapterCommandOutcome {
    if (
      request === undefined ||
      typeof request.capability !== "string" ||
      !ALL_ADAPTER_CAPABILITIES.includes(request.capability as AdapterCapability)
    ) {
      return refused(
        "rejected",
        makeValidationError(
          ERROR_CODES.adapterUnknownCapability,
          `unknown normalized capability: ${String(request?.capability)}`,
          traceFor(context),
          [{ path: "/capability", reason: "unknown_capability" }],
        ),
      );
    }
    const method = methods[request.capability as AdapterCapability];
    return method(context, request);
  }

  return frozen({
    descriptor,
    capabilities: declared,
    collector,
    platform: descriptor.platform,
    identify: (context, request) => route("identify", context, request),
    observe: (context, request) => observe(context, request),
    diagnose: (context, request) => route("diagnose", context, request),
    enforce: (context, request) => route("enforce", context, request),
    remediate: (context, request) => route("remediate", context, request),
    lock: (context, request) => route("lock", context, request),
    locate: (context, request) => route("locate", context, request),
    wipe: (context, request) => route("wipe", context, request),
    reboot: (context, request) => route("reboot", context, request),
    update: (context, request) => route("update", context, request),
    health: (context, request) => route("health", context, request),
    invoke,
  }) as EndpointAdapter;
}

// ---------------------------------------------------------------------------
// D1.5 — Capability probe helpers
// ---------------------------------------------------------------------------

/**
 * Probe the platform seam's currently available capabilities (the seam's
 * capability probe — D2). Discovery only: the adapter's DECLARED
 * capability record remains the explicit support contract that gates
 * routing (capability support is explicit, per the frozen contracts).
 */
export function probeCapabilities(seams: PlatformSeams): AdapterCapabilities {
  return seams.capabilityProbe.probe();
}

/**
 * The reconciliation of a platform probe against a declared capability
 * set. Diagnostic input for audit and check-in manifests.
 */
export interface CapabilityReconciliation {
  /** Capabilities both declared and probed. */
  readonly declaredAndProbed: readonly AdapterCapability[];
  /** Capabilities declared but NOT probed (declaration is authoritative; mismatch surfaced for audit). */
  readonly declaredOnly: readonly AdapterCapability[];
  /** Capabilities probed but NOT declared (inert — never routed). */
  readonly probedOnly: readonly AdapterCapability[];
  /** True when no capability is declared without probe backing. */
  readonly agrees: boolean;
}

/**
 * Reconcile a platform probe against a declared capability set. Pure.
 * The DECLARED set stays authoritative for routing/refusal (capability
 * support is explicit); a `declaredOnly` capability is surfaced here as
 * a probe-declared mismatch for audit — the seam will fail at execution
 * time if the platform truly cannot back it.
 */
export function reconcileProbedCapabilities(
  declared: AdapterCapabilities,
  probed: AdapterCapabilities,
): CapabilityReconciliation {
  const declaredAndProbed: AdapterCapability[] = [];
  const declaredOnly: AdapterCapability[] = [];
  const probedOnly: AdapterCapability[] = [];
  for (const capability of ALL_ADAPTER_CAPABILITIES) {
    const d = isSupported(capability, declared);
    const p = isSupported(capability, probed);
    if (d && p) declaredAndProbed.push(capability);
    else if (d) declaredOnly.push(capability);
    else if (p) probedOnly.push(capability);
  }
  return frozen({
    declaredAndProbed: frozenArray(declaredAndProbed),
    declaredOnly: frozenArray(declaredOnly),
    probedOnly: frozenArray(probedOnly),
    agrees: declaredOnly.length === 0,
  });
}
