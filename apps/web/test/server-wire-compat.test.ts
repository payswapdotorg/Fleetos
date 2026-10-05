/**
 * W140 — the STRUCTURAL-COMPATIBILITY proofs: the server plane's
 * mirrored vocabulary vs the FROZEN device-adapters/agent constants
 * (this test file MAY import the adapter lane — test files are outside
 * the src/ ownership scan; every equality below pins the server plane
 * to the frozen contracts, so drift fails the gate).
 */

import { describe, expect, test } from "bun:test";
import {
  bootstrapCodeVerifier,
  createEnrollmentRequest,
  ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS,
  ENROLLMENT_REQUEST_AUDIT_ACTIONS,
  ALL_DEVICE_OWNERSHIP_KINDS,
  CHECKIN_COMMAND_TYPE as FROZEN_CHECKIN_COMMAND_TYPE,
  CHECKIN_EVENT_TYPES,
  type EnrollmentRequestRecord,
} from "@fleetos/device-adapters";
import {
  SERVER_OWNERSHIP_KINDS,
  SERVER_ENROLLMENT_REFUSAL_EXPLANATIONS,
  enrollmentCodeVerifier,
  DEMO_TENANT_ID,
} from "../src/server/server-enrollment";
import { SERVER_ENROLLMENT_AUDIT_ACTIONS } from "../src/server/server-audit";
import {
  CHECKIN_COMMAND_TYPE,
  CHECKIN_ACK_EVENT_TYPE as SERVER_ACK_TYPE,
} from "../src/server/server-checkin";
import { createServerPasswordHasher } from "../src/server/server-password-hasher";
import { createBrowserPasswordHasher } from "../src/runtime/product-session";
import { TENANT_ID as DEMO_FLEET_TENANT } from "../src/runtime/demo-fleet";

describe("W140 wire compatibility (the frozen constants)", () => {
  test("the enrollment-code verifier formula equals the frozen bootstrapCodeVerifier", () => {
    for (const code of ["enrollwABCDEFGHIJKLMNOPQRSTUVWXYZ1", "enrollwMFRGGZDFMYZSCPKMIYY", "enrollwAAAAAAAAAAAAAAAAAA1"]) {
      for (const tenant of ["tnt_w140aaaa0001", "tnt_w140bbbb0002"]) {
        expect(enrollmentCodeVerifier(tenant, code)).toBe(bootstrapCodeVerifier(tenant as never, code));
      }
    }
  });

  test("the refusal explanations are the frozen human words (verbatim)", () => {
    for (const [reason, explanation] of Object.entries(ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS)) {
      expect(SERVER_ENROLLMENT_REFUSAL_EXPLANATIONS[reason]).toBe(explanation);
    }
  });

  test("the ownership-kind vocabulary is the frozen four", () => {
    expect([...SERVER_OWNERSHIP_KINDS]).toEqual([...ALL_DEVICE_OWNERSHIP_KINDS]);
  });

  test("the audit action names are the frozen enrollment vocabulary", () => {
    expect(SERVER_ENROLLMENT_AUDIT_ACTIONS.created).toBe(ENROLLMENT_REQUEST_AUDIT_ACTIONS.created);
    expect(SERVER_ENROLLMENT_AUDIT_ACTIONS.fulfilled).toBe(ENROLLMENT_REQUEST_AUDIT_ACTIONS.fulfilled);
    expect(SERVER_ENROLLMENT_AUDIT_ACTIONS.refused).toBe(ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused);
    expect(SERVER_ENROLLMENT_AUDIT_ACTIONS.revoked).toBe(ENROLLMENT_REQUEST_AUDIT_ACTIONS.revoked);
    expect(SERVER_ENROLLMENT_AUDIT_ACTIONS.expired).toBe(ENROLLMENT_REQUEST_AUDIT_ACTIONS.expired);
  });

  test("the check-in command + ack event types are the frozen ones", () => {
    expect(CHECKIN_COMMAND_TYPE).toBe(FROZEN_CHECKIN_COMMAND_TYPE);
    expect(SERVER_ACK_TYPE).toBe("agent.session.established");
    expect(SERVER_ACK_TYPE).toBe(CHECKIN_EVENT_TYPES[0]);
  });

  test("the demo-tenant exclusion equals the demo composition's frozen tenant id", () => {
    expect(DEMO_TENANT_ID).toBe(DEMO_FLEET_TENANT);
  });

  test("the REAL enrollment-request record satisfies the server's persisted view (every field present)", () => {
    const created = createEnrollmentRequest({
      tenantId: "tnt_w140aaaa0001" as never,
      requestId: "enr_w140compat001",
      code: "enrollwMFRGGZDFMYZSCPKMIYY",
      ownershipKind: "byod",
      allowedRoles: ["service.desk"],
      ttlMs: 60 * 60 * 1000,
      now: "2026-10-02T12:00:00Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const record: EnrollmentRequestRecord = created.record;
    // Every field the server persists exists on the REAL record.
    expect(record.requestId).toBe("enr_w140compat001");
    expect(record.ownershipKind).toBe("byod");
    expect(record.ownershipClass).toBe("byod");
    expect(record.allowedRoles).toEqual(["service.desk"]);
    expect(record.status).toBe("pending");
    expect(record.codeVerifier).toBe(bootstrapCodeVerifier("tnt_w140aaaa0001" as never, "enrollwMFRGGZDFMYZSCPKMIYY"));
    expect(Date.parse(record.expiresAt)).toBe(Date.parse("2026-10-02T13:00:00Z"));
  });

  test("the server password hasher at the browser round count derives byte-identical verifiers (cross-tier compatible)", () => {
    const server = createServerPasswordHasher(1000);
    const browser = createBrowserPasswordHasher();
    for (const [plain, salt] of [["correct-horse-battery", "slt_w140aaaa0001"], ["another-pass-123", "slt_w140bbbb0002"]]) {
      expect(server.hash(plain, salt)).toBe(browser.hash(plain, salt));
      expect(server.verify(plain, salt, browser.hash(plain, salt))).toBe(true);
    }
  });
});
