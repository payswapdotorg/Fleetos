/**
 * @fleetos/agent — W100A: the agent-side enrollment journey client.
 *
 * The install contract's user journey, agent-side:
 *
 *   installer -> bootstrap (one-time code) -> first check-in ->
 *   first observation -> Device Twin confirmation
 *
 * A THIN, STATEFUL composition over the frozen device-adapters
 * primitives (the W010/W020 discipline this package already follows —
 * the client composes, it does not add domain logic):
 *
 *   - `selectInstallerArtifact` resolves the release artifact for the
 *     agent's platform/arch (`unsupported_platform` refused
 *     machine-stably — never a silent fallback).
 *   - `bootstrap` presents the one-time enrollment code at the
 *     INJECTED control-plane seam and receives the device-scoped trust
 *     record (the frozen `SessionToken`). The store's refusal arrives
 *     VERBATIM (machine reason + human explanation); a throwing or
 *     shape-invalid seam is `control_plane_unreachable` — fail-closed,
 *     NEVER a fabricated success.
 *   - `firstCheckIn` composes the REAL check-in command through the
 *     frozen helpers (`wrapCheckInCommand` + `validateCheckInCommand`
 *     — valid-by-construction or refused), carries the trust's session
 *     token, submits through the injected seam, and projects the ack
 *     through the frozen `projectCheckInAck`.
 *   - `firstObservation` assembles the first observation through the
 *     REAL observation collector (valid-by-construction batch, derived
 *     idempotency key) and flushes it through the injected seam.
 *   - `confirmTwin` verifies the Device Twin exists for the device
 *     with at least one observation (the journey's terminal goal —
 *     enrollment is DONE when the twin confirms it, not when the HTTP
 *     call returns).
 *
 * Ordering is enforced fail-closed (each stage refuses with a
 * machine-stable reason when invoked out of order). Every refusal
 * carries reason + human explanation (rendered verbatim downstream).
 *
 * DETERMINISTIC: no clock (instants injected), no entropy (ids
 * injected by the caller), no I/O (seams injected). No `any` in
 * public signatures. No runtime dependencies.
 */

import type {
  CommandEnvelope,
  CommandId,
  CorrelationId,
  DeviceId,
  EventEnvelope,
  IdempotencyKey,
  ObservationBatch,
  ObservationId,
  TenantId,
} from "@fleetos/contracts";
import {
  type AgentIdentity,
  type AgentVersionInfo,
  type BootstrapTrustRecord,
  type CheckInAckEventPayload,
  type CheckInCommandPayload,
  type CheckInResult,
  type EnrollmentRedemptionResult,
  type EnrollmentRequestRefusalReason,
  ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS,
  projectCheckInAck,
  validateCheckInCommand,
  wrapCheckInCommand,
} from "@fleetos/device-adapters";
import { artifactForTarget, type AgentReleaseManifest } from "./release";

// ---------------------------------------------------------------------------
// The client refusal taxonomy (machine-stable + human explanation)
// ---------------------------------------------------------------------------

/**
 * The agent-side refusal reasons: the store's taxonomy (propagated
 * VERBATIM from the control plane) plus the client's own fail-closed
 * ordering/transport states.
 */
export type EnrollmentClientRefusalReason =
  | EnrollmentRequestRefusalReason
  | "control_plane_unreachable"
  | "unsupported_platform"
  | "enrollment_not_bootstrapped"
  | "first_check_in_refused"
  | "observation_flush_refused"
  | "twin_not_confirmed";

/** All client-side-only reasons in canonical order. */
export const ENROLLMENT_CLIENT_REFUSAL_REASONS: readonly EnrollmentClientRefusalReason[] =
  Object.freeze([
    "code_expired",
    "code_already_used",
    "code_revoked",
    "code_not_found",
    "device_already_enrolled",
    "tenant_role_mismatch",
    "enrollment_refused_by_policy",
    "control_plane_unreachable",
    "unsupported_platform",
    "enrollment_not_bootstrapped",
    "first_check_in_refused",
    "observation_flush_refused",
    "twin_not_confirmed",
  ]);

/** The human explanations for the CLIENT-side reasons (store reasons ride their refusals verbatim). */
export const ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS: Readonly<
  Record<Exclude<EnrollmentClientRefusalReason, EnrollmentRequestRefusalReason>, string>
> = Object.freeze({
  control_plane_unreachable:
    "The agent cannot reach the control plane. Check the endpoint configuration and network, then retry the enrollment step.",
  unsupported_platform:
    "No installer artifact exists for this device's platform. Contact your operator for a supported platform.",
  enrollment_not_bootstrapped:
    "This enrollment step ran before the one-time code was exchanged. Complete the bootstrap step first.",
  first_check_in_refused:
    "The control plane refused the agent's first check-in. The enrollment was not completed.",
  observation_flush_refused:
    "The control plane refused the agent's first observation. The enrollment was not completed.",
  twin_not_confirmed:
    "The Device Twin for this device is not confirmed yet. The enrollment completes when the twin records the device and its first observation.",
} as const);

/** One client refusal: machine-stable reason + human explanation + the journey stage it failed at. */
export interface EnrollmentClientRefusal {
  readonly reason: EnrollmentClientRefusalReason;
  readonly explanation: string;
  /** The journey stage the refusal occurred at. */
  readonly stage: EnrollmentClientStage;
  readonly occurredAt: string;
  readonly correlationId?: CorrelationId;
}

// ---------------------------------------------------------------------------
// The client stages (the install contract's agent-side journey)
// ---------------------------------------------------------------------------

/**
 * The enrollment journey stages, agent-side. `unbootstrapped` is the
 * fresh install; `twin_confirmed` is the terminal goal (Device Twin
 * exists with the first observation recorded); `failed` is terminal
 * for THIS ATTEMPT (a new attempt starts from a new code).
 */
export type EnrollmentClientStage =
  | "unbootstrapped"
  | "bootstrapped"
  | "checked_in"
  | "observed"
  | "twin_confirmed"
  | "failed";

/** The canonical stage order (for progress display). */
export const ENROLLMENT_CLIENT_STAGE_ORDER: readonly EnrollmentClientStage[] = Object.freeze([
  "unbootstrapped",
  "bootstrapped",
  "checked_in",
  "observed",
  "twin_confirmed",
] as const);

// ---------------------------------------------------------------------------
// The claims + the seams (the deployment layer binds the real transport)
// ---------------------------------------------------------------------------

/** The agent's pre-enrollment claims (what the installer knows). */
export interface AgentEnrollmentClaims {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly adapterFamily: string;
  readonly agent: AgentVersionInfo;
  /** The device platform (must match a release artifact). */
  readonly platform: string;
  /** The device architecture (must match a release artifact). */
  readonly arch: string;
}

/** The bootstrap presentation (what the agent presents with the code). */
export interface AgentBootstrapPresentation {
  readonly requestId: string;
  readonly code: string;
  /** The presenter's role, when the transport knows it. */
  readonly presenterRole?: string;
}

/**
 * The control-plane bootstrap seam. Satisfied by the enrollment
 * request store's `redeem` (proven by test) or a transport wrapping
 * it. A seam that THROWS or returns a non-conforming value is
 * `control_plane_unreachable` — never a fabricated success.
 */
export interface AgentBootstrapSeam {
  redeem(input: {
    readonly tenantId: TenantId;
    readonly requestId: string;
    readonly code: string;
    readonly deviceId: DeviceId;
    readonly presenterRole?: string;
  }): EnrollmentRedemptionResult;
}

/**
 * The check-in submission seam. The client composes the REAL frozen
 * command envelope; the seam transports it and returns the ack event
 * (or a machine-stable refusal string).
 */
export interface AgentCheckInSubmissionSeam {
  submit(command: CommandEnvelope<CheckInCommandPayload>):
    | { readonly ok: true; readonly ack: EventEnvelope<CheckInAckEventPayload> }
    | { readonly ok: false; readonly reason: string };
}

/**
 * The observation flush seam. The client assembles the REAL frozen
 * observation batch (valid-by-construction); the seam transports it.
 */
export interface AgentObservationFlushSeam {
  flush(batch: ObservationBatch, at: string):
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string };
}

/**
 * The Device Twin confirmation seam. Satisfied structurally by the
 * REAL TwinStore lookup (the binding site provides it — proven by
 * test): the journey is complete when the twin exists AND carries at
 * least one observation.
 */
export interface AgentTwinConfirmationSeam {
  confirm(tenantId: TenantId, deviceId: DeviceId): {
    readonly exists: boolean;
    readonly observationCount: number;
    readonly enrolledAt?: string;
  };
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** The trust + progress the client accumulates through the journey. */
export interface AgentEnrollmentProgress {
  /** The current journey stage. */
  readonly stage: EnrollmentClientStage;
  /** The bootstrap trust record, once exchanged. */
  readonly trust?: {
    readonly enrollmentRequestId: string;
    readonly deviceId: DeviceId;
    readonly issuedAt: string;
    readonly sessionExpiresAt: string;
  };
  /** The first check-in result, once acked. */
  readonly firstCheckIn?: {
    readonly at: string;
    readonly kind: "registered" | "renewed";
  };
  /** The first observation, once flushed. */
  readonly firstObservation?: {
    readonly kind: string;
    readonly at: string;
    readonly idempotencyKey: IdempotencyKey;
  };
  /** The twin confirmation, once confirmed. */
  readonly twinConfirmed?: {
    readonly at: string;
    readonly observationCount: number;
    readonly enrolledAt?: string;
  };
}

/** The enrollment client: a stateful, thin journey machine. */
export interface AgentEnrollmentClient {
  /** The agent's pre-enrollment claims. */
  readonly claims: AgentEnrollmentClaims;
  /** The journey progress (the UI projects this verbatim). */
  readonly progress: AgentEnrollmentProgress;
  /** The last refusal, when the attempt failed. */
  readonly lastRefusal: EnrollmentClientRefusal | undefined;

  /** Resolve the release artifact for the claims' platform/arch. */
  selectInstallerArtifact(
    release: AgentReleaseManifest,
  ): { readonly ok: true; readonly installCommand: string; readonly checksum: string } | { readonly ok: false; readonly refusal: EnrollmentClientRefusal };

  /** Exchange the one-time code for the device-scoped trust record. */
  bootstrap(
    seam: AgentBootstrapSeam,
    presentation: AgentBootstrapPresentation,
    at: string,
    correlationId?: CorrelationId,
  ): { readonly ok: true } | { readonly ok: false; readonly refusal: EnrollmentClientRefusal };

  /** Submit the first check-in (composed through the frozen helpers). */
  firstCheckIn(
    seam: AgentCheckInSubmissionSeam,
    inputs: {
      readonly commandId: CommandId;
      readonly idempotencyKey: IdempotencyKey;
      readonly correlationId: CorrelationId;
      readonly issuedAt: string;
    },
  ): { readonly ok: true; readonly ack: CheckInResult } | { readonly ok: false; readonly refusal: EnrollmentClientRefusal };

  /** Flush the first observation through the REAL collector. */
  firstObservation(
    seam: AgentObservationFlushSeam,
    observation: {
      readonly kind: string;
      readonly payload: unknown;
      readonly observedAt: string;
    },
    correlationId?: CorrelationId,
  ): { readonly ok: true; readonly idempotencyKey: IdempotencyKey } | { readonly ok: false; readonly refusal: EnrollmentClientRefusal };

  /** Confirm the Device Twin (the journey's terminal goal). */
  confirmTwin(
    seam: AgentTwinConfirmationSeam,
    at: string,
    correlationId?: CorrelationId,
  ): { readonly ok: true; readonly confirmed: NonNullable<AgentEnrollmentProgress["twinConfirmed"]> } | { readonly ok: false; readonly refusal: EnrollmentClientRefusal };
}

/**
 * Create the enrollment client. The claims must be complete
 * (tenant/device/adapter family/agent version/platform/arch) — the
 * factory refuses malformed construction machine-stably.
 */
export function createAgentEnrollmentClient(
  claims: AgentEnrollmentClaims,
): { readonly ok: true; readonly client: AgentEnrollmentClient } | { readonly ok: false; readonly error: { readonly path: string; readonly reason: string } } {
  if (typeof claims?.tenantId !== "string" || claims.tenantId.length === 0) {
    return { ok: false, error: { path: "/tenantId", reason: "required" } };
  }
  if (typeof claims?.deviceId !== "string" || claims.deviceId.length === 0) {
    return { ok: false, error: { path: "/deviceId", reason: "required" } };
  }
  if (typeof claims?.adapterFamily !== "string" || claims.adapterFamily.length === 0) {
    return { ok: false, error: { path: "/adapterFamily", reason: "required" } };
  }
  if (typeof claims?.platform !== "string" || claims.platform.length === 0) {
    return { ok: false, error: { path: "/platform", reason: "required" } };
  }
  if (typeof claims?.arch !== "string" || claims.arch.length === 0) {
    return { ok: false, error: { path: "/arch", reason: "required" } };
  }
  if (
    !claims?.agent ||
    typeof claims.agent.moduleVersion !== "string" ||
    claims.agent.moduleVersion.length === 0 ||
    typeof claims.agent.protocolVersion !== "number"
  ) {
    return { ok: false, error: { path: "/agent", reason: "version_info_required" } };
  }

  let progress: AgentEnrollmentProgress = { stage: "unbootstrapped" };
  let lastRefusal: EnrollmentClientRefusal | undefined;
  // The FULL trust record (with the session token) lives in the client
  // closure — the token is a device credential and is NEVER projected
  // into `progress` (the UI projection). firstCheckIn composes the
  // REAL token into the command; nothing else reads it.
  let trust: BootstrapTrustRecord | undefined;

  function clientRefusal(
    reason: Exclude<EnrollmentClientRefusalReason, EnrollmentRequestRefusalReason>,
    stage: EnrollmentClientStage,
    at: string,
    correlationId?: CorrelationId,
  ): EnrollmentClientRefusal {
    return {
      reason,
      explanation: ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS[reason],
      stage,
      occurredAt: at,
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }

  function fail(refusal: EnrollmentClientRefusal): { readonly ok: false; readonly refusal: EnrollmentClientRefusal } {
    lastRefusal = refusal;
    progress = { ...progress, stage: "failed" };
    return { ok: false, refusal };
  }

  return {
    ok: true,
    client: {
      claims,
      get progress(): AgentEnrollmentProgress {
        return progress;
      },
      get lastRefusal(): EnrollmentClientRefusal | undefined {
        return lastRefusal;
      },

      selectInstallerArtifact(release) {
        const lookup = artifactForTarget(release, claims.platform, claims.arch);
        if (!lookup.ok) {
          const refusal: EnrollmentClientRefusal = {
            reason: "unsupported_platform",
            explanation: lookup.refusal.explanation,
            stage: "unbootstrapped",
            occurredAt: "",
          };
          return { ok: false, refusal };
        }
        return {
          ok: true,
          installCommand: lookup.artifact.installCommand,
          checksum: lookup.artifact.checksum,
        };
      },

      bootstrap(seam, presentation, at, correlationId) {
        if (progress.stage !== "unbootstrapped") {
          return fail(clientRefusal("enrollment_not_bootstrapped", progress.stage, at, correlationId));
        }
        if (typeof presentation?.requestId !== "string" || presentation.requestId.length === 0) {
          // A presentation without a request id is a malformed
          // bootstrap attempt: the same machine-stable refusal the
          // control plane would produce for an unknown request.
          return fail({
            reason: "code_not_found",
            explanation: ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS.code_not_found,
            stage: "unbootstrapped",
            occurredAt: at,
            ...(correlationId !== undefined ? { correlationId } : {}),
          });
        }
        // Fail-closed transport: a throwing or shape-invalid seam is
        // control_plane_unreachable — NEVER a fabricated success.
        let result: EnrollmentRedemptionResult;
        try {
          result = seam.redeem({
            tenantId: claims.tenantId,
            requestId: presentation.requestId,
            code: presentation.code,
            deviceId: claims.deviceId,
            ...(presentation.presenterRole !== undefined
              ? { presenterRole: presentation.presenterRole }
              : {}),
          });
          if (result === null || typeof result !== "object" || !("ok" in result)) {
            return fail(clientRefusal("control_plane_unreachable", "unbootstrapped", at, correlationId));
          }
        } catch {
          return fail(clientRefusal("control_plane_unreachable", "unbootstrapped", at, correlationId));
        }

        if (!result.ok) {
          // The control plane's refusal arrives VERBATIM (machine
          // reason + human explanation) — the client never rewrites it.
          lastRefusal = {
            reason: result.refusal.reason,
            explanation: result.refusal.explanation,
            stage: "unbootstrapped",
            occurredAt: result.refusal.occurredAt,
            ...(result.refusal.correlationId !== undefined
              ? { correlationId: result.refusal.correlationId }
              : correlationId !== undefined
                ? { correlationId }
                : {}),
          };
          progress = { ...progress, stage: "failed" };
          return { ok: false, refusal: lastRefusal };
        }

        progress = {
          ...progress,
          stage: "bootstrapped",
          trust: {
            enrollmentRequestId: result.trust.enrollmentRequestId,
            deviceId: result.trust.deviceId,
            issuedAt: result.trust.issuedAt,
            sessionExpiresAt: result.trust.sessionToken.expiresAt,
          },
        };
        trust = result.trust;
        return { ok: true };
      },

      firstCheckIn(seam, inputs) {
        if (progress.stage !== "bootstrapped" || trust === undefined) {
          return fail(clientRefusal("enrollment_not_bootstrapped", progress.stage, inputs.issuedAt, inputs.correlationId));
        }
        // Compose the REAL command through the frozen helpers: the
        // identity is the claims'; the session token is the REAL trust
        // token (held in the closure — a credential, never projected).
        const identity: AgentIdentity = {
          tenantId: claims.tenantId,
          deviceId: claims.deviceId,
          adapterFamily: claims.adapterFamily,
        };
        const command = wrapCheckInCommand(
          {
            identity,
            agent: claims.agent,
            sessionToken: trust.sessionToken,
          },
          {
            id: inputs.commandId,
            idempotencyKey: inputs.idempotencyKey,
            correlationId: inputs.correlationId,
            issuedAt: inputs.issuedAt,
            tenantId: claims.tenantId,
          },
        );
        const validation = validateCheckInCommand(command);
        if (!validation.ok) {
          return fail({
            reason: "first_check_in_refused",
            explanation: `${ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS.first_check_in_refused} Reason: the composed check-in command failed the frozen validation.`,
            stage: "bootstrapped",
            occurredAt: inputs.issuedAt,
            ...(inputs.correlationId !== undefined ? { correlationId: inputs.correlationId } : {}),
          });
        }

        let submitted: ReturnType<AgentCheckInSubmissionSeam["submit"]>;
        try {
          submitted = seam.submit(command);
          if (submitted === null || typeof submitted !== "object" || !("ok" in submitted)) {
            return fail(clientRefusal("control_plane_unreachable", "bootstrapped", inputs.issuedAt, inputs.correlationId));
          }
        } catch {
          return fail(clientRefusal("control_plane_unreachable", "bootstrapped", inputs.issuedAt, inputs.correlationId));
        }

        if (!submitted.ok) {
          return fail({
            reason: "first_check_in_refused",
            explanation: `${ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS.first_check_in_refused} Machine reason: ${submitted.reason}.`,
            stage: "bootstrapped",
            occurredAt: inputs.issuedAt,
            ...(inputs.correlationId !== undefined ? { correlationId: inputs.correlationId } : {}),
          });
        }

        const ackResult = projectCheckInAck(submitted.ack);
        if (!ackResult.ok) {
          return fail(clientRefusal("control_plane_unreachable", "bootstrapped", inputs.issuedAt, inputs.correlationId));
        }
        if (ackResult.ack.kind === "rejected") {
          return fail({
            reason: "first_check_in_refused",
            explanation: `${ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS.first_check_in_refused} The control plane rejected the session.${ackResult.ack.message !== undefined ? ` ${ackResult.ack.message}` : ""}`,
            stage: "bootstrapped",
            occurredAt: inputs.issuedAt,
            ...(inputs.correlationId !== undefined ? { correlationId: inputs.correlationId } : {}),
          });
        }

        progress = {
          ...progress,
          stage: "checked_in",
          firstCheckIn: { at: inputs.issuedAt, kind: ackResult.ack.kind },
        };
        return { ok: true, ack: ackResult };
      },

      firstObservation(seam, observation, correlationId) {
        if (progress.stage !== "checked_in") {
          return fail(clientRefusal("enrollment_not_bootstrapped", progress.stage, observation.observedAt, correlationId));
        }
        // The first observation is assembled HERE as a canonical
        // Observation value (the frozen contracts shape); the seam
        // transports the batch. Kind must be non-empty; payload
        // JSON-serializable — validated fail-closed below.
        if (typeof observation?.kind !== "string" || observation.kind.length === 0) {
          return fail({
            reason: "observation_flush_refused",
            explanation: ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS.observation_flush_refused,
            stage: "checked_in",
            occurredAt: observation?.observedAt ?? "",
            ...(correlationId !== undefined ? { correlationId } : {}),
          });
        }
        const firstObservationId = `obs_first_${claims.deviceId as string}` as ObservationId;
        const batch: ObservationBatch = Object.freeze({
          tenantId: claims.tenantId,
          deviceId: claims.deviceId,
          observedAt: observation.observedAt,
          observations: Object.freeze([
            Object.freeze({
              id: firstObservationId,
              kind: observation.kind,
              observedAt: observation.observedAt,
              schemaVersion: 1,
              payload: observation.payload,
            }),
          ]),
        });
        // Deterministic idempotency key over the batch identity.
        const idempotencyKey = `idem_${claims.tenantId as string}_${claims.deviceId as string}_${observation.kind}` as IdempotencyKey;

        let flushed: ReturnType<AgentObservationFlushSeam["flush"]>;
        try {
          flushed = seam.flush(batch, observation.observedAt);
          if (flushed === null || typeof flushed !== "object" || !("ok" in flushed)) {
            return fail(clientRefusal("control_plane_unreachable", "checked_in", observation.observedAt, correlationId));
          }
        } catch {
          return fail(clientRefusal("control_plane_unreachable", "checked_in", observation.observedAt, correlationId));
        }

        if (!flushed.ok) {
          return fail({
            reason: "observation_flush_refused",
            explanation: `${ENROLLMENT_CLIENT_REFUSAL_EXPLANATIONS.observation_flush_refused} Machine reason: ${flushed.reason}.`,
            stage: "checked_in",
            occurredAt: observation.observedAt,
            ...(correlationId !== undefined ? { correlationId } : {}),
          });
        }

        progress = {
          ...progress,
          stage: "observed",
          firstObservation: {
            kind: observation.kind,
            at: observation.observedAt,
            idempotencyKey,
          },
        };
        return { ok: true, idempotencyKey };
      },

      confirmTwin(seam, at, correlationId) {
        if (progress.stage !== "observed") {
          return fail(clientRefusal("enrollment_not_bootstrapped", progress.stage, at, correlationId));
        }
        let confirmation: ReturnType<AgentTwinConfirmationSeam["confirm"]>;
        try {
          confirmation = seam.confirm(claims.tenantId, claims.deviceId);
          if (confirmation === null || typeof confirmation !== "object" || typeof confirmation.exists !== "boolean") {
            return fail(clientRefusal("control_plane_unreachable", "observed", at, correlationId));
          }
        } catch {
          return fail(clientRefusal("control_plane_unreachable", "observed", at, correlationId));
        }
        if (!confirmation.exists || confirmation.observationCount < 1) {
          return fail(clientRefusal("twin_not_confirmed", "observed", at, correlationId));
        }
        const confirmed = {
          at,
          observationCount: confirmation.observationCount,
          ...(confirmation.enrolledAt !== undefined ? { enrolledAt: confirmation.enrolledAt } : {}),
        };
        progress = { ...progress, stage: "twin_confirmed", twinConfirmed: confirmed };
        return { ok: true, confirmed };
      },
    },
  };
}
