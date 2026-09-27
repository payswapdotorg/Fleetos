/**
 * W032 D4 tests — SoftwareSubscription contracts: allocation,
 * revision, versioning, determinism.
 */

import { describe, expect, test } from "bun:test";
import {
  ALLOCATION_ENGINE_VERSION,
  DEFAULT_SUBSCRIPTION_TERM_DAYS,
  SUBSCRIPTION_MODEL_VERSION,
  SUBSCRIPTION_SCHEMA_VERSION,
  allocateSubscription,
  createSubscription,
  reviseSubscription,
} from "../src/subscription";
import { createInMemorySoftwareAuditSink } from "../src/audit-seam";
import {
  CORR,
  TENANT_A,
  T0,
  T1,
  WL_1,
  allocateInput,
  reviseInput,
  stdSoftwareIntent,
} from "./helpers";

describe("D4: subscription allocation (consumes W022 DRAFT SoftwareSubscriptionIntentPayload)", () => {
  test("allocates a frozen, deterministic revision-1 subscription", () => {
    const result = allocateSubscription(TENANT_A, allocateInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sub = result.subscription;
    expect(sub.tenantId).toBe(TENANT_A);
    expect(sub.softwareId).toBe("app.bi_dashboard");
    expect(sub.seatCount).toBe(5);
    expect(sub.termDays).toBe(365);
    expect(sub.workloadId).toBe(WL_1);
    expect(sub.revision).toBe(1);
    expect(sub.allocatedAt).toBe(T0);
    expect(sub.schemaVersion).toBe(SUBSCRIPTION_SCHEMA_VERSION);
    expect(sub.modelVersion).toBe(SUBSCRIPTION_MODEL_VERSION);
    expect(sub.subscriptionId.startsWith("sub_")).toBe(true);
    expect(sub.contentHash.length).toBe(8);
    expect(Object.isFrozen(sub)).toBe(true);
  });

  test("byte-identical outputs across runs (deterministic)", () => {
    const a = allocateSubscription(TENANT_A, allocateInput());
    const b = allocateSubscription(TENANT_A, allocateInput());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.subscription)).toBe(JSON.stringify(b.subscription));
  });

  test("default termDays is 365 when not supplied", () => {
    const result = allocateSubscription(TENANT_A, {
      softwareIntent: stdSoftwareIntent(),
      workloadId: WL_1,
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subscription.termDays).toBe(DEFAULT_SUBSCRIPTION_TERM_DAYS);
  });

  test("validation rejects invalid inputs", () => {
    expect(allocateSubscription(TENANT_A, allocateInput({ at: "not-iso" })).ok).toBe(false);
    expect(allocateSubscription(TENANT_A, allocateInput({ correlationId: "" as never })).ok).toBe(false);
    expect(
      allocateSubscription(TENANT_A, allocateInput({ softwareIntent: { softwareId: "", seatCount: 5 } })).ok,
    ).toBe(false);
    expect(
      allocateSubscription(TENANT_A, allocateInput({ softwareIntent: { softwareId: "x", seatCount: -1 } })).ok,
    ).toBe(false);
    expect(
      allocateSubscription(TENANT_A, allocateInput({ softwareIntent: { softwareId: "x", seatCount: 1.5 } })).ok,
    ).toBe(false);
    expect(allocateSubscription(TENANT_A, allocateInput({ termDays: 0 })).ok).toBe(false);
    expect(allocateSubscription(TENANT_A, allocateInput({ termDays: -1 })).ok).toBe(false);
  });
});

describe("D4: subscription revision (append-only)", () => {
  test("reviseSubscription appends revision+1 with supersedes pointing at the prior", () => {
    const prior = allocateSubscription(TENANT_A, allocateInput());
    if (!prior.ok) throw new Error(prior.error.message);
    const next = reviseSubscription(prior.subscription, reviseInput());
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.subscription.revision).toBe(2);
    expect(next.subscription.supersedes).toBe(prior.subscription.subscriptionId);
    expect(next.subscription.seatCount).toBe(10);
    expect(next.subscription.termDays).toBe(730);
    expect(next.subscription.contentHash).not.toBe(prior.subscription.contentHash);
    expect(Object.isFrozen(next.subscription)).toBe(true);
  });

  test("revision validation rejects bad inputs", () => {
    const prior = allocateSubscription(TENANT_A, allocateInput());
    if (!prior.ok) throw new Error(prior.error.message);
    expect(reviseSubscription(prior.subscription, reviseInput({ seatCount: -1 })).ok).toBe(false);
    expect(reviseSubscription(prior.subscription, reviseInput({ seatCount: 1.5 })).ok).toBe(false);
    expect(reviseSubscription(prior.subscription, reviseInput({ at: "not-iso" })).ok).toBe(false);
    expect(reviseSubscription(prior.subscription, reviseInput({ termDays: 0 })).ok).toBe(false);
  });
});

describe("D4: createSubscription (audit-emitting boundary)", () => {
  test("emits one software.subscription.allocated audit record per success", () => {
    const sink = createInMemorySoftwareAuditSink();
    const result = createSubscription(TENANT_A, allocateInput(), sink);
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0]?.action).toBe("software.subscription.allocated");
    expect(sink.records[0]?.tenantId).toBe(TENANT_A);
    expect(sink.records[0]?.occurredAt).toBe(T0);
    expect(sink.records[0]?.correlationId).toBe(CORR);
    const details = sink.records[0]?.details as { softwareId: string; seatCount: number };
    expect(details.softwareId).toBe("app.bi_dashboard");
    expect(details.seatCount).toBe(5);
  });

  test("failed allocations emit no audit records", () => {
    const sink = createInMemorySoftwareAuditSink();
    const result = createSubscription(TENANT_A, allocateInput({ at: "not-iso" }), sink);
    expect(result.ok).toBe(false);
    expect(sink.records.length).toBe(0);
  });
});

describe("D4: the allocation engine version is recorded", () => {
  test("ALLOCATION_ENGINE_VERSION is a stable string", () => {
    expect(ALLOCATION_ENGINE_VERSION).toBe("software-allocation/1");
  });
});
