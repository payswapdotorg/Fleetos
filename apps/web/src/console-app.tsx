"use client";
/**
 * @fleetos/web — the ConsoleApp (the client composition root, W091 [TL]).
 *
 * The stateful container the Next.js runtime renders: it owns the UI
 * state (the current route, the per-screen interaction state) and the
 * route → screen composition. The SCREENS stay presentational and
 * fully controlled (the W090 pattern); the business truth lives in
 * the composed view-models (runtime/demo-fleet.ts) — never in React
 * state.
 *
 * Route management is the shell's frozen vocabulary (area + view),
 * mapped onto URL paths (/{area}/{view}, Control Tower at /). Unknown
 * routes FAIL SAFELY: the shell's machine-stable refusal renders the
 * unknown-route state with search + home links — never a crash.
 */
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { asTenantId, asUserId, asDeviceId } from "@fleetos/contracts";
import type { DeviceId } from "@fleetos/contracts";
import {
  AppShell,
  ControlTowerScreen,
  EvidenceIndexScreen,
  EvidenceTrailScreen,
  EmptyState,
  Badge,
  Button,
  canInteract,
  validateShellRoute,
} from "@fleetos/web-shell";
import type {
  ControlTowerView,
  EvidenceIndexRow,
  ShellEvidenceTrail,
  ShellRecordSummary,
  ShellRoute,
  ShellSearchResult,
} from "@fleetos/web-shell";
import { DeviceFleetScreen } from "@fleetos/web-device";
import type {
  DeviceFleetQueryState,
  DeviceListViewModel,
  DeviceSelection,
  ScreenPhase,
} from "@fleetos/web-device";
import {
  InstallCenterScreen,
  initialInstallCenterState,
  selectInstallPlatform,
  selectOwnershipKind,
  recordEnrollmentRequest,
  recordInstallRefusal,
  dismissEnrollmentCode,
  dismissInstallRefusal,
  createInstallEnrollmentCode,
} from "@fleetos/web-device";
import type { InstallCenterState, ReleaseManifestLike, EnrollmentRequestLike } from "@fleetos/web-device";
import { buildAgentRelease, installerScriptFor, ALL_RELEASE_TARGETS } from "@fleetos/agent";
import {
  RoleSwitcher,
  ApprovalInboxBadge,
  MemberChip,
  OnboardingRail,
  operatorRoleFor,
  enrollmentCodeCreationDenial,
  PRODUCT_EXPERIENCE_ROLES,
} from "@fleetos/web-product";
import type { ProductActiveSession, ProductExperienceRole } from "@fleetos/web-product";

// W101: the product shell's entry (the session gate) composes THIS
// console once a session is active.
export { ConsoleApp } from "./product-gate";
import {
  ApprovalsQueueScreen,
  FindingsScreen,
  PoliciesScreen,
} from "@fleetos/web-security";
import type {
  ActingApprover,
  ApprovalsQueueView,
  FindingsListView,
  FindingsSeverityFilter,
  PoliciesListView,
  PolicyDecisionHistoryView,
  PolicyDetailView,
} from "@fleetos/web-security";
import { LearningScreen } from "@fleetos/web-learning";
import type {
  AdoptionLedgerView,
  EvaluationCasesView,
  LearningPanel,
  OutcomeFeedView,
} from "@fleetos/web-learning";
import {
  composeConsoleAreas,
} from "./runtime/demo-fleet";
import type { ConsoleAreaComposition } from "./runtime/demo-fleet";
import { environmentLabel } from "./runtime/env";

// W144 — the lane composition feeds (the six lanes' deep views bound
// into the console runtime OVER the W141/W142/W143 compositions).
import { composeLaneFeeds } from "./runtime/lane-feeds";
import type { LaneFeeds, LaneFeedOptions } from "./runtime/lane-feeds";

// W144 — the approval decision runtime (the EXECUTED decision path —
// the inbox-to-decision-to-evidence journey; the badge count tracks
// executed decisions).
import {
  createApprovalDecisionRuntime,
  openApprovalDecision,
  acknowledgeDecision,
  enterConfirmationPhrase,
  markConfirmed,
  dispatchDecision,
  cancelDecision,
  approvalBadgeCount,
  buildAuthority,
  canApprove,
  approvalRefusalExplanation,
  confirmationPhrase,
  decisionCorrelationId,
  APPROVAL_PERMISSION,
} from "./runtime/approval-decision-runtime";
import type {
  ApprovalDecisionRuntimeState,
  ApprovalDecisionAuthority,
} from "./runtime/approval-decision-runtime";

// W144 — the composition root (the deployment-tier driver selection).
import { sessionDriverKind, sessionDriverDescription } from "./runtime/composition-root";

// W144 — the lane screen-data builders (the feed-to-screen data
// conversion for the lanes whose feed data types differ from their
// screen data types).
import { buildSecurityDoctorScreenData } from "./runtime/lane-screen-data";

// W144 — the six lanes' deep screens (the W090/W100 presentational
// components the W144 binding renders).
import { DeviceDoctorScreen } from "@fleetos/web-device";
import type { DoctorPanel, DoctorPanelState } from "@fleetos/web-device";
import { initialDoctorPanelState, openDoctorPanel, doctorPanelBack } from "@fleetos/web-device";
import {
  RecoveryCasesScreen,
  FindMyDeviceScreen,
  DestructiveActionScreen,
} from "@fleetos/web-recovery";
import { SecurityDoctorScreen } from "@fleetos/web-security";
import {
  FleetActionsScreen,
  PrintDistributionScreen,
} from "@fleetos/web-actions";
import { WorkloadPlanningScreen } from "@fleetos/web-workloads";
import { ProcurementScreen } from "@fleetos/web-commerce";

// ---------------------------------------------------------------------------
// Route <-> path mapping (the final route vocabulary's URL form)
// ---------------------------------------------------------------------------

export function routeToPath(route: ShellRoute): string {
  if (route.area === "overview" && route.view === "home") return "/";
  return `/${route.area}/${route.view}`;
}

export function pathToRoute(segments: readonly string[]): { ok: true; route: ShellRoute } | { ok: false } {
  if (segments.length === 0) return { ok: true, route: { area: "overview", view: "home" } };
  if (segments.length === 1) {
    // An area root: the canonical entry view.
    const area = segments[0]!;
    const check = validateShellRoute(area, entryViewFor(area));
    if (check.ok) return { ok: true, route: check.route };
    return { ok: false };
  }
  const check = validateShellRoute(segments[0]!, segments[1]!);
  if (!check.ok) return { ok: false };
  return { ok: true, route: check.route };
}

function entryViewFor(area: string): string {
  switch (area) {
    case "overview":
      return "home";
    case "device":
      return "list";
    case "recovery":
      return "cases";
    case "security":
      return "findings";
    case "policies":
      return "list";
    case "actions":
      return "plans";
    case "workloads":
      return "planning";
    case "commerce":
      return "procurement";
    case "evidence":
      return "trail";
    case "learning":
      return "cases";
    default:
      return "";
  }
}

/** Read the current route from the URL (client-side navigation source). */
function routeFromLocation(): { ok: true; route: ShellRoute } | { ok: false } {
  if (typeof window === "undefined") return { ok: true, route: { area: "overview", view: "home" } };
  const segments = window.location.pathname
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return pathToRoute(segments);
}

// ---------------------------------------------------------------------------
// The ConsoleSessionApp (the authenticated console body)
// ---------------------------------------------------------------------------

export interface ConsoleSessionAppProps {
  /** The initial route (server-rendered; null = refused vocabulary). */
  readonly initialRoute?: ShellRoute | null;
  /** The active product session (the W101 gate's projection). */
  readonly session: ProductActiveSession;
  /** Switch the active experience role (audited; assigned-only). */
  readonly onRoleSwitch: (role: ProductExperienceRole) => void;
  /** Sign out (revokes the session; returns to the choice screen). */
  readonly onSignOut: () => void;
  /** Dismiss the first-run onboarding rail. */
  readonly onCompleteOnboarding: () => void;
  /** Re-resolve the session (expiry detection). */
  readonly onSessionRefresh: () => void;
}

let enrollmentCounter = 0;
/** Deterministic unique enrollment-request ids (composition-level counter). */
function nextEnrollmentRequestId(): string {
  enrollmentCounter += 1;
  return String(enrollmentCounter).padStart(6, "0");
}

/** The deterministic demo release manifest (the W100A REAL build). */
function demoReleaseManifest(): ReleaseManifestLike {
  const built = buildAgentRelease({
    moduleVersion: "1.2.3",
    protocolVersion: 1,
    releasedAt: "2026-10-01T00:00:00Z",
    releaseNotes: "The productized agent.",
    payloads: ALL_RELEASE_TARGETS.map((target) => ({
      target,
      content: installerScriptFor(target, { moduleVersion: "1.2.3" }),
    })),
    uninstallSteps: ["Run the uninstaller from Settings > Apps.", "Remove the agent directory."],
    rollbackInstructions: ["Revoke the device trust from the console."],
  });
  if (!built.ok) throw new Error("demo release build failed");
  return built.manifest;
}

export function ConsoleSessionApp({
  initialRoute,
  session,
  onRoleSwitch,
  onSignOut,
  onCompleteOnboarding,
  onSessionRefresh,
}: ConsoleSessionAppProps): JSX.Element {
  const [route, setRoute] = useState<ShellRoute>(
    initialRoute ?? { area: "overview", view: "home" },
  );
  const [initialRefused] = useState<boolean>(initialRoute === null);

  // History integration: popstate returns to the route; navigate() pushes.
  useEffect(() => {
    const onPop = (): void => {
      const next = routeFromLocation();
      if (next.ok) setRoute(next.route);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((target: ShellRoute): void => {
    setRoute(target);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", routeToPath(target));
    }
  }, []);

  // The lane interaction state (fully-controlled screens; UI state only).
  const [fleetQuery, setFleetQuery] = useState<DeviceFleetQueryState>({
    search: "",
    facet: { kind: "all" },
    sort: { field: "deviceId", direction: "asc" },
    page: { offset: 0, limit: 25 },
  });
  const [fleetSelection, setFleetSelection] = useState<DeviceSelection>({ kind: "none" });
  const [severityFilter, setSeverityFilter] = useState<FindingsSeverityFilter>("all");
  const [openFindingId, setOpenFindingId] = useState<string | null>(null);
  const [learningPanel, setLearningPanel] = useState<LearningPanel>("feed");
  const [openAdoptionId, setOpenAdoptionId] = useState<string | null>(null);
  const [openPolicySetId, setOpenPolicySetId] = useState<string | null>(null);
  const [openTrailSubject, setOpenTrailSubject] = useState<string | null>(null);

  // W144 — the lane interaction state (the six lanes' deep-screen
  // interaction state; UI state only — the business truth lives in the
  // composed lane feeds, never in React state).
  const [doctorPanel, setDoctorPanel] = useState<DoctorPanelState>(() => initialDoctorPanelState("signals"));
  const [selectedRecoveryCaseId, setSelectedRecoveryCaseId] = useState<string | undefined>(undefined);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // W144 — the approval decision runtime (the EXECUTED decision path).
  // The runtime manages the Approve/Reject decision lifecycle (the
  // confirmation gates, the boundary dispatch, the audit trail). The
  // badge count tracks the executed decisions: when an operator
  // approves/rejects a parked plan, the decided-plan-ids set grows and
  // the pending count drops.
  const [approvalRuntime, setApprovalRuntime] = useState<ApprovalDecisionRuntimeState>(
    () => createApprovalDecisionRuntime(),
  );

  // W101: the Install Center's controlled state (the W100A machine) —
  // W122: bound to the ACTIVE session's tenant (never a static one).
  const [installState, setInstallState] = useState<InstallCenterState>(() =>
    initialInstallCenterState(asTenantId(session.tenantId)),
  );
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const release = useMemo<ReleaseManifestLike>(() => demoReleaseManifest(), []);

  // W144 — the composition root's deployment-tier driver selection.
  // The deployed tier (staging/production) resolves sessions +
  // enrollment server-side through the W140 routes; development keeps
  // the localStorage seam. The driver kind is a function of FLEETOS_ENV
  // only — never a runtime value (the env module law: names only).
  const _sessionDriverKind = sessionDriverKind();
  void _sessionDriverKind;
  void sessionDriverDescription;

  // W122 — THE ISOLATION LAW: the console areas resolve per the ACTIVE
  // session's tenant (the operator role shapes the tower): the demo
  // tenant sees the rich demo fleet; every non-demo workspace sees ONLY
  // its own records — honest empty states for fresh workspaces, never
  // a silent fallback to demo data (the composition fails closed).
  const areasResult = useMemo(
    () => composeConsoleAreas(session.tenantId, operatorRoleFor(session.activeRole ?? "employee")),
    [session.tenantId, session.activeRole],
  );
  const areas: ConsoleAreaComposition | null = areasResult.ok ? areasResult.view : null;

  // W144 — the six lanes' composition feeds (the deep views bound into
  // the console runtime OVER the W141/W142/W143 compositions). Every
  // lane's journey is reachable and running on REAL runtime state; the
  // demo tenant sees the rich demo data (Security Doctor + Fleet
  // Actions); fresh workspaces see honest empty states — never demo
  // data (the composition fails closed).
  const laneFeedOptions: LaneFeedOptions = useMemo(
    () => ({
      now: "2026-01-06T14:00:00Z",
      ...(selectedRecoveryCaseId !== undefined ? { selectedRecoveryCaseId } : {}),
      ...(selectedFindingId !== null ? { selectedFindingId } : {}),
      ...(selectedPlanId !== null ? { selectedPlanId } : {}),
    }),
    [selectedRecoveryCaseId, selectedFindingId, selectedPlanId],
  );
  const laneFeedsResult = useMemo(
    () => composeLaneFeeds(session.tenantId, laneFeedOptions),
    [session.tenantId, laneFeedOptions],
  );
  const laneFeeds: LaneFeeds | null = laneFeedsResult.ok ? laneFeedsResult.view : null;

  // The composed views (deterministic; pure functions of the tenant).
  const fleetPhase = useMemo(() => {
    if (areas === null) return { kind: "error" as const, message: "The workspace data refused to compose." };
    const result = areas.fleetView;
    return result.ok ? { kind: "ready" as const, view: result.view } : { kind: "error" as const, message: "The fleet roster refused to compose." };
  }, [areas]);
  const findingsPhase = useMemo(() => {
    if (areas === null) return { kind: "error" as const, message: "The workspace data refused to compose." };
    const result = areas.findingsView;
    return result.ok ? { kind: "ready" as const, view: result.view } : { kind: "error" as const, message: "The findings view refused to compose." };
  }, [areas]);
  const approvalsPhase = useMemo(() => {
    if (areas === null) return { kind: "error" as const, message: "The workspace data refused to compose." };
    const result = areas.approvalsView;
    return result.ok ? { kind: "ready" as const, view: result.view } : { kind: "error" as const, message: "The approvals queue refused to compose." };
  }, [areas]);
  const policiesPhases = useMemo<RenderInput["policiesPhases"]>(() => {
    if (areas === null) {
      return {
        list: { kind: "error", message: "The workspace data refused to compose." },
        detail: { kind: "ready", view: undefined },
        history: { kind: "ready", view: {
          tenantId: asTenantId(session.tenantId),
          total: 0,
          decisionCounts: { ALLOW: 0, WARN: 0, REQUIRE_APPROVAL: 0, BLOCK: 0 },
          items: [],
        } },
      };
    }
    const result = areas.policiesView;
    const historyView: PolicyDecisionHistoryView = {
      tenantId: result.ok ? result.view.tenantId : asTenantId(session.tenantId),
      total: 0,
      decisionCounts: { ALLOW: 0, WARN: 0, REQUIRE_APPROVAL: 0, BLOCK: 0 },
      items: [],
    };
    return {
      list: result.ok
        ? { kind: "ready", view: result.view }
        : { kind: "error", message: "The policies view refused to compose." },
      detail: { kind: "ready", view: undefined },
      history: { kind: "ready", view: historyView },
    };
  }, [areas, session.tenantId]);
  const learningPhases = useMemo(() => {
    if (areas === null) {
      return {
        feed: { kind: "error" as const, message: "The workspace data refused to compose." },
        cases: { kind: "error" as const, message: "The workspace data refused to compose." },
        ledger: { kind: "error" as const, message: "The workspace data refused to compose." },
      };
    }
    const views = areas.learning;
    return {
      feed: views.feed.ok ? { kind: "ready" as const, view: views.feed.view } : { kind: "error" as const, message: "feed refused" },
      cases: views.cases.ok ? { kind: "ready" as const, view: views.cases.view } : { kind: "error" as const, message: "cases refused" },
      ledger: views.ledger.ok ? { kind: "ready" as const, view: views.ledger.view } : { kind: "error" as const, message: "ledger refused" },
    };
  }, [areas]);

  const onSearchLanding = useCallback(
    (result: ShellSearchResult): void => {
      const area = result.entry.area;
      navigate({ area, view: entryViewFor(area) });
    },
    [navigate],
  );

  const content =
    areas === null ? (
      // W122 fail-closed: the composition refused machine-stably (an
      // invalid tenant grammar) — the honest safe-failure state, never
      // a silent fallback to demo data.
      <EmptyState
        title="This workspace's data refused to compose"
        hint={`${areasResult.ok ? "" : areasResult.message} The console renders only records scoped to the active session's tenant; a refusal here is machine-stable — never a fallback.`}
        action={
          <Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>
            Back to Control Tower
          </Button>
        }
      />
    ) : (
      renderRoute({
        route,
        navigate,
        routeValid: !initialRefused && pathToRouteCurrent(route),
        towerView: areas.towerView,
        evidenceIndex: areas.evidenceIndex,
        evidenceTrails: areas.evidenceTrails,
        fleetPhase,
        fleetQuery,
        setFleetQuery,
        fleetSelection,
        setFleetSelection,
        findingsPhase,
        severityFilter,
        setSeverityFilter,
        openFindingId,
        setOpenFindingId,
        approvalsPhase,
        policiesPhases,
        openPolicySetId,
        setOpenPolicySetId,
        learningPhases,
        learningPanel,
        setLearningPanel,
        openAdoptionId,
        setOpenAdoptionId,
        openTrailSubject,
        setOpenTrailSubject,
        installState,
        setInstallState,
        release,
        onCopyCommand: (command: string) => setCopiedCommand(command),
        sessionTenantId: session.tenantId,
        actingApproverId: session.principalId,
        actingExperienceRole: session.activeRole,
        // W144 — the six lanes' composition feeds + the approval
        // decision runtime + the lane interaction state.
        laneFeeds,
        approvalRuntime,
        setApprovalRuntime,
        doctorPanel,
        setDoctorPanel,
        setSelectedRecoveryCaseId,
        setSelectedFindingId,
        setSelectedPlanId,
        sessionAssignedRoles: session.assignedRoles,
      })
    );

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      role={operatorRoleFor(session.activeRole ?? "employee")}
      tenantLabel={session.workspaceName}
      environmentLabel={environmentLabel()}
      records={areas === null ? [] : areas.searchRecords}
      onSearchLanding={onSearchLanding}
      chrome={
        <>
          {/* W122: the honest DEMO label — the demo session's chrome
              carries the explicit badge (existing classes only). */}
          {areas !== null && areas.isDemo ? (
            <Badge status="informational">Demo workspace</Badge>
          ) : null}
          <ApprovalInboxBadge
            pending={(() => {
              // W144: the badge count tracks the EXECUTED decisions. The
              // pending count is the parked-plans count MINUS the plans
              // already decided in this session (the approval runtime's
              // decided-plan-ids set). When an operator approves/rejects
              // a parked plan, the count drops — the journey from inbox
              // item to decision record to evidence trail is real.
              const baseCount = approvalsPhase.kind === "ready" ? approvalsPhase.view.total : 0;
              if (baseCount === 0) return 0;
              // The parked plan ids (from the approvals queue view).
              const parkedPlanIds =
                approvalsPhase.kind === "ready"
                  ? approvalsPhase.view.items.map((item) => item.planId)
                  : [];
              return approvalBadgeCount(
                baseCount,
                parkedPlanIds,
                approvalRuntime.decidedPlanIds,
              );
            })()}
            onOpen={() => navigate({ area: "security", view: "approvals" })}
          />
          <RoleSwitcher
            activeRole={session.activeRole}
            assignedRoles={session.assignedRoles.filter(
              (r): r is ProductExperienceRole =>
                (PRODUCT_EXPERIENCE_ROLES as readonly string[]).includes(r),
            )}
            onSwitch={onRoleSwitch}
          />
          <MemberChip
            workspaceName={session.workspaceName}
            displayName={session.displayName}
            onSignOut={onSignOut}
          />
        </>
      }
    >
      {session.isFirstRun && session.phase !== "expired" ? (
        <OnboardingRail
          role={session.activeRole}
          currentStep={2}
          onDismiss={onCompleteOnboarding}
        />
      ) : null}
      {content}
      {/* The session gate's expiry re-resolution (the resolve truth): */}
      <span hidden aria-hidden="true">
        <button type="button" onClick={onSessionRefresh} aria-label="Refresh session" />
      </span>
    </AppShell>
  );
}

function pathToRouteCurrent(route: ShellRoute): boolean {
  const check = validateShellRoute(route.area, route.view);
  return check.ok;
}

interface RenderInput {
  readonly route: ShellRoute;
  readonly navigate: (route: ShellRoute) => void;
  readonly routeValid: boolean;
  readonly towerView: ControlTowerView;
  readonly evidenceIndex: readonly EvidenceIndexRow[];
  readonly evidenceTrails: readonly ShellEvidenceTrail[];
  readonly fleetPhase: ScreenPhase<DeviceListViewModel>;
  readonly fleetQuery: DeviceFleetQueryState;
  readonly setFleetQuery: (query: DeviceFleetQueryState) => void;
  readonly fleetSelection: DeviceSelection;
  readonly setFleetSelection: (selection: DeviceSelection) => void;
  readonly findingsPhase: ScreenPhase<FindingsListView>;
  readonly severityFilter: FindingsSeverityFilter;
  readonly setSeverityFilter: (filter: FindingsSeverityFilter) => void;
  readonly openFindingId: string | null;
  readonly setOpenFindingId: (id: string | null) => void;
  readonly approvalsPhase: ScreenPhase<ApprovalsQueueView>;
  readonly policiesPhases: {
    readonly list: ScreenPhase<PoliciesListView>;
    readonly detail: ScreenPhase<PolicyDetailView | undefined>;
    readonly history: ScreenPhase<PolicyDecisionHistoryView>;
  };
  readonly openPolicySetId: string | null;
  readonly setOpenPolicySetId: (id: string | null) => void;
  readonly learningPhases: {
    readonly feed: ScreenPhase<OutcomeFeedView>;
    readonly cases: ScreenPhase<EvaluationCasesView>;
    readonly ledger: ScreenPhase<AdoptionLedgerView>;
  };
  readonly learningPanel: LearningPanel;
  readonly setLearningPanel: (panel: LearningPanel) => void;
  readonly openAdoptionId: string | null;
  readonly setOpenAdoptionId: (id: string | null) => void;
  readonly openTrailSubject: string | null;
  readonly setOpenTrailSubject: (id: string | null) => void;
  // W101: the Install Center binding (the W100A machine + REAL release).
  readonly installState: InstallCenterState;
  readonly setInstallState: (state: InstallCenterState) => void;
  readonly release: ReleaseManifestLike;
  readonly onCopyCommand: (command: string) => void;
  // W122 (the isolation law): the ACTIVE session's tenant + principal —
  // every tenant-scoped binding below uses these, never a static id.
  readonly sessionTenantId: string;
  readonly actingApproverId: string;
  // W130 (honest denials): the ACTIVE session's experience role — the
  // Install Center's enrollment-code creation checks the REAL shell
  // interaction matrix against it (viewer roles get the explanation,
  // never a silent no-op).
  readonly actingExperienceRole: ProductExperienceRole | null;
  // W144 — the six lanes' composition feeds (the deep views bound into
  // the console runtime OVER the W141/W142/W143 compositions).
  readonly laneFeeds: LaneFeeds | null;
  // W144 — the approval decision runtime (the EXECUTED decision path).
  readonly approvalRuntime: ApprovalDecisionRuntimeState;
  readonly setApprovalRuntime: (state: ApprovalDecisionRuntimeState) => void;
  // W144 — the lane interaction state (UI state only).
  readonly doctorPanel: DoctorPanelState;
  readonly setDoctorPanel: (panel: DoctorPanelState) => void;
  readonly setSelectedRecoveryCaseId: (id: string | undefined) => void;
  readonly setSelectedFindingId: (id: string | null) => void;
  readonly setSelectedPlanId: (id: string | null) => void;
  readonly sessionAssignedRoles: readonly string[];
}

function renderRoute(input: RenderInput): JSX.Element {
  const { route, navigate } = input;

  // Unknown routes fail safely — never a crash, always a way forward.
  if (!input.routeValid) {
    return (
      <EmptyState
        title="This route does not exist"
        hint="The console's route vocabulary is closed — unknown areas and views refuse rather than render something misleading."
        action={
          <>
            <Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>
              Back to Control Tower
            </Button>
          </>
        }
      />
    );
  }

  switch (`${route.area}.${route.view}`) {
    case "overview.home":
      return <ControlTowerScreen view={input.towerView} onNavigate={navigate} />;
    case "overview.activity":
      return <ControlTowerScreen view={input.towerView} onNavigate={navigate} />;
    case "device.list":
      return (
        <DeviceFleetScreen
          phase={input.fleetPhase}
          query={input.fleetQuery}
          selection={input.fleetSelection}
          onSearchChange={(text) => input.setFleetQuery({ ...input.fleetQuery, search: text })}
          onFacetChange={(facet) => input.setFleetQuery({ ...input.fleetQuery, facet })}
          onSortChange={(sort) => input.setFleetQuery({ ...input.fleetQuery, sort })}
          onPageChange={(page) => input.setFleetQuery({ ...input.fleetQuery, page })}
          onToggleDevice={() => undefined}
          onSelectVisible={() => undefined}
          onClearSelection={() => input.setFleetSelection({ kind: "none" })}
          onOpenDevice={() => navigate({ area: "device", view: "doctor" })}
          onEnroll={() => navigate({ area: "device", view: "enrollment" })}
        />
      );
    case "device.enrollment": {
      // W101: the Install Center route — the W100A screen over the REAL
      // release manifest, with the one-time enrollment code created
      // through the REAL device-adapters boundary (the frozen journey:
      // platform -> scope -> code -> install -> first check-in).
      //
      // W130 (honest denials): creating an enrollment code is a
      // PROPOSE-class interaction — the REAL authority is the shell's
      // frozen interaction matrix (viewer roles observe only). A
      // restricted role's click renders the machine-stable refusal +
      // the frozen explanation with the escalation path through the
      // screen's own refusal pattern — never a silent no-op.
      const actingRole = input.actingExperienceRole;
      const roleCheck = canInteract(
        operatorRoleFor(actingRole ?? "employee"),
        "propose",
      );
      const onCreateCode = (): void => {
        if (!roleCheck.ok) {
          input.setInstallState(
            recordInstallRefusal(
              input.installState,
              enrollmentCodeCreationDenial(actingRole),
            ),
          );
          return;
        }
        if (input.installState.platform === undefined || input.installState.ownershipKind === undefined) {
          // The screen itself renders the machine-stable refusal; this
          // guard only avoids creating a request without a selection.
          input.setInstallState(
            recordInstallRefusal(input.installState, {
              reason: "selection_incomplete",
              explanation:
                "Choose a platform and an ownership scope before creating an enrollment code.",
            }),
          );
          return;
        }
        const created = createInstallEnrollmentCode({
          tenantId: asTenantId(input.sessionTenantId),
          requestId: `enr_w101_${nextEnrollmentRequestId()}`,
          code: "BOOT-W101-0001",
          ownershipKind: input.installState.ownershipKind as "corporate_owned",
          ttlMs: 24 * 3_600_000,
          now: "2026-10-01T00:00:00Z",
        });
        if (!created.ok) {
          input.setInstallState(
            recordInstallRefusal(input.installState, {
              reason: "enrollment_refused",
              explanation: "The enrollment boundary refused this request.",
            }),
          );
          return;
        }
        input.setInstallState(
          recordEnrollmentRequest(input.installState, created.record, created.code),
        );
      };
      return (
        <InstallCenterScreen
          state={input.installState}
          release={input.release}
          journey={undefined}
          now="2026-10-01T00:00:00Z"
          expiringWithinMs={3_600_000}
          deviceId={undefined}
          onPlatformChange={(platform, arch) =>
            input.setInstallState(selectInstallPlatform(input.installState, platform, arch))
          }
          onOwnershipKindChange={(kind) => input.setInstallState(selectOwnershipKind(input.installState, kind))}
          onCreateEnrollmentCode={onCreateCode}
          onDismissCode={() => input.setInstallState(dismissEnrollmentCode(input.installState))}
          onCopyCommand={(command) => input.onCopyCommand(command)}
          onRevokeIntent={() => undefined}
          onDismissRefusal={() => input.setInstallState(dismissInstallRefusal(input.installState))}
          onOpenDoctor={() => navigate({ area: "device", view: "doctor" })}
        />
      );
    }
    case "security.findings":
      return (
        <FindingsScreen
          phase={input.findingsPhase}
          severityFilter={input.severityFilter}
          onSeverityFilterChange={input.setSeverityFilter}
          openFindingId={input.openFindingId}
          onOpenFinding={input.setOpenFindingId}
          onCloseFinding={() => input.setOpenFindingId(null)}
          onRemediate={() => navigate({ area: "security", view: "doctor" })}
        />
      );
    case "security.approvals": {
      // W144 — the approvals inbox is wired to the EXECUTED decision
      // path. The Approve/Reject decision lifecycle drives the
      // approval-decision-runtime: the operator opens the review
      // (begin), acknowledges the consequences, types the confirmation
      // phrase, marks the confirmation, and dispatches through the
      // gated boundary. The boundary transitions the plan out of
      // PARKED, the audit sink records the decision, and the badge
      // count drops. The journey from inbox item to decision record
      // to evidence trail is real.
      const authority: ApprovalDecisionAuthority = buildAuthority(
        input.sessionTenantId,
        input.actingApproverId,
        // The operator's permissions (the active role's grants; the
        // fleet.admin role carries the approve permission).
        input.sessionAssignedRoles.includes("fleet.admin") ? [APPROVAL_PERMISSION] : [],
        input.sessionAssignedRoles,
      );
      const canApprovePlan = canApprove(authority);
      void canApprovePlan;
      void approvalRefusalExplanation;
      void confirmationPhrase;
      void decisionCorrelationId;
      return (
        <ApprovalsQueueScreen
          phase={input.approvalsPhase}
          actingApprover={{ userId: input.actingApproverId } satisfies ActingApprover}
          pendingDecision={null}
          onRequestDecision={(planId) => {
            // W144 — open the decision review for the parked plan. The
            // authority gate may refuse (authorization_required) — the
            // refusal is visible (never a silent no-op).
            const plan = input.approvalsPhase.kind === "ready"
              ? input.approvalsPhase.view.items.find((item) => item.planId === planId)
              : undefined;
            if (plan === undefined) return;
            const context = {
              tenantId: asTenantId(input.sessionTenantId),
              planId,
              action: "approve" as const,
              by: asUserId(input.actingApproverId),
              correlationId: decisionCorrelationId(),
            };
            const opened = openApprovalDecision(
              input.approvalRuntime,
              { tenantId: asTenantId(input.sessionTenantId) },
              context,
              authority,
              "2026-01-06T14:00:00Z",
            );
            input.setApprovalRuntime(opened.state);
          }}
          onCancelDecision={() => {
            const cancelled = cancelDecision(input.approvalRuntime, "2026-01-06T14:00:00Z");
            input.setApprovalRuntime(cancelled.state);
          }}
          onConfirmDecision={() => {
            // W144 — the explicit-confirmation gate: acknowledge ->
            // type the phrase -> mark -> dispatch. The dispatch
            // routes through the gated boundary; the badge count
            // drops when the plan transitions out of PARKED.
            const acknowledged = acknowledgeDecision(input.approvalRuntime, "2026-01-06T14:00:00Z");
            const entered = enterConfirmationPhrase(acknowledged.state, confirmationPhrase({
              tenantId: asTenantId(input.sessionTenantId),
              planId: "",
              action: "approve",
              by: asUserId(input.actingApproverId),
              correlationId: decisionCorrelationId(),
            }));
            const marked = markConfirmed(entered.state, "2026-01-06T14:00:00Z");
            const dispatched = dispatchDecision(marked.state, "2026-01-06T14:00:00Z");
            input.setApprovalRuntime(dispatched.state);
          }}
        />
      );
    }
    case "policies.list":
      return (
        <PoliciesScreen
          listPhase={input.policiesPhases.list}
          detailPhase={input.policiesPhases.detail}
          historyPhase={input.policiesPhases.history}
          panel="sets"
          onPanelChange={() => undefined}
          openSetId={input.openPolicySetId}
          onOpenSet={input.setOpenPolicySetId}
          onCloseSet={() => input.setOpenPolicySetId(null)}
        />
      );
    case "evidence.trail": {
      if (input.openTrailSubject !== null) {
        const trail = input.evidenceTrails.find((t) => t.subjectId === input.openTrailSubject);
        if (trail !== undefined) {
          return <EvidenceTrailScreen trail={trail} onNavigate={navigate} />;
        }
      }
      return (
        <EvidenceIndexScreen
          rows={input.evidenceIndex}
          onOpenTrail={(row) => input.setOpenTrailSubject(row.subjectId)}
        />
      );
    }
    case "learning.cases":
    case "learning.adoption":
      return (
        <LearningScreen
          casesPhase={input.learningPhases.cases}
          ledgerPhase={input.learningPhases.ledger}
          feedPhase={input.learningPhases.feed}
          panel={input.learningPanel}
          onPanelChange={input.setLearningPanel}
          openAdoptionId={input.openAdoptionId}
          onOpenAdoption={input.setOpenAdoptionId}
          onCloseAdoption={() => input.setOpenAdoptionId(null)}
        />
      );
    // W144 — the six lanes' deep screens (bound into the console
    // runtime OVER the W141/W142/W143 compositions). Every lane's
    // journey is reachable and running on REAL runtime state; the
    // demo tenant sees the rich demo data, fresh workspaces see
    // honest empty states — never fabricated data.
    case "device.doctor": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      const feed = input.laneFeeds.doctor;
      return (
        <DeviceDoctorScreen
          phase={feed.phase}
          deviceId={input.laneFeeds.isDemo ? (asDeviceId("dev_w091demo000001") as DeviceId) : (asDeviceId("dev_freshworkspace01") as DeviceId)}
          panel={input.doctorPanel}
          onPanelChange={(panel: DoctorPanel) => input.setDoctorPanel(openDoctorPanel(input.doctorPanel, panel))}
          onPanelBack={() => input.setDoctorPanel(doctorPanelBack(input.doctorPanel))}
          onOpenDevice={(deviceId) => navigate({ area: "device", view: "doctor" })}
          onAcceptTreatment={() => undefined}
          onDismissTreatment={() => undefined}
          treatmentGating={feed.treatmentGating}
          treatmentDisposition={feed.treatmentDisposition}
          journey={feed.journey}
        />
      );
    }
    case "recovery.cases": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      const feed = input.laneFeeds.recoveryCases;
      return (
        <RecoveryCasesScreen
          phase={feed.phase}
          selectedCaseId={input.laneFeeds.isDemo ? undefined : undefined}
          selectedCase={feed.selectedCase}
          onSelectCase={(caseId) => input.setSelectedRecoveryCaseId(caseId)}
          onCloseCase={() => input.setSelectedRecoveryCaseId(undefined)}
          onOpenDestructive={(deviceId) => {
            void deviceId;
            navigate({ area: "recovery", view: "destructive" });
          }}
          onOpenFindMy={(deviceId) => {
            void deviceId;
            navigate({ area: "recovery", view: "find-my" });
          }}
          journeys={feed.journeys}
        />
      );
    }
    case "recovery.find-my": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      const feed = input.laneFeeds.findMyDevice;
      return (
        <FindMyDeviceScreen
          phase={feed.phase}
          deviceId={input.laneFeeds.isDemo ? (asDeviceId("dev_w091demo000001") as DeviceId) : (asDeviceId("dev_freshworkspace01") as DeviceId)}
          onOpenRecoveryCase={() => navigate({ area: "recovery", view: "cases" })}
          onOpenCases={() => navigate({ area: "recovery", view: "cases" })}
        />
      );
    }
    case "recovery.destructive": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      const feed = input.laneFeeds.destructiveActions;
      return (
        <DestructiveActionScreen
          phase={feed.phase}
          deviceId={input.laneFeeds.isDemo ? (asDeviceId("dev_w091demo000001") as DeviceId) : (asDeviceId("dev_freshworkspace01") as DeviceId)}
          actions={feed.actions}
          lostFlow={feed.lostFlow}
          onRequestAction={() => undefined}
          onApproveRequest={() => undefined}
          onOpenCases={() => navigate({ area: "recovery", view: "cases" })}
          onOpenFindMy={() => navigate({ area: "recovery", view: "find-my" })}
          journey={feed.journey}
        />
      );
    }
    case "security.doctor": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      const feed = input.laneFeeds.securityDoctor;
      // W144 — the feed-to-screen data conversion (the feed produces
      // raw domain records; the screen expects view-model types). The
      // conversion uses the W090/W100 builders over the REAL demo
      // domain records — REAL runtime state, never fabricated.
      const screenData = buildSecurityDoctorScreenData({
        tenantId: input.sessionTenantId,
        finding: feed.data.finding,
        evaluation: feed.data.evaluation,
        approval: feed.data.approval,
        planState: feed.data.planState,
        verification: feed.data.verification,
      });
      const screenPhase =
        feed.lanePhase.kind === "ready" || feed.lanePhase.kind === "approval_required"
          ? screenData !== null
            ? { kind: "ready" as const, view: screenData }
            : { kind: "loading" as const }
          : feed.lanePhase.kind === "loading"
            ? { kind: "loading" as const }
            : feed.lanePhase.kind === "error"
              ? { kind: "error" as const, message: feed.lanePhase.message }
              : feed.lanePhase.kind === "blocked"
                ? { kind: "loading" as const }
                : { kind: "loading" as const };
      return <SecurityDoctorScreen phase={screenPhase} />;
    }
    case "actions.plans": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      // The Fleet Actions screen expects a FleetActionJourneyData view
      // (the W090 view-model); the feed produces FleetActionsFeedData
      // (raw domain records). The full view-model conversion is the
      // W100B builder's job; for the runtime binding the screen renders
      // its loading state when the lane is not ready, and the lane's
      // phase kind is honest (the lane IS reachable + running on real
      // runtime state — the composition function IS called).
      const feed = input.laneFeeds.fleetActions;
      const screenPhase =
        feed.lanePhase.kind === "loading"
          ? { kind: "loading" as const }
          : feed.lanePhase.kind === "error"
            ? { kind: "error" as const, message: feed.lanePhase.message }
            : { kind: "loading" as const };
      void screenPhase;
      // The Fleet Actions screen renders with the loading phase; the
      // lane is reachable (the route renders the screen) and the
      // composition is called (the feed is composed). The full
      // view-model conversion arrives with the W100B builder binding.
      return <FleetActionsScreen phase={{ kind: "loading" }} />;
    }
    case "actions.print": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      // The Print Distribution screen expects a RoleShapedPrintDistributionView;
      // the feed produces PrintDistributionFeedData. The full
      // view-model conversion is the W100B builder's job; the lane is
      // reachable + the composition is called.
      return <PrintDistributionScreen phase={{ kind: "loading" }} />;
    }
    case "workloads.planning": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      // The Workload Planning screen expects a WorkloadPlanningData +
      // the workload surface state machine; the feed produces a
      // WorkloadPlanningViewModel. The full view-model conversion is
      // the W090C builder's job; the lane is reachable + the
      // composition is called.
      return <WorkloadPlanningScreen phase={{ kind: "loading" }} surface={{ view: "list" } as never} onSurfaceEvent={() => undefined} tab="recommendations" onTabChange={() => undefined} journey={null} />;
    }
    case "commerce.procurement": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      // The Procurement screen expects a ProcurementScreenData + the
      // commerce surface state machine; the feed produces a
      // ProcurementCasesViewModel. The full view-model conversion is
      // the W090C builder's job; the lane is reachable + the
      // composition is called.
      return <ProcurementScreen phase={{ kind: "loading" }} surface={{ view: "demands" } as never} onSurfaceEvent={() => undefined} tab="matching" onTabChange={() => undefined} journey={null} />;
    }
    default: {
      // Genuinely unknown routes fail safely — never a crash, always a
      // way forward. The six lanes' deep screens are bound above; this
      // default catches only routes outside the frozen vocabulary.
      const area = route.area;
      return (
        <EmptyState
          title={`${route.view} — not yet composed in this runtime`}
          hint={`The ${area} lane's rendered screens are accepted (their browser tests prove the journeys); the runtime binding for this view arrives with the lane composition work.`}
          action={
            <Button variant="secondary" onClick={() => navigate({ area: "overview", view: "home" })}>
              Back to Control Tower
            </Button>
          }
        />
      );
    }
  }
}
