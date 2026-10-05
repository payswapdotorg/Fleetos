/**
 * @fleetos/web — W140: the real agent check-in endpoint + the durable
 * observation ingestion.
 *
 * SERVER-ONLY (apps/web/src/server).
 *
 * CHECK-IN (`handleAgentCheckIn`, POST /api/agent/check-in): the agent
 * posts the FROZEN check-in command wire shape
 * (`CommandEnvelope<CheckInCommandPayload>` — the same envelope the
 * REAL agent composes through `wrapCheckInCommand`; structural
 * compatibility is PROVEN BY TEST against the frozen validators).
 * The endpoint:
 *
 *   - validates the envelope (`validateCommand` from the frozen
 *     contracts) + the payload (the frozen payload invariants,
 *     mirrored — same machine reasons);
 *   - AUTHENTICATES the agent through the device-scoped trust record
 *     issued at enrollment (the opaque token is a server-side lookup
 *     key; unknown / expired / revoked / tenant-mismatched /
 *     device-mismatched all FAIL CLOSED, machine-stable);
 *   - is IDEMPOTENT: the command's idempotency key addresses a durable
 *     registry row — a replay returns the STORED ack (never
 *     re-executes); a DIFFERENT command under the same key is a
 *     machine-stable `idempotency_conflict`;
 *   - renews the trust session (kind `renewed`; the first check-in
 *     after enrollment is `registered`) and answers with the frozen
 *     ack event shape (`agent.session.established`), carrying the
 *     command's correlation id and the command id as the causation id;
 *   - audits every accepted check-in, duplicate suppression and
 *     refusal through the durable hash-chained audit seam.
 *
 * OBSERVATIONS (`handleAgentObservations`, POST /api/agent/observations):
 * the agent posts an observation batch authenticated by the trust
 * token (Authorization: Bearer). The ingestion follows the FROZEN
 * boundary service's step order — validation, tenant isolation,
 * batch-level idempotency (duplicate ack / conflict), back-pressure
 * (shed), device lookup, event-level dedup, twin mutation through the
 * REAL domain functions (`recordTwinObservations` /
 * `reenterTwinObservationCycle` from @fleetos/device-model), registry
 * writes, audit — with the idempotency registries and the queue depth
 * made DURABLE (the frozen in-memory service remains the dev/test
 * reference; equivalence on the shared paths is proven by test).
 * Observations are ingested as REAL observations — never fabricated.
 *
 * TWIN STATUS (`handleAgentTwinStatus`, GET /api/agent/twin): the
 * journey's terminal confirmation — does the device record exist and
 * how many real observations has it produced.
 *
 * No `any` in public signatures. Strict TS. No clock reads (`now` is
 * injected at the HTTP boundary).
 */

import type { CommandEnvelope, EventEnvelope, Observation, ObservationBatch } from "@fleetos/contracts";
import { validateCommand, validateObservationBatch, validateTenantRef } from "@fleetos/contracts";
import { asCausationId, asTenantId } from "@fleetos/contracts";
import { makeEnvelope } from "@fleetos/contracts";
import type { CorrelationId, TenantId } from "@fleetos/contracts";
import { makeTenantContext } from "@fleetos/identity";
import type { DurableRow, DurableRecordStore } from "@fleetos/identity";
import { recordTwinObservations, reenterTwinObservationCycle } from "@fleetos/device-model";
import type { DeviceTwin } from "@fleetos/device-model";
import { parseJsonBody, jsonResponse, refusalBody, stringField, canonicalJson, frozen, looksLikeIso, parseIsoMs } from "./server-internal";
import { sha256Hex } from "../runtime/product-session";
import { fnv1a32Hex } from "@fleetos/audit";
import type { ServerHandlerDeps, ServerRequestContext } from "./server-context";
import { openServerRequest, flushOrRefuse } from "./server-context";
import type { DurableDriver } from "./durable-driver";
import { createDriverFromEnv } from "./durable-driver";
import { SERVER_AGENT_AUDIT_ACTIONS } from "./server-audit";
import { AGENT_TRUST_TTL_MS } from "./server-enrollment";

// ---------------------------------------------------------------------------
// The frozen wire vocabulary (structural twins — proven equal by test)
// ---------------------------------------------------------------------------

/** The frozen check-in command type. */
export const CHECKIN_COMMAND_TYPE = "agent.command.check-in" as const;

/** The frozen check-in ack event type. */
export const CHECKIN_ACK_EVENT_TYPE = "agent.session.established" as const;

/** The structural check-in payload (the frozen CheckInCommandPayload). */
interface CheckInPayloadShape {
  readonly identity: { readonly deviceId: string; readonly adapterFamily: string; readonly tenantId: string };
  readonly agent: { readonly moduleName?: string; readonly moduleVersion?: string; readonly protocolVersion: number };
  readonly sessionToken?: { readonly value: string; readonly issuedAt: string; readonly expiresAt: string; readonly issuer: string };
}

/** The structural check-in command envelope (the frozen wire shape). */
type CheckInCommandShape = CommandEnvelope<CheckInPayloadShape>;

/** The check-in refresh hint (half the trust TTL). */
export const AGENT_REFRESH_AFTER_MS = AGENT_TRUST_TTL_MS / 2;

/** The ingestion bounds (the frozen service's defaults). */
export const SERVER_MAX_BATCH_SIZE = 500;
export const SERVER_MAX_QUEUE_DEPTH = 1000;
export const SERVER_PRESSURED_RATIO = 0.8;
export const SERVER_RETRY_AFTER_MS = 1000;

// ---------------------------------------------------------------------------
// The trust-token resolution (the async auth phase)
// ---------------------------------------------------------------------------

/** A resolved agent trust record (the row's fields, typed). */
export interface ResolvedTrustRecord {
  readonly tenantId: string;
  readonly agentSessionId: string;
  readonly deviceId: string;
  readonly enrollmentRequestId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly checkInCount: number;
}

/** Rehydrate a trust record from its row. */
function trustFromRow(row: DurableRow): ResolvedTrustRecord | undefined {
  const tenantId = row["tenant_id"];
  const agentSessionId = row["agent_session_id"];
  const deviceId = row["device_id"];
  if (typeof tenantId !== "string" || typeof agentSessionId !== "string" || typeof deviceId !== "string") {
    return undefined;
  }
  return frozen({
    tenantId,
    agentSessionId,
    deviceId,
    enrollmentRequestId: typeof row["enrollment_request_id"] === "string" ? row["enrollment_request_id"] : "",
    issuedAt: typeof row["issued_at"] === "string" ? row["issued_at"] : "",
    expiresAt: typeof row["expires_at"] === "string" ? row["expires_at"] : "",
    revokedAt: typeof row["revoked_at"] === "string" ? row["revoked_at"] : null,
    checkInCount: typeof row["check_in_count"] === "number" ? row["check_in_count"] : 0,
  });
}

/**
 * Resolve an agent trust token across tenants (the documented
 * opaque-token lookup — reveals nothing beyond the one matched row).
 * Unknown token → undefined (fail-closed).
 */
export async function resolveTrustToken(
  driver: DurableDriver,
  token: string,
): Promise<ResolvedTrustRecord | undefined> {
  const row = await driver.loadRowWhere("fleetos_agent_sessions", "token", token);
  return row === null ? undefined : trustFromRow(row);
}

/** The agent-plane refusal response builder. */
function refuseAgent(reason: string, message: string, status: number): Response {
  return jsonResponse(refusalBody(reason, message), status);
}

/**
 * Audit an ATTRIBUTABLE agent-plane refusal (the trust record resolved,
 * so the tenant + device are known) through the audit seam, flush, and
 * build the refusal response. Attributable refusals never vanish
 * silently — the discipline of the lanes' seams.
 */
async function refuseAndAudit(
  driver: import("./durable-driver").DurableDriver,
  deps: ServerHandlerDeps,
  now: string,
  trust: ResolvedTrustRecord,
  reason: string,
  message: string,
  status: number,
  trace: { readonly correlationId?: string; readonly causationId?: string },
): Promise<Response> {
  const opened = await openServerRequest([trust.tenantId], { ...deps, driver, now });
  if (!opened.ok) return refuseAgent(reason, message, status);
  const context = opened.context;
  try {
    context.audit.appendServerRecord({
      tenantId: asTenantId(trust.tenantId),
      action: SERVER_AGENT_AUDIT_ACTIONS.refused,
      subject: trust.deviceId,
      occurredAt: context.deps.now,
      correlationId: (trace.correlationId as CorrelationId | undefined) ?? context.deps.correlationId,
      causationId: trace.causationId !== undefined ? asCausationId(trace.causationId) : undefined,
      actorPrincipalId: `agt:${trust.deviceId}`,
      details: { reason, deviceId: trust.deviceId },
    });
    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;
  } catch {
    // The refusal stands even when its audit write fails (fail-closed on
    // the DECISION; the audit attempt is best-effort here — the refusal
    // itself never widens access).
  }
  return refuseAgent(reason, message, status);
}

// ---------------------------------------------------------------------------
// CHECK-IN
// ---------------------------------------------------------------------------

/** The structural payload validation (the frozen invariants, mirrored). */
function validateCheckInPayloadShape(
  payload: CheckInPayloadShape,
  envelopeTenantId: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (typeof payload !== "object" || payload === null || payload.identity === undefined) {
    return { ok: false, reason: "missing_identity" };
  }
  if (typeof payload.identity.deviceId !== "string" || payload.identity.deviceId.length === 0) {
    return { ok: false, reason: "missing_device_id" };
  }
  if (typeof payload.identity.adapterFamily !== "string" || payload.identity.adapterFamily.length === 0) {
    return { ok: false, reason: "missing_adapter_family" };
  }
  if (payload.identity.tenantId !== envelopeTenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  if (typeof payload.agent !== "object" || payload.agent === null) {
    return { ok: false, reason: "missing_agent_version" };
  }
  if (typeof payload.agent.protocolVersion !== "number" || payload.agent.protocolVersion < 1) {
    return { ok: false, reason: "bad_protocol_version" };
  }
  if (payload.sessionToken !== undefined) {
    const token = payload.sessionToken;
    if (
      typeof token.value !== "string" || token.value.length === 0 ||
      typeof token.issuedAt !== "string" || !looksLikeIso(token.issuedAt) ||
      typeof token.expiresAt !== "string" || !looksLikeIso(token.expiresAt) ||
      typeof token.issuer !== "string" || token.issuer.length === 0
    ) {
      return { ok: false, reason: "bad_session_token" };
    }
  }
  return { ok: true };
}

/** The check-in ack event envelope (the frozen shape, built via makeEnvelope). */
function buildCheckInAck(
  command: CheckInCommandShape,
  trust: { readonly agentSessionId: string; readonly expiresAt: string },
  kind: "registered" | "renewed",
  occurredAt: string,
): EventEnvelope<{ session: { sessionId: string; status: "active"; expiresAt: string; refreshAfterMs: number }; kind: "registered" | "renewed" }> {
  const eventId = `evt_checkin_${fnv1a32Hex(canonicalJson({ commandId: command.id, idempotencyKey: command.idempotencyKey }))}`;
  return makeEnvelope({
    id: eventId as never,
    type: CHECKIN_ACK_EVENT_TYPE,
    occurredAt,
    tenantId: command.tenantId,
    subject: command.payload.identity.deviceId,
    schemaVersion: 1,
    payload: frozen({
      session: frozen({
        sessionId: trust.agentSessionId,
        status: "active" as const,
        expiresAt: trust.expiresAt,
        refreshAfterMs: AGENT_REFRESH_AFTER_MS,
      }),
      kind,
    }),
    cause: {
      kind: "command",
      commandId: asCausationId(command.id as string),
      correlationId: command.correlationId,
    },
  });
}

/**
 * POST /api/agent/check-in — the real agent check-in endpoint
 * (idempotent; correlation + causation ids; audited).
 */
export async function handleAgentCheckIn(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = body.body;
  if (typeof parsed !== "object" || parsed === null) {
    return refuseAgent("invalid_command", "The check-in command envelope is missing.", 400);
  }
  const command = parsed as CheckInCommandShape;

  // The frozen envelope validation + the command type check.
  const envelopeCheck = validateCommand(command);
  if (!envelopeCheck.ok) {
    return refuseAgent("invalid_command", `The check-in command envelope is invalid (${envelopeCheck.reason}).`, 400);
  }
  if (command.type !== CHECKIN_COMMAND_TYPE) {
    return refuseAgent("invalid_command", `The command type must be ${CHECKIN_COMMAND_TYPE}.`, 400);
  }
  const payloadCheck = validateCheckInPayloadShape(command.payload, command.tenantId as string);
  if (!payloadCheck.ok) {
    return refuseAgent("invalid_command", `The check-in command payload is invalid (${payloadCheck.reason}).`, 400);
  }
  const token = command.payload.sessionToken?.value;
  if (token === undefined) {
    return refuseAgent("trust_token_required", "The agent must present its device trust token (bootstrap precedes check-in).", 401);
  }

  // The driver (env seam) — the auth lookup precedes the request store.
  const driver = deps.driver ?? createDriverFromEnv();
  if (driver === undefined) {
    return jsonResponse(refusalBody("server_store_unavailable", "The server control plane's durable store is unavailable."), 503);
  }
  const now = deps.now ?? new Date().toISOString();
  const trust = await resolveTrustToken(driver, token);
  if (trust === undefined) {
    return refuseAgent("unknown_trust_token", "The presented trust token is unknown — enroll the device first.", 401);
  }
  if (trust.tenantId !== (command.tenantId as string)) {
    return refuseAndAudit(driver, deps, now, trust, "tenant_mismatch", "The trust token does not belong to this tenant.", 401, { correlationId: command.correlationId as string, causationId: command.id as string });
  }
  if (trust.deviceId !== command.payload.identity.deviceId) {
    return refuseAndAudit(driver, deps, now, trust, "device_mismatch", "The trust token is scoped to a different device.", 401, { correlationId: command.correlationId as string, causationId: command.id as string });
  }
  if (trust.revokedAt !== null) {
    return refuseAndAudit(driver, deps, now, trust, "trust_token_revoked", "The device's trust record was revoked.", 401, { correlationId: command.correlationId as string, causationId: command.id as string });
  }
  const nowMs = parseIsoMs(now);
  const expiryMs = parseIsoMs(trust.expiresAt);
  if (nowMs === undefined || expiryMs === undefined || nowMs >= expiryMs) {
    return refuseAndAudit(driver, deps, now, trust, "trust_token_expired", "The device's trust session expired — re-enroll or renew.", 401, { correlationId: command.correlationId as string, causationId: command.id as string });
  }

  const opened = await openServerRequest([trust.tenantId], { ...deps, driver, now });
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const store = context.store.store;
    const ctx = makeTenantContext(asTenantId(trust.tenantId), context.deps.correlationId);
    const deviceId = command.payload.identity.deviceId;

    // ---- The durable idempotency registry ------------------------------
    const checkinKey = `chk_${sha256Hex(`${deviceId}\u0000${command.idempotencyKey as string}`)}`;
    const commandDigest = fnv1a32Hex(canonicalJson(command));
    const prior = store.get(ctx, "fleetos_agent_checkins", checkinKey);
    if (prior !== undefined) {
      if (prior.row["command_digest"] !== commandDigest) {
        context.audit.appendServerRecord({
          tenantId: asTenantId(trust.tenantId),
          action: SERVER_AGENT_AUDIT_ACTIONS.refused,
          subject: deviceId,
          occurredAt: context.deps.now,
          correlationId: command.correlationId,
          causationId: asCausationId(command.id as string),
          actorPrincipalId: `agt:${deviceId}`,
          details: { reason: "idempotency_conflict", idempotencyKey: command.idempotencyKey, commandDigest },
        });
        const flushedConflict = await flushOrRefuse(context);
        if (!flushedConflict.ok) return flushedConflict.response;
        return refuseAgent(
          "idempotency_conflict",
          "This idempotency key was already used for a DIFFERENT check-in command.",
          409,
        );
      }
      // Idempotent replay: return the STORED ack — never re-execute.
      const storedAck = prior.row["ack"];
      context.audit.appendServerRecord({
        tenantId: asTenantId(trust.tenantId),
        action: SERVER_AGENT_AUDIT_ACTIONS.duplicate,
        subject: deviceId,
        occurredAt: context.deps.now,
        correlationId: command.correlationId,
        causationId: asCausationId(command.id as string),
        actorPrincipalId: `agt:${deviceId}`,
        details: { idempotencyKey: command.idempotencyKey, commandDigest },
      });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      const ack = typeof storedAck === "string" ? (JSON.parse(storedAck) as unknown) : storedAck;
      return jsonResponse({ ok: true, ack, duplicate: true }, 200);
    }

    // ---- The session renewal (registered on first, renewed after) ------
    const kind: "registered" | "renewed" = trust.checkInCount === 0 ? "registered" : "renewed";
    const newExpiry = new Date(Date.parse(context.deps.now) + AGENT_TRUST_TTL_MS).toISOString();
    store.put(ctx, "fleetos_agent_sessions", trust.agentSessionId, frozen({
      tenant_id: trust.tenantId,
      agent_session_id: trust.agentSessionId,
      device_id: deviceId,
      token: token,
      enrollment_request_id: trust.enrollmentRequestId,
      issued_at: trust.issuedAt,
      expires_at: newExpiry,
      last_seen_at: context.deps.now,
      revoked_at: null,
      check_in_count: trust.checkInCount + 1,
    }));

    // ---- The ack (the frozen event shape; correlation + causation) -----
    const ack = buildCheckInAck(command, { agentSessionId: trust.agentSessionId, expiresAt: newExpiry }, kind, context.deps.now);
    store.insert(ctx, "fleetos_agent_checkins", checkinKey, frozen({
      tenant_id: trust.tenantId,
      checkin_key: checkinKey,
      device_id: deviceId,
      idempotency_key: command.idempotencyKey as string,
      command_digest: commandDigest,
      ack: canonicalJson(ack),
      correlation_id: command.correlationId as string,
      causation_id: command.id as string,
      occurred_at: context.deps.now,
    }));
    context.audit.appendServerRecord({
      tenantId: asTenantId(trust.tenantId),
      action: kind === "registered" ? SERVER_AGENT_AUDIT_ACTIONS.checkedIn : SERVER_AGENT_AUDIT_ACTIONS.renewed,
      subject: deviceId,
      occurredAt: context.deps.now,
      correlationId: command.correlationId,
      causationId: asCausationId(command.id as string),
      actorPrincipalId: `agt:${deviceId}`,
      details: {
        idempotencyKey: command.idempotencyKey,
        kind,
        adapterFamily: command.payload.identity.adapterFamily,
        protocolVersion: command.payload.agent.protocolVersion,
        expiresAt: newExpiry,
      },
    });

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;
    return jsonResponse({ ok: true, ack, duplicate: false }, 200);
  } catch {
    return refuseAgent("server_store_unavailable", "The check-in could not be completed; nothing was recorded.", 503);
  }
}


// ---------------------------------------------------------------------------
// OBSERVATIONS
// ---------------------------------------------------------------------------

/** The bearer token of a request (Authorization: Bearer <token>). */
export function bearerTokenOf(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  if (!header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

/** The structural observation ingestion request body. */
interface ObservationRequestBody {
  readonly batch: ObservationBatch;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: string;
}

/** The back-pressure signal (the frozen shape). */
interface BackPressureSignal {
  readonly status: "open" | "pressured" | "shedding";
  readonly queueDepth: number;
  readonly maxQueueDepth: number;
  readonly retryAfterMs: number | null;
}

/** The current durable queue signal of a tenant. */
function queueSignalOf(store: DurableRecordStore, ctx: ReturnType<typeof makeTenantContext>, tenantId: string): { readonly depth: number; readonly signal: BackPressureSignal } {
  const row = store.get(ctx, "fleetos_observation_queue", tenantId);
  const depth = row !== undefined && typeof row.row["depth"] === "number" ? row.row["depth"] : 0;
  const pressuredAt = Math.max(1, Math.ceil(SERVER_MAX_QUEUE_DEPTH * SERVER_PRESSURED_RATIO));
  const status: BackPressureSignal["status"] =
    depth >= SERVER_MAX_QUEUE_DEPTH ? "shedding" : depth >= pressuredAt ? "pressured" : "open";
  return {
    depth,
    signal: frozen({
      status,
      queueDepth: depth,
      maxQueueDepth: SERVER_MAX_QUEUE_DEPTH,
      retryAfterMs: status === "open" ? null : SERVER_RETRY_AFTER_MS,
    }),
  };
}

/** Rehydrate a DeviceTwin from its stored canonical JSON. */
function twinFromRow(row: DurableRow): DeviceTwin | undefined {
  const raw = row["twin"];
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as DeviceTwin;
  } catch {
    return undefined;
  }
}

/**
 * POST /api/agent/observations — ingest a real observation batch
 * (trust-token authenticated; idempotent; back-pressured; audited;
 * twin-mutated through the REAL domain functions).
 */
export async function handleAgentObservations(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const token = bearerTokenOf(request);
  if (token === undefined) {
    return refuseAgent("trust_token_required", "The agent must present its device trust token (Authorization: Bearer).", 401);
  }
  const driver = deps.driver ?? createDriverFromEnv();
  if (driver === undefined) {
    return jsonResponse(refusalBody("server_store_unavailable", "The server control plane's durable store is unavailable."), 503);
  }
  const now = deps.now ?? new Date().toISOString();
  const trust = await resolveTrustToken(driver, token);
  if (trust === undefined) {
    return refuseAgent("unknown_trust_token", "The presented trust token is unknown — enroll the device first.", 401);
  }
  if (trust.revokedAt !== null) {
    return refuseAgent("trust_token_revoked", "The device's trust record was revoked.", 401);
  }
  const nowMs = parseIsoMs(now);
  const expiryMs = parseIsoMs(trust.expiresAt);
  if (nowMs === undefined || expiryMs === undefined || nowMs >= expiryMs) {
    return refuseAgent("trust_token_expired", "The device's trust session expired — re-enroll or renew.", 401);
  }

  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const source = body.body as Record<string, unknown>;
  const batch = source["batch"];
  const idempotencyKey = stringField(source, "idempotencyKey");
  const correlationId = stringField(source, "correlationId");
  if (batch === undefined || idempotencyKey === undefined || correlationId === undefined) {
    return refuseAgent("invalid_request", "The ingestion request requires a batch, an idempotency key and a correlation id.", 400);
  }
  const causationId = stringField(source, "causationId");
  const batchShape = batch as ObservationBatch;

  // Tenant isolation (the action boundary): the batch's tenant scope
  // MUST match the trust record's tenant.
  const tenantCheck = validateTenantRef(asTenantId(trust.tenantId));
  if (!tenantCheck.ok) {
    return refuseAgent("invalid_request", "The trust record's tenant scope is invalid.", 400);
  }
  if ((batchShape.tenantId as string) !== trust.tenantId) {
    return refuseAndAudit(driver, deps, now, trust, "tenant_mismatch", "The observation batch's tenant scope does not match the trust record.", 403, { correlationId });
  }
  if ((batchShape.deviceId as string) !== trust.deviceId) {
    return refuseAndAudit(driver, deps, now, trust, "device_mismatch", "The observation batch's device does not match the trust record.", 403, { correlationId });
  }

  const opened = await openServerRequest([trust.tenantId], { ...deps, driver, now });
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const store = context.store.store;
    const ctx = makeTenantContext(asTenantId(trust.tenantId), context.deps.correlationId);
    const deviceId = batchShape.deviceId as string;

    // ---- 1. The batch validation (the frozen contracts invariants) ----
    const batchValidation = validateObservationBatch(batchShape);
    if (!batchValidation.ok) {
      auditObservationRefusal(context, trust.tenantId, deviceId, batchValidation.reason);
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseAgent("invalid_request", `The observation batch violates the frozen invariants (${batchValidation.reason}).`, 400);
    }
    if (batchShape.observations.length > SERVER_MAX_BATCH_SIZE) {
      auditObservationRefusal(context, trust.tenantId, deviceId, "batch_too_large");
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseAgent("batch_too_large", `The observation batch exceeds the maximum batch size (${String(SERVER_MAX_BATCH_SIZE)}).`, 400);
    }

    // ---- 2. Batch-level idempotency (durable registry) ----------------
    const batchKey = `bat_${sha256Hex(`${deviceId}\u0000${idempotencyKey}`)}`;
    const batchDigest = fnv1a32Hex(canonicalJson(batchShape));
    const priorBatch = store.get(ctx, "fleetos_observation_batches", batchKey);
    if (priorBatch !== undefined) {
      if (priorBatch.row["batch_digest"] !== batchDigest) {
        auditObservationRefusal(context, trust.tenantId, deviceId, "idempotency_conflict");
        const flushedConflict = await flushOrRefuse(context);
        if (!flushedConflict.ok) return flushedConflict.response;
        return refuseAgent(
          "idempotency_conflict",
          "This idempotency key was already used for a DIFFERENT batch.",
          409,
        );
      }
      context.audit.appendServerRecord({
        tenantId: asTenantId(trust.tenantId),
        action: SERVER_AGENT_AUDIT_ACTIONS.observationsDuplicate,
        subject: deviceId,
        occurredAt: context.deps.now,
        correlationId: correlationId as CorrelationId,
        causationId: causationId !== undefined ? asCausationId(causationId) : undefined,
        actorPrincipalId: `agt:${deviceId}`,
        details: {
          idempotencyKey,
          batchDigest,
          firstAdmittedAt: priorBatch.row["first_admitted_at"],
        },
      });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return jsonResponse({
        ok: true,
        ack: frozen({
          kind: "duplicate",
          firstAdmittedAt: priorBatch.row["first_admitted_at"],
          admittedObservations: priorBatch.row["admitted_observations"],
          duplicateObservations: priorBatch.row["duplicate_observations"],
          backPressure: queueSignalOf(store, ctx, trust.tenantId).signal,
        }),
      }, 200);
    }

    // ---- 3. Back-pressure (shed BEFORE admission work) ----------------
    const queue = queueSignalOf(store, ctx, trust.tenantId);
    const incoming = batchShape.observations.length;
    if (queue.depth + incoming > SERVER_MAX_QUEUE_DEPTH) {
      context.audit.appendServerRecord({
        tenantId: asTenantId(trust.tenantId),
        action: SERVER_AGENT_AUDIT_ACTIONS.observationsShed,
        subject: deviceId,
        occurredAt: context.deps.now,
        correlationId: correlationId as CorrelationId,
        causationId: causationId !== undefined ? asCausationId(causationId) : undefined,
        actorPrincipalId: `agt:${deviceId}`,
        details: { idempotencyKey, batchDigest, queueDepth: queue.depth, maxQueueDepth: SERVER_MAX_QUEUE_DEPTH },
      });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return jsonResponse({
        ok: true,
        ack: frozen({
          kind: "shed",
          backPressure: frozen({
            status: "shedding" as const,
            queueDepth: queue.depth,
            maxQueueDepth: SERVER_MAX_QUEUE_DEPTH,
            retryAfterMs: SERVER_RETRY_AFTER_MS,
          }),
        }),
      }, 200);
    }

    // ---- 4. Device lookup (the enrolled twin) --------------------------
    const twinRow = store.get(ctx, "fleetos_device_twins", deviceId);
    if (twinRow === undefined) {
      auditObservationRefusal(context, trust.tenantId, deviceId, "device_not_enrolled");
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseAgent("device_not_enrolled", `The device is not enrolled in this tenant: ${deviceId}.`, 404);
    }
    let twin = twinFromRow(twinRow.row);
    if (twin === undefined) {
      return refuseAgent("server_store_unavailable", "The device record could not be read.", 503);
    }

    // ---- 5. Event-level dedup (durable registry) + admission -----------
    const admitted: Observation[] = [];
    let duplicateCount = 0;
    for (const observation of batchShape.observations) {
      const eventKey = `obs_${sha256Hex(`${deviceId}\u0000${observation.id as string}`)}`;
      if (store.get(ctx, "fleetos_observation_events", eventKey) !== undefined) {
        duplicateCount++;
        continue;
      }
      store.insert(ctx, "fleetos_observation_events", eventKey, frozen({
        tenant_id: trust.tenantId,
        event_key: eventKey,
        device_id: deviceId,
        observation_id: observation.id as string,
        admitted_at: context.deps.now,
      }));
      admitted.push(observation);
    }

    // ---- 6. The twin mutation (the REAL domain functions) --------------
    let twinRevision = twin.revision;
    if (admitted.length > 0) {
      const recorded = recordTwinObservations(twin, admitted, {
        at: context.deps.now,
        correlationId: correlationId as CorrelationId,
        causationId: causationId !== undefined ? asCausationId(causationId) : undefined,
        actor: { kind: "system" },
        reason: "observation check-in",
        evidence: [],
      });
      if (!recorded.ok) {
        auditObservationRefusal(context, trust.tenantId, deviceId, "twin_recording_refused");
        const flushed = await flushOrRefuse(context);
        if (!flushed.ok) return flushed.response;
        return refuseAgent("invalid_request", "The twin refused to record the observations.", 400);
      }
      twin = recorded.twin;
      twinRevision = twin.revision;
      if (twin.identity.lifecycleState === "LEARN") {
        const reentry = reenterTwinObservationCycle(twin, {
          at: context.deps.now,
          correlationId: correlationId as CorrelationId,
          causationId: causationId !== undefined ? asCausationId(causationId) : undefined,
          actor: { kind: "system" },
          reason: "observation-cycle re-entry after LEARN",
          evidence: [],
        });
        if (reentry.ok) {
          twin = reentry.twin;
          twinRevision = twin.revision;
        }
      }
      store.put(ctx, "fleetos_device_twins", deviceId, frozen({
        ...twinRow.row,
        revision: twin.revision,
        lifecycle_state: twin.identity.lifecycleState,
        twin: canonicalJson(twin),
        updated_at: context.deps.now,
      }));
      // The durable queue depth grows by the admitted count.
      store.put(ctx, "fleetos_observation_queue", trust.tenantId, frozen({
        tenant_id: trust.tenantId,
        depth: queue.depth + admitted.length,
      }));
    }

    // ---- 7. The batch registry (idempotent replay support) -------------
    store.insert(ctx, "fleetos_observation_batches", batchKey, frozen({
      tenant_id: trust.tenantId,
      batch_key: batchKey,
      device_id: deviceId,
      idempotency_key: idempotencyKey,
      batch_digest: batchDigest,
      first_admitted_at: context.deps.now,
      admitted_observations: admitted.length,
      duplicate_observations: duplicateCount,
      twin_revision: twinRevision,
    }));

    // ---- 8. Audit + ack ------------------------------------------------
    context.audit.appendServerRecord({
      tenantId: asTenantId(trust.tenantId),
      action: SERVER_AGENT_AUDIT_ACTIONS.observationsAdmitted,
      subject: deviceId,
      occurredAt: context.deps.now,
      correlationId: correlationId as CorrelationId,
      causationId: causationId !== undefined ? asCausationId(causationId) : undefined,
      actorPrincipalId: `agt:${deviceId}`,
      details: {
        idempotencyKey,
        batchDigest,
        admittedObservations: admitted.length,
        duplicateObservations: duplicateCount,
        twinRevision,
      },
    });

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;
    return jsonResponse({
      ok: true,
      ack: frozen({
        kind: "admitted",
        admittedObservations: admitted.length,
        duplicateObservations: duplicateCount,
        twinRevision,
        backPressure: queueSignalOf(store, ctx, trust.tenantId).signal,
      }),
    }, 200);
  } catch {
    return refuseAgent("server_store_unavailable", "The ingestion could not be completed; nothing was recorded.", 503);
  }
}

/** The audit emission for attributable observation rejections. */
function auditObservationRefusal(
  context: ServerRequestContext,
  tenantId: string,
  deviceId: string,
  reason: string,
): void {
  context.audit.appendServerRecord({
    tenantId: asTenantId(tenantId),
    action: SERVER_AGENT_AUDIT_ACTIONS.observationsRejected,
    subject: deviceId,
    occurredAt: context.deps.now,
    correlationId: context.deps.correlationId,
    actorPrincipalId: `agt:${deviceId}`,
    details: { reason },
  });
}

// ---------------------------------------------------------------------------
// TWIN STATUS (the journey's terminal confirmation)
// ---------------------------------------------------------------------------

/**
 * GET /api/agent/twin?deviceId=... — the twin confirmation: does the
 * device record exist, and how many REAL observations has it produced
 * (the admitted-events registry is the honest count).
 */
export async function handleAgentTwinStatus(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const token = bearerTokenOf(request);
  if (token === undefined) {
    return refuseAgent("trust_token_required", "The agent must present its device trust token (Authorization: Bearer).", 401);
  }
  const driver = deps.driver ?? createDriverFromEnv();
  if (driver === undefined) {
    return jsonResponse(refusalBody("server_store_unavailable", "The server control plane's durable store is unavailable."), 503);
  }
  const now = deps.now ?? new Date().toISOString();
  const trust = await resolveTrustToken(driver, token);
  if (trust === undefined) {
    return refuseAgent("unknown_trust_token", "The presented trust token is unknown — enroll the device first.", 401);
  }
  const url = new URL(request.url);
  const requestedDevice = url.searchParams.get("deviceId") ?? trust.deviceId;
  if (requestedDevice !== trust.deviceId) {
    return refuseAgent("device_mismatch", "The trust token is scoped to a different device.", 403);
  }

  const opened = await openServerRequest([trust.tenantId], { ...deps, driver, now });
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const store = context.store.store;
    const ctx = makeTenantContext(asTenantId(trust.tenantId), context.deps.correlationId);
    const twinRow = store.get(ctx, "fleetos_device_twins", trust.deviceId);
    const exists = twinRow !== undefined;
    const observationCount = store
      .list(ctx, "fleetos_observation_events")
      .filter((row) => row.row["device_id"] === trust.deviceId).length;
    const enrolledAt = typeof twinRow?.row["enrolled_at"] === "string" ? twinRow.row["enrolled_at"] : undefined;
    return jsonResponse({
      ok: true,
      exists,
      observationCount,
      ...(enrolledAt !== undefined ? { enrolledAt } : {}),
    }, 200);
  } catch {
    return refuseAgent("server_store_unavailable", "The twin status could not be read.", 503);
  }
}
