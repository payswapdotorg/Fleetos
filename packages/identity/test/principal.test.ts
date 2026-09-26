/**
 * W012 D2 — Principal model tests: user/service/agent, tenant binding,
 * principalId grammars, projection, type-guard, immutability.
 */

import { test, expect } from "bun:test";
import { asDeviceId, asTenantId, asUserId } from "@fleetos/contracts";
import {
  IdentityError,
  PRINCIPAL_KIND_AGENT,
  PRINCIPAL_KIND_SERVICE,
  PRINCIPAL_KIND_USER,
  isPrincipalRef,
  makeAgentPrincipal,
  makeServicePrincipal,
  makeUserPrincipal,
  principalRef,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const USER_1 = asUserId("usr_w012user0001");
const DEVICE_1 = asDeviceId("dev_w012device01");

test("user principal carries the user kind, stable id grammar, and tenant binding", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  expect(principal.kind).toBe(PRINCIPAL_KIND_USER);
  expect(principal.principalId).toBe(`usr:${USER_1}`);
  expect(principal.tenantId).toBe(TENANT_A);
  expect(principal.userId).toBe(USER_1);
  expect(Object.isFrozen(principal)).toBe(true);
});

test("service principal carries the service kind and stable id grammar", () => {
  const principal = makeServicePrincipal(TENANT_A, "device-model.ingestion");
  expect(principal.kind).toBe(PRINCIPAL_KIND_SERVICE);
  expect(principal.principalId).toBe("svc:device-model.ingestion");
  expect(principal.tenantId).toBe(TENANT_A);
});

test("agent principal carries the agent kind, device binding, and stable id grammar", () => {
  const principal = makeAgentPrincipal(TENANT_A, DEVICE_1);
  expect(principal.kind).toBe(PRINCIPAL_KIND_AGENT);
  expect(principal.principalId).toBe(`agt:${DEVICE_1}`);
  expect(principal.tenantId).toBe(TENANT_A);
  expect(principal.deviceId).toBe(DEVICE_1);
});

test("principals are tenant-bound: the same user id in two tenants is two principals", () => {
  const inA = makeUserPrincipal(TENANT_A, USER_1);
  const inB = makeUserPrincipal(TENANT_B, USER_1);
  expect(inA.principalId).toBe(inB.principalId);
  expect(inA.tenantId).not.toBe(inB.tenantId);
});

test("constructors reject empty identifiers deterministically", () => {
  expect(() => makeUserPrincipal(TENANT_A, asUserId(""))).toThrow(IdentityError);
  expect(() => makeServicePrincipal(TENANT_A, "")).toThrow(IdentityError);
  expect(() => makeAgentPrincipal(TENANT_A, asDeviceId(""))).toThrow(IdentityError);
});

test("principalRef projects the compact reference (frozen)", () => {
  const principal = makeUserPrincipal(TENANT_A, USER_1);
  const ref = principalRef(principal);
  expect(ref).toEqual({
    kind: "user",
    principalId: `usr:${USER_1}`,
    tenantId: TENANT_A,
  });
  expect(Object.isFrozen(ref)).toBe(true);
});

test("isPrincipalRef guards runtime boundaries", () => {
  expect(isPrincipalRef(makeUserPrincipal(TENANT_A, USER_1))).toBe(true);
  expect(isPrincipalRef(makeServicePrincipal(TENANT_A, "svc"))).toBe(true);
  expect(isPrincipalRef(makeAgentPrincipal(TENANT_A, DEVICE_1))).toBe(true);
  expect(isPrincipalRef(null)).toBe(false);
  expect(isPrincipalRef({})).toBe(false);
  expect(isPrincipalRef({ kind: "user", principalId: "", tenantId: TENANT_A })).toBe(false);
  expect(isPrincipalRef({ kind: "robot", principalId: "x", tenantId: TENANT_A })).toBe(false);
});

test("principalId grammars are stable and machine-matchable", () => {
  expect(makeUserPrincipal(TENANT_A, USER_1).principalId.startsWith("usr:")).toBe(true);
  expect(makeServicePrincipal(TENANT_A, "x").principalId.startsWith("svc:")).toBe(true);
  expect(makeAgentPrincipal(TENANT_A, DEVICE_1).principalId.startsWith("agt:")).toBe(true);
});
