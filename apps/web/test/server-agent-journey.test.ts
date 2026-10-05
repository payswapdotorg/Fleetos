/**
 * W140 — THE END-TO-END AGENT JOURNEY: a REAL agent enrolls, checks
 * in, causes a REAL observation, and confirms its Device Twin — every
 * step over the REAL HTTP transports (@fleetos/agent's
 * control-plane-http) with a fetch stub wired DIRECTLY to the REAL
 * route handlers, over the fake durable driver. No fabricated data,
 * no in-process shortcuts: the wire shapes are the frozen ones
 * (composed through the REAL agent helpers), the refusals are the
 * machine-stable ones, and the observations land as REAL observations.
 */

import { describe, expect, test } from "bun:test";
import { asCausationId, asCommandId, asCorrelationId, asDeviceId, asIdempotencyKey, asTenantId } from "@fleetos/contracts";
import { wrapCheckInCommand } from "@fleetos/device-adapters";
import { createObservationCollector, deriveBatchIdempotencyKey } from "@fleetos/device-adapters";
import {
  httpBootstrap,
  httpCheckIn,
  httpFlushObservations,
  httpConfirmTwin,
} from "@fleetos/agent";
import type { CommandEnvelope } from "@fleetos/contracts";
import type { CheckInCommandPayload } from "@fleetos/device-adapters";
import { handleServerSignIn } from "../src/server/server-sessions";
import { handleIssueEnrollmentCode } from "../src/server/server-enrollment";
import { handleAgentCheckIn } from "../src/server/server-checkin";
import { handleAgentObservations } from "../src/server/server-checkin";
import { handleAgentTwinStatus } from "../src/server/server-checkin";
import { createServerEntropy } from "../src/server/server-entropy";
import { FakeDurableDriver } from "./server-fake-driver";
import { seedWorkspace } from "./server-test-seed";

const TENANT = "tnt_w140jour0001";
const DEVICE = "dev_w140jourdev1";
const NOW = "2026-10-02T12:00:00Z";
const BASE = "https://fleetos.example";
const deps = { now: NOW, correlationId: asCorrelationId("cor_w140jour0001") };

/** The fetch stub: routes the transport's calls to the REAL handlers. */
function fetchStub(driver: FakeDurableDriver): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname;
    const request = new Request(url, init);
    const routeDeps = { ...deps, driver, entropy: createServerEntropy() };
    if (path === "/api/enrollment/redeem") {
      return handleIssueRedeemProxy(request, routeDeps);
    }
    if (path === "/api/agent/check-in") {
      return handleAgentCheckIn(request, routeDeps);
    }
    if (path === "/api/agent/observations") {
      return handleAgentObservations(request, routeDeps);
    }
    if (path === "/api/agent/twin") {
      return handleAgentTwinStatus(request, routeDeps);
    }
    return new Response(JSON.stringify({ ok: false, reason: "not_found", message: "no such route" }), { status: 404 });
  }) as typeof fetch;
}

// The redemption handler is imported lazily to keep this file's header
// focused on the journey; the proxy keeps the types honest.
import { handleRedeemEnrollmentCode } from "../src/server/server-enrollment";
function handleIssueRedeemProxy(request: Request, routeDeps: unknown): Promise<Response> {
  return handleRedeemEnrollmentCode(request, routeDeps as Parameters<typeof handleRedeemEnrollmentCode>[1]);
}

describe("W140 the real agent journey (end-to-end over the real transports)", () => {
  test("bootstrap -> first check-in -> real observation -> twin confirmed", async () => {
    const driver = new FakeDurableDriver();
    const options = { baseUrl: BASE, fetchImpl: fetchStub(driver) };

    // -- the operator side (seeded workspace + issued code) -------------
    await seedWorkspace(driver, {
      tenantId: TENANT,
      name: "Journey Fleet",
      members: [{ email: "admin@example.com", displayName: "Admin", roles: ["fleet.admin"], password: "correct-horse-battery" }],
    });
    const signIn = await handleServerSignIn(new Request(`${BASE}/api/session`, {
      method: "POST",
      body: JSON.stringify({ tenantId: TENANT, email: "admin@example.com", password: "correct-horse-battery" }),
    }), { ...deps, driver, entropy: createServerEntropy() });
    const cookie = signIn.headers.get("set-cookie")!;
    const issued = await handleIssueEnrollmentCode(new Request(`${BASE}/api/enrollment/codes`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ ownershipKind: "corporate_owned" }),
    }), { ...deps, driver, entropy: createServerEntropy() });
    const issuance = JSON.parse(await issued.text()) as Record<string, string>;

    // -- 1. BOOTSTRAP: the real transport exchanges the one-time code --
    const bootstrapped = await httpBootstrap(options, {
      tenantId: asTenantId(TENANT),
      requestId: issuance["requestId"]!,
      code: issuance["code"]!,
      deviceId: asDeviceId(DEVICE),
      adapterFamily: "windows",
      hardware: { manufacturer: "Dell", model: "Latitude 7440", serialNumber: "SN-JOURNEY-1" },
    });
    expect(bootstrapped.ok).toBe(true);
    if (!bootstrapped.ok) throw new Error(bootstrapped.refusal.message);
    const trust = bootstrapped.value;
    expect(trust.deviceId).toBe(DEVICE);
    expect(trust.sessionToken.value).toMatch(/^fagt_[0-9a-f]{32}$/);

    // -- 2. FIRST CHECK-IN: the frozen command over the real transport -
    const command: CommandEnvelope<CheckInCommandPayload> = wrapCheckInCommand(
      {
        identity: { deviceId: asDeviceId(DEVICE), adapterFamily: "windows", tenantId: asTenantId(TENANT) },
        agent: { moduleName: "agent", moduleVersion: "0.1.0", protocolVersion: 1 },
        sessionToken: trust.sessionToken,
      },
      {
        id: asCommandId("cmd_w140jour0001"),
        idempotencyKey: asIdempotencyKey("idem_w140jour0001"),
        correlationId: asCorrelationId("cor_w140jour0002"),
        issuedAt: NOW,
        tenantId: asTenantId(TENANT),
      },
    );
    const checkedIn = await httpCheckIn(options, command);
    expect(checkedIn.ok).toBe(true);
    if (!checkedIn.ok) throw new Error(checkedIn.refusal.message);
    expect(checkedIn.value.duplicate).toBe(false);
    expect(checkedIn.value.ack.payload.kind).toBe("registered");
    expect(checkedIn.value.ack.correlationId).toBe("cor_w140jour0002");
    expect(checkedIn.value.ack.causationId).toBe("cmd_w140jour0001");

    // The pre-observation twin confirmation: exists, ZERO observations
    // (the journey's honest middle state — never fabricated).
    const before = await httpConfirmTwin(options, trust.sessionToken.value, asDeviceId(DEVICE));
    expect(before.ok && before.value.exists).toBe(true);
    if (before.ok) expect(before.value.observationCount).toBe(0);

    // -- 3. REAL OBSERVATIONS: the REAL agent collector + transport -----
    const collector = createObservationCollector({ deviceId: asDeviceId(DEVICE), tenantId: asTenantId(TENANT), idSeed: "w140-journey" });
    collector.record({ kind: "device.power", observedAt: NOW, schemaVersion: 1, payload: { pct: 91 } });
    collector.record({ kind: "device.storage", observedAt: NOW, schemaVersion: 1, payload: { freeGb: 220 } });
    const flushed = collector.flush(NOW);
    expect(flushed.ok).toBe(true);
    if (!flushed.ok) throw new Error("collector flush failed");
    const observationAck = await httpFlushObservations(options, flushed.batch, {
      trustToken: trust.sessionToken.value,
      idempotencyKey: deriveBatchIdempotencyKey(flushed.batch) as string,
      correlationId: asCorrelationId("cor_w140jour0003"),
      causationId: asCausationId("cmd_w140jour0001"),
    });
    expect(observationAck.ok).toBe(true);
    if (!observationAck.ok) throw new Error(observationAck.refusal.message);
    expect(observationAck.value.kind).toBe("admitted");
    if (observationAck.value.kind === "admitted") {
      expect(observationAck.value.admittedObservations).toBe(2);
      expect(observationAck.value.twinRevision).toBe(2);
    }

    // -- 4. TWIN CONFIRMED: the journey's terminal goal -----------------
    const confirmed = await httpConfirmTwin(options, trust.sessionToken.value, asDeviceId(DEVICE));
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.refusal.message);
    expect(confirmed.value.exists).toBe(true);
    expect(confirmed.value.observationCount).toBe(2);
    expect(confirmed.value.enrolledAt).toBeDefined();

    // A network failure is control_plane_unreachable — never a
    // fabricated success (the fail-closed transport law).
    const broken = { baseUrl: BASE, fetchImpl: ((): Promise<Response> => Promise.reject(new Error("network down"))) as unknown as typeof fetch };
    const unreachable = await httpConfirmTwin(broken, trust.sessionToken.value);
    expect(unreachable.ok).toBe(false);
    if (!unreachable.ok) expect(unreachable.refusal.reason).toBe("control_plane_unreachable");

    // The durable state: the twin carries the REAL observations, the
    // audit trail carries the whole journey.
    const twinRow = driver.findRow("fleetos_device_twins", { tenant_id: TENANT, device_id: DEVICE });
    expect(twinRow?.["revision"]).toBe(2);
    const auditText = JSON.stringify(driver.allRows("fleetos_audit_records"));
    expect(auditText).toContain("enrollment.request.created");
    expect(auditText).toContain("enrollment.request.fulfilled");
    expect(auditText).toContain("agent.checkin.registered");
    expect(auditText).toContain("device.observations.admitted");
  });

  test("the transport refuses machine-stably when the code is wrong (the frozen taxonomy, verbatim)", async () => {
    const driver = new FakeDurableDriver();
    const options = { baseUrl: BASE, fetchImpl: fetchStub(driver) };
    await seedWorkspace(driver, {
      tenantId: TENANT,
      name: "Journey Fleet",
      members: [{ email: "admin@example.com", displayName: "Admin", roles: ["fleet.admin"], password: "correct-horse-battery" }],
    });
    const refused = await httpBootstrap(options, {
      tenantId: asTenantId(TENANT),
      requestId: "enr_w140unknown1",
      code: "enrollwWRONGWRONGWRONGWRONG",
      deviceId: asDeviceId(DEVICE),
      adapterFamily: "windows",
      hardware: { manufacturer: "Dell", model: "Latitude 7440" },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refusal.reason).toBe("code_not_found");
      expect(refused.refusal.httpStatus).toBe(404);
    }
  });
});
