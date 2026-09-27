/**
 * @fleetos/device-adapters — W020 D4: Adapter registry.
 *
 * Registration and lookup of endpoint adapters, scoped by tenant. The
 * registry is the device/platform routing table the command dispatcher
 * (see `dispatch.ts`) resolves adapters from:
 *
 *   - `register`     — structural validation + conflict detection
 *                      (adapterId unique per tenant; one adapter per
 *                      (tenant, device) endpoint).
 *   - `get`          — lookup by tenant + adapterId.
 *   - `forDevice`    — lookup by tenant + device (the endpoint).
 *   - `forPlatform`  — lookup by tenant + platform (windows/macos/linux).
 *   - `list`         — all adapters registered for a tenant.
 *
 * Tenant isolation is STRUCTURAL: every lookup goes through a
 * per-tenant namespace (nested maps, no composite keys), so a tenant-B
 * lookup cannot observe a tenant-A registration — foreign adapter ids
 * are indistinguishable from unknown ones. Cross-tenant unregister
 * behaves identically (unknown). Listing order is registration order.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads — every timestamp is injected by the caller.
 */

import { ALL_ADAPTER_CAPABILITIES, type FleetError } from "@fleetos/contracts";
import type { TenantId, DeviceId, CorrelationId } from "@fleetos/contracts";
import type { AdapterId, EndpointAdapter } from "./adapter";
import type { AdapterPlatform } from "./seams";
import { ADAPTER_PLATFORMS } from "./seams";
import {
  ERROR_CODES,
  frozen,
  frozenArray,
  makeConflictError,
  makeDomainError,
  makeValidationError,
} from "./internal";
import type { ErrorTrace } from "./internal";

// ---------------------------------------------------------------------------
// D4.1 — Registration result
// ---------------------------------------------------------------------------

/**
 * The result of a registry `register` call. Either the adapter was
 * registered or a `FleetError` explains the refusal:
 *
 *   - ValidationError — the adapter is structurally invalid (missing
 *     descriptor fields, unknown platform, no invoke function, ...).
 *   - ConflictError  — the adapterId is already registered for this
 *     tenant, or another adapter already fronts the (tenant, device)
 *     endpoint.
 */
export type AdapterRegistrationResult =
  | { ok: true; adapter: EndpointAdapter }
  | { ok: false; error: FleetError };

/**
 * The result of a registry `unregister` call. Refused with a DomainError
 * (adapter not found — including cross-tenant, which is indistinguishable
 * from unknown).
 */
export type AdapterUnregistrationResult = { ok: true } | { ok: false; error: FleetError };

// ---------------------------------------------------------------------------
// D4.2 — Registry interface
// ---------------------------------------------------------------------------

/**
 * The endpoint adapter registry. Tenant-scoped lookups; listing order is
 * registration order. In-memory; durable persistence is the runtime's
 * responsibility.
 */
export interface AdapterRegistry {
  /**
   * Register an endpoint adapter. Structurally validates the adapter,
   * then enforces uniqueness: the adapterId must be unused within the
   * tenant, and no other adapter may front the same (tenant, device)
   * endpoint.
   */
  register(adapter: EndpointAdapter): AdapterRegistrationResult;
  /**
   * Unregister an adapter by tenant + adapterId. Unknown ids (including
   * foreign-tenant ids, which are indistinguishable from unknown) are
   * refused with a DomainError.
   */
  unregister(tenantId: TenantId, adapterId: AdapterId): AdapterUnregistrationResult;
  /** Look up an adapter by tenant + adapterId. */
  get(tenantId: TenantId, adapterId: AdapterId): EndpointAdapter | undefined;
  /** Look up the adapter fronting a tenant's device. */
  forDevice(tenantId: TenantId, deviceId: DeviceId): EndpointAdapter | undefined;
  /** All adapters registered for a tenant on a platform (registration order). */
  forPlatform(tenantId: TenantId, platform: AdapterPlatform): readonly EndpointAdapter[];
  /** All adapters registered for a tenant (registration order). */
  list(tenantId: TenantId): readonly EndpointAdapter[];
  /** Total number of registered adapters (across all tenants). */
  size(): number;
}

// ---------------------------------------------------------------------------
// D4.3 — Factory
// ---------------------------------------------------------------------------

interface RegistryEntry {
  readonly adapter: EndpointAdapter;
}

const NO_TRACE: ErrorTrace = {
  tenantId: "" as TenantId,
  correlationId: "" as CorrelationId,
};

/**
 * Create an empty endpoint adapter registry.
 */
export function createAdapterRegistry(): AdapterRegistry {
  // Per-tenant namespaces (nested maps — no composite keys, structural
  // tenant isolation even against ids containing separators).
  const byTenant = new Map<string, Map<AdapterId, RegistryEntry>>();
  const devicesByTenant = new Map<string, Map<DeviceId, RegistryEntry>>();

  function tenantNamespace(tenantId: TenantId): Map<AdapterId, RegistryEntry> {
    let namespace = byTenant.get(tenantId as string);
    if (namespace === undefined) {
      namespace = new Map<AdapterId, RegistryEntry>();
      byTenant.set(tenantId as string, namespace);
    }
    return namespace;
  }

  function deviceNamespace(tenantId: TenantId): Map<DeviceId, RegistryEntry> {
    let namespace = devicesByTenant.get(tenantId as string);
    if (namespace === undefined) {
      namespace = new Map<DeviceId, RegistryEntry>();
      devicesByTenant.set(tenantId as string, namespace);
    }
    return namespace;
  }

  /**
   * Structural validation of an endpoint adapter. Collects every failure
   * (field-level paths) so registration refusals are actionable.
   */
  function validateStructure(
    adapter: EndpointAdapter,
  ): { ok: true } | { ok: false; error: ReturnType<typeof makeValidationError> } {
    if (adapter === undefined || typeof adapter !== "object" || adapter === null) {
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.adapterRegistrationInvalid,
          "adapter must be an object implementing EndpointAdapter",
          NO_TRACE,
          [{ path: "/", reason: "not_an_adapter" }],
        ),
      };
    }
    const failures: { path: string; reason: string }[] = [];
    const descriptor = adapter.descriptor;
    if (descriptor === undefined || typeof descriptor !== "object") {
      failures.push({ path: "/descriptor", reason: "required" });
    } else {
      if (typeof descriptor.adapterId !== "string" || descriptor.adapterId.length === 0) {
        failures.push({ path: "/descriptor/adapterId", reason: "required" });
      }
      if (
        typeof descriptor.platform !== "string" ||
        !ADAPTER_PLATFORMS.includes(descriptor.platform as AdapterPlatform)
      ) {
        failures.push({ path: "/descriptor/platform", reason: "unknown_platform" });
      }
      if (descriptor.tenantId === undefined || (descriptor.tenantId as string).length === 0) {
        failures.push({ path: "/descriptor/tenantId", reason: "required" });
      }
      if (descriptor.deviceId === undefined || (descriptor.deviceId as string).length === 0) {
        failures.push({ path: "/descriptor/deviceId", reason: "required" });
      }
      if (typeof descriptor.adapterVersion !== "string" || descriptor.adapterVersion.length === 0) {
        failures.push({ path: "/descriptor/adapterVersion", reason: "required" });
      }
    }
    const capabilities = adapter.capabilities;
    if (capabilities === undefined || typeof capabilities !== "object") {
      failures.push({ path: "/capabilities", reason: "required" });
    } else if (!Array.isArray(capabilities.supported)) {
      failures.push({ path: "/capabilities/supported", reason: "required" });
    } else {
      for (const capability of capabilities.supported) {
        if (!ALL_ADAPTER_CAPABILITIES.includes(capability)) {
          failures.push({ path: "/capabilities/supported", reason: `unknown_capability:${String(capability)}` });
        }
      }
    }
    if (typeof adapter.invoke !== "function") {
      failures.push({ path: "/invoke", reason: "required_function" });
    }
    if (failures.length > 0) {
      const first = failures[0];
      const trace: ErrorTrace = {
        tenantId: (adapter?.descriptor?.tenantId ?? "") as TenantId,
        correlationId: "" as CorrelationId,
      };
      return {
        ok: false,
        error: makeValidationError(
          ERROR_CODES.adapterRegistrationInvalid,
          `adapter registration refused: ${failures.length} structural failure(s) (first: ${first.path} ${first.reason})`,
          trace,
          frozenArray(failures),
        ),
      };
    }
    return { ok: true };
  }

  function register(adapter: EndpointAdapter): AdapterRegistrationResult {
    const structure = validateStructure(adapter);
    if (!structure.ok) return { ok: false, error: structure.error };
    const { descriptor } = adapter;
    const trace: ErrorTrace = {
      tenantId: descriptor.tenantId,
      correlationId: "" as CorrelationId,
    };
    const namespace = tenantNamespace(descriptor.tenantId);
    if (namespace.has(descriptor.adapterId)) {
      return {
        ok: false,
        error: makeConflictError(
          ERROR_CODES.adapterRegistrationConflict,
          `adapter id "${descriptor.adapterId}" is already registered for this tenant`,
          trace,
          `adapter:${descriptor.tenantId as string}/${descriptor.adapterId}`,
        ),
      };
    }
    const devices = deviceNamespace(descriptor.tenantId);
    if (devices.has(descriptor.deviceId)) {
      return {
        ok: false,
        error: makeConflictError(
          ERROR_CODES.adapterRegistrationConflict,
          `device ${descriptor.deviceId as string} already has a registered adapter in this tenant (one adapter per endpoint)`,
          trace,
          `device:${descriptor.tenantId as string}/${descriptor.deviceId as string}`,
        ),
      };
    }
    const entry: RegistryEntry = { adapter };
    namespace.set(descriptor.adapterId, entry);
    devices.set(descriptor.deviceId, entry);
    return { ok: true, adapter };
  }

  function unregister(tenantId: TenantId, adapterId: AdapterId): AdapterUnregistrationResult {
    const namespace = byTenant.get(tenantId as string);
    const entry = namespace?.get(adapterId);
    if (namespace === undefined || entry === undefined) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.adapterNotFound,
          `no adapter registered with id "${adapterId}" for this tenant`,
          { tenantId, correlationId: "" as CorrelationId },
          "device-adapters.registry",
          "adapter_not_found",
        ),
      };
    }
    namespace.delete(adapterId);
    const devices = devicesByTenant.get(tenantId as string);
    devices?.delete(entry.adapter.descriptor.deviceId);
    if (namespace.size === 0) byTenant.delete(tenantId as string);
    if (devices !== undefined && devices.size === 0) devicesByTenant.delete(tenantId as string);
    return { ok: true };
  }

  function get(tenantId: TenantId, adapterId: AdapterId): EndpointAdapter | undefined {
    return byTenant.get(tenantId as string)?.get(adapterId)?.adapter;
  }

  function forDevice(tenantId: TenantId, deviceId: DeviceId): EndpointAdapter | undefined {
    return devicesByTenant.get(tenantId as string)?.get(deviceId)?.adapter;
  }

  function list(tenantId: TenantId): readonly EndpointAdapter[] {
    const namespace = byTenant.get(tenantId as string);
    if (namespace === undefined) return frozenArray([]);
    return frozenArray([...namespace.values()].map((entry) => entry.adapter));
  }

  function forPlatform(tenantId: TenantId, platform: AdapterPlatform): readonly EndpointAdapter[] {
    return frozenArray(list(tenantId).filter((adapter) => adapter.descriptor.platform === platform));
  }

  function size(): number {
    let total = 0;
    for (const namespace of byTenant.values()) total += namespace.size;
    return total;
  }

  return frozen({
    register,
    unregister,
    get,
    forDevice,
    forPlatform,
    list,
    size,
  }) as AdapterRegistry;
}
