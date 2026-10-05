/**
 * @fleetos/web — W144: the runtime LANE FEEDS composition.
 *
 * The composition site that binds the six lanes' deep views (Device
 * Doctor, Recovery cases, Security Doctor walk, Fleet Actions plans,
 * Workloads planning, Commerce procurement) into the console runtime
 * OVER the W141/W142/W143 composition functions. Each lane's
 * `compose*Feed` is called with REAL runtime state — the same REAL
 * domain packages the lane compositions' machine tests bind — never
 * fabricated data.
 *
 * The DEMO tenant resolves the rich demo fleet (the Security Doctor's
 * finding-to-evidence walk + the Fleet Actions' parked/approved plans);
 * the lanes whose domain packages are not in apps/web's dependency
 * closure (the Device Doctor's @fleetos/health, the Recovery cases'
 * @fleetos/recovery, the Workloads' @fleetos/workloads, the
 * Procurement's @fleetos/procurement) compose the honest `empty`
 * state over the lane packages' structural seam types — REAL runtime
 * state (empty record sets), never fabricated data. Every non-demo
 * workspace resolves ONLY its own records over the same REAL builders
 * with empty record sets — the honest fresh-workspace state.
 *
 * Doctrine (frozen):
 *   - REAL RUNTIME STATE ONLY: every value derives from the REAL
 *     domain packages available at the composition root
 *     (`@fleetos/device-model`, `@fleetos/security`, `@fleetos/policy`,
 *     `@fleetos/actions`) and the lane composition functions. Nothing
 *     is fabricated.
 *   - TENANT ISOLATION: every source is tenant-partitioned; a
 *     non-demo tenant never observes the demo tenant's records, and
 *     vice versa (the W122 isolation law).
 *   - A RECOMMENDATION IS NEVER AN EXECUTED ACTION: the feeds'
 *     gating/disposition context only ever DESCRIBE records; this
 *     module performs, proposes and dispatches NOTHING.
 *   - Fail-closed: a refused scope grammar yields the deterministic
 *     blocked/empty phase — never data.
 *   - No new runtime dependencies: only the packages already in
 *     apps/web/package.json are imported (the hard constraint).
 *
 * PURE + DETERMINISTIC: no clock (the instant is injected), no I/O, no
 * `any` in public signatures. Strict TS.
 */

import {
  asCorrelationId,
  asDeviceId,
  asObservationId,
  asTenantId,
  asUserId,
  makeGuardianDecision,
} from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  GuardianDecision,
  TenantId,
  UserId,
} from "@fleetos/contracts";

// The REAL domain packages available in apps/web's dependency closure.
import { assessSecurityPosture } from "@fleetos/security";
import {
  compileGuardianRuleSet,
  defineGuardianRule,
  evaluateGuardianRequest,
} from "@fleetos/policy";
import {
  createActionPlan,
  createInMemoryDeviceRegistryView,
  submitActionPlan,
  approveParkedPlan,
} from "@fleetos/actions";

// The lane composition functions + the structural seam types (the
// W141/W142/W143 feeds — the lane packages are frozen, never modified).
import {
  composeDeviceDoctorFeed,
} from "@fleetos/web-device";
import type {
  DeviceDoctorFeed,
  DeviceDoctorRuntimeState,
  DeviceTwinSource,
  DoctorSources,
  DeviceObservationSource,
  RemediationRequestSource,
} from "@fleetos/web-device";
import {
  composeRecoveryCasesFeed,
  composeFindMyDeviceFeed,
  composeDestructiveActionsFeed,
} from "@fleetos/web-recovery";
import type {
  RecoveryCasesFeed,
  FindMyDeviceFeed,
  DestructiveActionsFeed,
  RecoveryRuntimeState,
  RecoveryCaseSource,
  DestructiveRequestSource,
  FindMyDeviceSource,
  DestructiveCapabilitySource,
  StatusMachineTable,
} from "@fleetos/web-recovery";
import {
  composeSecurityDoctorFeed,
} from "@fleetos/web-security";
import type {
  SecurityDoctorFeed,
  SecurityDoctorRuntimeState,
  SecurityFindingSource,
  SecurityFindingRecord,
  SecurityEvaluationSource,
  GuardianEvaluationRecord,
  SecurityApprovalSource,
  ParkedApprovalItemInput,
  SecurityDecisionPlanSource,
  DecisionPlanState,
  SecurityVerificationSource,
  VerificationRecord,
  SecurityRemediationRequestSource,
  SecurityRemediationRequestLike,
} from "@fleetos/web-security";
import {
  composeFleetActionsFeed,
  composePrintDistributionFeed,
} from "@fleetos/web-actions";
import type {
  FleetActionsFeed,
  FleetActionsRuntimeState,
  ActionPlanSource,
  PlanDecisionSource,
  FleetActionVerificationSource,
  FleetActionVerificationRecord,
  PrintDistributionFeed,
  PrintDistributionRuntimeState,
  PrintDistributionSource,
  SurfaceActionPlanRecord,
  GuardianDecisionRecord,
} from "@fleetos/web-actions";
import {
  composeWorkloadPlanningFeed,
} from "@fleetos/web-workloads";
import type {
  WorkloadPlanningFeed,
  WorkloadPlanningRuntimeState,
  WorkloadProfileSource,
  WorkloadRecommendationSource,
  WorkloadResourceSource,
} from "@fleetos/web-workloads";
import {
  composeProcurementCasesFeed,
} from "@fleetos/web-commerce";
import type {
  ProcurementCasesFeed,
  ProcurementRuntimeState,
  ProcurementDemandSource,
  ProcurementMatchSource,
  ProcurementQuoteSource,
  ProcurementOrderSource,
  VendorSource,
} from "@fleetos/web-commerce";

// The demo composition (the W091 fleet + the demo tenant id).
import {
  TENANT_ID,
  OPERATOR_ID,
  SCOPE,
  DEMO,
  isDemoTenant,
} from "./demo-fleet";

// ---------------------------------------------------------------------------
// The deterministic seed constants (mirrors demo-fleet.ts; no clock, no entropy)
// ---------------------------------------------------------------------------

const T0 = "2026-01-06T09:00:00Z" as const;
const T1 = "2026-01-06T10:00:00Z" as const;
const T2 = "2026-01-06T11:00:00Z" as const;
const T3 = "2026-01-06T12:00:00Z" as const;
const T4 = "2026-01-06T13:00:00Z" as const;

const DEV_1: DeviceId = asDeviceId("dev_w091demo000001");
const CORR_1 = asCorrelationId("cor_w091demo000001");
const CORR_2 = asCorrelationId("cor_w091demo000002");
const CORR_3 = asCorrelationId("cor_w091demo000003");
const CORR_4 = asCorrelationId("cor_w091demo000004");

// ---------------------------------------------------------------------------
// The frozen transition tables (injected into the recovery feeds)
// ---------------------------------------------------------------------------

/**
 * The REAL recovery-case transition table (the W040 domain's frozen
 * states). The table is constructed at the binding site from the
 * domain constants; the recovery lane's composition function consumes
 * it as a `StatusMachineTable` (structural seam).
 */
const REAL_CASE_TABLE: StatusMachineTable = Object.freeze({
  transitions: Object.freeze({
    OPEN: Object.freeze(["INVESTIGATING", "SECURED", "RECOVERED", "ESCALATED", "CLOSED"]),
    INVESTIGATING: Object.freeze(["SECURED", "RECOVERED", "ESCALATED", "CLOSED"]),
    SECURED: Object.freeze(["RECOVERED", "ESCALATED", "CLOSED"]),
    RECOVERED: Object.freeze([]),
    ESCALATED: Object.freeze([]),
    CLOSED: Object.freeze([]),
  }) as Readonly<Record<string, readonly string[]>>,
  terminal: Object.freeze(["RECOVERED", "ESCALATED", "CLOSED"]),
  active: Object.freeze(["OPEN", "INVESTIGATING", "SECURED"]),
});

/** The REAL destructive-request transition table. */
const REAL_REQUEST_TABLE: StatusMachineTable = Object.freeze({
  transitions: Object.freeze({
    REQUESTED: Object.freeze(["ADVANCED", "PARKED", "REJECTED"]),
    ADVANCED: Object.freeze(["EXECUTED", "FAILED", "REJECTED"]),
    PARKED: Object.freeze(["APPROVED", "REJECTED"]),
    APPROVED: Object.freeze(["EXECUTED", "FAILED", "REJECTED"]),
    EXECUTED: Object.freeze([]),
    FAILED: Object.freeze([]),
    REJECTED: Object.freeze([]),
  }) as Readonly<Record<string, readonly string[]>>,
  terminal: Object.freeze(["EXECUTED", "FAILED", "REJECTED"]),
});

// ---------------------------------------------------------------------------
// The lane feeds result (the six lanes + the options)
// ---------------------------------------------------------------------------

/** The options the lane feeds composition takes. */
export interface LaneFeedOptions {
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
  /** The selected device id (the Device Doctor's subject). */
  readonly selectedDeviceId?: DeviceId;
  /** The selected recovery case id (the detail Sheet's subject). */
  readonly selectedRecoveryCaseId?: string;
  /** The selected finding id (the Security Doctor's subject). */
  readonly selectedFindingId?: string;
  /** The selected plan id (the Fleet Actions' subject). */
  readonly selectedPlanId?: string;
  /** The selected document ref (the Print Distribution's subject). */
  readonly selectedDocumentRef?: string;
}

/**
 * The six lane feeds composed for the acting tenant: each lane's deep
 * view-model bound to REAL runtime state. A lane with no records for
 * the acting tenant composes the honest `empty`/`blocked` phase —
 * never fabricated data, never the demo tenant's records in a
 * non-demo workspace.
 */
export interface LaneFeeds {
  /** Whether the acting tenant is the dedicated demo tenant. */
  readonly isDemo: boolean;
  /** The active session's tenant (the composition's scope). */
  readonly tenantId: string;
  /** Lane 1 — the Device Doctor feed (the nine-stage diagnosis walk). */
  readonly doctor: DeviceDoctorFeed;
  /** Lane 2a — the Recovery cases feed (the seven-stage case walk). */
  readonly recoveryCases: RecoveryCasesFeed;
  /** Lane 2b — the Find My Device feed (the last-seen evidence ledger). */
  readonly findMyDevice: FindMyDeviceFeed;
  /** Lane 2c — the Destructive Actions feed (the gated confirmation flow). */
  readonly destructiveActions: DestructiveActionsFeed;
  /** Lane 3 — the Security Doctor feed (the nine-stage remediation walk). */
  readonly securityDoctor: SecurityDoctorFeed;
  /** Lane 4a — the Fleet Actions feed (the eight-stage plan walk). */
  readonly fleetActions: FleetActionsFeed;
  /** Lane 4b — the Print Distribution feed (the per-person routing view). */
  readonly printDistribution: PrintDistributionFeed;
  /** Lane 5 — the Workload Planning feed (the six-stage planning walk). */
  readonly workloadPlanning: WorkloadPlanningFeed;
  /** Lane 6 — the Procurement Cases feed (the seven-stage procurement walk). */
  readonly procurementCases: ProcurementCasesFeed;
}

// ---------------------------------------------------------------------------
// The empty runtime states (the honest fresh-tenant / unavailable-package
// state — REAL runtime state, never fabricated data)
// ---------------------------------------------------------------------------

/** An empty DeviceTwinSource (returns undefined for every lookup). */
function emptyTwinSource(): DeviceTwinSource {
  return {
    list: () => [],
    get: () => undefined,
  } as unknown as DeviceTwinSource;
}

/** An empty DoctorSources (every method returns the empty list). */
function emptyDoctorSources(): DoctorSources {
  return {
    signals: () => [],
    baselines: () => [],
    anomalies: () => [],
    diagnoses: () => [],
    treatments: () => [],
    evidenceRefs: () => [],
  };
}

/** An empty DeviceObservationSource. */
function emptyObservationSource(): DeviceObservationSource {
  return { observations: () => [] };
}

/** An empty RemediationRequestSource. */
function emptyRemediationSource(): RemediationRequestSource {
  return { requests: () => [] };
}

/** An empty RecoveryRuntimeState (fresh in-memory stores). */
function emptyRecoveryState(): RecoveryRuntimeState {
  return {
    cases: { list: () => [], latest: () => undefined } as unknown as RecoveryCaseSource,
    requests: { list: () => [], requests: () => [], latest: () => undefined } as unknown as DestructiveRequestSource,
    findMy: {
      view: (tenantId: TenantId, deviceId: DeviceId, at: string) => ({
        tenantId,
        deviceId,
        asOf: at,
        lastSeen: undefined,
        location: { status: "no_location_evidence" as const },
        ledger: Object.freeze([]) as readonly { readonly recordId: string; readonly version: number; readonly observedAt: string; readonly recordedAt: string; readonly staleness: string; readonly evidenceCount: number; readonly locationBorne: boolean }[],
        locationKnown: false,
      }),
      revisions: () => [],
    } as unknown as FindMyDeviceSource,
    capabilities: { capabilities: () => undefined } as unknown as DestructiveCapabilitySource,
  };
}

/** An empty Security Doctor runtime state. */
function emptySecurityDoctorState(): SecurityDoctorRuntimeState {
  return {
    findings: { list: () => [], get: () => undefined },
    evaluations: { evaluationFor: () => undefined },
    remediation: { requests: () => [], list: () => [] },
    approvals: { parked: () => [], parkedByPlan: () => undefined },
    plans: { stateFor: () => undefined },
    verifications: { verificationFor: () => undefined },
  };
}

/** An empty Fleet Actions runtime state. */
function emptyFleetActionsState(): FleetActionsRuntimeState {
  return {
    plans: { list: () => [], get: () => undefined },
    decisions: { decisionFor: () => undefined },
    verifications: { verificationFor: () => undefined },
  };
}

/** An empty Print Distribution runtime state. */
function emptyPrintDistributionState(): PrintDistributionRuntimeState {
  return {
    distributions: { distributionFor: () => undefined },
  };
}

/** An empty Workload Planning runtime state. */
function emptyWorkloadPlanningState(): WorkloadPlanningRuntimeState {
  return {
    profiles: { list: () => [] },
    recommendations: { ledger: () => undefined },
    resources: {
      links: () => [],
      software: () => [],
      connectivity: () => [],
      maintenance: () => [],
    },
  };
}

/** An empty Procurement Cases runtime state. */
function emptyProcurementState(): ProcurementRuntimeState {
  return {
    demands: { list: () => [] },
    matches: { matches: () => [] },
    quotes: { ledger: () => undefined },
    orders: { orders: () => [] },
    vendors: { list: () => [] },
  };
}

/** An empty DeviceDoctorRuntimeState (for both demo and fresh tenants). */
function emptyDoctorState(): DeviceDoctorRuntimeState {
  return {
    twins: emptyTwinSource(),
    doctor: emptyDoctorSources(),
    observations: emptyObservationSource(),
    remediation: emptyRemediationSource(),
  };
}

// ---------------------------------------------------------------------------
// The DEMO Security Doctor runtime state (the critical finding + the
// parked plan + the approved plan — the full finding-to-evidence walk)
// ---------------------------------------------------------------------------

/** The demo security finding record (structural seam shape). */
function demoSecurityFinding(): SecurityFindingRecord {
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
  if (!assessed.ok) throw new Error("W144 demo security finding: posture failed");
  const critical = assessed.posture.findings.find((f) => f.severity === "CRITICAL");
  if (critical === undefined) throw new Error("W144 demo security finding: no CRITICAL finding");
  // The REAL `SecurityFinding` satisfies `SecurityFindingRecord` structurally.
  return critical as unknown as SecurityFindingRecord;
}

/** The demo Guardian evaluation (the REQUIRE_APPROVAL decision context). */
function demoEvaluation(): GuardianEvaluationRecord {
  const rule = defineGuardianRule(TENANT_ID, {
    name: "w091-demo-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
  if (!rule.ok) throw new Error("W144 demo evaluation: rule failed");
  const compiled = compileGuardianRuleSet(TENANT_ID, { rules: [rule.rule], version: 1, at: T0 });
  if (!compiled.ok) throw new Error("W144 demo evaluation: compile failed");
  const evaluation = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    { at: T1, correlationId: CORR_2 },
  );
  if (!evaluation.ok) throw new Error("W144 demo evaluation: evaluate failed");
  // The REAL `GuardianEvaluation` satisfies `GuardianEvaluationRecord` structurally.
  return evaluation.evaluation as unknown as GuardianEvaluationRecord;
}

/** The demo parked plan + the demo approved plan (reconstructed). */
function demoPlans(): {
  readonly parked: { readonly plan: SurfaceActionPlanRecord; readonly evaluation: GuardianEvaluationRecord };
  readonly approved: { readonly plan: SurfaceActionPlanRecord; readonly decision: GuardianDecisionRecord };
} {
  const rule = defineGuardianRule(TENANT_ID, {
    name: "w091-demo-require-approval",
    condition: { kind: "action", actions: { in: ["fleet.action.execute"] } },
    effect: "REQUIRE_APPROVAL",
    at: T0,
  });
  if (!rule.ok) throw new Error("W144 demo plans: rule failed");
  const compiled = compileGuardianRuleSet(TENANT_ID, { rules: [rule.rule], version: 1, at: T0 });
  if (!compiled.ok) throw new Error("W144 demo plans: compile failed");
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

  // The parked plan (the approvals queue item).
  const parkedPlan = createActionPlan({
    name: "w091-demo-enable-encryption",
    selector: { kind: "byId", deviceIds: [DEV_1] },
    capability: "lock",
    tenantId: TENANT_ID,
    registry,
    at: T2,
  });
  if (!parkedPlan.ok) throw new Error("W144 demo plans: parked plan failed");
  const parkedSubmit = submitActionPlan(parkedPlan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    at: T2,
    correlationId: CORR_2,
  });
  if (!parkedSubmit.ok) throw new Error("W144 demo plans: parked submit failed");
  if (parkedSubmit.status !== "PARKED") throw new Error(`W144 demo plans: expected PARKED, got ${parkedSubmit.status}`);
  const parkedEvaluation = evaluateGuardianRequest(
    compiled.ruleSet,
    { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    { at: T1, correlationId: CORR_2 },
  );
  if (!parkedEvaluation.ok) throw new Error("W144 demo plans: parked eval failed");

  // The approved plan (the executed decision).
  const approvedPlan = createActionPlan({
    name: "w091-demo-lock-lost-device",
    selector: { kind: "byId", deviceIds: [DEV_1] },
    capability: "lock",
    tenantId: TENANT_ID,
    registry,
    at: T2,
  });
  if (!approvedPlan.ok) throw new Error("W144 demo plans: approved plan failed");
  const approvedSubmit = submitActionPlan(approvedPlan.plan, {
    ruleSet: compiled.ruleSet,
    request: { tenantId: TENANT_ID, action: { action: "fleet.action.execute" } },
    at: T2,
    correlationId: CORR_3,
  });
  if (!approvedSubmit.ok) throw new Error("W144 demo plans: approved submit failed");
  const approved = approveParkedPlan(approvedSubmit.plan, "approve", {
    at: T3,
    correlationId: CORR_4,
    approverId: OPERATOR_ID,
  });
  if (!approved.ok) throw new Error("W144 demo plans: approve failed");

  return {
    parked: {
      plan: parkedSubmit.plan as unknown as SurfaceActionPlanRecord,
      evaluation: parkedEvaluation.evaluation as unknown as GuardianEvaluationRecord,
    },
    approved: {
      plan: approved.plan as unknown as SurfaceActionPlanRecord,
      decision: makeGuardianDecision({
        tenantId: TENANT_ID,
        decision: "REQUIRE_APPROVAL",
        rules: [{ ruleId: rule.rule.ruleId, ruleVersion: rule.rule.version }],
        evidence: [],
        decidedAt: T1,
        schemaVersion: 1,
      }) as unknown as GuardianDecisionRecord,
    },
  };
}

/** The demo Security Doctor runtime state (the finding + evaluation + remediation + approvals + plans + verifications). */
function buildDemoSecurityDoctorState(): SecurityDoctorRuntimeState {
  const finding = demoSecurityFinding();
  const evaluation = demoEvaluation();
  const plans = demoPlans();

  // The remediation request: the finding's remediation was proposed and
  // PARKED (the pending human decision — the Security Doctor's
  // approval_required lane phase).
  const remediationRecord: SecurityRemediationRequestLike = {
    findingId: finding.findingId,
    tenantId: TENANT_ID,
    deviceId: DEV_1,
    intentKind: "SecurityRemediationIntent",
    disposition: "accepted",
    status: "PARKED",
    requestedAt: T2,
    requestedBy: OPERATOR_ID as unknown as string,
    planId: plans.parked.plan.planId,
    decision: evaluation.decision as unknown as GuardianDecision,
    decidedAt: T2,
    outcome: undefined,
    executedAt: undefined,
    evidence: [
      { key: "evidence/w091-demo-remediation", sizeBytes: 256, hash: "w091demo00000000000000000000000000000000000000000000000000000", hashAlgorithm: "sha256" },
    ],
    contentDigest: "w091-demo-remediation-digest",
  };

  const findings: SecurityFindingSource = {
    list: (tenantId) => (tenantId === TENANT_ID ? [finding] : []),
    get: (tenantId, id) => (tenantId === TENANT_ID && id === finding.findingId ? finding : undefined),
  };
  const evaluations: SecurityEvaluationSource = {
    evaluationFor: (tenantId, id) =>
      tenantId === TENANT_ID && id === finding.findingId ? evaluation : undefined,
  };
  const remediation: SecurityRemediationRequestSource = {
    requests: (tenantId, id) =>
      tenantId === TENANT_ID && id === finding.findingId ? [remediationRecord] : [],
    list: (tenantId) => (tenantId === TENANT_ID ? [remediationRecord] : []),
  };
  const approvals: SecurityApprovalSource = {
    parked: (tenantId) =>
      tenantId === TENANT_ID ? [{ plan: plans.parked.plan, evaluation: plans.parked.evaluation }] : [],
    parkedByPlan: (tenantId, planId) =>
      tenantId === TENANT_ID && planId === plans.parked.plan.planId
        ? { plan: plans.parked.plan, evaluation: plans.parked.evaluation }
        : undefined,
  };
  const planStates: SecurityDecisionPlanSource = {
    stateFor: (tenantId, planId) => {
      if (tenantId !== TENANT_ID) return undefined;
      if (planId === plans.approved.plan.planId) {
        const state: DecisionPlanState = {
          planId: plans.approved.plan.planId,
          tenantId: TENANT_ID,
          status: "APPROVED",
          capability: plans.approved.plan.capability,
          targetCount: plans.approved.plan.targetCount,
          approverId: OPERATOR_ID,
          transitionedAt: T3,
          executionHandoff: "downstream_dispatch",
          evidenceCount: 1,
          contentDigest: plans.approved.plan.contentDigest,
        };
        return state;
      }
      if (planId === plans.parked.plan.planId) {
        const state: DecisionPlanState = {
          planId: plans.parked.plan.planId,
          tenantId: TENANT_ID,
          status: "PARKED",
          capability: plans.parked.plan.capability,
          targetCount: plans.parked.plan.targetCount,
          transitionedAt: T2,
          executionHandoff: null,
          evidenceCount: 0,
          contentDigest: plans.parked.plan.contentDigest,
        };
        return state;
      }
      return undefined;
    },
  };
  const verifications: SecurityVerificationSource = {
    verificationFor: (tenantId, findingId) => {
      if (tenantId !== TENANT_ID || findingId !== finding.findingId) return undefined;
      const record: VerificationRecord = {
        findingId: finding.findingId,
        tenantId: TENANT_ID,
        verifiedAt: T4,
        summary: "The disk-encryption remediation was verified on the device.",
        evidenceCount: 1,
      };
      return record;
    },
  };

  return { findings, evaluations, remediation, approvals, plans: planStates, verifications };
}

/** The demo Security Doctor runtime state (module-scope singleton; deterministic). */
const DEMO_SECURITY_DOCTOR: SecurityDoctorRuntimeState = buildDemoSecurityDoctorState();

// ---------------------------------------------------------------------------
// The DEMO Fleet Actions runtime state (the parked + approved plans)
// ---------------------------------------------------------------------------

function buildDemoFleetActionsState(): FleetActionsRuntimeState {
  const plans = demoPlans();

  const planSource: ActionPlanSource = {
    list: (tenantId) =>
      tenantId === TENANT_ID ? [plans.parked.plan, plans.approved.plan] : [],
    get: (tenantId, planId) => {
      if (tenantId !== TENANT_ID) return undefined;
      if (planId === plans.parked.plan.planId) return plans.parked.plan;
      if (planId === plans.approved.plan.planId) return plans.approved.plan;
      return undefined;
    },
  };
  const decisions: PlanDecisionSource = {
    decisionFor: (tenantId, planId) => {
      if (tenantId !== TENANT_ID) return undefined;
      if (planId === plans.parked.plan.planId) return plans.parked.evaluation.decision;
      if (planId === plans.approved.plan.planId) return plans.approved.decision;
      return undefined;
    },
  };
  const verifications: FleetActionVerificationSource = {
    verificationFor: (tenantId, planId) => {
      if (tenantId !== TENANT_ID || planId !== plans.approved.plan.planId) return undefined;
      const record: FleetActionVerificationRecord = {
        planId: plans.approved.plan.planId,
        tenantId: TENANT_ID,
        verifiedAt: T4,
        summary: "The lock action was verified on the target device.",
        evidenceCount: 1,
        perTarget: [
          { deviceId: DEV_1 as string, outcome: "verified", evidenceCount: 1 },
        ],
      };
      return record;
    },
  };

  return { plans: planSource, decisions, verifications };
}

/** The demo Fleet Actions runtime state (module-scope singleton; deterministic). */
const DEMO_FLEET_ACTIONS: FleetActionsRuntimeState = buildDemoFleetActionsState();

// ---------------------------------------------------------------------------
// The composition (the entry point the console runtime calls)
// ---------------------------------------------------------------------------

/** The fail-closed composition result (machine-stable refusal). */
export type LaneFeedsResult =
  | { readonly ok: true; readonly view: LaneFeeds }
  | {
      readonly ok: false;
      readonly reason: "invalid_tenant" | "composition_refused";
      readonly message: string;
    };

/** The demo tenant's selected device id (DEV_1 — the device with the critical finding). */
const DEMO_SELECTED_DEVICE: DeviceId = DEV_1;

/**
 * The demo tenant's default Security Doctor subject (the CRITICAL
 * finding's id — resolved lazily from the demo fixture so the feed
 * composes the rich finding-to-evidence walk by default). The demo
 * finding's id is stable (the posture assessment is deterministic).
 */
const DEMO_FINDING_ID: string = demoSecurityFinding().findingId;

/**
 * The demo tenant's default Fleet Actions subject (the PARKED plan's
 * id — the approvals queue item, so the feed composes the
 * approval_required lane phase by default). Resolved lazily from the
 * demo fixture.
 */
const DEMO_PARKED_PLAN_ID: string = demoPlans().parked.plan.planId;

/**
 * Compose the six lane feeds for the ACTIVE session's tenant.
 *
 * The demo tenant resolves the rich demo fleet (the Security Doctor's
 * finding-to-evidence walk + the Fleet Actions' parked/approved plans);
 * the Device Doctor, Recovery, Print Distribution, Workloads, and
 * Procurement lanes compose the honest `empty` state (the demo has no
 * records for them — the domain packages are not in apps/web's
 * dependency closure, so the runtime binds the lane packages'
 * structural seams over empty record sets — REAL runtime state, never
 * fabricated data). Every non-demo workspace resolves ONLY its own
 * records over the same REAL builders with empty record sets — the
 * honest fresh-workspace state. An unknown/invalid tenant grammar is a
 * machine-stable refusal (fail-closed; never a fallback to the demo
 * tenant).
 */
export function composeLaneFeeds(
  tenantId: string,
  options: LaneFeedOptions,
): LaneFeedsResult {
  // The scope guard: an invalid tenant grammar never reaches a source.
  if (typeof tenantId !== "string" || tenantId.length === 0 || !tenantId.startsWith("tnt_")) {
    return {
      ok: false,
      reason: "invalid_tenant",
      message: `composeLaneFeeds: '${String(tenantId)}' does not match the frozen tenant grammar`,
    };
  }
  if (typeof options?.now !== "string" || options.now.length === 0) {
    return {
      ok: false,
      reason: "composition_refused",
      message: "composeLaneFeeds: the injected reference instant is missing",
    };
  }

  const scope = { tenantId: asTenantId(tenantId) };
  const now = options.now;
  const selectedDeviceId = options.selectedDeviceId ?? DEMO_SELECTED_DEVICE;
  const selectedCaseId = options.selectedRecoveryCaseId;
  const selectedFindingId = options.selectedFindingId ?? DEMO_FINDING_ID;
  const selectedPlanId = options.selectedPlanId ?? DEMO_PARKED_PLAN_ID;
  const selectedDocumentRef = options.selectedDocumentRef ?? "doc://w091-demo-report";
  const freshWithinMs = 86_400_000;
  const staleAfterMs = 604_800_000;

  if (isDemoTenant(tenantId)) {
    // The demo tenant: the rich Security Doctor + Fleet Actions feeds;
    // the other lanes compose the honest empty state.
    const doctor = composeDeviceDoctorFeed(
      scope,
      emptyDoctorState(),
      selectedDeviceId,
      { now },
    );
    const recoveryCases = composeRecoveryCasesFeed(
      scope,
      emptyRecoveryState(),
      REAL_CASE_TABLE,
      { now, ...(selectedCaseId !== undefined ? { selectedCaseId } : {}) },
    );
    const findMyDevice = composeFindMyDeviceFeed(
      scope,
      emptyRecoveryState(),
      selectedDeviceId,
      { at: now, freshWithinMs, staleAfterMs },
    );
    const destructiveActions = composeDestructiveActionsFeed(
      scope,
      emptyRecoveryState(),
      REAL_REQUEST_TABLE,
      REAL_CASE_TABLE,
      selectedDeviceId,
      { now, freshWithinMs, staleAfterMs },
    );
    const securityDoctor = composeSecurityDoctorFeed(
      scope,
      DEMO_SECURITY_DOCTOR,
      selectedFindingId,
      { now },
    );
    const fleetActions = composeFleetActionsFeed(
      scope,
      DEMO_FLEET_ACTIONS,
      selectedPlanId,
      { now },
    );
    const printDistribution = composePrintDistributionFeed(
      scope,
      emptyPrintDistributionState(),
      selectedDocumentRef,
      { now },
    );
    const workloadPlanning = composeWorkloadPlanningFeed(
      scope,
      emptyWorkloadPlanningState(),
      { now },
    );
    const procurementCases = composeProcurementCasesFeed(
      scope,
      emptyProcurementState(),
      { now },
    );
    return {
      ok: true,
      view: {
        isDemo: true,
        tenantId,
        doctor,
        recoveryCases,
        findMyDevice,
        destructiveActions,
        securityDoctor,
        fleetActions,
        printDistribution,
        workloadPlanning,
        procurementCases,
      },
    };
  }

  // Every NON-DEMO workspace: ONLY its own records (the same REAL
  // builders; a fresh workspace has none yet — honest empty states).
  const doctor = composeDeviceDoctorFeed(
    scope,
    emptyDoctorState(),
    selectedDeviceId,
    { now },
  );
  const recoveryCases = composeRecoveryCasesFeed(
    scope,
    emptyRecoveryState(),
    REAL_CASE_TABLE,
    { now, ...(selectedCaseId !== undefined ? { selectedCaseId } : {}) },
  );
  const findMyDevice = composeFindMyDeviceFeed(
    scope,
    emptyRecoveryState(),
    selectedDeviceId,
    { at: now, freshWithinMs, staleAfterMs },
  );
  const destructiveActions = composeDestructiveActionsFeed(
    scope,
    emptyRecoveryState(),
    REAL_REQUEST_TABLE,
    REAL_CASE_TABLE,
    selectedDeviceId,
    { now, freshWithinMs, staleAfterMs },
  );
  const securityDoctor = composeSecurityDoctorFeed(
    scope,
    emptySecurityDoctorState(),
    selectedFindingId,
    { now },
  );
  const fleetActions = composeFleetActionsFeed(
    scope,
    emptyFleetActionsState(),
    selectedPlanId,
    { now },
  );
  const printDistribution = composePrintDistributionFeed(
    scope,
    emptyPrintDistributionState(),
    selectedDocumentRef ?? "doc://fresh-workspace",
    { now },
  );
  const workloadPlanning = composeWorkloadPlanningFeed(
    scope,
    emptyWorkloadPlanningState(),
    { now },
  );
  const procurementCases = composeProcurementCasesFeed(
    scope,
    emptyProcurementState(),
    { now },
  );
  return {
    ok: true,
    view: {
      isDemo: false,
      tenantId,
      doctor,
      recoveryCases,
      findMyDevice,
      destructiveActions,
      securityDoctor,
      fleetActions,
      printDistribution,
      workloadPlanning,
      procurementCases,
    },
  };
}
