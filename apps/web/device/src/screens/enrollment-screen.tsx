/**
 * @fleetos/web-device — D3 rendered: the EnrollmentScreen (W090A).
 *
 * The rendered existing-fleet ENROLLMENT entry point — the ❌ journey
 * gap the UX simulation found. A multi-step journey over the NEW pure
 * enrollment view-model (`enrollment.ts`):
 *
 *   initiate  ->  review  ->  confirm  ->  verified (evidence) | failed
 *
 * The screen is FULLY CONTROLLED: the journey state (stage + draft)
 * and the verification view-model arrive as PROPS; every user intent
 * (draft edits, advance, back, submit) flows through callbacks the
 * shell routes through the pure view-model functions. No business
 * truth in React state.
 *
 * The journey ENDS IN A VERIFIED ENROLLMENT OUTCOME WITH EVIDENCE —
 * never a fire-and-forget form: the verified stage shows the three
 * verification checks (identity recorded, first observation received,
 * evidence trail started) plus the durable evidence block (enrollment
 * record, telemetry, revision log), and hands off to Device Doctor.
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId } from "@fleetos/contracts";
import {
  ENROLLMENT_STAGE_ORDER,
  enrollmentCommand,
  enrollmentReview,
  validateEnrollmentDraft,
} from "../enrollment";
import type {
  EnrollmentDraftPatch,
  EnrollmentFailure,
  EnrollmentJourneyState,
  EnrollmentVerification,
} from "../enrollment";
import { ConsoleStyles } from "../ui/tokens";
import {
  AlertError,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CheckField,
  DefinitionList,
  Field,
  StatusIndicator,
  Stepper,
} from "../ui/primitives";
import { CONSOLE_STATUS_LABEL } from "../ui/status";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** A device-class option (the shell injects the adapter families it manages). */
export interface AdapterFamilyOption {
  readonly family: string;
  readonly label: string;
}

/** An ownership-type option (the shell injects the domain's ownership types). */
export interface OwnershipTypeOption {
  readonly value: string;
  readonly label: string;
}

export interface EnrollmentScreenProps {
  readonly journey: EnrollmentJourneyState;
  /** The verification view-model (required once the journey reaches confirm+). */
  readonly verification: EnrollmentVerification | undefined;
  readonly adapterFamilies: readonly AdapterFamilyOption[];
  readonly ownershipTypes: readonly OwnershipTypeOption[];
  readonly onDraftChange: (patch: EnrollmentDraftPatch) => void;
  readonly onAdvance: () => void;
  readonly onBack: () => void;
  /** Submit the enrollment command (routes the intent to the domain boundary). */
  readonly onSubmit: () => void;
  readonly onOpenDoctor: (deviceId: DeviceId) => void;
  readonly onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Field-error presentation (machine-stable reasons, verbatim)
// ---------------------------------------------------------------------------

const FAILURE_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "/deviceId": "Device ID",
  "/adapterFamily": "Device class (adapter family)",
  "/hardware/manufacturer": "Manufacturer",
  "/hardware/model": "Model",
  "/ownership/ownerType": "Ownership type",
  "/scopeAccepted": "Telemetry scope",
} as const);

function failureLabel(path: string): string {
  return FAILURE_FIELD_LABELS[path] ?? path;
}

function FailureSummary({ failures }: { readonly failures: readonly EnrollmentFailure[] }): JSX.Element | null {
  if (failures.length === 0) return null;
  return (
    <AlertError
      title="The journey cannot continue yet"
      message="Resolve the following — the machine-stable reason codes are shown verbatim."
      failures={failures.map((failure) => ({
        path: `${failureLabel(failure.path)} (${failure.path})`,
        reason: failure.reason,
      }))}
    />
  );
}

// ---------------------------------------------------------------------------
// The initiate step (the form)
// ---------------------------------------------------------------------------

function InitiateStep({
  journey,
  adapterFamilies,
  ownershipTypes,
  onDraftChange,
}: {
  readonly journey: EnrollmentJourneyState;
  readonly adapterFamilies: readonly AdapterFamilyOption[];
  readonly ownershipTypes: readonly OwnershipTypeOption[];
  readonly onDraftChange: (patch: EnrollmentDraftPatch) => void;
}): JSX.Element {
  const failures = validateEnrollmentDraft(journey.draft);
  const has = (path: string): string | undefined =>
    failures.find((failure) => failure.path === path)?.reason;

  return (
    <Card
      title="Initiate the enrollment"
      subtitle="Record the device's identity claims and how it will be managed."
    >
      <div className="fos-grid">
        <Field label="Device ID" hint="Allocated by your enrollment connector, or copied from the asset record." error={has("/deviceId")}>
          {(id: string): ReactNode => (
            <input
              id={id}
              type="text"
              value={journey.draft.deviceId}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                onDraftChange({ deviceId: event.target.value })
              }
            />
          )}
        </Field>
        <Field label="Device class (adapter family)" hint="The adapter that will manage this device." error={has("/adapterFamily")}>
          {(id: string): ReactNode => (
            <select
              id={id}
              value={journey.draft.adapterFamily}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>): void =>
                onDraftChange({ adapterFamily: event.target.value })
              }
            >
              <option value="">Choose a device class…</option>
              {adapterFamilies.map((option) => (
                <option key={option.family} value={option.family}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Manufacturer" error={has("/hardware/manufacturer")}>
          {(id: string): ReactNode => (
            <input
              id={id}
              type="text"
              value={journey.draft.hardware.manufacturer}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                onDraftChange({ hardware: { manufacturer: event.target.value } })
              }
            />
          )}
        </Field>
        <Field label="Model" error={has("/hardware/model")}>
          {(id: string): ReactNode => (
            <input
              id={id}
              type="text"
              value={journey.draft.hardware.model}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                onDraftChange({ hardware: { model: event.target.value } })
              }
            />
          )}
        </Field>
        <Field label="Serial number (optional)">
          {(id: string): ReactNode => (
            <input
              id={id}
              type="text"
              value={journey.draft.hardware.serialNumber ?? ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                onDraftChange({ hardware: { serialNumber: event.target.value } })
              }
            />
          )}
        </Field>
        <Field label="Asset tag (optional)">
          {(id: string): ReactNode => (
            <input
              id={id}
              type="text"
              value={journey.draft.hardware.assetTag ?? ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                onDraftChange({ hardware: { assetTag: event.target.value } })
              }
            />
          )}
        </Field>
        <Field label="Ownership type" error={has("/ownership/ownerType")}>
          {(id: string): ReactNode => (
            <select
              id={id}
              value={journey.draft.ownership.ownerType}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>): void =>
                onDraftChange({ ownership: { ownerType: event.target.value } })
              }
            >
              <option value="">Choose an ownership type…</option>
              {ownershipTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Assigned team (optional)">
          {(id: string): ReactNode => (
            <input
              id={id}
              type="text"
              value={journey.draft.ownership.assignedTeam ?? ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                onDraftChange({ ownership: { assignedTeam: event.target.value } })
              }
            />
          )}
        </Field>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The review step (the exact command that will be recorded)
// ---------------------------------------------------------------------------

function ReviewStep({
  journey,
  ownershipTypes,
  onDraftChange,
}: {
  readonly journey: EnrollmentJourneyState;
  readonly ownershipTypes: readonly OwnershipTypeOption[];
  readonly onDraftChange: (patch: EnrollmentDraftPatch) => void;
}): JSX.Element {
  const review = enrollmentReview(journey);
  const ownershipLabel =
    ownershipTypes.find((option) => option.value === review.ownership.ownerType)?.label ??
    review.ownership.ownerType;
  const scopeNote =
    review.scopeKind === "byod"
      ? "Personal (BYOD) scope: telemetry is minimized and purpose-bound. Personal and corporate-owned scopes are distinct — this device enrolls as CUSTOMER_OWNED."
      : "Corporate-owned scope: the device is managed under your fleet's policies. Telemetry is minimized and purpose-bound.";
  return (
    <>
      <Card title="Review the enrollment" subtitle="Exactly what will be recorded when you confirm.">
        <DefinitionList
          entries={[
            { term: "Device ID", value: <span className="fos-mono">{review.deviceId}</span> },
            { term: "Device class", value: <span className="fos-mono">{review.adapterFamily}</span> },
            { term: "Manufacturer", value: review.hardware.manufacturer },
            { term: "Model", value: review.hardware.model },
            {
              term: "Serial number",
              value: review.hardware.serialNumber === undefined || review.hardware.serialNumber.length === 0 ? "—" : review.hardware.serialNumber,
            },
            {
              term: "Asset tag",
              value: review.hardware.assetTag === undefined || review.hardware.assetTag.length === 0 ? "—" : review.hardware.assetTag,
            },
            { term: "Ownership", value: ownershipLabel },
            {
              term: "Assigned team",
              value:
                review.ownership.assignedTeam === undefined || review.ownership.assignedTeam.length === 0
                  ? "—"
                  : review.ownership.assignedTeam,
            },
          ]}
        />
      </Card>
      <Card title="Telemetry scope" subtitle="Accepting the scope is required before the enrollment can be confirmed.">
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>{scopeNote}</p>
        <CheckField
          label="I accept the telemetry scope for this device"
          description="The acceptance is recorded with the enrollment."
          checked={journey.draft.scopeAccepted}
          onChange={(checked: boolean): void => onDraftChange({ scopeAccepted: checked })}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The confirm step (submitted; the outcome follows)
// ---------------------------------------------------------------------------

function ConfirmStep({
  journey,
  verification,
  onSubmit,
}: {
  readonly journey: EnrollmentJourneyState;
  readonly verification: EnrollmentVerification | undefined;
  readonly onSubmit: () => void;
}): JSX.Element {
  const command = enrollmentCommand(journey);
  return (
    <Card title="Confirm the enrollment" subtitle="The command is submitted to the enrollment boundary; the verified outcome follows with evidence.">
      {command !== undefined && (
        <DefinitionList
          entries={[
            { term: "Tenant", value: <span className="fos-mono">{command.tenantId}</span> },
            { term: "Device", value: <span className="fos-mono">{command.deviceId}</span> },
            { term: "Intent", value: "Enroll an existing fleet device" },
            { term: "Scope accepted", value: "Yes" },
          ]}
        />
      )}
      <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
        Submission routes the enrollment intent through the domain boundary — identity verification, the
        durable twin, and the first observation. Nothing executes inside this screen.
      </p>
      {verification !== undefined && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ margin: "0 0 0.35rem" }}>
            <Badge status={verification.status === "verified" ? "succeeded" : "unknown"}>
              Verification: {verification.status}
            </Badge>
          </p>
        </div>
      )}
      <div style={{ marginTop: "1rem" }}>
        <Button variant="primary" onClick={onSubmit}>Submit enrollment</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The verified terminal state (evidence visible — never fire-and-forget)
// ---------------------------------------------------------------------------

function VerifiedStep({
  verification,
  onOpenDoctor,
}: {
  readonly verification: EnrollmentVerification | undefined;
  readonly onOpenDoctor: (deviceId: DeviceId) => void;
}): JSX.Element {
  if (verification === undefined) {
    return (
      <AlertError
        title="Verification is not available yet"
        message="The verified outcome is derived from the device twin source; it arrives with the domain outcome."
      />
    );
  }
  const verified = verification.status === "verified";
  return (
    <>
      <Card
        title={verified ? "Enrollment verified" : "Enrollment recorded — verification pending"}
        subtitle={`The journey's terminal evidence for device ${verification.deviceId}.`}
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {verification.checks.map((check) => (
            <li key={check.id}>
              <StatusIndicator
                status={check.state === "met" ? "healthy" : "unknown"}
                label={`${check.label} — ${check.state === "met" ? CONSOLE_STATUS_LABEL.healthy : CONSOLE_STATUS_LABEL.unknown}`}
              />
            </li>
          ))}
        </ul>
        <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
          {verified
            ? "All checks passed: the device identity is durable, the first observation arrived, and the append-only evidence trail started."
            : "Some checks are still unmet — the device has not finished reporting. Verification is re-derived as observations arrive."}
        </p>
      </Card>
      <Card title="Enrollment evidence">
        <DefinitionList
          entries={[
            {
              term: "Enrolled at",
              value:
                verification.evidence.enrolledAt === undefined ? (
                  "—"
                ) : (
                  <span className="fos-mono fos-meta">{verification.evidence.enrolledAt}</span>
                ),
            },
            { term: "Adapter family", value: verification.evidence.adapterFamily ?? "—" },
            {
              term: "Hardware",
              value:
                verification.evidence.hardware === undefined
                  ? "—"
                  : `${verification.evidence.hardware.manufacturer} ${verification.evidence.hardware.model}`,
            },
            { term: "Ownership", value: verification.evidence.ownership?.ownerType ?? "—" },
            { term: "Lifecycle state", value: verification.evidence.lifecycleState ?? "—" },
            { term: "Observations received", value: String(verification.evidence.observationCount) },
            {
              term: "Last observed",
              value:
                verification.evidence.lastObservedAt === undefined || verification.evidence.lastObservedAt === null
                  ? "No observation yet"
                  : <span className="fos-mono fos-meta">{verification.evidence.lastObservedAt}</span>,
            },
            { term: "Revision trail", value: `${verification.evidence.revisionCount} entries` },
          ]}
        />
        {verification.evidence.revisions.length > 0 && (
          <div className="fos-table-wrap" style={{ marginTop: "0.75rem" }}>
            <table className="fos-table">
              <caption>Append-only revision trail (evidence)</caption>
              <thead>
                <tr>
                  <th scope="col">Revision</th>
                  <th scope="col">At</th>
                  <th scope="col">Section</th>
                  <th scope="col">Mutation</th>
                </tr>
              </thead>
              <tbody>
                {verification.evidence.revisions.map((entry, index) => (
                  <tr key={`${entry.revision}-${index}`}>
                    <td>{entry.revision}</td>
                    <td><span className="fos-mono fos-meta">{entry.at}</span></td>
                    <td><span className="fos-mono">{entry.section}</span></td>
                    <td><span className="fos-mono">{entry.mutation}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Next step">
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
          The enrollment journey is complete. Continue to Device Doctor to inspect the device's first
          readings and diagnoses.
        </p>
        <Button variant="primary" onClick={(): void => onOpenDoctor(verification.deviceId)}>
          Open Device Doctor
        </Button>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const STAGE_LABELS: Readonly<Record<EnrollmentJourneyState["stage"], string>> = Object.freeze({
  initiate: "Initiate",
  review: "Review",
  confirm: "Confirm",
  verified: "Verified",
  failed: "Failed",
} as const);

/** The rendered enrollment journey screen (initiate -> review -> confirm -> verified). */
export function EnrollmentScreen(props: EnrollmentScreenProps): JSX.Element {
  const { journey } = props;
  const fieldFailures = validateEnrollmentDraft(journey.draft);
  const canAdvance =
    journey.stage === "initiate"
      ? fieldFailures.length === 0
      : journey.stage === "review"
        ? fieldFailures.length === 0 && journey.draft.scopeAccepted === true
        : false;

  let stepBody: ReactNode;
  let advanceLabel = "Continue";
  switch (journey.stage) {
    case "initiate":
      stepBody = (
        <InitiateStep
          journey={journey}
          adapterFamilies={props.adapterFamilies}
          ownershipTypes={props.ownershipTypes}
          onDraftChange={props.onDraftChange}
        />
      );
      advanceLabel = "Continue to review";
      break;
    case "review":
      stepBody = (
        <ReviewStep journey={journey} ownershipTypes={props.ownershipTypes} onDraftChange={props.onDraftChange} />
      );
      advanceLabel = "Confirm enrollment";
      break;
    case "confirm":
      stepBody = <ConfirmStep journey={journey} verification={props.verification} onSubmit={props.onSubmit} />;
      advanceLabel = "Confirm enrollment";
      break;
    case "verified":
      stepBody = (
        <VerifiedStep verification={props.verification} onOpenDoctor={props.onOpenDoctor} />
      );
      break;
    case "failed":
      stepBody = (
        <>
          <AlertError
            title="The enrollment was refused"
            message="The domain boundary refused the enrollment command. The machine-stable reason is shown verbatim; step back to review and correct the draft."
            failures={[{ path: "/enrollment", reason: "enrollment_refused" }]}
          />
          <Card title="Recover the journey">
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
              Step back to the review step to correct the record, or cancel the journey.
            </p>
            <Button variant="secondary" onClick={props.onBack}>Back to review</Button>
          </Card>
        </>
      );
      break;
  }

  const completedStages =
    journey.stage === "verified"
      ? ["initiate", "review", "confirm"]
      : journey.stage === "failed"
        ? ["initiate", "review", "confirm"]
        : journey.stage === "confirm"
          ? ["initiate", "review"]
          : journey.stage === "review"
            ? ["initiate"]
            : [];

  return (
    <section className="fos-scope fos-screen" aria-label="Devices — Enroll devices">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Devices" }, { label: "Enroll devices", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Enroll devices</h1>
          <p className="fos-screen-subtitle">
            Bring an existing fleet device under management: record its identity, accept the telemetry
            scope, and verify the first observation — with evidence.
          </p>
        </div>
        <Button variant="ghost" onClick={props.onCancel}>Cancel enrollment</Button>
      </header>
      <Card title="Journey progress">
        <Stepper
          steps={ENROLLMENT_STAGE_ORDER.map((stage) => ({ id: stage, label: STAGE_LABELS[stage] }))}
          currentId={journey.stage === "failed" ? "confirm" : journey.stage}
          completedIds={completedStages}
        />
        <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
          The journey ends in a verified enrollment outcome with evidence — not a fire-and-forget form.
        </p>
      </Card>
      {journey.stage === "initiate" && fieldFailures.length > 0 && (
        <FailureSummary failures={fieldFailures} />
      )}
      {journey.stage === "review" &&
        (fieldFailures.length > 0 ? (
          <FailureSummary failures={fieldFailures} />
        ) : journey.draft.scopeAccepted !== true ? (
          <FailureSummary failures={[{ path: "/scopeAccepted", reason: "acceptance_required" }]} />
        ) : null)}
      {stepBody}
      {(journey.stage === "initiate" || journey.stage === "review") && (
        <div className="fos-row">
          {journey.stage === "review" && <Button variant="secondary" onClick={props.onBack}>← Back</Button>}
          <Button variant="primary" disabled={!canAdvance} onClick={props.onAdvance}>
            {advanceLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
