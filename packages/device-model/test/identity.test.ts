/**
 * W011 D1 tests — device identity, ownership, and the lifecycle state
 * machine (pure transition function with illegal-transition rejection).
 *
 * The lifecycle transition table is tested EXHAUSTIVELY: every one of the
 * 9 x 9 = 81 (from, to) pairs is checked against the frozen contracts
 * table (`DEVICE_LIFECYCLE_TRANSITIONS` / `canTransitionDevice`).
 */

import { test, expect } from "bun:test";
import {
  DEVICE_LIFECYCLE_ORDER,
  DEVICE_LIFECYCLE_TRANSITIONS,
  ENROLL,
  canTransitionDevice,
} from "@fleetos/contracts";
import {
  makeCorrelationId,
  makeDeviceId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { asUserId } from "@fleetos/contracts";
import {
  OWNERSHIP_TYPE_CUSTOMER_OWNED,
  OWNERSHIP_TYPE_FLEET_PURCHASED,
  OWNERSHIP_TYPE_LEASED,
  OWNERSHIP_TYPE_THIRD_PARTY_SUPPLIED,
  SYSTEM_ACTOR,
  assignDeviceOwnership,
  enrollDevice,
  isOwnershipType,
  reenterObservationCycle,
  transitionDeviceLifecycle,
} from "../src/identity";

const tenantId = makeTenantId("identity-tests");
const deviceId = makeDeviceId("identity-tests-device");
const correlationId = makeCorrelationId("identity-tests-cor");

/** Deep failure-check helper (toContain is reference-equality on objects). */
function hasFailure(
  failures: readonly { path: string; reason: string }[],
  path: string,
  reason: string,
): boolean {
  return failures.some((f) => f.path === path && f.reason === reason);
}

function makeEnrollInput(overrides?: Record<string, unknown>) {
  return {
    tenantId,
    deviceId,
    adapterFamily: "windows",
    hardware: { manufacturer: "Lenovo", model: "ThinkPad X1", serialNumber: "SN-42" },
    ownership: { ownerType: OWNERSHIP_TYPE_CUSTOMER_OWNED },
    at: makeTimestamp("enroll-at"),
    provenance: { correlationId },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle state machine — exhaustive 9 x 9 transition table
// ---------------------------------------------------------------------------

test("lifecycle: exhaustive table — transitionDeviceLifecycle matches the frozen contracts table for all 81 pairs", () => {
  let legal = 0;
  for (const from of DEVICE_LIFECYCLE_ORDER) {
    for (const to of DEVICE_LIFECYCLE_ORDER) {
      const expected = canTransitionDevice(from, to);
      const result = transitionDeviceLifecycle(from, to, { tenantId, correlationId });
      if (expected) {
        legal++;
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.from).toBe(from);
          expect(result.to).toBe(to);
        }
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("DomainError");
          expect(result.error.code).toBe("device.lifecycle.illegal_transition");
          expect(result.error.domain).toBe("device.lifecycle");
          expect(result.error.invariant).toBe(`transition:${from}->${to}`);
          expect(result.error.tenantId).toBe(tenantId);
          expect(result.error.correlationId).toBe(correlationId);
        }
      }
    }
  }
  // Exactly the 8 linear-progression edges are legal.
  expect(legal).toBe(8);
});

test("lifecycle: the frozen table is a strict linear progression with LEARN terminal", () => {
  for (let i = 0; i < DEVICE_LIFECYCLE_ORDER.length - 1; i++) {
    const from = DEVICE_LIFECYCLE_ORDER[i];
    const next = DEVICE_LIFECYCLE_ORDER[i + 1];
    expect(DEVICE_LIFECYCLE_TRANSITIONS[from]).toEqual([next]);
  }
  expect(DEVICE_LIFECYCLE_TRANSITIONS["LEARN"]).toEqual([]);
});

test("lifecycle: named legal transitions accept", () => {
  expect(transitionDeviceLifecycle("ENROLL", "OBSERVE", { tenantId, correlationId }).ok).toBe(true);
  expect(transitionDeviceLifecycle("VERIFY", "LEARN", { tenantId, correlationId }).ok).toBe(true);
});

test("lifecycle: skipping a state is rejected as an illegal transition", () => {
  const result = transitionDeviceLifecycle("ENROLL", "AUTHORIZE", { tenantId, correlationId });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("DomainError");
    expect(result.error.invariant).toBe("transition:ENROLL->AUTHORIZE");
    expect(result.error.message).toContain("ENROLL -> AUTHORIZE");
  }
});

test("lifecycle: backward transitions are rejected", () => {
  expect(transitionDeviceLifecycle("OBSERVE", "ENROLL", { tenantId, correlationId }).ok).toBe(false);
  expect(transitionDeviceLifecycle("LEARN", "VERIFY", { tenantId, correlationId }).ok).toBe(false);
  expect(transitionDeviceLifecycle("EXECUTE", "PLAN", { tenantId, correlationId }).ok).toBe(false);
});

test("lifecycle: LEARN has no outgoing table transitions (terminal), including LEARN -> LEARN", () => {
  for (const to of DEVICE_LIFECYCLE_ORDER) {
    expect(transitionDeviceLifecycle("LEARN", to, { tenantId, correlationId }).ok).toBe(false);
  }
});

test("lifecycle: the observation-cycle re-entry closes the loop WITHOUT a table transition", () => {
  // Per the frozen contracts documentation: a device that has LEARNED
  // re-enters OBSERVE on the next observation cycle (via ingestion, not
  // via the table). The state-level function encodes exactly that.
  expect(reenterObservationCycle("LEARN")).toBe("OBSERVE");
  // Every non-LEARN state is the identity function.
  for (const state of DEVICE_LIFECYCLE_ORDER) {
    if (state !== "LEARN") {
      expect(reenterObservationCycle(state)).toBe(state);
    }
  }
});

// ---------------------------------------------------------------------------
// Ownership types
// ---------------------------------------------------------------------------

test("ownership: the four spec ownership types are recognized", () => {
  expect(OWNERSHIP_TYPE_CUSTOMER_OWNED).toBe("CUSTOMER_OWNED");
  expect(OWNERSHIP_TYPE_LEASED).toBe("LEASED");
  expect(OWNERSHIP_TYPE_FLEET_PURCHASED).toBe("FLEET_PURCHASED");
  expect(OWNERSHIP_TYPE_THIRD_PARTY_SUPPLIED).toBe("THIRD_PARTY_SUPPLIED");
  expect(isOwnershipType("CUSTOMER_OWNED")).toBe(true);
  expect(isOwnershipType("LEASED")).toBe(true);
  expect(isOwnershipType("FLEET_PURCHASED")).toBe(true);
  expect(isOwnershipType("THIRD_PARTY_SUPPLIED")).toBe(true);
});

test("ownership: unknown types are rejected by the type guard", () => {
  expect(isOwnershipType("STOLEN")).toBe(false);
  expect(isOwnershipType("")).toBe(false);
  expect(isOwnershipType("customer_owned")).toBe(false);
});

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

test("enrollDevice: happy path produces a tenant-scoped identity in ENROLL with full provenance", () => {
  const userId = asUserId("usr_owner_user");
  const result = enrollDevice(
    makeEnrollInput({
      ownership: {
        ownerType: OWNERSHIP_TYPE_FLEET_PURCHASED,
        assignedUserId: userId,
        assignedTeam: "field-ops",
      },
      provenance: { correlationId, reason: "initial enrollment" },
    }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const identity = result.identity;
  expect(identity.tenantId).toBe(tenantId);
  expect(identity.deviceId).toBe(deviceId);
  expect(identity.lifecycleState).toBe(ENROLL);
  expect(identity.enrolledAt).toBe(makeTimestamp("enroll-at"));
  expect(identity.enrollment.tenantId).toBe(tenantId);
  expect(identity.enrollment.deviceId).toBe(deviceId);
  expect(identity.enrollment.adapterFamily).toBe("windows");
  expect(identity.enrollment.hardware.manufacturer).toBe("Lenovo");
  expect(identity.enrollment.hardware.serialNumber).toBe("SN-42");
  expect(identity.ownership.ownerType).toBe("FLEET_PURCHASED");
  expect(identity.ownership.assignedUserId).toBe(userId);
  expect(identity.ownership.assignedTeam).toBe("field-ops");
  expect(identity.ownership.assignedAt).toBe(identity.enrolledAt);
  // Provenance is materialized explicitly (default actor = system).
  expect(identity.enrollment.provenance.correlationId).toBe(correlationId);
  expect(identity.enrollment.provenance.actor).toEqual(SYSTEM_ACTOR);
  expect(identity.ownership.provenance.actor).toEqual(SYSTEM_ACTOR);
});

test("enrollDevice: deterministic — the same input produces the same identity", () => {
  const a = enrollDevice(makeEnrollInput());
  const b = enrollDevice(makeEnrollInput());
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("enrollDevice: user actor provenance is preserved", () => {
  const userId = asUserId("usr_enrolling_admin");
  const result = enrollDevice(
    makeEnrollInput({ provenance: { correlationId, actor: { kind: "user", userId } } }),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.identity.enrollment.provenance.actor).toEqual({ kind: "user", userId });
  }
});

test("enrollDevice: malformed tenant ids are rejected with the contracts grammar reasons", () => {
  for (const [tenant, reason] of [
    ["", "empty"],
    ["tnt_ab", "too_short"],
    ["tenant_invalid", "bad_format"],
    ["tnt_" + "a".repeat(65), "too_long"],
  ] as const) {
    const result = enrollDevice(makeEnrollInput({ tenantId: tenant as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("ValidationError");
      expect(result.error.code).toBe("device.identity.invalid");
      expect(hasFailure(result.error.failures, "/tenantId", reason)).toBe(true);
    }
  }
});

test("enrollDevice: missing deviceId / adapterFamily / hardware are rejected", () => {
  expect(enrollDevice(makeEnrollInput({ deviceId: "" as never })).ok).toBe(false);
  expect(enrollDevice(makeEnrollInput({ adapterFamily: "" })).ok).toBe(false);
  expect(enrollDevice(makeEnrollInput({ hardware: { manufacturer: "", model: "X" } })).ok).toBe(false);
  expect(enrollDevice(makeEnrollInput({ hardware: { manufacturer: "Acme", model: "" } })).ok).toBe(false);
});

test("enrollDevice: non-ISO at timestamp and empty correlation id are rejected", () => {
  const badAt = enrollDevice(makeEnrollInput({ at: "not-a-timestamp" }));
  expect(badAt.ok).toBe(false);
  if (!badAt.ok) {
    expect(hasFailure(badAt.error.failures, "/at", "not_iso")).toBe(true);
  }
  const badCorrelation = enrollDevice(
    makeEnrollInput({ provenance: { correlationId: "" as never } }),
  );
  expect(badCorrelation.ok).toBe(false);
  if (!badCorrelation.ok) {
    expect(hasFailure(badCorrelation.error.failures, "/provenance/correlationId", "required")).toBe(true);
  }
});

test("enrollDevice: unknown ownership type is rejected", () => {
  const result = enrollDevice(makeEnrollInput({ ownership: { ownerType: "STOLEN" as never } }));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(hasFailure(result.error.failures, "/ownership/ownerType", "unknown_ownership_type")).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Ownership reassignment
// ---------------------------------------------------------------------------

test("assignDeviceOwnership: pure reassignment with new provenance and timestamp", () => {
  const enrolled = enrollDevice(makeEnrollInput());
  expect(enrolled.ok).toBe(true);
  if (!enrolled.ok) return;

  const at = makeTimestamp("reassign-at");
  const newOwner = asUserId("usr_new_owner");
  const result = assignDeviceOwnership(
    enrolled.identity,
    { ownerType: OWNERSHIP_TYPE_LEASED, assignedUserId: newOwner },
    { at, correlationId, reason: "lease started" },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  // New record has the new ownership...
  expect(result.identity.ownership.ownerType).toBe(OWNERSHIP_TYPE_LEASED);
  expect(result.identity.ownership.assignedUserId).toBe(newOwner);
  expect(result.identity.ownership.assignedAt).toBe(at);
  expect(result.identity.ownership.provenance.reason).toBe("lease started");
  // ...while the ORIGINAL identity is untouched (purity).
  expect(enrolled.identity.ownership.ownerType).toBe(OWNERSHIP_TYPE_CUSTOMER_OWNED);
  expect(enrolled.identity.ownership.assignedAt).toBe(enrolled.identity.enrolledAt);
  // Everything else carries over.
  expect(result.identity.deviceId).toBe(enrolled.identity.deviceId);
  expect(result.identity.lifecycleState).toBe(enrolled.identity.lifecycleState);
  expect(result.identity.enrollment).toEqual(enrolled.identity.enrollment);
});

test("assignDeviceOwnership: invalid ownerType / context are rejected", () => {
  const enrolled = enrollDevice(makeEnrollInput());
  expect(enrolled.ok).toBe(true);
  if (!enrolled.ok) return;
  const bad = assignDeviceOwnership(
    enrolled.identity,
    { ownerType: "STOLEN" as never },
    { at: makeTimestamp("x"), correlationId },
  );
  expect(bad.ok).toBe(false);
  if (!bad.ok) {
    expect(bad.error.kind).toBe("ValidationError");
    expect(hasFailure(bad.error.failures, "/assignment/ownerType", "unknown_ownership_type")).toBe(true);
  }
  const badCtx = assignDeviceOwnership(
    enrolled.identity,
    { ownerType: OWNERSHIP_TYPE_THIRD_PARTY_SUPPLIED },
    { at: "nope", correlationId },
  );
  expect(badCtx.ok).toBe(false);
  if (!badCtx.ok) {
    expect(hasFailure(badCtx.error.failures, "/ctx/at", "not_iso")).toBe(true);
  }
});
