/**
 * W071 tests — enrollment security + BYOD scoping
 * (@fleetos/device-adapters).
 *
 * Proves:
 *   - typed ownership classes (corporate/managed/byod) with the frozen
 *     class set + predicates;
 *   - the BYOD allow-set is the read-only/telemetry set and its
 *     complement (the forbidden set) partitions the FULL frozen
 *     capability list;
 *   - BYOD-scoped enrollments REFUSE management capabilities outside
 *     the allow-set with the machine-stable
 *     `byod_capability_not_permitted` (offending set sorted);
 *   - corporate/managed enrollments carry no capability restriction at
 *     this layer;
 *   - `enforceByodCapability` refuses management capabilities on BYOD
 *     scope at the runtime boundary;
 *   - the ownership policy RIDES the check-in validation: the EXISTING
 *     frozen `validateCheckInCommand` runs first (its ValidationError
 *     surfaces verbatim for an invalid check-in), then the policy;
 *   - replayed/duplicate enrollments are refused deterministically by
 *     ENROLLMENT DIGEST (`enrollment_replayed`); renewals (check-ins
 *     with a session token) are NOT enrollments and pass; ANY
 *     identity-field difference changes the digest;
 *   - tenant isolation: the ledger is partitioned per tenant; a
 *     foreign-tenant command is refused before any digest is computed;
 *   - every admission and refusal is audited through the INJECTED sink
 *     (machine-stable action names);
 *   - determinism: byte-identical refusals/digests/audit records
 *     across runs and input permutations.
 */

import { describe, expect, test } from "bun:test";
import { makeCommand } from "@fleetos/contracts";
import type { CommandEnvelope } from "@fleetos/contracts";
import {
  makeAdapterCapabilities,
  makeCommandId,
  makeCorrelationId,
  makeDeviceId,
  makeIdempotencyKey,
  makeTenantId,
} from "@fleetos/contracts/testing";
import { validateCheckInCommand, wrapCheckInCommand } from "../src/checkin";
import type { AgentIdentity, AgentVersionInfo, CheckInCommandPayload, SessionToken } from "../src/checkin";
import {
  ALL_DEVICE_OWNERSHIP_CLASSES,
  ALL_ENROLLMENT_SECURITY_REFUSAL_REASONS,
  BYOD_CAPABILITY_ALLOW_SET,
  BYOD_FORBIDDEN_CAPABILITIES,
  ENROLLMENT_AUDIT_ACTIONS,
  ENROLLMENT_SECURITY_ERROR_CODES,
  createInMemoryEnrollmentAuditSink,
  createInMemoryEnrollmentLedger,
  enrollmentDigest,
  enforceByodCapability,
  isByodPermittedCapability,
  isDeviceOwnershipClass,
  validateCheckInWithOwnership,
  validateEnrollmentOwnershipPolicy,
  type EnrollmentOwnershipValidation,
  type EnrollmentSecurityRefusal,
  type EnrollmentTenantScope,
} from "../src/enrollment-security";
import { ALL_ADAPTER_CAPABILITIES } from "@fleetos/contracts";

const TENANT_A = makeTenantId("w071-enr-tenant-a");
const TENANT_B = makeTenantId("w071-enr-tenant-b");
const DEVICE = makeDeviceId("w071-enr-device");
const CORRELATION = makeCorrelationId("w071-enr-corr");
const AT = "2026-01-01T00:00:00Z";
const AT_LATER = "2026-02-01T00:00:00Z";

const IDENTITY: AgentIdentity = {
  tenantId: TENANT_A,
  deviceId: DEVICE,
  adapterFamily: "windows",
};

const AGENT: AgentVersionInfo = {
  moduleName: "agent",
  moduleVersion: "0.1.0",
  protocolVersion: 1,
};

const SESSION: SessionToken = {
  value: "tok_w071_enrollment_session",
  issuedAt: AT,
  expiresAt: AT_LATER,
  issuer: "control-plane@fleetos-test",
};

function checkInCommand(
  overrides: {
    identity?: AgentIdentity;
    agent?: AgentVersionInfo;
    sessionToken?: SessionToken;
    tenantId?: ReturnType<typeof makeTenantId>;
  } = {},
): CommandEnvelope<CheckInCommandPayload> {
  const identity = overrides.identity ?? IDENTITY;
  return wrapCheckInCommand(
    {
      identity,
      agent: overrides.agent ?? AGENT,
      ...(overrides.sessionToken !== undefined ? { sessionToken: overrides.sessionToken } : {}),
    },
    {
      id: makeCommandId("w071-enr-cmd"),
      idempotencyKey: makeIdempotencyKey("w071-enr-key"),
      correlationId: CORRELATION,
      issuedAt: AT,
      tenantId: overrides.tenantId ?? identity.tenantId,
    },
  );
}

function scopeOf(tenantId: ReturnType<typeof makeTenantId>): EnrollmentTenantScope {
  return { tenantId, correlationId: CORRELATION };
}

/** Narrowing helper: the refusal of an ownership validation (throws on ok). */
function refusalOf(result: EnrollmentOwnershipValidation): EnrollmentSecurityRefusal {
  if (result.ok) throw new Error("expected a refusal");
  return result.refusal;
}

// ---------------------------------------------------------------------------
// Ownership classes + the BYOD allow-set
// ---------------------------------------------------------------------------

describe("W071: enrollment security — ownership classes + BYOD allow-set", () => {
  test("the ownership-class set is exactly the three frozen classes", () => {
    expect(ALL_DEVICE_OWNERSHIP_CLASSES).toEqual(["corporate", "managed", "byod"]);
    expect(isDeviceOwnershipClass("corporate")).toBe(true);
    expect(isDeviceOwnershipClass("managed")).toBe(true);
    expect(isDeviceOwnershipClass("byod")).toBe(true);
    expect(isDeviceOwnershipClass("personal")).toBe(false);
    expect(isDeviceOwnershipClass(42)).toBe(false);
    expect(isDeviceOwnershipClass(undefined)).toBe(false);
  });

  test("the BYOD allow-set is the read-only/telemetry set; the forbidden set partitions the full frozen capability list", () => {
    expect(BYOD_CAPABILITY_ALLOW_SET).toEqual(["identify", "observe", "diagnose", "health"]);
    expect(BYOD_FORBIDDEN_CAPABILITIES).toEqual([
      "enforce",
      "remediate",
      "lock",
      "locate",
      "wipe",
      "reboot",
      "update",
    ]);
    const allowSet = new Set<string>(BYOD_CAPABILITY_ALLOW_SET as readonly string[]);
    const forbidSet = new Set<string>(BYOD_FORBIDDEN_CAPABILITIES as readonly string[]);
    for (const capability of ALL_ADAPTER_CAPABILITIES) {
      expect(allowSet.has(capability) !== forbidSet.has(capability)).toBe(true); // exactly one
    }
    expect(allowSet.size + forbidSet.size).toBe(ALL_ADAPTER_CAPABILITIES.length);
  });

  test("isByodPermittedCapability answers membership machine-stably", () => {
    expect(isByodPermittedCapability("observe")).toBe(true);
    expect(isByodPermittedCapability("wipe")).toBe(false);
    expect(isByodPermittedCapability("lock")).toBe(false);
    expect(isByodPermittedCapability("locate")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ownership-policy validation (BYOD scoping)
// ---------------------------------------------------------------------------

describe("W071: enrollment security — ownership-policy validation", () => {
  test("a corporate enrollment carries the full declared set (no restriction at this layer)", () => {
    const capabilities = makeAdapterCapabilities({ supported: ["lock", "wipe", "observe"] });
    const result = validateEnrollmentOwnershipPolicy({ ownershipClass: "corporate", capabilities });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("corporate should validate");
    expect(result.policy.ownershipClass).toBe("corporate");
    expect(result.policy.permitted).toEqual(["lock", "observe", "wipe"]); // sorted
  });

  test("a managed enrollment carries the full declared set (no restriction at this layer)", () => {
    const capabilities = makeAdapterCapabilities({ supported: ["reboot", "update"] });
    const result = validateEnrollmentOwnershipPolicy({ ownershipClass: "managed", capabilities });
    expect(result.ok).toBe(true);
  });

  test("a BYOD enrollment within the allow-set validates", () => {
    const capabilities = makeAdapterCapabilities({ supported: ["identify", "observe", "health"] });
    const result = validateEnrollmentOwnershipPolicy({ ownershipClass: "byod", capabilities });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("byod within allow-set should validate");
    expect(result.policy.permitted).toEqual(["health", "identify", "observe"]);
  });

  test("a BYOD enrollment requesting a management capability is refused (byod_capability_not_permitted, sorted offending set)", () => {
    const capabilities = makeAdapterCapabilities({ supported: ["observe", "lock", "wipe", "health"] });
    const result = validateEnrollmentOwnershipPolicy({ ownershipClass: "byod", capabilities });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("byod with management capabilities must refuse");
    expect(result.refusal.reason).toBe("byod_capability_not_permitted");
    expect(result.refusal.capabilities).toEqual(["lock", "wipe"]); // sorted
  });

  test("EVERY forbidden capability is refused on BYOD scope (each one, machine-stable)", () => {
    for (const capability of BYOD_FORBIDDEN_CAPABILITIES) {
      const capabilities = makeAdapterCapabilities({ supported: [capability] });
      const result = validateEnrollmentOwnershipPolicy({ ownershipClass: "byod", capabilities });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`byod + ${capability} must refuse`);
      expect(result.refusal.reason).toBe("byod_capability_not_permitted");
      expect(result.refusal.capabilities).toEqual([capability]);
    }
  });

  test("an unknown ownership class is refused (unknown_ownership_class)", () => {
    const result = validateEnrollmentOwnershipPolicy({
      ownershipClass: "personal" as never,
      capabilities: makeAdapterCapabilities({ supported: ["observe"] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unknown class must refuse");
    expect(result.refusal.reason).toBe("unknown_ownership_class");
    expect(refusalOf(validateEnrollmentOwnershipPolicy(null)).reason).toBe("unknown_ownership_class");
    expect(refusalOf(validateEnrollmentOwnershipPolicy(undefined)).reason).toBe(
      "unknown_ownership_class",
    );
  });

  test("enforceByodCapability refuses management capabilities on BYOD scope at the runtime boundary", () => {
    expect(enforceByodCapability("byod", "observe").ok).toBe(true);
    expect(enforceByodCapability("byod", "health").ok).toBe(true);
    expect(enforceByodCapability("corporate", "wipe").ok).toBe(true);
    expect(enforceByodCapability("managed", "lock").ok).toBe(true);
    for (const capability of BYOD_FORBIDDEN_CAPABILITIES) {
      const refusal = enforceByodCapability("byod", capability);
      expect(refusal.ok).toBe(false);
      if (refusal.ok) throw new Error(`byod + ${capability} must refuse`);
      expect(refusal.reason).toBe("byod_capability_not_permitted");
      expect(refusal.capability).toBe(capability);
    }
  });
});

// ---------------------------------------------------------------------------
// The check-in composition (the policy rides the handshake)
// ---------------------------------------------------------------------------

describe("W071: enrollment security — the policy rides the check-in validation", () => {
  test("a valid check-in + a valid policy passes, carrying the validated policy", () => {
    const result = validateCheckInWithOwnership(checkInCommand(), {
      ownershipClass: "corporate",
      capabilities: makeAdapterCapabilities({ supported: ["observe", "lock"] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("should pass");
    expect(result.policy.permitted).toEqual(["lock", "observe"]);
  });

  test("the EXISTING check-in validation runs FIRST: an invalid check-in surfaces its ValidationError verbatim", () => {
    // A check-in whose identity tenant disagrees with the envelope: the
    // frozen W010 validator refuses before the policy is even consulted.
    const command = makeCommand<CheckInCommandPayload>({
      id: makeCommandId("w071-enr-bad"),
      idempotencyKey: makeIdempotencyKey("w071-enr-bad-key"),
      issuedAt: AT,
      tenantId: TENANT_B,
      correlationId: CORRELATION,
      type: "agent.command.check-in",
      payload: { identity: IDENTITY, agent: AGENT },
    });
    const existing = validateCheckInCommand(command);
    expect(existing.ok).toBe(false);
    const result = validateCheckInWithOwnership(command, {
      ownershipClass: "corporate",
      capabilities: makeAdapterCapabilities({ supported: ["observe"] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should refuse");
    expect(result.error.code).toBe("agent.checkin.invalid_request");
    expect(result.error.failures.some((f) => f.reason === "tenant_mismatch")).toBe(true);
  });

  test("a BYOD policy riding a check-in with a management capability refuses with the policy error code", () => {
    const result = validateCheckInWithOwnership(checkInCommand(), {
      ownershipClass: "byod",
      capabilities: makeAdapterCapabilities({ supported: ["observe", "wipe"] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should refuse");
    expect(result.error.code).toBe(ENROLLMENT_SECURITY_ERROR_CODES.ownershipRefused);
    expect(result.error.failures).toEqual([{ path: "/policy", reason: "byod_capability_not_permitted" }]);
  });
});

// ---------------------------------------------------------------------------
// The enrollment digest + replay refusal
// ---------------------------------------------------------------------------

describe("W071: enrollment security — the enrollment digest (deterministic replay identity)", () => {
  test("structurally equal check-ins produce the same digest byte-identically", () => {
    expect(enrollmentDigest(checkInCommand())).toBe(enrollmentDigest(checkInCommand()));
    expect(enrollmentDigest(checkInCommand())).toMatch(/^enr_[0-9a-f]{8}$/);
  });

  test("ANY identity-field difference changes the digest", () => {
    const base = enrollmentDigest(checkInCommand());
    expect(enrollmentDigest(checkInCommand({ identity: { ...IDENTITY, deviceId: makeDeviceId("w071-enr-other") } }))).not.toBe(base);
    expect(enrollmentDigest(checkInCommand({ identity: { ...IDENTITY, adapterFamily: "linux" } }))).not.toBe(base);
    expect(enrollmentDigest(checkInCommand({ identity: { ...IDENTITY, tenantId: TENANT_B } }))).not.toBe(base);
    expect(
      enrollmentDigest(checkInCommand({ agent: { ...AGENT, protocolVersion: 2 } })),
    ).not.toBe(base);
    expect(
      enrollmentDigest(checkInCommand({ agent: { ...AGENT, moduleVersion: "0.2.0" } })),
    ).not.toBe(base);
  });
});

describe("W071: enrollment security — replay refusal by digest", () => {
  test("a first enrollment is admitted (digest recorded, audited)", () => {
    const ledger = createInMemoryEnrollmentLedger();
    const sink = createInMemoryEnrollmentAuditSink();
    const result = ledger.admit(scopeOf(TENANT_A), checkInCommand(), AT, { auditSink: sink });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("first enrollment admits");
    expect(result.record.deviceId).toBe(DEVICE);
    expect(result.record.adapterFamily).toBe("windows");
    expect(result.record.recordedAt).toBe(AT);
    expect(ledger.size(scopeOf(TENANT_A))).toBe(1);
    expect(sink.records.length).toBe(1);
    expect(sink.records[0].action).toBe(ENROLLMENT_AUDIT_ACTIONS.admitted);
    expect(sink.records[0].details.renewal).toBe(false);
  });

  test("a REPLAYED enrollment is refused machine-stably (enrollment_replayed, same digest, firstSeenAt)", () => {
    const ledger = createInMemoryEnrollmentLedger();
    const sink = createInMemoryEnrollmentAuditSink();
    const command = checkInCommand();
    const first = ledger.admit(scopeOf(TENANT_A), command, AT, { auditSink: sink });
    expect(first.ok).toBe(true);
    const replay = ledger.admit(scopeOf(TENANT_A), command, AT_LATER, { auditSink: sink });
    expect(replay.ok).toBe(false);
    if (replay.ok) throw new Error("replay must refuse");
    expect(replay.refusal.reason).toBe("enrollment_replayed");
    expect(replay.refusal.digest).toBe(enrollmentDigest(command));
    expect(replay.refusal.firstSeenAt).toBe(AT);
    expect(ledger.size(scopeOf(TENANT_A))).toBe(1); // nothing re-recorded
    expect(sink.records.length).toBe(2);
    expect(sink.records[1].action).toBe(ENROLLMENT_AUDIT_ACTIONS.replayRefused);
    expect(sink.records[1].details.digest).toBe(enrollmentDigest(command));
  });

  test("a structurally equal re-presentation (new command id, same identity) is STILL a replay (digest identity)", () => {
    const ledger = createInMemoryEnrollmentLedger();
    expect(ledger.admit(scopeOf(TENANT_A), checkInCommand(), AT).ok).toBe(true);
    // Different envelope ids — the enrollment DIGEST (the identity) is
    // what replays, not the envelope.
    const replay = ledger.admit(scopeOf(TENANT_A), checkInCommand(), AT_LATER);
    expect(replay.ok).toBe(false);
    if (replay.ok) throw new Error("identity replay must refuse");
    expect(replay.refusal.reason).toBe("enrollment_replayed");
  });

  test("a DIFFERENT device enrolls fine (different digest, no replay)", () => {
    const ledger = createInMemoryEnrollmentLedger();
    expect(ledger.admit(scopeOf(TENANT_A), checkInCommand(), AT).ok).toBe(true);
    const other = ledger.admit(
      scopeOf(TENANT_A),
      checkInCommand({ identity: { ...IDENTITY, deviceId: makeDeviceId("w071-enr-device2") } }),
      AT_LATER,
    );
    expect(other.ok).toBe(true);
    expect(ledger.size(scopeOf(TENANT_A))).toBe(2);
  });

  test("a RENEWAL (session token present) is NOT an enrollment: admitted without recording a digest", () => {
    const ledger = createInMemoryEnrollmentLedger();
    const sink = createInMemoryEnrollmentAuditSink();
    expect(ledger.admit(scopeOf(TENANT_A), checkInCommand(), AT, { auditSink: sink }).ok).toBe(true);
    const renewal = ledger.admit(scopeOf(TENANT_A), checkInCommand({ sessionToken: SESSION }), AT_LATER, {
      auditSink: sink,
    });
    expect(renewal.ok).toBe(true);
    expect(ledger.size(scopeOf(TENANT_A))).toBe(1); // the renewal recorded nothing
    expect(sink.records.length).toBe(2);
    expect(sink.records[1].action).toBe(ENROLLMENT_AUDIT_ACTIONS.admitted);
    expect(sink.records[1].details.renewal).toBe(true);
  });

  test("tenant isolation: a foreign-tenant command is refused BEFORE any digest is computed (enrollment_tenant_mismatch)", () => {
    const ledger = createInMemoryEnrollmentLedger();
    const sink = createInMemoryEnrollmentAuditSink();
    const result = ledger.admit(scopeOf(TENANT_B), checkInCommand(), AT, { auditSink: sink });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("foreign-tenant command must refuse");
    expect(result.refusal.reason).toBe("enrollment_tenant_mismatch");
    expect(ledger.size(scopeOf(TENANT_B))).toBe(0);
    expect(ledger.size(scopeOf(TENANT_A))).toBe(0);
    expect(sink.records[0].action).toBe(ENROLLMENT_AUDIT_ACTIONS.replayRefused);
  });

  test("tenant isolation: tenant B's ledger never sees tenant A's digests", () => {
    const ledger = createInMemoryEnrollmentLedger();
    const command = checkInCommand();
    expect(ledger.admit(scopeOf(TENANT_A), command, AT).ok).toBe(true);
    expect(ledger.hasDigest(scopeOf(TENANT_B), enrollmentDigest(command))).toBe(false);
    expect(ledger.hasDigest(scopeOf(TENANT_A), enrollmentDigest(command))).toBe(true);
    expect(ledger.lookup(scopeOf(TENANT_B), enrollmentDigest(command))).toBeUndefined();
    expect(ledger.listDigests(scopeOf(TENANT_B))).toEqual([]);
  });

  test("a malformed injected instant refuses before any mutation (invalid_request, fail-safe)", () => {
    const ledger = createInMemoryEnrollmentLedger();
    const result = ledger.admit(scopeOf(TENANT_A), checkInCommand(), "not-an-iso-instant");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("malformed instant must refuse");
    expect(result.refusal.reason).toBe("invalid_request");
    expect(ledger.size(scopeOf(TENANT_A))).toBe(0);
  });

  test("the refusal taxonomy is the frozen five-reason set", () => {
    expect(ALL_ENROLLMENT_SECURITY_REFUSAL_REASONS).toEqual([
      "unknown_ownership_class",
      "byod_capability_not_permitted",
      "enrollment_replayed",
      "enrollment_tenant_mismatch",
      "invalid_request",
    ]);
    expect(Object.keys(ENROLLMENT_SECURITY_ERROR_CODES).sort()).toEqual([
      "byodCapabilityNotPermitted",
      "enrollmentReplayed",
      "ownershipRefused",
      "tenantMismatch",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("W071: enrollment security — determinism", () => {
  test("byte-identical refusals, digests, and audit records across runs and claim permutations", () => {
    function run(claimOrder: "forward" | "reverse"): string {
      const ledger = createInMemoryEnrollmentLedger();
      const sink = createInMemoryEnrollmentAuditSink();
      const capabilities = makeAdapterCapabilities({
        supported: claimOrder === "forward" ? ["observe", "wipe", "lock"] : ["lock", "wipe", "observe"],
      });
      const validation = validateEnrollmentOwnershipPolicy({ ownershipClass: "byod", capabilities });
      const admitted = ledger.admit(scopeOf(TENANT_A), checkInCommand(), AT, { auditSink: sink });
      return JSON.stringify({
        refusal: validation.ok ? null : validation.refusal,
        digest: admitted.ok ? admitted.record.digest : null,
        audit: sink.records,
      });
    }
    expect(run("forward")).toBe(run("reverse"));
    expect(run("forward")).toBe(run("forward"));
  });
});
