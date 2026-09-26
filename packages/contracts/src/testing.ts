/**
 * @fleetos/contracts/testing — Deterministic, seeded fixture builders.
 *
 * This module is published under the package subpath `"./testing"` (see
 * `packages/contracts/package.json` `exports`). Wave 1 workers import it
 * from their contract tests via:
 *
 *   `import { makeEventEnvelope, makeIntent, ... } from "@fleetos/contracts/testing";`
 *
 * # Design rules (W003 D2)
 *
 *  1. **Deterministic.** Every builder accepts a `seed` (number or string).
 *     The same seed produces the same values, byte-for-byte, every run.
 *     No `Math.random()`, no `Date.now()`, no `crypto.randomBytes()`,
 *     no `process.hrtime`, no other clock/entropy source is consulted.
 *     Timestamps are *injected* (a fixed base timestamp plus a
 *     seed-derived offset).
 *
 *  2. **Valid by construction.** Each envelope/command/intent produced by
 *     a builder satisfies the W002 invariants
 *     (`validateEnvelope`/`validateCommand`/`validateObservationBatch`/
 *     `validateTenantRef`). The fixture is a *valid* sample, not a random
 *     blob. Tests that need to assert invariants on the fixture output can
 *     do so directly.
 *
 *  3. **No network, no clock.** The module is pure: importing it has no
 *     side effects; calling a builder does not touch the filesystem, the
 *     network, or the system clock.
 *
 *  4. **No cross-tenant leakage.** A `seed` and an explicit `tenantId`
 *     produce fixtures scoped to that tenant. Builders never silently mix
 *     tenants — a fixture produced with tenant A will reference only
 *     tenant A's identifiers. (See `docs/tech-lead/FIXTURES.md`.)
 *
 *  5. **No `any` in public signatures.** Strict TS, like the rest of the
 *     contracts package.
 *
 * The PRNG is a tiny xorshift32 — zero dependencies, fully deterministic,
 * good enough for fixture generation (we are not doing cryptography
 * here).
 *
 * Reference: `docs/tech-lead/FIXTURES.md` (the fixture strategy).
 */

import {
  asTenantId,
  asDeviceId,
  asEventId,
  asCommandId,
  asIntentId,
  asCorrelationId,
  asCausationId,
  asIdempotencyKey,
  asObservationId,
  asPolicyId,
  type TenantId,
  type DeviceId,
  type EventId,
  type CommandId,
  type IntentId,
  type CorrelationId,
  type CausationId,
  type IdempotencyKey,
  type ObservationId,
  type PolicyId,
} from "./ids";
import {
  makeEnvelope,
  type EventEnvelope,
  type EventCause,
  type EventType,
  type EventSubject,
} from "./events";
import { makeCommand, type CommandEnvelope, type CommandType } from "./commands";
import {
  ALL_INTENT_KINDS,
  MAINTAIN_DEVICE_INTENT_KIND,
  SECURITY_REMEDIATION_INTENT_KIND,
  CONNECTIVITY_INTENT_KIND,
  PROCUREMENT_INTENT_KIND,
  SOFTWARE_SUBSCRIPTION_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
  RECOVERY_INTENT_KIND,
  PRINT_INTENT_KIND,
  FLEET_ACTION_INTENT_KIND,
  type IntentKind,
  type FleetIntent,
  type IntentEnvelope,
  type MaintainDeviceIntentPayload,
  type SecurityRemediationIntentPayload,
  type ConnectivityIntentPayload,
  type ProcurementIntentPayload,
  type SoftwareSubscriptionIntentPayload,
  type ReplacementIntentPayload,
  type RecoveryIntentPayload,
  type PrintIntentPayload,
  type FleetActionIntentPayload,
} from "./intents";
import {
  makeGuardianDecision as makeGuardianDecisionBase,
  type GuardianDecision,
  type GuardianDecisionType,
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
  type EvidenceRef,
  type RuleRef,
} from "./policy";
import type { Observation, ObservationBatch, ObservationKind } from "./observations";
import type {
  FleetError,
  DomainError,
  PolicyError,
  AuthorizationError,
  AdapterError,
  ConflictError,
  ValidationError,
} from "./errors";
import type { AdapterCapabilities } from "./device";

// ---------------------------------------------------------------------------
// Deterministic PRNG (xorshift32)
// ---------------------------------------------------------------------------

/**
 * A seeded, deterministic PRNG. Uses xorshift32: a tiny, well-mixed
 * non-cryptographic generator. Identical seeds produce identical sequences.
 *
 * The PRNG state is a 32-bit unsigned integer; we never expose it. Each
 * call to `next()` advances the state and returns the next 32-bit value.
 *
 * Implementation note: we use `>>> 0` after every arithmetic operation to
 * keep the state in unsigned 32-bit range (JavaScript bitwise ops are
 * signed 32-bit by default).
 */
export class SeededRng {
  /** The 32-bit state. Never read directly by callers. */
  private state: number;

  /**
   * @param seed a 32-bit unsigned integer seed. If a string seed is
   *   preferred, use `SeededRng.from("my-seed")` which hashes the string
   *   deterministically.
   */
  constructor(seed: number) {
    // Coerce to uint32; avoid the degenerate zero state (xorshift32 would
    // produce all-zeros forever).
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9; // golden ratio fallback
  }

  /**
   * Construct a `SeededRng` from a string seed. The string is hashed with
   * FNV-1a (32-bit) — a small, well-distributed non-cryptographic hash.
   * @param s the string seed
   * @returns a SeededRng
   */
  static from(s: string): SeededRng {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return new SeededRng(h);
  }

  /**
   * Returns the next 32-bit unsigned integer.
   * @returns a uint32 in [0, 2^32)
   */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /**
   * Returns a float in [0, 1). Uses the top 24 bits of `next()` for
   * resolution (sufficient for fixture selection).
   * @returns a float in [0, 1)
   */
  float(): number {
    return (this.next() >>> 8) / 0x1000000;
  }

  /**
   * Returns an integer in [0, n). Uses `float()` to avoid modulo bias for
   * small `n`.
   * @param n the exclusive upper bound (must be > 0)
   * @returns an integer in [0, n)
   */
  int(n: number): number {
    if (n <= 0) throw new Error("SeededRng.int: n must be > 0");
    return Math.floor(this.float() * n);
  }

  /**
   * Picks one element from a non-empty array.
   * @param arr the array to pick from
   * @returns one element of `arr`
   */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("SeededRng.pick: empty array");
    return arr[this.int(arr.length)] as T;
  }

  /**
   * Returns a string of `n` characters from the URL-safe base32 alphabet
   * (`a-z0-9`). Useful for generating tenant/device/idempotency suffixes.
   * @param n the length
   * @returns a base32 string
   */
  base32(n: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < n; i++) {
      out += alphabet[this.int(alphabet.length)];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Seed handling
// ---------------------------------------------------------------------------

/**
 * The canonical seed type. Accepts a number (uint32) or a string (hashed
 * via FNV-1a). Use a string for human-readable seeds in tests
 * (e.g. `"tenant-enrollment-flow"`).
 */
export type Seed = number | string;

/**
 * Construct a `SeededRng` from a `Seed`.
 * @param seed the seed
 * @returns a SeededRng
 */
export function rng(seed: Seed): SeededRng {
  return typeof seed === "number" ? new SeededRng(seed) : SeededRng.from(seed);
}

// ---------------------------------------------------------------------------
// Injected time (no clock reads)
// ---------------------------------------------------------------------------

/**
 * The base timestamp used by all fixture builders, in ISO 8601 UTC. This is
 * a FIXED, well-known anchor — builders derive timestamps from it via
 * `SeededRng.int()` offsets so that the same seed produces the same
 * timestamp every run.
 *
 * The anchor is `2026-01-01T00:00:00Z` — chosen so that fixture timestamps
 * are clearly "synthetic" (not from the real clock) and unambiguous. The
 * anchor itself is never compared against real-world time; it is just a
 * starting point for offsets.
 */
export const FIXTURE_TIME_ANCHOR = "2026-01-01T00:00:00Z" as const;

/**
 * The Unix epoch-millis corresponding to `FIXTURE_TIME_ANCHOR`. Used to
 * compute offsets deterministically without parsing ISO 8601.
 */
const FIXTURE_TIME_ANCHOR_MS = Date.parse(FIXTURE_TIME_ANCHOR);

/**
 * Derive an ISO 8601 timestamp from a seed. The seed picks an offset in
 * [0, 86_400_000) ms (one day) from the fixture anchor; the result is the
 * anchor plus that offset.
 *
 * @param seed the seed
 * @returns an ISO 8601 timestamp string
 */
export function makeTimestamp(seed: Seed): string {
  const r = rng(seed);
  const offsetMs = r.int(86_400_000); // one day, ms
  return new Date(FIXTURE_TIME_ANCHOR_MS + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// ID fixtures
// ---------------------------------------------------------------------------

/**
 * Build a deterministic `TenantId` from a seed. The tenant id matches the
 * canonical FleetOS grammar: `tnt_` prefix + 8-16 base32 chars.
 *
 * The same seed produces the same tenant id every run.
 *
 * @param seed the seed
 * @returns a `TenantId` satisfying the canonical grammar
 */
export function makeTenantId(seed: Seed): TenantId {
  const r = rng(seed);
  // 8 is the minimum length per TENANT_ID_MIN_LENGTH; we use 12 for headroom
  // while staying well under TENANT_ID_MAX_LENGTH (64).
  return asTenantId(`tnt_${r.base32(12)}`);
}

/**
 * Build a deterministic `DeviceId` from a seed.
 * @param seed the seed
 * @returns a `DeviceId`
 */
export function makeDeviceId(seed: Seed): DeviceId {
  const r = rng(seed);
  return asDeviceId(`dev_${r.base32(12)}`);
}

/**
 * Build a deterministic `EventId` from a seed.
 * @param seed the seed
 * @returns an `EventId`
 */
export function makeEventId(seed: Seed): EventId {
  const r = rng(seed);
  return asEventId(`evt_${r.base32(12)}`);
}

/**
 * Build a deterministic `CommandId` from a seed.
 * @param seed the seed
 * @returns a `CommandId`
 */
export function makeCommandId(seed: Seed): CommandId {
  const r = rng(seed);
  return asCommandId(`cmd_${r.base32(12)}`);
}

/**
 * Build a deterministic `IntentId` from a seed.
 * @param seed the seed
 * @returns an `IntentId`
 */
export function makeIntentId(seed: Seed): IntentId {
  const r = rng(seed);
  return asIntentId(`int_${r.base32(12)}`);
}

/**
 * Build a deterministic `CorrelationId` from a seed.
 * @param seed the seed
 * @returns a `CorrelationId`
 */
export function makeCorrelationId(seed: Seed): CorrelationId {
  const r = rng(seed);
  return asCorrelationId(`cor_${r.base32(12)}`);
}

/**
 * Build a deterministic `CausationId` from a seed.
 * @param seed the seed
 * @returns a `CausationId`
 */
export function makeCausationId(seed: Seed): CausationId {
  const r = rng(seed);
  return asCausationId(`cau_${r.base32(12)}`);
}

/**
 * Build a deterministic `IdempotencyKey` from a seed.
 * @param seed the seed
 * @returns an `IdempotencyKey`
 */
export function makeIdempotencyKey(seed: Seed): IdempotencyKey {
  const r = rng(seed);
  return asIdempotencyKey(`idem_${r.base32(16)}`);
}

/**
 * Build a deterministic `ObservationId` from a seed.
 * @param seed the seed
 * @returns an `ObservationId`
 */
export function makeObservationId(seed: Seed): ObservationId {
  const r = rng(seed);
  return asObservationId(`obs_${r.base32(12)}`);
}

/**
 * Build a deterministic `PolicyId` from a seed.
 * @param seed the seed
 * @returns a `PolicyId`
 */
export function makePolicyId(seed: Seed): PolicyId {
  const r = rng(seed);
  return asPolicyId(`pol_${r.base32(12)}`);
}

// ---------------------------------------------------------------------------
// Envelope fixtures
// ---------------------------------------------------------------------------

/**
 * Options for `makeEventEnvelope`. All fields are optional; defaults are
 * derived deterministically from `seed`.
 *
 * @template P the payload type
 */
export interface MakeEventEnvelopeOptions<P> {
  /** Seed for deterministic generation. Default: 0. */
  readonly seed?: Seed;
  /** Tenant scope. Default: `makeTenantId(seed)`. */
  readonly tenantId?: TenantId;
  /** Event type. Default: `"device.observation.recorded"`. */
  readonly type?: EventType;
  /** Event subject. Default: `makeDeviceId(seed)`. */
  readonly subject?: EventSubject;
  /** Schema version. Default: 1. */
  readonly schemaVersion?: number;
  /** Event payload. Default: `{}`. */
  readonly payload?: P;
  /** Override the occurredAt timestamp. Default: `makeTimestamp(seed)`. */
  readonly occurredAt?: string;
  /** Override the event id. Default: `makeEventId(seed)`. */
  readonly id?: EventId;
  /** Override the cause. Default: a command cause with fresh correlation. */
  readonly cause?: EventCause;
}

/**
 * Build a deterministic, valid-by-construction `EventEnvelope`. The
 * envelope satisfies `validateEnvelope()` (see the W002 invariant tests).
 *
 * Defaults:
 *   - `id`: `makeEventId(seed)`
 *   - `type`: `"device.observation.recorded"`
 *   - `occurredAt`: `makeTimestamp(seed)`
 *   - `tenantId`: `makeTenantId(seed)`
 *   - `subject`: `makeDeviceId(seed)`
 *   - `schemaVersion`: 1
 *   - `payload`: `{}`
 *   - `cause`: a command cause with `commandId = makeCausationId(seed)`
 *     and `correlationId = makeCorrelationId(seed + "-cor")`
 *
 * @template P the payload type
 * @param opts the options
 * @returns a frozen event envelope
 */
export function makeEventEnvelope<P = Record<string, never>>(
  opts: MakeEventEnvelopeOptions<P> = {},
): EventEnvelope<P> {
  const seed = opts.seed ?? 0;
  const id = opts.id ?? makeEventId(seed);
  const type = opts.type ?? "device.observation.recorded";
  const occurredAt = opts.occurredAt ?? makeTimestamp(seed);
  const tenantId = opts.tenantId ?? makeTenantId(seed);
  const subject = opts.subject ?? makeDeviceId(seed);
  const schemaVersion = opts.schemaVersion ?? 1;
  const payload = (opts.payload ?? {}) as P;
  const cause: EventCause =
    opts.cause ?? {
      kind: "command",
      commandId: makeCausationId(seed),
      correlationId: makeCorrelationId(`${seed}-cor`),
    };
  return makeEnvelope<P>({
    id,
    type,
    occurredAt,
    tenantId,
    subject,
    schemaVersion,
    payload,
    cause,
  });
}

// ---------------------------------------------------------------------------
// Command envelope fixtures
// ---------------------------------------------------------------------------

/**
 * Options for `makeCommandEnvelope`.
 *
 * @template P the payload type
 */
export interface MakeCommandEnvelopeOptions<P> {
  /** Seed for deterministic generation. Default: 0. */
  readonly seed?: Seed;
  /** Tenant scope. Default: `makeTenantId(seed)`. */
  readonly tenantId?: TenantId;
  /** Command type. Default: `"device.command.lock"`. */
  readonly type?: CommandType;
  /** Command payload. Default: `{}`. */
  readonly payload?: P;
  /** Override the issuedAt timestamp. Default: `makeTimestamp(seed)`. */
  readonly issuedAt?: string;
  /** Override the command id. Default: `makeCommandId(seed)`. */
  readonly id?: CommandId;
  /** Override the idempotency key. Default: `makeIdempotencyKey(seed)`. */
  readonly idempotencyKey?: IdempotencyKey;
  /** Override the correlation id. Default: `makeCorrelationId(seed + "-cor")`. */
  readonly correlationId?: CorrelationId;
}

/**
 * Build a deterministic, valid-by-construction `CommandEnvelope` carrying
 * an idempotency key. The envelope satisfies `validateCommand()`.
 *
 * @template P the payload type
 * @param opts the options
 * @returns a frozen command envelope
 */
export function makeCommandEnvelope<P = Record<string, never>>(
  opts: MakeCommandEnvelopeOptions<P> = {},
): CommandEnvelope<P> {
  const seed = opts.seed ?? 0;
  const id = opts.id ?? makeCommandId(seed);
  const idempotencyKey = opts.idempotencyKey ?? makeIdempotencyKey(seed);
  const issuedAt = opts.issuedAt ?? makeTimestamp(seed);
  const tenantId = opts.tenantId ?? makeTenantId(seed);
  const correlationId = opts.correlationId ?? makeCorrelationId(`${seed}-cor`);
  const type = opts.type ?? "device.command.lock";
  const payload = (opts.payload ?? {}) as P;
  return makeCommand<P>({
    id,
    idempotencyKey,
    issuedAt,
    tenantId,
    correlationId,
    type,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Intent fixtures (each of the nine kinds)
// ---------------------------------------------------------------------------

/**
 * The default payload for each intent kind when none is supplied. These
 * are minimal-but-valid samples of each payload shape.
 */
function defaultIntentPayload(kind: IntentKind, seed: Seed): unknown {
  switch (kind) {
    case MAINTAIN_DEVICE_INTENT_KIND: {
      const p: MaintainDeviceIntentPayload = {
        description: `maintain ${seed}`,
        deviceId: makeDeviceId(`${seed}-dev`),
      };
      return p;
    }
    case SECURITY_REMEDIATION_INTENT_KIND: {
      const p: SecurityRemediationIntentPayload = {
        description: `remediate ${seed}`,
        deviceId: makeDeviceId(`${seed}-dev`),
        findingId: `fnd_${rng(seed).base32(8)}`,
      };
      return p;
    }
    case CONNECTIVITY_INTENT_KIND: {
      const p: ConnectivityIntentPayload = {
        sourceDeviceId: makeDeviceId(`${seed}-src`),
        targetDeviceId: makeDeviceId(`${seed}-tgt`),
        outcome: `connected-${seed}`,
      };
      return p;
    }
    case PROCUREMENT_INTENT_KIND: {
      const p: ProcurementIntentPayload = {
        description: `procure ${seed}`,
      };
      return p;
    }
    case SOFTWARE_SUBSCRIPTION_INTENT_KIND: {
      const p: SoftwareSubscriptionIntentPayload = {
        seatCount: 1 + rng(seed).int(100),
      };
      return p;
    }
    case REPLACEMENT_INTENT_KIND: {
      const p: ReplacementIntentPayload = {
        reason: `replace ${seed}`,
        deviceId: makeDeviceId(`${seed}-dev`),
      };
      return p;
    }
    case RECOVERY_INTENT_KIND: {
      const p: RecoveryIntentPayload = {
        action: "lock",
        deviceId: makeDeviceId(`${seed}-dev`),
      };
      return p;
    }
    case PRINT_INTENT_KIND: {
      const p: PrintIntentPayload = {
        documentRef: `doc://${seed}`,
      };
      return p;
    }
    case FLEET_ACTION_INTENT_KIND: {
      const p: FleetActionIntentPayload = {
        actionPlanRef: `plan://${seed}`,
        targetCount: 1 + rng(seed).int(10),
      };
      return p;
    }
    default: {
      // Exhaustive check: the switch above covers every IntentKind.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Options for `makeIntent`.
 */
export interface MakeIntentOptions {
  /** Seed for deterministic generation. Default: 0. */
  readonly seed?: Seed;
  /** Intent kind. Default: `MaintainDeviceIntent`. */
  readonly kind?: IntentKind;
  /** Tenant scope. Default: `makeTenantId(seed)`. */
  readonly tenantId?: TenantId;
  /** Override the intent id. Default: `makeIntentId(seed)`. */
  readonly intentId?: IntentId;
  /** Override the createdAt timestamp. Default: `makeTimestamp(seed)`. */
  readonly createdAt?: string;
  /** Override the schema version. Default: 1. */
  readonly version?: number;
  /** Override the payload. Default: `defaultIntentPayload(kind, seed)`. */
  readonly payload?: unknown;
}

/**
 * Build a deterministic, valid-by-construction `IntentEnvelope` for the
 * given intent kind. The payload is constructed to satisfy the kind's
 * payload shape.
 *
 * The returned value is one arm of the `FleetIntent` discriminated union.
 * Callers can `switch` on `kind` to handle each kind.
 *
 * @param opts the options
 * @returns a frozen intent envelope
 */
export function makeIntent(opts: MakeIntentOptions = {}): FleetIntent {
  const seed = opts.seed ?? 0;
  const kind = opts.kind ?? MAINTAIN_DEVICE_INTENT_KIND;
  const tenantId = opts.tenantId ?? makeTenantId(seed);
  const intentId = opts.intentId ?? makeIntentId(seed);
  const createdAt = opts.createdAt ?? makeTimestamp(seed);
  const version = opts.version ?? 1;
  const payload = opts.payload ?? defaultIntentPayload(kind, seed);

  // Build the typed intent. The discriminated union is on the payload's
  // `kind` field; we attach it here.
  const envelope = Object.freeze({
    intentId,
    tenantId,
    version,
    createdAt,
    payload: Object.freeze({ ...((payload as Record<string, unknown>) ?? {}), kind }),
  });
  return envelope as unknown as FleetIntent;
}

/**
 * Build all nine intent kinds from a single seed. Useful for exhaustive
 * tests that must iterate every kind. Each intent gets a derived sub-seed
 * (`seed + "-" + kind`) so they do not collide on IDs/timestamps.
 *
 * @param seed the base seed
 * @param tenantId optional tenant scope (default: `makeTenantId(seed)`)
 * @returns an array of nine `FleetIntent` envelopes, one per kind
 */
export function makeAllIntents(seed: Seed, tenantId?: TenantId): FleetIntent[] {
  return ALL_INTENT_KINDS.map((k) =>
    makeIntent({ seed: `${seed}-${k}`, kind: k, tenantId: tenantId ?? makeTenantId(seed) }),
  );
}

// ---------------------------------------------------------------------------
// Adapter capabilities fixtures
// ---------------------------------------------------------------------------

/**
 * Options for `makeAdapterCapabilities`. The caller may specify explicit
 * `supported` and `unsupported` sets; the builder constructs an
 * `AdapterCapabilities` object with the supported flags set to `true` and
 * the unsupported flags set to `false`. Capabilities not in either set are
 * omitted (equivalent to `false` per the contract).
 */
export interface MakeAdapterCapabilitiesOptions {
  /**
   * The capabilities to mark as supported. Each will be `true` in the
   * returned object. Must be a subset of `ALL_ADAPTER_CAPABILITIES`.
   */
  readonly supported?: readonly (keyof AdapterCapabilities)[];
  /**
   * The capabilities to mark as explicitly unsupported. Each will be
   * `false` in the returned object. Useful for adapter manifests that
   * enumerate the full set for audit.
   */
  readonly unsupported?: readonly (keyof AdapterCapabilities)[];
}

/**
 * Build an `AdapterCapabilities` object with explicit supported/unsupported
 * sets. Supported capabilities are `true`; explicitly-unsupported
 * capabilities are `false`; capabilities in neither set are omitted.
 *
 * @param opts the options
 * @returns a frozen `AdapterCapabilities` object
 */
export function makeAdapterCapabilities(
  opts: MakeAdapterCapabilitiesOptions = {},
): AdapterCapabilities {
  const out: Record<string, boolean> = {};
  for (const c of opts.supported ?? []) out[c] = true;
  for (const c of opts.unsupported ?? []) {
    // Only set false if not already set true (supported takes precedence).
    if (!(c in out)) out[c] = false;
  }
  return Object.freeze(out) as AdapterCapabilities;
}

/**
 * Build an `AdapterCapabilities` object with a deterministic subset of
 * capabilities supported, derived from a seed. Useful for fuzz-style
 * contract tests.
 *
 * @param seed the seed
 * @returns a frozen `AdapterCapabilities` object
 */
export function makeAdapterCapabilitiesSeeded(seed: Seed): AdapterCapabilities {
  // Import here to avoid a top-level cycle through the device module.
  // (We can't import ALL_ADAPTER_CAPABILITIES at the top because of the
  //  import-order rules in this file — but it's the same package, so
  //  static import is fine. We use a static import at the top of the file
  //  in practice; this fallback is for documentation only.)
  const r = rng(seed);
  const supported: (keyof AdapterCapabilities)[] = [];
  // We deliberately use a static list here (mirroring ALL_ADAPTER_CAPABILITIES)
  // to avoid an extra import cycle.
  const all = [
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
  ] as const;
  for (const c of all) {
    if (r.float() < 0.5) supported.push(c);
  }
  return makeAdapterCapabilities({ supported });
}

// ---------------------------------------------------------------------------
// Guardian decision fixtures (each of the four decision types)
// ---------------------------------------------------------------------------

/**
 * Options for `makeGuardianDecision`.
 */
export interface MakeGuardianDecisionOptions {
  /** Seed for deterministic generation. Default: 0. */
  readonly seed?: Seed;
  /** Decision type. Default: `ALLOW`. */
  readonly decision?: GuardianDecisionType;
  /** Tenant scope. Default: `makeTenantId(seed)`. */
  readonly tenantId?: TenantId;
  /** Override the decidedAt timestamp. Default: `makeTimestamp(seed)`. */
  readonly decidedAt?: string;
  /** Override the schema version. Default: 1. */
  readonly schemaVersion?: number;
  /** Override the rules list. Default: one synthetic rule. */
  readonly rules?: readonly RuleRef[];
  /** Override the evidence list. Default: empty. */
  readonly evidence?: readonly EvidenceRef[];
}

/**
 * Build a deterministic, valid-by-construction `GuardianDecision` of the
 * specified type.
 *
 * @param opts the options
 * @returns a frozen `GuardianDecision`
 */
export function makeGuardianDecision(
  opts: MakeGuardianDecisionOptions = {},
): GuardianDecision {
  const seed = opts.seed ?? 0;
  const decision = opts.decision ?? ALLOW;
  const tenantId = opts.tenantId ?? makeTenantId(seed);
  const decidedAt = opts.decidedAt ?? makeTimestamp(seed);
  const schemaVersion = opts.schemaVersion ?? 1;
  const rules: readonly RuleRef[] =
    opts.rules ?? [{ ruleId: makePolicyId(seed), ruleVersion: 1 }];
  const evidence: readonly EvidenceRef[] = opts.evidence ?? [];
  return makeGuardianDecisionBase({
    tenantId,
    decision,
    rules,
    evidence,
    decidedAt,
    schemaVersion,
  });
}

/**
 * Build all four `GuardianDecisionType` decisions from a single seed. Useful
 * for exhaustive tests.
 *
 * @param seed the base seed
 * @returns an array of four `GuardianDecision` objects, one per type
 */
export function makeAllGuardianDecisions(seed: Seed): GuardianDecision[] {
  const tenantId = makeTenantId(seed);
  return [ALLOW, WARN, REQUIRE_APPROVAL, BLOCK].map((d, i) =>
    makeGuardianDecision({ seed: `${seed}-${i}`, decision: d, tenantId }),
  );
}

// ---------------------------------------------------------------------------
// FleetError fixtures (each of the six taxonomy classes)
// ---------------------------------------------------------------------------

/**
 * The discriminator kind for each `FleetError` subclass.
 */
export type FleetErrorKind = FleetError["kind"];

/**
 * Options for `makeFleetError`.
 */
export interface MakeFleetErrorOptions {
  /** Seed for deterministic generation. Default: 0. */
  readonly seed?: Seed;
  /** Error kind. Default: `DomainError`. */
  readonly kind?: FleetErrorKind;
  /** Tenant scope. Default: `makeTenantId(seed)`. */
  readonly tenantId?: TenantId;
  /** Override the correlation id. Default: `makeCorrelationId(seed + "-cor")`. */
  readonly correlationId?: CorrelationId;
}

/**
 * Build a deterministic, valid-by-construction `FleetError` of the
 * specified kind. Each error kind carries the minimum fields required by
 * its shape.
 *
 * @param opts the options
 * @returns a frozen `FleetError`
 */
export function makeFleetError(opts: MakeFleetErrorOptions = {}): FleetError {
  const seed = opts.seed ?? 0;
  const kind = opts.kind ?? "DomainError";
  const tenantId = opts.tenantId ?? makeTenantId(seed);
  const correlationId = opts.correlationId ?? makeCorrelationId(`${seed}-cor`);
  const code = `fixture.${kind.toLowerCase()}.${seed}`;
  const message = `fixture error: ${kind} (seed=${seed})`;

  switch (kind) {
    case "DomainError": {
      const e: DomainError = {
        kind: "DomainError",
        code,
        message,
        tenantId,
        correlationId,
        domain: "fixture",
        invariant: "test_invariant",
      };
      return e;
    }
    case "PolicyError": {
      const e: PolicyError = {
        kind: "PolicyError",
        code,
        message,
        tenantId,
        correlationId,
        decision: "BLOCK",
        ruleIds: [makePolicyId(seed)],
      };
      return e;
    }
    case "AuthorizationError": {
      const e: AuthorizationError = {
        kind: "AuthorizationError",
        code,
        message,
        tenantId,
        correlationId,
        principalId: `usr_${rng(seed).base32(8)}`,
        action: "fixture.action",
        reason: "missing_role",
      };
      return e;
    }
    case "AdapterError": {
      const e: AdapterError = {
        kind: "AdapterError",
        code,
        message,
        tenantId,
        correlationId,
        capability: "wipe",
        adapterFamily: "windows",
        deviceId: makeDeviceId(seed),
        retryable: false,
      };
      return e;
    }
    case "ConflictError": {
      const e: ConflictError = {
        kind: "ConflictError",
        code,
        message,
        tenantId,
        correlationId,
        resource: `resource:${seed}`,
      };
      return e;
    }
    case "ValidationError": {
      const e: ValidationError = {
        kind: "ValidationError",
        code,
        message,
        tenantId,
        correlationId,
        failures: [{ path: "/payload/field", reason: "required" }],
      };
      return e;
    }
    default: {
      // Exhaustive check.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Build all six `FleetError` kinds from a single seed. Useful for
 * exhaustive tests.
 *
 * @param seed the base seed
 * @returns an array of six `FleetError` objects, one per kind
 */
export function makeAllFleetErrors(seed: Seed): FleetError[] {
  const kinds: FleetErrorKind[] = [
    "DomainError",
    "PolicyError",
    "AuthorizationError",
    "AdapterError",
    "ConflictError",
    "ValidationError",
  ];
  return kinds.map((k, i) => makeFleetError({ seed: `${seed}-${i}`, kind: k }));
}

// ---------------------------------------------------------------------------
// Observation batch fixtures (bonus — useful for device-model contract tests)
// ---------------------------------------------------------------------------

/**
 * Options for `makeObservationBatch`.
 */
export interface MakeObservationBatchOptions {
  /** Seed for deterministic generation. Default: 0. */
  readonly seed?: Seed;
  /** Tenant scope. Default: `makeTenantId(seed)`. */
  readonly tenantId?: TenantId;
  /** Device that produced the batch. Default: `makeDeviceId(seed)`. */
  readonly deviceId?: DeviceId;
  /** Override the observedAt timestamp. Default: `makeTimestamp(seed)`. */
  readonly observedAt?: string;
  /** Number of observations in the batch. Default: 3. */
  readonly count?: number;
}

/**
 * Build a deterministic, valid-by-construction `ObservationBatch`. The
 * batch satisfies `validateObservationBatch()`.
 *
 * @param opts the options
 * @returns a frozen observation batch
 */
export function makeObservationBatch(
  opts: MakeObservationBatchOptions = {},
): ObservationBatch {
  const seed = opts.seed ?? 0;
  const tenantId = opts.tenantId ?? makeTenantId(seed);
  const deviceId = opts.deviceId ?? makeDeviceId(seed);
  const observedAt = opts.observedAt ?? makeTimestamp(seed);
  const count = opts.count ?? 3;
  const kinds: ObservationKind[] = [
    "device.identity",
    "device.health",
    "device.security",
    "device.software",
    "device.workload",
    "device.connectivity",
    "device.location",
    "device.power",
    "device.storage",
    "device.network",
    "device.peripheral",
  ];
  const r = rng(seed);
  const observations: Observation[] = [];
  for (let i = 0; i < count; i++) {
    observations.push({
      id: makeObservationId(`${seed}-${i}`),
      kind: kinds[i % kinds.length],
      observedAt,
      schemaVersion: 1,
      payload: { idx: i, sample: r.base32(8) },
    });
  }
  return Object.freeze({
    deviceId,
    observedAt,
    tenantId,
    observations: Object.freeze(observations),
  }) as ObservationBatch;
}

// ---------------------------------------------------------------------------
// Module markers (kept consistent with the rest of the package)
// ---------------------------------------------------------------------------

/**
 * The name of this testing subpath. Useful for assertions in consumer
 * tests that the subpath imports correctly.
 */
export const TESTING_MODULE_NAME = "contracts/testing" as const;

/**
 * The version of this testing subpath. Mirrors the package version.
 */
export const TESTING_MODULE_VERSION = "0.1.0" as const;
