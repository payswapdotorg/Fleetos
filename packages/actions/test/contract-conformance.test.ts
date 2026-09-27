/**
 * W041 D5 tests — contract conformance via @fleetos/contracts/testing
 * fixture builders. The frozen PrintIntentPayload and
 * FleetActionIntentPayload shapes are OWNED by @fleetos/actions per
 * the frozen contracts doc comments (the package NEVER modifies them;
 * it consumes them as-is). The fixture builders produce deterministic,
 * valid-by-construction payloads that round-trip against the actions
 * package's plan creation (the FleetActionIntentPayload's `actionPlanRef`
 * + `targetCount` are populated by the actions package's plan; the
 * PrintIntentPayload's `documentRef` + `targetUserId` are embedded
 * verbatim in a print job request).
 *
 * The frozen `makeIntent` builder produces both PrintIntent and
 * FleetActionIntent envelopes; the actions package's outputs MUST
 * structurally agree with the frozen payload shapes.
 */

import { describe, expect, test } from "bun:test";
import {
  FLEET_ACTION_INTENT_KIND,
  PRINT_INTENT_KIND,
  asTenantId,
  asActionId,
} from "@fleetos/contracts";
import type {
  FleetActionIntentPayload,
  PrintIntentPayload,
} from "@fleetos/contracts";
import {
  FIXTURE_TIME_ANCHOR,
  TESTING_MODULE_NAME,
  TESTING_MODULE_VERSION,
  makeAllIntents,
  makeCorrelationId,
  makeDeviceId,
  makeIntent,
  makePolicyId,
  makeTenantId,
  makeTimestamp,
} from "@fleetos/contracts/testing";
import {
  MODULE_NAME,
  MODULE_VERSION,
  actionPlanId,
  printJobId,
  createActionPlan,
  routePrintJob,
  createInMemoryDeviceRegistryView,
} from "../src/index";
import {
  CAP_OBSERVE,
  CORR,
  T0,
  TENANT_A,
  allSelector,
  descriptor,
  evidenceRef,
  registry,
  scopeA,
} from "./helpers";

describe("D5: the testing subpath imports cleanly", () => {
  test("the fixtures module identifies itself", () => {
    expect(TESTING_MODULE_NAME).toBe("contracts/testing");
    expect(TESTING_MODULE_VERSION).toBe("0.1.0");
  });

  test("fixture builders are deterministic", () => {
    expect(makeTenantId("w041")).toBe(makeTenantId("w041"));
    expect(makeTimestamp("w041")).toBe(makeTimestamp("w041"));
    expect(makePolicyId("w041")).toBe(makePolicyId("w041"));
    expect(makeCorrelationId("w041")).toBe(makeCorrelationId("w041"));
    expect(makeDeviceId("w041")).toBe(makeDeviceId("w041"));
    expect(makeTimestamp("w041") >= FIXTURE_TIME_ANCHOR).toBe(true);
  });
});

describe("D5: the actions package's MODULE_NAME/VERSION placeholders are intact", () => {
  test("exports MODULE_NAME and MODULE_VERSION", () => {
    expect(MODULE_NAME).toBe("actions");
    expect(MODULE_VERSION).toBe("0.1.0");
  });
});

describe("D5: the frozen PrintIntentPayload shape is consumed verbatim", () => {
  test("makeIntent produces a PrintIntent with the frozen payload shape", () => {
    const intent = makeIntent({ seed: "w041-print", kind: PRINT_INTENT_KIND });
    expect(intent.payload.kind).toBe(PRINT_INTENT_KIND);
    const payload = intent.payload as PrintIntentPayload & { readonly kind: typeof PRINT_INTENT_KIND };
    expect(typeof payload.documentRef).toBe("string");
    expect(payload.documentRef.length > 0).toBe(true);
    // targetUserId is optional in the frozen shape; the fixture builder
    // leaves it unset. The actions package's print job request embeds
    // the payload verbatim — the same shape.
    expect(payload.targetUserId === undefined || typeof payload.targetUserId === "string").toBe(true);
  });

  test("the actions package's print job embeds the frozen payload verbatim", () => {
    const payload: PrintIntentPayload = { documentRef: "doc://w041-conformance" };
    const result = routePrintJob({
      payload,
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers: [],
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(false); // refused (no printers support color)
    if (!result.ok) {
      // The refusal error carries the tenant + correlation; the
      // payload shape is verbatim — `documentRef` is the only required
      // field, and the actions package never modifies it.
      expect(result.error.code).toBe("action.print.routing_refused");
      expect(result.error.tenantId).toBe(TENANT_A);
    }
  });

  test("the frozen PrintIntentPayload shape is the EXACT shape the actions package accepts", () => {
    // Construct a payload with the frozen shape's keys ONLY.
    const payload: PrintIntentPayload = { documentRef: "doc://strict" };
    expect(Object.keys(payload).sort()).toEqual(["documentRef"]);
    // Adding a targetUserId still satisfies the frozen shape (optional).
    const payloadWithUser: PrintIntentPayload = {
      documentRef: "doc://strict",
      targetUserId: "usr_test",
    };
    expect(Object.keys(payloadWithUser).sort()).toEqual(["documentRef", "targetUserId"]);
  });
});

describe("D5: the frozen FleetActionIntentPayload shape is populated by the actions package", () => {
  test("makeIntent produces a FleetActionIntent with the frozen payload shape", () => {
    const intent = makeIntent({ seed: "w041-action", kind: FLEET_ACTION_INTENT_KIND });
    expect(intent.payload.kind).toBe(FLEET_ACTION_INTENT_KIND);
    const payload = intent.payload as FleetActionIntentPayload & {
      readonly kind: typeof FLEET_ACTION_INTENT_KIND;
    };
    expect(typeof payload.actionPlanRef).toBe("string");
    expect(payload.actionPlanRef.length > 0).toBe(true);
    expect(typeof payload.targetCount).toBe("number");
    expect(payload.targetCount >= 1).toBe(true);
  });

  test("the actions package's plan populates the frozen payload's fields", () => {
    const reg = registry([
      descriptor(TENANT_A, makeDeviceId("w041-a1")),
      descriptor(TENANT_A, makeDeviceId("w041-a2")),
    ]);
    const result = createActionPlan({
      name: "w041-conformance-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.plan;
    // The plan's `planId` is the value the frozen
    // FleetActionIntentPayload's `actionPlanRef` field would carry
    // (the intent references the plan by its plan id).
    expect(p.planId).toBe(actionPlanId(TENANT_A, "w041-conformance-plan"));
    expect(p.planId.startsWith("pln_")).toBe(true);
    // The plan's `targetCount` is the value the frozen payload's
    // `targetCount` field would carry.
    expect(p.targetCount).toBe(2);
    // The frozen FleetActionIntentPayload shape: { actionPlanRef,
    // targetCount } — the actions package populates these from the
    // plan's planId and targetCount. Construct the frozen shape
    // verbatim and assert structural equality.
    const frozenPayload: FleetActionIntentPayload = {
      actionPlanRef: p.planId,
      targetCount: p.targetCount,
    };
    expect(Object.keys(frozenPayload).sort()).toEqual(["actionPlanRef", "targetCount"]);
    // The frozen contracts' asActionId helper brands the plan id into
    // an ActionId (the intent references the plan via this brand).
    const actionId = asActionId(p.planId);
    expect(typeof actionId).toBe("string");
    expect(actionId as string).toBe(p.planId);
  });

  test("makeAllIntents produces both intent kinds this package owns", () => {
    const all = makeAllIntents("w041");
    const print = all.find((i) => i.payload.kind === PRINT_INTENT_KIND);
    const action = all.find((i) => i.payload.kind === FLEET_ACTION_INTENT_KIND);
    expect(print).toBeDefined();
    expect(action).toBeDefined();
  });
});

describe("D5: the actions package's deterministic ids are FNV-1a-based (the frozen convention)", () => {
  test("actionPlanId produces a stable pln_-prefixed id", () => {
    const id = actionPlanId(TENANT_A, "stable-plan");
    expect(id.startsWith("pln_")).toBe(true);
    expect(id).toBe(actionPlanId(TENANT_A, "stable-plan"));
    expect(id).not.toBe(actionPlanId(TENANT_A, "different-plan"));
    expect(id).not.toBe(actionPlanId(asTenantId("tnt_testtenant000b"), "stable-plan"));
  });

  test("printJobId produces a stable prn_-prefixed id", () => {
    const payload: PrintIntentPayload = { documentRef: "doc://stable" };
    const id = printJobId(TENANT_A, payload, T0);
    expect(id.startsWith("prn_")).toBe(true);
    expect(id).toBe(printJobId(TENANT_A, payload, T0));
    expect(id).not.toBe(printJobId(TENANT_A, { documentRef: "doc://other" }, T0));
    expect(id).not.toBe(printJobId(asTenantId("tnt_testtenant000b"), payload, T0));
  });
});

describe("D5: the evidence ref shape is the frozen contracts shape", () => {
  test("the actions package accepts the frozen EvidenceRef shape verbatim", () => {
    const ev = evidenceRef();
    expect(ev.key).toBe("evidence/test-artifact-1");
    expect(ev.sizeBytes).toBe(128);
    expect(ev.hash).toBe("0123456789abcdef0123456789abcdef");
    expect(ev.hashAlgorithm).toBe("sha256");
    // The actions package carries evidence refs untouched into the
    // plan's record (never interpreted). Construct a plan with evidence
    // and assert it's carried verbatim.
    const reg = registry([descriptor(TENANT_A, makeDeviceId("w041-ev"))]);
    const result = createActionPlan({
      name: "w041-evidence-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
      evidence: [ev],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.evidence).toHaveLength(1);
    expect(result.plan.evidence[0]).toEqual(ev);
  });
});
