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
import {
  AppShell,
  ControlTowerScreen,
  EvidenceIndexScreen,
  EvidenceTrailScreen,
  EmptyState,
  Button,
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
  DEMO,
  TENANT_ID as DEMO_TENANT,
  deviceFleetView,
  securityFindingsView,
  approvalsQueueView,
  policiesView,
  learningViews,
} from "./runtime/demo-fleet";
import { environmentLabel } from "./runtime/env";

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

  // W101: the Install Center's controlled state (the W100A machine).
  const [installState, setInstallState] = useState<InstallCenterState>(() =>
    initialInstallCenterState(DEMO_TENANT),
  );
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const release = useMemo<ReleaseManifestLike>(() => demoReleaseManifest(), []);

  // The composed views (deterministic; recomputed per render is fine at
  // demo scale — they are pure functions of the frozen seed).
  const fleetPhase = useMemo(() => {
    const result = deviceFleetView();
    return result.ok ? { kind: "ready" as const, view: result.view } : { kind: "error" as const, message: "The fleet roster refused to compose." };
  }, []);
  const findingsPhase = useMemo(() => {
    const result = securityFindingsView();
    return result.ok ? { kind: "ready" as const, view: result.view } : { kind: "error" as const, message: "The findings view refused to compose." };
  }, []);
  const approvalsPhase = useMemo(() => {
    const result = approvalsQueueView();
    return result.ok ? { kind: "ready" as const, view: result.view } : { kind: "error" as const, message: "The approvals queue refused to compose." };
  }, []);
  const policiesPhases = useMemo<RenderInput["policiesPhases"]>(() => {
    const result = policiesView();
    const historyView: PolicyDecisionHistoryView = {
      tenantId: result.ok ? result.view.tenantId : DEMO_TENANT,
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
  }, []);
  const learningPhases = useMemo(() => {
    const views = learningViews();
    return {
      feed: views.feed.ok ? { kind: "ready" as const, view: views.feed.view } : { kind: "error" as const, message: "feed refused" },
      cases: views.cases.ok ? { kind: "ready" as const, view: views.cases.view } : { kind: "error" as const, message: "cases refused" },
      ledger: views.ledger.ok ? { kind: "ready" as const, view: views.ledger.view } : { kind: "error" as const, message: "ledger refused" },
    };
  }, []);

  const onSearchLanding = useCallback(
    (result: ShellSearchResult): void => {
      const area = result.entry.area;
      navigate({ area, view: entryViewFor(area) });
    },
    [navigate],
  );

  const content = renderRoute({
    route,
    navigate,
    routeValid: !initialRefused && pathToRouteCurrent(route),
    towerView: DEMO.towerView,
    evidenceIndex: DEMO.evidenceIndex,
    evidenceTrails: DEMO.evidenceTrails,
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
  });

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      role={operatorRoleFor(session.activeRole ?? "employee")}
      tenantLabel={session.workspaceName}
      environmentLabel={environmentLabel()}
      records={DEMO.searchRecords}
      onSearchLanding={onSearchLanding}
      chrome={
        <>
          <ApprovalInboxBadge
            pending={approvalsPhase.kind === "ready" ? approvalsPhase.view.total : 0}
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
      const onCreateCode = (): void => {
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
          tenantId: DEMO_TENANT,
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
    case "security.approvals":
      return (
        <ApprovalsQueueScreen
          phase={input.approvalsPhase}
          actingApprover={{ userId: "usr_w091demoop001" } satisfies ActingApprover}
          pendingDecision={null}
          onRequestDecision={() => undefined}
          onCancelDecision={() => undefined}
          onConfirmDecision={() => undefined}
        />
      );
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
    default: {
      // The remaining views render their area's true composed state:
      // the lanes' deep record screens (doctor detail, enrollment
      // journey, find-my, destructive, print, workloads, commerce)
      // arrive with their owning compositions; until then the runtime
      // presents the honest empty/pending state — never fabricated data.
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
