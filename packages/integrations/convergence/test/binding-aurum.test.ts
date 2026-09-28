/**
 * W051 convergence — D1: contract compatibility, Aurum binding.
 *
 * Binds the REAL @fleetos/integration-aurum surface (outbox + emission +
 * in-memory transport) with the REAL identity TenantContext and the
 * REAL @fleetos/audit sink adapter:
 *
 *   - an emission lands EXACTLY ONCE (outbox 1 entry, transport 1
 *     delivery);
 *   - a re-emission of the identical intent is an IDEMPOTENT
 *     DUPLICATE — the transport is NEVER re-invoked, the outbox stays
 *     at 1;
 *   - an unbound transport refuses fail-closed (never silently
 *     delivered);
 *   - a cross-tenant emission (tenant-B context, tenant-A intent)
 *     refuses (tenant scoping everywhere).
 */

import { test, expect } from "bun:test";
import { emitCommunicationMessage } from "@fleetos/integration-aurum";
import {
  TENANT_A,
  TENANT_B,
  aurumEmit,
  aurumHarness,
  noticeIntent,
  realCtx,
} from "./helpers";

test("D1/aurum: an emission lands exactly once (outbox 1 entry, transport 1 delivery)", () => {
  const h = aurumHarness(TENANT_A);
  const r = aurumEmit(h, noticeIntent(), TENANT_A);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error.message);
  expect(r.duplicate).toBe(false);
  expect(r.acceptance?.accepted).toBe(true);
  expect(h.outbox.size(realCtx(TENANT_A))).toBe(1);
  expect(h.transport.emissions.length).toBe(1);
});

test("D1/aurum: a re-emission of the identical intent is an idempotent duplicate — the transport is NEVER re-invoked", () => {
  const h = aurumHarness(TENANT_A);
  const intent = noticeIntent();
  const first = aurumEmit(h, intent, TENANT_A);
  expect(first.ok).toBe(true);
  const second = aurumEmit(h, intent, TENANT_A);
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  expect(second.duplicate).toBe(true);
  expect(second.acceptance).toBeNull();
  expect(h.outbox.size(realCtx(TENANT_A))).toBe(1);
  expect(h.transport.emissions.length).toBe(1);
});

test("D1/aurum: an unbound transport refuses fail-closed (the outbox still records the intent)", () => {
  const h = aurumHarness(TENANT_A);
  const r = emitCommunicationMessage(realCtx(TENANT_A), h.outbox, noticeIntent(), {});
  // The outbox append IS the effect: it still lands (ok:true) — but the
  // acceptance is a deterministic refusal (never silently delivered).
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error.message);
  const acc = r.acceptance;
  if (acc === null || acc.accepted) throw new Error("expected refusal");
  expect(acc.accepted).toBe(false);
  expect(acc.reason).toBe("transport_not_bound");
});

test("D1/aurum: a tenant-B acting context with a tenant-A intent refuses (tenant scoping)", () => {
  const h = aurumHarness(TENANT_B);
  const r = aurumEmit(h, noticeIntent(TENANT_A), TENANT_B);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected refusal");
  expect(r.error.message).toContain("tenant");
});
