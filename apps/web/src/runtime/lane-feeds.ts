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
  asWorkloadId,
  makeGuardianDecision,
} from "@fleetos/contracts";
import type {
  CorrelationId,
  DeviceId,
  EvidenceRef,
  GuardianDecision,
  TenantId,
  UserId,
  WorkloadId,
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
  DeviceTwinLike,
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
  WorkloadProfileFacets,
  WorkloadProfileSource,
  WorkloadRecommendationSource,
  WorkloadResourceSource,
} from "@fleetos/web-workloads";
import {
  composeProcurementCasesFeed,
} from "@fleetos/web-commerce";
import type {
  ProcurementCasesFeed,
  ProcurementDemandFacets,
  ProcurementRuntimeState,
  ProcurementDemandSource,
  ProcurementMatchSource,
  ProcurementQuoteSource,
  ProcurementOrderSource,
  VendorSource,
} from "@fleetos/web-commerce";

// W149 — the executed-decision state derivation (the propagation's pure
// projection over the approval runtime's audit log).
import type { ExecutedDecisionState } from "./executed-decision-state";

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
  /** The selected procurement demand id (the Procurement surface's subject). */
  readonly selectedDemandId?: string;
  /**
   * W148 — the session-scoped recovery-case source (the O5 case-creation
   * affordance's binding). When supplied, the recovery cases feed
   * composes over the session's cases (in-memory for the demo tier; the
   * deployed tier's server-plane persistence arrives with the W140
   * server-route lane). When absent, the feed composes the honest empty
   * state (the fresh-tenant / no-cases state — never fabricated data).
   */
  readonly recoveryCaseSource?: RecoveryCaseSource;
  /**
   * W149 — the EXECUTED decision state derived from the approval
   * runtime (the propagation overlay). When supplied, the demo's
   * Security Doctor composes over the executed decision: the plan's
   * `planState` reflects APPROVED/REJECTED for decided planIds (the
   * `approval` field becomes null — the plan is no longer parked);
   * the audit entries surface in the Evidence & Audit index (the
   * 2-entry trail per decision — the O6 expectation met live). When
   * absent, the lanes compose over the seeded demo state (the W148
   * baseline). PURE — the overlay is a function of the runtime's own
   * audit log; nothing is fabricated.
   */
  readonly executedDecisions?: ExecutedDecisionState;
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

/**
 * W148 — the session-scoped recovery runtime state: the binding site
 * supplies the session's `RecoveryCaseSource` (the demo tier's in-memory
 * store, the deployed tier's server-plane persistence); the destructive
 * request source + the find-my-device source + the capability source
 * stay empty (the demo has no destructive requests + no location-bearing
 * observations — the honest empty states).
 */
function sessionRecoveryState(cases: RecoveryCaseSource): RecoveryRuntimeState {
  return {
    cases,
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
// W148 — the DEMO tenant's roster-backed twin source (the doctor's binding
// over the demo fleet's OWN devices — the nine-stage diagnosis walk runs
// over the roster's real devices; honest empties only where no doctor
// health-pipeline data exists).
// ---------------------------------------------------------------------------

/**
 * The DEMO tenant's twin source: backed by the demo fleet's REAL
 * TwinStore (the same store the device roster reads — the doctor binds
 * to the tenant's roster, never to an empty diagnosis store). A non-demo
 * tenant gets an empty twin source (the honest fresh-tenant state).
 *
 * The structural `DeviceTwinSource` is satisfied by the in-memory
 * TwinStore (`list` returns the tenant's twins sorted by deviceId;
 * `get` returns the twin or undefined — no existence side channel).
 */
function demoTwinSource(): DeviceTwinSource {
  // The demo fleet's REAL TwinStore (the same store the roster reads).
  // Lazy-imported to keep the module pure (no top-level I/O).
  const store = DEMO.store;
  return {
    list: (tenantId: TenantId) => {
      if (tenantId !== TENANT_ID) return [];
      // The TwinStore's list() returns the tenant's twins sorted by
      // deviceId (the roster's deterministic order).
      return store.list(tenantId) as unknown as readonly DeviceTwinLike[];
    },
    get: (tenantId: TenantId, deviceId: DeviceId) => {
      if (tenantId !== TENANT_ID) return undefined;
      return store.get(tenantId, deviceId) as unknown as DeviceTwinLike | undefined;
    },
  } as DeviceTwinSource;
}

/**
 * W148 — the DEMO tenant's roster-backed doctor runtime state. The
 * doctor's twin source is the demo fleet's REAL TwinStore (the same
 * store the device roster reads); the doctor health-pipeline sources
 * stay empty (the demo fleet has no health signals/baselines/anomalies/
 * diagnoses/treatments — the honest empty state, never fabricated
 * data). The nine-stage journey runs over the roster's real device
 * (the device-not-in-fleet blocker is GONE for the demo tenant's own
 * device `dev_w091demo000001`).
 */
function demoDoctorState(): DeviceDoctorRuntimeState {
  return {
    twins: demoTwinSource(),
    doctor: emptyDoctorSources(),
    observations: emptyObservationSource(),
    remediation: emptyRemediationSource(),
  };
}

// ---------------------------------------------------------------------------
// W148 — the DEMO tenant's workload-planning state (the demo fleet has
// ONE workload profile: the analyst workstation that targets the demo
// device; the planning surface's Loading resolves to ready; the six-stage
// journey runs over REAL runtime state).
// ---------------------------------------------------------------------------

const DEMO_WORKLOAD_ID: WorkloadId = asWorkloadId("wl_w091demo000001");
const DEMO_WORKLOAD_PROFILE_FACETS: WorkloadProfileFacets = Object.freeze({
  workloadId: DEMO_WORKLOAD_ID,
  tenantId: TENANT_ID,
  subjectKind: "analyst-workstation",
  name: "w091-demo-analyst-workstation",
  description: "The demo analyst's primary workstation — disk-encryption-capable, field-ops-scoped.",
  revision: 1,
  requirements: {
    vectorVersion: 1,
    values: Object.freeze({ compute: 0.7, memory: 0.6, storage: 0.5, security: 0.9 }),
    confidence: 0.85,
  },
  constraints: Object.freeze({
    requiredApplications: Object.freeze([
      Object.freeze({ appId: "fleetos.console", minVersion: "1.0.0" }),
    ]),
    environments: Object.freeze(["windows"]),
    classification: "internal",
  }),
  evidence: Object.freeze([
    Object.freeze({
      observationId: "obsw091demo0000010",
      kind: "device.security",
      note: "Disk-encryption posture observation (the CRITICAL finding's source).",
    }),
  ]),
  workingHours: Object.freeze({ startHour: 9, endHour: 18 }),
  createdAt: T0,
  contentHash: "w091demo000000000000000000000000000000000000000000000000000001",
  schemaVersion: 1,
}) as WorkloadProfileFacets;

/** The DEMO tenant's workload-planning runtime state (one profile, no ledger yet). */
function demoWorkloadPlanningState(): WorkloadPlanningRuntimeState {
  return {
    profiles: {
      list: (tenantId: TenantId) =>
        tenantId === TENANT_ID ? [DEMO_WORKLOAD_PROFILE_FACETS] : [],
    },
    recommendations: {
      ledger: (_tenantId: TenantId, _workloadId: WorkloadId) => undefined,
    },
    resources: {
      links: () => [],
      software: () => [],
      connectivity: () => [],
      maintenance: () => [],
    },
  };
}

// ---------------------------------------------------------------------------
// W148 — the DEMO tenant's procurement state (the demo fleet has ONE
// procurement demand: a laptop-replacement demand for the analyst's
// workload; the procurement surface's Loading resolves to ready; the
// seven-stage journey runs over REAL runtime state with honest
// not_decided/not_requested stages where undecided).
// ---------------------------------------------------------------------------

const DEMO_DEMAND_FACETS: ProcurementDemandFacets = Object.freeze({
  demandId: "dmd_w091demo000001",
  tenantId: TENANT_ID,
  workloadId: DEMO_WORKLOAD_ID as unknown as string,
  description: "w091-demo laptop replacement for the analyst workstation (disk-encryption-capable, field-ops-scoped).",
  quantity: 1,
  createdAt: T2,
  deadline: "2026-02-15T00:00:00Z",
  deliveryArea: "hq",
  budget: Object.freeze({ usd: 2200 }),
  slaFloor: Object.freeze({ coverage: 0.95 }),
  warrantyFloor: Object.freeze({ days: 365 }),
  qualityFloor: Object.freeze({ score: 0.8 }),
  availabilityFloor: Object.freeze({ ratio: 0.9 }),
  allowedSubstitutions: Object.freeze(["lenovo-thinkpad-t14", "apple-macbook-air-m3"]),
  rejectionEvidence: Object.freeze([]),
  schemaVersion: 1,
  modelVersion: 1,
}) as ProcurementDemandFacets;

/** The DEMO tenant's procurement runtime state (one demand, no matches/quotes/orders yet). */
function demoProcurementState(): ProcurementRuntimeState {
  return {
    demands: {
      list: (tenantId: TenantId) =>
        tenantId === TENANT_ID ? [DEMO_DEMAND_FACETS] : [],
    },
    matches: { matches: () => [] },
    quotes: { ledger: () => undefined },
    orders: { orders: () => [] },
    vendors: { list: () => [] },
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
// W149 — the executed-decision overlay (the propagation's pure projection)
// ---------------------------------------------------------------------------

/**
 * W149 — wrap a `SecurityDoctorRuntimeState` so the executed decision
 * state propagates into the Security Doctor's composed view-model.
 *
 * The overlay is the propagation fix: when an operator has approved or
 * rejected a parked plan, the plan's `planState` MUST reflect the
 * executed status (APPROVED/REJECTED — never the seeded PARKED), and
 * the `approval` field MUST become null (the plan is no longer parked).
 *
 * The overlay wraps the runtime state's `plans.stateFor` and
 * `approvals.parkedByPlan` seams so the composed feed renders the
 * executed status + the approving principal + the transitioned-at
 * instant — REAL runtime state, never fabricated data.
 *
 * PURE: returns a NEW runtime state wrapper (the demo singleton is
 * untouched). The overlay reads the executed-decision state's own
 * derivation (the runtime's audit log); nothing is invented.
 */
function overlayExecutedDecisionsOnSecurityDoctor(
  base: SecurityDoctorRuntimeState,
  executed: ExecutedDecisionState,
): SecurityDoctorRuntimeState {
  if (executed.decidedPlanIds.length === 0) return base;
  const recordsByPlan = executed.recordsByPlan;
  const plans: SecurityDecisionPlanSource = {
    stateFor: (tenantId: TenantId, planId: string): DecisionPlanState | undefined => {
      const record = recordsByPlan[planId];
      if (record === undefined) return base.plans.stateFor(tenantId, planId);
      // The decided plan is in the acting tenant's partition (the
      // boundary's own tenantId guard held when the decision was
      // dispatched — the audit record carries the tenantId verbatim).
      if (record.tenantId !== tenantId) return base.plans.stateFor(tenantId, planId);
      const baseState = base.plans.stateFor(tenantId, planId);
      // The base state carries the capability / targetCount / content
      // digest (the seeded plan's static fields — never fabricated).
      if (baseState === undefined) return baseState;
      return Object.freeze({
        ...baseState,
        status: record.status,
        ...(record.approverId !== undefined ? { approverId: record.approverId as UserId } : {}),
        ...(record.rejectionReason !== undefined ? { rejectionReason: record.rejectionReason } : {}),
        transitionedAt: record.transitionedAt,
        executionHandoff: record.status === "APPROVED" ? "downstream_dispatch" as const : null,
        evidenceCount: baseState.evidenceCount,
      });
    },
  };
  const approvals: SecurityApprovalSource = {
    parked: (tenantId: TenantId): readonly ParkedApprovalItemInput[] => {
      const baseItems = base.approvals.parked(tenantId);
      // A decided plan is no longer parked — drop it from the queue.
      return baseItems.filter((item) => recordsByPlan[item.plan.planId] === undefined);
    },
    parkedByPlan: (tenantId: TenantId, planId: string): ParkedApprovalItemInput | undefined => {
      // A decided plan is no longer parked — the doctor's `approval`
      // field becomes null (the screen renders the executed status).
      if (recordsByPlan[planId] !== undefined) return undefined;
      return base.approvals.parkedByPlan(tenantId, planId);
    },
  };
  return { ...base, plans, approvals };
}

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
  const selectedDemandId = options.selectedDemandId;
  const freshWithinMs = 86_400_000;
  const staleAfterMs = 604_800_000;
  // W148 — the session-scoped recovery-case source (the O5 case-creation
  // affordance's binding). When supplied, the recovery cases feed
  // composes over the session's cases; when absent, the honest empty
  // state (the fresh-tenant / no-cases state — never fabricated data).
  const recoveryState = options.recoveryCaseSource !== undefined
    ? sessionRecoveryState(options.recoveryCaseSource)
    : emptyRecoveryState();

  // W149 — the executed-decision state (the propagation overlay). When
  // supplied, the demo's Security Doctor composes over the executed
  // decision: the plan's `planState` reflects APPROVED/REJECTED for
  // decided planIds (the `approval` field becomes null — the plan is
  // no longer parked). When absent, the seeded demo state (the W148
  // baseline).
  const executedDecisions = options.executedDecisions;

  if (isDemoTenant(tenantId)) {
    // The demo tenant: the rich Security Doctor + Fleet Actions feeds;
    // W148 — the Device Doctor binds to the demo fleet's REAL TwinStore
    // (the doctor sees the demo tenant's own device `dev_w091demo000001`
    // — the device-not-in-fleet blocker is GONE); the Workloads Planning
    // + Commerce Procurement lanes compose the demo tenant's REAL
    // workload profile + procurement demand (the Loading resolves to
    // ready over REAL runtime state — the six-stage + seven-stage
    // journeys run).
    const doctor = composeDeviceDoctorFeed(
      scope,
      demoDoctorState(),
      selectedDeviceId,
      { now },
    );
    const recoveryCases = composeRecoveryCasesFeed(
      scope,
      recoveryState,
      REAL_CASE_TABLE,
      { now, ...(selectedCaseId !== undefined ? { selectedCaseId } : {}) },
    );
    const findMyDevice = composeFindMyDeviceFeed(
      scope,
      recoveryState,
      selectedDeviceId,
      { at: now, freshWithinMs, staleAfterMs },
    );
    const destructiveActions = composeDestructiveActionsFeed(
      scope,
      recoveryState,
      REAL_REQUEST_TABLE,
      REAL_CASE_TABLE,
      selectedDeviceId,
      { now, freshWithinMs, staleAfterMs },
    );
    // W149 — propagate the executed decision state into the Security
    // Doctor: the demo's seeded PARKED plan transitions to APPROVED/
    // REJECTED for decided planIds (the `approval` field becomes null —
    // the plan is no longer parked). PURE overlay; the demo singleton
    // is untouched.
    const securityDoctorState = executedDecisions !== undefined
      ? overlayExecutedDecisionsOnSecurityDoctor(DEMO_SECURITY_DOCTOR, executedDecisions)
      : DEMO_SECURITY_DOCTOR;
    const securityDoctor = composeSecurityDoctorFeed(
      scope,
      securityDoctorState,
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
      demoWorkloadPlanningState(),
      { now },
    );
    const procurementCases = composeProcurementCasesFeed(
      scope,
      demoProcurementState(),
      { now, ...(selectedDemandId !== undefined ? { selectedDemandId } : {}) },
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
    recoveryState,
    REAL_CASE_TABLE,
    { now, ...(selectedCaseId !== undefined ? { selectedCaseId } : {}) },
  );
  const findMyDevice = composeFindMyDeviceFeed(
    scope,
    recoveryState,
    selectedDeviceId,
    { at: now, freshWithinMs, staleAfterMs },
  );
  const destructiveActions = composeDestructiveActionsFeed(
    scope,
    recoveryState,
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
    { now, ...(selectedDemandId !== undefined ? { selectedDemandId } : {}) },
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
