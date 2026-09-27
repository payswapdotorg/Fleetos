/**
 * W041 D5 tests — the actions audit seam: emission policy (consequential
 * plan / print-job transitions audit; pure reads and failed mutations
 * never do) and the structural compatibility with W012's audit primitives
 * — `createAuditSinkAdapter` over an in-memory `AuditLog` satisfies
 * `ActionAuditSink` with ZERO glue and lands the records in the tenant-
 * scoped, hash-chained, append-only trail. The chain verifies.
 *
 * NOTE: `@fleetos/audit` is imported HERE (test scope) only — src/ never
 * imports it (the ownership gate forbids cross-lane src imports; the
 * gate scans src/ only). This mirrors the W022/W031-disclosed pattern
 * and is the proof that the seam is structurally satisfied by W012's
 * adapter.
 */

import { describe, expect, test } from "bun:test";
import {
  createAuditSinkAdapter,
  createInMemoryAuditLog,
  fnv1a32Hex,
  verifyAuditChain,
} from "@fleetos/audit";
import type { AuditSink } from "@fleetos/audit";
import { ALLOW, BLOCK, REQUIRE_APPROVAL } from "@fleetos/contracts";
import { asDeviceId } from "@fleetos/contracts";
import type { GuardianRequestContext } from "@fleetos/policy";
import {
  ACTION_AUDIT_ACTIONS,
  NOOP_ACTION_AUDIT_SINK,
  createActionPlan,
  createInMemoryActionAuditSink,
  createInMemoryActionStore,
  createInMemoryPrintStore,
  enqueuePrintJob,
  routePrintJob,
  submitActionPlan,
  approveParkedPlan,
  type ActionAuditSink,
} from "../src/index";
import {
  CAP_OBSERVE,
  CAP_WIPE,
  CORR,
  CORR_2,
  T0,
  T1,
  TENANT_A,
  TENANT_B,
  actionCondition,
  allSelector,
  descriptor,
  printer,
  registry,
  rule,
  ruleSet,
  scopeA,
  scopeB,
} from "./helpers";

const routedCondition = { kind: "action" as const, actions: { in: ["fleet.action.execute"] } };

describe("D5: ActionAuditSink emission policy > consequential mutations", () => {
  test("a plan creation emits action.plan.created", () => {
    const sink = createInMemoryActionAuditSink();
    const store = createInMemoryActionStore({ auditSink: sink });
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_audit_01"))]);
    const plan = createActionPlan({
      name: "audit-create-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    store.appendPlan(scopeA(), plan.plan);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0];
    expect(record?.action).toBe(ACTION_AUDIT_ACTIONS.planCreated);
    expect(record?.tenantId).toBe(TENANT_A);
    expect(record?.subject).toBe(plan.plan.planId);
    expect(record?.occurredAt).toBe(T0);
    expect(record?.correlationId).toBe(CORR);
    const details = record?.details as {
      planId: string;
      name: string;
      capability: string;
      targetCount: number;
      status: string;
      contentDigest: string;
    };
    expect(details.planId).toBe(plan.plan.planId);
    expect(details.name).toBe("audit-create-plan");
    expect(details.capability).toBe("observe");
    expect(details.targetCount).toBe(1);
    expect(details.status).toBe("PROPOSAL");
    expect(typeof details.contentDigest).toBe("string");
  });

  test("a plan submission emits action.plan.submitted with the Guardian decision", () => {
    const sink = createInMemoryActionAuditSink();
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_audit_02"))]);
    const plan = createActionPlan({
      name: "audit-submit-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rs = ruleSet(TENANT_A, [
      rule(TENANT_A, {
        name: "audit-allow-rule",
        condition: routedCondition,
        effect: ALLOW,
        at: T0,
      }),
    ]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const result = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0];
    expect(record?.action).toBe(ACTION_AUDIT_ACTIONS.planSubmitted);
    expect(record?.occurredAt).toBe(T1);
    expect(record?.correlationId).toBe(CORR);
    const details = record?.details as { decision: string; status: string };
    expect(details.decision).toBe("ALLOW");
    expect(details.status).toBe("ADVANCED");
  });

  test("a BLOCK submission emits with the matched rule ids", () => {
    const sink = createInMemoryActionAuditSink();
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_audit_03"))]);
    const plan = createActionPlan({
      name: "audit-block-plan",
      selector: allSelector,
      capability: CAP_WIPE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const blockRule = rule(TENANT_A, {
      name: "audit-block-rule",
      condition: routedCondition,
      effect: BLOCK,
      at: T0,
    });
    const rs = ruleSet(TENANT_A, [blockRule]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const result = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("REJECTED");
    expect(sink.records.length).toBe(1);
    const details = sink.records[0]?.details as {
      decision: string;
      matchedRuleIds: string[];
      isBlocking: boolean;
    };
    expect(details.decision).toBe("BLOCK");
    expect(details.matchedRuleIds).toEqual([blockRule.ruleId as string]);
    expect(details.isBlocking).toBe(true);
  });

  test("a parked-plan approval emits action.plan.approved", () => {
    const sink = createInMemoryActionAuditSink();
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_audit_04"))]);
    const plan = createActionPlan({
      name: "audit-approve-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rs = ruleSet(TENANT_A, [
      rule(TENANT_A, {
        name: "audit-park-rule",
        condition: routedCondition,
        effect: REQUIRE_APPROVAL,
        at: T0,
      }),
    ]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const parked = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(parked.ok).toBe(true);
    if (!parked.ok) return;
    expect(parked.status).toBe("PARKED");
    // The approval step:
    const approved = approveParkedPlan(parked.plan, "approve", {
      at: "2026-03-01T00:00:00Z",
      correlationId: CORR_2,
      approverId: "usr_manager_01",
      auditSink: sink,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.status).toBe("APPROVED");
    // The sink has TWO records: the submission (PARKED) + the approval.
    expect(sink.records.length).toBe(2);
    const approvalRecord = sink.records[1];
    expect(approvalRecord?.action).toBe(ACTION_AUDIT_ACTIONS.planApproved);
    expect(approvalRecord?.occurredAt).toBe("2026-03-01T00:00:00Z");
    expect(approvalRecord?.correlationId).toBe(CORR_2);
    const details = approvalRecord?.details as {
      decision: string;
      approverId: string;
      status: string;
    };
    expect(details.decision).toBe("approve");
    expect(details.approverId).toBe("usr_manager_01");
    expect(details.status).toBe("APPROVED");
  });
});

describe("D5: ActionAuditSink emission policy > print job routing", () => {
  test("a successful routing emits action.print.job.routed", () => {
    const sink = createInMemoryActionAuditSink();
    const printers = [printer(TENANT_A, "prn_audit_01", { capabilities: { color: true } })];
    const result = routePrintJob({
      payload: { documentRef: "doc://audit-route" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0];
    expect(record?.action).toBe(ACTION_AUDIT_ACTIONS.printJobRouted);
    expect(record?.subject).toBe(result.ok ? result.job.jobId : "");
    expect(record?.tenantId).toBe(TENANT_A);
    const details = record?.details as {
      printerId: string;
      status: string;
      queuePosition: number;
      supportingPrinterCount: number;
    };
    expect(details.printerId).toBe("prn_audit_01");
    expect(details.status).toBe("ROUTED");
    expect(details.queuePosition).toBe(1);
    expect(details.supportingPrinterCount).toBe(1);
  });

  test("a refused routing emits action.print.job.routed with the REFUSED status", () => {
    const sink = createInMemoryActionAuditSink();
    const printers = [printer(TENANT_A, "prn_audit_02", { capabilities: { color: false } })];
    const result = routePrintJob({
      payload: { documentRef: "doc://audit-refuse" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(false);
    expect(sink.records.length).toBe(1);
    const record = sink.records[0];
    expect(record?.action).toBe(ACTION_AUDIT_ACTIONS.printJobRouted);
    const details = record?.details as {
      status: string;
      unsupportedFeatures: string[];
      printerCount: number;
    };
    expect(details.status).toBe("REFUSED");
    expect(details.unsupportedFeatures).toEqual(["color"]);
    expect(details.printerCount).toBe(1);
  });

  test("a queue enqueue emits action.print.job.queued", () => {
    const sink = createInMemoryActionAuditSink();
    const printers = [printer(TENANT_A, "prn_audit_03", { capabilities: { color: true } })];
    const routed = routePrintJob({
      payload: { documentRef: "doc://audit-queue" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const enq = enqueuePrintJob(routed.job, {
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(enq.ok).toBe(true);
    if (!enq.ok) return;
    // Two records: routed + queued.
    expect(sink.records.length).toBe(2);
    const queuedRecord = sink.records[1];
    expect(queuedRecord?.action).toBe(ACTION_AUDIT_ACTIONS.printJobQueued);
    const details = queuedRecord?.details as {
      jobId: string;
      printerId: string;
      queuePosition: number;
      depth: number;
    };
    expect(details.printerId).toBe("prn_audit_03");
    expect(details.queuePosition).toBe(1);
    expect(details.depth).toBe(1);
  });

  test("no sink injected -> no emission, the domain output is unchanged", () => {
    const printers = [printer(TENANT_A, "prn_audit_04", { capabilities: { color: true } })];
    const result = routePrintJob({
      payload: { documentRef: "doc://no-sink" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
    });
    expect(result.ok).toBe(true);
    // The noop sink is exported (defensive in depth).
    expect(typeof NOOP_ACTION_AUDIT_SINK.append).toBe("function");
  });
});

describe("D5: structural compatibility with W012's audit primitives", () => {
  test("the W012 sink adapter satisfies ActionAuditSink structurally (no glue)", () => {
    const log = createInMemoryAuditLog();
    const adapter: AuditSink = createAuditSinkAdapter(log, { source: "actions.test" });
    const sink: ActionAuditSink = adapter; // the structural assignment
    expect(typeof sink.append).toBe("function");
    // Route a print job through the adapter sink — the emission lands
    // in the W012 hash-chained AuditLog.
    const printers = [printer(TENANT_A, "prn_compat_01", { capabilities: { color: true } })];
    const result = routePrintJob({
      payload: { documentRef: "doc://compat" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(result.ok).toBe(true);
    const records = log.records({ tenantId: TENANT_A });
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record?.action).toBe("action.print.job.routed");
    expect(record?.source).toBe("actions.test");
    expect(record?.correlationId).toBe(CORR);
    expect((record?.details as { subject: string }).subject).toBe(result.ok ? result.job.jobId : "");
    expect((record?.details as { printerId: string }).printerId).toBe("prn_compat_01");
  });

  test("the full W012 pattern end-to-end: actions -> adapter -> hash-chained AuditLog, chain verifies", () => {
    const log = createInMemoryAuditLog();
    const sink: ActionAuditSink = createAuditSinkAdapter(log, { source: "actions" });
    // Route two jobs and approve one plan through the adapter sink —
    // three emissions into the hash-chained AuditLog.
    const printers = [printer(TENANT_A, "prn_chain_01", { capabilities: { color: true } })];
    const routed1 = routePrintJob({
      payload: { documentRef: "doc://chain-1" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    const routed2 = routePrintJob({
      payload: { documentRef: "doc://chain-2" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T1,
      correlationId: CORR_2,
      auditSink: sink,
    });
    expect(routed1.ok && routed2.ok).toBe(true);

    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_chain_plan"))]);
    const plan = createActionPlan({
      name: "chain-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rs = ruleSet(TENANT_A, [
      rule(TENANT_A, {
        name: "chain-block-rule",
        condition: routedCondition,
        effect: BLOCK,
        at: T0,
      }),
    ]);
    const request: GuardianRequestContext = {
      tenantId: TENANT_A,
      action: { action: "fleet.action.execute" },
    };
    const submission = submitActionPlan(plan.plan, {
      ruleSet: rs,
      request,
      at: T1,
      correlationId: CORR,
      auditSink: sink,
    });
    expect(submission.ok).toBe(true);

    const records = log.records({ tenantId: TENANT_A });
    expect(records.length).toBe(3); // routed1 + routed2 + submission(BLOCK)
    expect(records.map((x) => x.action)).toEqual([
      "action.print.job.routed",
      "action.print.job.routed",
      "action.plan.submitted",
    ]);
    const verification = log.verify({ tenantId: TENANT_A });
    expect(verification.ok).toBe(true);
    expect(verifyAuditChain(records, fnv1a32Hex).ok).toBe(true);
    expect(records.map((x) => x.sequence)).toEqual([1, 2, 3]);
  });

  test("per-tenant chains stay separate through the adapter", () => {
    const log = createInMemoryAuditLog();
    const sink: ActionAuditSink = createAuditSinkAdapter(log, { source: "actions" });
    // Route a job for tenant A and a job for tenant B.
    const printersA = [printer(TENANT_A, "prn_chain_a", { capabilities: { color: true } })];
    const printersB = [printer(TENANT_B, "prn_chain_b", { capabilities: { color: true } })];
    routePrintJob({
      payload: { documentRef: "doc://chain-a" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers: printersA,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    routePrintJob({
      payload: { documentRef: "doc://chain-b" },
      requiredFeatures: { color: true },
      tenantId: TENANT_B,
      printers: printersB,
      at: T0,
      correlationId: CORR,
      auditSink: sink,
    });
    const recordsA = log.records({ tenantId: TENANT_A });
    const recordsB = log.records({ tenantId: TENANT_B });
    expect(recordsA.length).toBe(1);
    expect(recordsB.length).toBe(1);
    expect(recordsA[0]?.action).toBe("action.print.job.routed");
    expect(recordsB[0]?.action).toBe("action.print.job.routed");
    expect(log.verify({ tenantId: TENANT_A }).ok).toBe(true);
    expect(log.verify({ tenantId: TENANT_B }).ok).toBe(true);
  });

  test("the action store routes its planCreated emissions through the adapter sink", () => {
    const log = createInMemoryAuditLog();
    const sink: ActionAuditSink = createAuditSinkAdapter(log, { source: "actions.store" });
    const store = createInMemoryActionStore({ auditSink: sink });
    const reg = registry([descriptor(TENANT_A, asDeviceId("dev_store_compat_01"))]);
    const plan = createActionPlan({
      name: "store-compat-plan",
      selector: allSelector,
      capability: CAP_OBSERVE,
      tenantId: TENANT_A,
      registry: reg,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    store.appendPlan(scopeA(), plan.plan);
    const records = log.records({ tenantId: TENANT_A });
    expect(records.length).toBe(1);
    expect(records[0]?.action).toBe("action.plan.created");
    expect(records[0]?.source).toBe("actions.store");
    expect(log.verify({ tenantId: TENANT_A }).ok).toBe(true);
  });

  test("the print store does NOT emit on append (the routing module emits the consequential records)", () => {
    const log = createInMemoryAuditLog();
    const sink: ActionAuditSink = createAuditSinkAdapter(log, { source: "actions.print.store" });
    const store = createInMemoryPrintStore({ auditSink: sink });
    const printers = [printer(TENANT_A, "prn_store_compat", { capabilities: { color: true } })];
    const routed = routePrintJob({
      payload: { documentRef: "doc://store-compat" },
      requiredFeatures: { color: true },
      tenantId: TENANT_A,
      printers,
      at: T0,
      correlationId: CORR,
      // Note: we pass NO sink to routePrintJob here — we want to test
      // that the store's appendJob does NOT itself emit (the routing
      // module is the emission owner).
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    store.appendJob(scopeA(), routed.job);
    // No records emitted (the store's audit sink is plumbed but unused).
    expect(log.records({ tenantId: TENANT_A }).length).toBe(0);
  });
});
