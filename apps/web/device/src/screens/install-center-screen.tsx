/**
 * @fleetos/web-device — W100A rendered: the InstallCenterScreen (the
 * install contract's dedicated first-class install center).
 *
 * The rendered install center entry point, presenting the contract's
 * nine steps:
 *
 *   1. platform selector (the release's per-platform facets);
 *   2. corporate/BYOD scope (the four ownership kinds + the BYOD
 *      conservative note);
 *   3. enrollment scope (the code card's allowed-roles + ownership);
 *   4. one-time code (display-once: created, shown, dismissible);
 *   5. download (the artifact file name + size + checksum);
 *   6. copy command (the install command, copied verbatim);
 *   7. installation verification (the five journey checks);
 *   8. first-check-in status (the journey stage, verbatim);
 *   9. next action (the deterministic ladder).
 *
 * Plus the uninstall/revoke plan (steps + authorization-required
 * intents — NEVER executed here) and the refusal explanation (the
 * machine reason + human explanation rendered VERBATIM, never
 * re-derived).
 *
 * The screen is FULLY CONTROLLED: the state, the release manifest,
 * the journey trace and the acting instant arrive as PROPS; every
 * user intent (platform/scope selection, code creation, dismissal,
 * copy, revoke intents, doctor hand-off) flows through callbacks the
 * shell routes through the pure view-model functions. No business
 * truth in React state — the surface never performs enrollment, never
 * revokes, never mutates authority.
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX } from "react";
import type { DeviceId } from "@fleetos/contracts";
import {
  INSTALL_CENTER_OWNERSHIP_KIND_ORDER,
  enrollmentCodeCard,
  installPlan,
  installationVerification,
  nextInstallAction,
  ownershipKindPresentation,
  platformFacets,
  releaseSummary,
  uninstallPlan,
  type InstallCenterState,
  type ReleaseManifestLike,
  type EnrollmentJourneyLike,
  type EnrollmentCodeCardView,
  type EnrollmentCodeStatus,
  type InstallPlanView,
  type InstallationVerificationView,
  type NextActionView,
  type PlatformFacet,
  type ReleaseSummaryView,
  type UninstallPlanView,
} from "../install-center";
import { ConsoleStyles } from "../ui/tokens";
import {
  AlertError,
  Badge,
  Breadcrumb,
  Button,
  Card,
  DefinitionList,
  StatusIndicator,
  Stepper,
} from "../ui/primitives";
import type { Crumb } from "../ui/primitives";
import type { ConsoleStatus } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InstallCenterScreenProps {
  /** The install center state (the shell owns the transitions). */
  readonly state: InstallCenterState;
  /** The current agent release manifest (injected at the binding site). */
  readonly release: ReleaseManifestLike | undefined;
  /** The agent-side enrollment journey trace (injected; absent before install). */
  readonly journey: EnrollmentJourneyLike | undefined;
  /** The acting instant (ISO 8601, injected — drives the code status band). */
  readonly now: string;
  /** The code-status "expiring soon" window in milliseconds. */
  readonly expiringWithinMs: number;
  /** The device being enrolled (the doctor hand-off target), when known. */
  readonly deviceId: DeviceId | undefined;
  /** Select a platform + architecture (routes to `selectInstallPlatform`). */
  readonly onPlatformChange: (platform: string, arch: string) => void;
  /** Select the ownership kind (routes to `selectOwnershipKind`). */
  readonly onOwnershipKindChange: (kind: string) => void;
  /** Create a one-time enrollment code (routes the intent to the domain boundary). */
  readonly onCreateEnrollmentCode: () => void;
  /** Dismiss the one-time code (routes to `dismissEnrollmentCode`). */
  readonly onDismissCode: () => void;
  /** Copy the install command (the shell performs the copy). */
  readonly onCopyCommand: (command: string) => void;
  /** Revoke intent (an authorization-required command view; the shell routes it). */
  readonly onRevokeIntent: (intent: "enrollment.code.disable" | "device.trust.revoke") => void;
  /** Dismiss the rendered refusal. */
  readonly onDismissRefusal: () => void;
  /** Open Device Doctor for the enrolled device. */
  readonly onOpenDoctor: (deviceId: DeviceId) => void;
}

// ---------------------------------------------------------------------------
// Local presentation maps (deterministic; unknown values never guessed)
// ---------------------------------------------------------------------------

const CODE_STATUS_TO_CONSOLE: Readonly<Record<EnrollmentCodeStatus, ConsoleStatus>> =
  Object.freeze({
    active: "healthy",
    expiring_soon: "needs_attention",
    expired: "failed",
    used: "succeeded",
    revoked: "blocked",
  } as const);

const CODE_STATUS_LABELS: Readonly<Record<EnrollmentCodeStatus, string>> = Object.freeze({
  active: "Active",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  used: "Used",
  revoked: "Revoked",
} as const);

const JOURNEY_STEPS = [
  { id: "unbootstrapped", label: "Install the agent" },
  { id: "bootstrapped", label: "Redeem the code" },
  { id: "checked_in", label: "First check-in" },
  { id: "observed", label: "First observation" },
  { id: "twin_confirmed", label: "Twin confirmed" },
] as const;

const JOURNEY_STAGE_TO_CONSOLE: Readonly<Record<string, ConsoleStatus>> = Object.freeze({
  unbootstrapped: "informational",
  bootstrapped: "running",
  checked_in: "running",
  observed: "running",
  twin_confirmed: "succeeded",
  failed: "failed",
} as const);

const NEXT_ACTION_TO_CONSOLE: Readonly<Record<NextActionView["id"], ConsoleStatus>> =
  Object.freeze({
    resolve_refusal: "blocked",
    select_platform: "informational",
    choose_ownership_scope: "informational",
    create_code: "informational",
    complete_install: "approval_required",
    await_first_check_in: "running",
    await_first_observation: "running",
    await_twin_confirmation: "running",
    open_device_doctor: "succeeded",
  } as const);

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function ReleaseSummarySection({ summary }: { readonly summary: ReleaseSummaryView }): JSX.Element {
  return (
    <Card
      title="Install the FleetOS agent"
      subtitle="Add a device to your fleet: pick its platform, create a one-time enrollment code, run the installer on the device."
    >
      <DefinitionList
        entries={[
          { term: "Agent version", value: <span className="fos-mono">{summary.moduleVersion}</span> },
          { term: "Check-in protocol", value: <span className="fos-mono">v{summary.protocolVersion}</span> },
          { term: "Released", value: <span className="fos-mono fos-meta">{summary.releasedAt}</span> },
          { term: "Release notes", value: summary.releaseNotes },
          {
            term: "Artifacts",
            value: `${summary.artifactCount} installers (${summary.platforms.join(", ")})`,
          },
        ]}
      />
    </Card>
  );
}

function PlatformSelectorSection({
  facets,
  onPlatformChange,
}: {
  readonly facets: readonly PlatformFacet[];
  readonly onPlatformChange: (platform: string, arch: string) => void;
}): JSX.Element {
  return (
    <Card
      title="1. Choose the platform"
      subtitle="The release carries one installer per platform and architecture."
    >
      <div className="fos-stack" aria-label="Platform choices">
        {facets.map((facet) => (
          <div key={facet.platform} className="fos-spread">
            <span>{facet.label}</span>
            {facet.available ? (
              <div className="fos-row">
                {facet.archs.map((arch) => (
                  <Button
                    key={arch}
                    variant={facet.selected ? "primary" : "secondary"}
                    onClick={(): void => onPlatformChange(facet.platform, arch)}
                    ariaLabel={`Select ${facet.label} (${arch}) installer`}
                  >
                    {arch}
                  </Button>
                ))}
              </div>
            ) : (
              <Badge status="unknown">No artifact</Badge>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function OwnershipScopeSection({
  selectedKind,
  onOwnershipKindChange,
}: {
  readonly selectedKind: string | undefined;
  readonly onOwnershipKindChange: (kind: string) => void;
}): JSX.Element {
  return (
    <Card
      title="2. Choose the ownership scope"
      subtitle="The scope decides the device's telemetry boundary. BYOD defaults are conservative."
    >
      <div className="fos-stack" aria-label="Ownership scope choices">
        {INSTALL_CENTER_OWNERSHIP_KIND_ORDER.map((kind) => {
          const presentation = ownershipKindPresentation(kind);
          const selected = selectedKind === kind;
          return (
            <div key={kind} className="fos-row">
              <Button
                variant={selected ? "primary" : "secondary"}
                onClick={(): void => onOwnershipKindChange(kind)}
                ariaLabel={`Select ownership scope: ${presentation.label}`}
              >
                {selected ? `${presentation.label} — selected` : presentation.label}
              </Button>
              {presentation.byodConservative && (
                <Badge status="informational">Conservative telemetry</Badge>
              )}
            </div>
          );
        })}
        {selectedKind !== undefined && ownershipKindPresentation(selectedKind).note !== undefined && (
          <p className="fos-meta" style={{ margin: "0" }}>
            {ownershipKindPresentation(selectedKind).note}
          </p>
        )}
      </div>
    </Card>
  );
}

function EnrollmentCodeSection({
  card,
  onCreate,
  onDismiss,
  onRevokeIntent,
}: {
  readonly card: EnrollmentCodeCardView | undefined;
  readonly onCreate: () => void;
  readonly onDismiss: () => void;
  readonly onRevokeIntent: (intent: "enrollment.code.disable" | "device.trust.revoke") => void;
}): JSX.Element {
  if (card === undefined) {
    return (
      <Card title="3. Create a one-time enrollment code" subtitle="Short-lived, single-use, revocable.">
        <Button variant="primary" onClick={onCreate}>
          Create enrollment code
        </Button>
        <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
          The code is shown once when created. It carries no credentials and expires on its own.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="3. Your one-time enrollment code"
      subtitle={`Created ${card.createdAt} — expires ${card.expiresAt}.`}
      actions={
        <StatusIndicator
          status={CODE_STATUS_TO_CONSOLE[card.status]}
          label={`${CODE_STATUS_LABELS[card.status]} — ${card.status}`}
        />
      }
    >
      <DefinitionList
        entries={[
          { term: "Request", value: <span className="fos-mono">{card.requestId}</span> },
          { term: "Ownership scope", value: card.ownership.label },
          {
            term: "Enroller roles",
            value:
              card.allowedRoles.length > 0
                ? card.allowedRoles.join(", ")
                : "Any role in this workspace",
          },
        ]}
      />
      {card.code !== undefined ? (
        <div className="fos-stack">
          <p className="fos-mono" data-testid="enrollment-code-value">
            {card.code}
          </p>
          <p className="fos-meta" style={{ margin: "0" }}>
            Shown once — copy it now. The console stores only a verifier; this code cannot be shown
            again.
          </p>
          <div className="fos-row">
            <Button variant="secondary" onClick={onDismiss}>
              I copied the code — hide it
            </Button>
          </div>
        </div>
      ) : (
        <p className="fos-meta" style={{ margin: "0" }}>
          The code was shown once and is now hidden. It remains valid until used or expired — create
          a new request if you lost it.
        </p>
      )}
      <div className="fos-row">
        <Button
          variant="secondary"
          onClick={(): void => onRevokeIntent(card.revokeIntent.intent)}
          ariaLabel="Disable this enrollment code (requires authorization)"
        >
          Disable this code…
        </Button>
        <span className="fos-meta">{card.revokeIntent.note}</span>
      </div>
    </Card>
  );
}

function InstallPlanSection({
  plan,
  onCopyCommand,
}: {
  readonly plan: InstallPlanView | undefined;
  readonly onCopyCommand: (command: string) => void;
}): JSX.Element {
  if (plan === undefined) {
    return (
      <Card title="4. Download + install" subtitle="Select a platform to get the matching installer.">
        <p className="fos-meta" style={{ margin: "0" }}>
          No installer selected yet.
        </p>
      </Card>
    );
  }
  return (
    <Card title="4. Download + install" subtitle={`${plan.platform}/${plan.arch} — ${plan.fileName}`}>
      <ol className="fos-stack" aria-label="Install steps">
        {plan.steps.map((step) => (
          <li key={step.id}>
            <span>{step.label}</span>
            <p className="fos-meta" style={{ margin: "0.25rem 0 0" }}>
              {step.detail}
            </p>
            {step.id === "copy_command" && (
              <div className="fos-row" style={{ marginTop: "0.5rem" }}>
                <Button
                  variant="secondary"
                  onClick={(): void => onCopyCommand(plan.installCommand)}
                  ariaLabel="Copy the install command"
                >
                  Copy install command
                </Button>
                <code className="fos-mono">{plan.installCommand}</code>
              </div>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function VerificationSection({
  verification,
  deviceId,
  onOpenDoctor,
}: {
  readonly verification: InstallationVerificationView;
  readonly deviceId: DeviceId | undefined;
  readonly onOpenDoctor: (deviceId: DeviceId) => void;
}): JSX.Element {
  const currentStage = verification.stage ?? "unbootstrapped";
  const currentIndex = Math.max(JOURNEY_STEPS.findIndex((step) => step.id === currentStage), 0);
  const completedIds = JOURNEY_STEPS.slice(0, currentIndex).map((step) => step.id as string);
  return (
    <Card
      title="5. Installation verification"
      subtitle="The agent redeems the code, checks in, reports its first observation, and the Device Twin records the device."
      actions={
        <StatusIndicator
          status={JOURNEY_STAGE_TO_CONSOLE[currentStage] ?? "unknown"}
          label={`${currentStage} — journey stage`}
        />
      }
    >
      <Stepper
        steps={JOURNEY_STEPS.map((step) => ({ id: step.id as string, label: step.label }))}
        currentId={currentStage === "failed" ? "bootstrapped" : currentStage}
        completedIds={completedIds}
      />
      <div className="fos-stack" aria-label="Installation checks">
        {verification.checks.map((check) => (
          <StatusIndicator
            key={check.id}
            status={check.state === "met" ? "succeeded" : "informational"}
            label={`${check.label} — ${check.state === "met" ? "met" : "waiting"}`}
          />
        ))}
      </div>
      {verification.complete && deviceId !== undefined && (
        <div className="fos-row" style={{ marginTop: "0.75rem" }}>
          <Button variant="primary" onClick={(): void => onOpenDoctor(deviceId)}>
            Open Device Doctor for this device
          </Button>
        </div>
      )}
    </Card>
  );
}

function NextActionSection({ action }: { readonly action: NextActionView }): JSX.Element {
  return (
    <Card title="Next action">
      <div className="fos-stack">
        <StatusIndicator
          status={NEXT_ACTION_TO_CONSOLE[action.id] ?? "informational"}
          label={`${action.label} — ${action.id}`}
        />
        <p style={{ margin: "0" }}>{action.detail}</p>
      </div>
    </Card>
  );
}

function RefusalSection({
  reason,
  explanation,
  onDismiss,
}: {
  readonly reason: string;
  readonly explanation: string;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <Card title="Enrollment refused">
      <AlertError title={`Refusal: ${reason}`} message={explanation} />
      <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
        The machine-stable reason and the human explanation are shown verbatim from the enrollment
        boundary.
      </p>
      <div className="fos-row" style={{ marginTop: "0.5rem" }}>
        <Button variant="secondary" onClick={onDismiss}>
          Dismiss the refusal
        </Button>
      </div>
    </Card>
  );
}

function UninstallSection({
  plan,
  onRevokeIntent,
}: {
  readonly plan: UninstallPlanView;
  readonly onRevokeIntent: (intent: "enrollment.code.disable" | "device.trust.revoke") => void;
}): JSX.Element {
  return (
    <Card
      title="Uninstall + revoke"
      subtitle="The same product experience supports removing a device — through the authorized path."
    >
      <DefinitionList
        entries={[
          {
            term: "Uninstall steps",
            value: plan.uninstallSteps.join(" ") || "See the release notes.",
          },
          {
            term: "Rollback / revoke",
            value: plan.rollbackInstructions.join(" ") || "See the release notes.",
          },
          { term: "After uninstall", value: plan.postUninstallState },
          { term: "Audit + evidence", value: plan.auditNote },
        ]}
      />
      <div className="fos-stack" aria-label="Authorized destructive actions">
        {plan.revokeIntents.map((intent) => (
          <div key={intent.intent} className="fos-row">
            <Button
              variant="secondary"
              onClick={(): void => onRevokeIntent(intent.intent)}
              ariaLabel={`${intent.label} (requires authorization)`}
            >
              {intent.label}…
            </Button>
            <span className="fos-meta">
              {intent.note} <Badge status="approval_required">Authorization required</Badge>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const BREADCRUMB: readonly Crumb[] = [
  { label: "Devices" },
  { label: "Install center", current: true },
];

/**
 * The install center screen. FULLY CONTROLLED + deterministic: the
 * same props always produce the same markup. Every intent flows
 * through callbacks; no business truth lives in React state.
 */
export function InstallCenterScreen(props: InstallCenterScreenProps): JSX.Element {
  const summary = releaseSummary(props.release);
  const facets = platformFacets(props.release, props.state);
  const plan = installPlan(props.release, props.state);
  const codeCard = enrollmentCodeCard(props.state, props.now, {
    expiringWithinMs: props.expiringWithinMs,
  });
  const verification = installationVerification(props.journey, props.state, props.release);
  const action = nextInstallAction(props.state, props.release, props.journey);
  const uninstall = uninstallPlan(props.release);

  return (
    <section className="fos-scope fos-screen" aria-label="Devices — Install center">
      <ConsoleStyles />
      <Breadcrumb items={BREADCRUMB} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Install center</h1>
          <p className="fos-screen-subtitle">
            Add devices to your fleet: platform, scope, a one-time code, the installer, and the
            enrollment journey — ending in Device Doctor.
          </p>
        </div>
      </header>

      {summary !== undefined ? (
        <ReleaseSummarySection summary={summary} />
      ) : (
        <Card title="Install the FleetOS agent">
          <p className="fos-meta" style={{ margin: "0" }}>
            No agent release is published yet. Contact your operator.
          </p>
        </Card>
      )}

      <PlatformSelectorSection facets={facets} onPlatformChange={props.onPlatformChange} />
      <OwnershipScopeSection
        selectedKind={props.state.ownershipKind}
        onOwnershipKindChange={props.onOwnershipKindChange}
      />
      <EnrollmentCodeSection
        card={codeCard}
        onCreate={props.onCreateEnrollmentCode}
        onDismiss={props.onDismissCode}
        onRevokeIntent={props.onRevokeIntent}
      />
      <InstallPlanSection plan={plan} onCopyCommand={props.onCopyCommand} />
      <VerificationSection
        verification={verification}
        deviceId={props.deviceId}
        onOpenDoctor={props.onOpenDoctor}
      />
      <NextActionSection action={action} />

      {props.state.refusal !== undefined && (
        <RefusalSection
          reason={props.state.refusal.reason}
          explanation={props.state.refusal.explanation}
          onDismiss={props.onDismissRefusal}
        />
      )}

      <UninstallSection plan={uninstall} onRevokeIntent={props.onRevokeIntent} />
    </section>
  );
}
