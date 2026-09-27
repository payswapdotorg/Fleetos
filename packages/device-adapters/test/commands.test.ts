/**
 * W010 D4 — command receipt + execution result tests.
 *
 * Covers:
 *   - Acknowledgment: new receipt on first delivery, replayed receipt on
 *     redelivery (same command)
 *   - Idempotency conflict: DIFFERENT command under the same key =>
 *     ConflictError
 *   - Status transitions: the legal table + illegal-transition rejection
 *   - Terminal result recording (succeeded / failed)
 *   - Idempotent `recordResult` (replay returns the ORIGINAL)
 *   - Tenant isolation (lookup is tenant-scoped)
 *   - FleetError mapping from agent execution failures (taxonomy conformance)
 *   - Evidence fields on the result
 */

import { test, expect } from "bun:test";
import {
  toApiError,
  type CommandEnvelope,
  type EvidenceRef,
  type FleetError,
} from "@fleetos/contracts";
import {
  canTransitionCommandStatus,
  commandDigest,
  createCommandReceiptTracker,
  isTerminalCommandStatus,
  mapAgentFailure,
  type AgentExecutionFailureKind,
  type CommandReceiptTracker,
  type CommandStatus,
} from "../src/commands";
import { ERROR_CODES } from "../src/internal";
import {
  makeCommandEnvelope,
  makeCorrelationId,
  makeDeviceId,
  makeIdempotencyKey,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";

// ---------------------------------------------------------------------------
// Status transition table
// ---------------------------------------------------------------------------

test("D4: the command status transition table matches the spec", () => {
  // accepted -> executing | rejected
  expect(canTransitionCommandStatus("accepted", "executing")).toBe(true);
  expect(canTransitionCommandStatus("accepted", "rejected")).toBe(true);
  expect(canTransitionCommandStatus("accepted", "succeeded")).toBe(false);
  expect(canTransitionCommandStatus("accepted", "failed")).toBe(false);

  // executing -> succeeded | failed
  expect(canTransitionCommandStatus("executing", "succeeded")).toBe(true);
  expect(canTransitionCommandStatus("executing", "failed")).toBe(true);
  expect(canTransitionCommandStatus("executing", "accepted")).toBe(false);
  expect(canTransitionCommandStatus("executing", "rejected")).toBe(false);

  // terminal states have no outgoing transitions
  for (const terminal of ["succeeded", "failed", "rejected"] as const) {
    for (const target of ["accepted", "executing", "succeeded", "failed", "rejected"] as const) {
      expect(canTransitionCommandStatus(terminal, target)).toBe(false);
    }
  }
});

test("D4: isTerminalCommandStatus identifies the terminal statuses", () => {
  expect(isTerminalCommandStatus("accepted")).toBe(false);
  expect(isTerminalCommandStatus("executing")).toBe(false);
  expect(isTerminalCommandStatus("succeeded")).toBe(true);
  expect(isTerminalCommandStatus("failed")).toBe(true);
  expect(isTerminalCommandStatus("rejected")).toBe(true);
});

// ---------------------------------------------------------------------------
// Acknowledgment — new receipt on first delivery
// ---------------------------------------------------------------------------

test("D4: acknowledge() returns a new accepted receipt on first delivery", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "ack-first", type: "device.command.lock" });
  const result = tracker.acknowledge(command, makeTimestamp("ack-first-received"));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.replayed).toBe(false);
  expect(result.receipt.status).toBe("accepted");
  expect(result.receipt.commandId).toBe(command.id);
  expect(result.receipt.idempotencyKey).toBe(command.idempotencyKey);
  expect(result.receipt.tenantId).toBe(command.tenantId);
  expect(result.receipt.correlationId).toBe(command.correlationId);
});

test("D4: acknowledge() with a rejectReason returns a rejected receipt", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "ack-reject", type: "device.command.wipe" });
  const result = tracker.acknowledge(
    command,
    makeTimestamp("ack-reject-received"),
    "unauthorized",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.receipt.status).toBe("rejected");
});

test("D4: acknowledge() with a malformed envelope returns a ValidationError", () => {
  const tracker = createCommandReceiptTracker();
  // Construct a malformed command (missing idempotencyKey).
  const bad = {
    ...makeCommandEnvelope({ seed: "bad" }),
    idempotencyKey: "" as never,
  } as CommandEnvelope<unknown>;
  const result = tracker.acknowledge(bad, makeTimestamp("bad-received"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("ValidationError");
    expect(result.error.code).toBe(ERROR_CODES.commandRejected);
  }
});

// ---------------------------------------------------------------------------
// Idempotency — replay returns the ORIGINAL receipt
// ---------------------------------------------------------------------------

test("D4: CRITICAL — idempotent acknowledge() replays the original receipt on redelivery", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "idem-replay", type: "device.command.lock" });
  const first = tracker.acknowledge(command, makeTimestamp("first-received"));
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  // Redeliver the SAME command (network retry). Same idempotencyKey,
  // same content => replay the ORIGINAL receipt.
  const replay = tracker.acknowledge(command, makeTimestamp("retry-received"));
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(replay.replayed).toBe(true);
  expect(replay.receipt).toBe(first.receipt); // referential equality — same object
  // The original receipt's receivedAt is preserved (NOT overwritten with the retry time).
  expect(replay.receipt.receivedAt).toBe(makeTimestamp("first-received"));
});

test("D4: idempotency conflict — DIFFERENT command under the same key => ConflictError", () => {
  const tracker = createCommandReceiptTracker();
  const key = makeIdempotencyKey("conflict-key");
  const tenantId = makeTenantId("conflict-tenant");
  const correlationId = makeCorrelationId("conflict-cor");

  const cmd1 = makeCommandEnvelope({
    seed: "conflict-1",
    idempotencyKey: key,
    tenantId,
    correlationId,
    type: "device.command.lock",
    payload: { v: 1 },
  });
  const cmd2 = makeCommandEnvelope({
    seed: "conflict-2",
    idempotencyKey: key,
    tenantId,
    correlationId,
    type: "device.command.lock",
    payload: { v: 2 }, // DIFFERENT payload
  });

  const first = tracker.acknowledge(cmd1, makeTimestamp("conflict-first"));
  expect(first.ok).toBe(true);

  const second = tracker.acknowledge(cmd2, makeTimestamp("conflict-second"));
  expect(second.ok).toBe(false);
  if (!second.ok) {
    expect(second.error.kind).toBe("ConflictError");
    expect(second.error.code).toBe(ERROR_CODES.commandIdempotencyConflict);
  }
});

// ---------------------------------------------------------------------------
// Transition + terminal result recording
// ---------------------------------------------------------------------------

test("D4: transition() moves accepted -> executing -> succeeded", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "trans-success", type: "device.command.lock" });
  const ack = tracker.acknowledge(command, makeTimestamp("trans-success-ack"));
  if (!ack.ok) throw new Error("ack failed");

  const t1 = tracker.transition(
    command.idempotencyKey,
    "executing",
    makeTimestamp("trans-executing"),
    undefined,
    undefined,
    command.tenantId,
    command.correlationId,
  );
  expect(t1.ok).toBe(true);

  const t2 = tracker.transition(
    command.idempotencyKey,
    "succeeded",
    makeTimestamp("trans-succeeded"),
    undefined,
    undefined,
    command.tenantId,
    command.correlationId,
  );
  expect(t2.ok).toBe(true);
});

test("D4: transition() refuses illegal transitions (accepted -> succeeded)", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "illegal", type: "device.command.lock" });
  const ack = tracker.acknowledge(command, makeTimestamp("illegal-ack"));
  if (!ack.ok) throw new Error("ack failed");

  const t = tracker.transition(
    command.idempotencyKey,
    "succeeded", // illegal: must go through "executing" first
    makeTimestamp("illegal-trans"),
    undefined,
    undefined,
    command.tenantId,
    command.correlationId,
  );
  expect(t.ok).toBe(false);
  if (!t.ok) {
    expect(t.error.kind).toBe("DomainError");
  }
});

test("D4: transition() records a CommandResult on terminal status with evidence", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "terminal", type: "device.command.lock" });
  tracker.acknowledge(command, makeTimestamp("terminal-ack"));
  tracker.transition(
    command.idempotencyKey,
    "executing",
    makeTimestamp("terminal-executing"),
    undefined,
    undefined,
    command.tenantId,
    command.correlationId,
  );
  const evidence: EvidenceRef[] = [
    { key: "evd/lock-log", sizeBytes: 1024, hash: "abc123", hashAlgorithm: "sha256" },
  ];
  const t = tracker.transition(
    command.idempotencyKey,
    "succeeded",
    makeTimestamp("terminal-succeeded"),
    evidence,
    undefined,
    command.tenantId,
    command.correlationId,
  );
  expect(t.ok).toBe(true);

  const lookup = tracker.lookup(command.tenantId, command.idempotencyKey);
  expect(lookup.result).toBeDefined();
  if (lookup.result) {
    expect(lookup.result.status).toBe("succeeded");
    expect(lookup.result.evidence).toHaveLength(1);
    expect(lookup.result.evidence[0].key).toBe("evd/lock-log");
  }
});

// ---------------------------------------------------------------------------
// recordResult — idempotent replay
// ---------------------------------------------------------------------------

test("D4: recordResult() is idempotent — replay returns the ORIGINAL result", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "rr-idem", type: "device.command.lock" });
  tracker.acknowledge(command, makeTimestamp("rr-ack"));
  tracker.transition(
    command.idempotencyKey,
    "executing",
    makeTimestamp("rr-executing"),
    undefined,
    undefined,
    command.tenantId,
    command.correlationId,
  );

  const first = tracker.recordResult(command.idempotencyKey, {
    commandId: command.id,
    status: "succeeded",
    completedAt: makeTimestamp("rr-first"),
    tenantId: command.tenantId,
    correlationId: command.correlationId,
    evidence: [],
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.replayed).toBe(false);

  // Replay — return the ORIGINAL, NOT a new result.
  const replay = tracker.recordResult(command.idempotencyKey, {
    commandId: command.id,
    status: "succeeded",
    completedAt: makeTimestamp("rr-retry"), // different timestamp
    tenantId: command.tenantId,
    correlationId: command.correlationId,
    evidence: [],
  });
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  expect(replay.replayed).toBe(true);
  expect(replay.result).toBe(first.result); // referential equality
  expect(replay.result.completedAt).toBe(makeTimestamp("rr-first")); // ORIGINAL timestamp preserved
});

test("D4: recordResult() refuses a non-terminal status (DomainError)", () => {
  const tracker = createCommandReceiptTracker();
  const command = makeCommandEnvelope({ seed: "rr-nonterm", type: "device.command.lock" });
  tracker.acknowledge(command, makeTimestamp("rr-nonterm-ack"));

  const r = tracker.recordResult(command.idempotencyKey, {
    commandId: command.id,
    status: "executing", // non-terminal
    completedAt: makeTimestamp("rr-nonterm-executing"),
    tenantId: command.tenantId,
    correlationId: command.correlationId,
    evidence: [],
  });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe("DomainError");
  }
});

test("D4: recordResult() on an unknown key returns a DomainError", () => {
  const tracker = createCommandReceiptTracker();
  const tenantId = makeTenantId("rr-unknown-tenant");
  const r = tracker.recordResult(makeIdempotencyKey("unknown-key"), {
    commandId: makeCommandEnvelope({ seed: "rr-unknown" }).id,
    status: "succeeded",
    completedAt: makeTimestamp("rr-unknown-at"),
    tenantId,
    correlationId: makeCorrelationId("rr-unknown-cor"),
    evidence: [],
  });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.code).toBe(ERROR_CODES.commandUnknown);
  }
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("D4: tenant isolation — a tenant-A lookup cannot observe a tenant-B entry", () => {
  const tracker = createCommandReceiptTracker();
  const tenantA = makeTenantId("iso-tenant-a");
  const tenantB = makeTenantId("iso-tenant-b");
  const cmdA = makeCommandEnvelope({
    seed: "iso-a",
    tenantId: tenantA,
    idempotencyKey: makeIdempotencyKey("shared-key"), // SAME KEY
    type: "device.command.lock",
  });
  const cmdB = makeCommandEnvelope({
    seed: "iso-b",
    tenantId: tenantB,
    idempotencyKey: makeIdempotencyKey("shared-key"), // SAME KEY
    type: "device.command.lock",
  });

  const ackA = tracker.acknowledge(cmdA, makeTimestamp("iso-a-ack"));
  const ackB = tracker.acknowledge(cmdB, makeTimestamp("iso-b-ack"));
  expect(ackA.ok).toBe(true);
  expect(ackB.ok).toBe(true);
  // Both succeed — the SAME idempotency key is scoped by tenantId.

  // Tenant-A lookup finds the tenant-A entry.
  const lookupA = tracker.lookup(tenantA, makeIdempotencyKey("shared-key"));
  expect(lookupA.receipt).toBeDefined();
  if (lookupA.receipt) {
    expect(lookupA.receipt.tenantId).toBe(tenantA);
  }
  // Tenant-B lookup finds the tenant-B entry (different object).
  const lookupB = tracker.lookup(tenantB, makeIdempotencyKey("shared-key"));
  expect(lookupB.receipt).toBeDefined();
  if (lookupB.receipt) {
    expect(lookupB.receipt.tenantId).toBe(tenantB);
  }
});

// ---------------------------------------------------------------------------
// FleetError mapping from agent execution failures
// ---------------------------------------------------------------------------

test("D4: mapAgentFailure maps each failure kind onto the contracts FleetError taxonomy", () => {
  const trace = {
    tenantId: makeTenantId("map-tenant"),
    correlationId: makeCorrelationId("map-cor"),
  };
  const cases: Array<{ kind: AgentExecutionFailureKind; expectedKind: FleetError["kind"]; expectedStatus: number }> = [
    { kind: "malformed_payload", expectedKind: "ValidationError", expectedStatus: 400 },
    { kind: "unauthorized", expectedKind: "AuthorizationError", expectedStatus: 403 },
    { kind: "unsupported_capability", expectedKind: "AdapterError", expectedStatus: 502 },
    { kind: "destructive_unauthorized", expectedKind: "PolicyError", expectedStatus: 422 },
    { kind: "destructive_offline_default_deny", expectedKind: "PolicyError", expectedStatus: 403 },
    { kind: "adapter_internal", expectedKind: "AdapterError", expectedStatus: 502 },
    { kind: "timeout", expectedKind: "DomainError", expectedStatus: 400 },
    { kind: "unknown", expectedKind: "DomainError", expectedStatus: 400 },
  ];
  for (const c of cases) {
    const error = mapAgentFailure(c.kind, `failure: ${c.kind}`, trace, {
      capability: "wipe",
      adapterFamily: "windows",
      deviceId: makeDeviceId("map-device") as string,
    });
    expect(error.kind).toBe(c.expectedKind);
    expect(error.tenantId).toBe(trace.tenantId);
    expect(error.correlationId).toBe(trace.correlationId);
    // The error translates through the frozen contracts toApiError with
    // the expected HTTP status.
    expect(toApiError(error).status).toBe(c.expectedStatus);
  }
});

test("D4: commandDigest is deterministic — same command => same digest", () => {
  const cmd = makeCommandEnvelope({ seed: "digest", type: "device.command.lock" });
  expect(commandDigest(cmd)).toBe(commandDigest(cmd));
});

// ---------------------------------------------------------------------------
// Determinism — the tracker has no entropy; same calls => same state
// ---------------------------------------------------------------------------

test("D4: the tracker is deterministic — same call sequence on two trackers produces the same receipts", () => {
  const cmd = makeCommandEnvelope({ seed: "determ-tracker", type: "device.command.lock" });
  const receivedAt = makeTimestamp("determ-received");

  const a = createCommandReceiptTracker();
  const b = createCommandReceiptTracker();
  const ra = a.acknowledge(cmd, receivedAt);
  const rb = b.acknowledge(cmd, receivedAt);
  if (!ra.ok || !rb.ok) throw new Error("ack failed");
  expect(JSON.stringify(ra.receipt)).toBe(JSON.stringify(rb.receipt));
});
