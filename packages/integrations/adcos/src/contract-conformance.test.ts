/**
 * @fleetos/integration-adcos — D5: contract-conformance tests via the
 * frozen @fleetos/contracts/testing fixture builders.
 *
 * Consumed builders: makeIntent (the ConnectivityIntent payload shapes,
 * including the frozen default `connected-<seed>` outcome), makeAllIntents,
 * makeTenantId, makeDeviceId, makeTimestamp, makeIntentId,
 * makeCorrelationId, makeCausationId, makeGuardianDecision,
 * makeAllGuardianDecisions, FIXTURE_TIME_ANCHOR. Frozen helpers
 * exercised: CONNECTIVITY_INTENT_KIND, isBlockingDecision,
 * validateTenantRef, asTenantId, asCorrelationId, toApiError.
 */

import { test, expect } from "bun:test";
import {
  CONNECTIVITY_INTENT_KIND,
  isBlockingDecision,
  validateTenantRef,
  asCorrelationId,
  toApiError,
} from "@fleetos/contracts";
import type { FleetIntent } from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  makeAllGuardianDecisions,
  makeAllIntents,
  makeCausationId,
  makeCorrelationId,
  makeDeviceId,
  makeGuardianDecision,
  makeIntent,
  makeIntentId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import { translateConnectivityIntent } from "./translation";
import { submitConnectivityIntent } from "./submission-gate";
import { createInMemorySubmissionStore } from "./submission";
import { createInMemoryConnectivityRecordStore } from "./adoption";
import { createInMemoryAdcosTransport } from "./inmemory-transport";
import { createInMemoryAdcosAuditSink } from "./audit-seam";
import type { LocalRuleSet } from "./test-support";
import { localGuardian } from "./test-support";

/** Requirements matching the secure-private profile. */
function securePrivateProfile(): {
  properties: { isolation: "private"; redundancy: "path_redundant"; availabilityTarget: number };
  constraints: { requiredZones: string[]; forbiddenZones: string[]; egressAllowed: boolean };
  duration: { startAt: string; endAt: string };
  security: { encryption: "required"; privateRouting: boolean; complianceRefs: string[] };
} {
  return {
    properties: { isolation: "private", redundancy: "path_redundant", availabilityTarget: 0.999 },
    constraints: { requiredZones: ["corporate"], forbiddenZones: ["public"], egressAllowed: false },
    duration: { startAt: FIXTURE_TIME_ANCHOR, endAt: makeTimestamp("conformance-end") },
    security: { encryption: "required", privateRouting: true, complianceRefs: ["soc2"] },
  };
}

test("makeIntent builds the frozen ConnectivityIntent envelope; the canonical outcome translates", () => {
  const intent = makeIntent({
    seed: "w050a-conformance",
    kind: CONNECTIVITY_INTENT_KIND,
    payload: {
      sourceDeviceId: makeDeviceId("w050a-src") as string,
      targetDeviceId: makeDeviceId("w050a-tgt") as string,
      outcome: "secure private connectivity",
    },
  });
  // The fixture is one arm of the frozen FleetIntent union.
  expect(intent.payload.kind).toBe(CONNECTIVITY_INTENT_KIND);
  const result = translateConnectivityIntent(
    intent,
    securePrivateProfile(),
    makeCorrelationId("w050a-corr"),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.request.outcome.canonical).toBe("secure_private_connectivity");
    expect(result.request.tenantId).toBe(intent.tenantId);
    expect(result.request.intentRef.intentId).toBe(intent.intentId);
    expect(result.request.intentRef.createdAt).toBe(intent.createdAt);
    expect(validateTenantRef(result.request.tenantId).ok).toBe(true);
  }
});

test("the frozen fixture's DEFAULT connectivity outcome (connected-<seed>) is refused unsupported_outcome — never a guess", () => {
  const intent = makeIntent({ seed: 42, kind: CONNECTIVITY_INTENT_KIND });
  if (intent.payload.kind !== CONNECTIVITY_INTENT_KIND) throw new Error("fixture kind mismatch");
  expect(intent.payload.outcome).toBe("connected-42");
  const result = translateConnectivityIntent(intent, securePrivateProfile(), makeCorrelationId("w050a-corr"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const error = result.error;
    if (error.kind !== "ValidationError") throw new Error(`expected ValidationError, got ${error.kind}`);
    expect(error.failures.some((f) => f.reason === "unsupported_outcome")).toBe(true);
  }
});

test("makeAllIntents: exactly one arm is the ConnectivityIntent; the others are refused wrong_intent_kind", () => {
  const intents = makeAllIntents("w050a");
  expect(intents.length).toBe(9);
  const connectivityArms = intents.filter((i) => i.payload.kind === CONNECTIVITY_INTENT_KIND);
  expect(connectivityArms.length).toBe(1);
  for (const intent of intents) {
    const result = translateConnectivityIntent(
      intent,
      securePrivateProfile(),
      makeCorrelationId("w050a-corr"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.error;
      if (error.kind !== "ValidationError") throw new Error(`expected ValidationError, got ${error.kind}`);
      const wrongKind = error.failures.some((f) => f.reason === "wrong_intent_kind");
      if (intent.payload.kind === CONNECTIVITY_INTENT_KIND) {
        // The default payload outcome is not canonical -> unsupported, but
        // never wrong_intent_kind.
        expect(wrongKind).toBe(false);
      } else {
        expect(wrongKind).toBe(true);
      }
    }
  }
});

test("makeGuardianDecision + makeAllGuardianDecisions: the frozen decision shapes flow into submission revisions", () => {
  const decisions = makeAllGuardianDecisions("w050a");
  expect(decisions.length).toBe(4);
  const decisionTypes = decisions.map((d) => d.decision).sort();
  expect(decisionTypes).toEqual(["ALLOW", "BLOCK", "REQUIRE_APPROVAL", "WARN"]);

  // A fixture-built BLOCK decision rides the REJECTED revision verbatim.
  const blockDecision = makeGuardianDecision({
    tenantId: makeTenantId("w050a"),
    decision: "BLOCK",
    rules: [],
    evidence: [],
    decidedAt: makeTimestamp("w050a-block"),
    schemaVersion: 1,
  });
  const fixtureRuleSet: LocalRuleSet = { tenantId: blockDecision.tenantId, decision: "BLOCK" };
  const intent = makeIntent({
    seed: "w050a-block",
    kind: CONNECTIVITY_INTENT_KIND,
    tenantId: blockDecision.tenantId,
    payload: {
      sourceDeviceId: makeDeviceId("w050a-src") as string,
      outcome: "secure private connectivity",
    },
  });
  const transport = createInMemoryAdcosTransport();
  const result = submitConnectivityIntent(
    { tenantId: blockDecision.tenantId, correlationId: makeCorrelationId("w050a-corr") },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    intent,
    securePrivateProfile(),
    {
      at: FIXTURE_TIME_ANCHOR,
      correlationId: makeCorrelationId("w050a-corr"),
      ruleSet: fixtureRuleSet,
      evaluator: localGuardian,
      transport,
      auditSink: createInMemoryAdcosAuditSink(),
    },
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.record.status).toBe("REJECTED");
    expect(transport.submissions.length).toBe(0); // BLOCK never dispatches
  }
});

test("the frozen isBlockingDecision helper drives the gate semantics (WARN submits, REQUIRE_APPROVAL/BLOCK hold)", () => {
  expect(isBlockingDecision("ALLOW")).toBe(false);
  expect(isBlockingDecision("WARN")).toBe(false);
  expect(isBlockingDecision("REQUIRE_APPROVAL")).toBe(true);
  expect(isBlockingDecision("BLOCK")).toBe(true);
});

test("fixture id builders produce valid traceability refs through the full submit flow", () => {
  const tenantId = makeTenantId("w050a-conformance");
  const intentId = makeIntentId("w050a-conformance");
  const correlationId = makeCorrelationId("w050a-conformance");
  const causationId = makeCausationId("w050a-conformance");
  const createdAt = makeTimestamp("w050a-conformance");

  const intent = makeIntent({
    seed: "w050a-conformance",
    kind: CONNECTIVITY_INTENT_KIND,
    tenantId,
    intentId,
    createdAt,
    payload: {
      sourceDeviceId: makeDeviceId("w050a-src") as string,
      outcome: "resilient connectivity",
    },
  });
  const resilientProfile = {
    ...securePrivateProfile(),
    properties: { isolation: "any" as const, redundancy: "device_redundant" as const },
    security: { encryption: "not_required" as const, privateRouting: false, complianceRefs: [] },
  };
  const result = submitConnectivityIntent(
    { tenantId, correlationId },
    createInMemorySubmissionStore(),
    createInMemoryConnectivityRecordStore(),
    intent,
    resilientProfile,
    {
      at: FIXTURE_TIME_ANCHOR,
      correlationId,
      causationId,
      ruleSet: { tenantId, decision: "ALLOW" },
      evaluator: localGuardian,
      transport: createInMemoryAdcosTransport(),
      auditSink: createInMemoryAdcosAuditSink(),
    },
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.record.request.intentRef.intentId).toBe(intentId);
    expect(result.record.request.intentRef.createdAt).toBe(createdAt);
    expect(result.record.status).toBe("SUBMITTED");
  }
});

test("a translation refusal maps onto the frozen ApiError wire shape via toApiError", () => {
  const intent = makeIntent({ seed: 7, kind: CONNECTIVITY_INTENT_KIND });
  const result = translateConnectivityIntent(intent, securePrivateProfile(), asCorrelationId("cor_w050a_probe1"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const apiError = toApiError(result.error);
    expect(apiError.code).toBe("adcos.translation.refused");
    expect(typeof apiError.message).toBe("string");
    expect(typeof apiError.status === "number" && apiError.status > 0).toBe(true);
  }
});

test("the fixture intents satisfy the frozen FleetIntent union (type-level conformance)", () => {
  const intents: FleetIntent[] = makeAllIntents("w050a-union");
  expect(intents.length).toBe(9);
  // The ConnectivityIntent arm's payload shape is exactly the frozen
  // (sourceDeviceId?, targetDeviceId?, outcome) + the kind discriminant.
  const arm = intents.find((i) => i.payload.kind === CONNECTIVITY_INTENT_KIND);
  expect(arm).toBeDefined();
  if (arm !== undefined) {
    const payload = arm.payload as {
      sourceDeviceId?: string;
      targetDeviceId?: string;
      outcome: string;
      kind: string;
    };
    expect(typeof payload.outcome).toBe("string");
    expect(payload.kind).toBe("ConnectivityIntent");
  }
});
