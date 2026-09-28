/**
 * W051 convergence — D2: retries + idempotency tests.
 *
 *   - the backoff ladder is deterministic with a ceiling;
 *   - the classifyRetry fold: ACCEPTED/DUPLICATE stop OK; REFUSED
 *     stops refused (never retried blind); UNKNOWN stops fail-closed;
 *     RETRYABLE retries with the deterministic delay, then exhausts
 *     with the machine-stable `retry.exhausted` code;
 *   - deriveIdempotencyKey: namespaced, deterministic over
 *     (tenant, adapter, intentKind, subject), order-invariant;
 *   - the retry driver against the REAL Aurum boundary converges in
 *     exactly ONE effect (one outbox append, one transport delivery);
 *   - a refused REAL emission never retries blind (fail-closed).
 */

import { test, expect } from "bun:test";
import {
  DEFAULT_RETRY_POLICY,
  backoffDelayMs,
  backoffSchedule,
  classifyRetry,
  deriveIdempotencyKey,
  driveWithRetry,
  validateRetryPolicy,
} from "../src/index";
import { TENANT_A, aurumEmit, aurumHarness, noticeIntent, realCtx } from "./helpers";

const POLICY = { maxAttempts: 4, initialDelayMs: 100, maxDelayMs: 800, backoffMultiplier: 2 };

test("D2/policy: a valid policy validates; invalid ones refuse with machine-stable reasons", () => {
  expect(validateRetryPolicy(POLICY).ok).toBe(true);
  expect(validateRetryPolicy({ ...POLICY, maxAttempts: 0 }).ok).toBe(false);
  expect(validateRetryPolicy({ ...POLICY, initialDelayMs: 0 }).ok).toBe(false);
  expect(validateRetryPolicy({ ...POLICY, maxDelayMs: 50 }).ok).toBe(false);
  expect(validateRetryPolicy({ ...POLICY, backoffMultiplier: 1 }).ok).toBe(false);
});

test("D2/backoff: the delay ladder is deterministic, exponential, with a ceiling", () => {
  expect(backoffDelayMs(POLICY, 1)).toBe(100);
  expect(backoffDelayMs(POLICY, 2)).toBe(200);
  expect(backoffDelayMs(POLICY, 3)).toBe(400);
  // attempt 4 would be 800 — exactly at the ceiling…
  expect(backoffDelayMs(POLICY, 4)).toBe(800);
  // …and beyond the policy horizon the ceiling holds.
  expect(backoffDelayMs({ ...POLICY, maxAttempts: 10 }, 9)).toBe(800);
  expect(backoffSchedule(POLICY)).toEqual([100, 200, 400]);
  // Deterministic across runs.
  expect(backoffSchedule(POLICY)).toEqual(backoffSchedule(POLICY));
  expect(backoffSchedule(DEFAULT_RETRY_POLICY)).toEqual([100, 200, 400, 800]);
});

test("D2/classify: ACCEPTED and DUPLICATE stop OK", () => {
  const d1 = classifyRetry({ kind: "ACCEPTED" }, POLICY, 1);
  expect(d1.directive).toBe("STOP_OK");
  const d3 = classifyRetry({ kind: "ACCEPTED" }, POLICY, 3);
  if (d3.directive !== "STOP_OK") throw new Error("unreachable");
  expect(d3.reason).toBe("accepted");
  const d2 = classifyRetry({ kind: "DUPLICATE" }, POLICY, 2);
  expect(d2.directive).toBe("STOP_OK");
  if (d2.directive !== "STOP_OK") throw new Error("unreachable");
  expect(d2.reason).toBe("duplicate");
});

test("D2/classify: REFUSED stops refused — never retried blind", () => {
  const d = classifyRetry({ kind: "REFUSED", reason: "tenant_mismatch" }, POLICY, 1);
  expect(d.directive).toBe("STOP_REFUSED");
  if (d.directive !== "STOP_REFUSED") throw new Error("unreachable");
  expect(d.reason).toBe("tenant_mismatch");
});

test("D2/classify: UNKNOWN stops fail-closed (never retried)", () => {
  const d = classifyRetry({ kind: "UNKNOWN" }, POLICY, 1);
  expect(d.directive).toBe("STOP_REFUSED");
  if (d.directive !== "STOP_REFUSED") throw new Error("unreachable");
  expect(d.reason).toContain("outcome_unknown");
});

test("D2/classify: RETRYABLE retries with the deterministic delay, then exhausts", () => {
  const early = classifyRetry({ kind: "RETRYABLE", reason: "timeout" }, POLICY, 2);
  expect(early.directive).toBe("RETRY");
  if (early.directive !== "RETRY") throw new Error("unreachable");
  expect(early.nextAttempt).toBe(3);
  expect(early.delayMs).toBe(200);
  const last = classifyRetry({ kind: "RETRYABLE", reason: "timeout" }, POLICY, 4);
  expect(last.directive).toBe("STOP_EXHAUSTED");
  if (last.directive !== "STOP_EXHAUSTED") throw new Error("unreachable");
  expect(last.attempts).toBe(4);
  expect(last.lastReason).toBe("timeout");
});

test("D2/driver: the driver converges in exactly ONE effect against the REAL Aurum boundary", () => {
  const h = aurumHarness(TENANT_A);
  const intent = noticeIntent();
  let calls = 0;
  const run = driveWithRetry(POLICY, () => {
    calls += 1;
    const r = aurumEmit(h, intent, TENANT_A);
    return projectAurumEmission(r);
  });
  expect(run.ok).toBe(true);
  if (!run.ok) throw new Error(run.reason);
  expect(run.attempts).toBe(1);
  expect(run.reason).toBe("accepted");
  expect(calls).toBe(1);
  expect(h.outbox.size(realCtx(TENANT_A))).toBe(1);
  expect(h.transport.emissions.length).toBe(1);
});

test("D2/driver: a duplicate first effect also converges (STOP_OK/duplicate, one call)", () => {
  const h = aurumHarness(TENANT_A);
  const intent = noticeIntent();
  // Pre-emit so the driver's single call lands as a duplicate.
  const pre = aurumEmit(h, intent, TENANT_A);
  expect(pre.ok).toBe(true);
  let calls = 0;
  const run = driveWithRetry(POLICY, () => {
    calls += 1;
    const r = aurumEmit(h, intent, TENANT_A);
    return projectAurumEmission(r);
  });
  expect(run.ok).toBe(true);
  if (!run.ok) throw new Error(run.reason);
  expect(run.reason).toBe("duplicate");
  expect(run.attempts).toBe(1);
  expect(calls).toBe(1);
  expect(h.transport.emissions.length).toBe(1);
});

test("D2/driver: a transport-refused REAL emission never retries blind (fail-closed)", () => {
  // The in-memory transport refuses the FIRST delivery only.
  const h = aurumHarness(TENANT_A, (n) => (n === 1 ? "provider_overloaded" : null));
  const intent = noticeIntent();
  let calls = 0;
  const run = driveWithRetry(POLICY, () => {
    calls += 1;
    const r = aurumEmit(h, intent, TENANT_A);
    return projectAurumEmission(r);
  });
  expect(run.ok).toBe(false);
  if (run.ok) throw new Error("expected stop");
  expect(run.code).toBe("retry.refused");
  expect(run.reason).toBe("provider_overloaded");
  expect(run.attempts).toBe(1);
  expect(calls).toBe(1);
});

/**
 * The binding-site projection: the REAL Aurum EmissionResult onto the
 * neutral IntegrationOutcome union (the mapping the driver folds over).
 * An emission refusal (ok:false) is a REFUSED; a transport refusal
 * (ok:true + acceptance.accepted:false) is a REFUSED carrying the
 * transport's machine-stable reason; a duplicate append is a DUPLICATE;
 * an accepted delivery is an ACCEPTED.
 */
function projectAurumEmission(r: ReturnType<typeof aurumEmit>):
  | { kind: "ACCEPTED" }
  | { kind: "DUPLICATE" }
  | { kind: "REFUSED"; reason: string } {
  if (!r.ok) return { kind: "REFUSED", reason: r.error.code };
  if (r.acceptance !== null && !r.acceptance.accepted) {
    return { kind: "REFUSED", reason: r.acceptance.reason };
  }
  return r.duplicate ? { kind: "DUPLICATE" } : { kind: "ACCEPTED" };
}

test("D2/driver: exhaustion appends the machine-stable retry.exhausted code with the attempt count", () => {
  let calls = 0;
  const run = driveWithRetry(POLICY, () => {
    calls += 1;
    return { kind: "RETRYABLE" as const, reason: "timeout" };
  });
  expect(run.ok).toBe(false);
  if (run.ok) throw new Error("expected exhaustion");
  expect(run.code).toBe("retry.exhausted");
  expect(run.attempts).toBe(POLICY.maxAttempts);
  expect(calls).toBe(POLICY.maxAttempts);
  expect(run.reason).toContain("timeout");
});

test("D2/idempotency: deriveIdempotencyKey is namespaced + deterministic + order-invariant", () => {
  const key = deriveIdempotencyKey({
    tenantId: TENANT_A,
    adapter: "aurum",
    intentKind: "maintenance_notice",
    subject: "swo_convworkorder01",
  });
  expect(key).toMatch(/^idem_aurum_[0-9a-f]{8}$/);
  // Deterministic across runs.
  expect(
    deriveIdempotencyKey({
      subject: "swo_convworkorder01",
      intentKind: "maintenance_notice",
      adapter: "aurum",
      tenantId: TENANT_A,
    }),
  ).toBe(key);
  // Any part changing changes the digest.
  expect(
    deriveIdempotencyKey({ tenantId: TENANT_A, adapter: "aurum", intentKind: "maintenance_notice", subject: "other" }),
  ).not.toBe(key);
  expect(
    deriveIdempotencyKey({ tenantId: TENANT_A, adapter: "adcos", intentKind: "maintenance_notice", subject: "swo_convworkorder01" }),
  ).not.toBe(key);
});
