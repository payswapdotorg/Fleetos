/**
 * W140 — the real agent check-in endpoint + observation ingestion
 * tests: the FROZEN wire shapes (composed through the REAL agent
 * helpers), idempotency (replay/conflict), fail-closed trust-token
 * refusals, correlation + causation on the ack, REAL twin mutation
 * through the domain functions, event dedup across requests,
 * back-pressure shed, and the twin confirmation.
 */

import { describe, expect, test } from "bun:test";
import { makeTenantContext } from "@fleetos/identity";
import { createDurableAuditLog } from "@fleetos/audit";
import { asCorrelationId, asTenantId, asCommandId, asIdempotencyKey, asDeviceId } from "@fleetos/contracts";
import { wrapCheckInCommand, validateCheckInAck, projectCheckInAck } from "@fleetos/device-adapters";
import { createObservationCollector, deriveBatchIdempotencyKey } from "@fleetos/device-adapters";
import type { ObservationBatch } from "@fleetos/contracts";
import { handleAgentCheckIn, handleAgentObservations, handleAgentTwinStatus } from "../src/server/server-checkin";
import { handleIssueEnrollmentCode, handleRedeemEnrollmentCode, AGENT_TRUST_TTL_MS } from "../src/server/server-enrollment";
import { handleServerSignIn } from "../src/server/server-sessions";
import { createServerEntropy } from "../src/server/server-entropy";
import { createRequestScopedRecordStore } from "../src/server/neon-record-store";
import { FakeDurableDriver } from "./server-fake-driver";
import { seedWorkspace } from "./server-test-seed";

const TENANT = "tnt_w140chki0001";
const OTHER = "tnt_w140chki0002";
const NOW = "2026-10-02T12:00:00Z";
const DEVICE = "dev_w140agent0001";

const deps = { now: NOW, correlationId: asCorrelationId("cor_w140chki0001") };
const entropy = () => createServerEntropy();

/** The full enrollment: workspace -> operator -> code -> redemption (trust). */
async function enrollDevice(driver: FakeDurableDriver): Promise<{ readonly token: string; readonly requestId: string }> {
  await seedWorkspace(driver, {
    tenantId: TENANT,
    name: "CheckIn Fleet",
    members: [{ email: "admin@example.com", displayName: "Admin", roles: ["fleet.admin"], password: "correct-horse-battery" }],
  });
  const signIn = await handleServerSignIn(new Request("http://localhost/api/session", {
    method: "POST",
    body: JSON.stringify({ tenantId: TENANT, email: "admin@example.com", password: "correct-horse-battery" }),
  }), { ...deps, driver, entropy: entropy() });
  const cookie = signIn.headers.get("set-cookie")!;
  const issued = await handleIssueEnrollmentCode(new Request("http://localhost/api/enrollment/codes", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ ownershipKind: "corporate_owned" }),
  }), { ...deps, driver, entropy: entropy() });
  const issuance = JSON.parse(await issued.text()) as Record<string, unknown>;
  const redeemed = await handleRedeemEnrollmentCode(new Request("http://localhost/api/enrollment/redeem", {
    method: "POST",
    body: JSON.stringify({
      tenantId: TENANT, requestId: issuance["requestId"], code: issuance["code"],
      deviceId: DEVICE, adapterFamily: "windows",
      hardware: { manufacturer: "Lenovo", model: "ThinkPad X1" },
    }),
  }), { ...deps, driver, entropy: entropy() });
  expect(redeemed.status).toBe(201);
  const body = JSON.parse(await redeemed.text()) as Record<string, unknown>;
  const token = (body["sessionToken"] as Record<string, unknown>)["value"] as string;
  return { token, requestId: issuance["requestId"] as string };
}

/** Compose the REAL frozen check-in command (exactly what the agent sends). */
function checkInCommand(token: string, sequence: number, idempotencyKey?: string) {
  return wrapCheckInCommand(
    {
      identity: { deviceId: asDeviceId(DEVICE), adapterFamily: "windows", tenantId: asTenantId(TENANT) },
      agent: { moduleName: "agent", moduleVersion: "0.1.0", protocolVersion: 1 },
      sessionToken: { value: token, issuedAt: NOW, expiresAt: new Date(Date.parse(NOW) + AGENT_TRUST_TTL_MS).toISOString(), issuer: "web.server-control-plane" },
    },
    {
      id: asCommandId(`cmd_w140chki${String(sequence).padStart(6, "0")}`),
      idempotencyKey: asIdempotencyKey(idempotencyKey ?? `idem_w140chki${String(sequence).padStart(6, "0")}`),
      correlationId: asCorrelationId(`cor_w140chki${String(sequence).padStart(6, "0")}`),
      issuedAt: NOW,
      tenantId: asTenantId(TENANT),
    },
  );
}

function post(url: string, body: unknown, headers: Readonly<Record<string, string>> = {}): Request {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}

/** A real observation batch through the REAL agent collector. */
function realBatch(sequence: number, count = 2): { readonly batch: ObservationBatch; readonly idempotencyKey: string } {
  const collector = createObservationCollector({ deviceId: asDeviceId(DEVICE), tenantId: asTenantId(TENANT), idSeed: `w140-seq-${String(sequence)}` });
  for (let i = 0; i < count; i += 1) {
    const recorded = collector.record({ kind: "device.power", observedAt: NOW, schemaVersion: 1, payload: { pct: 80 + ((sequence + i) % 10) } });
    expect(recorded.ok).toBe(true);
  }
  const flushed = collector.flush(NOW);
  expect(flushed.ok).toBe(true);
  if (!flushed.ok) throw new Error("collector flush failed");
  return {
    batch: flushed.batch,
    idempotencyKey: deriveBatchIdempotencyKey(flushed.batch) as string,
  };
}

describe("W140 agent check-in", () => {
  test("the first check-in registers through the frozen wire shape; the ack validates + carries correlation/causation", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);
    const command = checkInCommand(token, 1);
    const response = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", command), { ...deps, driver, entropy: entropy() });
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["duplicate"]).toBe(false);

    // The ack is the FROZEN event shape: the frozen validators accept it.
    const ack = body["ack"] as Parameters<typeof validateCheckInAck>[0];
    expect(validateCheckInAck(ack).ok).toBe(true);
    const projected = projectCheckInAck(ack);
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.ack.kind).toBe("registered");
      expect(projected.ack.session.status).toBe("active");
      expect(projected.ack.session.refreshAfterMs).toBe(AGENT_TRUST_TTL_MS / 2);
    }
    // Correlation + causation thread through (the command's ids).
    expect(ack.correlationId).toBe("cor_w140chki000001");
    expect(ack.causationId).toBe("cmd_w140chki000001");
    expect(ack.subject).toBe(DEVICE);

    // The trust session renewed (24h from now) and the audit recorded it.
    const trustRow = driver.allRows("fleetos_agent_sessions")[0]!;
    expect(trustRow["check_in_count"]).toBe(1);
    expect(trustRow["expires_at"]).toBe(new Date(Date.parse(NOW) + AGENT_TRUST_TTL_MS).toISOString());
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const actions = createDurableAuditLog(scoped.store)
      .records(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140chki0002")))
      .map((r) => r.action);
    expect(actions).toContain("agent.checkin.registered");
  });

  test("the second check-in renews; an idempotent replay returns the STORED ack; a different command under the same key conflicts", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);

    const first = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });
    expect(first.status).toBe(200);
    const renewed = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 2)), { ...deps, driver, entropy: entropy() });
    const renewedBody = JSON.parse(await renewed.text()) as Record<string, unknown>;
    expect((renewedBody["ack"] as Record<string, unknown>)["payload"]).toBeDefined();
    const renewedProjected = projectCheckInAck(renewedBody["ack"] as Parameters<typeof projectCheckInAck>[0]);
    expect(renewedProjected.ok && renewedProjected.ack.kind).toBe("renewed");

    // IDEMPOTENT REPLAY: the same command again -> the stored ack, duplicate.
    const replay = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });
    expect(replay.status).toBe(200);
    const replayBody = JSON.parse(await replay.text()) as Record<string, unknown>;
    expect(replayBody["duplicate"]).toBe(true);
    // The stored ack is the SAME VALUE (the canonical-JSON round trip
    // sorts keys — compare structurally, never byte-wise).
    expect(replayBody["ack"]).toEqual((JSON.parse(await first.text()) as Record<string, unknown>)["ack"]);
    // The trust session's count is unchanged by the replay (never re-executed).
    expect(driver.allRows("fleetos_agent_sessions")[0]?.["check_in_count"]).toBe(2);

    // CONFLICT: a DIFFERENT command under the same idempotency key.
    const conflicting = checkInCommand(token, 3, "idem_w140chki000001");
    const conflict = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", conflicting), { ...deps, driver, entropy: entropy() });
    expect(conflict.status).toBe(409);
    expect(JSON.parse(await conflict.text()).reason).toBe("idempotency_conflict");
  });

  test("the trust-token refusal matrix (fail-closed, machine-stable)", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);

    // No token presented.
    const commandless = { ...checkInCommand(token, 1) };
    const noToken = { ...commandless, payload: { ...commandless.payload, sessionToken: undefined } };
    const missing = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", noToken), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await missing.text()).reason).toBe("trust_token_required");

    // Unknown token.
    const unknown = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand("fagt_unknown0000000000000000000000", 1)), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await unknown.text()).reason).toBe("unknown_trust_token");

    // Device mismatch: the token is scoped to DEVICE; the command claims another.
    const wrongDevice = checkInCommand(token, 1);
    const mismatched = { ...wrongDevice, payload: { ...wrongDevice.payload, identity: { ...wrongDevice.payload.identity, deviceId: "dev_w140other9999" } } };
    const device = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", mismatched), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await device.text()).reason).toBe("device_mismatch");

    // Tenant mismatch: the envelope claims another tenant.
    const wrongTenant = checkInCommand(token, 1);
    const foreign = { ...wrongTenant, tenantId: OTHER, payload: { ...wrongTenant.payload, identity: { ...wrongTenant.payload.identity, tenantId: OTHER } } };
    const tenant = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", foreign), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await tenant.text()).reason).toBe("tenant_mismatch");

    // Expired trust: redeem at NOW, check in past the 24h boundary.
    const expired = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), {
      ...deps,
      now: new Date(Date.parse(NOW) + AGENT_TRUST_TTL_MS + 1000).toISOString(),
      driver,
      entropy: entropy(),
    });
    expect(JSON.parse(await expired.text()).reason).toBe("trust_token_expired");

    // Revoked trust: set revoked_at directly, then check in.
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const ctx = makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140chki0003"));
    const sessionRow = driver.allRows("fleetos_agent_sessions")[0]!;
    scoped.store.put(ctx, "fleetos_agent_sessions", sessionRow["agent_session_id"] as string, { ...sessionRow, revoked_at: NOW });
    await scoped.flush();
    const revoked = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await revoked.text()).reason).toBe("trust_token_revoked");
  });

  test("envelope + payload validation refusals (the frozen reasons, machine-stable)", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);

    const badType = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", { ...checkInCommand(token, 1), type: "agent.command.other" }), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await badType.text()).reason).toBe("invalid_command");

    const missingId = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", { ...checkInCommand(token, 1), id: "" }), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await missingId.text()).reason).toBe("invalid_command");

    const badProtocol = checkInCommand(token, 1);
    const proto = { ...badProtocol, payload: { ...badProtocol.payload, agent: { ...badProtocol.payload.agent, protocolVersion: 0 } } };
    const zero = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", proto), { ...deps, driver, entropy: entropy() });
    const zeroBody = JSON.parse(await zero.text()) as Record<string, unknown>;
    expect(zeroBody["reason"]).toBe("invalid_command");
    expect(zeroBody["message"]).toContain("bad_protocol_version");

    const tenantMismatch = checkInCommand(token, 1);
    const inner = { ...tenantMismatch, payload: { ...tenantMismatch.payload, identity: { ...tenantMismatch.payload.identity, tenantId: OTHER } } };
    const innerMismatch = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", inner), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await innerMismatch.text()).message).toContain("tenant_mismatch");

    const badTokenShape = checkInCommand(token, 1);
    const shapeless = { ...badTokenShape, payload: { ...badTokenShape.payload, sessionToken: { value: "", issuedAt: NOW, expiresAt: NOW, issuer: "x" } } };
    const shape = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", shapeless), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await shape.text()).message).toContain("bad_session_token");
  });

  test("attributable refusals are AUDITED (agent.checkin.refused with the machine reason)", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);
    // An expired trust session is attributable -> the refusal audits.
    const expired = await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), {
      ...deps,
      now: new Date(Date.parse(NOW) + AGENT_TRUST_TTL_MS + 1000).toISOString(),
      driver,
      entropy: entropy(),
    });
    expect(JSON.parse(await expired.text()).reason).toBe("trust_token_expired");
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const records = createDurableAuditLog(scoped.store).records(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140chki0009")));
    const refused = records.find((r) => r.action === "agent.checkin.refused");
    expect(refused).toBeDefined();
    const refusedDetails = refused?.details as Record<string, unknown> | undefined;
    expect(refusedDetails?.["reason"]).toBe("trust_token_expired");
    expect(refusedDetails?.["subject"]).toBe(DEVICE);
    expect(refusedDetails?.["deviceId"]).toBe(DEVICE);
  });
});

describe("W140 observation ingestion", () => {

  test("a real batch is admitted; the twin records REAL observations (revision growth, durable events)", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);

    // The first check-in establishes the session.
    await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });

    const first = realBatch(1, 3);
    const response = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: first.batch,
      idempotencyKey: `idem_obs_${String(1).padStart(4, "0")}`,
      correlationId: "cor_w140obs0001",
      causationId: "cmd_w140chki000001",
    }, { authorization: `Bearer ${token}` }), { ...deps, driver, entropy: entropy() });
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    const ack = body["ack"] as Record<string, unknown>;
    expect(ack["kind"]).toBe("admitted");
    expect(ack["admittedObservations"]).toBe(3);
    expect(ack["twinRevision"]).toBe(2); // twin.created (1) + the observation revision (2)

    // The durable twin carries the observations (REAL domain mutation).
    const twinRow = driver.findRow("fleetos_device_twins", { tenant_id: TENANT, device_id: DEVICE });
    expect(twinRow?.["revision"]).toBe(2);
    expect(driver.allRows("fleetos_observation_events")).toHaveLength(3);
    expect(driver.findRow("fleetos_observation_queue", { tenant_id: TENANT })?.["depth"]).toBe(3);

    // The audit trail: admitted with the correlation/causation ids.
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    const records = createDurableAuditLog(scoped.store).records(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140obs0002")));
    const admitted = records.find((r) => r.action === "device.observations.admitted");
    expect(admitted?.correlationId).toBe("cor_w140obs0001");
    expect(admitted?.causationId).toBe("cmd_w140chki000001");
  });

  test("idempotent replay returns the stored outcome; event ids dedup across DIFFERENT batch keys", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);
    await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });

    const batch = realBatch(1, 2);
    const send = (key: string, batchOverride?: unknown): Promise<Response> =>
      handleAgentObservations(post("http://localhost/api/agent/observations", {
        batch: batchOverride ?? batch.batch,
        idempotencyKey: key,
        correlationId: "cor_w140obs0003",
      }, { authorization: `Bearer ${token}` }), { ...deps, driver, entropy: entropy() });

    // Same key + same batch -> duplicate ack (the stored outcome).
    await send("idem_batch0001");
    const replay = await send("idem_batch0001");
    const replayBody = JSON.parse(await replay.text()) as Record<string, unknown>;
    expect((replayBody["ack"] as Record<string, unknown>)["kind"]).toBe("duplicate");

    // Same key + DIFFERENT batch -> idempotency conflict.
    const other = realBatch(9, 2);
    const conflict = await send("idem_batch0001", other.batch);
    expect(conflict.status).toBe(409);
    expect(JSON.parse(await conflict.text()).reason).toBe("idempotency_conflict");

    // A DIFFERENT key carrying the SAME observation ids -> every event
    // suppressed (event-level dedup across requests).
    const resends = await send("idem_batch0002");
    const resendsBody = JSON.parse(await resends.text()) as Record<string, unknown>;
    const ack = resendsBody["ack"] as Record<string, unknown>;
    expect(ack["kind"]).toBe("admitted");
    expect(ack["admittedObservations"]).toBe(0);
    expect(ack["duplicateObservations"]).toBe(2);
    // The twin did not grow a revision for a fully-suppressed batch.
    expect(ack["twinRevision"]).toBe(2);
  });

  test("back-pressure sheds before admission (the durable queue signal)", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);
    await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });

    // Seed the durable queue depth to the max.
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    scoped.store.insert(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140obs0004")), "fleetos_observation_queue", TENANT, {
      tenant_id: TENANT, depth: 1000,
    });
    await scoped.flush();

    const batch = realBatch(1, 2);
    const response = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: batch.batch,
      idempotencyKey: "idem_shed00001",
      correlationId: "cor_w140obs0005",
    }, { authorization: `Bearer ${token}` }), { ...deps, driver, entropy: entropy() });
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    const ack = body["ack"] as Record<string, unknown>;
    expect(ack["kind"]).toBe("shed");
    expect((ack["backPressure"] as Record<string, unknown>)["retryAfterMs"]).toBe(1000);
    // Nothing was admitted by the shed batch.
    expect(driver.allRows("fleetos_observation_events")).toHaveLength(0);
  });

  test("unauthenticated / mismatched / unenrolled ingestion fails closed", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);
    await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });
    const batch = realBatch(1, 1);

    // No bearer token.
    const noAuth = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: batch.batch, idempotencyKey: "idem_x00000001", correlationId: "cor_x",
    }), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await noAuth.text()).reason).toBe("trust_token_required");

    // Unknown token.
    const unknown = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: batch.batch, idempotencyKey: "idem_x00000002", correlationId: "cor_x",
    }, { authorization: "Bearer fagt_unknown0000000000000000000000" }), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await unknown.text()).reason).toBe("unknown_trust_token");

    // Batch tenant mismatch (the batch claims another tenant).
    const foreignBatch = { ...(batch.batch as unknown as Record<string, unknown>), tenantId: OTHER };
    const foreign = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: foreignBatch, idempotencyKey: "idem_x00000003", correlationId: "cor_x",
    }, { authorization: `Bearer ${token}` }), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await foreign.text()).reason).toBe("tenant_mismatch");

    // Batch device mismatch.
    const otherDevice = { ...(batch.batch as unknown as Record<string, unknown>), deviceId: "dev_w140other9999" };
    const mismatch = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: otherDevice, idempotencyKey: "idem_x00000004", correlationId: "cor_x",
    }, { authorization: `Bearer ${token}` }), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await mismatch.text()).reason).toBe("device_mismatch");

    // An unenrolled device (trust exists, twin deleted): device_not_enrolled.
    const scoped = await createRequestScopedRecordStore({ driver, tenants: [TENANT] });
    scoped.store.remove(makeTenantContext(asTenantId(TENANT), asCorrelationId("cor_w140obs0006")), "fleetos_device_twins", DEVICE);
    await scoped.flush();
    const unenrolled = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: batch.batch, idempotencyKey: "idem_x00000005", correlationId: "cor_x",
    }, { authorization: `Bearer ${token}` }), { ...deps, driver, entropy: entropy() });
    expect(JSON.parse(await unenrolled.text()).reason).toBe("device_not_enrolled");

    // A malformed batch (missing observedAt) refuses invalid_request.
    const enrolled2 = new FakeDurableDriver();
    const t2 = await enrollDevice(enrolled2);
    await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(t2.token, 1)), { ...deps, driver: enrolled2, entropy: entropy() });
    const malformed = { ...(realBatch(1, 1).batch as unknown as Record<string, unknown>), observedAt: "not-a-date" };
    const bad = await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: malformed, idempotencyKey: "idem_x00000006", correlationId: "cor_x",
    }, { authorization: `Bearer ${t2.token}` }), { ...deps, driver: enrolled2, entropy: entropy() });
    expect(JSON.parse(await bad.text()).reason).toBe("invalid_request");
  });
});

describe("W140 twin confirmation", () => {
  test("the journey's terminal confirmation counts REAL admitted observations", async () => {
    const driver = new FakeDurableDriver();
    const { token } = await enrollDevice(driver);
    await handleAgentCheckIn(post("http://localhost/api/agent/check-in", checkInCommand(token, 1)), { ...deps, driver, entropy: entropy() });
    const batch = realBatch(1, 4);
    await handleAgentObservations(post("http://localhost/api/agent/observations", {
      batch: batch.batch, idempotencyKey: "idem_conf00001", correlationId: "cor_w140obs0007",
    }, { authorization: `Bearer ${token}` }), { ...deps, driver, entropy: entropy() });

    const response = await handleAgentTwinStatus(new Request(`http://localhost/api/agent/twin?deviceId=${DEVICE}`, {
      headers: { authorization: `Bearer ${token}` },
    }), { ...deps, driver, entropy: entropy() });
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(body["exists"]).toBe(true);
    expect(body["observationCount"]).toBe(4);
    expect(typeof body["enrolledAt"]).toBe("string");

    // Another device's id is refused (the trust scope).
    const other = await handleAgentTwinStatus(new Request("http://localhost/api/agent/twin?deviceId=dev_w140other9999", {
      headers: { authorization: `Bearer ${token}` },
    }), { ...deps, driver, entropy: entropy() });
    expect(other.status).toBe(403);
  });
});
