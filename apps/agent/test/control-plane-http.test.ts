/**
 * W140 — the agent's control-plane HTTP transport unit tests (over a
 * stub fetch): the fail-closed transport law (network failure,
 * non-JSON, shape-invalid success → control_plane_unreachable — never
 * a fabricated success), the machine-stable refusal passthrough, and
 * the frozen ack validation on the happy paths.
 */

import { describe, expect, test } from "bun:test";
import { asCommandId, asCorrelationId, asDeviceId, asIdempotencyKey, asTenantId } from "@fleetos/contracts";
import type { CommandEnvelope, EventEnvelope, ObservationBatch } from "@fleetos/contracts";
import type { CheckInCommandPayload, CheckInAckEventPayload } from "@fleetos/device-adapters";
import { wrapCheckInCommand } from "@fleetos/device-adapters";
import {
  httpBootstrap,
  httpCheckIn,
  httpFlushObservations,
  httpConfirmTwin,
} from "../src/control-plane-http";

const BASE = "https://fleetos.example";
const NOW = "2026-10-02T12:00:00Z";

/** A stub fetch returning a fixed JSON response. */
function responding(status: number, body: unknown): typeof fetch {
  return (async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

/** A stub fetch whose request fails (the network-down path). */
const failing: typeof fetch = ((): Promise<Response> =>
  Promise.reject(new Error("network down"))) as typeof fetch;

const trustTokenBody = {
  ok: true,
  tenantId: "tnt_w140tran0001",
  deviceId: "dev_w140trandev01",
  enrollmentRequestId: "enr_w140tran0001",
  issuedAt: NOW,
  sessionToken: { value: "fagt_0123456789abcdef0123456789abcdef", issuedAt: NOW, expiresAt: "2026-10-03T12:00:00Z", issuer: "web.server-control-plane" },
  device: { lifecycleState: "ENROLL", enrolledAt: NOW, twinRevision: 1 },
};

function command(): CommandEnvelope<CheckInCommandPayload> {
  return wrapCheckInCommand(
    {
      identity: { deviceId: asDeviceId("dev_w140trandev01"), adapterFamily: "windows", tenantId: asTenantId("tnt_w140tran0001") },
      agent: { moduleName: "agent", moduleVersion: "0.1.0", protocolVersion: 1 },
      sessionToken: { value: "fagt_0123456789abcdef0123456789abcdef", issuedAt: NOW, expiresAt: "2026-10-03T12:00:00Z", issuer: "web.server-control-plane" },
    },
    {
      id: asCommandId("cmd_w140tran0001"),
      idempotencyKey: asIdempotencyKey("idem_w140tran0001"),
      correlationId: asCorrelationId("cor_w140tran0001"),
      issuedAt: NOW,
      tenantId: asTenantId("tnt_w140tran0001"),
    },
  );
}

describe("W140 agent HTTP transport (the fail-closed law)", () => {
  test("a network failure is control_plane_unreachable — never a fabricated success", async () => {
    for (const result of [
      await httpBootstrap({ baseUrl: BASE, fetchImpl: failing }, {
        tenantId: asTenantId("tnt_w140tran0001"), requestId: "enr_x", code: "enrollwAAAAAAAAAAAAAAAAAA1",
        deviceId: asDeviceId("dev_w140trandev01"), adapterFamily: "windows",
        hardware: { manufacturer: "Dell", model: "Latitude" },
      }),
      await httpCheckIn({ baseUrl: BASE, fetchImpl: failing }, command()),
      await httpFlushObservations({ baseUrl: BASE, fetchImpl: failing }, {} as ObservationBatch, {
        trustToken: "fagt_x", idempotencyKey: "idem_x", correlationId: asCorrelationId("cor_x"),
      }),
      await httpConfirmTwin({ baseUrl: BASE, fetchImpl: failing }, "fagt_x"),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.refusal.reason).toBe("control_plane_unreachable");
        expect(result.refusal.httpStatus).toBe(0);
      }
    }
  });

  test("a non-JSON response is control_plane_unreachable", async () => {
    const notJson: typeof fetch = (async (): Promise<Response> =>
      new Response("<html>gateway error</html>", { status: 502 })) as typeof fetch;
    const result = await httpConfirmTwin({ baseUrl: BASE, fetchImpl: notJson }, "fagt_x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("control_plane_unreachable");
  });

  test("server refusals pass through VERBATIM (machine reason + status)", async () => {
    const refused = await httpBootstrap(
      { baseUrl: BASE, fetchImpl: responding(404, { ok: false, reason: "code_not_found", explanation: "This enrollment code is not valid for your workspace. Check the code and workspace, then try again." }) },
      {
        tenantId: asTenantId("tnt_w140tran0001"), requestId: "enr_unknown", code: "enrollwAAAAAAAAAAAAAAAAAA1",
        deviceId: asDeviceId("dev_w140trandev01"), adapterFamily: "windows",
        hardware: { manufacturer: "Dell", model: "Latitude" },
      },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refusal.reason).toBe("code_not_found");
      expect(refused.refusal.httpStatus).toBe(404);
      expect(refused.refusal.message).toContain("not valid for your workspace");
    }
  });

  test("a shape-invalid success is control_plane_unreachable (never fabricated)", async () => {
    const shapeInvalid = await httpBootstrap(
      { baseUrl: BASE, fetchImpl: responding(201, { ok: true, sessionToken: { value: "no-issuedAt" } }) },
      {
        tenantId: asTenantId("tnt_w140tran0001"), requestId: "enr_x", code: "enrollwAAAAAAAAAAAAAAAAAA1",
        deviceId: asDeviceId("dev_w140trandev01"), adapterFamily: "windows",
        hardware: { manufacturer: "Dell", model: "Latitude" },
      },
    );
    expect(shapeInvalid.ok).toBe(false);
    if (!shapeInvalid.ok) expect(shapeInvalid.refusal.reason).toBe("control_plane_unreachable");

    // A check-in ack that FAILS the frozen validation never surfaces.
    const badAck: EventEnvelope<CheckInAckEventPayload> = {
      id: "evt_bad", type: "agent.session.established", occurredAt: NOW,
      tenantId: asTenantId("tnt_w140tran0001"), subject: "dev_w140trandev01",
      correlationId: asCorrelationId("cor_w140tran0001"), causationId: "cmd_w140tran0001",
      schemaVersion: 1,
      payload: { session: { sessionId: "", status: "active", expiresAt: "2026-10-03T12:00:00Z", refreshAfterMs: null }, kind: "registered" },
    };
    const bad = await httpCheckIn({ baseUrl: BASE, fetchImpl: responding(200, { ok: true, ack: badAck, duplicate: false }) }, command());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.refusal.reason).toBe("control_plane_unreachable");
  });

  test("the happy paths return the typed values (validated through the frozen ack check)", async () => {
    const bootstrapped = await httpBootstrap({ baseUrl: BASE, fetchImpl: responding(201, trustTokenBody) }, {
      tenantId: asTenantId("tnt_w140tran0001"), requestId: "enr_w140tran0001", code: "enrollwAAAAAAAAAAAAAAAAAA1",
      deviceId: asDeviceId("dev_w140trandev01"), adapterFamily: "windows",
      hardware: { manufacturer: "Dell", model: "Latitude" },
    });
    expect(bootstrapped.ok && bootstrapped.value.sessionToken.value).toBe("fagt_0123456789abcdef0123456789abcdef");

    const goodAck: EventEnvelope<CheckInAckEventPayload> = {
      id: "evt_w140tran0001", type: "agent.session.established", occurredAt: NOW,
      tenantId: asTenantId("tnt_w140tran0001"), subject: "dev_w140trandev01",
      correlationId: asCorrelationId("cor_w140tran0001"), causationId: "cmd_w140tran0001",
      schemaVersion: 1,
      payload: { session: { sessionId: "agses_w140tran0000000001", status: "active", expiresAt: "2026-10-03T12:00:00Z", refreshAfterMs: 43200000 }, kind: "registered" },
    };
    const checkedIn = await httpCheckIn({ baseUrl: BASE, fetchImpl: responding(200, { ok: true, ack: goodAck, duplicate: false }) }, command());
    expect(checkedIn.ok && checkedIn.value.ack.payload.kind).toBe("registered");

    const admitted = await httpFlushObservations(
      { baseUrl: BASE, fetchImpl: responding(200, { ok: true, ack: { kind: "admitted", admittedObservations: 2, duplicateObservations: 0, twinRevision: 2, backPressure: { status: "open", queueDepth: 2, maxQueueDepth: 1000, retryAfterMs: null } } }) },
      {} as ObservationBatch,
      { trustToken: "fagt_0123456789abcdef0123456789abcdef", idempotencyKey: "idem_x", correlationId: asCorrelationId("cor_x") },
    );
    expect(admitted.ok && admitted.value.kind).toBe("admitted");

    const shed = await httpFlushObservations(
      { baseUrl: BASE, fetchImpl: responding(200, { ok: true, ack: { kind: "shed", backPressure: { status: "shedding", queueDepth: 1000, maxQueueDepth: 1000, retryAfterMs: 1000 } } }) },
      {} as ObservationBatch,
      { trustToken: "fagt_0123456789abcdef0123456789abcdef", idempotencyKey: "idem_y", correlationId: asCorrelationId("cor_y") },
    );
    expect(shed.ok && shed.value.kind === "shed" && shed.value.retryAfterMs).toBe(1000);

    const confirmed = await httpConfirmTwin(
      { baseUrl: BASE, fetchImpl: responding(200, { ok: true, exists: true, observationCount: 2, enrolledAt: NOW }) },
      "fagt_0123456789abcdef0123456789abcdef",
    );
    expect(confirmed.ok && confirmed.value.observationCount).toBe(2);
  });
});
