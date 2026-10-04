/**
 * @fleetos/web-device — W145 rendered: the DeclaredImportScreen.
 *
 * The rendered MANUAL device-record entry path — the SMALL-firm
 * cold-start fix (SIM-B: "enrollment stays 'unbootstrapped — waiting'
 * with no manual path"). A multi-step journey over the NEW pure
 * declared-import view-model (`declared-import.ts`):
 *
 *   enter  ->  review  ->  confirm  ->  recorded (evidence) | refused
 *
 * The screen is FULLY CONTROLLED: the journey state (stage + draft),
 * the duplicate review, and the recorded-outcome verification arrive
 * as PROPS; every user intent (draft edits, advance, back, submit)
 * flows through callbacks the shell routes through the pure
 * view-model functions. No business truth in React state.
 *
 * The DECLARED provenance is visible from the first pixel: the screen
 * is badged DECLARED at the header, the review step requires the
 * explicit provenance acknowledgment (a declared record is NOT an
 * agent-observed record — it stays Never observed until an agent is
 * installed), and the recorded terminal state shows the three
 * verification checks (record present, marked DECLARED, no fabricated
 * observations) plus the durable evidence block.
 *
 * Deterministic: same props -> byte-identical JSX. No clock, no I/O.
 */

import type { JSX, ReactNode } from "react";
import type { DeviceId } from "@fleetos/contracts";
import {
  DECLARED_IMPORT_STAGE_ORDER,
  validateDeclaredDeviceDraft,
} from "../declared-import";
import type {
  DeclaredDeviceDraftPatch,
  DeclaredImportFailure,
  DeclaredImportJourneyState,
  DeclaredImportReviewView,
  DeclaredImportVerification,
} from "../declared-import";
import { DEVICE_RECORD_PROVENANCE_LABEL } from "../declared-import";
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

/** An ownership-type option (the shell injects the domain's ownership types). */
export interface DeclaredOwnershipTypeOption {
  readonly value: string;
  readonly label: string;
}

export interface DeclaredImportScreenProps {
  readonly journey: DeclaredImportJourneyState;
  /** The duplicate review view-model (required at the review+ steps). */
  readonly review: DeclaredImportReviewView | undefined;
  /** The recorded-outcome verification (required once the journey reaches confirm+). */
  readonly verification: DeclaredImportVerification | undefined;
  readonly ownershipTypes: readonly DeclaredOwnershipTypeOption[];
  readonly onDraftChange: (patch: DeclaredDeviceDraftPatch) => void;
  readonly onAdvance: () => void;
  readonly onBack: () => void;
  /** Submit the declared-import command (routes the intent to the domain boundary). */
  readonly onSubmit: () => void;
  /** Continue to the roster (the declared record, marked, in the fleet list). */
  readonly onOpenRoster: () => void;
  readonly onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Field-error presentation (machine-stable reasons, verbatim)
// ---------------------------------------------------------------------------

const DECLARED_FAILURE_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "/deviceId": "Device ID",
  "/hardware/manufacturer": "Manufacturer",
  "/hardware/model": "Model",
  "/ownership/ownerType": "Ownership type",
  "/provenanceAcknowledged": "Provenance acknowledgment",
  "/duplicates/deviceId": "Duplicate device id",
  "/duplicates/serialNumber": "Duplicate serial number",
} as const);

function declaredFailureLabel(path: string): string {
  return DECLARED_FAILURE_FIELD_LABELS[path] ?? path;
}

function DeclaredFailureSummary({
  failures,
}: {
  readonly failures: readonly DeclaredImportFailure[];
}): JSX.Element | null {
  if (failures.length === 0) return null;
  return (
    <AlertError
      title="The declared import cannot continue yet"
      message="Resolve the following — the machine-stable reason codes are shown verbatim."
      failures={failures.map((failure) => ({
        path: `${declaredFailureLabel(failure.path)} (${failure.path})`,
        reason: failure.reason,
      }))}
    />
  );
}

// ---------------------------------------------------------------------------
// The enter step (the form)
// ---------------------------------------------------------------------------

function EnterStep({
  journey,
  ownershipTypes,
  onDraftChange,
}: {
  readonly journey: DeclaredImportJourneyState;
  readonly ownershipTypes: readonly DeclaredOwnershipTypeOption[];
  readonly onDraftChange: (patch: DeclaredDeviceDraftPatch) => void;
}): JSX.Element {
  const failures = validateDeclaredDeviceDraft(journey.draft);
  const has = (path: string): string | undefined =>
    failures.find((failure) => failure.path === path)?.reason;

  return (
    <Card
      title="Declare the device record"
      subtitle="Enter what your asset record says. No agent is needed — this is a DECLARED record, clearly marked as such everywhere it appears."
    >
      <div className="fos-grid">
        <Field
          label="Device ID"
          hint="Your own identifier for the device (copied from the asset record or spreadsheet)."
          error={has("/deviceId")}
        >
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
        <Field label="Serial number (optional)" hint="Used to detect duplicates against existing records.">
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
// The review step (the exact record + the honest duplicate report)
// ---------------------------------------------------------------------------

function DuplicateReport({
  review,
  journey,
  onDraftChange,
}: {
  readonly review: DeclaredImportReviewView;
  readonly journey: DeclaredImportJourneyState;
  readonly onDraftChange: (patch: DeclaredDeviceDraftPatch) => void;
}): JSX.Element | null {
  if (review.duplicates.length === 0) return null;
  const blocking = review.duplicates.filter((finding) => finding.kind === "duplicate_device_id");
  const serials = review.duplicates.filter((finding) => finding.kind === "duplicate_serial_number");
  return (
    <>
      {blocking.length > 0 && (
        <AlertError
          title="This device id is already in your fleet"
          message="A declared import never overwrites or merges an existing record. The existing record is shown — go back and use a different device id, or open the existing record."
          failures={blocking.map((finding) => ({
            path: `${finding.displayName} (${finding.deviceId}) — ${DEVICE_RECORD_PROVENANCE_LABEL[finding.provenance]}`,
            reason: finding.kind,
          }))}
        />
      )}
      {serials.length > 0 && (
        <Card
          title="A record with the same serial number exists"
          subtitle="Confirm this is a different device before the import can proceed."
        >
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {serials.map((finding) => (
              <li key={`${finding.kind}-${finding.deviceId}`} className="fos-meta">
                <span className="fos-mono">{finding.deviceId}</span> — {finding.displayName} (
                {DEVICE_RECORD_PROVENANCE_LABEL[finding.provenance]})
              </li>
            ))}
          </ul>
          <div style={{ marginTop: "0.75rem" }}>
            <CheckField
              label="This is a different device (the repeated serial number is intentional)"
              description="The acknowledgment is recorded with the declared import."
              checked={journey.draft.duplicateSerialAcknowledged}
              onChange={(checked: boolean): void =>
                onDraftChange({ duplicateSerialAcknowledged: checked })
              }
            />
          </div>
        </Card>
      )}
    </>
  );
}

function ReviewStep({
  journey,
  review,
  ownershipTypes,
  onDraftChange,
}: {
  readonly journey: DeclaredImportJourneyState;
  readonly review: DeclaredImportReviewView | undefined;
  readonly ownershipTypes: readonly DeclaredOwnershipTypeOption[];
  readonly onDraftChange: (patch: DeclaredDeviceDraftPatch) => void;
}): JSX.Element {
  if (review === undefined) {
    return (
      <AlertError
        title="The duplicate review is not available yet"
        message="The review is derived from your fleet's device records; it arrives with the shell's runtime state."
      />
    );
  }
  const ownershipLabel =
    ownershipTypes.find((option) => option.value === review.ownership.ownerType)?.label ??
    review.ownership.ownerType;
  return (
    <>
      <Card title="Review the declared record" subtitle="Exactly what will be recorded when you confirm.">
        <p style={{ margin: "0 0 0.75rem" }}>
          <Badge status="informational">{DEVICE_RECORD_PROVENANCE_LABEL.DECLARED}</Badge>{" "}
          <span className="fos-meta">
            This record enters your fleet as a DECLARED import — it is not an agent-observed record.
          </span>
        </p>
        <DefinitionList
          entries={[
            { term: "Device ID", value: <span className="fos-mono">{review.deviceId}</span> },
            { term: "Record origin", value: `${DEVICE_RECORD_PROVENANCE_LABEL.DECLARED} (manual import — no agent)` },
            { term: "Manufacturer", value: review.hardware.manufacturer },
            { term: "Model", value: review.hardware.model },
            {
              term: "Serial number",
              value:
                review.hardware.serialNumber === undefined || review.hardware.serialNumber.length === 0
                  ? "—"
                  : review.hardware.serialNumber,
            },
            {
              term: "Asset tag",
              value:
                review.hardware.assetTag === undefined || review.hardware.assetTag.length === 0
                  ? "—"
                  : review.hardware.assetTag,
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
      <DuplicateReport review={review} journey={journey} onDraftChange={onDraftChange} />
      <Card
        title="What a DECLARED record means"
        subtitle="The provenance acknowledgment is required before the import can be confirmed."
      >
        <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem", fontSize: "0.875rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <li>It appears in your roster, feeds and searches marked DECLARED — never as agent-observed.</li>
          <li>It receives no observations until an agent is installed; it stays "Never observed".</li>
          <li>Installing the agent later upgrades it to real observations; the DECLARED origin mark stays.</li>
        </ul>
        <CheckField
          label="I understand this is a DECLARED record, not an agent-observed one"
          description="The acknowledgment is recorded with the declared import."
          checked={journey.draft.provenanceAcknowledged}
          onChange={(checked: boolean): void => onDraftChange({ provenanceAcknowledged: checked })}
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
  review,
  verification,
  onSubmit,
}: {
  readonly journey: DeclaredImportJourneyState;
  readonly review: DeclaredImportReviewView | undefined;
  readonly verification: DeclaredImportVerification | undefined;
  readonly onSubmit: () => void;
}): JSX.Element {
  return (
    <Card
      title="Confirm the declared import"
      subtitle="The command is submitted to the enrollment boundary; the recorded outcome follows with evidence."
    >
      {review !== undefined && (
        <DefinitionList
          entries={[
            { term: "Tenant", value: <span className="fos-mono">{journey.draft.tenantId}</span> },
            { term: "Device", value: <span className="fos-mono">{review.deviceId}</span> },
            { term: "Intent", value: "Declare a device record (no agent)" },
            { term: "Record origin", value: DEVICE_RECORD_PROVENANCE_LABEL.DECLARED },
          ]}
        />
      )}
      <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
        Submission routes the declared-import intent through the domain boundary — the durable
        twin is created with the DECLARED provenance mark and an empty telemetry window. Nothing
        executes inside this screen.
      </p>
      {verification !== undefined && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ margin: "0 0 0.35rem" }}>
            <Badge status={verification.status === "declared" ? "succeeded" : "unknown"}>
              Verification: {verification.status}
            </Badge>
          </p>
        </div>
      )}
      <div style={{ marginTop: "1rem" }}>
        <Button variant="primary" onClick={onSubmit}>Submit declared import</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The recorded terminal state (evidence visible — never fire-and-forget)
// ---------------------------------------------------------------------------

function RecordedStep({
  verification,
  onOpenRoster,
}: {
  readonly verification: DeclaredImportVerification | undefined;
  readonly onOpenRoster: () => void;
}): JSX.Element {
  if (verification === undefined) {
    return (
      <AlertError
        title="Verification is not available yet"
        message="The recorded outcome is derived from the device twin source; it arrives with the domain outcome."
      />
    );
  }
  const recorded = verification.status === "declared";
  return (
    <>
      <Card
        title={recorded ? "Declared record verified" : "Recorded — verification pending"}
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
          {recorded
            ? "The record is durable, carries the DECLARED provenance mark, and fabricated no observations. It shows as Never observed until a real agent checks in — the origin mark stays either way."
            : verification.status === "present_not_declared"
              ? "The record exists but does NOT carry the DECLARED mark — the import contract was violated at the boundary, and this surface reports it rather than presenting the record as declared."
              : "Some checks are still unmet — verification is re-derived as the runtime state resolves."}
        </p>
      </Card>
      <Card title="Declared-record evidence">
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
            {
              term: "Record origin",
              value: DEVICE_RECORD_PROVENANCE_LABEL[verification.evidence.provenance],
            },
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
      </Card>
      <Card title="Next step">
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
          The declared record is in your fleet, marked DECLARED. Continue to the roster to see it
          alongside your agent-observed devices — or install the agent later to start real
          observations.
        </p>
        <Button variant="primary" onClick={onOpenRoster}>Open the device roster</Button>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const DECLARED_STAGE_LABELS: Readonly<Record<DeclaredImportJourneyState["stage"], string>> =
  Object.freeze({
    enter: "Enter",
    review: "Review",
    confirm: "Confirm",
    recorded: "Recorded",
    refused: "Refused",
  } as const);

/** The rendered declared-import journey screen (enter -> review -> confirm -> recorded). */
export function DeclaredImportScreen(props: DeclaredImportScreenProps): JSX.Element {
  const { journey } = props;
  const fieldFailures = validateDeclaredDeviceDraft(journey.draft);
  const canAdvance =
    journey.stage === "enter"
      ? fieldFailures.length === 0
      : journey.stage === "review"
        ? props.review !== undefined && props.review.ready
        : false;

  let stepBody: ReactNode;
  let advanceLabel = "Continue";
  switch (journey.stage) {
    case "enter":
      stepBody = (
        <EnterStep
          journey={journey}
          ownershipTypes={props.ownershipTypes}
          onDraftChange={props.onDraftChange}
        />
      );
      advanceLabel = "Continue to review";
      break;
    case "review":
      stepBody = (
        <ReviewStep
          journey={journey}
          review={props.review}
          ownershipTypes={props.ownershipTypes}
          onDraftChange={props.onDraftChange}
        />
      );
      advanceLabel = "Confirm declared import";
      break;
    case "confirm":
      stepBody = (
        <ConfirmStep
          journey={journey}
          review={props.review}
          verification={props.verification}
          onSubmit={props.onSubmit}
        />
      );
      advanceLabel = "Confirm declared import";
      break;
    case "recorded":
      stepBody = (
        <RecordedStep verification={props.verification} onOpenRoster={props.onOpenRoster} />
      );
      break;
    case "refused":
      stepBody = (
        <>
          <AlertError
            title="The declared import was refused"
            message="The domain boundary refused the declared-import command. The machine-stable reason is shown verbatim; step back to review and correct the draft."
            failures={[{ path: "/declaredImport", reason: "declared_import_refused" }]}
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
    journey.stage === "recorded" || journey.stage === "refused"
      ? ["enter", "review", "confirm"]
      : journey.stage === "confirm"
        ? ["enter", "review"]
        : journey.stage === "review"
          ? ["enter"]
          : [];

  return (
    <section className="fos-scope fos-screen" aria-label="Devices — Declare a device">
      <ConsoleStyles />
      <Breadcrumb items={[{ label: "Devices" }, { label: "Declare a device", current: true }]} />
      <header className="fos-screen-header">
        <div>
          <h1 className="fos-screen-title">Declare a device</h1>
          <p className="fos-screen-subtitle">
            Begin tracking a device before any agent is installed: the record enters your fleet
            provenance-flagged <Badge status="informational">{DEVICE_RECORD_PROVENANCE_LABEL.DECLARED}</Badge>{" "}
            — never conflated with agent-observed records, never fabricating observations.
          </p>
        </div>
        <Button variant="ghost" onClick={props.onCancel}>Cancel import</Button>
      </header>
      <Card title="Journey progress">
        <Stepper
          steps={DECLARED_IMPORT_STAGE_ORDER.map((stage) => ({
            id: stage,
            label: DECLARED_STAGE_LABELS[stage],
          }))}
          currentId={journey.stage === "refused" ? "confirm" : journey.stage}
          completedIds={completedStages}
        />
        <p className="fos-meta" style={{ margin: "0.75rem 0 0" }}>
          The journey ends in a recorded, verified DECLARED outcome with evidence — not a
          fire-and-forget form.
        </p>
      </Card>
      {journey.stage === "enter" && fieldFailures.length > 0 && (
        <DeclaredFailureSummary failures={fieldFailures} />
      )}
      {journey.stage === "review" && props.review !== undefined && !props.review.ready && (
        <DeclaredFailureSummary
          failures={[
            ...props.review.fieldFailures,
            ...(props.review.blockingDuplicate
              ? [{ path: "/duplicates/deviceId", reason: "duplicate_device_id" }]
              : []),
            ...(!props.review.serialAcknowledged
              ? [{ path: "/duplicates/serialNumber", reason: "duplicate_serial_acknowledgment_required" }]
              : []),
            ...(journey.draft.provenanceAcknowledged !== true
              ? [{ path: "/provenanceAcknowledged", reason: "acknowledgment_required" }]
              : []),
          ]}
        />
      )}
      {stepBody}
      {(journey.stage === "enter" || journey.stage === "review") && (
        <div className="fos-row">
          {journey.stage === "review" && (
            <Button variant="secondary" onClick={props.onBack}>← Back</Button>
          )}
          <Button variant="primary" disabled={!canAdvance} onClick={props.onAdvance}>
            {advanceLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
