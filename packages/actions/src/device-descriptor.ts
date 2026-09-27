/**
 * @fleetos/actions — D1: the device descriptor + DeviceRegistryView.
 *
 * Per `spec/MODULE-DEPENDENCY-MAP.md`, the actions -> devices module-map
 * edge is honored via the frozen contracts shapes only (the work order's
 * "depend on them via workspace:* imports only (module-map edges to
 * devices resolve via the frozen contracts shapes)" clause). This
 * package therefore declares a LOCAL `DeviceRegistryView` interface
 * that returns device descriptors carrying the FROZEN contracts shapes
 * (DeviceId, AdapterCapabilities, DeviceLifecycleState, TenantId) and
 * nothing else — a `@fleetos/device-model` `TwinStore` (W011, same lane
 * B) structurally satisfies this view at the binding site without a
 * src-import of `@fleetos/device-model`. The consumer's adapter (one
 * tiny function) projects only the fields the actions package needs;
 * the actions package never sees the full Twin aggregate.
 *
 * The descriptor's `adapterCapabilities` is the FROZEN
 * `AdapterCapabilities` shape — explicit capability flags only (per
 * `spec/ARCHITECTURE.md` § Device adapters: "Capability support is
 * explicit. Unsupported destructive behavior may never be emulated.").
 * Group selectors that filter by capability (the `byCapability`
 * selector) test these flags DIRECTLY against the frozen
 * `isSupported`/`assertSupported` helpers — no re-declaration.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type {
  AdapterCapabilities,
  DeviceId,
  DeviceLifecycleState,
  TenantId,
} from "@fleetos/contracts";

/**
 * The minimal device descriptor the actions package consumes. Carries
 * the FROZEN contracts shapes only: tenantId, deviceId, lifecycle state,
 * adapter capabilities, platform, ownership. The descriptor is the
 * projection of a Device Twin onto the fields the actions package needs
 * for group selection and capability-aware target resolution. The
 * consumer's adapter (a tiny function in the binding app) builds these
 * from the Twin's `identity` and `capabilities` sections.
 */
export interface DeviceDescriptor {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device identifier (branded from `@fleetos/contracts`). */
  readonly deviceId: DeviceId;
  /** The current lifecycle state (from the twin's identity section). */
  readonly lifecycleState: DeviceLifecycleState;
  /** The adapter's declared capability set (from the twin's capability section). */
  readonly adapterCapabilities: AdapterCapabilities;
  /** The platform family (e.g. "windows", "macos", "linux" — open string). */
  readonly platform?: string;
  /** The ownership model (open string; the policy rule model enumerates canonical values). */
  readonly ownership?: string;
}

/**
 * The minimal device registry view the actions package consumes.
 * Structurally compatible with `@fleetos/device-model`'s `TwinStore`
 * (W011) — same lane B — at the method signatures the actions package
 * actually uses: `list(tenantId)` returns twins; the actions package
 * projects them to `DeviceDescriptor`s via the consumer's adapter
 * function. The actions package never imports the Twin type; the
 * consumer supplies the projection at the binding site.
 *
 * Alternative: a consumer that already has a typed device registry can
 * implement this interface directly. The actions package treats the
 * registry as an opaque, tenant-scoped source of device descriptors.
 *
 * The view is INJECTED (not constructed inside the actions package):
 * this preserves the determinism contract (a test injects an in-memory
 * view with deterministic descriptors; production injects a real
 * registry adapter). The actions package never reads the clock and never
 * reaches across tenants — the view's `list` MUST return only the
 * devices of the supplied tenant.
 */
export interface DeviceRegistryView {
  /**
   * List the device descriptors of ONE tenant, sorted by deviceId for
   * deterministic iteration. Never crosses tenants. The actions
   * package relies on this sort order for byte-identical target
   * resolution across runs.
   *
   * @param tenantId the tenant scope (only this tenant's devices).
   * @returns a frozen readonly array of descriptors, sorted by deviceId.
   */
  list(tenantId: TenantId): readonly DeviceDescriptor[];
  /**
   * Get the descriptor for a single (tenantId, deviceId). Foreign-tenant
   * lookups MUST return `undefined` — there is no existence side channel.
   */
  get(tenantId: TenantId, deviceId: DeviceId): DeviceDescriptor | undefined;
  /** Does the (tenantId, deviceId) exist? Never crosses tenants. */
  has(tenantId: TenantId, deviceId: DeviceId): boolean;
}

/**
 * Build a `DeviceRegistryView` from an in-memory set of descriptors.
 * Storage is partitioned by tenant; `list` returns descriptors sorted
 * by deviceId (as a string), so iteration order is stable across runs
 * and across insertion orders. Pure and deterministic.
 *
 * @param descriptors the descriptors to seed the view with
 * @returns a frozen DeviceRegistryView
 */
export function createInMemoryDeviceRegistryView(
  descriptors: readonly DeviceDescriptor[] = [],
): DeviceRegistryView {
  /** Keyed by `${tenantId}\u0000${deviceId}` so ids cannot collide across tenants. */
  const byKey = new Map<string, DeviceDescriptor>();
  /** tenantId -> DeviceDescriptor[] */
  const byTenant = new Map<string, DeviceDescriptor[]>();
  for (const d of descriptors) {
    if (typeof d.tenantId !== "string" || d.tenantId.length === 0) {
      throw new Error("DeviceRegistryView: descriptor requires a non-empty tenantId");
    }
    if (typeof d.deviceId !== "string" || d.deviceId.length === 0) {
      throw new Error("DeviceRegistryView: descriptor requires a non-empty deviceId");
    }
    const key = `${d.tenantId as string}\u0000${d.deviceId as string}`;
    byKey.set(key, d);
    let bucket = byTenant.get(d.tenantId as string);
    if (bucket === undefined) {
      bucket = [];
      byTenant.set(d.tenantId as string, bucket);
    }
    bucket.push(d);
  }
  // Pre-sort per-tenant buckets by deviceId for deterministic listing.
  for (const [tenantId, bucket] of byTenant) {
    bucket.sort((a, b) =>
      (a.deviceId as string) < (b.deviceId as string)
        ? -1
        : (a.deviceId as string) > (b.deviceId as string)
          ? 1
          : 0,
    );
    byTenant.set(tenantId, bucket);
  }
  return Object.freeze({
    list(tenantId: TenantId): readonly DeviceDescriptor[] {
      const bucket = byTenant.get(tenantId as string);
      if (bucket === undefined) return Object.freeze([]);
      return Object.freeze([...bucket]);
    },
    get(tenantId: TenantId, deviceId: DeviceId): DeviceDescriptor | undefined {
      const key = `${tenantId as string}\u0000${deviceId as string}`;
      return byKey.get(key);
    },
    has(tenantId: TenantId, deviceId: DeviceId): boolean {
      const key = `${tenantId as string}\u0000${deviceId as string}`;
      return byKey.has(key);
    },
  });
}
