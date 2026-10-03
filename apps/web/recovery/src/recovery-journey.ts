/**
 * @fleetos/web-recovery — W141: the RECOVERY CASE JOURNEY view-model.
 *
 * The full lost/stolen-device recovery journey the accepted deep screen
 * must carry, as ONE machine-stable walk (SIM-B ask 1; UX-JOURNEY-
 * SIMULATION Journey 4 — the required sequence):
 *
 *   lost/stolen signal -> recovery case -> locate/secure decision ->
 *   authorization -> action -> evidence -> closure/escalation
 *
 * Presentation doctrine (frozen by this module's contract):
 *
 *   - EVERY stage state is HONEST and derived from real runtime state
 *     only: a case with no location evidence says `no_location_evidence`
 *     (the frozen domain vocabulary, verbatim — never a guess); a case
 *     with no destructive requests says `not_requested`; an open case
 *     says `open` with its legal continuations. Nothing is fabricated.
 *   - The LOCATE/SECURE DECISION stage carries the case's read-only
 *     state machine (the injected frozen table's legal continuations)
 *     plus the find-my location evidence — the operator's decision
 *     context, displayed; the decision itself belongs to the domain
 *     boundary (the surface never offers a transition control).
 *   - The AUTHORIZATION stage carries the Guardian decisions recorded
 *     on the case's destructive requests (or `not_evaluated`); the
 *     ACTION stage the requests themselves (or `not_requested`); the
 *     EVIDENCE stage the opaque evidence refs; the CLOSURE/ESCALATION
 *     stage the machine-stable closure reason or the escalation state
 *     with the legal continuation (REPLACEMENT_PROPOSED — a proposal,
 *     never procurement).
 *
 * PURE + DETERMINISTIC: no clock (the reference instant is injected), no
 * randomness, no I/O. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, TenantId } from "@fleetos/contracts";
import { SYNTHETIC_SYSTEM_TENANT, checkRecoveryUiTenantScope, frozen, frozenArray } from "./internal";
import type { RecoveryUiTenantScope } from "./internal";
import type {
  DestructiveRequestLike,
  FindMyLocationLike,
  RecoveryCaseLike,
  StatusMachineTable,
} from "./seams";
import type { CaseStateMachineView } from "./recovery-case";
import { caseStateMachineView } from "./recovery-case";

// ---------------------------------------------------------------------------
// The journey stages (machine-stable ids, canonical order)
// ---------------------------------------------------------------------------

/** The recovery case journey stage ids, in the frozen journey order. */
export const RECOVERY_JOURNEY_STAGES = [
  "signal",
  "case",
  "locate_secure_decision",
  "authorization",
  "action",
  "evidence",
  "closure_escalation",
] as const;

export type RecoveryJourneyStageId = (typeof RECOVERY_JOURNEY_STAGES)[number];

/** The honest state of one journey stage. */
export type RecoveryJourneyStageState =
  | "ready"
  | "not_yet_observed"
  | "empty"
  | "blocked"
  | "approval_required";

/** One journey stage's display row (all values derived from real state). */
export interface RecoveryJourneyStage {
  readonly id: RecoveryJourneyStageId;
  readonly state: RecoveryJourneyStageState;
  /** The machine-stable headline (frozen vocabulary, never prose). */
  readonly headline: string;
  /** Ordered detail rows (label + value, both derived from real records). */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}

// ---------------------------------------------------------------------------
// The machine-stable stage headlines (frozen vocabulary)
// ---------------------------------------------------------------------------

export const RECOVERY_JOURNEY_HEADLINES: Readonly<Record<RecoveryJourneyStageId, string>> =
  Object.freeze({
    signal: "Lost/stolen signal",
    case: "Recovery case",
    locate_secure_decision: "Locate/secure decision",
    authorization: "Authorization",
    action: "Action",
    evidence: "Evidence",
    closure_escalation: "Closure / escalation",
  } as const);

// ---------------------------------------------------------------------------
// The journey view-model
// ---------------------------------------------------------------------------

/**
 * The recovery case journey: the seven frozen stages with honest
 * states — every value derived from REAL runtime state (the case
 * record, the find-my location state, the destructive requests).
 */
export interface RecoveryCaseJourney {
  readonly tenantId: TenantId | typeof SYNTHETIC_SYSTEM_TENANT;
  readonly caseId: string;
  readonly deviceId: DeviceId;
  readonly stages: readonly RecoveryJourneyStage[];
  /** Machine-stable: is any destructive request parked for a human? */
  readonly approvalPending: boolean;
}

/** The journey build's inputs (all REAL state; nothing fabricated). */
export interface RecoveryCaseJourneyInput {
  /** The case's LATEST revision (the journey's anchor). */
  readonly caseRecord: RecoveryCaseLike;
  /** The case's read-only state machine (the injected frozen table). */
  readonly machine: CaseStateMachineView;
  /** The find-my location state for the case's device (honest absence ok). */
  readonly location: FindMyLocationLike | undefined;
  /** The case's destructive requests (latest per action, real records). */
  readonly requests: readonly DestructiveRequestLike[];
  /** The injected "now" (ISO 8601) — display reference only. */
  readonly now: string;
}

/**
 * Build the recovery case journey view-model. PURE and DETERMINISTIC:
 * the same inputs produce a byte-identical journey. Stage honesty:
 *
 *   signal        the trigger kind + reported-at (or the honest
 *                 `not_yet_reported` when the trigger carries no time)
 *   case          the versioned status + legal continuations (the
 *                 injected frozen table, verbatim)
 *   decision      the case state + the location evidence (the machine-
 *                 stable `no_location_evidence` when absent — verbatim)
 *   authorization the requests' Guardian decisions (or not_evaluated)
 *   action        the requests' statuses (or not_requested)
 *   evidence      the requests' opaque evidence ref counts + the case's
 *                 evidence basis
 *   closure       the closure reason + closed-at, or the open state's
 *                 legal continuations (escalation proposes replacement —
 *                 a proposal, never procurement)
 */
export function buildRecoveryCaseJourney(
  scope: RecoveryUiTenantScope,
  input: RecoveryCaseJourneyInput,
): RecoveryCaseJourney {
  const guard = checkRecoveryUiTenantScope(scope);
  const { caseRecord, machine, location, requests } = input;

  const decidedRequests = requests.filter((request) => request.decision !== undefined);
  const parkedRequests = requests.filter((request) => request.status === "PARKED");
  const executedRequests = requests.filter((request) => request.execution !== undefined);
  const evidenceCount =
    requests.reduce((total, request) => total + request.evidence.length, 0) +
    caseRecord.evidence.postureFindingRefs.length +
    (caseRecord.evidence.lastSeenRecordId !== undefined ? 1 : 0);

  const authorizationState: RecoveryJourneyStageState =
    decidedRequests.length === 0
      ? "not_yet_observed"
      : parkedRequests.length > 0
        ? "approval_required"
        : "ready";

  const stages: RecoveryJourneyStage[] = [
    frozen<RecoveryJourneyStage>({
      id: "signal",
      state: caseRecord.trigger.reportedAt === undefined ? "not_yet_observed" : "ready",
      headline: RECOVERY_JOURNEY_HEADLINES.signal,
      rows: frozenArray([
        { label: "Trigger kind", value: caseRecord.trigger.kind },
        {
          label: "Reported at",
          value: caseRecord.trigger.reportedAt ?? "not_yet_reported",
        },
        {
          label: "Posture status",
          value: caseRecord.trigger.postureStatus ?? "—",
        },
        {
          label: "Finding refs",
          value: String(caseRecord.trigger.findingRefs?.length ?? 0),
        },
      ]),
    }),
    frozen<RecoveryJourneyStage>({
      id: "case",
      state: "ready",
      headline: RECOVERY_JOURNEY_HEADLINES.case,
      rows: frozenArray([
        { label: "Case", value: caseRecord.caseId },
        { label: "Status", value: caseRecord.status },
        { label: "Version", value: `v${caseRecord.version}` },
        {
          label: "Legal continuations",
          value: machine.legalNext.length === 0 ? "none — terminal" : machine.legalNext.join(", "),
        },
      ]),
    }),
    frozen<RecoveryJourneyStage>({
      id: "locate_secure_decision",
      state:
        machine.isActive
          ? location === undefined
            ? "not_yet_observed"
            : location.status === "located"
              ? "ready"
              : "empty"
          : "ready",
      headline: RECOVERY_JOURNEY_HEADLINES.locate_secure_decision,
      rows: frozenArray([
        { label: "Case state", value: machine.isActive ? "active — accepting decisions" : caseRecord.status },
        {
          label: "Location evidence",
          value:
            location === undefined
              ? "no_find_my_view"
              : location.status === "located"
                ? `located (observation ${location.observationId}, ${location.staleness})`
                : location.status,
        },
        {
          label: "Destructive gate",
          value: machine.isActive ? "accepts destructive requests" : "closed — case not active",
        },
      ]),
    }),
    frozen<RecoveryJourneyStage>({
      id: "authorization",
      state: authorizationState,
      headline: RECOVERY_JOURNEY_HEADLINES.authorization,
      rows: frozenArray([
        {
          label: "Evaluated requests",
          value: String(decidedRequests.length),
        },
        {
          label: "Decisions",
          value:
            decidedRequests.length === 0
              ? "not_evaluated"
              : decidedRequests
                  .map((request) => `${request.action}: ${request.decision?.decision ?? "?"}`)
                  .join(", "),
        },
        { label: "Parked", value: String(parkedRequests.length) },
      ]),
    }),
    frozen<RecoveryJourneyStage>({
      id: "action",
      state: requests.length === 0 ? "not_yet_observed" : "ready",
      headline: RECOVERY_JOURNEY_HEADLINES.action,
      rows: frozenArray([
        {
          label: "Destructive requests",
          value:
            requests.length === 0
              ? "not_requested"
              : requests.map((request) => `${request.action}: ${request.status}`).join(", "),
        },
        {
          label: "Executed",
          value: String(
            executedRequests.filter((request) => request.execution?.outcome === "executed").length,
          ),
        },
      ]),
    }),
    frozen<RecoveryJourneyStage>({
      id: "evidence",
      state: evidenceCount === 0 ? "not_yet_observed" : "ready",
      headline: RECOVERY_JOURNEY_HEADLINES.evidence,
      rows: frozenArray([
        { label: "Evidence refs", value: String(evidenceCount) },
        {
          label: "Last-seen record",
          value: caseRecord.evidence.lastSeenRecordId ?? "—",
        },
        {
          label: "Posture finding refs",
          value: String(caseRecord.evidence.postureFindingRefs.length),
        },
      ]),
    }),
    frozen<RecoveryJourneyStage>({
      id: "closure_escalation",
      state: machine.isTerminal ? "ready" : machine.current === "ESCALATED" || machine.current === "REPLACEMENT_PROPOSED" ? "ready" : "empty",
      headline: RECOVERY_JOURNEY_HEADLINES.closure_escalation,
      rows: frozenArray([
        {
          label: "Closure",
          value:
            caseRecord.closureReason === undefined
              ? "open"
              : `${caseRecord.closureReason} at ${caseRecord.closedAt ?? "?"}`,
        },
        {
          label: "Escalation",
          value:
            machine.current === "ESCALATED"
              ? "escalated — replacement may be proposed"
              : machine.current === "REPLACEMENT_PROPOSED"
                ? "replacement proposed (a proposal — never procurement)"
                : "not_escalated",
        },
        {
          label: "Legal continuations",
          value: machine.legalNext.length === 0 ? "none — terminal" : machine.legalNext.join(", "),
        },
      ]),
    }),
  ];

  return frozen({
    tenantId: guard.ok ? guard.tenantId : SYNTHETIC_SYSTEM_TENANT,
    caseId: caseRecord.caseId,
    deviceId: caseRecord.deviceId,
    stages: frozenArray(stages),
    approvalPending: parkedRequests.length > 0,
  });
}

/**
 * Derive the per-case journey for every LATEST case revision in the
 * acting tenant's partition (the cases feed's journey map). PURE: the
 * same (scope, case source, find-my source, request source, table)
 * produce byte-identical journeys, keyed by case id.
 */
export function buildRecoveryCaseJourneys(
  scope: RecoveryUiTenantScope,
  cases: readonly RecoveryCaseLike[],
  caseTable: StatusMachineTable,
  locationOf: (deviceId: DeviceId) => FindMyLocationLike | undefined,
  requestsOf: (caseId: string) => readonly DestructiveRequestLike[],
  now: string,
): Readonly<Record<string, RecoveryCaseJourney>> {
  const journeys: Record<string, RecoveryCaseJourney> = {};
  for (const caseRecord of cases) {
    journeys[caseRecord.caseId] = buildRecoveryCaseJourney(scope, {
      caseRecord,
      machine: caseStateMachineView(caseRecord.status, caseTable),
      location: locationOf(caseRecord.deviceId),
      requests: requestsOf(caseRecord.caseId),
      now,
    });
  }
  return Object.freeze(journeys);
}
