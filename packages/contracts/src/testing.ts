/**
 * @fleetos/contracts/testing — Deterministic fixture builders for contract tests.
 *
 * Wave 1 lanes (W010/W011/W012) consume this subpath to build valid envelopes,
 * commands, intents, decisions, errors, and capability sets WITHOUT re-rolling
 * ad-hoc fixtures in every test file. Fixtures are:
 *
 *   - **Deterministic**: same seed => same values. Two test runs with the
 *     same seed produce byte-identical fixtures. There is no `Math.random()`
 *     anywhere in this module.
 *   - **Offline**: no network, no filesystem reads, no wall-clock reads.
 *     Timestamps come from a fixed `BASE_TIMESTAMP` plus integer offsets.
 *   - **Tenant-isolated**: every fixture derives its `TenantId` from a seeded
 *     `makeTenantId(...)`. A single test that mixes fixtures from different
 *     seeds does not accidentally cross tenant boundaries — each builder
 *     threads its seed into the tenant id so the two builders cannot
 *     collide (the seed prefix is part of the tenant suffix).
 *
 * Subpath export: `import { ... } from "@fleetos/contracts/testing"` (see the
 * `exports` field in `packages/contracts/package.json`). The main
 * `@fleetos/contracts` entry remains the runtime public API; this subpath
 * exists for tests only and is not consumed by runtime code.
 *
 * Reference: `docs/tech-lead/FIXTURES.md` for the full fixture strategy.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  asTenantId,
  asDeviceId,
  asEventId,
  asCorrelationId,
  asCausationId,
  asCommandId,
  asIdempotencyKey,
  asIntentId,
  asPolicyId,
  type TenantId,
  type DeviceId,
  type EventId,
  type CorrelationId,
  type CausationId,
  type CommandId,
  type IdempotencyKey,
  type IntentId,
  type PolicyId,
} from "./ids";

import {
  makeEnvelope,
  validateEnvelope,
  type EventEnvelope,
  type EventCause,
  type EventSubject,
  type MakeEnvelopeInput,
} from "./events";
import {
  makeCommand,
  validateCommand,
  type MakeCommandInput,
  type CommandEnvelope,
} from "./commands";

import {
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
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
  makeGuardianDecision as constructGuardianDecision,
  type GuardianDecision,
  type GuardianDecisionType,
} from "./policy";

import type {
  FleetError,
  DomainError,
  PolicyError,
  AuthorizationError,
  AdapterError,
  ConflictError,
  ValidationError,
  FleetErrorCode,
} from "./errors";

import type { AdapterCapabilities } from "./device";

// ---------------------------------------------------------------------------
// Deterministic primitives
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32-bit hash of a string. Used to derive a numeric PRNG seed from a
 * human-readable seed string. Pure, deterministic, no I/O.
 *
 * @param s the seed string
 * @returns a 32-bit unsigned integer hash
 */
function hashStringToUint32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 PRNG. Returns a function that produces deterministic floats in
 * [0, 1) from a 32-bit seed. Used to drive every "random-looking" fixture
 * value (id suffixes, byte sizes, etc.).
 *
 * @param seed 32-bit unsigned integer seed
 * @returns a deterministic PRNG function
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The set of lowercase URL-safe base32 characters used to build id suffixes. */
const BASE32_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Produce a deterministic lowercase alphanumeric string of the given length.
 *
 * @param rng a PRNG function (from `mulberry32`)
 * @param length the desired string length
 * @returns a deterministic string
 */
function base32ish(rng: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE32_CHARS[Math.floor(rng() * BASE32_CHARS.length)];
  }
  return out;
}

/**
 * Build a deterministic id of the form `<prefix>_<suffix>` where the suffix
 * is a fixed-length lowercase alphanumeric string derived from the seed.
 *
 * Two different `(prefix, seed)` pairs cannot collide: the seed is hashed
 * with both the prefix and a domain tag, so two builders using the same
 * `seed` but different `prefix`es produce different ids.
 *
 * @param domain a domain tag that namespaces the id (e.g. "tenant", "device")
 * @param prefix the id prefix (e.g. "tnt_", "dev_")
 * @param seed the user-provided seed string
 * @param suffixLen the number of characters in the suffix
 * @returns a deterministic id string
 */
function seededId(
  domain: string,
  prefix: string,
  seed: string,
  suffixLen: number = 12,
): string {
  const rng = mulberry32(hashStringToUint32(`${domain}:${seed}`));
  return `${prefix}${base32ish(rng, suffixLen)}`;
}

// ---------------------------------------------------------------------------
// Timestamps (no wall-clock reads)
// ---------------------------------------------------------------------------

/**
 * The base epoch-millis for all fixture timestamps. Fixed at
 * 2026-01-01T00:00:00.000Z — never derived from `Date.now()`. This guarantees
 * that two test runs produce identical timestamps.
 */
export const FIXTURE_BASE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

/**
 * Produce a deterministic ISO 8601 timestamp by offsetting the fixture base.
 *
 * @param offsetMs the offset in milliseconds from the base epoch
 * @returns an ISO 8601 UTC timestamp
 */
export function makeTimestamp(offsetMs: number = 0): string {
  return new Date(FIXTURE_BASE_EPOCH_MS + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Branded ID fixtures
// ---------------------------------------------------------------------------

/**
 * Build a deterministic, well-formed `TenantId`. The returned id matches the
 * canonical FleetOS tenant-id grammar `tnt_[a-z0-9]{8,64}` (length 12 suffix
 * is well within range). Same seed => same id.
 *
 * @param seed the seed string
 * @returns a deterministic `TenantId`
 */
export function makeTenantId(seed: string = "default"): TenantId {
  return asTenantId(seededId("tenant", "tnt_", seed, 12));
}

/**
 * Build a deterministic, well-formed `DeviceId`. Same seed => same id.
 *
 * @param seed the seed string
 * @returns a deterministic `DeviceId`
 */
export function makeDeviceId(seed: string = "default"): DeviceId {
  return asDeviceId(seededId("device", "dev_", seed, 12));
}

/**
 * Build a deterministic, well-formed `EventId`.
 *
 * @param seed the seed string
 * @returns a deterministic `EventId`
 */
export function makeEventId(seed: string = "default"): EventId {
  return asEventId(seededId("event", "evt_", seed, 12));
}

/**
 * Build a deterministic, well-formed `CorrelationId`.
 *
 * @param seed the seed string
 * @returns a deterministic `CorrelationId`
 */
export function makeCorrelationId(seed: string = "default"): CorrelationId {
  return asCorrelationId(seededId("correlation", "cor_", seed, 12));
}

/**
 * Build a deterministic, well-formed `CausationId`.
 *
 * @param seed the seed string
 * @returns a deterministic `CausationId`
 */
export function makeCausationId(seed: string = "default"): CausationId {
  return asCausationId(seededId("causation", "cau_", seed, 12));
}

/**
 * Build a deterministic, well-formed `CommandId`.
 *
 * @param seed the seed string
 * @returns a deterministic `CommandId`
 */
export function makeCommandId(seed: string = "default"): CommandId {
  return asCommandId(seededId("command", "cmd_", seed, 12));
}

/**
 * Build a deterministic, well-formed `IdempotencyKey`.
 *
 * @param seed the seed string
 * @returns a deterministic `IdempotencyKey`
 */
export function makeIdempotencyKey(seed: string = "default"): IdempotencyKey {
  return asIdempotencyKey(seededId("idempotency", "idem_", seed, 12));
}

/**
 * Build a deterministic, well-formed `IntentId`.
 *
 * @param seed the seed string
 * @returns a deterministic `IntentId`
 */
export function makeIntentId(seed: string = "default"): IntentId {
  return asIntentId(seededId("intent", "int_", seed, 12));
}

/**
 * Build a deterministic, well-formed `PolicyId`.
 *
 * @param seed the seed string
 * @returns a deterministic `PolicyId`
 */
export function makePolicyId(seed: string = "default"): PolicyId {
  return asPolicyId(seededId("policy", "pol_", seed, 12));
}

// ---------------------------------------------------------------------------
// EventEnvelope fixture (valid by construction)
// ---------------------------------------------------------------------------

/**
 * Options for `makeEventEnvelope`. Every field is optional — omitted fields
 * are filled with deterministic defaults derived from `seed`. The resulting
 * envelope is guaranteed to pass `validateEnvelope()`.
 *
 * @template P the payload type (defaults to `Record<string, never>` — an empty
 *   payload). Callers should specify their payload type explicitly when
 *   providing a typed payload.
 */
export interface MakeEventEnvelopeOptions<P> {
  /** Override the event id. */
  readonly id?: EventId;
  /** Override the event type. Default: `"fixture.event.synthetic"`. */
  readonly type?: string;
  /** Override the occurred-at timestamp. Default: `makeTimestamp()`. */
  readonly occurredAt?: string;
  /** Override the tenant id. Default: `makeTenantId("event:" + seed)`. */
  readonly tenantId?: TenantId;
  /** Override the event subject. Default: `makeDeviceId("event-subject:" + seed)`. */
  readonly subject?: EventSubject;
  /** Override the schema version. Default: `1`. */
  readonly schemaVersion?: number;
  /** Override the payload. Default: `{}`. */
  readonly payload?: P;
  /** Override the cause. Default: a command cause with a fresh command/correlation pair. */
  readonly cause?: EventCause;
}

/**
 * Build a deterministic `EventEnvelope` that is valid by construction. After
 * construction, the envelope is passed through `validateEnvelope()` — if any
 * override would produce an invalid envelope, the builder throws (this is a
 * programming error in the caller, not a runtime condition).
 *
 * @template P the payload type
 * @param options optional overrides (every field is optional)
 * @param seed the seed string (default `"default"`)
 * @returns a frozen, valid `EventEnvelope<P>`
 */
export function makeEventEnvelope<P = Record<string, never>>(
  options: MakeEventEnvelopeOptions<P> = {},
  seed: string = "default",
): EventEnvelope<P> {
  const tenantId = options.tenantId ?? makeTenantId(`event:${seed}`);
  const input: MakeEnvelopeInput<P> = {
    id: options.id ?? makeEventId(`event:${seed}`),
    type: options.type ?? "fixture.event.synthetic",
    occurredAt: options.occurredAt ?? makeTimestamp(),
    tenantId,
    subject: options.subject ?? makeDeviceId(`event-subject:${seed}`),
    schemaVersion: options.schemaVersion ?? 1,
    payload: (options.payload ?? ({} as P)),
    cause: options.cause ?? {
      kind: "command" as const,
      commandId: makeCausationId(`event-cause:${seed}`),
      correlationId: makeCorrelationId(`event-cause:${seed}`),
    },
  };
  const env = makeEnvelope<P>(input);
  const validation = validateEnvelope(env);
  if (!validation.ok) {
    throw new Error(
      `makeEventEnvelope produced an invalid envelope: ${validation.reason} (seed=${seed})`,
    );
  }
  return env;
}

// ---------------------------------------------------------------------------
// CommandEnvelope fixture (with idempotency key)
// ---------------------------------------------------------------------------

/**
 * Options for `makeCommandEnvelope`. Every field is optional — omitted fields
 * are filled with deterministic defaults derived from `seed`. The resulting
 * command is guaranteed to pass `validateCommand()`.
 *
 * @template P the payload type
 */
export interface MakeCommandEnvelopeOptions<P> {
  /** Override the command id. */
  readonly id?: CommandId;
  /** Override the idempotency key. Default: `makeIdempotencyKey("command:" + seed)`. */
  readonly idempotencyKey?: IdempotencyKey;
  /** Override the issued-at timestamp. Default: `makeTimestamp()`. */
  readonly issuedAt?: string;
  /** Override the tenant id. */
  readonly tenantId?: TenantId;
  /** Override the correlation id. */
  readonly correlationId?: CorrelationId;
  /** Override the command type. Default: `"fixture.command.synthetic"`. */
  readonly type?: string;
  /** Override the payload. Default: `{}`. */
  readonly payload?: P;
}

/**
 * Build a deterministic `CommandEnvelope` with a non-empty idempotency key.
 * The command is valid by construction; if any override would produce an
 * invalid command, the builder throws.
 *
 * @template P the payload type
 * @param options optional overrides
 * @param seed the seed string (default `"default"`)
 * @returns a frozen, valid `CommandEnvelope<P>`
 */
export function makeCommandEnvelope<P = Record<string, never>>(
  options: MakeCommandEnvelopeOptions<P> = {},
  seed: string = "default",
): CommandEnvelope<P> {
  const tenantId = options.tenantId ?? makeTenantId(`command:${seed}`);
  const input: MakeCommandInput<P> = {
    id: options.id ?? makeCommandId(`command:${seed}`),
    idempotencyKey: options.idempotencyKey ?? makeIdempotencyKey(`command:${seed}`),
    issuedAt: options.issuedAt ?? makeTimestamp(),
    tenantId,
    correlationId: options.correlationId ?? makeCorrelationId(`command:${seed}`),
    type: options.type ?? "fixture.command.synthetic",
    payload: (options.payload ?? ({} as P)),
  };
  const cmd = makeCommand<P>(input);
  const validation = validateCommand(cmd);
  if (!validation.ok) {
    throw new Error(
      `makeCommandEnvelope produced an invalid command: ${validation.reason} (seed=${seed})`,
    );
  }
  return cmd;
}

// ---------------------------------------------------------------------------
// IntentEnvelope fixture (each of the nine kinds)
// ---------------------------------------------------------------------------

/**
 * The options accepted by `makeIntent`. Every field is optional. The `kind`
 * field of the payload is always taken from the first argument of
 * `makeIntent()` — overriding `payload.kind` is allowed but discouraged.
 */
export interface MakeIntentOptions {
  /** Override the intent id. */
  readonly intentId?: IntentId;
  /** Override the tenant id. */
  readonly tenantId?: TenantId;
  /** Override the schema version (default 1). */
  readonly version?: number;
  /** Override the created-at timestamp (default `makeTimestamp()`). */
  readonly createdAt?: string;
  /** Override specific payload fields. The `kind` field is always set from the
   * first argument of `makeIntent()`; if `payload.kind` is provided it must
   * match the first argument. */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * Build a default payload for each of the nine intent kinds. The returned
 * payload always carries a `kind` field matching the argument, plus the
 * minimum required fields for that kind (per `intents.ts`).
 *
 * @param kind one of the nine `IntentKind` literals
 * @returns a default payload object for that kind
 */
function defaultIntentPayload(kind: IntentKind): Record<string, unknown> {
  switch (kind) {
    case MAINTAIN_DEVICE_INTENT_KIND:
      return { kind, description: "fixture maintenance description" };
    case SECURITY_REMEDIATION_INTENT_KIND:
      return { kind, description: "fixture security remediation" };
    case CONNECTIVITY_INTENT_KIND:
      return { kind, outcome: "fixture-outcome" };
    case PROCUREMENT_INTENT_KIND:
      return { kind, description: "fixture procurement description" };
    case SOFTWARE_SUBSCRIPTION_INTENT_KIND:
      return { kind, seatCount: 1 };
    case REPLACEMENT_INTENT_KIND:
      return { kind, reason: "fixture replacement reason" };
    case RECOVERY_INTENT_KIND:
      return { kind, action: "reboot" as const };
    case PRINT_INTENT_KIND:
      return { kind, documentRef: "fixture-doc-ref" };
    case FLEET_ACTION_INTENT_KIND:
      return { kind, actionPlanRef: "fixture-plan-ref", targetCount: 1 };
    default: {
      // Exhaustive check: if a new intent kind is added, this default branch
      // forces the maintainer to add a fixture default here.
      const _exhaustive: never = kind;
      throw new Error(`makeIntent: unknown intent kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Build a deterministic `FleetIntent` of the requested kind. The returned
 * value is one of the nine variants of the `FleetIntent` discriminated union,
 * tagged by `payload.kind`.
 *
 * @param kind one of the nine `IntentKind` literals
 * @param options optional overrides
 * @param seed the seed string (default `"default"`)
 * @returns a deterministic `FleetIntent` of the requested kind
 */
export function makeIntent(
  kind: IntentKind,
  options: MakeIntentOptions = {},
  seed: string = "default",
): FleetIntent {
  const defaultPayload = defaultIntentPayload(kind);
  const payload = { ...defaultPayload, ...(options.payload ?? {}), kind };
  const envelope: IntentEnvelope<typeof payload> = {
    intentId: options.intentId ?? makeIntentId(`intent:${seed}`),
    tenantId: options.tenantId ?? makeTenantId(`intent:${seed}`),
    version: options.version ?? 1,
    createdAt: options.createdAt ?? makeTimestamp(),
    payload,
  };
  return envelope as unknown as FleetIntent;
}

// ---------------------------------------------------------------------------
// AdapterCapabilities fixture (explicit supported/unsupported sets)
// ---------------------------------------------------------------------------

/**
 * Build an `AdapterCapabilities` flag set from explicit supported and
 * unsupported capability lists. Capabilities listed in `supported` are set
 * to `true`; capabilities listed in `unsupported` are set to `false`; all
 * other capabilities are omitted (equivalent to unsupported).
 *
 * The function asserts that no capability appears in BOTH lists — that would
 * be a programming error in the caller.
 *
 * @param supported the explicitly-supported capabilities
 * @param unsupported the explicitly-unsupported capabilities (default `[]`)
 * @returns an `AdapterCapabilities` object
 */
export function makeAdapterCapabilities(
  supported: readonly (keyof AdapterCapabilities)[] = [],
  unsupported: readonly (keyof AdapterCapabilities)[] = [],
): AdapterCapabilities {
  const overlap = supported.filter((c) => unsupported.includes(c));
  if (overlap.length > 0) {
    throw new Error(
      `makeAdapterCapabilities: capabilities appear in both supported and unsupported: ${overlap.join(", ")}`,
    );
  }
  // Build with a mutable buffer; the AdapterCapabilities interface declares
  // every flag as `readonly`, so direct assignment on the typed object is
  // rejected by TS. We populate a plain record and then freeze it.
  const buf: Record<string, boolean> = {};
  for (const cap of supported) buf[cap] = true;
  for (const cap of unsupported) buf[cap] = false;
  return Object.freeze(buf) as AdapterCapabilities;
}

// ---------------------------------------------------------------------------
// GuardianDecision fixture (each decision type)
// ---------------------------------------------------------------------------

/**
 * Options for `makeGuardianDecision`. Every field is optional.
 */
export interface MakeGuardianDecisionOptions {
  /** Override the tenant id. */
  readonly tenantId?: TenantId;
  /** Override the rules list (default `[]`). */
  readonly rules?: GuardianDecision["rules"];
  /** Override the evidence list (default `[]`). */
  readonly evidence?: GuardianDecision["evidence"];
  /** Override the decided-at timestamp (default `makeTimestamp()`). */
  readonly decidedAt?: string;
  /** Override the schema version (default `1`). */
  readonly schemaVersion?: number;
}

/**
 * Build a deterministic `GuardianDecision` of the requested decision type.
 * The decision type must be one of `ALLOW | WARN | REQUIRE_APPROVAL | BLOCK`
 * (per `policy.ts`). All other fields are filled with deterministic defaults
 * derived from `seed`.
 *
 * @param decision the decision type
 * @param options optional overrides
 * @param seed the seed string (default `"default"`)
 * @returns a frozen `GuardianDecision`
 */
export function makeGuardianDecision(
  decision: GuardianDecisionType,
  options: MakeGuardianDecisionOptions = {},
  seed: string = "default",
): GuardianDecision {
  return constructGuardianDecision({
    tenantId: options.tenantId ?? makeTenantId(`guardian:${seed}`),
    decision,
    rules: options.rules ?? [],
    evidence: options.evidence ?? [],
    decidedAt: options.decidedAt ?? makeTimestamp(),
    schemaVersion: options.schemaVersion ?? 1,
  });
}

// ---------------------------------------------------------------------------
// FleetError fixture (each taxonomy class)
// ---------------------------------------------------------------------------

/**
 * Options for `makeFleetError`. Every field is optional.
 */
export interface MakeFleetErrorOptions {
  /** Override the stable machine code. Default: `"fixture.<kind>"` (lowercased). */
  readonly code?: FleetErrorCode;
  /** Override the human message. Default: `"fixture <kind>"`. */
  readonly message?: string;
  /** Override the tenant id. */
  readonly tenantId?: TenantId;
  /** Override the correlation id. */
  readonly correlationId?: CorrelationId;
}

/**
 * Build a deterministic `FleetError` of the requested taxonomy class. The
 * `kind` argument selects which subclass is constructed; the remaining
 * fields are filled with deterministic defaults derived from `seed`.
 *
 * For `PolicyError`, the decision is `BLOCK` by default (the most common
 * case in tests). Override `policyDecision` via the second `extra` argument
 * to switch to `REQUIRE_APPROVAL`.
 *
 * @param kind one of the six `FleetError["kind"]` literals
 * @param options optional overrides
 * @param seed the seed string (default `"default"`)
 * @returns a deterministic `FleetError` of the requested kind
 */
export function makeFleetError(
  kind: FleetError["kind"],
  options: MakeFleetErrorOptions = {},
  seed: string = "default",
): FleetError {
  const tenantId = options.tenantId ?? makeTenantId(`error:${seed}`);
  const correlationId = options.correlationId ?? makeCorrelationId(`error:${seed}`);
  const code: FleetErrorCode = options.code ?? `fixture.${kind.toLowerCase()}`;
  const message: string = options.message ?? `fixture ${kind}`;
  switch (kind) {
    case "DomainError": {
      const err: DomainError = {
        kind: "DomainError",
        code,
        message,
        tenantId,
        correlationId,
        domain: "fixture",
        invariant: "fixture-invariant",
      };
      return err;
    }
    case "PolicyError": {
      const err: PolicyError = {
        kind: "PolicyError",
        code,
        message,
        tenantId,
        correlationId,
        decision: "BLOCK",
        ruleIds: [],
      };
      return err;
    }
    case "AuthorizationError": {
      const err: AuthorizationError = {
        kind: "AuthorizationError",
        code,
        message,
        tenantId,
        correlationId,
        principalId: "usr_fixture",
        action: "fixture.action",
        reason: "fixture-reason",
      };
      return err;
    }
    case "AdapterError": {
      const err: AdapterError = {
        kind: "AdapterError",
        code,
        message,
        tenantId,
        correlationId,
        capability: "wipe",
        adapterFamily: "fixture",
        retryable: false,
      };
      return err;
    }
    case "ConflictError": {
      const err: ConflictError = {
        kind: "ConflictError",
        code,
        message,
        tenantId,
        correlationId,
        resource: "fixture:resource",
      };
      return err;
    }
    case "ValidationError": {
      const err: ValidationError = {
        kind: "ValidationError",
        code,
        message,
        tenantId,
        correlationId,
        failures: [{ path: "/fixture", reason: "fixture-reason" }],
      };
      return err;
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`makeFleetError: unknown error kind: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

// Re-export the four decision-type constants so callers of `makeGuardianDecision`
// can write `makeGuardianDecision(ALLOW, ...)` without importing from the main
// `@fleetos/contracts` entry.
export {
  ALLOW,
  WARN,
  REQUIRE_APPROVAL,
  BLOCK,
} from "./policy";

// Re-export the nine intent-kind constants so callers of `makeIntent` can
// write `makeIntent(MAINTAIN_DEVICE_INTENT_KIND, ...)` without importing
// from the main `@fleetos/contracts` entry.
export {
  MAINTAIN_DEVICE_INTENT_KIND,
  SECURITY_REMEDIATION_INTENT_KIND,
  CONNECTIVITY_INTENT_KIND,
  PROCUREMENT_INTENT_KIND,
  SOFTWARE_SUBSCRIPTION_INTENT_KIND,
  REPLACEMENT_INTENT_KIND,
  RECOVERY_INTENT_KIND,
  PRINT_INTENT_KIND,
  FLEET_ACTION_INTENT_KIND,
} from "./intents";
