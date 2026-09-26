/**
 * W012 D3 — The sink adapter: adapts an AuditLog to lane-local audit-sink
 * seams via structural typing (the pattern device-model's W011 AuditSink
 * established; no cross-lane import occurs).
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asDeviceId, asTenantId } from "@fleetos/contracts";
import { IdentityError, makeTenantContext } from "@fleetos/identity";
import {
  AuditValidationError,
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  makeAuditActorRef,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const AT = "2026-03-01T00:00:00Z";
const DEVICE_1 = asDeviceId("dev_w012device01");

/**
 * A record shaped like lane B's `DeviceModelAuditRecord` (built WITHOUT
 * importing @fleetos/device-model — structural compatibility is the point).
 */
function seamRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: TENANT_A,
    action: "device.observations.admitted",
    subject: DEVICE_1,
    occurredAt: AT,
    correlationId: asCorrelationId("cor_w012sink0001"),
    details: { admitted: 3, duplicates: 1 },
    ...overrides,
  };
}

test("the adapter appends seam records into the tenant-scoped hash chain", () => {
  const log = createInMemoryAuditLog();
  const sink = createAuditSinkAdapter(log, { source: "device-model.ingestion" });
  sink.append(seamRecord() as never);

  const ctx = makeTenantContext(TENANT_A);
  expect(log.size(ctx)).toBe(1);
  const record = log.records(ctx)[0];
  expect(record).toBeDefined();
  expect(record?.action).toBe("device.observations.admitted");
  expect(record?.source).toBe("device-model.ingestion");
  expect(record?.correlationId).toBe(asCorrelationId("cor_w012sink0001"));
  // The subject is preserved in details (audit correlates via details +
  // relatedEventIds, not a typed subject field).
  expect(record?.details).toEqual({
    admitted: 3,
    duplicates: 1,
    subject: DEVICE_1,
  });
  // Default actor: the emitting boundary as a service principal.
  expect(record?.actor).toEqual({
    kind: "service",
    principalId: "svc:device-model.ingestion",
    tenantId: TENANT_A,
  });
  // Default outcome: success.
  expect(record?.outcome).toEqual({ status: "success" });
  expect(log.verify(ctx).ok).toBe(true);
});

test("null subjects (unattributable rejections) are preserved", () => {
  const log = createInMemoryAuditLog();
  const sink = createAuditSinkAdapter(log, { source: "device-model.ingestion" });
  sink.append(seamRecord({ subject: null }) as never);
  const record = log.records(makeTenantContext(TENANT_A))[0];
  expect(record?.details).toEqual({ admitted: 3, duplicates: 1, subject: null });
});

test("an actor projection can be injected per record", () => {
  const log = createInMemoryAuditLog();
  const sink = createAuditSinkAdapter(log, {
    source: "device-model.ingestion",
    actor: (record) => makeAuditActorRef("agent", `agt:${record.subject ?? "unknown"}`, record.tenantId),
  });
  sink.append(seamRecord() as never);
  const record = log.records(makeTenantContext(TENANT_A))[0];
  expect(record?.actor).toEqual({
    kind: "agent",
    principalId: `agt:${DEVICE_1}`,
    tenantId: TENANT_A,
  });
});

test("a fixed foreign-tenant actor is rejected loudly, not silently rewritten", () => {
  const log = createInMemoryAuditLog();
  const sink = createAuditSinkAdapter(log, {
    source: "device-model.ingestion",
    actor: makeAuditActorRef("user", "usr:foreign", TENANT_B),
  });
  expect(() => sink.append(seamRecord() as never)).toThrow(AuditValidationError);
  expect(log.size(makeTenantContext(TENANT_A))).toBe(0);
});

test("records from multiple tenants land in their own chains", () => {
  const log = createInMemoryAuditLog();
  const sink = createAuditSinkAdapter(log, { source: "device-model.ingestion" });
  sink.append(seamRecord() as never);
  sink.append(seamRecord({ tenantId: TENANT_B, correlationId: asCorrelationId("cor_w012sink0002") }) as never);

  const ctxA = makeTenantContext(TENANT_A);
  const ctxB = makeTenantContext(TENANT_B);
  expect(log.size(ctxA)).toBe(1);
  expect(log.size(ctxB)).toBe(1);
  expect(log.verify(ctxA).ok).toBe(true);
  expect(log.verify(ctxB).ok).toBe(true);
});

test("an invalid tenant id on a seam record is rejected by the identity guard", () => {
  const log = createInMemoryAuditLog();
  const sink = createAuditSinkAdapter(log, { source: "device-model.ingestion" });
  // Invalid tenant grammar is a VALIDATION failure of the incoming record
  // (IdentityError / ValidationError projection), distinct from isolation.
  expect(() => sink.append(seamRecord({ tenantId: "bad-tenant" }) as never)).toThrow(
    IdentityError,
  );
});

test("the adapter requires a non-empty source", () => {
  const log = createInMemoryAuditLog();
  expect(() => createAuditSinkAdapter(log, { source: "" })).toThrow(TypeError);
});
