/**
 * @fleetos/web — the runtime DEMO FLEET composition (W091 [TL]).
 *
 * The Next.js runtime is COMPOSITION ONLY (spec/ui/CONSOLE-DESIGN.md
 * "Data boundary"): authenticate, resolve tenant context, call public
 * application/domain services, shape data for the UI. This module is
 * the binding site that composes the REAL domain packages (in-memory
 * reference implementations, deterministic seed, no I/O, no clock —
 * every instant injected) into the standing data the console renders:
 *
 *   - @fleetos/device-model  — the REAL Device Twin store (3 devices)
 *   - @fleetos/security      — the REAL posture assessment (a CRITICAL
 *                              finding with a remediation PROPOSAL)
 *   - @fleetos/policy        — the REAL Contract Guardian rule set +
 *                              evaluation (REQUIRE_APPROVAL)
 *   - @fleetos/actions       — the REAL W041 plan lifecycle (one PARKED
 *                              plan in the approvals queue; one
 *                              APPROVED plan with execution evidence)
 *   - @fleetos/audit         — the REAL append-only hash-chained audit
 *                              log (the Evidence & Audit area's truth)
 *   - @fleetos/learning      — the REAL W070 closed loop (outcome
 *                              observation, gated evaluation case,
 *                              adoption ledger with supersession)
 *
 * The shell view-models (Control Tower, Evidence, navigation, search)
 * are built HERE from the composed records — the screens stay pure.
 * Deterministic: the same seed yields byte-identical views (asserted
 * by the browser-facing test suite). No business truth in React.
 */
import {
  asCorrelationId,
  asDeviceId,
  asObservationId,
  asTenantId,
  asUserId,
  isValidTenantId,
  makeGuardianDecision,
} from "@fleetos/contracts";
import type { CorrelationId, DeviceId, TenantId, UserId } from "@fleetos/contracts";
import {
  createInMemoryTwinStore,
  createTwin,
  enrollDevice,
  recordTwinObservations,
} from "@fleetos/device-model";
import type { TwinStore } from "@fleetos/device-model";
import { assessSecurityPosture } from "@fleetos/security";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import {
  approveParkedPlan,
  createActionPlan,
  createInMemoryDeviceRegistryView,
  submitActionPlan,
} from "@fleetos/actions";
import { createInMemoryAuditLog } from "@fleetos/audit";
import type { AuditLog, AuditRecord } from "@fleetos/audit";
import {
  convertOutcomeToEvaluationCase,
  createInMemoryLearningAdoptionStore,
  gateEvaluationCaseProposal,
  observeActionPlanOutcome,
  recordCapabilityAdoption,
} from "@fleetos/learning";
import type { ActionPlanFacet, LearningAdoptionRecord } from "@fleetos/learning";

import { buildDeviceListViewModel } from "@fleetos/web-device";
import {
  buildApprovalsQueueView,
  buildFindingsListView,
  buildPoliciesListView,
} from "@fleetos/web-security";
import {
  buildAdoptionLedgerView,
  buildEvaluationCasesView,
  buildOutcomeFeedView,
} from "@fleetos/web-learning";
import {
  buildControlTowerView,
  buildEvidenceIndex,
  buildEvidenceTrail,
} from "@fleetos/web-shell";
import type {
  ControlTowerView,
  EvidenceIndexRow,
  ShellAuditRecordLike,
  ShellBandedSummary,
  ShellEvidenceTrail,
  ShellOperatorRole,
  ShellRecordSummary,
} from "@fleetos/web-shell";
import type { ProductExperienceRole } from "@fleetos/web-product";

// W149 — the executed-decision state derivation (the propagation's pure
// projection over the approval runtime's audit log).
import type { ExecutedDecisionState } from "./executed-decision-state";
import type { ExecutedDecisionRecord } from "./executed-decision-state";
import type { SecurityDecisionAuditRecord } from "@fleetos/web-security";
import { APPROVAL_AUDIT_ACTIONS } from "@fleetos/web-security";

// ---------------------------------------------------------------------------
// The deterministic seed constants (no clock, no entropy)
// ---------------------------------------------------------------------------

export const TENANT_ID: TenantId = asTenantId("tnt_w091demo000001");
export const OPERATOR_ID: UserId = asUserId("usr_w091demoop001");
const T0 = "2026-01-06T09:00:00Z" as const;
const T1 = "2026-01-06T10:00:00Z" as const;
const T2 = "2026-01-06T11:00:00Z" as const;
const T3 = "2026-01-06T12:00:00Z" as const;
const T4 = "2026-01-06T13:00:00Z" as const;
const NOW = "2026-01-06T14:00:00Z" as const;

const DEV_1: DeviceId = asDeviceId("dev_w091demo000001");
const DEV_2: DeviceId = asDeviceId("dev_w091demo000002");
const DEV_3: DeviceId = asDeviceId("dev_w091demo000003");

const CORR_1 = asCorrelationId("cor_w091demo000001");
const CORR_2 = asCorrelationId("cor_w091demo000002");
const CORR_3 = asCorrelationId("cor_w091demo000003");
const CORR_4 = asCorrelationId("cor_w091demo000004");

/** The acting tenant scope (the mandatory first parameter everywhere). */
export const SCOPE = { tenantId: TENANT_ID } as const;

// ---------------------------------------------------------------------------
// W122 — the DEMO TENANT's persona catalog (one per experience role)
// ---------------------------------------------------------------------------

/**
 * The demo workspace's display name (the honest DEMO label every demo
 * session carries in its chrome — the tenant label + the "Demo
 * workspace" badge both render it).
 */
export const DEMO_WORKSPACE_NAME: string = "Demo — FleetOS Workspace";

/**
 * A demo PERSONA seed: a named principal pre-seeded in the dedicated
 * demo tenant, one per frozen experience-role vocabulary entry
 * (ROLE-EXPERIENCE-MATRIX.yaml — the full seven-role total).
 *
 * The personas carry NO passwords (no credential records are ever
 * registered for them): the sanctioned entry is the sign-in screen's
 * one-click DEMO quick link, which opens the persona's session through
 * the SAME session-open seam (product-session.ts — no second auth path).
 */
export interface DemoPersonaSeed {
  /** The stable persona id (the quick-link seam's selector). */
  readonly personaId: string;
  /** The persona's experience role (the frozen matrix vocabulary). */
  readonly role: ProductExperienceRole;
  /** The honest display name ("Demo — <matrix label>"). */
  readonly displayName: string;
  /** The persona's member reference (its principal identity). */
  readonly memberRef: string;
}

/**
 * The demo persona catalog — EXACTLY one persona per experience role
 * (the frozen seven-role vocabulary, matrix order), each an honest
 * "Demo — <label>" principal in the dedicated demo tenant.
 */
export const DEMO_PERSONAS: readonly DemoPersonaSeed[] = Object.freeze([
  {
    personaId: "demo-fleet-admin",
    role: "fleet.admin",
    displayName: "Demo — Fleet Administrator",
    memberRef: "demo.fleet.admin@fleetos.demo",
  },
  {
    personaId: "demo-service-desk",
    role: "service.desk",
    displayName: "Demo — Service Desk",
    memberRef: "demo.service.desk@fleetos.demo",
  },
  {
    personaId: "demo-security-compliance",
    role: "security.compliance",
    displayName: "Demo — Security & Compliance",
    memberRef: "demo.security.compliance@fleetos.demo",
  },
  {
    personaId: "demo-asset-manager",
    role: "asset.manager",
    displayName: "Demo — Asset & Procurement Manager",
    memberRef: "demo.asset.manager@fleetos.demo",
  },
  {
    personaId: "demo-team-manager",
    role: "team.manager",
    displayName: "Demo — Team Manager",
    memberRef: "demo.team.manager@fleetos.demo",
  },
  {
    personaId: "demo-employee",
    role: "employee",
    displayName: "Demo — Employee / Device Owner",
    memberRef: "demo.employee@fleetos.demo",
  },
  {
    personaId: "demo-vendor-operator",
    role: "vendor.operator",
    displayName: "Demo — Vendor / Service Operator",
    memberRef: "demo.vendor.operator@fleetos.demo",
  },
]);

// ---------------------------------------------------------------------------
// The composition (deterministic; identical on every call)
// ---------------------------------------------------------------------------

interface DemoComposition {
  readonly store: TwinStore;
  readonly auditLog: AuditLog;
  /** W122: the raw banded summaries (the tower rebuild's input, per role). */
  readonly bandedSummaries: readonly ShellBandedSummary[];
  /** W122: the audit-like projections (the tower rebuild's recent-audit input). */
  readonly recentAuditLike: readonly ShellAuditRecordLike[];
  readonly towerView: ControlTowerView;
  readonly evidenceIndex: readonly EvidenceIndexRow[];
  readonly evidenceTrails: readonly ShellEvidenceTrail[];
  readonly searchRecords: readonly ShellRecordSummary[];
}

function enrollDeviceInto(
  store: TwinStore,
  input: {
    readonly deviceId: DeviceId;
    readonly serial: string;
    readonly manufacturer: string;
    readonly model: string;
    readonly adapterFamily: string;
    readonly ownerType: "CUSTOMER_OWNED" | "LEASED" | "FLEET_PURCHASED";
    readonly assignedTeam: string;
  },
  observationPayload: Record<string, unknown>,
): void {
  const enrolled = enrollDevice({
    tenantId: TENANT_ID,
    deviceId: input.deviceId,
    adapterFamily: input.adapterFamily,
    hardware: {
      manufacturer: input.manufacturer,
      model: input.model,
      serialNumber: input.serial,
    },
    ownership: { ownerType: input.ownerType, assignedTeam: input.assignedTeam },
    at: T0,
    provenance: { correlationId: CORR_1 },
  });
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error.message}`);
  const created = createTwin({ identity: enrolled.identity, ctx: { at: T0, correlationId: CORR_1 } });
  if (!created.ok) throw new Error(`twin failed: ${created.error.message}`);
  const observed = recordTwinObservations(
    created.twin,
    [
      {
        id: asObservationId(`obs_${input.serial.replace(/-/g, "").toLowerCase()}`),
        kind: "device.security",
        observedAt: T1,
        schemaVersion: 1,
        payload: observationPayload,
      },
    ],
    { at: T1, correlationId: CORR_1 },
  );
  if (!observed.ok) throw new Error(`observations failed: ${observed.error.message}`);
  store.put(observed.twin);
}

function composeDemoFleet(): DemoComposition {
  // 1. The REAL device fleet (three enrolled devices; device 1 carries
  //    the disk-encryption-off observation that yields the CRITICAL finding).
  const store = createInMemoryTwinStore();
  enrollDeviceInto(store, {
    deviceId: DEV_1,
    serial: "W091-DEMO-0001",
    manufacturer: "Lenovo",
    model: "ThinkPad T14",
    adapterFamily: "windows-mdm",
    ownerType: "CUSTOMER_OWNED",
    assignedTeam: "field-ops",
  }, { diskEncryption: false });
  enrollDeviceInto(store, {
    deviceId: DEV_2,
    serial: "W091-DEMO-0002",
    manufacturer: "Apple",
    model: "MacBook Air M3",
    adapterFamily: "macos-mdm",
    ownerType: "CUSTOMER_OWNED",
    assignedTeam: "hq",
  }, { diskEncryption: true });
  enrollDeviceInto(store, {
    deviceId: DEV_3,
    serial: "W091-DEMO-0003",
    manufacturer: "Google",
    model: "Pixel 9",
    adapterFamily: "android-mdm",
    ownerType: "LEASED",
    assignedTeam: "field-ops",
  }, { diskEncryption: true });

  // 2. The REAL security posture assessment on device 1.
  const assessed = assessSecurityPosture({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [
      {
        id: asObservationId("obsw091demo0000010"),
        kind: "device.security",
        observedAt: T1,
        schemaVersion: 1,
        payload: { diskEncryption: false },
      },
    ],
    at: T1,
  });
  if (!assessed.ok) throw new Error(`posture failed: ${assessed.error.message}`);
  const criticalFinding = assessed.posture.findings.find((f) => f.severity === "CRITICAL");
  if (criticalFinding === undefined) throw new Error("demo seed requires a CRITICAL finding");

  // 3. The REAL Contract Guardian rule set + evaluation.
  const rule = defineGuardianRule(TENANT_ID, {
    name: "w091-demo-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
  if (!rule.ok) throw new Error(`rule failed: ${rule.error.message}`);
  const compiled = compileGuardianRuleSet(TENANT_ID, { rules: [rule.rule], version: 1, at: T0 });
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.error.message}`);
  const evaluation = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    { at: T1, correlationId: CORR_2 },
  );
  if (!evaluation.ok) throw new Error(`evaluation failed: ${evaluation.error.message}`);

  // 4. The REAL W041 action plans: one PARKED (queue) + one APPROVED.
  const registry = createInMemoryDeviceRegistryView([
    {
      tenantId: TENANT_ID,
      deviceId: DEV_1,
      lifecycleState: "OBSERVE",
      adapterCapabilities: { identify: true, observe: true, lock: true },
      platform: "windows",
      ownership: "corporate",
    },
  ]);
  const parkedPlan = createActionPlan({
    name: "w091-demo-enable-encryption",
    selector: { kind: "byId", deviceIds: [DEV_1] },
    capability: "lock",
    tenantId: TENANT_ID,
    registry,
    at: T2,
  });
  if (!parkedPlan.ok) throw new Error(`plan failed: ${parkedPlan.error.message}`);
  const submitted = submitActionPlan(parkedPlan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    at: T2,
    correlationId: CORR_2,
  });
  if (!submitted.ok) throw new Error(`submit failed: ${submitted.error.message}`);
  if (submitted.status !== "PARKED") throw new Error(`expected PARKED, got ${submitted.status}`);

  const approvedPlan = createActionPlan({
    name: "w091-demo-lock-lost-device",
    selector: { kind: "byId", deviceIds: [DEV_1] },
    capability: "lock",
    tenantId: TENANT_ID,
    registry,
    at: T2,
  });
  if (!approvedPlan.ok) throw new Error(`plan2 failed: ${approvedPlan.error.message}`);
  const submitted2 = submitActionPlan(approvedPlan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    at: T2,
    correlationId: CORR_3,
  });
  if (!submitted2.ok) throw new Error(`submit2 failed: ${submitted2.error.message}`);
  const approved = approveParkedPlan(submitted2.plan, "approve", {
    at: T3,
    correlationId: CORR_4,
    approverId: OPERATOR_ID,
  });
  if (!approved.ok) throw new Error(`approve failed: ${approved.error.message}`);
  if (approved.status !== "APPROVED") throw new Error(`expected APPROVED, got ${approved.status}`);

  // 5. The REAL append-only audit log (the Evidence & Audit truth).
  const auditLog = createInMemoryAuditLog();
  const ACTOR = { kind: "user" as const, tenantId: TENANT_ID, principalId: OPERATOR_ID };
  const appendedRecords: AuditRecord[] = [];
  const appendDemo = (input: {
    readonly action: string;
    readonly at: string;
    readonly outcome:
      | { readonly status: "success" }
      | { readonly status: "denied"; readonly reasons: readonly string[] };
    readonly correlationId: CorrelationId;
    readonly details?: Readonly<Record<string, unknown>>;
  }): AuditRecord => {
    const record = auditLog.append({ tenantId: TENANT_ID, correlationId: CORR_1 }, {
      tenantId: TENANT_ID,
      actor: ACTOR,
      action: input.action,
      occurredAt: input.at,
      source: "console-runtime.demo",
      outcome: input.outcome,
      correlationId: input.correlationId,
      details: input.details,
    });
    appendedRecords.push(record);
    return record;
  };

  const auditEnroll1 = appendDemo({
    action: "device.enrolled",
    at: T0,
    outcome: { status: "success" },
    correlationId: CORR_1,
    details: { deviceId: DEV_1, serial: "W091-DEMO-0001" },
  });
  const auditPosture = appendDemo({
    action: "security.posture.assessed",
    at: T1,
    outcome: { status: "success" },
    correlationId: CORR_1,
    details: { deviceId: DEV_1, findings: assessed.posture.findings.length },
  });
  const auditParked = appendDemo({
    action: "action.plan.parked",
    at: T2,
    outcome: { status: "denied", reasons: ["guardian_requires_approval"] },
    correlationId: CORR_2,
    details: { planId: submitted.plan.planId, capability: submitted.plan.capability },
  });
  const auditApproved = appendDemo({
    action: "action.plan.approved",
    at: T3,
    outcome: { status: "success" },
    correlationId: CORR_4,
    details: { planId: approved.plan.planId, approverId: OPERATOR_ID },
  });
  const auditExecuted = appendDemo({
    action: "action.plan.dispatched",
    at: T4,
    outcome: { status: "success" },
    correlationId: CORR_4,
    details: { planId: approved.plan.planId, targets: approved.plan.targetCount },
  });

  // 6. The REAL W070 learning closed loop over the approved plan.
  const learningScope = { tenantId: TENANT_ID, correlationId: CORR_4 };
  const approvedFacet: ActionPlanFacet = {
    planId: approved.plan.planId,
    tenantId: TENANT_ID,
    name: approved.plan.name,
    version: 2,
    status: "APPROVED",
    capability: approved.plan.capability,
    selectedTargets: [DEV_1],
    targetCount: approved.plan.targetCount,
    createdAt: T2,
    transitionedAt: T3,
    contentDigest: approved.plan.contentDigest,
    // The dispatched plan's execution evidence (NON-EMPTY: the W070
    // conversion derives the case's observationRefs from the plan's
    // evidence keys — an outcome without observable refs never converts).
    evidence: [
      {
        key: `evidence/w091-demo-${approved.plan.planId}`,
        sizeBytes: 256,
        hash: "w09100000000000000000000000000000000000000000000000000000000",
        hashAlgorithm: "sha256",
      },
    ],
  };
  const observation = observeActionPlanOutcome(learningScope, { plan: approvedFacet }, {
    observedAt: T4,
    correlationId: CORR_4,
  });
  if (!observation.ok) throw new Error(`observation failed: ${observation.error.message}`);
  const conversion = convertOutcomeToEvaluationCase(learningScope, observation.observation, {
    tenantPolicyRefs: ["pol_w091_demo_learning_policy"],
    redaction: { state: "deidentified", appliedPolicies: ["pol_w091_demo_redaction_policy"] },
  });
  if (!conversion.ok) throw new Error(`conversion failed: ${conversion.error.message}`);
  const decision = makeGuardianDecision({
    tenantId: TENANT_ID,
    decision: "REQUIRE_APPROVAL",
    rules: [{ ruleId: rule.rule.ruleId, ruleVersion: rule.rule.version }],
    evidence: [],
    decidedAt: T4,
    schemaVersion: 1,
  });
  const gated = gateEvaluationCaseProposal(learningScope, conversion.draft, decision);
  if (!gated.ok) throw new Error(`gating failed: ${gated.error.message}`);
  const adoptionStore = createInMemoryLearningAdoptionStore();
  const adoptionOne = recordCapabilityAdoption(
    learningScope,
    adoptionStore,
    {
      tenantId: TENANT_ID,
      capabilityId: "cap_w091_demo_lock",
      capabilityVersion: "1.0.0",
      certificationRef: "acr_w091democert0001",
      evaluationSuiteRevision: "suite_w091_demo_rev1",
      fleetOSCompatibilityStatement: "compatible",
      warnings: [],
      capabilityClass: "device.security.remediation",
    },
    { proposalId: "prp_w091demo000001", approverId: OPERATOR_ID, approvedAt: T2, cohort: "fleet-wide", rollbackVersion: "0.9.0" },
    { at: T2, correlationId: CORR_2 },
  );
  if (!adoptionOne.ok) throw new Error(`adoption1 failed: ${adoptionOne.error.message}`);
  const adoptionTwo = recordCapabilityAdoption(
    learningScope,
    adoptionStore,
    {
      tenantId: TENANT_ID,
      capabilityId: "cap_w091_demo_lock",
      capabilityVersion: "1.1.0",
      certificationRef: "acr_w091democert0002",
      evaluationSuiteRevision: "suite_w091_demo_rev1",
      fleetOSCompatibilityStatement: "compatible",
      warnings: [],
      capabilityClass: "device.security.remediation",
    },
    {
      proposalId: "prp_w091demo000002",
      approverId: OPERATOR_ID,
      approvedAt: T3,
      cohort: "fleet-wide",
      rollbackVersion: "1.0.0",
      supersedes: adoptionOne.record.recordId,
    },
    { at: T3, correlationId: CORR_3, rolloutPolicy: { kind: "canary", percentage: 25 } },
  );
  if (!adoptionTwo.ok) throw new Error(`adoption2 failed: ${adoptionTwo.error.message}`);
  const adoptionRecords: readonly LearningAdoptionRecord[] = [adoptionOne.record, adoptionTwo.record];

  // 7. The shell view-models over the composed records (the shaping
  //    layer: banded summaries for the Tower, the search index, the
  //    evidence trails over the REAL audit records).
  const banded: readonly ShellBandedSummary[] = [
    {
      area: "device",
      recordId: DEV_1,
      title: "W091-DEMO-0001 — Lenovo ThinkPad T14",
      keywords: ["w091-demo-0001", "lenovo", "thinkpad", "windows", "corporate", "laptop", "device"],
      band: "high",
      subtitle: "CRITICAL security finding: disk encryption disabled",
    },
    {
      area: "device",
      recordId: DEV_2,
      title: "W091-DEMO-0002 — Apple MacBook Air M3",
      keywords: ["w091-demo-0002", "apple", "macbook", "macos", "corporate", "laptop", "device"],
      band: "ok",
      subtitle: "Healthy — encrypted, current observations",
    },
    {
      area: "device",
      recordId: DEV_3,
      title: "W091-DEMO-0003 — Google Pixel 9",
      keywords: ["w091-demo-0003", "google", "pixel", "android", "leased", "phone", "device"],
      band: "ok",
      subtitle: "Healthy — encrypted, current observations",
    },
    {
      area: "security",
      recordId: criticalFinding.findingId,
      title: `CRITICAL — ${criticalFinding.title}`,
      keywords: ["critical", "security", "finding", "encryption", "disk", "device", "remediation"],
      band: "critical",
      subtitle: "Remediation proposal drafted — approval required",
    },
    {
      area: "actions",
      recordId: submitted.plan.planId,
      title: `Parked plan — ${submitted.plan.name}`,
      keywords: ["plan", "parked", "approval", "lock", "action", "encryption"],
      band: "high",
      subtitle: "Guardian REQUIRE_APPROVAL — awaiting the owner decision",
    },
    {
      area: "actions",
      recordId: approved.plan.planId,
      title: `Approved plan — ${approved.plan.name}`,
      keywords: ["plan", "approved", "executed", "lock", "action", "verified"],
      band: "low",
      subtitle: "Executed and verified — evidence on the audit trail",
    },
    {
      area: "learning",
      recordId: gated.proposal.proposalId,
      title: "Evaluation case — fleet.action.plan outcome",
      keywords: ["learning", "evaluation", "case", "outcome", "adoption", "capability"],
      band: "medium",
      subtitle: "Guardian-gated conversion — deidentified, disposition PARKED",
    },
    {
      area: "policies",
      recordId: compiled.ruleSet.ruleSetId,
      title: "Policy set — require approval for fleet actions",
      keywords: ["policy", "guardian", "rule", "approval", "consequential", "action"],
      band: "neutral",
      subtitle: "1 rule — REQUIRE_APPROVAL on fleet.action.execute",
    },
  ];

  const searchRecords: readonly ShellRecordSummary[] = banded.map((summary) => ({
    area: summary.area,
    recordId: summary.recordId,
    title: summary.title,
    keywords: summary.keywords,
  }));

  const auditLike = (record: AuditRecord): ShellAuditRecordLike & { readonly stage: string } => ({
    recordId: record.id,
    tenantId: TENANT_ID,
    actor: `${record.actor.kind}:${record.actor.principalId}`,
    action: record.action,
    at: record.occurredAt,
    outcome: record.outcome.status,
    correlationId: record.correlationId,
    evidenceRefs: Object.keys(record.details ?? {}).map((key) => `evidence/w091-demo/${record.id}/${key}`),
    stage: record.action,
  });

  const verification = auditLog.verify({ tenantId: TENANT_ID });
  const chainState: "verified" | "tamper_detected" | "unknown" = verification.ok
    ? "verified"
    : "tamper_detected";

  const trailInputs = [
    {
      subjectId: criticalFinding.findingId,
      subjectTitle: `CRITICAL — ${criticalFinding.title}`,
      subjectArea: "security" as const,
      records: [auditPosture, auditParked].map(auditLike),
    },
    {
      subjectId: approved.plan.planId,
      subjectTitle: `Approved plan — ${approved.plan.name}`,
      subjectArea: "actions" as const,
      records: [auditApproved, auditExecuted].map(auditLike),
    },
    {
      subjectId: DEV_1,
      subjectTitle: "W091-DEMO-0001 — Lenovo ThinkPad T14",
      subjectArea: "device" as const,
      records: [auditEnroll1, auditPosture].map(auditLike),
    },
  ];

  const evidenceTrails: readonly ShellEvidenceTrail[] = trailInputs.flatMap((input) => {
    const result = buildEvidenceTrail({ ...input, scope: SCOPE, chainState });
    return result.ok ? [result.trail] : [];
  });
  const evidenceIndexResult = buildEvidenceIndex(
    SCOPE,
    trailInputs.map((input) => ({ ...input, scope: SCOPE, chainState })),
  );
  if (!evidenceIndexResult.ok) throw new Error("evidence index failed");

  const towerResult = buildControlTowerView({
    scope: SCOPE,
    role: "owner",
    summaries: banded,
    recentAudit: appendedRecords.map((record) => {
      const like = auditLike(record);
      return {
        recordId: like.recordId,
        tenantId: like.tenantId,
        actor: like.actor,
        action: like.action,
        at: like.at,
        outcome: like.outcome,
        correlationId: like.correlationId,
        evidenceRefs: like.evidenceRefs,
      };
    }),
    activityLimit: 6,
  });
  if (!towerResult.ok) throw new Error("tower view failed");

  return {
    store,
    auditLog,
    bandedSummaries: banded,
    recentAuditLike: appendedRecords.map(auditLike),
    towerView: towerResult.view,
    evidenceIndex: evidenceIndexResult.rows,
    evidenceTrails,
    searchRecords,
  };
}

/** The composed demo fleet (module-scope singleton; deterministic). */
export const DEMO: DemoComposition = composeDemoFleet();

/** Whether a tenant id is the dedicated demo tenant (W122 isolation law). */
export function isDemoTenant(tenantId: string): boolean {
  return tenantId === TENANT_ID;
}

/**
 * The DEMO tenant's twin store (W145 deploy convergence): the demo
 * workspace's declared-import submissions land HERE — the same store
 * the demo roster view reads, so a declared record is visible in the
 * roster immediately (in-memory, per browser page load).
 */
export function demoTwinStore(): TwinStore {
  return DEMO.store;
}

// ---------------------------------------------------------------------------
// The lane view-models bound over the composed demo fleet
// ---------------------------------------------------------------------------

/** The device fleet roster view (over the REAL TwinStore). */
export function deviceFleetView(): ReturnType<typeof buildDeviceListViewModel> {
  return buildDeviceListViewModel(
    { tenantId: TENANT_ID },
    DEMO.store,
    { filter: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: "all" },
    { now: NOW, freshWithinMs: 86_400_000, staleAfterMs: 604_800_000 },
  );
}

/** The security findings view (over the REAL posture assessment). */
export function securityFindingsView(): ReturnType<typeof buildFindingsListView> {
  const assessed = assessSecurityPosture({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [
      {
        id: asObservationId("obsw091demo0000010"),
        kind: "device.security",
        observedAt: T1,
        schemaVersion: 1,
        payload: { diskEncryption: false },
      },
    ],
    at: T1,
  });
  if (!assessed.ok) throw new Error("posture re-composition failed");
  return buildFindingsListView({ tenantId: TENANT_ID }, assessed.posture.findings);
}

/** The approvals queue view (over the REAL parked plan + evaluation). */
export function approvalsQueueView(): ReturnType<typeof buildApprovalsQueueView> {
  const assessed = assessSecurityPosture({
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    observations: [
      {
        id: asObservationId("obsw091demo0000010"),
        kind: "device.security",
        observedAt: T1,
        schemaVersion: 1,
        payload: { diskEncryption: false },
      },
    ],
    at: T1,
  });
  if (!assessed.ok) throw new Error("posture re-composition failed");
  const rule = defineGuardianRule(TENANT_ID, {
    name: "w091-demo-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
  if (!rule.ok) throw new Error("rule re-composition failed");
  const compiled = compileGuardianRuleSet(TENANT_ID, { rules: [rule.rule], version: 1, at: T0 });
  if (!compiled.ok) throw new Error("compile re-composition failed");
  const evaluation = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    { at: T1, correlationId: CORR_2 },
  );
  if (!evaluation.ok) throw new Error("evaluation re-composition failed");
  const registry = createInMemoryDeviceRegistryView([
    {
      tenantId: TENANT_ID,
      deviceId: DEV_1,
      lifecycleState: "OBSERVE",
      adapterCapabilities: { identify: true, observe: true, lock: true },
      platform: "windows",
      ownership: "corporate",
    },
  ]);
  const plan = createActionPlan({
    name: "w091-demo-enable-encryption",
    selector: { kind: "byId", deviceIds: [DEV_1] },
    capability: "lock",
    tenantId: TENANT_ID,
    registry,
    at: T2,
  });
  if (!plan.ok) throw new Error("plan re-composition failed");
  const submitted = submitActionPlan(plan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    at: T2,
    correlationId: CORR_2,
  });
  if (!submitted.ok) throw new Error("submit re-composition failed");
  return buildApprovalsQueueView({ tenantId: TENANT_ID }, [
    { plan: submitted.plan, evaluation: evaluation.evaluation },
  ]);
}

/** The policies view (over the REAL compiled rule set). */
export function policiesView(): ReturnType<typeof buildPoliciesListView> {
  const rule = defineGuardianRule(TENANT_ID, {
    name: "w091-demo-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
  if (!rule.ok) throw new Error("rule re-composition failed");
  const compiled = compileGuardianRuleSet(TENANT_ID, { rules: [rule.rule], version: 1, at: T0 });
  if (!compiled.ok) throw new Error("compile re-composition failed");
  return buildPoliciesListView({ tenantId: TENANT_ID }, [compiled.ruleSet]);
}

/** The learning views (over the REAL W070 closed loop). */
export function learningViews(): {
  readonly feed: ReturnType<typeof buildOutcomeFeedView>;
  readonly cases: ReturnType<typeof buildEvaluationCasesView>;
  readonly ledger: ReturnType<typeof buildAdoptionLedgerView>;
} {
  const learningScope = { tenantId: TENANT_ID, correlationId: CORR_4 };
  const facet: ActionPlanFacet = {
    planId: "plan_w091_demo_lock_lost",
    tenantId: TENANT_ID,
    name: "w091-demo-lock-lost-device",
    version: 2,
    status: "APPROVED",
    capability: "lock",
    selectedTargets: [DEV_1],
    targetCount: 1,
    createdAt: T2,
    transitionedAt: T3,
    contentDigest: "w091demodigest00000000000000000000000000000000000000001",
    evidence: [
      {
        key: "evidence/w091-demo-plan",
        sizeBytes: 256,
        hash: "w09100000000000000000000000000000000000000000000000000000000",
        hashAlgorithm: "sha256",
      },
    ],
  };
  const observation = observeActionPlanOutcome(learningScope, { plan: facet }, {
    observedAt: T4,
    correlationId: CORR_4,
  });
  if (!observation.ok) throw new Error("observation re-composition failed");
  const conversion = convertOutcomeToEvaluationCase(learningScope, observation.observation, {
    tenantPolicyRefs: ["pol_w091_demo_learning_policy"],
    redaction: { state: "deidentified", appliedPolicies: ["pol_w091_demo_redaction_policy"] },
  });
  if (!conversion.ok) throw new Error("conversion re-composition failed");
  const decision = makeGuardianDecision({
    tenantId: TENANT_ID,
    decision: "REQUIRE_APPROVAL",
    rules: [{ ruleId: "pol_w091_demo_rule_1" as never, ruleVersion: 1 }],
    evidence: [],
    decidedAt: T4,
    schemaVersion: 1,
  });
  const gated = gateEvaluationCaseProposal(learningScope, conversion.draft, decision);
  if (!gated.ok) throw new Error("gating re-composition failed");
  const adoptionStore = createInMemoryLearningAdoptionStore();
  const first = recordCapabilityAdoption(
    learningScope,
    adoptionStore,
    {
      tenantId: TENANT_ID,
      capabilityId: "cap_w091_demo_lock",
      capabilityVersion: "1.0.0",
      certificationRef: "acr_w091democert0001",
      evaluationSuiteRevision: "suite_w091_demo_rev1",
      fleetOSCompatibilityStatement: "compatible",
      warnings: [],
      capabilityClass: "device.security.remediation",
    },
    { proposalId: "prp_w091demo000001", approverId: OPERATOR_ID, approvedAt: T2, cohort: "fleet-wide", rollbackVersion: "0.9.0" },
    { at: T2, correlationId: CORR_2 },
  );
  if (!first.ok) throw new Error("adoption re-composition failed");
  const second = recordCapabilityAdoption(
    learningScope,
    adoptionStore,
    {
      tenantId: TENANT_ID,
      capabilityId: "cap_w091_demo_lock",
      capabilityVersion: "1.1.0",
      certificationRef: "acr_w091democert0002",
      evaluationSuiteRevision: "suite_w091_demo_rev1",
      fleetOSCompatibilityStatement: "compatible",
      warnings: [],
      capabilityClass: "device.security.remediation",
    },
    {
      proposalId: "prp_w091demo000002",
      approverId: OPERATOR_ID,
      approvedAt: T3,
      cohort: "fleet-wide",
      rollbackVersion: "1.0.0",
      supersedes: first.record.recordId,
    },
    { at: T3, correlationId: CORR_3, rolloutPolicy: { kind: "canary", percentage: 25 } },
  );
  if (!second.ok) throw new Error("adoption re-composition failed");
  return {
    feed: buildOutcomeFeedView({ tenantId: TENANT_ID }, [observation.observation]),
    cases: buildEvaluationCasesView({ tenantId: TENANT_ID }, [gated.proposal]),
    ledger: buildAdoptionLedgerView({ tenantId: TENANT_ID }, [first.record, second.record]),
  };
}

// ---------------------------------------------------------------------------
// W122 — THE ISOLATION LAW: the tenant-scoped console composition
// ---------------------------------------------------------------------------

/**
 * The per-tenant console data composition (every console area's records):
 *
 *   - the DEMO tenant sees the rich demo fleet (the W091 composition);
 *   - EVERY non-demo workspace sees ONLY its own records — the same REAL
 *     lane builders over that tenant's (today empty) record sets, so a
 *     fresh workspace renders honest empty states in every area, and NO
 *     demo record, fixture or tenant id ever resolves in a non-demo
 *     workspace (fail-closed — never a silent fallback to demo data).
 */
export interface ConsoleAreaComposition {
  /** Whether the active session's tenant is the dedicated demo tenant. */
  readonly isDemo: boolean;
  /** The active session's tenant (the composition's scope). */
  readonly tenantId: string;
  readonly towerView: ControlTowerView;
  readonly evidenceIndex: readonly EvidenceIndexRow[];
  readonly evidenceTrails: readonly ShellEvidenceTrail[];
  readonly searchRecords: readonly ShellRecordSummary[];
  readonly fleetView: ReturnType<typeof buildDeviceListViewModel>;
  readonly findingsView: ReturnType<typeof buildFindingsListView>;
  readonly approvalsView: ReturnType<typeof buildApprovalsQueueView>;
  readonly policiesView: ReturnType<typeof buildPoliciesListView>;
  readonly learning: {
    readonly feed: ReturnType<typeof buildOutcomeFeedView>;
    readonly cases: ReturnType<typeof buildEvaluationCasesView>;
    readonly ledger: ReturnType<typeof buildAdoptionLedgerView>;
  };
}

/** The fail-closed composition result (machine-stable refusals). */
export type ConsoleAreasResult =
  | { readonly ok: true; readonly view: ConsoleAreaComposition }
  | {
      readonly ok: false;
      readonly reason: "invalid_tenant" | "composition_refused";
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// W149 — the executed-decision evidence-trail propagation
// ---------------------------------------------------------------------------

/**
 * The machine-stable stage labels for the executed-decision audit
 * entries (the evidence trail's per-step stage vocabulary).
 */
const EXECUTED_DECISION_STAGE_LABELS = Object.freeze({
  explicitConfirmation: "explicit_confirmation",
  dispatched: "decision_dispatched",
} as const);

/**
 * Project a `SecurityDecisionAuditRecord` into the shell's audit-record
 * shape (with the stage label the evidence trail expects). PURE — the
 * projection derives the actor + outcome from the entry's own details;
 * nothing is fabricated. The record id is deterministic (a stable
 * function of the entry's action + subject + occurredAt + a per-entry
 * counter — the same audit log always produces the same trail).
 */
function projectExecutedDecisionAuditRecord(
  entry: SecurityDecisionAuditRecord,
  index: number,
): ShellAuditRecordLike & { readonly stage: string } {
  const details = entry.details ?? {};
  const byRaw = details["by"];
  const by = typeof byRaw === "string" ? byRaw : "operator";
  const actor = `operator:${by}`;
  // The outcome label — the boundary's own status on dispatched entries
  // (APPROVED / REJECTED); "ok" on the explicit-confirmation entry
  // (the human gate's outcome — never a fabricated status).
  const statusRaw = details["status"];
  const outcome = typeof statusRaw === "string" ? statusRaw : "ok";
  // The deterministic record id (machine-stable across re-dispatches).
  const recordId = `audit_w149_${entry.subject ?? "decision"}_${index}`;
  const stage =
    entry.action === APPROVAL_AUDIT_ACTIONS.dispatched
      ? EXECUTED_DECISION_STAGE_LABELS.dispatched
      : entry.action === APPROVAL_AUDIT_ACTIONS.explicitConfirmation
        ? EXECUTED_DECISION_STAGE_LABELS.explicitConfirmation
        : entry.action;
  return Object.freeze({
    recordId,
    tenantId: entry.tenantId,
    actor,
    action: entry.action,
    at: entry.occurredAt,
    outcome,
    correlationId: entry.correlationId,
    evidenceRefs: Object.freeze([]) as readonly string[],
    stage,
  });
}

/**
 * The human title for an executed-decision evidence trail (the
 * propagation's per-plan trail subject). PURE.
 */
function executedDecisionTrailTitle(record: ExecutedDecisionRecord): string {
  const action = record.action === "approve" ? "Approved" : "Rejected";
  return `Executed decision — ${action} ${record.planId}`;
}

/**
 * W149 — append the executed decision's audit entries as a NEW evidence
 * trail per decided planId. The seeded `baseTrails` stay; the executed
 * decision's trail appends — the O6 expectation met live. PURE — the
 * propagation is a function of the runtime's own audit log; nothing is
 * fabricated.
 *
 * The evidence index is rebuilt over the combined trails (the seeded
 * trails + the new executed-decision trails) so the index rows reflect
 * the executed decision's trail summary. The build is fail-closed: a
 * malformed audit entry refuses the whole trail (never partial data);
 * the seeded trails always survive.
 */
function appendExecutedDecisionEvidenceTrails(
  baseTrails: readonly ShellEvidenceTrail[],
  executedDecisions: ExecutedDecisionState | undefined,
): {
  readonly evidenceTrails: readonly ShellEvidenceTrail[];
  readonly evidenceIndex: readonly EvidenceIndexRow[];
} {
  if (executedDecisions === undefined || executedDecisions.decidedPlanIds.length === 0) {
    // No executed decisions: the seeded trails + the seeded index (the
    // W148 baseline — the honest unchanged state).
    return { evidenceTrails: baseTrails, evidenceIndex: rebuildEvidenceIndex(baseTrails) };
  }

  // Group the audit entries by planId (the trail subject). The audit
  // log is chronological; the per-plan grouping preserves the order.
  const entriesByPlan = new Map<string, SecurityDecisionAuditRecord[]>();
  for (const entry of executedDecisions.auditEntries) {
    if (entry === null || typeof entry !== "object") continue;
    const planId = typeof entry.subject === "string" ? entry.subject : null;
    if (planId === null) continue;
    const prior = entriesByPlan.get(planId);
    if (prior === undefined) {
      entriesByPlan.set(planId, [entry]);
    } else {
      prior.push(entry);
    }
  }

  // Build a NEW evidence trail per decided planId (the 2-entry trail
  // per decision: the explicit confirmation + the routed dispatch).
  const newTrails: ShellEvidenceTrail[] = [];
  for (const planId of executedDecisions.decidedPlanIds) {
    const record = executedDecisions.recordsByPlan[planId];
    if (record === undefined) continue;
    const entries = entriesByPlan.get(planId) ?? [];
    if (entries.length === 0) continue;
    const records = entries.map((entry, index) =>
      projectExecutedDecisionAuditRecord(entry, index),
    );
    const trailResult = buildEvidenceTrail({
      scope: SCOPE,
      subjectId: planId,
      subjectTitle: executedDecisionTrailTitle(record),
      subjectArea: "actions",
      records,
      chainState: "verified",
    });
    if (trailResult.ok) {
      newTrails.push(trailResult.trail);
    }
    // A malformed trail refuses machine-stably — the seeded trails
    // always survive (never partial data).
  }

  // The combined trails: the seeded trails + the new executed-decision
  // trails. Deterministic order: the seeded trails first (their
  // machine-stable order), then the executed-decision trails in the
  // decided-plan-ids order (the audit log's chronological order).
  const combinedTrails: readonly ShellEvidenceTrail[] = Object.freeze([
    ...baseTrails,
    ...newTrails,
  ]) as readonly ShellEvidenceTrail[];

  return {
    evidenceTrails: combinedTrails,
    evidenceIndex: rebuildEvidenceIndex(combinedTrails),
  };
}

/**
 * Rebuild the Evidence & Audit index over a list of complete trails.
 * Used by the W149 propagation to include the executed-decision trails
 * in the index. PURE — the index is a function of the trails' step
 * summaries; nothing is fabricated. A malformed trail's row is dropped
 * (never partial data — the seeded trails always survive).
 */
function rebuildEvidenceIndex(
  trails: readonly ShellEvidenceTrail[],
): readonly EvidenceIndexRow[] {
  const rows: EvidenceIndexRow[] = [];
  for (const trail of trails) {
    if (trail.steps.length === 0) continue;
    rows.push({
      subjectId: trail.subjectId,
      subjectTitle: trail.subjectTitle,
      area: trail.area,
      stepCount: trail.steps.length,
      firstAt: trail.steps[0]!.at,
      lastAt: trail.steps[trail.steps.length - 1]!.at,
      chainState: trail.chainState,
    });
  }
  rows.sort((a, b) => {
    if (a.area !== b.area) return a.area < b.area ? -1 : 1;
    return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
  });
  return Object.freeze(rows) as readonly EvidenceIndexRow[];
}

/**
 * Compose the console areas for the ACTIVE session's tenant.
 *
 * The demo tenant resolves the rich demo fleet (role-shaped through the
 * REAL tower builder over the frozen demo summaries); every other
 * workspace resolves ONLY its own records over the same REAL builders
 * with empty record sets — the honest fresh-workspace state, never demo
 * data. An unknown/invalid tenant grammar is a machine-stable refusal
 * (fail-closed; never a fallback to the demo tenant).
 *
 * W149 — when `executedDecisions` is supplied, the demo tenant's
 * Evidence & Audit area APPENDS the executed decision's audit entries
 * as a new evidence trail per decided planId (the 2-entry trail per
 * decision: the explicit confirmation + the routed dispatch). The
 * seeded 3 trails stay; the executed decision's trail appears as a 4th
 * (or Nth) trail — the O6 expectation met live. PURE — the propagation
 * is a function of the runtime's own audit log; nothing is fabricated.
 */
export function composeConsoleAreas(
  tenantId: string,
  role: ShellOperatorRole,
  ownStore?: TwinStore,
  executedDecisions?: ExecutedDecisionState,
): ConsoleAreasResult {
  if (typeof tenantId !== "string" || !isValidTenantId(asTenantId(tenantId))) {
    return {
      ok: false,
      reason: "invalid_tenant",
      message: `composeConsoleAreas: '${String(tenantId)}' does not match the frozen tenant grammar`,
    };
  }
  if (isDemoTenant(tenantId)) {
    // The demo tenant: the rich demo fleet, shaped for the acting role.
    const tower = buildControlTowerView({
      scope: SCOPE,
      role,
      summaries: DEMO.bandedSummaries,
      recentAudit: DEMO.recentAuditLike,
      activityLimit: 6,
    });
    if (!tower.ok) {
      return {
        ok: false,
        reason: "composition_refused",
        message: `composeConsoleAreas: the demo tower view refused (${tower.reason})`,
      };
    }
    // W149 — propagate the executed decision's audit entries into the
    // Evidence & Audit area. Each decided planId gets a NEW evidence
    // trail (the 2-entry trail per decision: the explicit confirmation
    // + the routed dispatch). The seeded 3 trails stay; the executed
    // decision's trail appends — the O6 expectation met live.
    const propagated = appendExecutedDecisionEvidenceTrails(
      DEMO.evidenceTrails,
      executedDecisions,
    );
    return {
      ok: true,
      view: {
        isDemo: true,
        tenantId,
        towerView: tower.view,
        evidenceIndex: propagated.evidenceIndex,
        evidenceTrails: propagated.evidenceTrails,
        searchRecords: DEMO.searchRecords,
        fleetView: deviceFleetView(),
        findingsView: securityFindingsView(),
        approvalsView: approvalsQueueView(),
        policiesView: policiesView(),
        learning: learningViews(),
      },
    };
  }
  // Every NON-DEMO workspace: ONLY its own records (the same REAL
  // builders; a fresh workspace has none yet — honest empty states).
  const scope = { tenantId: asTenantId(tenantId) };
  const tower = buildControlTowerView({
    scope,
    role,
    summaries: [],
    recentAudit: [],
    activityLimit: 6,
  });
  if (!tower.ok) {
    return {
      ok: false,
      reason: "composition_refused",
      message: `composeConsoleAreas: the empty tower view refused (${tower.reason})`,
    };
  }
  const evidenceIndexResult = buildEvidenceIndex(scope, []);
  if (!evidenceIndexResult.ok) {
    return {
      ok: false,
      reason: "composition_refused",
      message: "composeConsoleAreas: the empty evidence index refused",
    };
  }
  // W144/W145 deploy convergence: the session-scoped store (where the
  // workspace's DECLARED records live) — injected by the console runtime;
  // a bare composition call (tests) still gets a fresh empty store.
  const sessionStore = ownStore ?? createInMemoryTwinStore();
  return {
    ok: true,
    view: {
      isDemo: false,
      tenantId,
      towerView: tower.view,
      evidenceIndex: evidenceIndexResult.rows,
      evidenceTrails: [],
      searchRecords: [],
      fleetView: buildDeviceListViewModel(
        scope,
        sessionStore,
        { filter: { kind: "all" }, sort: { field: "deviceId", direction: "asc" }, page: "all" },
        { now: NOW, freshWithinMs: 86_400_000, staleAfterMs: 604_800_000 },
      ),
      findingsView: buildFindingsListView(scope, []),
      approvalsView: buildApprovalsQueueView(scope, []),
      policiesView: buildPoliciesListView(scope, []),
      learning: {
        feed: buildOutcomeFeedView(scope, []),
        cases: buildEvaluationCasesView(scope, []),
        ledger: buildAdoptionLedgerView(scope, []),
      },
    },
  };
}
