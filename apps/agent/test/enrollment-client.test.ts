/**
 * W100A tests — the agent-side enrollment journey client
 * (@fleetos/agent/src/enrollment-client.ts).
 *
 * Proves the install contract's agent-side journey over REAL
 * device-adapters pieces (same lane — the client composes them, these
 * tests bind them):
 *
 *   - artifact selection resolves the claims' platform/arch and
 *     refuses `unsupported_platform` machine-stably;
 *   - bootstrap presents the one-time code at the REAL enrollment
 *     request store seam and receives the trust record; the control
 *     plane's refusals propagate VERBATIM (expired/used/revoked/not
 *     found/role mismatch/policy);
 *   - a THROWING or shape-invalid seam is `control_plane_unreachable`
 *     — fail-closed, NEVER a fabricated success;
 *   - first check-in composes a REAL frozen command (the composed
 *     envelope passes `validateCheckInCommand`; the session token is
 *     the REAL trust token — proven by the seam's captured command);
 *   - the journey ordering is enforced fail-closed (skipping a stage
 *     refuses `enrollment_not_bootstrapped`);
 *   - the first observation assembles the frozen-contracts batch
 *     (tenant + device scoped, deterministic idempotency key) and
 *     flushes through the seam;
 *   - Device Twin confirmation completes the journey ONLY when the
 *     twin exists with >= 1 observation (`twin_not_confirmed`
 *     otherwise);
 *   - the progress projection NEVER carries the session token (the
 *     credential lives in the closure, not the UI view);
 *   - the FULL happy-path journey runs end-to-end over the REAL store
 *     + REAL frozen helpers, deterministically;
 *   - malformed claims are refused machine-stably at construction.
 */

import { describe, expect, test } from "bun:test";
import {
  makeCommandId,
  makeCorrelationId,
  makeDeviceId,
  makeIdempotencyKey,
  makeTenantId,
  makeEventId,
} from "@fleetos/contracts/testing";
import {
  createCheckInAck,
  validateCheckInCommand,
  createEnrollmentRequest,
  createInMemoryEnrollmentRequestStore,
  type EnrollmentRequestScope,
} from "@fleetos/device-adapters";
import type {
  CommandEnvelope,
  CheckInCommandPayload,
  SessionState,
} from "@fleetos/device-adapters";
import {
  ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS,
  ENROLLMENT_CLIENT_REFUSAL_REASONS,
  ENROLLMENT_CLIENT_STAGE_ORDER,
  createAgentEnrollmentClient,
  type AgentBootstrapSeam,
  type AgentEnrollmentClaims,
  type AgentCheckInSubmissionSeam,
  type AgentObservationFlushSeam,
  type AgentTwinConfirmationSeam,
} from "../src/enrollment-client";
import { buildAgentRelease, installerScriptFor, ALL_RELEASE_TARGETS } from "../src/release";

const TENANT = makeTenantId("w100a-client-tenant");
const DEVICE = makeDeviceId("w100a-client-device");
const CORR = makeCorrelationId("w100a-client-corr");

const CLAIMS: AgentEnrollmentClaims = {
  tenantId: TENANT,
  deviceId: DEVICE,
  adapterFamily: "windows",
  agent: { moduleName: "agent", moduleVersion: "1.2.3", protocolVersion: 1 },
  platform: "windows",
  arch: "x64",
};

const CODE = "BOOT-CLIENT-CODE-1";
const REQUEST_ID = "enr_client-0001";
const CREATED_AT = "2026-01-01T00:00:00Z";
const BOOTSTRAP_AT = "2026-01-01T00:10:00Z";
const CHECKIN_AT = "2026-01-01T00:11:00Z";
const OBSERVED_AT = "2026-01-01T00:12:00Z";
const TWIN_AT = "2026-01-01T00:13:00Z";
const TTL_MS = 24 * 3_600_000;

const SCOPE: EnrollmentRequestScope = { tenantId: TENANT, correlationId: CORR };

function makeClient(): ReturnType<typeof createAgentEnrollmentClient> {
  const made = createAgentEnrollmentClient(CLAIMS);
  if (!made.ok) throw new Error("client construction failed");
  return made;
}

/** A REAL release manifest over the generated installer scripts. */
function makeRelease() {
  const built = buildAgentRelease({
    moduleVersion: CLAIMS.agent.moduleVersion,
    protocolVersion: CLAIMS.agent.protocolVersion,
    releasedAt: CREATED_AT,
    releaseNotes: "Test release.",
    payloads: ALL_RELEASE_TARGETS.map((target) => ({
      target,
      content: installerScriptFor(target, { moduleVersion: CLAIMS.agent.moduleVersion }),
    })),
    uninstallSteps: ["Run the uninstaller."],
    rollbackInstructions: ["Revoke trust; reinstall."],
  });
  if (!built.ok) throw new Error("release build failed");
  return built.manifest;
}

/** The REAL store-backed bootstrap seam (same lane, direct binding). */
function makeBootstrapSeam(options?: { readonly atOverride?: string }) {
  const store = createInMemoryEnrollmentRequestStore();
  const created = createEnrollmentRequest({
    tenantId: TENANT,
    requestId: REQUEST_ID,
    code: CODE,
    ownershipKind: "corporate_owned",
    ttlMs: TTL_MS,
    now: CREATED_AT,
    correlationId: CORR,
  });
  if (!created.ok) throw new Error("request creation failed");
  store.put(SCOPE, created.record);
  const seam: AgentBootstrapSeam = {
    redeem: (input) =>
      store.redeem(
        { tenantId: input.tenantId, correlationId: CORR },
        {
          requestId: input.requestId,
          code: input.code,
          deviceId: input.deviceId,
          ...(input.presenterRole !== undefined ? { presenterRole: input.presenterRole } : {}),
        },
        options?.atOverride ?? BOOTSTRAP_AT,
      ),
  };
  return { store, seam, record: created.record };
}

/** A recording check-in submission seam returning a REAL ack. */
function makeCheckInSeam(options?: { readonly reject?: boolean; readonly reason?: string }) {
  const submitted: CommandEnvelope<CheckInCommandPayload>[] = [];
  const seam: AgentCheckInSubmissionSeam = {
    submit: (command) => {
      submitted.push(command);
      if (options?.reject === true) {
        return { ok: false, reason: options.reason ?? "session_refused" };
      }
      const session: SessionState = {
        sessionId: "sess_w100a_client_1",
        status: "active",
        expiresAt: "2026-01-02T00:00:00.000Z",
        refreshAfterMs: null,
      };
      const ack = createCheckInAck(
        { session, kind: "registered" },
        {
          id: makeEventId("w100a-client-ack"),
          tenantId: TENANT,
          subject: DEVICE,
          occurredAt: CHECKIN_AT,
          correlationId: CORR,
          causationId: command.id as never,
        },
      );
      return { ok: true, ack };
    },
  };
  return { seam, submitted };
}

/** A recording observation flush seam. */
function makeObservationSeam(options?: { readonly refuse?: boolean }) {
  const batches: unknown[] = [];
  const seam: AgentObservationFlushSeam = {
    flush: (batch, at) => {
      batches.push({ batch, at });
      if (options?.refuse === true) return { ok: false, reason: "ingestion_refused" };
      return { ok: true };
    },
  };
  return { seam, batches };
}

/** A twin confirmation seam over an explicit twin state. */
function makeTwinSeam(state: {
  readonly exists: boolean;
  readonly observationCount: number;
  readonly enrolledAt?: string;
}): AgentTwinConfirmationSeam {
  return {
    confirm: (tenantId, deviceId) => ({
      exists: tenantId === TENANT && deviceId === DEVICE ? state.exists : false,
      observationCount:
        tenantId === TENANT && deviceId === DEVICE ? state.observationCount : 0,
      ...(state.enrolledAt !== undefined ? { enrolledAt: state.enrolledAt } : {}),
    }),
  };
}

describe("W100A client construction + artifact selection", () => {
  test("malformed claims are refused machine-stably", () => {
    expect(createAgentEnrollmentClient({ ...CLAIMS, tenantId: "" as never }).error?.path).toBe("/tenantId");
    expect(createAgentEnrollmentClient({ ...CLAIMS, deviceId: "" as never }).error?.path).toBe("/deviceId");
    expect(createAgentEnrollmentClient({ ...CLAIMS, adapterFamily: "" }).error?.path).toBe("/adapterFamily");
    expect(createAgentEnrollmentClient({ ...CLAIMS, platform: "" }).error?.path).toBe("/platform");
    expect(createAgentEnrollmentClient({ ...CLAIMS, arch: "" }).error?.path).toBe("/arch");
    expect(createAgentEnrollmentClient({ ...CLAIMS, agent: undefined as never }).error?.path).toBe("/agent");
  });

  test("the client resolves its platform's artifact (install command + checksum)", () => {
    const { client } = makeClient();
    const selected = client.selectInstallerArtifact(makeRelease());
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error("unreachable");
    expect(selected.installCommand).toContain("powershell");
    expect(selected.checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  test("an unsupported platform refuses machine-stably", () => {
    const made = createAgentEnrollmentClient({ ...CLAIMS, platform: "plan9" });
    if (!made.ok) throw new Error("construction failed");
    const selected = made.client.selectInstallerArtifact(makeRelease());
    expect(selected.ok).toBe(false);
    if (selected.ok) throw new Error("unreachable");
    expect(selected.refusal.reason).toBe("unsupported_platform");
    expect(selected.refusal.explanation).toContain("plan9");
  });
});

describe("W100A bootstrap (the one-time code exchange)", () => {
  test("a valid code exchanges for the trust record and advances the stage", () => {
    const { client } = makeClient();
    const { seam } = makeBootstrapSeam();
    const result = client.bootstrap(seam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    expect(result.ok).toBe(true);
    expect(client.progress.stage).toBe("bootstrapped");
    expect(client.progress.trust?.enrollmentRequestId).toBe(REQUEST_ID);
    expect(client.progress.trust?.deviceId).toBe(DEVICE);
    expect(client.progress.trust?.issuedAt).toBe(BOOTSTRAP_AT);
  });

  test("the progress projection NEVER carries the session token value", () => {
    const { client } = makeClient();
    const { seam } = makeBootstrapSeam();
    client.bootstrap(seam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    const projection = JSON.stringify(client.progress);
    // The trust projection carries only the expiry horizon — never the token.
    expect(projection).not.toMatch(/"value"/);
    expect(projection).not.toMatch(/fst_/);
  });

  test("the control plane's refusals propagate VERBATIM (machine reason + human explanation)", () => {
    // Expired.
    const expired = makeClient();
    const expiredSeam = makeBootstrapSeam({ atOverride: "2026-01-05T00:00:00Z" });
    const expiredResult = expired.client.bootstrap(
      expiredSeam.seam,
      { requestId: REQUEST_ID, code: CODE },
      BOOTSTRAP_AT,
      CORR,
    );
    expect(expiredResult.ok).toBe(false);
    if (expiredResult.ok) throw new Error("unreachable");
    expect(expiredResult.refusal.reason).toBe("code_expired");
    expect(expiredResult.refusal.explanation).toContain("expired");

    // Wrong code.
    const wrong = makeClient();
    const wrongSeam = makeBootstrapSeam();
    const wrongResult = wrong.client.bootstrap(
      wrongSeam.seam,
      { requestId: REQUEST_ID, code: "BOOT-CLIENT-CODE-9" },
      BOOTSTRAP_AT,
    );
    expect(wrongResult.ok).toBe(false);
    if (wrongResult.ok) throw new Error("unreachable");
    expect(wrongResult.refusal.reason).toBe("code_not_found");

    // Revoked.
    const revoked = makeClient();
    const revokedSeam = makeBootstrapSeam();
    revokedSeam.store.revoke(SCOPE, REQUEST_ID, "rotation", BOOTSTRAP_AT);
    const revokedResult = revoked.client.bootstrap(
      revokedSeam.seam,
      { requestId: REQUEST_ID, code: CODE },
      BOOTSTRAP_AT,
    );
    expect(revokedResult.ok).toBe(false);
    if (revokedResult.ok) throw new Error("unreachable");
    expect(revokedResult.refusal.reason).toBe("code_revoked");
  });

  test("a throwing seam is control_plane_unreachable — never a fabricated success", () => {
    const { client } = makeClient();
    const throwing: AgentBootstrapSeam = {
      redeem: () => {
        throw new Error("network down");
      },
    };
    const result = client.bootstrap(throwing, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("control_plane_unreachable");
    expect(result.refusal.explanation).toBe(
      ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS.control_plane_unreachable,
    );
    expect(client.progress.stage).toBe("failed");
  });

  test("a shape-invalid seam response is control_plane_unreachable (fail-closed)", () => {
    const { client } = makeClient();
    const malformed: AgentBootstrapSeam = {
      redeem: () => "not-a-result" as never,
    };
    const result = client.bootstrap(malformed, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("control_plane_unreachable");
  });

  test("a second bootstrap on the same client refuses (ordering, fail-closed)", () => {
    const { client } = makeClient();
    const { seam } = makeBootstrapSeam();
    client.bootstrap(seam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    const again = client.bootstrap(seam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.refusal.reason).toBe("enrollment_not_bootstrapped");
  });
});

describe("W100A first check-in (composed through the frozen helpers)", () => {
  function bootstrapped() {
    const made = makeClient();
    const bootstrap = makeBootstrapSeam();
    made.client.bootstrap(bootstrap.seam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    return made;
  }

  test("the composed command is a REAL valid frozen check-in command", () => {
    const { client } = bootstrapped();
    const { seam, submitted } = makeCheckInSeam();
    const result = client.firstCheckIn(seam, {
      commandId: makeCommandId("w100a-checkin"),
      idempotencyKey: makeIdempotencyKey("w100a-checkin-idem"),
      correlationId: CORR,
      issuedAt: CHECKIN_AT,
    });
    expect(result.ok).toBe(true);
    expect(submitted.length).toBe(1);
    // The composed envelope passes the FROZEN validation.
    expect(validateCheckInCommand(submitted[0]).ok).toBe(true);
    expect(client.progress.stage).toBe("checked_in");
    expect(client.progress.firstCheckIn?.kind).toBe("registered");
  });

  test("the session token in the composed command is the REAL trust token", () => {
    const { client } = bootstrapped();
    const { seam, submitted } = makeCheckInSeam();
    client.firstCheckIn(seam, {
      commandId: makeCommandId("w100a-token"),
      idempotencyKey: makeIdempotencyKey("w100a-token-idem"),
      correlationId: CORR,
      issuedAt: CHECKIN_AT,
    });
    expect(submitted[0].payload.sessionToken?.value).toMatch(/^fst_/);
    expect(submitted[0].payload.sessionToken?.issuedAt).toBe(BOOTSTRAP_AT);
    expect(submitted[0].payload.identity.deviceId).toBe(DEVICE);
    expect(submitted[0].payload.identity.tenantId).toBe(TENANT);
    expect(submitted[0].tenantId).toBe(TENANT);
  });

  test("skipping bootstrap refuses machine-stably", () => {
    const { client } = makeClient();
    const { seam } = makeCheckInSeam();
    const result = client.firstCheckIn(seam, {
      commandId: makeCommandId("w100a-skip"),
      idempotencyKey: makeIdempotencyKey("w100a-skip-idem"),
      correlationId: CORR,
      issuedAt: CHECKIN_AT,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("enrollment_not_bootstrapped");
  });

  test("a refused submission is first_check_in_refused with the machine reason", () => {
    const { client } = bootstrapped();
    const { seam } = makeCheckInSeam({ reject: true, reason: "tenant_suspended" });
    const result = client.firstCheckIn(seam, {
      commandId: makeCommandId("w100a-refused"),
      idempotencyKey: makeIdempotencyKey("w100a-refused-idem"),
      correlationId: CORR,
      issuedAt: CHECKIN_AT,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("first_check_in_refused");
    expect(result.refusal.explanation).toContain("tenant_suspended");
  });
});

describe("W100A first observation + twin confirmation", () => {
  function checkedIn() {
    const made = makeClient();
    const bootstrap = makeBootstrapSeam();
    made.client.bootstrap(bootstrap.seam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR);
    const checkIn = makeCheckInSeam();
    made.client.firstCheckIn(checkIn.seam, {
      commandId: makeCommandId("w100a-obs"),
      idempotencyKey: makeIdempotencyKey("w100a-obs-idem"),
      correlationId: CORR,
      issuedAt: CHECKIN_AT,
    });
    return made;
  }

  test("the first observation assembles the frozen batch and flushes through the seam", () => {
    const { client } = checkedIn();
    const { seam, batches } = makeObservationSeam();
    const result = client.firstObservation(
      seam,
      { kind: "agent.first-check-in", payload: { healthy: true }, observedAt: OBSERVED_AT },
      CORR,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.idempotencyKey).toContain("agent.first-check-in");
    expect(batches.length).toBe(1);
    const flushed = batches[0] as { batch: { tenantId: string; deviceId: string; observations: { kind: string }[] } };
    expect(flushed.batch.tenantId).toBe(TENANT);
    expect(flushed.batch.deviceId).toBe(DEVICE);
    expect(flushed.batch.observations[0].kind).toBe("agent.first-check-in");
    expect(client.progress.stage).toBe("observed");
    expect(client.progress.firstObservation?.kind).toBe("agent.first-check-in");
  });

  test("an empty observation kind is refused (fail-closed)", () => {
    const { client } = checkedIn();
    const { seam } = makeObservationSeam();
    const result = client.firstObservation(seam, { kind: "", payload: {}, observedAt: OBSERVED_AT }, CORR);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("observation_flush_refused");
  });

  test("twin confirmation completes the journey only with an existing twin + observation", () => {
    const confirmed = checkedIn();
    const obs = makeObservationSeam();
    confirmed.client.firstObservation(
      obs.seam,
      { kind: "agent.first-check-in", payload: { healthy: true }, observedAt: OBSERVED_AT },
      CORR,
    );
    const result = confirmed.client.confirmTwin(
      makeTwinSeam({ exists: true, observationCount: 1, enrolledAt: BOOTSTRAP_AT }),
      TWIN_AT,
      CORR,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.confirmed.observationCount).toBe(1);
    expect(confirmed.client.progress.stage).toBe("twin_confirmed");
    expect(confirmed.client.progress.twinConfirmed?.at).toBe(TWIN_AT);
  });

  test("a missing twin or a twin without observations refuses twin_not_confirmed", () => {
    const noTwin = checkedIn();
    const obsA = makeObservationSeam();
    noTwin.client.firstObservation(obsA.seam, { kind: "k", payload: {}, observedAt: OBSERVED_AT }, CORR);
    const missing = noTwin.client.confirmTwin(makeTwinSeam({ exists: false, observationCount: 0 }), TWIN_AT, CORR);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.refusal.reason).toBe("twin_not_confirmed");

    const emptyTwin = checkedIn();
    const obsB = makeObservationSeam();
    emptyTwin.client.firstObservation(obsB.seam, { kind: "k", payload: {}, observedAt: OBSERVED_AT }, CORR);
    const unobserved = emptyTwin.client.confirmTwin(makeTwinSeam({ exists: true, observationCount: 0 }), TWIN_AT, CORR);
    expect(unobserved.ok).toBe(false);
    if (unobserved.ok) throw new Error("unreachable");
    expect(unobserved.refusal.reason).toBe("twin_not_confirmed");
  });

  test("confirming before observing refuses (ordering, fail-closed)", () => {
    const { client } = checkedIn();
    const result = client.confirmTwin(makeTwinSeam({ exists: true, observationCount: 1 }), TWIN_AT, CORR);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("enrollment_not_bootstrapped");
  });
});

describe("W100A the full happy-path journey (deterministic end-to-end)", () => {
  test("bootstrap -> first check-in -> first observation -> twin confirmation", () => {
    const release = makeRelease();
    const { client } = makeClient();
    const bootstrap = makeBootstrapSeam();
    const checkIn = makeCheckInSeam();
    const observation = makeObservationSeam();

    // 1. artifact selection
    const selected = client.selectInstallerArtifact(release);
    expect(selected.ok).toBe(true);
    // 2. bootstrap
    expect(client.bootstrap(bootstrap.seam, { requestId: REQUEST_ID, code: CODE }, BOOTSTRAP_AT, CORR).ok).toBe(true);
    // 3. first check-in
    expect(
      client.firstCheckIn(checkIn.seam, {
        commandId: makeCommandId("w100a-e2e"),
        idempotencyKey: makeIdempotencyKey("w100a-e2e-idem"),
        correlationId: CORR,
        issuedAt: CHECKIN_AT,
      }).ok,
    ).toBe(true);
    // 4. first observation
    expect(
      client.firstObservation(
        observation.seam,
        { kind: "agent.first-check-in", payload: { healthy: true }, observedAt: OBSERVED_AT },
        CORR,
      ).ok,
    ).toBe(true);
    // 5. twin confirmation
    expect(
      client.confirmTwin(makeTwinSeam({ exists: true, observationCount: 1, enrolledAt: BOOTSTRAP_AT }), TWIN_AT, CORR).ok,
    ).toBe(true);

    // The store consumed the request exactly once.
    expect(bootstrap.store.get(SCOPE, REQUEST_ID)?.status).toBe("fulfilled");

    // The journey projection is complete and stage-ordered.
    expect(client.progress.stage).toBe("twin_confirmed");
    expect(client.progress.trust?.enrollmentRequestId).toBe(REQUEST_ID);
    expect(client.progress.firstCheckIn?.at).toBe(CHECKIN_AT);
    expect(client.progress.firstObservation?.at).toBe(OBSERVED_AT);
    expect(client.progress.twinConfirmed?.observationCount).toBe(1);
  });

  test("the client refusal taxonomy is closed and every client-side reason has its explanation", () => {
    expect(ENROLLMENT_CLIENT_REFUSAL_REASONS).toContain("code_expired");
    expect(ENROLLMENT_CLIENT_REFUSAL_REASONS).toContain("control_plane_unreachable");
    expect(ENROLLMENT_CLIENT_REFUSAL_REASONS).toContain("twin_not_confirmed");
    for (const reason of [
      "control_plane_unreachable",
      "unsupported_platform",
      "enrollment_not_bootstrapped",
      "first_check_in_refused",
      "observation_flush_refused",
      "twin_not_confirmed",
    ] as const) {
      expect(ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS[reason].length).toBeGreaterThan(20);
    }
    expect(ENROLLMENT_CLIENT_STAGE_ORDER).toEqual([
      "unbootstrapped",
      "bootstrapped",
      "checked_in",
      "observed",
      "twin_confirmed",
    ]);
  });
});
