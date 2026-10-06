/**
 * @fleetos/world-context — D5: the proposal-gate law tests.
 *
 * Per the W155 work order: "the proposal-gate law: ALLOW→PROPOSED,
 * WARN→PROPOSED, REQUIRE_APPROVAL→PARKED, BLOCK→REJECTED (all four
 * machine-tested); the bridge NEVER submits (no submit path exists —
 * machine-tested)".
 *
 * Proven by this test:
 *   - the FROZEN `GuardianDecision` seam gates the proposal's
 *     disposition: ALLOW → PROPOSED, WARN → PROPOSED,
 *     REQUIRE_APPROVAL → PARKED, BLOCK → REJECTED (all four
 *     machine-tested);
 *   - the `decisionToDisposition` pure helper is the structural twin of
 *     the W070 `decisionToDisposition` (same frozen decision types, same
 *     semantics);
 *   - the bridge NEVER submits — there is NO `submit` function in the
 *     public surface (machine-tested: the BRIDGE_PUBLIC_FUNCTIONS
 *     constant asserts NO name matches `/submit/i`).
 */

import { test, expect } from "bun:test";
import {
  DEV_1,
  PRODUCED_AT,
  SCOPE,
  TENANT_ID,
  makeDecision,
  makeSyntheticCounterfactual,
  makeSyntheticPrediction,
  resetSyntheticCounter,
} from "./helpers";
import {
  BRIDGE_PUBLIC_FUNCTIONS,
  PROPOSAL_PARKED,
  PROPOSAL_PROPOSED,
  PROPOSAL_REJECTED,
  decisionToDisposition,
  convertPredictionToEvaluationProposal,
} from "../src/index";

// ---------------------------------------------------------------------------
// The proposal-gate law (the W070 `decisionToDisposition` twin)
// ---------------------------------------------------------------------------

test("D2/proposal-gate: ALLOW -> PROPOSED (the case may be submitted)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.proposal.disposition).toBe(PROPOSAL_PROPOSED);
  expect(r.proposal.guardianDecision.decision).toBe("ALLOW");
});

test("D2/proposal-gate: WARN -> PROPOSED (non-blocking; warnings carried verbatim in the frozen decision)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("WARN"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.proposal.disposition).toBe(PROPOSAL_PROPOSED);
  expect(r.proposal.guardianDecision.decision).toBe("WARN");
});

test("D2/proposal-gate: REQUIRE_APPROVAL -> PARKED (held for human review; never auto-submitted)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("REQUIRE_APPROVAL"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.proposal.disposition).toBe(PROPOSAL_PARKED);
  expect(r.proposal.guardianDecision.decision).toBe("REQUIRE_APPROVAL");
});

test("D2/proposal-gate: BLOCK -> REJECTED (refused with the Guardian's machine-stable reasons)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("BLOCK"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.proposal.disposition).toBe(PROPOSAL_REJECTED);
  expect(r.proposal.guardianDecision.decision).toBe("BLOCK");
});

// ---------------------------------------------------------------------------
// The proposal-gate law applies EQUALLY to counterfactuals (the
// counterfactual's hypothetical marker survives the gate — the gate
// does NOT strip the marker)
// ---------------------------------------------------------------------------

test("D2/proposal-gate: the gate applies EQUALLY to counterfactuals (the hypothetical marker survives the gate — ALLOW -> PROPOSED + hypothetical: true)", () => {
  resetSyntheticCounter();
  const counterfactual = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, counterfactual, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("ALLOW"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.proposal.disposition).toBe(PROPOSAL_PROPOSED);
  expect(r.proposal.hypothetical).toBe(true); // the marker survived the gate
});

test("D2/proposal-gate: BLOCK on a counterfactual -> REJECTED + hypothetical: true (the marker survives a REJECTED gate)", () => {
  resetSyntheticCounter();
  const counterfactual = makeSyntheticCounterfactual({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  const r = convertPredictionToEvaluationProposal(SCOPE, counterfactual, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: makeDecision("BLOCK"),
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.proposal.disposition).toBe(PROPOSAL_REJECTED);
  expect(r.proposal.hypothetical).toBe(true); // the marker survived the gate
});

// ---------------------------------------------------------------------------
// The `decisionToDisposition` pure helper (the W070 twin)
// ---------------------------------------------------------------------------

test("D2/proposal-gate: the `decisionToDisposition` pure helper mirrors the W070 mapping", () => {
  expect(decisionToDisposition("ALLOW")).toBe(PROPOSAL_PROPOSED);
  expect(decisionToDisposition("WARN")).toBe(PROPOSAL_PROPOSED);
  expect(decisionToDisposition("REQUIRE_APPROVAL")).toBe(PROPOSAL_PARKED);
  expect(decisionToDisposition("BLOCK")).toBe(PROPOSAL_REJECTED);
});

// ---------------------------------------------------------------------------
// The bridge NEVER submits (no submit path exists — machine-tested)
// ---------------------------------------------------------------------------

test("D2/proposal-gate: the bridge NEVER submits — NO function name in the public surface matches `/submit/i` (machine-tested)", () => {
  // The BRIDGE_PUBLIC_FUNCTIONS constant enumerates every public
  // function exposed by the bridge module. Assert NO name matches
  // `/submit/i` — the bridge NEVER submits (the W070 arena adapter
  // owns the submission ledger; the W155 bridge produces the proposal
  // SHAPE, never the submission action).
  const names = [...BRIDGE_PUBLIC_FUNCTIONS];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    expect(name).not.toMatch(/submit/i);
  }
});

test("D2/proposal-gate: the W155 lane's PUBLIC API exposes NO function whose name matches `/submit/i` (machine-tested across the WHOLE module surface)", async () => {
  // The W155 lane's PUBLIC API (the index.ts re-exports) is the W070
  // arena adapter's CONSUMER surface. Assert NO exported function name
  // matches `/submit/i` — the lane NEVER submits.
  const mod = await import("../src/index");
  const exportedNames = Object.keys(mod).filter(
    (k) => typeof (mod as Record<string, unknown>)[k] === "function",
  );
  expect(exportedNames.length).toBeGreaterThan(0);
  for (const name of exportedNames) {
    expect(name).not.toMatch(/submit/i);
  }
});

test("D2/proposal-gate: the proposal CARRIES the FROZEN GuardianDecision VERBATIM (the policy evidence trail — ARCHITECTURE-LOCK item 4)", () => {
  resetSyntheticCounter();
  const prediction = makeSyntheticPrediction({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    producedAt: PRODUCED_AT,
  });
  // A decision with rules + evidence (the W031 engine's full output).
  const decision = makeDecision("ALLOW");
  const r = convertPredictionToEvaluationProposal(SCOPE, prediction, {
    tenantPolicyRefs: ["policy:predicate-1"],
    redaction: { state: "deidentified", appliedPolicies: [] },
    guardianDecision: decision,
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  // The decision is carried VERBATIM (the proposal's `guardianDecision`
  // field is the SAME frozen record — same tenantId, same decision type,
  // same rules, same evidence, same decidedAt, same schemaVersion).
  expect(r.proposal.guardianDecision).toEqual(decision);
  expect(r.proposal.guardianDecision).toBe(decision); // SAME frozen reference
});
