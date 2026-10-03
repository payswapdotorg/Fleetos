/**
 * @fleetos/agent — W140: the REAL control-plane HTTP transports.
 *
 * The deployment-layer bindings for the enrollment journey's seams: a
 * real agent binary (or the composition root's transport) drives the
 * server control plane's W140 routes through these async functions:
 *
 *   - `httpBootstrap`          -> POST /api/enrollment/redeem
 *   - `httpCheckIn`            -> POST /api/agent/check-in
 *   - `httpFlushObservations`  -> POST /api/agent/observations
 *   - `httpConfirmTwin`        -> GET  /api/agent/twin
 *
 * DISCIPLINE (the package's law): the frozen sync seams
 * (`AgentBootstrapSeam` et al.) stay the deterministic dev/test
 * binding — this module is the REAL transport companion (network I/O
 * is inherently async). Every refusal is machine-stable (the server's
 * reason strings pass through VERBATIM); a network failure, a
 * non-JSON body or a shape-invalid success is
 * `control_plane_unreachable` — NEVER a fabricated success. The ack of
 * a successful check-in is validated through the FROZEN
 * `validateCheckInAck` before it is returned.
 *
 * No clock reads (the caller injects `at`). No `any`. The fetch
 * implementation is injectable (deterministic tests bind a stub).
 */

import type {
  CommandEnvelope,
  EventEnvelope,
  ObservationBatch,
} from "@fleetos/contracts";
import type {
  BootstrapTrustRecord,
  CheckInAckEventPayload,
  CheckInCommandPayload,
  SessionToken,
} from "@fleetos/device-adapters";
import { validateCheckInAck } from "@fleetos/device-adapters";
import type { CorrelationId, CausationId, DeviceId, TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The transport options + refusal shapes
// ---------------------------------------------------------------------------

/** The transport options: the control plane's base URL + the injectable fetch. */
export interface HttpControlPlaneOptions {
  /** The control plane's base URL (no trailing slash), e.g. "https://app.example.com". */
  readonly baseUrl: string;
  /** The fetch implementation (default: the global fetch). */
  readonly fetchImpl?: typeof fetch;
}

/** One machine-stable transport refusal. */
export interface HttpTransportRefusal {
  /** The machine-stable reason (the server's reason, or the transport's own). */
  readonly reason: string;
  /** The human explanation / message. */
  readonly message: string;
  /** The HTTP status when a response was received (0 on transport failure). */
  readonly httpStatus: number;
}

/** The transport result: a typed success or a machine-stable refusal. */
export type HttpTransportResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: HttpTransportRefusal };

/** The transport's own fail-closed refusal (never a fabricated success). */
function unreachable(detail: string): HttpTransportRefusal {
  return {
    reason: "control_plane_unreachable",
    message: `The agent cannot reach the control plane: ${detail}`,
    httpStatus: 0,
  };
}

/** Parse a transport response (JSON) or fail closed. */
async function parseResponse(
  response: Response,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly refusal: HttpTransportRefusal }> {
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    return { ok: false, refusal: unreachable("the response is not valid JSON") };
  }
  return { ok: true, body };
}

/** Extract a refusal body's machine reason + message. */
function refusalOf(body: unknown, httpStatus: number): HttpTransportRefusal {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    const reason = typeof record["reason"] === "string" ? record["reason"] : "control_plane_unreachable";
    const message =
      typeof record["message"] === "string"
        ? record["message"]
        : typeof record["explanation"] === "string"
          ? record["explanation"]
          : "The control plane refused the request.";
    return { reason, message, httpStatus };
  }
  return { reason: "control_plane_unreachable", message: "The control plane returned an unreadable refusal.", httpStatus };
}

/** Run one JSON request against the control plane. */
async function requestJson(
  options: HttpControlPlaneOptions,
  path: string,
  init: { readonly method: string; readonly body?: unknown; readonly headers?: Readonly<Record<string, string>> },
): Promise<{ readonly ok: true; readonly status: number; readonly body: unknown } | { readonly ok: false; readonly refusal: HttpTransportRefusal }> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (typeof fetchImpl !== "function") {
    return { ok: false, refusal: unreachable("no fetch implementation is available") };
  }
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${path}`, {
      method: init.method,
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    return { ok: false, refusal: unreachable(error instanceof Error ? error.message : "the request threw") };
  }
  const parsed = await parseResponse(response);
  if (!parsed.ok) return { ok: false, refusal: parsed.refusal };
  return { ok: true, status: response.status, body: parsed.body };
}

// ---------------------------------------------------------------------------
// BOOTSTRAP (enrollment redemption)
// ---------------------------------------------------------------------------

/** The bootstrap presentation over HTTP (the installer/agent's claims). */
export interface HttpBootstrapInput {
  readonly tenantId: TenantId;
  readonly requestId: string;
  readonly code: string;
  readonly deviceId: DeviceId;
  readonly adapterFamily: string;
  readonly hardware: {
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber?: string;
    readonly assetTag?: string;
  };
  readonly presenterRole?: string;
}

/**
 * Exchange the one-time enrollment code for the device-scoped trust
 * record (POST /api/enrollment/redeem). The server's refusal reasons
 * arrive VERBATIM (the frozen taxonomy + the server-plane vocabulary).
 */
export async function httpBootstrap(
  options: HttpControlPlaneOptions,
  input: HttpBootstrapInput,
): Promise<HttpTransportResult<BootstrapTrustRecord>> {
  const result = await requestJson(options, "/api/enrollment/redeem", {
    method: "POST",
    body: {
      tenantId: input.tenantId,
      requestId: input.requestId,
      code: input.code,
      deviceId: input.deviceId,
      adapterFamily: input.adapterFamily,
      hardware: input.hardware,
      ...(input.presenterRole !== undefined ? { presenterRole: input.presenterRole } : {}),
    },
  });
  if (!result.ok) return { ok: false, refusal: result.refusal };
  const body = result.body as Record<string, unknown>;
  if (result.status >= 400) {
    return { ok: false, refusal: refusalOf(result.body, result.status) };
  }
  if (body["ok"] !== true || typeof body["sessionToken"] !== "object" || body["sessionToken"] === null) {
    return { ok: false, refusal: unreachable("the redemption response is shape-invalid") };
  }
  const token = body["sessionToken"] as Record<string, unknown>;
  if (
    typeof token["value"] !== "string" ||
    typeof token["issuedAt"] !== "string" ||
    typeof token["expiresAt"] !== "string" ||
    typeof token["issuer"] !== "string"
  ) {
    return { ok: false, refusal: unreachable("the trust record is shape-invalid") };
  }
  return {
    ok: true,
    value: {
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      enrollmentRequestId: input.requestId,
      issuedAt: typeof body["issuedAt"] === "string" ? body["issuedAt"] : token["issuedAt"],
      sessionToken: {
        value: token["value"],
        issuedAt: token["issuedAt"],
        expiresAt: token["expiresAt"],
        issuer: token["issuer"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// CHECK-IN
// ---------------------------------------------------------------------------

/**
 * Submit a check-in command (POST /api/agent/check-in). The command is
 * the FROZEN wire shape (composed through `wrapCheckInCommand`); the
 * ack is validated through the FROZEN `validateCheckInAck` before it
 * is returned — a shape-invalid success is `control_plane_unreachable`,
 * never a fabricated session.
 */
export async function httpCheckIn(
  options: HttpControlPlaneOptions,
  command: CommandEnvelope<CheckInCommandPayload>,
): Promise<HttpTransportResult<{ readonly ack: EventEnvelope<CheckInAckEventPayload>; readonly duplicate: boolean }>> {
  const result = await requestJson(options, "/api/agent/check-in", {
    method: "POST",
    body: command,
  });
  if (!result.ok) return { ok: false, refusal: result.refusal };
  const body = result.body as Record<string, unknown>;
  if (result.status >= 400) {
    return { ok: false, refusal: refusalOf(result.body, result.status) };
  }
  if (body["ok"] !== true || typeof body["ack"] !== "object" || body["ack"] === null) {
    return { ok: false, refusal: unreachable("the check-in response is shape-invalid") };
  }
  const ackEnvelope = body["ack"] as EventEnvelope<CheckInAckEventPayload>;
  const validation = validateCheckInAck(ackEnvelope);
  if (!validation.ok) {
    return { ok: false, refusal: unreachable(`the ack envelope failed the frozen validation (${validation.error.message})`) };
  }
  return {
    ok: true,
    value: { ack: ackEnvelope, duplicate: body["duplicate"] === true },
  };
}

// ---------------------------------------------------------------------------
// OBSERVATIONS
// ---------------------------------------------------------------------------

/** The observation-flush ack (the frozen boundary's ack shapes). */
export type HttpObservationAck =
  | {
    readonly kind: "admitted";
    readonly admittedObservations: number;
    readonly duplicateObservations: number;
    readonly twinRevision: number;
  }
  | {
    readonly kind: "duplicate";
    readonly firstAdmittedAt: string;
    readonly admittedObservations: number;
    readonly duplicateObservations: number;
  }
  | { readonly kind: "shed"; readonly retryAfterMs: number };

/** The flush request metadata (traceability + idempotency). */
export interface HttpObservationMeta {
  readonly trustToken: string;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
}

/**
 * Flush an observation batch (POST /api/agent/observations — Bearer
 * trust token). Idempotent: a replay under the same key returns the
 * stored outcome as a `duplicate` ack; back-pressure returns `shed`.
 */
export async function httpFlushObservations(
  options: HttpControlPlaneOptions,
  batch: ObservationBatch,
  meta: HttpObservationMeta,
): Promise<HttpTransportResult<HttpObservationAck>> {
  const result = await requestJson(options, "/api/agent/observations", {
    method: "POST",
    headers: { authorization: `Bearer ${meta.trustToken}` },
    body: {
      batch,
      idempotencyKey: meta.idempotencyKey,
      correlationId: meta.correlationId,
      ...(meta.causationId !== undefined ? { causationId: meta.causationId } : {}),
    },
  });
  if (!result.ok) return { ok: false, refusal: result.refusal };
  const body = result.body as Record<string, unknown>;
  if (result.status >= 400) {
    return { ok: false, refusal: refusalOf(result.body, result.status) };
  }
  if (body["ok"] !== true || typeof body["ack"] !== "object" || body["ack"] === null) {
    return { ok: false, refusal: unreachable("the ingestion response is shape-invalid") };
  }
  const ack = body["ack"] as Record<string, unknown>;
  if (ack["kind"] === "admitted") {
    return {
      ok: true,
      value: {
        kind: "admitted" as const,
        admittedObservations: typeof ack["admittedObservations"] === "number" ? ack["admittedObservations"] : 0,
        duplicateObservations: typeof ack["duplicateObservations"] === "number" ? ack["duplicateObservations"] : 0,
        twinRevision: typeof ack["twinRevision"] === "number" ? ack["twinRevision"] : 0,
      },
    };
  }
  if (ack["kind"] === "duplicate") {
    return {
      ok: true,
      value: {
        kind: "duplicate" as const,
        firstAdmittedAt: typeof ack["firstAdmittedAt"] === "string" ? ack["firstAdmittedAt"] : "",
        admittedObservations: typeof ack["admittedObservations"] === "number" ? ack["admittedObservations"] : 0,
        duplicateObservations: typeof ack["duplicateObservations"] === "number" ? ack["duplicateObservations"] : 0,
      },
    };
  }
  if (ack["kind"] === "shed") {
    const signal = (ack["backPressure"] ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      value: {
        kind: "shed" as const,
        retryAfterMs: typeof signal["retryAfterMs"] === "number" ? signal["retryAfterMs"] : 1000,
      },
    };
  }
  return { ok: false, refusal: unreachable("the ingestion ack is shape-invalid") };
}

// ---------------------------------------------------------------------------
// TWIN CONFIRMATION
// ---------------------------------------------------------------------------

/** The twin confirmation shape (the journey's terminal goal). */
export interface HttpTwinConfirmation {
  readonly exists: boolean;
  readonly observationCount: number;
  readonly enrolledAt?: string;
}

/**
 * Confirm the Device Twin (GET /api/agent/twin — Bearer trust token):
 * the journey is complete when the twin exists AND carries at least
 * one real observation.
 */
export async function httpConfirmTwin(
  options: HttpControlPlaneOptions,
  trustToken: string,
  deviceId?: DeviceId,
): Promise<HttpTransportResult<HttpTwinConfirmation>> {
  const query = deviceId !== undefined ? `?deviceId=${encodeURIComponent(deviceId as string)}` : "";
  const result = await requestJson(options, `/api/agent/twin${query}`, {
    method: "GET",
    headers: { authorization: `Bearer ${trustToken}` },
  });
  if (!result.ok) return { ok: false, refusal: result.refusal };
  const body = result.body as Record<string, unknown>;
  if (result.status >= 400) {
    return { ok: false, refusal: refusalOf(result.body, result.status) };
  }
  if (body["ok"] !== true || typeof body["exists"] !== "boolean" || typeof body["observationCount"] !== "number") {
    return { ok: false, refusal: unreachable("the twin confirmation is shape-invalid") };
  }
  return {
    ok: true,
    value: {
      exists: body["exists"],
      observationCount: body["observationCount"],
      ...(typeof body["enrolledAt"] === "string" ? { enrolledAt: body["enrolledAt"] } : {}),
    },
  };
}

/** The trust token helper: the session-token value the transports present. */
export function trustTokenValueOf(token: SessionToken): string {
  return token.value;
}
