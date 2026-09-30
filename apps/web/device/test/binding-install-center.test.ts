/**
 * W100A web-device — the BINDING test: the install contract's
 * acceptance journey over REAL packages, end-to-end.
 *
 * "The install contract is accepted only when a human can: create an
 * enrollment request; download the matching artifact; install it on a
 * supported target; complete bootstrap; see the enrolled device in
 * the same tenant; see its first observation; open Device Doctor;
 * verify the audit/evidence trail; revoke/uninstall through an
 * authorized path."
 *
 * This test binds the REAL pieces exactly as the shell's binding site
 * would (test files may import across lanes — the established
 * W011/W021/W022/... pattern):
 *
 *   - the REAL `@fleetos/agent` release manifest (buildAgentRelease +
 *     installerScriptFor) — the installer the operator downloads;
 *   - the REAL `@fleetos/device-adapters` enrollment-request store —
 *     the one-time code's lifecycle (create -> put -> redeem), with
 *     the audit sink collecting the trail;
 *   - the REAL `@fleetos/agent` enrollment client — the agent-side
 *     journey (bootstrap -> first check-in -> first observation ->
 *     twin confirmation) over REAL frozen helpers;
 *   - the REAL `@fleetos/device-model` TwinStore — the binding site
 *     creates the Device Twin from the enrollment + ingests the first
 *     observation (exactly what the shell does at the boundary — the
 *     UI never performs enrollment);
 *   - the install-center view-model + the W090A `verifyEnrollment`
 *     over the REAL twin source — the console's view of the journey.
 *
 * Proves:
 *   - the FULL happy path: code created (verifier-only) -> agent
 *     artifact selected -> bootstrap redeemed -> first check-in
 *     acked -> first observation flushed -> twin created + fed ->
 *     verifyEnrollment => verified (the same tenant);
 *   - the code NEVER appears on the request record or in any audit
 *     record (verifier-only discipline end-to-end);
 *   - the refusal journey: an expired code refuses `code_expired`
 *     VERBATIM (machine reason + human explanation), the journey
 *     fails, and the UI renders the refusal from the refusal shape;
 *   - authority neutrality: the view-model performs NO enrollment —
 *     the request stays pending until the SHELL acts at the boundary
 *     (proven by the store's state before/after);
 *   - the install-center's journey trace is structurally satisfied by
 *     the REAL agent client progress (the runtime binding proof).
 */

import { describe, expect, test } from "bun:test";
import {
  asDeviceId,
  asTenantId,
  type CausationId,
} from "@fleetos/contracts";
import { makeCommandId, makeCorrelationId, makeEventId, makeIdempotencyKey } from "@fleetos/contracts/testing";
import {
  buildAgentRelease,
  installerScriptFor,
  createAgentEnrollmentClient,
  ALL_RELEASE_TARGETS,
  type AgentReleaseManifest,
  type AgentEnrollmentProgress,
} from "@fleetos/agent";
import {
  createCheckInAck,
  createEnrollmentRequest,
  createInMemoryEnrollmentAuditSink,
  createInMemoryEnrollmentRequestStore,
  type EnrollmentRequestScope,
  type EnrollmentRequestStore,
  type SessionState,
} from "@fleetos/device-adapters";
import {
  createInMemoryTwinStore,
  createTwin,
  enrollDevice,
  recordTwinObservations,
  type TwinStore,
} from "@fleetos/device-model";
import type { Observation } from "@fleetos/contracts";
import {
  dismissEnrollmentCode,
  enrollmentCodeCard,
  initialInstallCenterState,
  installationVerification,
  nextInstallAction,
  platformFacets,
  recordEnrollmentRequest,
  recordInstallRefusal,
  selectInstallPlatform,
  selectOwnershipKind,
  type EnrollmentJourneyLike,
  type InstallCenterState,
  type ReleaseManifestLike,
} from "../src/install-center";
import { verifyEnrollment } from "../src/enrollment";
import type { DeviceTwinSource } from "../src/seams";
import { TENANT_A, TENANT_B, SCOPE_A } from "./helpers";

const T0 = "2026-01-01T00:00:00Z";
const BOOTSTRAP_AT = "2026-01-01T00:10:00Z";
const CHECKIN_AT = "2026-01-01T00:11:00Z";
const OBSERVED_AT = "2026-01-01T00:12:00Z";
const TWIN_AT = "2026-01-01T00:13:00Z";
const TTL_MS = 24 * 3_600_000;
const CODE = "BOOT-BINDING-0001";
const REQUEST_ID = "enr_binding-0001";
const DEVICE = asDeviceId("dev_bindinginstall1");
const CORR = makeCorrelationId("w100a-binding-corr");

const SCOPE: EnrollmentRequestScope = { tenantId: TENANT_A, correlationId: CORR };

// ---------------------------------------------------------------------------
// The REAL pieces
// ---------------------------------------------------------------------------

function realRelease(): AgentReleaseManifest {
  const built = buildAgentRelease({
    moduleVersion: "1.2.3",
    protocolVersion: 1,
    releasedAt: T0,
    releaseNotes: "The productized agent.",
    payloads: ALL_RELEASE_TARGETS.map((target) => ({
      target,
      content: installerScriptFor(target, { moduleVersion: "1.2.3" }),
    })),
    uninstallSteps: ["Run the uninstaller from Settings > Apps."],
    rollbackInstructions: ["Revoke the device trust from the console."],
  });
  if (!built.ok) throw new Error("release build failed");
  return built.manifest;
}

/** The agent client bound to the REAL store-backed bootstrap seam. */
function makeBoundClient(store: EnrollmentRequestStore, sink?: ReturnType<typeof createInMemoryEnrollmentAuditSink>) {
  const made = createAgentEnrollmentClient({
    tenantId: TENANT_A,
    deviceId: DEVICE,
    adapterFamily: "windows",
    agent: { moduleName: "agent", moduleVersion: "1.2.3", protocolVersion: 1 },
    platform: "windows",
    arch: "x64",
  });
  if (!made.ok) throw new Error("client construction failed");

  const submittedCommands: unknown[] = [];
  const flushedBatches: unknown[] = [];

  const bootstrapSeam = {
    redeem: (input: {
      tenantId: typeof TENANT_A;
      requestId: string;
      code: string;
      deviceId: typeof DEVICE;
    }) =>
      store.redeem(
        { tenantId: input.tenantId, correlationId: CORR },
        {
          requestId: input.requestId,
          code: input.code,
          deviceId: input.deviceId,
        },
        BOOTSTRAP_AT,
        sink !== undefined ? { auditSink: sink } : undefined,
      ),
  };
  const checkInSeam = {
    submit: (command: never) => {
      submittedCommands.push(command);
      const session: SessionState = {
        sessionId: "sess_binding_0001",
        status: "active",
        expiresAt: "2026-01-02T00:00:00.000Z",
        refreshAfterMs: null,
      };
      const ack = createCheckInAck(
        { session, kind: "registered" },
        {
          id: makeEventId("w100a-binding-ack"),
          tenantId: TENANT_A,
          subject: DEVICE,
          occurredAt: CHECKIN_AT,
          correlationId: CORR,
          causationId: makeCommandEnvelopeId(),
        },
      );
      return { ok: true as const, ack };
    },
  };
  const observationSeam = {
    flush: (batch: never, at: string) => {
      flushedBatches.push({ batch, at });
      return { ok: true as const };
    },
  };
  return { client: made.client, bootstrapSeam, checkInSeam, observationSeam, submittedCommands, flushedBatches };
}

function makeCommandEnvelopeId(): CausationId {
  return makeCommandId("w100a-binding-cmd") as unknown as CausationId;
}

/**
 * The BINDING SITE: what the shell does when the control plane
 * ingests the enrollment — create the REAL Device Twin from the
 * enrollment record + ingest the first observation (recorded through
 * the REAL device-model ingestion surface). The UI never does any of
 * this.
 */
function createTwinAtBindingSite(store: EnrollmentRequestStore): TwinStore {
  const record = store.get(SCOPE, REQUEST_ID);
  if (record === undefined) throw new Error("request missing at binding site");
  const enrolled = enrollDevice({
    tenantId: TENANT_A,
    deviceId: DEVICE,
    adapterFamily: "windows",
    hardware: {
      manufacturer: "Lenovo",
      model: "ThinkPad X1",
      serialNumber: "SN-BINDING-0001",
      assetTag: "ASSET-BINDING-0001",
    },
    ownership: {
      ownerType: record.ownershipKind === "byod" ? "CUSTOMER_OWNED" : "FLEET_PURCHASED",
      assignedUserId: undefined,
      assignedTeam: undefined,
    },
    at: BOOTSTRAP_AT,
    provenance: { correlationId: CORR },
  });
  if (!enrolled.ok) throw new Error(`enrollDevice failed: ${enrolled.error.message}`);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: BOOTSTRAP_AT, correlationId: CORR } });
  if (!created.ok) throw new Error(`createTwin failed: ${created.error.message}`);

  const firstObservation: Observation = Object.freeze({
    id: asDeviceId("dev_bindinginstall1") as never,
    kind: "agent.first-check-in",
    observedAt: OBSERVED_AT,
    schemaVersion: 1,
    payload: { healthy: true },
  });
  const recorded = recordTwinObservations(created.twin, [firstObservation], {
    at: TWIN_AT,
    correlationId: CORR,
  });
  if (!recorded.ok) throw new Error(`recordTwinObservations failed: ${recorded.error.message}`);

  const twinStore = createInMemoryTwinStore();
  twinStore.put(recorded.twin);
  return twinStore;
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

describe("W100A binding: the install contract's acceptance journey (REAL end-to-end)", () => {
  test("create -> download -> install -> bootstrap -> first check-in -> first observation -> twin -> verified", () => {
    const sink = createInMemoryEnrollmentAuditSink();
    const store = createInMemoryEnrollmentRequestStore();
    const release = realRelease();

    // 1. The OPERATOR creates the enrollment request (the console's
    //    boundary: create + put; the code is returned ONCE).
    const created = createEnrollmentRequest({
      tenantId: TENANT_A,
      requestId: REQUEST_ID,
      code: CODE,
      ownershipKind: "corporate_owned",
      ttlMs: TTL_MS,
      now: T0,
      correlationId: CORR,
    });
    if (!created.ok) throw new Error("creation failed");
    expect(store.put(SCOPE, created.record, { auditSink: sink })).toEqual({ ok: true });

    // 2. The console state records the request + the one-time code
    //    (display-once) — the view-model carries the code, the record
    //    does not.
    let state: InstallCenterState = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "windows", "x64");
    state = selectOwnershipKind(state, "corporate_owned");
    state = recordEnrollmentRequest(state, created.record, created.code);
    const card = enrollmentCodeCard(state, T0, { expiringWithinMs: 3_600_000 });
    expect(card?.code).toBe(CODE);
    expect(JSON.stringify(created.record)).not.toContain(CODE);

    // 3. The OPERATOR downloads the matching artifact (the release
    //    manifest's windows/x64 installer) — verified by checksum.
    const facets = platformFacets(release as ReleaseManifestLike, state);
    expect(facets.find((f) => f.platform === "windows")?.selected).toBe(true);

    // 4. The AGENT installs + bootstraps: the REAL client redeems the
    //    one-time code at the REAL store-backed seam.
    const bound = makeBoundClient(store, sink);
    const selected = bound.client.selectInstallerArtifact(release);
    expect(selected.ok).toBe(true);
    const bootstrap = bound.client.bootstrap(
      bound.bootstrapSeam,
      { requestId: REQUEST_ID, code: CODE },
      BOOTSTRAP_AT,
      CORR,
    );
    expect(bootstrap.ok).toBe(true);
    expect(store.get(SCOPE, REQUEST_ID)?.status).toBe("fulfilled");

    // 5. First check-in (composed through the frozen helpers).
    const checkIn = bound.client.firstCheckIn(bound.checkInSeam, {
      commandId: makeCommandId("w100a-binding-checkin"),
      idempotencyKey: makeIdempotencyKey("w100a-binding-checkin-idem"),
      correlationId: CORR,
      issuedAt: CHECKIN_AT,
    });
    expect(checkIn.ok).toBe(true);
    expect(bound.submittedCommands.length).toBe(1);

    // 6. First observation (the frozen-contracts batch).
    const observation = bound.client.firstObservation(
      bound.observationSeam,
      { kind: "agent.first-check-in", payload: { healthy: true }, observedAt: OBSERVED_AT },
      CORR,
    );
    expect(observation.ok).toBe(true);
    expect(bound.flushedBatches.length).toBe(1);

    // 7. The BINDING SITE creates the Device Twin + ingests the first
    //    observation (the shell's job — never the UI's).
    const twinStore = createTwinAtBindingSite(store);

    // 8. The AGENT confirms the twin (the journey's terminal goal).
    const twinSeam = {
      confirm: (tenantId: typeof TENANT_A, deviceId: typeof DEVICE) => {
        const twin = tenantId === TENANT_A ? twinStore.get(tenantId, deviceId) : undefined;
        return {
          exists: twin !== undefined,
          observationCount: twin?.telemetry.observationCount ?? 0,
          ...(twin !== undefined ? { enrolledAt: twin.identity.enrolledAt } : {}),
        };
      },
    };
    const confirmed = bound.client.confirmTwin(twinSeam as never, TWIN_AT, CORR);
    expect(confirmed.ok).toBe(true);
    expect(bound.client.progress.stage).toBe("twin_confirmed");

    // 9. The CONSOLE sees the enrolled device in the SAME tenant with
    //    its first observation — the W090A verification over the REAL
    //    twin source (Device Doctor is reachable from here).
    const verification = verifyEnrollment(SCOPE_A, twinStore as DeviceTwinSource, DEVICE);
    expect(verification.status).toBe("verified");
    expect(verification.evidence.observationCount).toBe(1);
    // The other tenant sees nothing (isolation holds through the whole
    // journey).
    expect(verifyEnrollment({ tenantId: TENANT_B }, twinStore as DeviceTwinSource, DEVICE).status).toBe(
      "unknown_device",
    );

    // 10. The install center's view: the REAL agent progress satisfies
    //     the journey seam structurally; the verification is complete;
    //     the next action opens Device Doctor.
    const journey: EnrollmentJourneyLike = bound.client.progress;
    const installVerification = installationVerification(journey, state, release);
    expect(installVerification.complete).toBe(true);
    expect(installVerification.stage).toBe("twin_confirmed");
    expect(nextInstallAction(state, release, journey).id).toBe("open_device_doctor");

    // 11. The audit/evidence trail exists (machine-stable actions; the
    //     code appears in NO audit record).
    const actions = sink.records.map((r) => r.action);
    expect(actions).toContain("enrollment.request.created");
    expect(actions).toContain("enrollment.request.fulfilled");
    for (const audited of sink.records) {
      expect(JSON.stringify(audited)).not.toContain(CODE);
    }
  });

  test("the refusal journey: an expired code refuses VERBATIM and the console renders it", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const release = realRelease();

    const created = createEnrollmentRequest({
      tenantId: TENANT_A,
      requestId: REQUEST_ID,
      code: CODE,
      ownershipKind: "corporate_owned",
      ttlMs: TTL_MS,
      now: T0,
      correlationId: CORR,
    });
    if (!created.ok) throw new Error("creation failed");
    store.put(SCOPE, created.record);

    // The console state with the request recorded.
    let state: InstallCenterState = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "windows", "x64");
    state = selectOwnershipKind(state, "corporate_owned");
    state = recordEnrollmentRequest(state, created.record, created.code);

    // The agent presents the code AFTER expiry: the seam redeems at a
    // late instant (the store refuses + records + audits the expiry).
    const made = createAgentEnrollmentClient({
      tenantId: TENANT_A,
      deviceId: DEVICE,
      adapterFamily: "windows",
      agent: { moduleName: "agent", moduleVersion: "1.2.3", protocolVersion: 1 },
      platform: "windows",
      arch: "x64",
    });
    if (!made.ok) throw new Error("client construction failed");
    const lateSeam = {
      redeem: (input: {
        tenantId: typeof TENANT_A;
        requestId: string;
        code: string;
        deviceId: typeof DEVICE;
      }) =>
        store.redeem(
          { tenantId: input.tenantId, correlationId: CORR },
          { requestId: input.requestId, code: input.code, deviceId: input.deviceId },
          "2026-01-05T00:00:00Z",
        ),
    };
    const refused = made.client.bootstrap(lateSeam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.refusal.reason).toBe("code_expired");
    // The refusal carries the machine reason AND the human explanation together.
    expect(refused.refusal.explanation).toContain("expired");

    // The console records + renders the refusal VERBATIM; the ladder
    // points at resolution.
    state = recordInstallRefusal(state, {
      reason: refused.refusal.reason,
      explanation: refused.refusal.explanation,
    });
    expect(nextInstallAction(state, release, made.client.progress).id).toBe("resolve_refusal");

    // The request is recorded as expired (short-lived is first-class).
    expect(store.get(SCOPE, REQUEST_ID)?.status).toBe("expired");
  });

  test("authority neutrality: the view-model performs NO enrollment (the store acts only at the boundary)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const release = realRelease();

    const created = createEnrollmentRequest({
      tenantId: TENANT_A,
      requestId: REQUEST_ID,
      code: CODE,
      ownershipKind: "corporate_owned",
      ttlMs: TTL_MS,
      now: T0,
    });
    if (!created.ok) throw new Error("creation failed");
    store.put(SCOPE, created.record);

    // The console drives EVERY view-model transition (platform, scope,
    // record, dismiss) — the request stays PENDING throughout.
    let state: InstallCenterState = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "linux", "arm64");
    state = selectOwnershipKind(state, "byod");
    state = recordEnrollmentRequest(state, created.record, created.code);
    state = dismissEnrollmentCode(state);
    expect(store.get(SCOPE, REQUEST_ID)?.status).toBe("pending");

    // The projections never mutate the store (pure reads).
    enrollmentCodeCard(state, T0, { expiringWithinMs: 3_600_000 });
    installationVerification(undefined, state, release);
    nextInstallAction(state, release, undefined);
    expect(store.get(SCOPE, REQUEST_ID)?.status).toBe("pending");
  });

  test("the REAL agent progress satisfies the journey seam (structural binding proof)", () => {
    const progress: AgentEnrollmentProgress = {
      stage: "checked_in",
      trust: {
        enrollmentRequestId: REQUEST_ID,
        deviceId: DEVICE,
        issuedAt: BOOTSTRAP_AT,
        sessionExpiresAt: "2026-01-02T00:00:00.000Z",
      },
      firstCheckIn: { at: CHECKIN_AT, kind: "registered" },
    };
    const journey: EnrollmentJourneyLike = progress;
    // A COMPLETE console state (platform + scope + request) so the
    // ladder reaches the journey-driven rungs.
    const created = createEnrollmentRequest({
      tenantId: TENANT_A,
      requestId: REQUEST_ID,
      code: CODE,
      ownershipKind: "corporate_owned",
      ttlMs: TTL_MS,
      now: T0,
    });
    if (!created.ok) throw new Error("creation failed");
    let state: InstallCenterState = selectInstallPlatform(
      initialInstallCenterState(TENANT_A),
      "windows",
      "x64",
    );
    state = selectOwnershipKind(state, "corporate_owned");
    state = recordEnrollmentRequest(state, created.record, created.code);
    const verification = installationVerification(journey, state, realRelease());
    expect(verification.checks.map((c) => c.state)).toEqual([
      "met",
      "met",
      "met",
      "unmet",
      "unmet",
    ]);
    expect(nextInstallAction(state, realRelease(), journey).id).toBe("await_first_observation");
  });
});
