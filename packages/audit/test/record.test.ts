/**
 * W012 D3 — Hash chain + tamper detection: canonical JSON, content hash
 * determinism, and the verifyAuditChain walk.
 */

import { test, expect } from "bun:test";
import { asCorrelationId, asTenantId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import {
  AUDIT_GENESIS_HASH,
  type AuditRecord,
  AuditVerificationResult,
  computeRecordHash,
  createInMemoryAuditLog,
  fnv1a32Hex,
  makeAuditActorRef,
  verifyAuditChain,
} from "../src/index";
import { canonicalJson } from "../src/internal";

const TENANT_A = asTenantId("tnt_alpha000001");
const TENANT_B = asTenantId("tnt_beta000002");
const AT = "2026-03-01T00:00:00Z";

test("canonicalJson sorts keys recursively and is order-independent", () => {
  const a = { z: 1, a: { y: [3, { b: 1, a: 2 }], x: "s" }, m: null };
  const b = { m: null, a: { x: "s", y: [3, { a: 2, b: 1 }] }, z: 1 };
  expect(canonicalJson(a)).toBe(canonicalJson(b));
  expect(canonicalJson(a)).toBe('{"a":{"x":"s","y":[3,{"a":2,"b":1}]},"m":null,"z":1}');
});

test("canonicalJson mirrors JSON.stringify edge semantics deterministically", () => {
  expect(canonicalJson(undefined)).toBe("null");
  expect(canonicalJson([undefined, 1])).toBe("[null,1]");
  expect(canonicalJson({ f: () => undefined, keep: 1 })).toBe('{"keep":1}');
  expect(canonicalJson(NaN)).toBe("null");
  expect(canonicalJson("x")).toBe('"x"');
  expect(() => canonicalJson(1n)).toThrow(TypeError);
});

test("fnv1a32Hex is deterministic and stable across calls", () => {
  expect(fnv1a32Hex("fleetos")).toBe(fnv1a32Hex("fleetos"));
  expect(fnv1a32Hex("fleetos")).not.toBe(fnv1a32Hex("fleetot"));
  expect(fnv1a32Hex("")).toBe("811c9dc5");
});

function hashableRecord(overrides: Record<string, unknown> = {}): Omit<AuditRecord, "recordHash"> {
  return {
    id: "aud_000000000001" as never,
    sequence: 1,
    tenantId: TENANT_A,
    actor: makeAuditActorRef("user", "usr:u1", TENANT_A),
    action: "device.wipe.executed",
    occurredAt: AT,
    source: "test.boundary",
    outcome: { status: "success" },
    correlationId: asCorrelationId("cor_w012audit001"),
    relatedEventIds: [],
    details: { devices: 2, note: "ok" },
    priorRecordHash: AUDIT_GENESIS_HASH,
    ...overrides,
  };
}

test("computeRecordHash is deterministic and key-order independent", () => {
  const r1 = hashableRecord({ details: { a: 1, b: 2 } });
  const r2 = hashableRecord({ details: { b: 2, a: 1 } });
  expect(computeRecordHash(r1, fnv1a32Hex)).toBe(computeRecordHash(r2, fnv1a32Hex));
  expect(computeRecordHash(r1, fnv1a32Hex)).toBe(computeRecordHash(r1, fnv1a32Hex));
});

test("computeRecordHash binds the prior hash: different prior, different digest", () => {
  const base = hashableRecord();
  const chained = hashableRecord({ priorRecordHash: "pretendhash" });
  expect(computeRecordHash(base, fnv1a32Hex)).not.toBe(computeRecordHash(chained, fnv1a32Hex));
});

test("computeRecordHash is injective over content mutations (tamper sensitivity)", () => {
  const base = computeRecordHash(hashableRecord(), fnv1a32Hex);
  const mutations: Record<string, unknown>[] = [
    { action: "device.wipe.faked" },
    { occurredAt: "2026-03-01T00:00:01Z" },
    { sequence: 2 },
    { tenantId: TENANT_B },
    { outcome: { status: "denied", reasons: ["x"] } },
    { details: { devices: 3, note: "ok" } },
    { correlationId: asCorrelationId("cor_w012audit002") },
  ];
  for (const mutation of mutations) {
    expect(computeRecordHash(hashableRecord(mutation), fnv1a32Hex)).not.toBe(base);
  }
});

function buildChain(): { records: readonly AuditRecord[]; hash: typeof fnv1a32Hex } {
  const log = createInMemoryAuditLog();
  const ctx = makeTenantContext(TENANT_A);
  const actor = makeAuditActorRef("user", "usr:u1", TENANT_A);
  for (let i = 0; i < 4; i++) {
    log.append(ctx, {
      tenantId: TENANT_A,
      actor,
      action: `test.action.${i}`,
      occurredAt: AT,
      source: "test.boundary",
      outcome: { status: "success" },
      correlationId: asCorrelationId(`cor_w012chain00${i}`),
      details: { i },
    });
  }
  return { records: log.records(ctx), hash: fnv1a32Hex };
}

test("verifyAuditChain accepts an intact chain and reports the head", () => {
  const { records, hash } = buildChain();
  const result = verifyAuditChain(records, hash);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.records).toBe(4);
    expect(result.headHash).toBe(records[records.length - 1]?.recordHash);
  }
});

test("the first record carries the genesis prior hash; later records chain", () => {
  const { records } = buildChain();
  expect(records[0]?.priorRecordHash).toBe(AUDIT_GENESIS_HASH);
  for (let i = 1; i < records.length; i++) {
    expect(records[i]?.priorRecordHash).toBe(records[i - 1]?.recordHash);
  }
  for (let i = 0; i < records.length; i++) {
    expect(records[i]?.sequence).toBe(i + 1);
  }
});

test("TAMPER DETECTION: mutating record content breaks its content hash", () => {
  const { records, hash } = buildChain();
  const tampered = records.map((r, i) =>
    i === 2 ? { ...r, action: "forged.action" } : r,
  );
  const result = verifyAuditChain(tampered as readonly AuditRecord[], hash);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("hash_mismatch");
    expect(result.atSequence).toBe(3);
  }
});

test("TAMPER DETECTION: a record replaced with a consistently re-hashed forgery breaks the chain link", () => {
  const { records, hash } = buildChain();
  // Replace record #2 with a different-but-validly-hashed record (the
  // attacker can recompute hashes with the same public hash function).
  const forged = hashableRecord({
    id: "aud_000000000002" as never,
    sequence: 2,
    action: "forged.action",
    priorRecordHash: records[0]?.recordHash,
  });
  const forgedRecord: AuditRecord = {
    ...forged,
    recordHash: computeRecordHash(forged, hash),
  };
  // Record #3 still points at the ORIGINAL record #2 hash.
  const tampered = [records[0], forgedRecord, records[2], records[3]];
  const result = verifyAuditChain(tampered as readonly AuditRecord[], hash);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("chain_break");
    expect(result.atSequence).toBe(3);
  }
});

test("TAMPER DETECTION: deleting a record opens a sequence gap", () => {
  const { records, hash } = buildChain();
  const truncated = [records[0], records[2], records[3]];
  const result = verifyAuditChain(truncated as readonly AuditRecord[], hash);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    // Record #3 now sits at position 2.
    expect(result.kind).toBe("sequence_gap");
    expect(result.atSequence).toBe(3);
  }
});

test("TAMPER DETECTION: splicing a foreign-tenant record is detected", () => {
  const { records, hash } = buildChain();
  const foreignInput = hashableRecord({
    id: "aud_000000000099" as never,
    sequence: 2,
    tenantId: TENANT_B,
    actor: makeAuditActorRef("user", "usr:foreign", TENANT_B),
    priorRecordHash: records[0]?.recordHash,
  });
  const foreign: AuditRecord = {
    ...foreignInput,
    recordHash: computeRecordHash(foreignInput, hash),
  };
  const spliced = [records[0], foreign, records[2], records[3]];
  const result = verifyAuditChain(spliced as readonly AuditRecord[], hash);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.kind).toBe("tenant_mismatch");
  }
});

test("an empty chain reports empty_chain from the pure walker", () => {
  const result: AuditVerificationResult = verifyAuditChain([], fnv1a32Hex);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.kind).toBe("empty_chain");
});

test("verification is deterministic", () => {
  const { records, hash } = buildChain();
  expect(JSON.stringify(verifyAuditChain(records, hash))).toBe(
    JSON.stringify(verifyAuditChain(records, hash)),
  );
});
