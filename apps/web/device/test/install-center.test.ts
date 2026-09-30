/**
 * W100A tests — the install center view-model
 * (@fleetos/web-device/src/install-center.ts).
 *
 * Proves:
 *   - the platform facets derive deterministically from the release
 *     (canonical order, availability, archs, selection);
 *   - the install plan is the release artifact's data VERBATIM (file
 *     name, size, checksum + algorithm, install command) with the
 *     four contract steps (download/verify/copy/install);
 *   - the ownership-kind presentation covers the install contract's
 *     four distinctions, with the BYOD conservative note;
 *   - the one-time code card: display-once semantics (record ->
 *     present; dismiss -> gone, record retained), status bands from
 *     the injected instant (active/expiring_soon/expired/used/revoked);
 *   - the installation verification checks derive from the journey
 *     trace (installer_ready -> bootstrap -> check-in -> observation
 *     -> twin);
 *   - the next-action ladder is deterministic over (state, release,
 *     journey);
 *   - the uninstall/revoke plan presents AUTHORIZATION-REQUIRED
 *     intents (never executions) + verbatim manifest steps;
 *   - the structural seams: the REAL @fleetos/agent release manifest
 *     and the REAL @fleetos/device-adapters enrollment-request record
 *     flow through the seams unchanged (the runtime binding proof);
 *   - the scope guard refuses tenant mismatches.
 */

import { describe, expect, test } from "bun:test";
import { makeTenantId } from "@fleetos/contracts/testing";
import {
  buildAgentRelease,
  installerScriptFor,
  ALL_RELEASE_TARGETS,
  type AgentReleaseManifest,
} from "@fleetos/agent";
import {
  createEnrollmentRequest,
  type EnrollmentRequestRecord,
} from "@fleetos/device-adapters";
import {
  INSTALL_CENTER_OWNERSHIP_KIND_ORDER,
  INSTALL_CENTER_PLATFORM_ORDER,
  checkInstallCenterScope,
  dismissEnrollmentCode,
  dismissInstallRefusal,
  enrollmentCodeCard,
  enrollmentCodeStatus,
  initialInstallCenterState,
  installPlan,
  installationVerification,
  nextInstallAction,
  ownershipKindPresentation,
  platformFacets,
  recordEnrollmentRequest,
  recordInstallRefusal,
  releaseSummary,
  selectInstallPlatform,
  selectOwnershipKind,
  uninstallPlan,
  type EnrollmentJourneyLike,
  type EnrollmentRequestLike,
  type ReleaseManifestLike,
} from "../src/install-center";
import { SCOPE_A, TENANT_A, TENANT_B } from "./helpers";
import type { DeviceUiTenantScope } from "../src/internal";

const T0 = "2026-01-01T00:00:00Z";

/** The REAL agent release manifest (the structural-seam proof value). */
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

/** A REAL device-adapters enrollment request record + its one-time code. */
function realRequest(): { readonly record: EnrollmentRequestRecord; readonly code: string } {
  const created = createEnrollmentRequest({
    tenantId: TENANT_A,
    requestId: "enr_ic-0001",
    code: "BOOT-INSTALL-001",
    ownershipKind: "corporate_owned",
    ttlMs: 24 * 3_600_000,
    now: T0,
  });
  if (!created.ok) throw new Error("request creation failed");
  return { record: created.record, code: created.code };
}

const JOURNEY: Readonly<Record<string, EnrollmentJourneyLike | undefined>> = {
  none: undefined,
  fresh: { stage: "unbootstrapped" },
  bootstrapped: {
    stage: "bootstrapped",
    trust: { enrollmentRequestId: "enr_ic-0001", deviceId: "dev_x", issuedAt: T0 },
  },
  checkedIn: {
    stage: "checked_in",
    trust: { enrollmentRequestId: "enr_ic-0001", deviceId: "dev_x", issuedAt: T0 },
    firstCheckIn: { at: T0, kind: "registered" },
  },
  observed: {
    stage: "observed",
    trust: { enrollmentRequestId: "enr_ic-0001", deviceId: "dev_x", issuedAt: T0 },
    firstCheckIn: { at: T0, kind: "registered" },
    firstObservation: { kind: "agent.first-check-in", at: T0 },
  },
  confirmed: {
    stage: "twin_confirmed",
    trust: { enrollmentRequestId: "enr_ic-0001", deviceId: "dev_x", issuedAt: T0 },
    firstCheckIn: { at: T0, kind: "registered" },
    firstObservation: { kind: "agent.first-check-in", at: T0 },
    twinConfirmed: { at: T0, observationCount: 1 },
  },
  failed: { stage: "failed" },
};

describe("W100A platform facets", () => {
  test("the facets follow the canonical platform order with availability + archs from the release", () => {
    const state = initialInstallCenterState(TENANT_A);
    const facets = platformFacets(realRelease(), state);
    expect(facets.map((f) => f.platform)).toEqual([...INSTALL_CENTER_PLATFORM_ORDER]);
    for (const facet of facets) {
      expect(facet.available).toBe(true);
      expect(facet.archs).toEqual(["x64", "arm64"]);
      expect(facet.selected).toBe(false);
    }
  });

  test("a release without artifacts for a platform marks it unavailable", () => {
    const release = realRelease();
    const partial: ReleaseManifestLike = {
      ...release,
      artifacts: release.artifacts.filter((a) => a.platform !== "macos"),
    };
    const facets = platformFacets(partial, initialInstallCenterState(TENANT_A));
    expect(facets.find((f) => f.platform === "macos")?.available).toBe(false);
    expect(facets.find((f) => f.platform === "macos")?.archs).toEqual([]);
    expect(facets.find((f) => f.platform === "windows")?.available).toBe(true);
  });

  test("selection is reflected on the matching facet only", () => {
    let state = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "linux", "arm64");
    const facets = platformFacets(realRelease(), state);
    expect(facets.find((f) => f.platform === "linux")?.selected).toBe(true);
    expect(facets.find((f) => f.platform === "windows")?.selected).toBe(false);
  });

  test("an absent release yields all-unavailable facets (never a fabricated plan)", () => {
    const facets = platformFacets(undefined, initialInstallCenterState(TENANT_A));
    expect(facets.every((f) => f.available === false)).toBe(true);
    expect(installPlan(undefined, initialInstallCenterState(TENANT_A))).toBeUndefined();
  });
});

describe("W100A the install plan (download/verify/copy/install)", () => {
  test("the plan carries the artifact's data VERBATIM + the four contract steps", () => {
    const release = realRelease();
    let state = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "windows", "arm64");
    const plan = installPlan(release, state);
    expect(plan).toBeDefined();
    if (plan === undefined) throw new Error("unreachable");
    const artifact = release.artifacts.find((a) => a.platform === "windows" && a.arch === "arm64");
    if (artifact === undefined) throw new Error("artifact missing");
    expect(plan.fileName).toBe(artifact.fileName);
    expect(plan.sizeBytes).toBe(artifact.sizeBytes);
    expect(plan.checksum).toBe(artifact.checksum);
    expect(plan.checksumAlgorithm).toBe(artifact.checksumAlgorithm);
    expect(plan.installCommand).toBe(artifact.installCommand);
    expect(plan.steps.map((s) => s.id)).toEqual([
      "download",
      "verify_checksum",
      "copy_command",
      "install",
    ]);
    // The checksum step shows the algorithm + value; the copy step shows the command.
    expect(plan.steps[1].detail).toContain(artifact.checksumAlgorithm);
    expect(plan.steps[2].detail).toBe(artifact.installCommand);
  });

  test("no selection or an unsupported selection yields NO plan (refuse to fabricate)", () => {
    const release = realRelease();
    expect(installPlan(release, initialInstallCenterState(TENANT_A))).toBeUndefined();
    let state = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "solaris", "x64");
    expect(installPlan(release, state)).toBeUndefined();
  });
});

describe("W100A ownership scope presentation (the contract's four distinctions)", () => {
  test("the four kinds are the install contract's list, in canonical order", () => {
    expect([...INSTALL_CENTER_OWNERSHIP_KIND_ORDER]).toEqual([
      "corporate_owned",
      "leased",
      "byod",
      "third_party_managed",
    ]);
  });

  test("BYOD carries the conservative note; the others do not", () => {
    expect(ownershipKindPresentation("byod").byodConservative).toBe(true);
    expect(ownershipKindPresentation("byod").note).toContain("minimized");
    for (const kind of ["corporate_owned", "leased", "third_party_managed"]) {
      expect(ownershipKindPresentation(kind).byodConservative).toBe(false);
    }
  });

  test("unknown kinds degrade gracefully (never a guess, never a crash)", () => {
    const unknown = ownershipKindPresentation("some_future_kind");
    expect(unknown.label).toBe("some_future_kind");
    expect(unknown.byodConservative).toBe(false);
  });
});

describe("W100A the one-time enrollment code card", () => {
  function stateWithRequest() {
    const { record, code } = realRequest();
    let state = initialInstallCenterState(TENANT_A);
    state = recordEnrollmentRequest(state, record, code);
    return { state, record, code };
  }

  test("recording the request shows the code exactly once; dismissing hides it but keeps the record", () => {
    const { state, record, code } = stateWithRequest();
    const card = enrollmentCodeCard(state, T0, { expiringWithinMs: 3_600_000 });
    expect(card?.code).toBe(code);
    expect(card?.requestId).toBe(record.requestId);
    expect(card?.status).toBe("active");
    const dismissed = enrollmentCodeCard(dismissEnrollmentCode(state), T0, {
      expiringWithinMs: 3_600_000,
    });
    expect(dismissed?.code).toBeUndefined();
    expect(dismissed?.requestId).toBe(record.requestId);
  });

  test("the status band derives from the injected instant + the record status", () => {
    const { record } = realRequest();
    // active well before expiry
    expect(enrollmentCodeStatus(record, "2026-01-01T01:00:00Z", 3_600_000)).toBe("active");
    // expiring_soon inside the window (30m left < 1h window)
    expect(enrollmentCodeStatus(record, "2026-01-01T23:30:00Z", 3_600_000)).toBe("expiring_soon");
    // expired past the horizon
    expect(enrollmentCodeStatus(record, "2026-01-02T00:00:01Z", 3_600_000)).toBe("expired");
    // fulfilled / revoked come from the record
    expect(enrollmentCodeStatus({ ...record, status: "fulfilled" } as EnrollmentRequestLike, T0, 3_600_000)).toBe("used");
    expect(enrollmentCodeStatus({ ...record, status: "revoked" } as EnrollmentRequestLike, T0, 3_600_000)).toBe("revoked");
  });

  test("the revoke affordance is an authorization-required INTENT (never an execution)", () => {
    const { state } = stateWithRequest();
    const card = enrollmentCodeCard(state, T0, { expiringWithinMs: 3_600_000 });
    expect(card?.revokeIntent.intent).toBe("enrollment.code.disable");
    expect(card?.revokeIntent.requiresAuthorization).toBe(true);
    expect(card?.revokeIntent.note).toContain("authorized");
  });

  test("the allowed-roles projection is the record's verbatim", () => {
    const created = createEnrollmentRequest({
      tenantId: TENANT_A,
      requestId: "enr_ic-0002",
      code: "BOOT-INSTALL-002",
      ownershipKind: "byod",
      allowedRoles: ["fleet.operator", "service.desk"],
      ttlMs: 24 * 3_600_000,
      now: T0,
    });
    if (!created.ok) throw new Error("creation failed");
    const state = recordEnrollmentRequest(initialInstallCenterState(TENANT_A), created.record, created.code);
    const card = enrollmentCodeCard(state, T0, { expiringWithinMs: 3_600_000 });
    expect(card?.allowedRoles).toEqual(["fleet.operator", "service.desk"]);
    expect(card?.ownership.kind).toBe("byod");
  });
});

describe("W100A installation verification + the next-action ladder", () => {
  test("the checks derive from the journey trace (all unmet without a journey)", () => {
    const release = realRelease();
    const bare = installationVerification(undefined, initialInstallCenterState(TENANT_A), release);
    expect(bare.checks.every((c) => c.state === "unmet")).toBe(true);
    expect(bare.complete).toBe(false);
    expect(bare.stage).toBeUndefined();
  });

  test("a complete journey meets every check (installer selected + full trace)", () => {
    const release = realRelease();
    let state = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "windows", "x64");
    const verification = installationVerification(JOURNEY.confirmed, state, release);
    expect(verification.checks.every((c) => c.state === "met")).toBe(true);
    expect(verification.complete).toBe(true);
    expect(verification.stage).toBe("twin_confirmed");
  });

  test("the ladder is deterministic over (state, release, journey)", () => {
    const release = realRelease();
    // No platform -> select_platform.
    expect(nextInstallAction(initialInstallCenterState(TENANT_A), release, undefined).id).toBe(
      "select_platform",
    );
    // Platform but no scope -> choose_ownership_scope.
    let state = selectInstallPlatform(initialInstallCenterState(TENANT_A), "windows", "x64");
    expect(nextInstallAction(state, release, undefined).id).toBe("choose_ownership_scope");
    // Scope but no request -> create_code.
    state = selectOwnershipKind(state, "corporate_owned");
    expect(nextInstallAction(state, release, undefined).id).toBe("create_code");
    // Request, no journey -> complete_install.
    const { record, code } = realRequest();
    state = recordEnrollmentRequest(state, record, code);
    expect(nextInstallAction(state, release, undefined).id).toBe("complete_install");
    expect(nextInstallAction(state, release, JOURNEY.fresh).id).toBe("complete_install");
    expect(nextInstallAction(state, release, JOURNEY.failed).id).toBe("complete_install");
    // Bootstrapped -> await first check-in.
    expect(nextInstallAction(state, release, JOURNEY.bootstrapped).id).toBe("await_first_check_in");
    // Checked in -> await first observation.
    expect(nextInstallAction(state, release, JOURNEY.checkedIn).id).toBe("await_first_observation");
    // Observed -> await twin confirmation.
    expect(nextInstallAction(state, release, JOURNEY.observed).id).toBe("await_twin_confirmation");
    // Confirmed -> open Device Doctor.
    expect(nextInstallAction(state, release, JOURNEY.confirmed).id).toBe("open_device_doctor");
  });

  test("a recorded refusal takes the ladder's first position (resolve_refusal)", () => {
    const release = realRelease();
    let state = selectInstallPlatform(initialInstallCenterState(TENANT_A), "windows", "x64");
    state = selectOwnershipKind(state, "corporate_owned");
    state = recordInstallRefusal(state, {
      reason: "code_expired",
      explanation: "This enrollment code has expired.",
    });
    expect(nextInstallAction(state, release, JOURNEY.confirmed).id).toBe("resolve_refusal");
    expect(dismissInstallRefusal(state).refusal).toBeUndefined();
  });
});

describe("W100A uninstall/revoke plan + release summary", () => {
  test("the uninstall plan presents the manifest steps VERBATIM + authorization-required intents", () => {
    const release = realRelease();
    const plan = uninstallPlan(release);
    expect(plan.uninstallSteps).toEqual(["Run the uninstaller from Settings > Apps."]);
    expect(plan.rollbackInstructions).toEqual(["Revoke the device trust from the console."]);
    expect(plan.revokeIntents.map((i) => i.intent)).toEqual([
      "enrollment.code.disable",
      "device.trust.revoke",
    ]);
    for (const intent of plan.revokeIntents) {
      expect(intent.requiresAuthorization).toBe(true);
    }
    expect(plan.postUninstallState).toContain("trust record stays revocable");
    expect(plan.auditNote).toContain("audit trail");
  });

  test("the release summary projects the manifest's version metadata + notes", () => {
    const summary = releaseSummary(realRelease());
    expect(summary?.moduleVersion).toBe("1.2.3");
    expect(summary?.protocolVersion).toBe(1);
    expect(summary?.releasedAt).toBe(T0);
    expect(summary?.releaseNotes).toBe("The productized agent.");
    expect(summary?.artifactCount).toBe(6);
    expect(summary?.platforms).toEqual(["windows", "macos", "linux"]);
    expect(releaseSummary(undefined)).toBeUndefined();
  });
});

describe("W100A structural seams (REAL agent + device-adapters values flow unchanged)", () => {
  test("the REAL agent release manifest satisfies the release seam (facets + plan over it)", () => {
    const release: ReleaseManifestLike = realRelease();
    let state = initialInstallCenterState(TENANT_A);
    state = selectInstallPlatform(state, "macos", "arm64");
    const plan = installPlan(release, state);
    expect(plan?.fileName).toContain("fleetos-agent-1.2.3-macos-arm64.sh");
    expect(plan?.checksum).toMatch(/^[0-9a-f]{16}$/);
    const facets = platformFacets(release, state);
    expect(facets.find((f) => f.platform === "macos")?.selected).toBe(true);
  });

  test("the REAL enrollment-request record satisfies the request seam (the code is display-only)", () => {
    const { record, code } = realRequest();
    const state = recordEnrollmentRequest(initialInstallCenterState(TENANT_A), record, code);
    const card = enrollmentCodeCard(state, T0, { expiringWithinMs: 3_600_000 });
    expect(card?.requestId).toBe(record.requestId);
    // The RECORD carries only the verifier — the code lives only in
    // the display projection.
    expect(JSON.stringify(record)).not.toContain(code);
    expect(card?.code).toBe(code);
  });
});

describe("W100A scope guard", () => {
  test("a matching scope passes; a tenant mismatch refuses", () => {
    const state = initialInstallCenterState(TENANT_A);
    expect(checkInstallCenterScope(SCOPE_A, state)).toEqual({ ok: true });
    expect(checkInstallCenterScope({ tenantId: TENANT_B }, state)).toEqual({
      ok: false,
      reason: "tenant_mismatch",
    });
    // The runtime guard refuses a malformed scope (typed as the shape
    // it must be; the runtime check stays defensive).
    expect(checkInstallCenterScope(null as unknown as DeviceUiTenantScope, state).ok).toBe(false);
  });
});
