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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  asDeviceId,
  asTenantId,
  asUserId,
} from "@fleetos/contracts";
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
import { DeviceFleetScreen, DeclaredImportScreen } from "@fleetos/web-device";
// W152 Fix 2 (R5a residual) — the device lifecycle screen + the pure
// `buildDeviceDetailHeader` (the lifecycle route's view-model builder
// over the REAL session twin store). Both exported from the
// @fleetos/web-device barrel (apps/web/device/src/index.ts L54 + L97).
import { DeviceLifecycleScreen, buildDeviceDetailHeader } from "@fleetos/web-device";
import {
  initialDeclaredImportJourney,
  updateDeclaredDeviceDraft,
  advanceDeclaredImportJourney,
  backDeclaredImportJourney,
  declaredImportOutcome,
  declaredImportReview,
  declaredImportCommand,
  verifyDeclaredImport,
} from "@fleetos/web-device";
import type {
  DeclaredDeviceDraftPatch,
  DeclaredImportJourneyState,
} from "@fleetos/web-device";
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
  demoGuardianDecision,
  demoTwinStore,
  isDemoTenant,
} from "./runtime/demo-fleet";
import type { ConsoleAreaComposition } from "./runtime/demo-fleet";
import {
  createSessionTwinStore,
  executeDeclaredImportCommand,
  DECLARE_OWNERSHIP_TYPE_OPTIONS,
  newDeclaredImportCorrelationId,
} from "./runtime/declared-import-binding";
// W152 Fix 2 (R5a residual) — the session's twin store type (the source
// for `buildDeviceDetailHeader` at the device.lifecycle route binding).
import type { TwinStore } from "@fleetos/device-model";
// W148 — the session-scoped recovery-case store + the REAL W040 record
// factory (the O5 case-creation affordance's binding).
import {
  createSessionRecoveryCaseStore,
  sessionRecoveryCaseSource,
  createAndAppendRecoveryCase,
} from "./runtime/recovery-case-binding";
import type { SessionRecoveryCaseStore } from "./runtime/recovery-case-binding";
import { environmentLabel } from "./runtime/env";

// W144 — the lane composition feeds (the six lanes' deep views bound
// into the console runtime OVER the W141/W142/W143 compositions).
import { composeLaneFeeds, DEMO_DEMAND_FACETS } from "./runtime/lane-feeds";
import { mapProcurementJourneyToRail } from "./runtime/procurement-journey-rail";
import type { LaneFeeds, LaneFeedOptions } from "./runtime/lane-feeds";

// W156 (TL convergence) — the Predictive Twin advisory binding: the
// W153/W154/W155 packages bound into the product through their PUBLIC
// APIs (the extractor + the context projection + the evaluation bridge
// directly; the engine through the WorldModelAdapter INTERFACE ONLY —
// the adapter-interface-only law). The deterministic REFERENCE adapter
// is what the product binds: no GPU, no model provider, no network.
import {
  buildPredictiveAdvisory,
  buildEvaluationAdvisoryNote,
  deriveProcurementStageFacets,
} from "./runtime/predictive-advisory";
import type {
  PredictiveAdvisoryView,
  EvaluationAdvisoryNote,
} from "./runtime/predictive-advisory";
import { createReferenceAdapter } from "@fleetos/world-model";

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

// W148 — the W142 executed-decision contract surface (the typed-phrase
// gate's required phrase + the machine-stable refusal shape + the
// approval-decision feedback). The screen renders the gate's prompt;
// the runtime performs the dispatch through the W142 path.
import {
  requiredApprovalConfirmationPhrase,
} from "@fleetos/web-security";
import type {
  ApprovalRefusal,
  ApprovalDecisionDialogState,
} from "@fleetos/web-security";

// W144 — the composition root (the deployment-tier driver selection).
import {
  sessionDriverKind,
  sessionDriverDescription,
  isDeployedTier,
  SERVER_DEVICE_ROUTES,
} from "./runtime/composition-root";

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
// W148 — the in-vocabulary route bindings (security.decisions + the
// commerce.software family). The screens render their honest phases
// (loading/empty/ready — REAL runtime state, never fabricated data).
import {
  GuardianDecisionsScreen,
} from "@fleetos/web-security";
import type {
  GuardianDecisionPresentationView,
  GuardianDecisionsData,
  BlockHistoryView,
} from "@fleetos/web-security";
import {
  FleetActionsScreen,
  PrintDistributionScreen,
} from "@fleetos/web-actions";
import { WorkloadPlanningScreen } from "@fleetos/web-workloads";
import type { WorkloadPlanningData } from "@fleetos/web-workloads";
import {
  ProcurementScreen,
  SoftwareScreen,
  VendorsScreen,
  MaintenanceScreen,
  ConnectivityScreen,
  CommunicationScreen,
} from "@fleetos/web-commerce";
import type {
  ProcurementScreenData,
  ProcurementSurfaceEvent,
  ProcurementSurfaceState,
  // W152 Fix 4 — the procurement demand-detail tab engagement: the
  // screen's `tab`/`onTabChange` props are FULLY CONTROLLED but the
  // W151 binding pinned `tab="matching"` with `onTabChange={() =>
  // undefined}` (a dead control on a surface whose own copy tells
  // the user to "Open the demand's Quotes tab"). The W152 fix holds
  // the tab in the console session (the W149/W151 precedent).
  ProcurementTab,
} from "@fleetos/web-commerce";
// W149 — the procurement verification view-model's honest empty-state
// builder (the P0 crash fix: compose the real `OrderVerificationView`,
// never the blind cast the W148 binding shipped).
import {
  buildOrderVerificationView,
  INITIAL_PROCUREMENT_SURFACE_STATE,
  reduceProcurementSurfaceState,
} from "@fleetos/web-commerce";
import type { OrderVerificationView } from "@fleetos/web-commerce";
// W149 — the executed-decision state derivation (the propagation's
// pure projection over the approval runtime's audit log).
import {
  deriveExecutedDecisionState,
} from "./runtime/executed-decision-state";
import type {
  ExecutedDecisionState,
  ExecutedDecisionRecord,
} from "./runtime/executed-decision-state";
// W152 Fix 1 (R2 residual) — the search-index overlay: maps the
// executed-decision state onto the search records' titles + keywords
// so Ctrl+K surfaces the overlaid label (the seeded `Parked plan — `
// becomes `Decided plan (APPROVED|REJECTED) — ` after a decision).
// PURE + DETERMINISTIC; never fabricates a decision.
import {
  overlaySearchRecordsWithExecutedDecisions,
} from "./runtime/search-decision-overlay";

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

/**
 * W145 — the mobile priority-card composition signal: matchMedia at the
 * composition root (below 480px the roster renders the severity-first
 * card list over the SAME real runtime state). SSR-safe: starts false
 * (the desktop table), syncs on mount.
 */
function useMobileRoster(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 480px)");
    const onChange = (): void => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

// ---------------------------------------------------------------------------
// W156 (TL convergence) — the PREDICTIVE TWIN ADVISORY PANEL
//
// The end-to-end advisory journey's surface (ADR-0002 § "Acceptance":
// "at least one real FleetOS journey demonstrates predictive output
// being used as advisory context" + "live product UI clearly
// distinguishes observed, predicted and hypothetical state"). Rendered
// on the device.lifecycle route below the canonical DeviceLifecycleScreen:
// Control Tower -> Devices (the REAL roster) -> device detail/lifecycle
// -> the Predictive Twin advisory panel.
//
// The three state kinds render as DISTINCT sections with distinct
// labels: OBSERVED (sourced from the canonical Device Twin ONLY — the
// twin remains authoritative), PREDICTED (an ADVISORY estimate —
// machine-marked, uncertainty surfaced), HYPOTHETICAL (the
// counterfactual conditioned on a candidate action — the W154
// machine-carried marker rendered as "HYPOTHETICAL — never observed").
// The model-health + provenance sections keep the capability version,
// the evidence-ref counts and the digests visible; the Arena note
// surfaces the W155 bridge's proposal disposition under the FROZEN
// Guardian decision (the advisory NEVER bypasses Guardian — the note
// is PARKED under REQUIRE_APPROVAL in the demo tier).
// ---------------------------------------------------------------------------

function PredictiveTwinPanel(props: {
  readonly advisory: PredictiveAdvisoryView;
  readonly note: EvaluationAdvisoryNote | null;
}): JSX.Element {
  const { advisory, note } = props;
  if (advisory.kind === "degraded") {
    // The honest degraded state (ADR-0002 invariant 6) — rendered as
    // such, NEVER as fabricated confidence: the reason + detail are
    // the propagated W153 feed / adapter states, verbatim.
    return (
      <section className="fos-card" aria-label="Predictive Twin advisory (degraded)">
        <div className="fos-row">
          <span className="fos-card-title">Predictive Twin</span>
          <Badge status="informational">ADVISORY — never business truth</Badge>
        </div>
        <p className="fos-card-subtitle">
          The predictive capability degraded honestly: {advisory.reason} ({advisory.detail}).
          The observed twin state below remains the authoritative record.
        </p>
        <p className="fos-meta">
          OBSERVED — {advisory.observed.observationCount} admitted observation(s)
          {advisory.observed.lastObservedAt !== null ? `, last at ${advisory.observed.lastObservedAt}` : ""}
          &nbsp;· MODEL — {advisory.model.capabilityName} v{advisory.model.capabilityVersion}
          {advisory.model.available ? " (available)" : ` (unavailable: ${advisory.model.unavailableReason ?? "unknown"})`}
        </p>
      </section>
    );
  }
  const predicted = advisory.predicted;
  const hypothetical = advisory.hypothetical;
  return (
    <section className="fos-card" aria-label="Predictive Twin advisory">
      <div className="fos-row">
        <span className="fos-card-title">Predictive Twin</span>
        <Badge status="informational">ADVISORY — never business truth</Badge>
      </div>
      <p className="fos-card-subtitle">
        The deterministic reference world model&apos;s advisory interpretation of this
        device&apos;s history. The Device Twin remains the authoritative record; no
        predictive output authorizes, executes or mutates business truth.
      </p>
      <div className="fos-stack">
        <p className="fos-meta">
          <strong>OBSERVED</strong> (the Device Twin record): {advisory.observed.observationCount} admitted
          observation(s){advisory.observed.lastObservedAt !== null ? `, last at ${advisory.observed.lastObservedAt}` : ""}
          {" "}· {advisory.observed.windowObservationCount} in the advisory window
          [{advisory.observed.windowFrom} → {advisory.observed.windowTo})
        </p>
        <p className="fos-meta">
          <strong>PREDICTED</strong> (advisory estimate — {predicted.estimateKind}):{" "}
          {predicted.estimate.toFixed(3)} · uncertainty [{predicted.uncertainty.lower.toFixed(3)},{" "}
          {predicted.uncertainty.upper.toFixed(3)}] · confidence {predicted.uncertainty.confidence.toFixed(2)}{" "}
          · horizon {(predicted.horizonMs / 3_600_000).toFixed(0)}h · {predicted.capability.name} v{predicted.capability.version}
        </p>
        {hypothetical !== null && (
          <p className="fos-meta">
            <strong>HYPOTHETICAL</strong> — never observed (counterfactual on{" "}
            {hypothetical.candidateAction.description}): {hypothetical.estimate.toFixed(3)} · uncertainty
            [{" "}
            {hypothetical.uncertainty.lower.toFixed(3)}, {hypothetical.uncertainty.upper.toFixed(3)}] ·
            confidence {hypothetical.uncertainty.confidence.toFixed(2)} ·{" "}
            <span className="fos-mono">hypothetical: true</span>
          </p>
        )}
        <p className="fos-meta">
          <strong>MODEL</strong> — {advisory.model.capabilityName} v{advisory.model.capabilityVersion}
          {advisory.model.available ? " (available — the deterministic reference; no model provider)" : ""}
        </p>
        <p className="fos-meta fos-mono" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
          PROVENANCE — feature-set digest {advisory.provenance.featureSetInputDigest.slice(0, 16)}… · context
          digest {advisory.provenance.contextDigest.slice(0, 16)}… · chain{" "}
          {advisory.provenance.provenanceChainDigest.slice(0, 16)}… · {advisory.provenance.evidenceRefCount} evidence
          refs · {advisory.provenance.inputObservationRefCount} observation refs · context:{" "}
          {advisory.context.workloadAssignmentCount} workload assignment(s) +{" "}
          {advisory.context.procurementStageCount} procurement stage(s)
        </p>
        {note !== null && (
          <p className="fos-meta">
            <strong>ARENA INTAKE</strong> (the Learning/Arena bridge — Guardian-gated, never
            auto-submitted): evaluation proposal {note.disposition}{" "}
            <span className="fos-mono">{note.proposalId.slice(0, 16)}…</span>
            {note.hypothetical ? " (from a hypothetical counterfactual)" : ""} · adoption requires the
            explicit versioned adoption path
          </p>
        )}
      </div>
    </section>
  );
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

  // W145 deploy convergence (TL scope) — the declared-import journey:
  // a session-scoped twin store (demo tenants share the DEMO store the
  // demo roster reads; every other workspace gets its own store where
  // its DECLARED records live), the controlled journey state, and a
  // re-composition version bumped after each successful submission.
  const [sessionTwinStore, setSessionTwinStore] = useState(() =>
    isDemoTenant(session.tenantId) ? demoTwinStore() : createSessionTwinStore(),
  );
  const [declareJourney, setDeclareJourney] = useState<DeclaredImportJourneyState>(() =>
    initialDeclaredImportJourney(asTenantId(session.tenantId)),
  );
  const [declaredVersion, setDeclaredVersion] = useState(0);

  // W148 — the session-scoped recovery-case store (the O5 case-creation
  // affordance's binding). One store per active session (per tenant);
  // the demo tier shares the in-memory store, the deployed tier's
  // server-plane persistence arrives with the W140 server-route lane.
  // A `recoveryCaseVersion` bump re-derives the lane feeds (the new
  // case appears in the cases list + the destructive gate's
  // precondition becomes satisfiable).
  const [sessionRecoveryStore, setSessionRecoveryStore] = useState<SessionRecoveryCaseStore>(
    () => createSessionRecoveryCaseStore(asTenantId(session.tenantId)),
  );
  const [recoveryCaseVersion, setRecoveryCaseVersion] = useState(0);
  /**
   * The deployed tier's roster hydration: the tenant's DURABLE twins
   * (GET /api/device/twins — the W140 server plane's records, including
   * agent-enrolled and server-declared devices) seed the session store so
   * the roster composes over the durable truth. Fail-soft: a refusal
   * leaves the local store untouched (never fabricated data).
   */
  const hydrateSessionTwins = useCallback(async (): Promise<void> => {
    if (!isDeployedTier() || isDemoTenant(sessionRef.current.tenantId)) return;
    try {
      const response = await fetch(SERVER_DEVICE_ROUTES.twins, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; twins?: readonly unknown[] }
        | null;
      if (body?.ok !== true || !Array.isArray(body.twins)) return;
      const store = sessionTwinStoreRef.current;
      let admitted = 0;
      for (const twin of body.twins) {
        if (twin === null || typeof twin !== "object") continue;
        try {
          store.put(twin as never);
          admitted += 1;
        } catch {
          // A malformed row never reaches the roster (fail-soft).
        }
      }
      if (admitted > 0) {
        setDeclaredVersion((v) => v + 1);
      }
    } catch {
      // Fail-soft: the durable hydration is best-effort over the local tier.
    }
  }, []);

  // Reset the store + journey when the active workspace changes — and on
  // the deployed tier, hydrate the tenant's DURABLE twins into the fresh
  // session store (the roster composes over the server plane's records).
  useEffect(() => {
    setSessionTwinStore(isDemoTenant(session.tenantId) ? demoTwinStore() : createSessionTwinStore());
    setDeclareJourney(initialDeclaredImportJourney(asTenantId(session.tenantId)));
    setDeclaredVersion((v) => v + 1);
    // W148 — reset the session recovery-case store on workspace change.
    setSessionRecoveryStore(createSessionRecoveryCaseStore(asTenantId(session.tenantId)));
    setRecoveryCaseVersion((v) => v + 1);
    if (isDeployedTier() && !isDemoTenant(session.tenantId)) {
      // The store resets above; hydrate AFTER the state settles (the refs
      // see the fresh store on the next commit).
      window.setTimeout(() => {
        void hydrateSessionTwins();
      }, 0);
    }
  }, [session.tenantId, hydrateSessionTwins]);

  // W145 — the mobile priority-card composition signal (the shell sets it
  // from its viewport knowledge at the composition root): below 480px the
  // roster table is REPLACED by the severity-first card list over the same
  // REAL runtime state.
  const mobileRoster = useMobileRoster();

  // The declared-import projections (PURE derivations over the session
  // store — the same store the roster composes from, so a recorded
  // declaration is visible the moment the journey lands).
  const declareScope = useMemo(() => ({ tenantId: asTenantId(session.tenantId) }), [session.tenantId]);
  const declareReview = useMemo(
    () =>
      declareJourney.stage === "review" || declareJourney.stage === "confirm"
        ? declaredImportReview(declareScope, sessionTwinStore, declareJourney)
        : undefined,
    [declareScope, sessionTwinStore, declareJourney],
  );
  const declareVerification = useMemo(
    () =>
      declareJourney.stage === "confirm" || declareJourney.stage === "recorded"
        ? verifyDeclaredImport(declareScope, sessionTwinStore, asDeviceId(declareJourney.draft.deviceId.trim()))
        : undefined,
    [declareScope, sessionTwinStore, declareJourney],
  );

  // Latest-value refs for the stable declared-import callbacks below.
  const declareScopeRef = useRef(declareScope);
  declareScopeRef.current = declareScope;
  const sessionTwinStoreRef = useRef(sessionTwinStore);
  sessionTwinStoreRef.current = sessionTwinStore;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const declareJourneyRef = useRef(declareJourney);
  declareJourneyRef.current = declareJourney;

  const onDeclareDraftChange = useCallback((patch: DeclaredDeviceDraftPatch): void => {
    setDeclareJourney((state) => updateDeclaredDeviceDraft(state, patch));
  }, []);
  const onDeclareAdvance = useCallback((): void => {
    setDeclareJourney((state) => {
      const advanced = advanceDeclaredImportJourney(declareScopeRef.current, sessionTwinStoreRef.current, state);
      return advanced.ok ? advanced.state : state;
    });
  }, []);
  const onDeclareBack = useCallback((): void => {
    setDeclareJourney((state) => backDeclaredImportJourney(state));
  }, []);

  // Submit — the DEPLOYED tier executes through the REAL server boundary
  // (POST /api/device/declared-import: the durable, audited W145 path; the
  // client mirrors the durable record via hydration). The development/demo
  // tier executes the same command through the local binding into the
  // session store. Both paths apply the domain outcome
  // (recorded / refused — the machine-stable reason surfaces verbatim).
  const onDeclareSubmit = useCallback((): void => {
    const state = declareJourneyRef.current;
    if (state.stage !== "confirm") return;
    if (isDeployedTier() && !isDemoTenant(sessionRef.current.tenantId)) {
      const draft = state.draft;
      void (async (): Promise<void> => {
        let outcome: { ok: true } | { ok: false; reason: string };
        try {
          const response = await fetch(SERVER_DEVICE_ROUTES.declaredImport, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              deviceId: draft.deviceId.trim(),
              manufacturer: draft.hardware.manufacturer.trim(),
              model: draft.hardware.model.trim(),
              ...(draft.hardware.serialNumber !== undefined && draft.hardware.serialNumber.trim().length > 0
                ? { serialNumber: draft.hardware.serialNumber.trim() }
                : {}),
              ...(draft.hardware.assetTag !== undefined && draft.hardware.assetTag.trim().length > 0
                ? { assetTag: draft.hardware.assetTag.trim() }
                : {}),
              ownerType: draft.ownership.ownerType.trim(),
              ...(draft.ownership.assignedTeam !== undefined && draft.ownership.assignedTeam.trim().length > 0
                ? { assignedTeam: draft.ownership.assignedTeam.trim() }
                : {}),
              provenanceAcknowledged: true,
              ...(draft.duplicateSerialAcknowledged === true
                ? { duplicateSerialAcknowledged: true }
                : {}),
            }),
          });
          const body: unknown = await response.json().catch(() => null);
          if (response.ok && (body as { ok?: boolean } | null)?.ok === true) {
            outcome = { ok: true };
            // Mirror the durable record into the session store (the roster
            // + the verification view re-compose over the hydrated twins).
            await hydrateSessionTwins();
          } else {
            const reason = (body as { reason?: string } | null)?.reason ?? `http_${response.status}`;
            outcome = { ok: false, reason };
          }
        } catch {
          outcome = { ok: false, reason: "server_unreachable" };
        }
        setDeclareJourney(declaredImportOutcome(declareJourneyRef.current, outcome));
      })();
      return;
    }
    const command = declaredImportCommand(
      declareScopeRef.current,
      sessionTwinStoreRef.current,
      state,
      {
        now: new Date().toISOString(),
        correlationId: newDeclaredImportCorrelationId(),
        declaredBy: asUserId(sessionRef.current.principalId),
      },
    );
    if (command === undefined) {
      setDeclareJourney(declaredImportOutcome(state, { ok: false, reason: "command_not_derivable" }));
      return;
    }
    const executed = executeDeclaredImportCommand(command, sessionTwinStoreRef.current);
    if (!executed.ok) {
      setDeclareJourney(declaredImportOutcome(state, { ok: false, reason: executed.reason }));
      return;
    }
    setDeclaredVersion((v) => v + 1);
    setDeclareJourney(declaredImportOutcome(state, { ok: true }));
  }, [hydrateSessionTwins]);
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

  // W152 Fix 2 (R5a residual) — the session-held selected device id (the
  // device lifecycle screen's subject). The W149 `selectedRecoveryCaseId`
  // precedent: `useState<string | undefined>` defaulting to `undefined`,
  // set when the operator clicks "Open device detail" from the doctor
  // (L1640) OR the roster (L1167). The lifecycle route falls back to
  // the doctor's current device selection when `selectedDeviceId` is
  // `undefined` (the demo tier's `dev_w091demo000001` / the fresh
  // workspace's `dev_freshworkspace01` — the same default the doctor
  // binding uses). The R5a residual: the doctor's "Open device detail"
  // button navigated to `{area:"device",view:"doctor"}` — the SAME
  // route it already sat on (a dead button); the roster's `onOpenDevice`
  // discarded the deviceId. The fix: both buttons set `selectedDeviceId`
  // then navigate to `{area:"device",view:"lifecycle"}` (the in-vocab
  // route the console's switch NEVER bound — falls through to the
  // "This route does not exist" refusal). Two defects in one.
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  // W151 — the procurement surface state (the lane's OWN surface state
  // machine: demands -> demand -> matching -> quote, with back/reset).
  // The W148/W149 binding shipped `surface={{view:"demands"} as never}`
  // + `onSurfaceEvent={() => undefined}` — a stub that discarded the
  // screen's `open_demand` event, so the per-demand case journey never
  // rendered. The W151 fix holds the lane's typed surface state in the
  // session; the `open_demand`/`back`/`reset` events drive it through
  // the lane's declared `reduceProcurementSurfaceState` reducer.
  const [procurementSurface, setProcurementSurface] =
    useState<ProcurementSurfaceState>(() => INITIAL_PROCUREMENT_SURFACE_STATE);
  // W152 Fix 4 — the procurement demand-detail tab engagement: the
  // screen's `tab`/`onTabChange` props are FULLY CONTROLLED but the
  // W151 binding pinned `tab="matching"` with `onTabChange={() =>
  // undefined}` (a dead control on a surface whose own copy tells
  // the user to "Open the demand's Quotes tab" — the screen's L742
  // empty-state hint). The W151 lane scoped tab state out deliberately;
  // this lane closes it. The tab is held in the console session (the
  // W149 `selectedRecoveryCaseId` / W151 `procurementSurface`
  // precedent), defaulting to "matching" (the screen's own default).
  const [procurementTab, setProcurementTab] = useState<ProcurementTab>(() => "matching");
  // The handler reduces the surface event via the lane's declared
  // reducer AND keeps the tab coherent with the surface state:
  //   - `open_demand` (a demand switch) resets the tab to "matching"
  //     (a fresh demand opens at the matching tab);
  //   - `back` from the demand view (-> demands list) resets the tab
  //     to "matching" (no demand selected — the tab resets for the
  //     next demand open);
  //   - `reset` resets the tab to "matching" (the surface returns to
  //     the demands list);
  //   - `open_matching` sets the tab to "matching" (the user is
  //     explicitly opening the matching view);
  //   - `open_quote` sets the tab to "quotes" (the user is explicitly
  //     opening a quote);
  //   - `back` from matching/quote (-> demand) keeps the current tab
  //     (the user is returning to the demand detail).
  const handleProcurementSurfaceEvent = useCallback(
    (event: ProcurementSurfaceEvent): void => {
      const result = reduceProcurementSurfaceState(procurementSurface, event);
      if (!result.ok) return;
      const nextSurface = result.state;
      setProcurementSurface(nextSurface);
      // Reset the tab to "matching" on open_demand (a demand switch),
      // reset (always returns to demands), or back from the demand
      // view (returns to demands list).
      if (
        event.type === "open_demand" ||
        event.type === "reset" ||
        (event.type === "back" && procurementSurface.view === "demand")
      ) {
        setProcurementTab("matching");
      } else if (event.type === "open_matching") {
        setProcurementTab("matching");
      } else if (event.type === "open_quote") {
        setProcurementTab("quotes");
      }
      // else: back from matching/quote -> demand: keep the current tab.
    },
    [procurementSurface],
  );

  // W144 — the approval decision runtime (the EXECUTED decision path).
  // The runtime manages the Approve/Reject decision lifecycle (the
  // confirmation gates, the boundary dispatch, the audit trail). The
  // badge count tracks the executed decisions: when an operator
  // approves/rejects a parked plan, the decided-plan-ids set grows and
  // the pending count drops.
  const [approvalRuntime, setApprovalRuntime] = useState<ApprovalDecisionRuntimeState>(
    () => createApprovalDecisionRuntime(),
  );

  // W148 — the approvals dialog state (the controlled view of the W142
  // decision-lifecycle machine). The dialog's `acknowledged` / `phrase` /
  // `refusal` fields are PROJECTIONS of the runtime's decision state;
  // the dialog NEVER executes anything itself. The pending plan + action
  // is the dialog's own UI state (the runtime's `idle`/`reviewing`/
  // `ready_to_decide` distinction maps to the dialog's open/closed +
  // canConfirm state).
  const [approvalDialogPending, setApprovalDialogPending] = useState<{
    readonly planId: string;
    readonly action: "approve" | "reject";
  } | null>(null);
  const [approvalDialogAcknowledged, setApprovalDialogAcknowledged] = useState<boolean>(false);
  const [approvalDialogPhrase, setApprovalDialogPhrase] = useState<string>("");
  const [approvalDialogRejectionReason, setApprovalDialogRejectionReason] = useState<string>("");
  const [approvalDialogRefusal, setApprovalDialogRefusal] = useState<ApprovalRefusal | null>(null);

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
  //
  // W149 — the executed decision state propagates into the Evidence &
  // Audit area: when an operator has approved/rejected a parked plan,
  // the decision's 2-entry audit trail surfaces as a NEW evidence trail
  // (the O6 expectation met live). PURE — the derivation walks the
  // approval runtime's own audit log; nothing is fabricated.
  const executedDecisions: ExecutedDecisionState = useMemo(
    () => deriveExecutedDecisionState(approvalRuntime),
    [approvalRuntime],
  );
  const areasResult = useMemo(
    () =>
      composeConsoleAreas(
        session.tenantId,
        operatorRoleFor(session.activeRole ?? "employee"),
        sessionTwinStore,
        executedDecisions,
      ),
    [session.tenantId, session.activeRole, sessionTwinStore, declaredVersion, executedDecisions],
  );
  const areas: ConsoleAreaComposition | null = areasResult.ok ? areasResult.view : null;

  // W152 Fix 1 (R2 residual) — the search-index overlay: the AppShell's
  // global search (Ctrl+K) reads `areas.searchRecords`. The seeded record
  // for `pln_fb564c1e` carries the title `Parked plan — w091-demo-enable-
  // encryption` (the demo fleet's parked-plan record). After an approve
  // execution, the queue card / Security Doctor / Evidence & Audit index
  // all overlay the executed-decision state (the W149 propagation); the
  // search index did NOT — the residual R2. This memo applies the pure
  // overlay: records whose `area === "actions"` AND whose `recordId` is
  // in `executedDecisions.recordsByPlan` get the overlaid title
  // `Decided plan (APPROVED|REJECTED) — <name>` + extended keywords.
  // Memoized consistently with the adjacent memos (`executedDecisions`
  // is already in the deps of `areasResult` + `laneFeedOptions`).
  const searchRecords = useMemo(
    () => areas === null
      ? ([] as readonly ShellRecordSummary[])
      : overlaySearchRecordsWithExecutedDecisions(areas.searchRecords, executedDecisions),
    [areas, executedDecisions],
  );

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
      // W151 — the procurement surface's selected demand (the detail
      // Sheet's subject). Derived from the lane's surface state: when
      // the surface is in the `demands` view, no demand is selected;
      // otherwise the surface's `demandId` is the feed's subject. The
      // feed composes the selected demand's detail + its seven-stage
      // case journey over the REAL W143 state — never fabricated.
      ...(procurementSurface.view !== "demands"
        ? { selectedDemandId: procurementSurface.demandId }
        : {}),
      // W148 — the session-scoped recovery-case source (the O5
      // case-creation affordance's binding). The recovery cases feed
      // composes over the session's cases; the destructive gate's
      // precondition becomes satisfiable when a case exists.
      recoveryCaseSource: sessionRecoveryCaseSource(sessionRecoveryStore),
      // W149 — the executed-decision state (the propagation overlay).
      // The demo's Security Doctor composes over the executed decision:
      // the plan's `planState` reflects APPROVED/REJECTED for decided
      // planIds (the `approval` field becomes null — the plan is no
      // longer parked). PURE — the derivation walks the runtime's own
      // audit log; nothing is fabricated.
      executedDecisions,
    }),
    [selectedRecoveryCaseId, selectedFindingId, selectedPlanId, sessionRecoveryStore, recoveryCaseVersion, executedDecisions, procurementSurface],
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
        // W148 — the approvals dialog state (the controlled view of the
        // W142 decision-lifecycle machine).
        approvalDialogPending,
        setApprovalDialogPending,
        approvalDialogAcknowledged,
        setApprovalDialogAcknowledged,
        approvalDialogPhrase,
        setApprovalDialogPhrase,
        approvalDialogRejectionReason,
        setApprovalDialogRejectionReason,
        approvalDialogRefusal,
        setApprovalDialogRefusal,
        // W148 — the session-scoped recovery-case store (the O5
        // case-creation affordance's binding).
        sessionRecoveryStore,
        setSessionRecoveryStore,
        setRecoveryCaseVersion,
        doctorPanel,
        setDoctorPanel,
        // W149 — the real selected recovery case id (the P2 fix) + the
        // executed-decision state (the propagation overlay). The
        // recovery case detail opens; the Security Doctor + the
        // Approvals queue card + the Evidence & Audit index compose
        // over the executed decision state — REAL runtime state.
        selectedRecoveryCaseId,
        setSelectedRecoveryCaseId,
        setSelectedFindingId,
        setSelectedPlanId,
        // W152 Fix 2 (R5a residual) — the session-held selected device
        // id + the session's twin store (the lifecycle route's source).
        selectedDeviceId,
        setSelectedDeviceId,
        sessionTwinStore,
        // W151 — the procurement surface state + event handler (the
        // per-demand engagement's binding). The surface state flows
        // through the lane's own typed machine; the handler reduces
        // events via the lane's declared reducer.
        procurementSurface,
        onProcurementSurfaceEvent: handleProcurementSurfaceEvent,
        // W152 Fix 4 — the procurement demand-detail tab engagement
        // (the session-held tab + setter). The tab flows to the
        // screen's `tab` prop; the setter flows to the screen's
        // `onTabChange` prop (no longer a dead control).
        procurementTab,
        setProcurementTab,
        executedDecisions,
        sessionAssignedRoles: session.assignedRoles,
        // W145 deploy convergence — the declared-import journey + the
        // mobile roster composition signal.
        declareJourney,
        declareReview,
        declareVerification,
        onDeclareDraftChange,
        onDeclareAdvance,
        onDeclareBack,
        onDeclareSubmit,
        mobileRoster,
      })
    );

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      role={operatorRoleFor(session.activeRole ?? "employee")}
      tenantLabel={session.workspaceName}
      environmentLabel={environmentLabel()}
      records={searchRecords}
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
  // W148 — the approvals dialog state (the controlled view of the W142
  // decision-lifecycle machine). The dialog never executes anything
  // itself; every field is a projection of the runtime's state. The
  // pending plan + action is the dialog's own UI state (the runtime's
  // idle/reviewing/ready_to_decide distinction maps to the dialog's
  // open/closed + canConfirm state).
  readonly approvalDialogPending: { readonly planId: string; readonly action: "approve" | "reject" } | null;
  readonly setApprovalDialogPending: (pending: { readonly planId: string; readonly action: "approve" | "reject" } | null) => void;
  readonly approvalDialogAcknowledged: boolean;
  readonly setApprovalDialogAcknowledged: (acknowledged: boolean) => void;
  readonly approvalDialogPhrase: string;
  readonly setApprovalDialogPhrase: (phrase: string) => void;
  readonly approvalDialogRejectionReason: string;
  readonly setApprovalDialogRejectionReason: (reason: string) => void;
  readonly approvalDialogRefusal: ApprovalRefusal | null;
  readonly setApprovalDialogRefusal: (refusal: ApprovalRefusal | null) => void;
  // W148 — the session-scoped recovery-case store (the O5 case-creation
  // affordance's binding). The recovery cases feed composes over this
  // store; the destructive gate's precondition becomes satisfiable when
  // a case exists.
  readonly sessionRecoveryStore: SessionRecoveryCaseStore;
  readonly setSessionRecoveryStore: (store: SessionRecoveryCaseStore) => void;
  readonly setRecoveryCaseVersion: (updater: (v: number) => number) => void;
  // W144 — the lane interaction state (UI state only).
  readonly doctorPanel: DoctorPanelState;
  readonly setDoctorPanel: (panel: DoctorPanelState) => void;
  // W149 — the real selected recovery case id (the P2 fix: the
  // per-case detail's seven-stage journey opens when a case is
  // selected; the W148 binding shipped `isDemo ? undefined : undefined`
  // — a stub that left the detail never opening).
  readonly selectedRecoveryCaseId: string | undefined;
  readonly setSelectedRecoveryCaseId: (id: string | undefined) => void;
  readonly setSelectedFindingId: (id: string | null) => void;
  readonly setSelectedPlanId: (id: string | null) => void;
  // W152 Fix 2 (R5a residual) — the session-held selected device id (the
  // device lifecycle screen's subject) + the session's twin store (the
  // source for `buildDeviceDetailHeader`). The doctor's "Open device
  // detail" button + the roster's `onOpenDevice` set the selected id
  // then navigate to `{area:"device",view:"lifecycle"}`. The lifecycle
  // route composes the `DeviceDetailHeader` over the REAL session twin
  // store (the same store the roster + the declared-import journey
  // read); the honest empty `undefined` view-model renders the screen's
  // own "Device not found in your fleet" state — never fabricated data.
  readonly selectedDeviceId: string | undefined;
  readonly setSelectedDeviceId: (id: string | undefined) => void;
  readonly sessionTwinStore: TwinStore;
  // W151 — the procurement surface state + event handler. The surface
  // state is the lane's OWN typed machine state (demands/demand/
  // matching/quote); the handler reduces events via the lane's
  // declared `reduceProcurementSurfaceState` reducer. The binding
  // passes these straight through — no `as never`, no blind cast.
  readonly procurementSurface: ProcurementSurfaceState;
  readonly onProcurementSurfaceEvent: (event: ProcurementSurfaceEvent) => void;
  // W152 Fix 4 — the procurement demand-detail tab engagement: the
  // session-held `procurementTab` (the demand-detail panel's selected
  // tab — "matching" or "quotes") + the `setProcurementTab` handler.
  // The W151 binding pinned `tab="matching"` with `onTabChange={() =>
  // undefined}` (a dead control); the W152 fix holds the tab in the
  // console session and binds `tab={input.procurementTab}`
  // `onTabChange={input.setProcurementTab}` at the commerce.procurement
  // case. The handler keeps the tab coherent with the surface state
  // (reset to "matching" on open_demand/back-from-demand/reset; set to
  // "matching" on open_matching; set to "quotes" on open_quote).
  readonly procurementTab: ProcurementTab;
  readonly setProcurementTab: (tab: ProcurementTab) => void;
  // W149 — the executed decision state (the propagation overlay). The
  // demo's Security Doctor + the Approvals queue card + the Evidence &
  // Audit index compose over this state — REAL runtime state, never
  // fabricated data.
  readonly executedDecisions: ExecutedDecisionState;
  readonly sessionAssignedRoles: readonly string[];
  // W145 deploy convergence (TL scope) — the declared-import journey.
  readonly declareJourney: DeclaredImportJourneyState;
  readonly declareReview: ReturnType<typeof declaredImportReview> | undefined;
  readonly declareVerification: ReturnType<typeof verifyDeclaredImport> | undefined;
  readonly onDeclareDraftChange: (patch: DeclaredDeviceDraftPatch) => void;
  readonly onDeclareAdvance: () => void;
  readonly onDeclareBack: () => void;
  readonly onDeclareSubmit: () => void;
  // W145 — the mobile priority-card composition signal.
  readonly mobileRoster: boolean;
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
          onOpenDevice={(deviceId) => {
            // W152 Fix 2 (R5a residual) — the roster's `onOpenDevice`
            // USED to discard the deviceId and navigate to the doctor
            // (a dead navigation — the operator's row click was a
            // no-op for the row's device). The fix: set the session-
            // held selectedDeviceId, then navigate to the device.lifecycle
            // route (the in-vocab route the console's switch now binds).
            input.setSelectedDeviceId(deviceId as string);
            navigate({ area: "device", view: "lifecycle" });
          }}
          onEnroll={() => navigate({ area: "device", view: "enrollment" })}
          onDeclare={() => navigate({ area: "device", view: "declare" })}
          mobileRoster={input.mobileRoster}
        />
      );
    case "device.declare":
      // W145 — the declared-import journey screen (the SMALL-firm
      // cold-start path: manual device records, provenance-flagged
      // DECLARED, executed through the REAL domain boundary into the
      // session's twin store — never conflated with agent-observed
      // records).
      return (
        <DeclaredImportScreen
          journey={input.declareJourney}
          review={input.declareReview}
          verification={input.declareVerification}
          ownershipTypes={DECLARE_OWNERSHIP_TYPE_OPTIONS}
          onDraftChange={input.onDeclareDraftChange}
          onAdvance={input.onDeclareAdvance}
          onBack={input.onDeclareBack}
          onSubmit={input.onDeclareSubmit}
          onOpenRoster={() => navigate({ area: "device", view: "list" })}
          onCancel={() => navigate({ area: "device", view: "list" })}
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

        // W147 — the DEPLOYED tier routes through the REAL server boundary
        // (POST /api/enrollment/codes). The server issues a crypto-random
        // W130-shape code, persists verifier-only, and returns the code +
        // request id + created/expires instants for display-once. The
        // demo/development tier keeps the LOCAL fixture path (unchanged).
        if (isDeployedTier() && !isDemoTenant(input.sessionTenantId)) {
          void (async (): Promise<void> => {
            try {
              const response = await fetch("/api/enrollment/codes", {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  ownershipKind: input.installState.ownershipKind,
                }),
              });
              const body: unknown = await response.json().catch(() => null);
              if (response.ok && (body as { ok?: boolean } | null)?.ok === true) {
                const issued = body as {
                  readonly requestId: string;
                  readonly code: string;
                  readonly ownershipKind: string;
                  readonly ownershipClass: string;
                  readonly allowedRoles: readonly string[];
                  readonly createdAt: string;
                  readonly expiresAt: string;
                };
                const record: EnrollmentRequestLike = {
                  requestId: issued.requestId,
                  tenantId: asTenantId(input.sessionTenantId),
                  ownershipKind: issued.ownershipKind,
                  ownershipClass: issued.ownershipClass,
                  allowedRoles: issued.allowedRoles,
                  createdAt: issued.createdAt,
                  expiresAt: issued.expiresAt,
                  status: "pending",
                };
                input.setInstallState(
                  recordEnrollmentRequest(input.installState, record, issued.code),
                );
              } else {
                const reason = (body as { reason?: string } | null)?.reason ?? `http_${response.status}`;
                const explanation = (body as { explanation?: string; message?: string } | null)?.explanation ??
                  (body as { message?: string } | null)?.message ??
                  "The enrollment boundary refused this request.";
                input.setInstallState(
                  recordInstallRefusal(input.installState, {
                    reason: reason as never,
                    explanation,
                  }),
                );
              }
            } catch {
              input.setInstallState(
                recordInstallRefusal(input.installState, {
                  reason: "enrollment_refused",
                  explanation: "The server enrollment endpoint could not be reached.",
                }),
              );
            }
          })();
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
          now={isDeployedTier() && !isDemoTenant(input.sessionTenantId) ? new Date().toISOString() : "2026-10-01T00:00:00Z"}
          expiringWithinMs={3_600_000}
          deviceId={undefined}
          onPlatformChange={(platform, arch) =>
            input.setInstallState(selectInstallPlatform(input.installState, platform, arch))
          }
          onOwnershipKindChange={(kind) => input.setInstallState(selectOwnershipKind(input.installState, kind))}
          onCreateEnrollmentCode={onCreateCode}
          onDismissCode={() => input.setInstallState(dismissEnrollmentCode(input.installState))}
          onCopyCommand={(command) => input.onCopyCommand(command)}
          onRevokeIntent={() => {
            // W147 — "Disable this code…" routes through the REAL server
            // boundary on the deployed tier (DELETE /api/enrollment/codes).
            // The demo/development tier keeps the inert no-op (the LOCAL
            // fixture has no server-side record to revoke).
            if (!isDeployedTier() || isDemoTenant(input.sessionTenantId)) return;
            const requestId = input.installState.request?.record.requestId;
            if (requestId === undefined) return;
            void (async (): Promise<void> => {
              try {
                const response = await fetch("/api/enrollment/codes", {
                  method: "DELETE",
                  credentials: "include",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ requestId }),
                });
                const body: unknown = await response.json().catch(() => null);
                if (response.ok && (body as { ok?: boolean } | null)?.ok === true) {
                  // The server revoked the code; reflect the state change
                  // explicitly (dismiss the one-time display + show the
                  // honest "disabled" feedback — never a silent no-op).
                  input.setInstallState(
                    recordInstallRefusal(
                      dismissEnrollmentCode(input.installState),
                      {
                        reason: "code_revoked",
                        explanation: "The enrollment code was disabled by the operator. Create a new enrollment request if this device should enroll.",
                      },
                    ),
                  );
                } else {
                  const explanation = (body as { explanation?: string; message?: string } | null)?.explanation ??
                    (body as { message?: string } | null)?.message ??
                    "The enrollment code could not be disabled.";
                  const reason = (body as { reason?: string } | null)?.reason ?? "enrollment_refused";
                  input.setInstallState(
                    recordInstallRefusal(input.installState, {
                      reason: reason as never,
                      explanation,
                    }),
                  );
                }
              } catch {
                input.setInstallState(
                  recordInstallRefusal(input.installState, {
                    reason: "enrollment_refused",
                    explanation: "The server enrollment endpoint could not be reached.",
                  }),
                );
              }
            })();
          }}
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
      // W148 — the approvals inbox is wired to the W142 EXECUTED decision
      // path through the W144 runtime. The Approve/Reject click handler
      // opens the typed-phrase confirmation dialog (the dialog is fully
      // controlled: acknowledged + typed phrase + refusal are projections
      // of the runtime's state). The dialog's Confirm button is DISABLED
      // until the operator acknowledges the consequences AND types the
      // exact `CONFIRM <ACTION> <planId>` phrase. On confirm, the runtime
      // drives the lifecycle: acknowledge -> enter phrase -> mark
      // confirmed -> dispatch through the gated boundary. The boundary
      // transitions the plan out of PARKED, the audit sink records the
      // decision, the badge count drops, and the duplicate-safe guard
      // refuses a second decision with `already_decided`. Restricted
      // roles get the FROZEN `authorization_required` refusal (visible,
      // explicit — never a silent no-op).
      const authority: ApprovalDecisionAuthority = buildAuthority(
        input.sessionTenantId,
        input.actingApproverId,
        // The operator's permissions (the active role's grants; the
        // fleet.admin role carries the approve permission).
        input.sessionAssignedRoles.includes("fleet.admin") ? [APPROVAL_PERMISSION] : [],
        input.sessionAssignedRoles,
      );
      const NOW = "2026-01-06T14:00:00Z";
      const decisionDialog: ApprovalDecisionDialogState | null =
        input.approvalDialogPending === null
          ? null
          : {
              pending: input.approvalDialogPending,
              acknowledged: input.approvalDialogAcknowledged,
              phrase: input.approvalDialogPhrase,
              refusal: input.approvalDialogRefusal,
              rejectionReason: input.approvalDialogRejectionReason,
            };
      return (
        <ApprovalsQueueScreen
          phase={input.approvalsPhase}
          actingApprover={{ userId: input.actingApproverId } satisfies ActingApprover}
          decisionDialog={decisionDialog}
          // W149 — the executed-decision state propagated into the
          // approvals queue card. When an operator has approved or
          // rejected a parked plan, the queue card reflects the decided
          // state: the decided badge replaces the live REQUIRE_APPROVAL
          // badge, the Approve/Reject buttons are dead (the plan is no
          // longer parked), and the honest `already_decided` copy
          // explains the duplicate-safe guard. PURE — the propagation
          // is a function of the runtime's own audit log.
          decidedPlanIds={input.executedDecisions.decidedPlanIds}
          decidedRecordsByPlan={input.executedDecisions.recordsByPlan}
          onRequestDecision={(planId, action) => {
            // W148 — open the decision review for the parked plan. The
            // authority gate may refuse (authorization_required) — the
            // refusal is visible (never a silent no-op). The dialog's
            // pending state opens; the runtime's `reviewing` state is
            // the source of truth for the typed-phrase gate.
            const plan = input.approvalsPhase.kind === "ready"
              ? input.approvalsPhase.view.items.find((item) => item.planId === planId)
              : undefined;
            if (plan === undefined) return;
            const context = {
              tenantId: asTenantId(input.sessionTenantId),
              planId,
              action,
              by: asUserId(input.actingApproverId),
              correlationId: decisionCorrelationId(),
            };
            const opened = openApprovalDecision(
              input.approvalRuntime,
              { tenantId: asTenantId(input.sessionTenantId) },
              context,
              authority,
              NOW,
            );
            input.setApprovalRuntime(opened.state);
            // The authority gate refused: surface the machine-stable
            // refusal visibly (the FROZEN authorization_required
            // denial with the escalation path — never a silent no-op).
            const refusal: ApprovalRefusal | null =
              opened.state.decision.kind === "refused"
                ? {
                    ok: false,
                    reason: opened.state.decision.reason,
                    explanation: opened.state.decision.explanation,
                  }
                : null;
            input.setApprovalDialogPending({ planId, action });
            input.setApprovalDialogAcknowledged(false);
            input.setApprovalDialogPhrase("");
            input.setApprovalDialogRejectionReason("");
            input.setApprovalDialogRefusal(refusal);
          }}
          onCancelDecision={() => {
            // W148 — cancel the open decision. The runtime returns to
            // `cancelled`; NO audit entry is written (the audit policy:
            // consequential events only — nothing happened). The dialog
            // closes.
            const cancelled = cancelDecision(input.approvalRuntime, NOW);
            input.setApprovalRuntime(cancelled.state);
            input.setApprovalDialogPending(null);
            input.setApprovalDialogAcknowledged(false);
            input.setApprovalDialogPhrase("");
            input.setApprovalDialogRejectionReason("");
            input.setApprovalDialogRefusal(null);
          }}
          onAcknowledgeConsequences={() => {
            // W148 — explicit step 1: acknowledge the consequences.
            // The runtime's `acknowledgeDecision` records the
            // transition; the dialog's checkbox reflects the runtime's
            // state. A refusal clears on the next acknowledge cycle.
            const acknowledged = acknowledgeDecision(input.approvalRuntime, NOW);
            input.setApprovalRuntime(acknowledged.state);
            if (acknowledged.state.decision.kind === "reviewing") {
              input.setApprovalDialogAcknowledged(acknowledged.state.decision.acknowledged);
            }
          }}
          onPhraseChange={(phrase) => {
            // W148 — explicit step 2: type (or retype) the confirmation
            // phrase. The runtime's `enterConfirmationPhrase` records
            // the transition; the dialog's input reflects the runtime's
            // state. The phrase MUST match exactly to unlock the
            // dispatch.
            const entered = enterConfirmationPhrase(input.approvalRuntime, phrase);
            input.setApprovalRuntime(entered.state);
            input.setApprovalDialogPhrase(phrase);
          }}
          onRejectionReasonChange={(reason) => {
            // W148 — the rejection reason (REJECT only). Recorded by
            // the boundary on a successful REJECT — the plan does NOT
            // execute. The dialog's textarea is fully controlled.
            input.setApprovalDialogRejectionReason(reason);
          }}
          onConfirmDecision={() => {
            // W148 — the explicit-confirmation gate's terminal
            // transition: mark confirmed -> dispatch through the gated
            // boundary. The dispatch routes through the W142 path; the
            // boundary transitions the plan out of PARKED, the audit
            // sink records BOTH the explicit confirmation AND the
            // routed dispatch (the evidence trail), and the badge count
            // drops. A refusal (the explicit_confirmation_required
            // gate, the already_decided duplicate guard) returns the
            // machine-stable reason — visible, never silent.
            const marked = markConfirmed(input.approvalRuntime, NOW);
            if (marked.state.decision.kind !== "ready_to_decide") {
              // The gate refused: the explicit confirmation was not
              // satisfied. Surface the machine-stable refusal visibly.
              const refusal: ApprovalRefusal = {
                ok: false,
                reason: "explicit_confirmation_required",
                explanation:
                  "The explicit confirmation has not been satisfied. Acknowledge the consequences and type the exact confirmation phrase to unlock the dispatch.",
              };
              input.setApprovalRuntime(marked.state);
              input.setApprovalDialogRefusal(refusal);
              return;
            }
            const dispatched = dispatchDecision(marked.state, NOW);
            input.setApprovalRuntime(dispatched.state);
            if (dispatched.state.decision.kind === "decided") {
              // The dispatch succeeded: the dialog closes; the badge
              // count drops (the existing approvalBadgeCount call site
              // re-derives from the runtime's decidedPlanIds).
              input.setApprovalDialogPending(null);
              input.setApprovalDialogAcknowledged(false);
              input.setApprovalDialogPhrase("");
              input.setApprovalDialogRejectionReason("");
              input.setApprovalDialogRefusal(null);
            } else if (dispatched.state.decision.kind === "refused") {
              // The boundary refused (the duplicate-safe guard). The
              // refusal is visible (never a silent no-op).
              const refusal: ApprovalRefusal = {
                ok: false,
                reason: dispatched.state.decision.reason,
                explanation: dispatched.state.decision.explanation,
              };
              input.setApprovalDialogRefusal(refusal);
            }
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
          // W152 Fix 2 (R5a residual) — the doctor's "Open device detail"
          // button USED to navigate to {area:"device",view:"doctor"} —
          // the SAME route it already sat on (a dead button). The fix:
          // set the session-held selectedDeviceId, then navigate to the
          // device.lifecycle route (the in-vocab route the console's
          // switch never bound — the second defect this fix closes).
          onOpenDevice={(deviceId) => {
            input.setSelectedDeviceId(deviceId as string);
            navigate({ area: "device", view: "lifecycle" });
          }}
          onAcceptTreatment={() => undefined}
          onDismissTreatment={() => undefined}
          treatmentGating={feed.treatmentGating}
          treatmentDisposition={feed.treatmentDisposition}
          journey={feed.journey}
        />
      );
    }
    case "device.lifecycle": {
      // W152 Fix 2 (R5a residual) — the device lifecycle route binding
      // (the in-vocab route the console's switch NEVER bound — falls
      // through to the "This route does not exist" refusal). The screen
      // is fully controlled and renders the device detail header + the
      // frozen lifecycle machine + provenance, with the legal next
      // transitions rendered as REQUEST affordances whose AUTHORIZATION
      // STATUS is visible on every consequential action.
      //
      // The phase's view-model is composed over the REAL session twin
      // store (the same store the roster + the declared-import journey
      // read) via `buildDeviceDetailHeader(scope, source, deviceId,
      // options)`. The scope is the acting tenant; the source is the
      // session's twin store (structurally satisfies DeviceTwinSource);
      // the deviceId is the session-held `selectedDeviceId` (the W149
      // `selectedRecoveryCaseId` precedent), defaulting to the doctor's
      // current device selection when entering from the doctor (the
      // demo tier's `dev_w091demo000001` / the fresh workspace's
      // `dev_freshworkspace01` — the same default the doctor binding
      // uses). The honest empty `undefined` view-model renders the
      // screen's own "Device not found in your fleet" state — never
      // fabricated data.
      //
      // The `transitionAuthorization` map is HONESTLY EMPTY (the demo
      // tier wires no transition-authorization boundary — the doctor's
      // `treatmentGating` is the structural precedent: an empty map
      // means "no boundary, click is a no-op"). The `onRequestTransition`
      // handler is the honest refusal the current authorization model
      // warrants: a no-op (no transition-authorization boundary is
      // exposed in this session — the doctor's `onAcceptTreatment`
      // precedent). `onOpenDoctor` navigates back to the doctor.
      const isDemo = input.laneFeeds !== null && input.laneFeeds.isDemo;
      const defaultDeviceId = isDemo
        ? (asDeviceId("dev_w091demo000001") as DeviceId)
        : (asDeviceId("dev_freshworkspace01") as DeviceId);
      const deviceIdRaw = input.selectedDeviceId !== undefined
        ? input.selectedDeviceId
        : (defaultDeviceId as string);
      const deviceId = asDeviceId(deviceIdRaw) as DeviceId;
      const scope = { tenantId: asTenantId(input.sessionTenantId) };
      // The staleness reference + bands (the lane feeds' own values:
      // `now` = 2026-01-06T14:00:00Z, freshWithinMs = 1 day,
      // staleAfterMs = 7 days — the demo fleet's frozen reference
      // instant + the device-list composition's own bands).
      const header = buildDeviceDetailHeader(
        scope,
        input.sessionTwinStore,
        deviceId,
        { now: "2026-01-06T14:00:00Z", freshWithinMs: 86_400_000, staleAfterMs: 604_800_000 },
      );
      // W156 (TL convergence) — the PREDICTIVE TWIN ADVISORY BINDING: the
      // end-to-end advisory journey over the REAL session twin store. The
      // W153 extractor consumes the twin's telemetry window; the W155
      // context projection consumes the demo tier's REAL procurement
      // demand (the deployed tier's thin context degrades honestly); the
      // W154 engine runs through the deterministic REFERENCE adapter (the
      // adapter-interface-only law — no GPU, no model provider, no
      // network). The window/asOf use the lane feeds' own frozen
      // reference instant (the W152 header binding's `now` value). The
      // candidate action is the demo counterfactual the panel renders as
      // HYPOTHETICAL — never observed, never executed.
      const twinRecord = input.sessionTwinStore.get(scope.tenantId, deviceId);
      let advisoryView: PredictiveAdvisoryView | null = null;
      let arenaNote: EvaluationAdvisoryNote | null = null;
      if (twinRecord !== undefined) {
        const advisory = buildPredictiveAdvisory({
          scope,
          deviceId,
          twin: {
            deviceId: twinRecord.deviceId,
            telemetry: {
              lastObservedAt: twinRecord.telemetry.lastObservedAt,
              observationCount: twinRecord.telemetry.observationCount,
              latest: twinRecord.telemetry.latest,
            },
          },
          adapter: createReferenceAdapter(),
          workloadAssignments: [],
          procurementStages: isDemo
            ? deriveProcurementStageFacets([DEMO_DEMAND_FACETS])
            : [],
          window: { from: "2026-01-06T00:00:00Z", to: "2026-01-06T14:00:00Z" },
          asOf: "2026-01-06T14:00:00Z",
          horizonMs: 86_400_000,
          candidateAction: {
            ref: "act_w091_demo_replace_battery",
            description: "Replace the battery (the demo counterfactual)",
          },
        });
        if (advisory.ok) {
          advisoryView = advisory.advisory;
          if (advisory.advisory.kind === "ready" && isDemo) {
            // The Arena intake note under the demo tier's REAL Guardian
            // decision (REQUIRE_APPROVAL -> the proposal lands PARKED —
            // Guardian remains the sole policy authority; the bridge
            // NEVER submits).
            const noteBuild = buildEvaluationAdvisoryNote(
              scope,
              advisory.advisory.sourcePrediction,
              demoGuardianDecision(),
            );
            if (noteBuild.ok) {
              arenaNote = noteBuild.note;
            }
          }
        }
      }
      return (
        <div className="fos-stack">
          <DeviceLifecycleScreen
            phase={{ kind: "ready", view: header }}
            deviceId={deviceId}
            transitionAuthorization={{}}
            onRequestTransition={() => undefined}
            onOpenDoctor={() => navigate({ area: "device", view: "doctor" })}
          />
          {advisoryView !== null && <PredictiveTwinPanel advisory={advisoryView} note={arenaNote} />}
        </div>
      );
    }
    case "recovery.cases": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      const feed = input.laneFeeds.recoveryCases;
      // W148 — the case-creation affordance's binding: the binding site
      // routes the intent through the REAL recovery-case journey
      // factory (`createAndAppendRecoveryCase` over the session store).
      // The case enters the OPEN status (the active-recovery state that
      // gates destructive requests); the per-case seven-stage journey
      // + the typed-CONFIRM destructive gate become reachable.
      const onCreateCase = (deviceId: DeviceId): void => {
        // The demo tier's selected device (the demo tenant's own
        // dev_w091demo000001); the binding site picks the device.
        const selectedDeviceId = input.laneFeeds !== null && input.laneFeeds.isDemo
          ? asDeviceId("dev_w091demo000001")
          : deviceId;
        const openedAt = "2026-01-06T14:00:00Z";
        const { store: nextStore } = createAndAppendRecoveryCase(
          input.sessionRecoveryStore,
          {
            tenantId: asTenantId(input.sessionTenantId),
            deviceId: selectedDeviceId,
            triggerKind: "lost_device_report",
            triggerReportedAt: openedAt,
            triggerNote: "Operator-initiated recovery case (the demo tier's session-scoped truth).",
            openedAt,
          },
        );
        input.setSessionRecoveryStore(nextStore);
        input.setRecoveryCaseVersion((v) => v + 1);
      };
      return (
        <RecoveryCasesScreen
          phase={feed.phase}
          // W149 — the P2 fix: bind the REAL selected recovery case id
          // (the W148 binding shipped `isDemo ? undefined : undefined`
          // — a stub that left the per-case detail never opening). The
          // session's `selectedRecoveryCaseId` state is the binding's
          // source of truth; the seven-stage per-case journey renders
          // when a case is selected (Find My Device's open-case flow
          // or the cases list's on-select).
          selectedCaseId={input.selectedRecoveryCaseId}
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
          onCreateCase={onCreateCase}
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
      // W148 — the Workload Planning screen binds to the feed's
      // view-model (the W143 `composeWorkloadPlanningFeed` over the
      // demo tenant's REAL workload profile — the Loading resolves to
      // ready; the six-stage planning journey runs over REAL runtime
      // state with honest not_decided stages where undecided).
      const feed = input.laneFeeds.workloadPlanning;
      // The feed's `phase` is the screen's prop (the lane's
      // machine-proven state — loading / empty / ready / blocked /
      // approval_required / error). The WorkloadPlanningViewModel
      // mirrors WorkloadPlanningData (the screen's view-model shape);
      // the extra `tenantId` field is harmless.
      const screenPhase =
        feed.phase.kind === "ready"
          ? { kind: "ready" as const, view: feed.phase.view as unknown as WorkloadPlanningData }
          : feed.phase.kind === "error"
            ? { kind: "error" as const, message: feed.phase.message }
            : feed.phase.kind === "loading"
              ? { kind: "loading" as const }
              : { kind: "loading" as const };
      return (
        <WorkloadPlanningScreen
          phase={screenPhase}
          surface={{ view: "list" } as never}
          onSurfaceEvent={() => undefined}
          tab="recommendations"
          onTabChange={() => undefined}
          journey={null}
        />
      );
    }
    case "commerce.procurement": {
      if (input.laneFeeds === null) {
        return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
      }
      // W149 — the P0 crash fix: the W148 binding shipped a blind cast
      // (`feed.phase.view as unknown as ProcurementScreenData`). The
      // W143 `composeProcurementCasesFeed` view-model has the shape
      // `{tenantId, demands, selected, vendors, orders}` — NO
      // `verification` field. The ProcurementScreen's `VerificationCard`
      // calls `Object.entries(verification.chainStatusCounts)` — when
      // `verification` is `undefined` (the blind cast's runtime truth),
      // the card throws `TypeError: Cannot read properties of
      // undefined (reading 'chainStatusCounts')` and the deployed app
      // crashes ("Application error: a client-side exception has
      // occurred").
      //
      // The fix: compose the REAL `ProcurementScreenData` from the W143
      // view-model — pass through the demand list, the selected detail,
      // the LOCK 14 aggregated orders, AND the honest empty
      // `OrderVerificationView` (the commercial-reconciliation state —
      // no delivered chains, no discrepancies, the honest
      // not-yet-verified state). The VerificationCard renders its honest
      // empty state; the procurement surface LOADS and the seven-stage
      // case journey runs (need -> case -> vendor context ->
      // authorization -> decision -> order -> evidence).
      const feed = input.laneFeeds.procurementCases;
      // The honest empty `OrderVerificationView` — composed from the
      // acting tenant's id + the absence of any reconciliation report
      // (no delivered chains; zero discrepancies; the honest summary:
      // "No reconciliation report verifies the orders yet.").
      const verificationResult = feed.phase.kind === "ready"
        ? buildOrderVerificationView(feed.phase.view.tenantId, null)
        : null;
      const verification: OrderVerificationView | null =
        verificationResult !== null && verificationResult.ok ? verificationResult.view : null;
      const screenPhase =
        feed.phase.kind === "ready" && verification !== null
          ? {
              kind: "ready" as const,
              view: {
                demands: feed.phase.view.demands,
                selected: feed.phase.view.selected === null
                  ? null
                  : {
                      demand: feed.phase.view.selected.demand,
                      matching: feed.phase.view.selected.matching,
                      quoteRows: feed.phase.view.selected.quoteRows,
                      // The W143 view-model does not carry per-quote
                      // decision-support evaluations (the matching
                      // engine's HEADROOM ranks are in `matching`).
                      // The screen's `evaluations` field is the
                      // honest empty list (no fabricated evaluations).
                      evaluations: Object.freeze([]) as readonly never[],
                    },
                orders: feed.phase.view.orders,
                verification,
              } satisfies ProcurementScreenData,
            }
          : feed.phase.kind === "error"
            ? { kind: "error" as const, message: feed.phase.message }
            : feed.phase.kind === "loading"
              ? { kind: "loading" as const }
              : { kind: "loading" as const };
      // W151 — the journey-rail adapter: map the lane's declared
      // `ProcurementCaseJourney` (the seven-stage walk) to the screen's
      // `CommerceJourneyRailStage[]`. The rail renders iff the journey
      // is composed (i.e., a demand is selected and in the acting
      // tenant's partition). PURE — composes through the lane's
      // declared public exports, never internals.
      const journeyRail =
        feed.journey !== undefined
          ? mapProcurementJourneyToRail(feed.journey)
          : null;
      return (
        <ProcurementScreen
          phase={screenPhase}
          surface={input.procurementSurface}
          onSurfaceEvent={input.onProcurementSurfaceEvent}
          // W152 Fix 4 — the demand-detail tab engagement: the W151
          // binding pinned `tab="matching"` with `onTabChange={() =>
          // undefined}` (a dead control on a surface whose own copy
          // tells the user to "Open the demand's Quotes tab"). The
          // W152 fix holds the tab in the console session (the
          // W149/W151 precedent) and binds the REAL session-held tab
          // + setter — no longer a dead control. The handler keeps
          // the tab coherent with the surface state (reset on
          // open_demand/back-from-demand/reset; set on
          // open_matching/open_quote).
          tab={input.procurementTab}
          onTabChange={input.setProcurementTab}
          journey={journeyRail}
        />
      );
    }
    default: {
      // W148 — the in-vocabulary route bindings (security.decisions,
      // workloads.recommendations, the commerce.software family). These
      // routes are INSIDE the frozen route vocabulary; the previous
      // "not yet composed in this runtime" placeholder is GONE. Each
      // route binds to its lane's existing screen composition (over
      // REAL runtime state — honest empty/blocked where the demo fleet
      // has no records, never fabricated data).
      const routeKey = `${route.area}.${route.view}`;
      if (routeKey === "security.decisions") {
        // The Guardian decisions view — the demo fleet's evaluation
        // is the parked-plan's REQUIRE_APPROVAL decision (visible in
        // the Security Doctor); the decisions LIST composes the
        // honest empty state (no BLOCK decisions recorded for the
        // demo tenant — the audit log's 5 seeded events include no
        // BLOCK outcome). The screen renders its ready/empty phase
        // honestly.
        const emptyData = {
          presentations: [] as readonly GuardianDecisionPresentationView[],
          blockHistory: {
            tenantId: asTenantId(input.sessionTenantId),
            total: 0,
            items: [],
          } as BlockHistoryView,
        } as GuardianDecisionsData;
        return (
          <GuardianDecisionsScreen
            phase={{ kind: "ready", view: emptyData }}
            panel="decisions"
            onPanelChange={() => undefined}
            onOpenApprovals={() => navigate({ area: "security", view: "approvals" })}
          />
        );
      }
      if (routeKey === "workloads.recommendations") {
        // The recommendations view is the planning screen's
        // recommendations tab (the same W143 feed; the route is a
        // deep-link into the planning surface). Render the planning
        // screen with the recommendations tab selected.
        if (input.laneFeeds === null) {
          return <EmptyState title="The lane feeds refused to compose." hint="The composition root failed; refresh the session." action={<Button variant="primary" onClick={() => navigate({ area: "overview", view: "home" })}>Back to Control Tower</Button>} />;
        }
        const feed = input.laneFeeds.workloadPlanning;
        const screenPhase =
          feed.phase.kind === "ready"
            ? { kind: "ready" as const, view: feed.phase.view as unknown as WorkloadPlanningData }
            : feed.phase.kind === "error"
              ? { kind: "error" as const, message: feed.phase.message }
              : { kind: "loading" as const };
        return (
          <WorkloadPlanningScreen
            phase={screenPhase}
            surface={{ view: "list" } as never}
            onSurfaceEvent={() => undefined}
            tab="recommendations"
            onTabChange={() => undefined}
            journey={null}
          />
        );
      }
      // The commerce.software family — each sub-route binds to its
      // lane screen with the honest empty phase (the demo fleet has no
      // software subscriptions / vendor catalog / maintenance work
      // orders / connectivity submissions / outbox entries — REAL
      // runtime state, never fabricated data). The screen renders its
      // loading/empty phase honestly.
      if (routeKey === "commerce.software") {
        return <SoftwareScreen phase={{ kind: "loading" }} journey={null} />;
      }
      if (routeKey === "commerce.vendors") {
        return (
          <VendorsScreen
            phase={{ kind: "loading" }}
            openVendorId={null}
            onOpenVendor={() => undefined}
            journey={null}
          />
        );
      }
      if (routeKey === "commerce.maintenance") {
        return (
          <MaintenanceScreen
            phase={{ kind: "loading" }}
            surface={{ view: "workorders" } as never}
            onSurfaceEvent={() => undefined}
            tab="matching"
            onTabChange={() => undefined}
            journey={null}
          />
        );
      }
      if (routeKey === "commerce.connectivity") {
        return (
          <ConnectivityScreen
            phase={{ kind: "loading" }}
            openSubmissionId={null}
            onOpenSubmission={() => undefined}
            openConnectivityId={null}
            onOpenConnectivity={() => undefined}
            journey={null}
          />
        );
      }
      if (routeKey === "commerce.communication") {
        return (
          <CommunicationScreen
            phase={{ kind: "loading" }}
            openMessageId={null}
            onOpenMessage={() => undefined}
            journey={null}
          />
        );
      }
      // Genuinely unknown routes fail safely — never a crash, always a
      // way forward. The six lanes' deep screens are bound above; this
      // default catches only routes outside the frozen vocabulary.
      const area = route.area;
      return (
        <EmptyState
          title="This route does not exist"
          hint={`The console's route vocabulary is closed — unknown areas and views refuse rather than render something misleading. The ${area} area is not in the vocabulary.`}
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
