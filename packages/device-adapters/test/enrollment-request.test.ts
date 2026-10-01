/**
 * W100A tests — the enrollment-request flow (one-time bootstrap code).
 *
 * Proves:
 *   - the four ownership kinds are total, distinct, and MAP onto the
 *     frozen W071 classes deterministically (corporate-owned/leased ->
 *     corporate; BYOD -> byod; third-party managed -> managed);
 *   - `createEnrollmentRequest` stores ONLY the code verifier — the
 *     code never appears on the record; the code is echoed exactly
 *     once for display; malformed inputs are refused machine-stably;
 *   - redemption is ONE-TIME: first success issues a device-scoped
 *     trust record (the frozen SessionToken shape); a second
 *     redemption is refused `code_already_used`;
 *   - short-lived: redemption past expiresAt refuses `code_expired`
 *     and lazily records + audits the expired transition;
 *   - revocable: a revoked request refuses `code_revoked` (terminal);
 *   - tenant isolation: a foreign tenant's request is INVISIBLE (read
 *     AND redemption both refuse/return nothing; no existence side
 *     channel — an unknown request and a wrong code are
 *     indistinguishable);
 *   - scope binding: a role-restricted request refuses an unpermitted
 *     presenter (`tenant_role_mismatch`), fail-closed when no role is
 *     presented;
 *   - policy inputs: `device_already_enrolled` and
 *     `enrollment_refused_by_policy` ride the presentation (the
 *     boundary decides; the store enforces);
 *   - every fulfillment, refusal, revocation, expiry emits through the
 *     INJECTED audit sink with machine-stable action names — the code
 *     NEVER appears in any audit record;
 *   - the derived status (`enrollmentRequestStatusAt`) and listing are
 *     deterministic; the issued trust record is deterministic for the
 *     same inputs.
 */

import { describe, expect, test } from "bun:test";
import {
  makeCorrelationId,
  makeDeviceId,
  makeTenantId,
} from "@fleetos/contracts/testing";
import {
  ALL_DEVICE_OWNERSHIP_KINDS,
  DEVICE_OWNERSHIP_KIND_LABELS,
  ENROLLMENT_REQUEST_AUDIT_ACTIONS,
  ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS,
  ENROLLMENT_REQUEST_REFUSAL_REASONS,
  ALL_ENROLLMENT_REQUEST_REFUSAL_REASONS,
  bootstrapCodeVerifier,
  createEnrollmentRequest,
  createInMemoryEnrollmentRequestStore,
  enrollmentRequestStatusAt,
  isDeviceOwnershipKind,
  ownershipClassOfKind,
  type EnrollmentRequestRecord,
  type EnrollmentRequestScope,
} from "../src/enrollment-request";
import {
  ALL_DEVICE_OWNERSHIP_CLASSES,
  createInMemoryEnrollmentAuditSink,
  isDeviceOwnershipClass,
} from "../src/enrollment-security";

const TENANT_A = makeTenantId("w100a-enr-tenant-a");
const TENANT_B = makeTenantId("w100a-enr-tenant-b");
const DEVICE = makeDeviceId("w100a-enr-device-1");
const DEVICE_2 = makeDeviceId("w100a-enr-device-2");
const CORRELATION = makeCorrelationId("w100a-enr-corr");

const CREATED_AT = "2026-01-01T00:00:00Z";
const WITHIN_TTL = "2026-01-01T00:05:00Z";
const PAST_TTL = "2026-01-02T00:00:01Z";
const TTL_MS = 24 * 3_600_000; // 24h

const CODE = "BOOT-2026-ALPHA-01";
const REQUEST_ID = "enr_request-0001";

const SCOPE_A: EnrollmentRequestScope = { tenantId: TENANT_A, correlationId: CORRELATION };
const SCOPE_B: EnrollmentRequestScope = { tenantId: TENANT_B };

function makeRequest(options?: {
  readonly code?: string;
  readonly ownershipKind?: "corporate_owned" | "leased" | "byod" | "third_party_managed";
  readonly allowedRoles?: readonly string[];
  readonly requestId?: string;
}): { readonly record: EnrollmentRequestRecord; readonly code: string } {
  const created = createEnrollmentRequest({
    tenantId: TENANT_A,
    requestId: options?.requestId ?? REQUEST_ID,
    code: options?.code ?? CODE,
    ownershipKind: options?.ownershipKind ?? "corporate_owned",
    allowedRoles: options?.allowedRoles,
    ttlMs: TTL_MS,
    now: CREATED_AT,
    correlationId: CORRELATION,
  });
  if (!created.ok) throw new Error(`create failed: ${created.error.path}/${created.error.reason}`);
  return { record: created.record, code: created.code };
}

describe("W100A ownership kinds (the install contract's four distinctions)", () => {
  test("the four kinds are exactly the install contract's list, in canonical order", () => {
    expect([...ALL_DEVICE_OWNERSHIP_KINDS]).toEqual([
      "corporate_owned",
      "leased",
      "byod",
      "third_party_managed",
    ]);
  });

  test("each kind has a human label (rendered verbatim by the UI)", () => {
    for (const kind of ALL_DEVICE_OWNERSHIP_KINDS) {
      expect(typeof DEVICE_OWNERSHIP_KIND_LABELS[kind]).toBe("string");
      expect(DEVICE_OWNERSHIP_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  test("the predicate accepts exactly the four kinds", () => {
    for (const kind of ALL_DEVICE_OWNERSHIP_KINDS) expect(isDeviceOwnershipKind(kind)).toBe(true);
    for (const bad of ["", "corporate", "managed", "unknown", null, 1]) {
      expect(isDeviceOwnershipKind(bad)).toBe(false);
    }
  });

  test("the kind -> W071 class mapping is total and deterministic", () => {
    expect(ownershipClassOfKind("corporate_owned")).toBe("corporate");
    expect(ownershipClassOfKind("leased")).toBe("corporate");
    expect(ownershipClassOfKind("byod")).toBe("byod");
    expect(ownershipClassOfKind("third_party_managed")).toBe("managed");
  });

  test("every mapped class is a frozen W071 class (no new domain classes)", () => {
    const mapped = ALL_DEVICE_OWNERSHIP_KINDS.map(ownershipClassOfKind);
    for (const cls of mapped) expect(isDeviceOwnershipClass(cls)).toBe(true);
    expect(ALL_DEVICE_OWNERSHIP_CLASSES.length).toBe(3);
  });
});

describe("W100A createEnrollmentRequest (verifier-only storage)", () => {
  test("the record stores ONLY the verifier — the code never appears on the record", () => {
    const { record, code } = makeRequest();
    expect(record.codeVerifier).toBe(bootstrapCodeVerifier(TENANT_A, code));
    expect(JSON.stringify(record)).not.toContain(CODE);
    expect(code).toBe(CODE);
  });

  test("the record carries the tenant, kind, class, ttl horizon and pending status", () => {
    const { record } = makeRequest();
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.requestId).toBe(REQUEST_ID);
    expect(record.ownershipKind).toBe("corporate_owned");
    expect(record.ownershipClass).toBe("corporate");
    expect(record.status).toBe("pending");
    expect(record.createdAt).toBe(CREATED_AT);
    expect(record.expiresAt).toBe("2026-01-02T00:00:00.000Z");
    expect(record.allowedRoles).toEqual([]);
  });

  test("creation is deterministic (same inputs -> identical record + code)", () => {
    const first = makeRequest();
    const second = makeRequest();
    expect(second.record).toEqual(first.record);
    expect(second.code).toBe(first.code);
  });

  test("the verifier is tenant-scoped (same code, different tenant -> different verifier)", () => {
    const verifierA = bootstrapCodeVerifier(TENANT_A, CODE);
    const verifierB = bootstrapCodeVerifier(TENANT_B, CODE);
    expect(verifierA).not.toBe(verifierB);
  });

  test("malformed creations are refused machine-stably", () => {
    expect(createEnrollmentRequest({ tenantId: TENANT_A, requestId: "", code: CODE, ownershipKind: "byod", ttlMs: TTL_MS, now: CREATED_AT })).toEqual({
      ok: false,
      error: { path: "/requestId", reason: "required" },
    });
    expect(createEnrollmentRequest({ tenantId: TENANT_A, requestId: REQUEST_ID, code: "short", ownershipKind: "byod", ttlMs: TTL_MS, now: CREATED_AT })).toEqual({
      ok: false,
      error: { path: "/code", reason: "min_length_8" },
    });
    expect(createEnrollmentRequest({ tenantId: TENANT_A, requestId: REQUEST_ID, code: CODE, ownershipKind: "corporate", ttlMs: TTL_MS, now: CREATED_AT } as never)).toEqual({
      ok: false,
      error: { path: "/ownershipKind", reason: "unknown_ownership_kind" },
    });
    expect(createEnrollmentRequest({ tenantId: TENANT_A, requestId: REQUEST_ID, code: CODE, ownershipKind: "byod", ttlMs: 0, now: CREATED_AT })).toEqual({
      ok: false,
      error: { path: "/ttlMs", reason: "positive_required" },
    });
    expect(createEnrollmentRequest({ tenantId: TENANT_A, requestId: REQUEST_ID, code: CODE, ownershipKind: "byod", ttlMs: TTL_MS, now: "not-a-date" })).toEqual({
      ok: false,
      error: { path: "/now", reason: "not_iso" },
    });
  });
});

describe("W100A redemption (one-time bootstrap exchange)", () => {
  test("first redemption succeeds and issues a device-scoped trust record", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    expect(store.put(SCOPE_A, record)).toEqual({ ok: true });

    const result = store.redeem(
      SCOPE_A,
      { requestId: REQUEST_ID, code, deviceId: DEVICE },
      WITHIN_TTL,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.trust.tenantId).toBe(TENANT_A);
    expect(result.trust.deviceId).toBe(DEVICE);
    expect(result.trust.enrollmentRequestId).toBe(REQUEST_ID);
    expect(result.trust.issuedAt).toBe(WITHIN_TTL);
    expect(result.trust.sessionToken.value).toMatch(/^fst_/);
    expect(result.trust.sessionToken.issuedAt).toBe(WITHIN_TTL);
    expect(result.trust.sessionToken.issuer).toBe("control-plane@fleetos");
  });

  test("the request is marked fulfilled with the redeeming device", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL);
    const after = store.get(SCOPE_A, REQUEST_ID);
    expect(after?.status).toBe("fulfilled");
    expect(after?.fulfilledAt).toBe(WITHIN_TTL);
    expect(after?.fulfilledDeviceId).toBe(DEVICE);
  });

  test("a SECOND redemption is refused code_already_used (one-time)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    expect(store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL).ok).toBe(true);
    const second = store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE_2 }, WITHIN_TTL);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.refusal.reason).toBe("code_already_used");
    expect(second.refusal.explanation).toBe(ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS.code_already_used);
    // The second device did NOT get trust; the record still names the FIRST device.
    const after = store.get(SCOPE_A, REQUEST_ID);
    expect(after?.fulfilledDeviceId).toBe(DEVICE);
  });

  test("a wrong code is refused code_not_found — indistinguishable from an unknown request", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record } = makeRequest();
    store.put(SCOPE_A, record);
    const wrongCode = store.redeem(
      SCOPE_A,
      { requestId: REQUEST_ID, code: "BOOT-2026-ALPHA-99", deviceId: DEVICE },
      WITHIN_TTL,
    );
    const unknownRequest = store.redeem(
      SCOPE_A,
      { requestId: "enr_request-nope", code: CODE, deviceId: DEVICE },
      WITHIN_TTL,
    );
    expect(wrongCode.ok).toBe(false);
    expect(unknownRequest.ok).toBe(false);
    if (wrongCode.ok || unknownRequest.ok) throw new Error("unreachable");
    expect(wrongCode.refusal.reason).toBe("code_not_found");
    expect(unknownRequest.refusal.reason).toBe("code_not_found");
    expect(wrongCode.refusal.explanation).toBe(unknownRequest.refusal.explanation);
    // The request is NOT consumed by a failed attempt (one-time means
    // one SUCCESS, not one attempt).
    expect(store.get(SCOPE_A, REQUEST_ID)?.status).toBe("pending");
  });

  test("redemption past the expiry refuses code_expired and records + audits the expiry", () => {
    const sink = createInMemoryEnrollmentAuditSink();
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record, { auditSink: sink });
    const late = store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, PAST_TTL, { auditSink: sink });
    expect(late.ok).toBe(false);
    if (late.ok) throw new Error("unreachable");
    expect(late.refusal.reason).toBe("code_expired");
    expect(store.get(SCOPE_A, REQUEST_ID)?.status).toBe("expired");
    expect(
      sink.records.some((r) => r.action === ENROLLMENT_REQUEST_AUDIT_ACTIONS.expired),
    ).toBe(true);
    expect(
      sink.records.some(
        (r) => r.action === ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused && r.details.reason === "code_expired",
      ),
    ).toBe(true);
  });

  test("a revoked request refuses code_revoked (terminal)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    const revoked = store.revoke(SCOPE_A, REQUEST_ID, "operator_rotation", WITHIN_TTL);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) throw new Error("unreachable");
    expect(revoked.record.status).toBe("revoked");
    expect(revoked.record.revokedReason).toBe("operator_rotation");

    const refused = store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.refusal.reason).toBe("code_revoked");
  });

  test("revoking a non-pending or unknown request is refused", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    expect(store.revoke(SCOPE_A, "enr_unknown", "r", WITHIN_TTL)).toEqual({
      ok: false,
      error: { path: "/requestId", reason: "not_found" },
    });
    store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL);
    expect(store.revoke(SCOPE_A, REQUEST_ID, "late", WITHIN_TTL)).toEqual({
      ok: false,
      error: { path: "/status", reason: "not_pending" },
    });
  });

  test("a duplicate put is refused (request ids are unique per tenant)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record } = makeRequest();
    expect(store.put(SCOPE_A, record)).toEqual({ ok: true });
    expect(store.put(SCOPE_A, record)).toEqual({
      ok: false,
      error: { path: "/requestId", reason: "duplicate_request" },
    });
  });
});

describe("W100A tenant isolation (no existence side channel)", () => {
  test("a foreign tenant cannot read, redeem or list another tenant's request", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    expect(store.get(SCOPE_B, REQUEST_ID)).toBeUndefined();
    expect(store.list(SCOPE_B)).toEqual([]);
    const foreign = store.redeem(SCOPE_B, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL);
    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw new Error("unreachable");
    expect(foreign.refusal.reason).toBe("code_not_found");
    // The foreign attempt does not consume or mutate the owner's request.
    expect(store.get(SCOPE_A, REQUEST_ID)?.status).toBe("pending");
  });

  test("the same request id + code are distinct per tenant (verifiers are tenant-scoped)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const a = makeRequest();
    const b = createEnrollmentRequest({
      tenantId: TENANT_B,
      requestId: REQUEST_ID,
      code: "BOOT-2026-BRAVO-7",
      ownershipKind: "corporate_owned",
      ttlMs: TTL_MS,
      now: CREATED_AT,
    });
    if (!b.ok) throw new Error("tenant B create failed");
    store.put(SCOPE_A, a.record);
    store.put(SCOPE_B, b.record);
    expect(store.get(SCOPE_A, REQUEST_ID)?.tenantId).toBe(TENANT_A);
    expect(store.get(SCOPE_B, REQUEST_ID)?.tenantId).toBe(TENANT_B);
    // Tenant A's code does not verify against tenant B's record (the
    // verifier is scoped to the owning tenant).
    const cross = store.redeem(SCOPE_B, { requestId: REQUEST_ID, code: a.code, deviceId: DEVICE }, WITHIN_TTL);
    expect(cross.ok).toBe(false);
    if (cross.ok) throw new Error("unreachable");
    expect(cross.refusal.reason).toBe("code_not_found");
    // But tenant B's own code redeems fine in B's partition.
    const own = store.redeem(SCOPE_B, { requestId: REQUEST_ID, code: b.code, deviceId: DEVICE }, WITHIN_TTL);
    expect(own.ok).toBe(true);
  });
});

describe("W100A scope binding (roles) + policy inputs", () => {
  test("a role-restricted request refuses an unpermitted presenter (tenant_role_mismatch)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest({ allowedRoles: ["fleet.operator", "service.desk"] });
    store.put(SCOPE_A, record);
    const refused = store.redeem(
      SCOPE_A,
      { requestId: REQUEST_ID, code, deviceId: DEVICE, presenterRole: "employee" },
      WITHIN_TTL,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.refusal.reason).toBe("tenant_role_mismatch");
  });

  test("a permitted presenter succeeds; no role presented against a restricted request is refused (fail-closed)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest({ allowedRoles: ["fleet.operator"] });
    store.put(SCOPE_A, record);
    expect(
      store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE, presenterRole: "fleet.operator" }, WITHIN_TTL).ok,
    ).toBe(true);

    const store2 = createInMemoryEnrollmentRequestStore();
    const again = makeRequest({ allowedRoles: ["fleet.operator"] });
    store2.put(SCOPE_A, again.record);
    const noRole = store2.redeem(SCOPE_A, { requestId: REQUEST_ID, code: again.code, deviceId: DEVICE }, WITHIN_TTL);
    expect(noRole.ok).toBe(false);
    if (noRole.ok) throw new Error("unreachable");
    expect(noRole.refusal.reason).toBe("tenant_role_mismatch");
  });

  test("an unrestricted request does not require a role", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    expect(store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL).ok).toBe(true);
  });

  test("device_already_enrolled refuses machine-stably (the boundary decides)", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    const refused = store.redeem(
      SCOPE_A,
      { requestId: REQUEST_ID, code, deviceId: DEVICE, policy: { deviceAlreadyEnrolled: true } },
      WITHIN_TTL,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.refusal.reason).toBe("device_already_enrolled");
    expect(store.get(SCOPE_A, REQUEST_ID)?.status).toBe("pending");
  });

  test("enrollment_refused_by_policy refuses machine-stably", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    const refused = store.redeem(
      SCOPE_A,
      { requestId: REQUEST_ID, code, deviceId: DEVICE, policy: { enrollmentAllowed: false } },
      WITHIN_TTL,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.refusal.reason).toBe("enrollment_refused_by_policy");
  });
});

describe("W100A audit trail (machine-stable actions; the code never leaks)", () => {
  test("creation, fulfillment and refusal all emit; the CODE appears in no audit record", () => {
    const sink = createInMemoryEnrollmentAuditSink();
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record, { auditSink: sink });
    store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL, { auditSink: sink });
    store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE_2 }, WITHIN_TTL, { auditSink: sink });

    const actions = sink.records.map((r) => r.action);
    expect(actions).toContain(ENROLLMENT_REQUEST_AUDIT_ACTIONS.created);
    expect(actions).toContain(ENROLLMENT_REQUEST_AUDIT_ACTIONS.fulfilled);
    expect(actions).toContain(ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused);
    // Verifier-only discipline: the CODE never reaches an audit record.
    for (const recordAudited of sink.records) {
      expect(JSON.stringify(recordAudited)).not.toContain(CODE);
      expect(recordAudited.tenantId).toBe(TENANT_A);
    }
    const refusedRecord = sink.records.find(
      (r) => r.action === ENROLLMENT_REQUEST_AUDIT_ACTIONS.refused,
    );
    expect(refusedRecord?.details.reason).toBe("code_already_used");
  });

  test("every refusal reason carries its human explanation (rendered verbatim downstream)", () => {
    expect([...ALL_ENROLLMENT_REQUEST_REFUSAL_REASONS]).toEqual([...ENROLLMENT_REQUEST_REFUSAL_REASONS]);
    for (const reason of ALL_ENROLLMENT_REQUEST_REFUSAL_REASONS) {
      const explanation = ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS[reason];
      expect(typeof explanation).toBe("string");
      expect(explanation.length).toBeGreaterThan(20);
    }
  });

  test("a refusal carries the machine reason AND the human explanation together", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const { record, code } = makeRequest();
    store.put(SCOPE_A, record);
    const refused = store.redeem(SCOPE_A, { requestId: REQUEST_ID, code: "BOOT-WRONG-CODE-9", deviceId: DEVICE }, WITHIN_TTL);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.refusal.reason).toBe("code_not_found");
    expect(refused.refusal.explanation).toBe(ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS.code_not_found);
    expect(refused.refusal.occurredAt).toBe(WITHIN_TTL);
    expect(refused.refusal.correlationId).toBe(CORRELATION);
  });
});

describe("W100A derived status + listing determinism", () => {
  test("enrollmentRequestStatusAt derives lazily from an injected instant", () => {
    const { record } = makeRequest();
    expect(enrollmentRequestStatusAt(record, WITHIN_TTL)).toBe("pending");
    expect(enrollmentRequestStatusAt(record, PAST_TTL)).toBe("expired");
    const revoked = { ...record, status: "revoked" } as EnrollmentRequestRecord;
    expect(enrollmentRequestStatusAt(revoked, PAST_TTL)).toBe("revoked");
    const fulfilled = { ...record, status: "fulfilled" } as EnrollmentRequestRecord;
    expect(enrollmentRequestStatusAt(fulfilled, PAST_TTL)).toBe("fulfilled");
  });

  test("listing is sorted by createdAt then requestId, own partition only", () => {
    const store = createInMemoryEnrollmentRequestStore();
    const early = makeRequest({ requestId: "enr_b" });
    const late = createEnrollmentRequest({
      tenantId: TENANT_A,
      requestId: "enr_a",
      code: "BOOT-2026-BRAVO-2",
      ownershipKind: "byod",
      ttlMs: TTL_MS,
      now: "2026-01-01T01:00:00Z",
    });
    if (!late.ok) throw new Error("late create failed");
    store.put(SCOPE_A, early.record);
    store.put(SCOPE_A, late.record);
    const listed = store.list(SCOPE_A);
    expect(listed.map((r) => r.requestId)).toEqual(["enr_b", "enr_a"]);
    expect(store.list(SCOPE_B)).toEqual([]);
  });

  test("the issued trust record is deterministic for identical inputs", () => {
    const run = (): string => {
      const store = createInMemoryEnrollmentRequestStore();
      const { record, code } = makeRequest();
      store.put(SCOPE_A, record);
      const result = store.redeem(SCOPE_A, { requestId: REQUEST_ID, code, deviceId: DEVICE }, WITHIN_TTL);
      if (!result.ok) throw new Error("redeem failed");
      return JSON.stringify(result.trust);
    };
    expect(run()).toBe(run());
  });
});
