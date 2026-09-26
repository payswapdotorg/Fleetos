/**
 * @fleetos/contracts — Device lifecycle + adapter capability contract.
 *
 * The canonical durable object is the Fleet Device Twin. Its lifecycle is
 * the spine of the FleetOS control loop (per `spec/ARCHITECTURE.md`
 * § Device lifecycle and § Device adapters, and `spec/ARCHITECTURE-LOCK.md`
 * item 2: "Device Twin is the canonical durable representation").
 *
 * Device adapters expose a normalized capability set; capability support
 * is explicit. Unsupported destructive behavior may never be emulated
 * (per `spec/ARCHITECTURE.md` § Device adapters and
 * `spec/ARCHITECTURE-LOCK.md` item 16: "Destructive actions require an
 * explicit policy grant and evidence trail").
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

// ---------------------------------------------------------------------------
// Device lifecycle states (verbatim from spec/ARCHITECTURE.md)
// ---------------------------------------------------------------------------

export const ENROLL = "ENROLL" as const;
export const OBSERVE = "OBSERVE" as const;
export const ASSESS = "ASSESS" as const;
export const DIAGNOSE = "DIAGNOSE" as const;
export const PLAN = "PLAN" as const;
export const AUTHORIZE = "AUTHORIZE" as const;
export const EXECUTE = "EXECUTE" as const;
export const VERIFY = "VERIFY" as const;
export const LEARN = "LEARN" as const;

/**
 * The device lifecycle state, per `spec/ARCHITECTURE.md` § Device lifecycle:
 *
 *   ENROLL -> OBSERVE -> ASSESS -> DIAGNOSE -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> LEARN
 *
 * The full cycle is a strict linear progression. Devices may not skip
 * states (e.g., a freshly-enrolled device cannot AUTHORIZE before
 * OBSERVE).
 */
export type DeviceLifecycleState =
  | typeof ENROLL
  | typeof OBSERVE
  | typeof ASSESS
  | typeof DIAGNOSE
  | typeof PLAN
  | typeof AUTHORIZE
  | typeof EXECUTE
  | typeof VERIFY
  | typeof LEARN;

/**
 * The canonical lifecycle order. Useful for assertions, indexing, and
 * "is the device past state X?" queries.
 */
export const DEVICE_LIFECYCLE_ORDER: readonly DeviceLifecycleState[] = Object.freeze([
  ENROLL,
  OBSERVE,
  ASSESS,
  DIAGNOSE,
  PLAN,
  AUTHORIZE,
  EXECUTE,
  VERIFY,
  LEARN,
]);

/**
 * The transition table. The lifecycle is a strict linear progression: each
 * non-terminal state may transition only to the next state in
 * `DEVICE_LIFECYCLE_ORDER`. `LEARN` is the terminal state (no outgoing
 * transitions) — though a device that has LEARNED re-enters OBSERVE on the
 * next observation cycle (the loop is closed via observation ingestion,
 * not via a LEARN -> OBSERVE transition in this table).
 *
 * If a future ADR adds re-enrollment (LEARN -> ENROLL) or a terminal
 * RETIRED state, this table is the single source of truth.
 */
export const DEVICE_LIFECYCLE_TRANSITIONS: Readonly<Record<DeviceLifecycleState, readonly DeviceLifecycleState[]>> =
  Object.freeze({
    [ENROLL]: Object.freeze([OBSERVE]),
    [OBSERVE]: Object.freeze([ASSESS]),
    [ASSESS]: Object.freeze([DIAGNOSE]),
    [DIAGNOSE]: Object.freeze([PLAN]),
    [PLAN]: Object.freeze([AUTHORIZE]),
    [AUTHORIZE]: Object.freeze([EXECUTE]),
    [EXECUTE]: Object.freeze([VERIFY]),
    [VERIFY]: Object.freeze([LEARN]),
    [LEARN]: Object.freeze([]),
  });

/**
 * Pure transition predicate for the device lifecycle.
 *
 * @param from current state
 * @param to proposed next state
 * @returns true if the transition is legal
 */
export function canTransitionDevice(from: DeviceLifecycleState, to: DeviceLifecycleState): boolean {
  const allowed = DEVICE_LIFECYCLE_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Pure helper: returns the index of a lifecycle state in
 * `DEVICE_LIFECYCLE_ORDER`. Useful for "is the device past state X?"
 * queries (compare indices).
 *
 * @param state the lifecycle state
 * @returns the 0-indexed position, or -1 if unknown
 */
export function lifecycleIndex(state: DeviceLifecycleState): number {
  return DEVICE_LIFECYCLE_ORDER.indexOf(state);
}

// ---------------------------------------------------------------------------
// Adapter capability contract
// ---------------------------------------------------------------------------

/**
 * The explicit capability set exposed by a normalized Device Adapter
 * (per `spec/ARCHITECTURE.md` § Device adapters):
 *
 *   identify, observe, diagnose, enforce, remediate, lock, locate, wipe,
 *   reboot, update, health.
 *
 * These are the only capabilities a FleetOS Device Adapter may declare.
 * Capability support is explicit: an adapter MUST declare each supported
 * capability as `true`. Declaring a capability as `false` is equivalent
 * to omitting it — both mean "unsupported" — but the `false` form is
 * useful for adapter manifests that enumerate the full set for audit.
 *
 * Unsupported destructive behavior may NEVER be emulated (per
 * `spec/ARCHITECTURE.md` § Device adapters and `spec/ARCHITECTURE-LOCK.md`
 * item 16). Use `assertSupported()` to gate destructive actions: if the
 * capability is not declared, the action MUST be refused — never silently
 * emulated via a different code path.
 */
export interface AdapterCapabilities {
  readonly identify?: boolean;
  readonly observe?: boolean;
  readonly diagnose?: boolean;
  readonly enforce?: boolean;
  readonly remediate?: boolean;
  readonly lock?: boolean;
  readonly locate?: boolean;
  readonly wipe?: boolean;
  readonly reboot?: boolean;
  readonly update?: boolean;
  readonly health?: boolean;
}

/**
 * The full list of capability names. Useful for iterating, manifest
 * validation, and audit.
 */
export const ALL_ADAPTER_CAPABILITIES: readonly (keyof AdapterCapabilities)[] = Object.freeze([
  "identify",
  "observe",
  "diagnose",
  "enforce",
  "remediate",
  "lock",
  "locate",
  "wipe",
  "reboot",
  "update",
  "health",
]);

/**
 * The set of capabilities that are considered DESTRUCTIVE. These require
 * an explicit policy grant AND an evidence trail before invocation
 * (`spec/ARCHITECTURE-LOCK.md` item 16). The set is intentionally
 * conservative: any capability that can mutate device state, destroy
 * data, or expose location is destructive.
 */
export const DESTRUCTIVE_CAPABILITIES: readonly (keyof AdapterCapabilities)[] = Object.freeze([
  "enforce",
  "remediate",
  "lock",
  "locate",
  "wipe",
  "reboot",
  "update",
]);

/**
 * Pure helper: is the given capability supported by the given adapter
 * capability set?
 *
 * @param capability the capability to test
 * @param flags the adapter's declared capabilities
 * @returns true if the capability is explicitly supported
 */
export function isSupported(
  capability: keyof AdapterCapabilities,
  flags: AdapterCapabilities,
): boolean {
  return flags[capability] === true;
}

/**
 * Pure helper: is the given capability destructive?
 *
 * @param capability the capability to test
 * @returns true if the capability is in `DESTRUCTIVE_CAPABILITIES`
 */
export function isDestructive(capability: keyof AdapterCapabilities): boolean {
  return DESTRUCTIVE_CAPABILITIES.includes(capability);
}

/**
 * The result of an `assertSupported` call. Tagged-union so callers can
 * branch on the failure mode without try/catch.
 */
export type CapabilityAssertion =
  | { ok: true }
  | { ok: false; reason: "unsupported"; capability: keyof AdapterCapabilities }
  | { ok: false; reason: "destructive_unauthorized"; capability: keyof AdapterCapabilities };

/**
 * Assert that a capability is supported by the adapter, and — if the
 * capability is destructive — that the caller has the necessary policy
 * grant. Returns a tagged result; does NOT throw.
 *
 * **Critical invariant**: this function never returns `ok: true` for an
 * unsupported capability. Unsupported destructive behavior may NEVER be
 * emulated. If the caller receives `{ ok: false, reason: "unsupported" }`,
 * the action MUST be refused — never silently emulated via a different
 * code path.
 *
 * @param capability the capability being invoked
 * @param flags the adapter's declared capabilities
 * @param policyGrant a boolean indicating whether the caller has an
 *   explicit policy grant for this destructive capability. Ignored for
 *   non-destructive capabilities.
 * @returns the assertion result
 */
export function assertSupported(
  capability: keyof AdapterCapabilities,
  flags: AdapterCapabilities,
  policyGrant?: boolean,
): CapabilityAssertion {
  if (!isSupported(capability, flags)) {
    return { ok: false, reason: "unsupported", capability };
  }
  if (isDestructive(capability) && policyGrant !== true) {
    return { ok: false, reason: "destructive_unauthorized", capability };
  }
  return { ok: true };
}
