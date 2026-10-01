/**
 * @fleetos/web-device — W100A: the INSTALL CENTER view-model (the
 * install contract's dedicated first-class entry surface).
 *
 * spec/install/INSTALL-AND-ENROLLMENT-CONTRACT.md "Install center UI":
 * "1. platform selector; 2. corporate/BYOD scope; 3. enrollment
 * scope; 4. one-time code; 5. download; 6. copy command; 7.
 * installation verification; 8. first-check-in status; 9. next
 * action."
 *
 * A PURE, DETERMINISTIC view-model over the install center's state:
 *
 *   - **Structural seams** (the W060A/W090A discipline): the release
 *     manifest, the enrollment request record and the agent journey
 *     trace arrive as STRUCTURAL shapes satisfied by the REAL
 *     `@fleetos/agent` release manifest, the REAL
 *     `@fleetos/device-adapters` enrollment-request record and the
 *     REAL agent client's progress projection — injected at the
 *     binding site, proven by test. src/ imports `@fleetos/contracts`
 *     ONLY (the cross-lane seam); every domain value flows through
 *     these local structural seams.
 *   - **One-time code display.** The enrollment code is a display-once
 *     fact: it enters the state through `recordEnrollmentRequest`
 *     (after the domain created the request) and is REMOVED by
 *     `dismissEnrollmentCode` — the projection never fabricates or
 *     retains it. The record itself carries only the verifier (the
 *     domain's rule; this surface never re-derives it).
 *   - **Machine-stable refusals rendered verbatim.** The refusal view
 *     carries the machine reason + human explanation TOGETHER (the
 *     domain refusal shapes already do); this surface renders both
 *     verbatim and never rewrites them.
 *   - **Destructive actions are INTENTS.** `uninstallPlan` presents
 *     revoke/disable affordances as command views carrying
 *     `requiresAuthorization: true` — the install contract: "A
 *     destructive operation remains behind the existing
 *     authorization/approval model." This surface NEVER executes,
 *     NEVER mutates domain authority, and NEVER re-derives who may
 *     act.
 *   - **BYOD conservatism.** The BYOD scope note states the frozen
 *     architecture's rule (telemetry minimized + purpose-bound; the
 *     W071 conservative allow-set) as PRESENTATION — the enforcement
 *     lives in the domain, not here.
 *
 * PURE + DETERMINISTIC: no clock (instants injected), no randomness,
 * no I/O. No `any` in public signatures. Strict TS.
 */

import type { TenantId } from "@fleetos/contracts";
import { frozen, frozenArray } from "./internal";
import type { DeviceUiTenantScope } from "./internal";
import { checkDeviceUiTenantScope } from "./internal";

// ---------------------------------------------------------------------------
// Structural seams (satisfied by the REAL agent + device-adapters values)
// ---------------------------------------------------------------------------

/** One release artifact (structurally satisfied by the agent's descriptor). */
export interface ReleaseArtifactLike {
  readonly platform: string;
  readonly arch: string;
  readonly fileName: string;
  readonly installCommand: string;
  readonly checksum: string;
  readonly checksumAlgorithm: string;
  readonly sizeBytes: number;
}

/** A release manifest (structurally satisfied by the agent's manifest). */
export interface ReleaseManifestLike {
  readonly moduleVersion: string;
  readonly protocolVersion: number;
  readonly releasedAt: string;
  readonly releaseNotes: string;
  readonly artifacts: readonly ReleaseArtifactLike[];
  readonly uninstallSteps: readonly string[];
  readonly rollbackInstructions: readonly string[];
}

/**
 * An enrollment request record (structurally satisfied by the REAL
 * device-adapters `EnrollmentRequestRecord` — which carries ONLY the
 * code verifier, never the code).
 */
export interface EnrollmentRequestLike {
  readonly requestId: string;
  readonly tenantId: TenantId;
  readonly ownershipKind: string;
  readonly ownershipClass: string;
  readonly allowedRoles: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: string;
}

/**
 * The agent-side enrollment journey trace (structurally satisfied by
 * the REAL agent client's progress projection — the stage names are
 * the client's: unbootstrapped/bootstrapped/checked_in/observed/
 * twin_confirmed/failed).
 */
export interface EnrollmentJourneyLike {
  readonly stage: string;
  readonly trust?: {
    readonly enrollmentRequestId?: string;
    readonly deviceId?: string;
    readonly issuedAt?: string;
  };
  readonly firstCheckIn?: { readonly at: string; readonly kind: string };
  readonly firstObservation?: { readonly kind: string; readonly at: string };
  readonly twinConfirmed?: { readonly at: string; readonly observationCount: number };
}

// ---------------------------------------------------------------------------
// The ownership-kind presentation (the install contract's four scopes)
// ---------------------------------------------------------------------------

/**
 * The local presentation of an ownership kind. The four labels mirror
 * the install contract's distinctions; the BYOD note states the
 * frozen architecture's conservative rule (W071: purpose-bound,
 * minimized telemetry; management capabilities outside the allow-set
 * are refused by the DOMAIN, not by this surface).
 */
export interface OwnershipKindPresentation {
  readonly kind: string;
  readonly label: string;
  /** True only for the BYOD scope (the conservative default). */
  readonly byodConservative: boolean;
  /** The scope note rendered next to the selector (undefined for unrestricted scopes). */
  readonly note: string | undefined;
}

const OWNERSHIP_KIND_PRESENTATIONS: Readonly<Record<string, OwnershipKindPresentation>> =
  Object.freeze({
    corporate_owned: frozen({
      kind: "corporate_owned",
      label: "Corporate-owned",
      byodConservative: false,
      note: undefined,
    }),
    leased: frozen({
      kind: "leased",
      label: "Leased",
      byodConservative: false,
      note: "Leased assets enroll with the corporate scope; return the device through your lease process.",
    }),
    byod: frozen({
      kind: "byod",
      label: "BYOD (bring your own device)",
      byodConservative: true,
      note: "BYOD devices enroll with conservative defaults: telemetry is minimized and purpose-bound, and management capabilities outside the read-only allow-set are refused by policy.",
    }),
    third_party_managed: frozen({
      kind: "third_party_managed",
      label: "Third-party managed",
      byodConservative: false,
      note: "Third-party managed devices enroll under the managed scope; their management boundary stays with the managing party.",
    }),
  });

/** The canonical ownership-kind presentation order (the selector's order). */
export const INSTALL_CENTER_OWNERSHIP_KIND_ORDER: readonly string[] = frozenArray([
  "corporate_owned",
  "leased",
  "byod",
  "third_party_managed",
]);

/** The presentation for an ownership kind (a graceful unknown for foreign values). */
export function ownershipKindPresentation(kind: string): OwnershipKindPresentation {
  const known = OWNERSHIP_KIND_PRESENTATIONS[kind];
  if (known !== undefined) return known;
  return frozen({
    kind,
    label: kind,
    byodConservative: false,
    note: undefined,
  });
}

// ---------------------------------------------------------------------------
// The install center state (pure value; the shell owns the transitions)
// ---------------------------------------------------------------------------

/** The one-time enrollment code display state (present until dismissed). */
export interface EnrollmentRequestProjection {
  readonly record: EnrollmentRequestLike;
  /** The one-time code — present ONLY until dismissed (display-once). */
  readonly code: string | undefined;
}

/** The last refusal rendered verbatim (machine reason + human explanation). */
export interface InstallRefusalView {
  readonly reason: string;
  readonly explanation: string;
}

/** The install center state. PURE value. */
export interface InstallCenterState {
  readonly tenantId: TenantId;
  /** The selected platform + arch (the platform selector's choice). */
  readonly platform: { readonly platform: string; readonly arch: string } | undefined;
  /** The selected ownership kind (the scope selector's choice). */
  readonly ownershipKind: string | undefined;
  /** The recorded enrollment request + its one-time code display. */
  readonly request: EnrollmentRequestProjection | undefined;
  /** The last refusal (rendered verbatim). */
  readonly refusal: InstallRefusalView | undefined;
}

/** The initial install center state for a tenant. PURE. */
export function initialInstallCenterState(tenantId: TenantId): InstallCenterState {
  return frozen({
    tenantId,
    platform: undefined,
    ownershipKind: undefined,
    request: undefined,
    refusal: undefined,
  });
}

/** Select a platform + arch. PURE (returns a NEW state). */
export function selectInstallPlatform(
  state: InstallCenterState,
  platform: string,
  arch: string,
): InstallCenterState {
  return frozen({ ...state, platform: frozen({ platform, arch }) });
}

/** Select the ownership kind. PURE. */
export function selectOwnershipKind(
  state: InstallCenterState,
  kind: string,
): InstallCenterState {
  return frozen({ ...state, ownershipKind: kind });
}

/**
 * Record a created enrollment request + its one-time code. The SHELL
 * calls this AFTER the domain created the request (create + put); the
 * code enters the view exactly once here. PURE.
 */
export function recordEnrollmentRequest(
  state: InstallCenterState,
  record: EnrollmentRequestLike,
  code: string,
): InstallCenterState {
  return frozen({ ...state, request: frozen({ record, code }) });
}

/** Dismiss the one-time code (it leaves the view — display-once). PURE. */
export function dismissEnrollmentCode(state: InstallCenterState): InstallCenterState {
  if (state.request === undefined) return state;
  return frozen({ ...state, request: frozen({ record: state.request.record, code: undefined }) });
}

/** Record a refusal (machine reason + human explanation, verbatim). PURE. */
export function recordInstallRefusal(
  state: InstallCenterState,
  refusal: InstallRefusalView,
): InstallCenterState {
  return frozen({ ...state, refusal: frozen({ reason: refusal.reason, explanation: refusal.explanation }) });
}

/** Dismiss the refusal. PURE. */
export function dismissInstallRefusal(state: InstallCenterState): InstallCenterState {
  return frozen({ ...state, refusal: undefined });
}

// ---------------------------------------------------------------------------
// Platform facets (the selector's data)
// ---------------------------------------------------------------------------

/** The canonical platform display order. */
export const INSTALL_CENTER_PLATFORM_ORDER: readonly string[] = frozenArray([
  "windows",
  "macos",
  "linux",
]);

/** The platform display labels. */
export const INSTALL_CENTER_PLATFORM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
} as const);

/** One platform facet (the selector row). */
export interface PlatformFacet {
  readonly platform: string;
  readonly label: string;
  /** True when the release carries at least one artifact for the platform. */
  readonly available: boolean;
  /** The available architectures (artifact order). */
  readonly archs: readonly string[];
  /** The artifact for the currently selected arch (when selected). */
  readonly selected: boolean;
}

/** Project the platform facets from a release + the current selection. PURE. */
export function platformFacets(
  release: ReleaseManifestLike | undefined,
  state: InstallCenterState,
): readonly PlatformFacet[] {
  const artifacts = release?.artifacts ?? [];
  return frozenArray(
    INSTALL_CENTER_PLATFORM_ORDER.map((platform) => {
      const platformArtifacts = artifacts.filter((artifact) => artifact.platform === platform);
      const archs = frozenArray([...new Set(platformArtifacts.map((a) => a.arch))]);
      const selected =
        state.platform !== undefined &&
        state.platform.platform === platform &&
        archs.includes(state.platform.arch);
      return frozen<PlatformFacet>({
        platform,
        label: INSTALL_CENTER_PLATFORM_LABELS[platform] ?? platform,
        available: platformArtifacts.length > 0,
        archs,
        selected,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// The install plan (download / verify / copy command / install)
// ---------------------------------------------------------------------------

/** One install plan step (machine-stable id + human label + detail). */
export interface InstallPlanStep {
  readonly id: "download" | "verify_checksum" | "copy_command" | "install";
  readonly label: string;
  readonly detail: string;
}

/** The install plan view for a selected platform. */
export interface InstallPlanView {
  readonly platform: string;
  readonly arch: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly checksumAlgorithm: string;
  readonly installCommand: string;
  readonly steps: readonly InstallPlanStep[];
}

/**
 * Project the install plan for the selected platform. `undefined`
 * when no platform is selected or the release has no matching
 * artifact (the surface refuses to fabricate a plan — the unsupported
 * state is the platform selector's to show). PURE.
 */
export function installPlan(
  release: ReleaseManifestLike | undefined,
  state: InstallCenterState,
): InstallPlanView | undefined {
  if (release === undefined || state.platform === undefined) return undefined;
  const artifact = release.artifacts.find(
    (candidate) =>
      candidate.platform === state.platform!.platform && candidate.arch === state.platform!.arch,
  );
  if (artifact === undefined) return undefined;
  const steps: readonly InstallPlanStep[] = frozenArray([
    frozen({
      id: "download",
      label: "Download the installer",
      detail: `${artifact.fileName} (${artifact.sizeBytes} bytes) — verify it against the recorded checksum after download.`,
    }),
    frozen({
      id: "verify_checksum",
      label: "Verify the checksum",
      detail: `Checksum (${artifact.checksumAlgorithm}): ${artifact.checksum}`,
    }),
    frozen({
      id: "copy_command",
      label: "Copy the install command",
      detail: artifact.installCommand,
    }),
    frozen({
      id: "install",
      label: "Run it on the device",
      detail:
        "The installer asks for the control-plane endpoint through the environment and for your one-time enrollment code at run time. It contains no credentials.",
    }),
  ]);
  return frozen({
    platform: artifact.platform,
    arch: artifact.arch,
    fileName: artifact.fileName,
    sizeBytes: artifact.sizeBytes,
    checksum: artifact.checksum,
    checksumAlgorithm: artifact.checksumAlgorithm,
    installCommand: artifact.installCommand,
    steps,
  });
}

// ---------------------------------------------------------------------------
// The enrollment code card (one-time code + status band + revoke intent)
// ---------------------------------------------------------------------------

/** The enrollment code status band (derived from an injected instant). */
export type EnrollmentCodeStatus = "active" | "expiring_soon" | "expired" | "used" | "revoked";

/** The enrollment code card view. */
export interface EnrollmentCodeCardView {
  readonly requestId: string;
  readonly ownership: OwnershipKindPresentation;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: EnrollmentCodeStatus;
  readonly allowedRoles: readonly string[];
  /** The one-time code — present ONLY while undismissed. */
  readonly code: string | undefined;
  /** The revoke affordance: an INTENT (authorization-required, never executed here). */
  readonly revokeIntent: {
    readonly intent: "enrollment.code.disable";
    readonly requiresAuthorization: true;
    readonly note: string;
  };
}

/**
 * Derive the code status band from the injected instant + the record's
 * status. PURE: `used`/`revoked` come from the record; `expired` from
 * the instant; `expiring_soon` when within the window.
 */
export function enrollmentCodeStatus(
  record: EnrollmentRequestLike,
  now: string,
  expiringWithinMs: number,
): EnrollmentCodeStatus {
  if (record.status === "fulfilled") return "used";
  if (record.status === "revoked") return "revoked";
  const nowMs = Date.parse(now);
  const expiresMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) return "expired";
  if (nowMs > expiresMs) return "expired";
  if (nowMs + expiringWithinMs > expiresMs) return "expiring_soon";
  return "active";
}

/**
 * Project the enrollment code card. `undefined` when no request is
 * recorded. PURE.
 */
export function enrollmentCodeCard(
  state: InstallCenterState,
  now: string,
  options: { readonly expiringWithinMs: number },
): EnrollmentCodeCardView | undefined {
  if (state.request === undefined) return undefined;
  const { record, code } = state.request;
  return frozen({
    requestId: record.requestId,
    ownership: ownershipKindPresentation(record.ownershipKind),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    status: enrollmentCodeStatus(record, now, options.expiringWithinMs),
    allowedRoles: frozenArray([...record.allowedRoles]),
    code,
    revokeIntent: frozen({
      intent: "enrollment.code.disable" as const,
      requiresAuthorization: true as const,
      note: "Disabling an enrollment code is an authorized operator action. The console routes it through the existing approval model — this surface never revokes by itself.",
    }),
  });
}

// ---------------------------------------------------------------------------
// Installation verification (the agent-side journey checks)
// ---------------------------------------------------------------------------

/** One installation check (machine-stable id + met/unmet). */
export interface InstallationCheck {
  readonly id:
    | "installer_ready"
    | "bootstrap_exchanged"
    | "first_check_in"
    | "first_observation"
    | "twin_confirmed";
  readonly label: string;
  readonly state: "met" | "unmet";
}

/** The installation verification view (steps 7-8 of the install center). */
export interface InstallationVerificationView {
  /** The journey stage verbatim (the agent client's vocabulary). */
  readonly stage: string | undefined;
  readonly checks: readonly InstallationCheck[];
  /** True when every check is met (the journey is complete). */
  readonly complete: boolean;
}

const INSTALLATION_CHECK_LABELS: Readonly<Record<InstallationCheck["id"], string>> =
  Object.freeze({
    installer_ready: "Installer selected for the device's platform",
    bootstrap_exchanged: "One-time enrollment code exchanged for device trust",
    first_check_in: "First check-in received by the control plane",
    first_observation: "First observation received from the device",
    twin_confirmed: "Device Twin confirmed in your fleet",
  } as const);

/**
 * Project the installation verification from the agent journey trace
 * + the selected installer. PURE: the same (journey, state) always
 * produce the same checks.
 */
export function installationVerification(
  journey: EnrollmentJourneyLike | undefined,
  state: InstallCenterState,
  release: ReleaseManifestLike | undefined,
): InstallationVerificationView {
  const installerReady = installPlan(release, state) !== undefined;
  const checks: readonly InstallationCheck[] = frozenArray([
    frozen<InstallationCheck>({
      id: "installer_ready",
      label: INSTALLATION_CHECK_LABELS.installer_ready,
      state: installerReady ? "met" : "unmet",
    }),
    frozen<InstallationCheck>({
      id: "bootstrap_exchanged",
      label: INSTALLATION_CHECK_LABELS.bootstrap_exchanged,
      state: journey?.trust !== undefined ? "met" : "unmet",
    }),
    frozen<InstallationCheck>({
      id: "first_check_in",
      label: INSTALLATION_CHECK_LABELS.first_check_in,
      state: journey?.firstCheckIn !== undefined ? "met" : "unmet",
    }),
    frozen<InstallationCheck>({
      id: "first_observation",
      label: INSTALLATION_CHECK_LABELS.first_observation,
      state: journey?.firstObservation !== undefined ? "met" : "unmet",
    }),
    frozen<InstallationCheck>({
      id: "twin_confirmed",
      label: INSTALLATION_CHECK_LABELS.twin_confirmed,
      state: journey?.twinConfirmed !== undefined ? "met" : "unmet",
    }),
  ]);
  return frozen({
    stage: journey?.stage,
    checks,
    complete: checks.every((check) => check.state === "met"),
  });
}

// ---------------------------------------------------------------------------
// The next action (step 9 — a deterministic ladder)
// ---------------------------------------------------------------------------

/** The next action (machine-stable id + label + detail). */
export interface NextActionView {
  readonly id:
    | "resolve_refusal"
    | "select_platform"
    | "choose_ownership_scope"
    | "create_code"
    | "complete_install"
    | "await_first_check_in"
    | "await_first_observation"
    | "await_twin_confirmation"
    | "open_device_doctor";
  readonly label: string;
  readonly detail: string;
}

/**
 * Derive the next action (a DETERMINISTIC ladder over the state, the
 * release and the journey). PURE.
 */
export function nextInstallAction(
  state: InstallCenterState,
  release: ReleaseManifestLike | undefined,
  journey: EnrollmentJourneyLike | undefined,
): NextActionView {
  if (state.refusal !== undefined) {
    return frozen({
      id: "resolve_refusal",
      label: "Resolve the refusal",
      detail: `Enrollment was refused (${state.refusal.reason}). Read the explanation, fix the cause, and retry with a fresh code when ready.`,
    });
  }
  if (state.platform === undefined || installPlan(release, state) === undefined) {
    return frozen({
      id: "select_platform",
      label: "Select the device's platform",
      detail: "Pick Windows, macOS or Linux and the device's architecture to get the matching installer.",
    });
  }
  if (state.ownershipKind === undefined) {
    return frozen({
      id: "choose_ownership_scope",
      label: "Choose the ownership scope",
      detail: "Corporate-owned, leased, BYOD or third-party managed — the scope decides the device's telemetry boundary.",
    });
  }
  if (state.request === undefined) {
    return frozen({
      id: "create_code",
      label: "Create a one-time enrollment code",
      detail: "The code is short-lived, single-use and revocable. It is shown once — copy it when you create it.",
    });
  }
  const stage = journey?.stage;
  if (journey === undefined || stage === undefined || stage === "unbootstrapped" || stage === "failed") {
    return frozen({
      id: "complete_install",
      label: "Install the agent and redeem the code",
      detail: "Run the install command on the device and enter the one-time code when prompted. The agent then checks in on its own.",
    });
  }
  if (stage === "bootstrapped") {
    return frozen({
      id: "await_first_check_in",
      label: "Wait for the first check-in",
      detail: "The device exchanged its code for trust. The first check-in arrives within moments of the install finishing.",
    });
  }
  if (stage === "checked_in") {
    return frozen({
      id: "await_first_observation",
      label: "Wait for the first observation",
      detail: "The device checked in. Its first observation completes the telemetry path.",
    });
  }
  if (stage === "observed") {
    return frozen({
      id: "await_twin_confirmation",
      label: "Wait for Device Twin confirmation",
      detail: "The device reported its first observation. Enrollment completes when the Device Twin records it.",
    });
  }
  return frozen({
    id: "open_device_doctor",
    label: "Open Device Doctor",
    detail: "The device is enrolled with its first observation recorded. Device Doctor is ready for it.",
  });
}

// ---------------------------------------------------------------------------
// The uninstall / revoke plan (intents, never executions)
// ---------------------------------------------------------------------------

/** A destructive intent view (authorization-required by construction). */
export interface DestructiveIntentView {
  readonly intent: "enrollment.code.disable" | "device.trust.revoke";
  readonly label: string;
  readonly requiresAuthorization: true;
  readonly note: string;
}

/** The uninstall / revoke plan view. */
export interface UninstallPlanView {
  readonly uninstallSteps: readonly string[];
  readonly rollbackInstructions: readonly string[];
  /** The post-uninstall state description (rendered verbatim). */
  readonly postUninstallState: string;
  /** The destructive intents (authorization-required, routed by the shell). */
  readonly revokeIntents: readonly DestructiveIntentView[];
  /** The audit/evidence note. */
  readonly auditNote: string;
}

/**
 * Project the uninstall/revoke plan from the release manifest. PURE:
 * steps arrive verbatim from the manifest; the intents are INTENT
 * DESCRIPTORS (never executions — the authorization/approval model
 * owns the actual destructive operation).
 */
export function uninstallPlan(release: ReleaseManifestLike | undefined): UninstallPlanView {
  return frozen({
    uninstallSteps: frozenArray([...(release?.uninstallSteps ?? [])]),
    rollbackInstructions: frozenArray([...(release?.rollbackInstructions ?? [])]),
    postUninstallState:
      "After uninstall the device stops checking in, its trust record stays revocable from the console, and its Device Twin remains as evidence until your retention policy removes it.",
    revokeIntents: frozenArray([
      frozen<DestructiveIntentView>({
        intent: "enrollment.code.disable",
        label: "Disable the enrollment code",
        requiresAuthorization: true,
        note: "An authorized operator action, routed through the existing approval model.",
      }),
      frozen<DestructiveIntentView>({
        intent: "device.trust.revoke",
        label: "Revoke the device's trust",
        requiresAuthorization: true,
        note: "A destructive action: it requires an explicit policy grant and leaves an evidence trail.",
      }),
    ]),
    auditNote:
      "Every revoke, disable and uninstall state change is recorded in the tenant's audit trail with its evidence links.",
  });
}

// ---------------------------------------------------------------------------
// The release summary (the header block)
// ---------------------------------------------------------------------------

/** The release summary view (the install center's header). */
export interface ReleaseSummaryView {
  readonly moduleVersion: string;
  readonly protocolVersion: number;
  readonly releasedAt: string;
  readonly releaseNotes: string;
  readonly artifactCount: number;
  readonly platforms: readonly string[];
}

/** Project the release summary. PURE. */
export function releaseSummary(
  release: ReleaseManifestLike | undefined,
): ReleaseSummaryView | undefined {
  if (release === undefined) return undefined;
  const platforms = [...new Set(release.artifacts.map((artifact) => artifact.platform))];
  return frozen({
    moduleVersion: release.moduleVersion,
    protocolVersion: release.protocolVersion,
    releasedAt: release.releasedAt,
    releaseNotes: release.releaseNotes,
    artifactCount: release.artifacts.length,
    platforms: frozenArray(platforms),
  });
}

// ---------------------------------------------------------------------------
// Scope guard (the acting tenant rides every projection)
// ---------------------------------------------------------------------------

/**
 * The install center's tenant check: the acting scope must carry the
 * state's tenant (the request projection is tenant-bound; a scope
 * mismatch yields `invalid` — never a cross-tenant read). PURE.
 */
export function checkInstallCenterScope(
  scope: DeviceUiTenantScope,
  state: InstallCenterState,
): { readonly ok: boolean; readonly reason?: string } {
  const check = checkDeviceUiTenantScope(scope);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (scope.tenantId !== state.tenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  return { ok: true };
}
