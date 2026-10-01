/**
 * W121 — the password-credential seam + service: the PasswordHasher
 * contract (deterministic, salt-sensitive, never storing the plain
 * password), register/verify over the durable record seam, the
 * machine-stable unknown-account vs wrong-password refusals, tenant
 * isolation of credential lookups, and the audit emission (ids only —
 * never salt/verifier/plain).
 */

import { test, expect } from "bun:test";
import { asTenantId, asUserId, asCorrelationId } from "@fleetos/contracts";
import {
  MIN_PASSWORD_LENGTH,
  createDurablePasswordCredentialRepository,
  createInMemoryDurableRecordStore,
  createInMemoryIdentityAuditSink,
  createPasswordCredentialService,
  createReferencePasswordHasher,
  makeTenantContext,
  passwordCredentialIdOf,
} from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const FOUNDER = asUserId("usr_founder0001");
const CORR = asCorrelationId("cor_w121_pass001");
const T0 = "2026-10-01T09:00:00Z";
const PLAIN = "founder-pass-0001";

function makeService(opts: { readonly salts?: () => string } = {}) {
  const store = createInMemoryDurableRecordStore();
  const audit = createInMemoryIdentityAuditSink();
  const credentials = createDurablePasswordCredentialRepository(store);
  const service = createPasswordCredentialService({
    credentials,
    hasher: createReferencePasswordHasher(),
    saltGenerator: opts.salts,
    auditSink: audit,
  });
  return { store, audit, credentials, service };
}

function registerFounder(service: ReturnType<typeof makeService>["service"]) {
  return service.registerCredential({
    now: T0,
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    memberRef: FOUNDER,
    plainPassword: PLAIN,
    createdBy: `usr:${FOUNDER}`,
    correlationId: CORR,
  });
}

// ---------------------------------------------------------------------------
// The PasswordHasher seam
// ---------------------------------------------------------------------------

test("the reference hasher is deterministic and salt-sensitive", () => {
  const hasher = createReferencePasswordHasher();
  const verifier = hasher.hash(PLAIN, "slt_w100c0000000000001");
  expect(verifier.startsWith("pwv_")).toBe(true);
  // deterministic: the same inputs, the same verifier
  expect(hasher.hash(PLAIN, "slt_w100c0000000000001")).toBe(verifier);
  // salt-sensitive: a different salt, a different verifier
  expect(hasher.hash(PLAIN, "slt_w100c0000000000002")).not.toBe(verifier);
  // the verifier never contains the plain password
  expect(verifier).not.toContain(PLAIN);
});

test("verify is exactly hash(plain, salt) === verifier", () => {
  const hasher = createReferencePasswordHasher();
  const verifier = hasher.hash(PLAIN, "slt_fixed");
  expect(hasher.verify(PLAIN, "slt_fixed", verifier)).toBe(true);
  expect(hasher.verify("wrong-password", "slt_fixed", verifier)).toBe(false);
  expect(hasher.verify(PLAIN, "slt_other", verifier)).toBe(false);
  expect(hasher.verify(PLAIN, "slt_fixed", "garbage")).toBe(false);
  expect(hasher.verify(PLAIN, "slt_fixed", "")).toBe(false);
});

test("an injected custom hasher flows through the seam (the seam is the contract)", () => {
  // a deliberately distinct implementation: identity never assumes WHICH
  // hasher is injected — only the (plain, salt) -> verifier contract
  const service = createPasswordCredentialService({
    credentials: createDurablePasswordCredentialRepository(createInMemoryDurableRecordStore()),
    hasher: {
      hash: (plain: string, salt: string): string => `custom_${salt.length}_${plain.length}`,
      verify: (plain: string, salt: string, verifier: string): boolean =>
        verifier === `custom_${salt.length}_${plain.length}`,
    },
  });
  const registered = service.registerCredential({
    now: T0,
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    memberRef: FOUNDER,
    plainPassword: PLAIN,
    createdBy: `usr:${FOUNDER}`,
    correlationId: CORR,
  });
  expect(registered.ok).toBe(true);
  const verified = service.verifyCredential({
    tenantId: TENANT_A,
    memberRef: FOUNDER,
    plainPassword: PLAIN,
    correlationId: CORR,
  });
  expect(verified.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// registerCredential
// ---------------------------------------------------------------------------

test("registerCredential persists the verifier + salt (never the plain password) and audits ids only", () => {
  const { audit, service, store } = makeService();
  const registered = registerFounder(service);
  expect(registered.ok).toBe(true);
  if (!registered.ok) throw new Error("unreachable");

  // the durable row carries verifier + salt; the snapshot NEVER the plain password
  const ctx = makeTenantContext(TENANT_A, CORR);
  const record = store.list(ctx, "fleetos_password_credentials")[0]!.row;
  expect(typeof record["salt"]).toBe("string");
  expect(String(record["verifier"]).startsWith("pwv_")).toBe(true);
  expect(JSON.stringify(store.list(ctx, "fleetos_password_credentials"))).not.toContain(PLAIN);

  // the deterministic credential id grammar
  expect(registered.credential.credentialId).toBe(
    passwordCredentialIdOf(TENANT_A, `usr:${FOUNDER}`),
  );

  // ONE audit record; ids only — never salt/verifier/plain
  const audited = audit.records.filter((r) => r.action === "identity.credential.created");
  expect(audited.length).toBe(1);
  expect(audited[0]!.tenantId).toBe(TENANT_A);
  expect(audited[0]!.subject).toBe(registered.credential.credentialId);
  expect(JSON.stringify(audited[0]!.details)).not.toContain(PLAIN);
  expect(JSON.stringify(audited[0]!.details)).not.toContain(String(record["verifier"]));
  expect(JSON.stringify(audited[0]!.details)).not.toContain(String(record["salt"]));
});

test("registerCredential refuses machine-stably: short password, empty inputs, bad `now`, duplicate", () => {
  const { service } = makeService();
  // the honest minimum length
  expect(MIN_PASSWORD_LENGTH).toBe(8);
  const short = service.registerCredential({
    now: T0,
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    memberRef: FOUNDER,
    plainPassword: "short",
    createdBy: `usr:${FOUNDER}`,
    correlationId: CORR,
  });
  expect(short.ok).toBe(false);
  if (short.ok) return;
  expect(short.reason).toBe("invalid_input");
  expect(short.message).toContain("characters");

  const emptyRef = service.registerCredential({
    now: T0,
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    memberRef: "  ",
    plainPassword: PLAIN,
    createdBy: `usr:${FOUNDER}`,
    correlationId: CORR,
  });
  expect(emptyRef.ok).toBe(false);
  if (emptyRef.ok) return;
  expect(emptyRef.reason).toBe("invalid_input");

  const badNow = service.registerCredential({
    now: "not-a-timestamp",
    tenantId: TENANT_A,
    principalId: `usr:${FOUNDER}`,
    memberRef: FOUNDER,
    plainPassword: PLAIN,
    createdBy: `usr:${FOUNDER}`,
    correlationId: CORR,
  });
  expect(badNow.ok).toBe(false);
  if (badNow.ok) return;
  expect(badNow.reason).toBe("invalid_input");

  // a principal holds exactly ONE credential
  registerFounder(service);
  const duplicate = registerFounder(service);
  expect(duplicate.ok).toBe(false);
  if (duplicate.ok) return;
  expect(duplicate.reason).toBe("credential_already_exists");
});

test("registerCredential salts per credential (injected generator; same password, different salts)", () => {
  const salts: string[] = ["slt_one", "slt_two"];
  const { service, store } = makeService({ salts: () => salts.shift() ?? "slt_x" });
  registerFounder(service);
  const second = service.registerCredential({
    now: T0,
    tenantId: TENANT_A,
    principalId: "usr:usr_member00001",
    memberRef: "usr_member00001",
    plainPassword: PLAIN,
    createdBy: `usr:${FOUNDER}`,
    correlationId: CORR,
  });
  expect(second.ok).toBe(true);
  const ctx = makeTenantContext(TENANT_A, CORR);
  const rows = store.list(ctx, "fleetos_password_credentials");
  expect(rows.map((r) => r.row["salt"])).toEqual(["slt_one", "slt_two"]);
  // same password + different salts => different verifiers (rainbow-table resistance)
  expect(rows[0]!.row["verifier"]).not.toBe(rows[1]!.row["verifier"]);
});

// ---------------------------------------------------------------------------
// verifyCredential — the machine-stable refusals
// ---------------------------------------------------------------------------

test("verifyCredential: the correct password verifies; wrong password is a distinct machine reason", () => {
  const { service } = makeService();
  registerFounder(service);
  const ok = service.verifyCredential({
    tenantId: TENANT_A,
    memberRef: FOUNDER,
    plainPassword: PLAIN,
    correlationId: CORR,
  });
  expect(ok.ok).toBe(true);
  if (!ok.ok) throw new Error("unreachable");
  expect(ok.principalId).toBe(`usr:${FOUNDER}`);
  expect(ok.memberRef).toBe(FOUNDER);
  expect(ok.tenantId).toBe(TENANT_A);

  const wrong = service.verifyCredential({
    tenantId: TENANT_A,
    memberRef: FOUNDER,
    plainPassword: "not-the-password",
    correlationId: CORR,
  });
  expect(wrong.ok).toBe(false);
  if (wrong.ok) return;
  expect(wrong.reason).toBe("wrong_password");
  expect(wrong.message).toContain("does not match");
});

test("verifyCredential: an unknown account is a DISTINCT machine reason from a wrong password", () => {
  const { service } = makeService();
  registerFounder(service);
  const unknown = service.verifyCredential({
    tenantId: TENANT_A,
    memberRef: "usr_nobody00001",
    plainPassword: PLAIN,
    correlationId: CORR,
  });
  expect(unknown.ok).toBe(false);
  if (unknown.ok) return;
  expect(unknown.reason).toBe("unknown_account");
  expect(unknown.reason).not.toBe("wrong_password");
});

test("verifyCredential never crosses tenants (partition-scoped lookup)", () => {
  const { service } = makeService();
  registerFounder(service);
  // tenant B has no credential for this member: unknown there, verified in A
  const foreign = service.verifyCredential({
    tenantId: TENANT_B,
    memberRef: FOUNDER,
    plainPassword: PLAIN,
    correlationId: CORR,
  });
  expect(foreign.ok).toBe(false);
  if (foreign.ok) return;
  expect(foreign.reason).toBe("unknown_account");
});

test("verifyCredential: a revoked credential refuses machine-stably", () => {
  const { credentials, service } = makeService();
  const registered = registerFounder(service);
  expect(registered.ok).toBe(true);
  if (!registered.ok) throw new Error("unreachable");
  const ctx = makeTenantContext(TENANT_A, CORR);
  const revoked = { ...registered.credential, revokedAt: "2026-10-02T09:00:00Z" };
  expect(credentials.updateCredential(ctx, revoked).ok).toBe(true);
  const refused = service.verifyCredential({
    tenantId: TENANT_A,
    memberRef: FOUNDER,
    plainPassword: PLAIN,
    correlationId: CORR,
  });
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.reason).toBe("credential_revoked");
});

test("verifyCredential refuses invalid input machine-stably (empty member/password)", () => {
  const { service } = makeService();
  const emptyMember = service.verifyCredential({
    tenantId: TENANT_A,
    memberRef: " ",
    plainPassword: PLAIN,
    correlationId: CORR,
  });
  expect(emptyMember.ok).toBe(false);
  if (emptyMember.ok) return;
  expect(emptyMember.reason).toBe("invalid_input");
  const emptyPassword = service.verifyCredential({
    tenantId: TENANT_A,
    memberRef: FOUNDER,
    plainPassword: "",
    correlationId: CORR,
  });
  expect(emptyPassword.ok).toBe(false);
  if (emptyPassword.ok) return;
  expect(emptyPassword.reason).toBe("invalid_input");
});

test("verifyCredential is a pure read: NEVER audited", () => {
  const { audit, service } = makeService();
  registerFounder(service);
  service.verifyCredential({ tenantId: TENANT_A, memberRef: FOUNDER, plainPassword: PLAIN, correlationId: CORR });
  service.verifyCredential({ tenantId: TENANT_A, memberRef: FOUNDER, plainPassword: "wrong", correlationId: CORR });
  service.verifyCredential({ tenantId: TENANT_A, memberRef: "usr_nobody00001", plainPassword: "x-pass", correlationId: CORR });
  // only the registration emitted; the verifications emitted nothing
  expect(audit.records.length).toBe(1);
  expect(audit.records[0]!.action).toBe("identity.credential.created");
});
