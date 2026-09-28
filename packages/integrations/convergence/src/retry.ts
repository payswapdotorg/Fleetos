/**
 * @fleetos/integration-convergence — D2: retries + idempotency.
 *
 * The NEUTRAL retry discipline shared by every integration adapter
 * binding (ADCOS / Arena / Aurum):
 *
 *   - `RetryPolicy` — the neutral policy shape (max attempts,
 *     deterministic exponential backoff with a ceiling);
 *   - `backoffDelayMs` / `backoffSchedule` — the deterministic delay
 *     ladder (pure functions of the policy; byte-identical across runs);
 *   - `IntegrationOutcome` — the neutral classification an adapter
 *     binding projects its REAL result shapes onto (ACCEPTED /
 *     DUPLICATE / REFUSED / RETRYABLE / UNKNOWN);
 *   - `classifyRetry` — the fold: ACCEPTED and DUPLICATE stop OK;
 *     REFUSED stops REFUSED (a deterministic refusal is NEVER retried
 *     blind); UNKNOWN stops fail-closed; RETRYABLE retries per the
 *     policy until exhaustion (which carries the machine-stable
 *     `retry.exhausted` code);
 *   - `driveWithRetry` — the retry driver loop (pure over the injected
 *     operation; converges in exactly one effect when the first attempt
 *     lands — the D2 binding test drives the REAL Aurum boundary);
 *   - `deriveIdempotencyKey` — the namespaced deterministic digest over
 *     (tenant, adapter, intentKind, subject).
 *
 * Pure: no clock reads (delays are COMPUTED, never awaited here), no
 * entropy, no runtime dependencies. Strict TS; no `any`.
 */

import type { TenantId } from "@fleetos/contracts";
import { canonicalJson, fnv1a32Hex, frozen } from "./internal";

// ---------------------------------------------------------------------------
// The neutral retry policy
// ---------------------------------------------------------------------------

/** The neutral retry policy (all facets injected; never a global). */
export interface RetryPolicy {
  /** The maximum number of attempts (>= 1; attempt 1 is the first try). */
  readonly maxAttempts: number;
  /** The delay after the first failed attempt, in milliseconds (> 0). */
  readonly initialDelayMs: number;
  /** The delay ceiling, in milliseconds (>= initialDelayMs). */
  readonly maxDelayMs: number;
  /** The exponential backoff base (> 1). */
  readonly backoffMultiplier: number;
}

/** A conservative default policy (documented; callers may inject their own). */
export const DEFAULT_RETRY_POLICY: RetryPolicy = frozen({
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
});

/** The tagged policy validation result. */
export type RetryPolicyCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Validate a retry policy (pure, non-throwing). */
export function validateRetryPolicy(policy: RetryPolicy): RetryPolicyCheck {
  if (policy === null || typeof policy !== "object") {
    return { ok: false, reason: "policy_required" };
  }
  if (typeof policy.maxAttempts !== "number" || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    return { ok: false, reason: "max_attempts_positive_integer" };
  }
  if (typeof policy.initialDelayMs !== "number" || !(policy.initialDelayMs > 0) || !Number.isFinite(policy.initialDelayMs)) {
    return { ok: false, reason: "initial_delay_positive" };
  }
  if (typeof policy.maxDelayMs !== "number" || !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs) {
    return { ok: false, reason: "max_delay_not_below_initial" };
  }
  if (typeof policy.backoffMultiplier !== "number" || !Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier <= 1) {
    return { ok: false, reason: "multiplier_above_one" };
  }
  return { ok: true };
}

/**
 * The deterministic delay AFTER failed attempt `attempt` (1-based):
 * `min(initialDelayMs * multiplier^(attempt - 1), maxDelayMs)`. A pure
 * function — the CALLER decides how to await it.
 */
export function backoffDelayMs(policy: RetryPolicy, attempt: number): number {
  const check = validateRetryPolicy(policy);
  if (!check.ok) {
    throw new TypeError(`backoffDelayMs: invalid policy (${check.reason})`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("backoffDelayMs: attempt must be a 1-based positive integer");
  }
  const raw = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

/**
 * The full deterministic delay ladder: the delay after failed attempts
 * 1..maxAttempts-1 (there is no delay after the FINAL attempt — the
 * policy is exhausted; the driver reports `retry.exhausted` instead).
 */
export function backoffSchedule(policy: RetryPolicy): readonly number[] {
  const check = validateRetryPolicy(policy);
  if (!check.ok) {
    throw new TypeError(`backoffSchedule: invalid policy (${check.reason})`);
  }
  const schedule: number[] = [];
  for (let attempt = 1; attempt <= policy.maxAttempts - 1; attempt += 1) {
    schedule.push(backoffDelayMs(policy, attempt));
  }
  return Object.freeze(schedule);
}

// ---------------------------------------------------------------------------
// The neutral outcome classification
// ---------------------------------------------------------------------------

/**
 * The neutral integration-outcome classification. The binding site
 * projects a REAL adapter result onto this union (a pure mapping — the
 * D1/D2 binding tests prove the projections against the REAL adcos /
 * arena / aurum surfaces).
 */
export type IntegrationOutcome =
  /** The effect landed (e.g. an ADCOS submission SUBMITTED; an Arena case SUBMITTED; an Aurum emission accepted). */
  | { readonly kind: "ACCEPTED" }
  /** The effect already landed earlier (idempotent duplicate — nothing mutated). */
  | { readonly kind: "DUPLICATE" }
  /** A deterministic refusal (the adapter refused; retrying blind would be wrong). */
  | { readonly kind: "REFUSED"; readonly reason: string }
  /** A transient failure (retry per the policy). */
  | { readonly kind: "RETRYABLE"; readonly reason: string }
  /** Unclassifiable — fail-closed: never retried, never reported healthy. */
  | { readonly kind: "UNKNOWN"; readonly reason?: string };

// ---------------------------------------------------------------------------
// The classifyRetry fold + the retry driver
// ---------------------------------------------------------------------------

/** The machine-stable directive for one outcome at one attempt. */
export type RetryDirective =
  | { readonly directive: "STOP_OK"; readonly reason: "accepted" | "duplicate" }
  | { readonly directive: "STOP_REFUSED"; readonly reason: string }
  | { readonly directive: "RETRY"; readonly nextAttempt: number; readonly delayMs: number }
  | { readonly directive: "STOP_EXHAUSTED"; readonly attempts: number; readonly lastReason: string };

/**
 * The classifyRetry fold: one outcome at one attempt under one policy →
 * the directive. ACCEPTED/DUPLICATE → STOP_OK; REFUSED → STOP_REFUSED
 * (never retried blind); UNKNOWN → STOP_REFUSED (fail-closed);
 * RETRYABLE → RETRY with the deterministic delay, or STOP_EXHAUSTED at
 * the last attempt.
 */
export function classifyRetry(
  outcome: IntegrationOutcome,
  policy: RetryPolicy,
  attempt: number,
): RetryDirective {
  const check = validateRetryPolicy(policy);
  if (!check.ok) {
    throw new TypeError(`classifyRetry: invalid policy (${check.reason})`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("classifyRetry: attempt must be a 1-based positive integer");
  }
  switch (outcome.kind) {
    case "ACCEPTED":
      return { directive: "STOP_OK", reason: "accepted" };
    case "DUPLICATE":
      return { directive: "STOP_OK", reason: "duplicate" };
    case "REFUSED":
      return { directive: "STOP_REFUSED", reason: outcome.reason };
    case "UNKNOWN":
      return { directive: "STOP_REFUSED", reason: outcome.reason ? `outcome_unknown (${outcome.reason})` : "outcome_unknown" };
    case "RETRYABLE":
      if (attempt >= policy.maxAttempts) {
        return { directive: "STOP_EXHAUSTED", attempts: attempt, lastReason: outcome.reason };
      }
      return { directive: "RETRY", nextAttempt: attempt + 1, delayMs: backoffDelayMs(policy, attempt) };
  }
}

/** The tagged run result of `driveWithRetry`. */
export type RetryRunResult =
  | {
      readonly ok: true;
      readonly reason: "accepted" | "duplicate";
      readonly attempts: number;
    }
  | {
      readonly ok: false;
      /** The machine-stable stop code: `retry.refused` / `retry.unknown` / `retry.exhausted`. */
      readonly code: "retry.refused" | "retry.unknown" | "retry.exhausted";
      readonly attempts: number;
      readonly reason: string;
    };

/**
 * The retry driver: runs the injected operation under the policy until
 * a stop directive. PURE over the operation (the delays are computed,
 * never awaited here — the CALLER owns the waiting strategy; this
 * function is the deterministic decision core). When the first attempt
 * lands (ACCEPTED) the driver converges in exactly ONE effect — the D2
 * binding test drives the REAL Aurum emission boundary through it.
 */
export function driveWithRetry(
  policy: RetryPolicy,
  op: (attempt: number) => IntegrationOutcome,
): RetryRunResult {
  const check = validateRetryPolicy(policy);
  if (!check.ok) {
    throw new TypeError(`driveWithRetry: invalid policy (${check.reason})`);
  }
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const outcome = op(attempt);
    const directive = classifyRetry(outcome, policy, attempt);
    if (directive.directive === "STOP_OK") {
      return { ok: true, reason: directive.reason, attempts: attempt };
    }
    if (directive.directive === "STOP_REFUSED") {
      return {
        ok: false,
        code: outcome.kind === "UNKNOWN" ? "retry.unknown" : "retry.refused",
        attempts: attempt,
        reason: directive.reason,
      };
    }
    if (directive.directive === "STOP_EXHAUSTED") {
      return {
        ok: false,
        code: "retry.exhausted",
        attempts: directive.attempts,
        reason: `retry attempts exhausted (${directive.lastReason})`,
      };
    }
    // RETRY: the next loop iteration is attempt+1 (the caller awaits
    // directive.delayMs — computed deterministically by the policy).
  }
  // Unreachable: attempt == maxAttempts classifies RETRYABLE as
  // STOP_EXHAUSTED, so the loop always terminates through a stop.
  return {
    ok: false,
    code: "retry.exhausted",
    attempts: policy.maxAttempts,
    reason: "retry attempts exhausted",
  };
}

// ---------------------------------------------------------------------------
// The namespaced idempotency key
// ---------------------------------------------------------------------------

/** The parts of an idempotency key (all facets required). */
export interface IdempotencyKeyParts {
  /** The acting tenant. */
  readonly tenantId: TenantId;
  /** The adapter namespace (e.g. "adcos" / "arena" / "aurum"). */
  readonly adapter: string;
  /** The neutral intent kind (e.g. "connectivity.request"). */
  readonly intentKind: string;
  /** The subject identity the intent acts on (device id / case id / message subject). */
  readonly subject: string;
}

/**
 * The namespaced deterministic idempotency key:
 * `idem_<adapter>_<fnv1a32(canonical(tenant, adapter, intentKind, subject))>`.
 * Byte-identical across runs and input key-order permutations; any part
 * changing changes the digest (asserted by tests).
 */
export function deriveIdempotencyKey(parts: IdempotencyKeyParts): string {
  if (parts === null || typeof parts !== "object") {
    throw new TypeError("deriveIdempotencyKey: parts required");
  }
  if (typeof parts.tenantId !== "string" || parts.tenantId.length === 0) {
    throw new TypeError("deriveIdempotencyKey: tenantId required");
  }
  if (typeof parts.adapter !== "string" || parts.adapter.length === 0) {
    throw new TypeError("deriveIdempotencyKey: adapter required");
  }
  if (typeof parts.intentKind !== "string" || parts.intentKind.length === 0) {
    throw new TypeError("deriveIdempotencyKey: intentKind required");
  }
  if (typeof parts.subject !== "string" || parts.subject.length === 0) {
    throw new TypeError("deriveIdempotencyKey: subject required");
  }
  const digest = fnv1a32Hex(
    canonicalJson({
      adapter: parts.adapter,
      intentKind: parts.intentKind,
      subject: parts.subject,
      tenantId: parts.tenantId,
    }),
  );
  return `idem_${parts.adapter}_${digest}`;
}
