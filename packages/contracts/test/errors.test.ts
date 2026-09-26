import { test, expect } from "bun:test";
import {
  toApiError,
  type FleetError,
  type DomainError,
  type PolicyError,
  type AuthorizationError,
  type AdapterError,
  type ConflictError,
  type ValidationError,
} from "../src/errors";
import { asTenantId, asCorrelationId } from "../src/ids";

const tenant = asTenantId("tnt_abc12345");
const correlation = asCorrelationId("cor_001");

test("error taxonomy: DomainError has kind=DomainError and stable code", () => {
  const err: DomainError = {
    kind: "DomainError",
    code: "device.lifecycle.illegal_transition",
    message: "Cannot transition from ENROLL to LEARN",
    tenantId: tenant,
    correlationId: correlation,
    domain: "device.lifecycle",
    invariant: "linear_progression",
  };
  expect(err.kind).toBe("DomainError");
  expect(err.code).toBe("device.lifecycle.illegal_transition");
  expect(err.tenantId).toBe(tenant);
  expect(err.correlationId).toBe(correlation);
});

test("error taxonomy: PolicyError carries decision and rule ids", () => {
  const err: PolicyError = {
    kind: "PolicyError",
    code: "policy.blocked",
    message: "Action blocked by Contract Guardian",
    tenantId: tenant,
    correlationId: correlation,
    decision: "BLOCK",
    ruleIds: ["pol_001", "pol_002"],
  };
  expect(err.decision).toBe("BLOCK");
  expect(err.ruleIds).toEqual(["pol_001", "pol_002"]);
});

test("error taxonomy: AuthorizationError carries principal, action, reason", () => {
  const err: AuthorizationError = {
    kind: "AuthorizationError",
    code: "authorization.denied",
    message: "Principal lacks required role",
    tenantId: tenant,
    correlationId: correlation,
    principalId: "usr_001",
    action: "device.wipe",
    reason: "missing_role",
  };
  expect(err.principalId).toBe("usr_001");
  expect(err.action).toBe("device.wipe");
});

test("error taxonomy: AdapterError carries capability + adapter family context", () => {
  const err: AdapterError = {
    kind: "AdapterError",
    code: "adapter.timeout",
    message: "Adapter timed out",
    tenantId: tenant,
    correlationId: correlation,
    capability: "wipe",
    adapterFamily: "windows",
    deviceId: "dev_xyz",
    retryable: true,
  };
  expect(err.capability).toBe("wipe");
  expect(err.adapterFamily).toBe("windows");
  expect(err.retryable).toBe(true);
});

test("error taxonomy: ConflictError carries resource and conflicting operation", () => {
  const err: ConflictError = {
    kind: "ConflictError",
    code: "intent.duplicate_idempotency",
    message: "Idempotency key collision",
    tenantId: tenant,
    correlationId: correlation,
    resource: "intent:int_001",
    conflictingOperationId: "int_002",
  };
  expect(err.resource).toBe("intent:int_001");
  expect(err.conflictingOperationId).toBe("int_002");
});

test("error taxonomy: ValidationError carries failures list", () => {
  const err: ValidationError = {
    kind: "ValidationError",
    code: "validation.failed",
    message: "Input validation failed",
    tenantId: tenant,
    correlationId: correlation,
    failures: [
      { path: "/payload/deviceId", reason: "required" },
      { path: "/payload/seatCount", reason: "must_be_positive" },
    ],
  };
  expect(err.failures.length).toBe(2);
  expect(err.failures[0].path).toBe("/payload/deviceId");
});

test("FleetError discriminated union: switch on kind works for all six subclasses", () => {
  const errors: FleetError[] = [
    {
      kind: "DomainError",
      code: "d",
      message: "",
      tenantId: tenant,
      correlationId: correlation,
      domain: "test",
    },
    {
      kind: "PolicyError",
      code: "p",
      message: "",
      tenantId: tenant,
      correlationId: correlation,
      decision: "BLOCK",
      ruleIds: [],
    },
    {
      kind: "AuthorizationError",
      code: "a",
      message: "",
      tenantId: tenant,
      correlationId: correlation,
      principalId: "u",
      action: "x",
      reason: "r",
    },
    {
      kind: "AdapterError",
      code: "ad",
      message: "",
      tenantId: tenant,
      correlationId: correlation,
      capability: "wipe",
      adapterFamily: "windows",
      retryable: false,
    },
    {
      kind: "ConflictError",
      code: "c",
      message: "",
      tenantId: tenant,
      correlationId: correlation,
      resource: "r",
    },
    {
      kind: "ValidationError",
      code: "v",
      message: "",
      tenantId: tenant,
      correlationId: correlation,
      failures: [],
    },
  ];
  const seen: string[] = [];
  for (const e of errors) {
    seen.push(e.kind);
  }
  expect(seen).toEqual([
    "DomainError",
    "PolicyError",
    "AuthorizationError",
    "AdapterError",
    "ConflictError",
    "ValidationError",
  ]);
});

test("toApiError: DomainError -> 400", () => {
  const err: DomainError = {
    kind: "DomainError",
    code: "d",
    message: "bad",
    tenantId: tenant,
    correlationId: correlation,
    domain: "test",
  };
  const api = toApiError(err);
  expect(api.status).toBe(400);
  expect(api.kind).toBe("DomainError");
});

test("toApiError: PolicyError BLOCK -> 403, REQUIRE_APPROVAL -> 422", () => {
  const block: PolicyError = {
    kind: "PolicyError",
    code: "p",
    message: "blocked",
    tenantId: tenant,
    correlationId: correlation,
    decision: "BLOCK",
    ruleIds: [],
  };
  expect(toApiError(block).status).toBe(403);
  const requireApproval: PolicyError = { ...block, decision: "REQUIRE_APPROVAL" };
  expect(toApiError(requireApproval).status).toBe(422);
});

test("toApiError: AuthorizationError -> 403", () => {
  const err: AuthorizationError = {
    kind: "AuthorizationError",
    code: "a",
    message: "",
    tenantId: tenant,
    correlationId: correlation,
    principalId: "u",
    action: "x",
    reason: "r",
  };
  expect(toApiError(err).status).toBe(403);
});

test("toApiError: AdapterError -> 502", () => {
  const err: AdapterError = {
    kind: "AdapterError",
    code: "ad",
    message: "",
    tenantId: tenant,
    correlationId: correlation,
    capability: "wipe",
    adapterFamily: "windows",
    retryable: false,
  };
  expect(toApiError(err).status).toBe(502);
});

test("toApiError: ConflictError -> 409", () => {
  const err: ConflictError = {
    kind: "ConflictError",
    code: "c",
    message: "",
    tenantId: tenant,
    correlationId: correlation,
    resource: "r",
  };
  expect(toApiError(err).status).toBe(409);
});

test("toApiError: ValidationError -> 400 and includes failures in details", () => {
  const err: ValidationError = {
    kind: "ValidationError",
    code: "v",
    message: "",
    tenantId: tenant,
    correlationId: correlation,
    failures: [{ path: "/x", reason: "r" }],
  };
  const api = toApiError(err);
  expect(api.status).toBe(400);
  expect(api.details).toBeDefined();
  expect((api.details as { failures: unknown[] }).failures.length).toBe(1);
});
