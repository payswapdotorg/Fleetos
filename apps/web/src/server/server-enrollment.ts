/**
 * @fleetos/web — W140: the server-side enrollment plane (scoped-code
 * issuance + tenant-scoped redemption).
 *
 * SERVER-ONLY (apps/web/src/server).
 *
 * ISSUANCE (`handleIssueEnrollmentCode`, POST /api/enrollment/codes):
 * an authenticated operator session (httpOnly cookie) with an
 * operator-and-above role (the W130 law: viewer roles — employee /
 * vendor.operator — receive the frozen interaction_forbidden denial
 * with the escalation path) issues a HIGH-ENTROPY enrollment code in
 * the W130 shape (base32, ~100-bit body; crypto-random through the
 * injected entropy seam). The code is created through the REAL frozen
 * `createEnrollmentRequest` boundary (via @fleetos/web-device's public
 * binding) and persisted VERIFIER-ONLY (the raw code never reaches a
 * row, a log, or an audit entry); it is returned EXACTLY ONCE for
 * display (the install contract's display-once fact).
 *
 * REDEMPTION (`handleRedeemEnrollmentCode`, POST /api/enrollment/redeem):
 * the installer/agent presents (tenant, request, code, device claims);
 * redemption is TENANT-SCOPED — the W130 law: a code issued in tenant A
 * presented against tenant B is a machine-stable `code_not_found`
 * (indistinguishable from unknown — no existence side channel), and the
 * dedicated demo tenant is NEVER a scope (`invalid_scope`). One-time,
 * short-lived, revocable: `code_already_used` / `code_expired` /
 * `code_revoked` / `device_already_enrolled` / `tenant_role_mismatch` /
 * `enrollment_refused_by_policy` — the frozen refusal taxonomy with its
 * frozen human explanations. On success the server creates the REAL
 * device record (`enrollDevice` + `createTwin` from
 * @fleetos/device-model) and the agent membership (the `agt:` principal
 * through the identity repository), and issues the device-scoped trust
 * record (the check-in session layer's credential) — the Install
 * Center's "unbootstrapped — waiting" state becomes REAL: an enrolled
 * device with a live trust token exists server-side.
 *
 * Every fulfilled redemption, refusal and observed expiry emits through
 * the audit seam (the durable hash-chained log).
 *
 * No `any` in public signatures. Strict TS. No clock reads.
 */

import type { TenantId } from "@fleetos/contracts";
import { asDeviceId, asTenantId } from "@fleetos/contracts";
import {
  createDurablePrincipalRepository,
  makeAgentPrincipal,
  makeTenantContext,
} from "@fleetos/identity";
import type { DurableRow } from "@fleetos/identity";
import { enrollDevice, createTwin } from "@fleetos/device-model";
import type { DeviceIdentity } from "@fleetos/device-model";
import { createInstallEnrollmentCode } from "@fleetos/web-device";
import { experienceRoleFromAssignment, enrollmentCodeCreationDenial } from "@fleetos/web-product";
import { operatorRoleFor } from "@fleetos/web-product";
import { canInteract } from "@fleetos/web-shell";
import { fnv1a32Hex } from "@fleetos/audit";
import { parseJsonBody, jsonResponse, refusalBody, stringField, canonicalJson, frozen } from "./server-internal";
import { sha256Hex } from "../runtime/product-session";
import type { ServerHandlerDeps, ServerRequestContext } from "./server-context";
import { openServerRequest, flushOrRefuse } from "./server-context";
import { resolveOperatorSessionInContext, parseSessionCookie } from "./server-sessions";
import { SERVER_ENROLLMENT_AUDIT_ACTIONS } from "./server-audit";

// ---------------------------------------------------------------------------
// The frozen vocabulary (structural twins — proven equal by test)
// ---------------------------------------------------------------------------

/**
 * The install contract's four ownership distinctions (the frozen
 * device-adapters union, mirrored as literals; equality with
 * ALL_DEVICE_OWNERSHIP_KINDS is proven by the wire-compat test).
 */
export type ServerOwnershipKind =
  | "corporate_owned"
  | "leased"
  | "byod"
  | "third_party_managed";

/** All ownership kinds (canonical order). */
export const SERVER_OWNERSHIP_KINDS: readonly ServerOwnershipKind[] = frozen([
  "corporate_owned",
  "leased",
  "byod",
  "third_party_managed",
]);

/**
 * The frozen human explanations of the refusal taxonomy (the install
 * contract's texts, mirrored verbatim; equality with
 * ENROLLMENT_REQUEST_REFUSAL_EXPLANATIONS is proven by the wire-compat
 * test).
 */
export const SERVER_ENROLLMENT_REFUSAL_EXPLANATIONS: Readonly<Record<string, string>> = frozen({
  code_expired:
    "This enrollment code has expired. Create a new enrollment request from the install center and try again.",
  code_already_used:
    "This enrollment code was already used. Enrollment codes are one-time; create a new request for the next device.",
  code_revoked:
    "This enrollment code was revoked by an operator. Create a new enrollment request if this device should enroll.",
  code_not_found:
    "This enrollment code is not valid for your workspace. Check the code and workspace, then try again.",
  device_already_enrolled:
    "This device is already enrolled in your fleet. Renew its session from the device instead of enrolling it again.",
  tenant_role_mismatch:
    "Your current role is not permitted to use this enrollment code. Ask a workspace operator to enroll this device.",
  enrollment_refused_by_policy:
    "Enrollment was refused by policy for this device in this workspace. Review the enrollment policy with your operator.",
  invalid_scope:
    "Enrollment codes cannot be redeemed in this workspace scope. Use the workspace the code was issued for.",
  invalid_input:
    "The enrollment request is malformed. Check the workspace, code, device identity and hardware claims, then try again.",
});

/**
 * The frozen bootstrap-code verifier formula: a digest over the
 * tenant-scoped code (the device-adapters `bootstrapCodeVerifier`
 * algorithm; equality is proven by the wire-compat test). The store
 * persists ONLY this value — the code itself is never stored.
 */
export function enrollmentCodeVerifier(tenantId: string, code: string): string {
  return fnv1a32Hex(canonicalJson({ code, tenantId }));
}

// ---------------------------------------------------------------------------
// Server-plane constants
// ---------------------------------------------------------------------------

/**
 * The dedicated demo tenant is NEVER an enrollment scope (the W122
 * isolation law carried into the server plane; the literal equals
 * demo-fleet's TENANT_ID — proven by test).
 */
export const DEMO_TENANT_ID = "tnt_w091demo000001" as const;

/** The enrollment-code lifetime (24h, the install contract's short-lived rule). */
export const ENROLLMENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** The allowed ttl bounds (1 minute .. 7 days). */
export const ENROLLMENT_CODE_TTL_MIN_MS = 60 * 1000;
export const ENROLLMENT_CODE_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** The agent trust-session lifetime (24h; renewed at each check-in). */
export const AGENT_TRUST_TTL_MS = 24 * 60 * 60 * 1000;

/** The trust issuer identity recorded on the session token. */
export const AGENT_TRUST_ISSUER = "web.server-control-plane" as const;

// ---------------------------------------------------------------------------
// The refusal shape
// ---------------------------------------------------------------------------

/** The machine-stable refusal vocabulary of the enrollment routes. */
export type ServerEnrollmentRefusal =
  | "invalid_json"
  | "invalid_input"
  | "invalid_scope"
  | "unauthenticated"
  | "interaction_forbidden"
  | "code_not_found"
  | "code_expired"
  | "code_already_used"
  | "code_revoked"
  | "device_already_enrolled"
  | "tenant_role_mismatch"
  | "enrollment_refused_by_policy"
  | "server_store_unavailable"
  | "server_store_write_failed"
  | "server_entropy_unavailable";

/** The refusal body: machine reason + frozen human explanation. */
interface EnrollmentRefusalBody {
  readonly ok: false;
  readonly reason: ServerEnrollmentRefusal;
  readonly explanation: string;
}

/** The full enrollment-request record view (structurally the REAL record). */
interface ServerEnrollmentRecordView {
  readonly requestId: string;
  readonly tenantId: string;
  readonly deviceId?: string;
  readonly ownershipKind: string;
  readonly ownershipClass: string;
  readonly allowedRoles: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: string;
  readonly codeVerifier: string;
  readonly correlationId?: string;
}

/** The ownership-kind -> device-model OwnershipType mapping (the identity docs' rule: BYOD enters CUSTOMER_OWNED). */
function ownershipTypeOfKind(kind: ServerOwnershipKind): "CUSTOMER_OWNED" | "LEASED" | "THIRD_PARTY_SUPPLIED" {
  switch (kind) {
    case "corporate_owned":
    case "byod":
      return "CUSTOMER_OWNED";
    case "leased":
      return "LEASED";
    case "third_party_managed":
      return "THIRD_PARTY_SUPPLIED";
  }
}

/** The enrollment-request row (the server store's flat translation). */
function enrollmentRowOf(record: ServerEnrollmentRecordView): DurableRow {
  return frozen({
    tenant_id: record.tenantId,
    request_id: record.requestId,
    device_id: record.deviceId ?? null,
    ownership_kind: record.ownershipKind,
    ownership_class: record.ownershipClass,
    allowed_roles: canonicalJson([...record.allowedRoles]),
    created_at: record.createdAt,
    expires_at: record.expiresAt,
    status: record.status,
    code_verifier: record.codeVerifier,
    fulfilled_at: null,
    fulfilled_device_id: null,
    revoked_at: null,
    revoked_reason: null,
    correlation_id: record.correlationId ?? null,
  });
}

/** Rehydrate the record view from a stored row. */
function recordFromRow(row: DurableRow): ServerEnrollmentRecordView | undefined {
  const requestId = row["request_id"];
  if (typeof requestId !== "string") return undefined;
  let allowedRoles: readonly string[] = [];
  if (typeof row["allowed_roles"] === "string") {
    try {
      const parsed = JSON.parse(row["allowed_roles"]) as unknown;
      if (Array.isArray(parsed)) {
        allowedRoles = parsed.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      allowedRoles = [];
    }
  }
  return frozen({
    requestId,
    tenantId: typeof row["tenant_id"] === "string" ? row["tenant_id"] : "",
    deviceId: typeof row["device_id"] === "string" ? row["device_id"] : undefined,
    ownershipKind: typeof row["ownership_kind"] === "string" ? row["ownership_kind"] : "",
    ownershipClass: typeof row["ownership_class"] === "string" ? row["ownership_class"] : "",
    allowedRoles,
    createdAt: typeof row["created_at"] === "string" ? row["created_at"] : "",
    expiresAt: typeof row["expires_at"] === "string" ? row["expires_at"] : "",
    status: typeof row["status"] === "string" ? row["status"] : "",
    codeVerifier: typeof row["code_verifier"] === "string" ? row["code_verifier"] : "",
    correlationId: typeof row["correlation_id"] === "string" ? row["correlation_id"] : undefined,
  });
}

/** Build the enrollment refusal response (machine reason + frozen explanation). */
function refuseEnrollment(reason: ServerEnrollmentRefusal, status: number, correlationNote?: string): Response {
  const explanation =
    SERVER_ENROLLMENT_REFUSAL_EXPLANATIONS[reason] ??
    "The enrollment request was refused. Nothing was recorded.";
  const body: EnrollmentRefusalBody = frozen({
    ok: false as const,
    reason,
    explanation: correlationNote === undefined ? explanation : `${explanation} (${correlationNote})`,
  });
  return jsonResponse(body, status);
}

/** The audit emission for refusals (every attributable refusal emits). */
function auditRefusal(
  context: ServerRequestContext,
  tenantId: string,
  reason: ServerEnrollmentRefusal,
  subject: string | null,
  details: Readonly<Record<string, unknown>>,
): void {
  context.audit.appendServerRecord({
    tenantId: asTenantId(tenantId),
    action: SERVER_ENROLLMENT_AUDIT_ACTIONS.refused,
    subject,
    occurredAt: context.deps.now,
    correlationId: context.deps.correlationId,
    actorPrincipalId: "svc:web.server-control-plane",
    details: { reason, ...details },
  });
}

// ---------------------------------------------------------------------------
// ISSUANCE
// ---------------------------------------------------------------------------

/** The issuance success body (the code is displayed EXACTLY ONCE). */
export interface EnrollmentIssuanceBody {
  readonly ok: true;
  readonly requestId: string;
  /** The one-time enrollment code (display-once; never persisted, never echoed again). */
  readonly code: string;
  readonly ownershipKind: ServerOwnershipKind;
  readonly ownershipClass: string;
  readonly allowedRoles: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * POST /api/enrollment/codes — issue a server-side scoped enrollment
 * code (operator session + operator-and-above role required; the code
 * is crypto-random in the W130 shape and persists verifier-only).
 */
export async function handleIssueEnrollmentCode(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const source = body.body as Record<string, unknown>;
  const ownershipKindRaw = stringField(source, "ownershipKind");
  const ownershipKind = SERVER_OWNERSHIP_KINDS.find((kind) => kind === ownershipKindRaw);
  if (ownershipKind === undefined) {
    return refuseEnrollment("invalid_input", 400, "ownershipKind must be one of the four install-contract kinds");
  }
  const deviceId = stringField(source, "deviceId");
  const allowedRolesRaw = source["allowedRoles"];
  let allowedRoles: readonly string[] = [];
  if (allowedRolesRaw !== undefined) {
    if (!Array.isArray(allowedRolesRaw) || !allowedRolesRaw.every((r) => typeof r === "string" && r.trim().length > 0)) {
      return refuseEnrollment("invalid_input", 400, "allowedRoles must be an array of non-empty role names");
    }
    allowedRoles = (allowedRolesRaw as readonly string[]).map((r) => r.trim());
  }
  const ttlMsRaw = source["ttlMs"];
  let ttlMs = ENROLLMENT_CODE_TTL_MS;
  if (ttlMsRaw !== undefined) {
    if (typeof ttlMsRaw !== "number" || !Number.isFinite(ttlMsRaw)) {
      return refuseEnrollment("invalid_input", 400, "ttlMs must be a number");
    }
    if (ttlMsRaw < ENROLLMENT_CODE_TTL_MIN_MS || ttlMsRaw > ENROLLMENT_CODE_TTL_MAX_MS) {
      return refuseEnrollment("invalid_input", 400, "ttlMs must be between one minute and seven days");
    }
    ttlMs = ttlMsRaw;
  }

  // The operator session (httpOnly cookie) — fail-closed.
  const cookieTenant = readCookieTenant(request);
  if (cookieTenant === undefined) {
    return refuseEnrollment("unauthenticated", 401, "no server session cookie is present");
  }
  const opened = await openServerRequest([cookieTenant], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const operator = resolveOperatorSessionInContext(context, request);
    if (!operator.ok) {
      // Fail-closed on every session refusal path — machine-stable.
      return refuseEnrollment("unauthenticated", 401, operator.reason);
    }
    if (operator.session.tenantId === DEMO_TENANT_ID) {
      return refuseEnrollment("invalid_scope", 403, "the demo tenant is never an enrollment scope");
    }

    // The W130 permission law: operator-and-above roles may issue;
    // viewer roles (employee / vendor.operator) receive the frozen
    // denial words with the escalation path.
    const mayIssue = operator.session.assignedRoles.some((role) => {
      const experience = experienceRoleFromAssignment(role);
      return experience !== null && canInteract(operatorRoleFor(experience), "propose").ok;
    });
    if (!mayIssue) {
      const denial = enrollmentCodeCreationDenial(operator.session.activeRole !== null
        ? (experienceRoleFromAssignment(operator.session.activeRole) ?? null)
        : null);
      return jsonResponse(
        refusalBody("interaction_forbidden", denial.explanation),
        403,
      );
    }

    // The high-entropy code (W130 shape) + the request id (digest-based).
    const code = context.deps.entropy.enrollmentCode();
    const requestId = `enr_${fnv1a32Hex(canonicalJson({ tenantId: operator.session.tenantId, code, now: context.deps.now }))}`;

    // The REAL frozen boundary (via the sanctioned web-device binding):
    // validation, expiry math and the verifier derivation are the
    // domain's — this plane only persists and audits.
    const created = createInstallEnrollmentCode({
      tenantId: asTenantId(operator.session.tenantId),
      requestId,
      code,
      ownershipKind,
      ttlMs,
      now: context.deps.now,
    });
    if (!created.ok) {
      return refuseEnrollment("invalid_input", 400, "the enrollment boundary refused the request");
    }
    // The boundary record owns the core (verifier, expiry, status); the
    // SCOPE fields (pre-assigned device, allowed roles) are this plane's
    // own issuance inputs — the binding's structural view does not carry
    // them, so the persisted view is enriched here (one record, honest
    // provenance: everything below flows from the validated request).
    const record: ServerEnrollmentRecordView = {
      ...(created.record as unknown as ServerEnrollmentRecordView),
      ...(deviceId !== undefined ? { deviceId } : {}),
      allowedRoles,
    };

    const ctx = makeTenantContext(asTenantId(operator.session.tenantId), context.deps.correlationId);
    const put = context.store.store.insert(
      ctx,
      "fleetos_enrollment_requests",
      record.requestId,
      enrollmentRowOf(record),
    );
    if (!put.ok) {
      return refuseEnrollment("server_store_write_failed", 503, "the durable insert was refused");
    }
    // Audit: ids and scope only — never the code, never the verifier.
    context.audit.appendServerRecord({
      tenantId: asTenantId(operator.session.tenantId),
      action: SERVER_ENROLLMENT_AUDIT_ACTIONS.created,
      subject: record.requestId,
      occurredAt: context.deps.now,
      correlationId: context.deps.correlationId,
      actorPrincipalId: operator.session.principalId,
      details: {
        requestId: record.requestId,
        ownershipKind: record.ownershipKind,
        ownershipClass: record.ownershipClass,
        expiresAt: record.expiresAt,
        allowedRoles: record.allowedRoles,
      },
    });

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;

    const issuance: EnrollmentIssuanceBody = frozen({
      ok: true as const,
      requestId: record.requestId,
      code,
      ownershipKind,
      ownershipClass: record.ownershipClass,
      allowedRoles: record.allowedRoles,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
    return jsonResponse(issuance, 201);
  } catch {
    return refuseEnrollment("server_store_unavailable", 503, "the issuance could not be completed; nothing was recorded");
  }
}

// ---------------------------------------------------------------------------
// REDEMPTION
// ---------------------------------------------------------------------------

/** The redemption success body: the device-scoped trust record. */
export interface EnrollmentRedemptionBody {
  readonly ok: true;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly enrollmentRequestId: string;
  readonly issuedAt: string;
  readonly sessionToken: {
    readonly value: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly issuer: string;
  };
  readonly device: {
    readonly lifecycleState: string;
    readonly enrolledAt: string;
    readonly twinRevision: number;
  };
}

/**
 * POST /api/enrollment/redeem — redeem a one-time enrollment code
 * (tenant-scoped; the W130 law). Creates the REAL device record +
 * membership and issues the device-scoped trust record.
 */
export async function handleRedeemEnrollmentCode(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const source = body.body as Record<string, unknown>;
  const tenantId = stringField(source, "tenantId");
  const requestId = stringField(source, "requestId");
  const code = stringField(source, "code");
  const deviceId = stringField(source, "deviceId");
  const adapterFamily = stringField(source, "adapterFamily");
  const presenterRole = stringField(source, "presenterRole");
  const hardwareRaw = source["hardware"];
  if (
    tenantId === undefined || requestId === undefined || code === undefined ||
    deviceId === undefined || adapterFamily === undefined
  ) {
    return refuseEnrollment("invalid_input", 400, "tenantId, requestId, code, deviceId and adapterFamily are required");
  }
  if (typeof hardwareRaw !== "object" || hardwareRaw === null) {
    return refuseEnrollment("invalid_input", 400, "hardware claims (manufacturer, model) are required");
  }
  const hardware = hardwareRaw as Record<string, unknown>;
  const manufacturer = stringField(hardware, "manufacturer");
  const model = stringField(hardware, "model");
  if (manufacturer === undefined || model === undefined) {
    return refuseEnrollment("invalid_input", 400, "hardware.manufacturer and hardware.model are required");
  }

  // The W130 law: the demo tenant is NEVER a redemption scope.
  if (tenantId === DEMO_TENANT_ID) {
    return refuseEnrollment("invalid_scope", 403, "the demo tenant is never an enrollment scope");
  }

  const opened = await openServerRequest([tenantId], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const ctx = makeTenantContext(asTenantId(tenantId), context.deps.correlationId);
    const store = context.store.store;

    // The tenant-scoped lookup: an unknown request, a code mismatch and
    // a foreign tenant's request are ALL `code_not_found`
    // (indistinguishable — no existence side channel).
    const storedRow = store.get(ctx, "fleetos_enrollment_requests", requestId);
    const notFound = async (): Promise<Response> => {
      auditRefusal(context, tenantId, "code_not_found", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("code_not_found", 404);
    };
    if (storedRow === undefined) {
      return await notFound();
    }
    const record = recordFromRow(storedRow.row);
    if (record === undefined || record.codeVerifier !== enrollmentCodeVerifier(tenantId, code)) {
      return await notFound();
    }

    // Lifecycle refusals (the frozen taxonomy).
    if (record.status === "revoked") {
      auditRefusal(context, tenantId, "code_revoked", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("code_revoked", 410);
    }
    if (record.status === "fulfilled") {
      auditRefusal(context, tenantId, "code_already_used", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("code_already_used", 409);
    }
    if (Date.parse(context.deps.now) > Date.parse(record.expiresAt)) {
      // Lazily observe the expiry: the record transitions to expired
      // and the observation is audited (short-lived is first-class).
      store.put(ctx, "fleetos_enrollment_requests", requestId, frozen({
        ...storedRow.row,
        status: "expired",
      }));
      context.audit.appendServerRecord({
        tenantId: asTenantId(tenantId),
        action: SERVER_ENROLLMENT_AUDIT_ACTIONS.expired,
        subject: requestId,
        occurredAt: context.deps.now,
        correlationId: context.deps.correlationId,
        actorPrincipalId: "svc:web.server-control-plane",
        details: { requestId, expiresAt: record.expiresAt },
      });
      auditRefusal(context, tenantId, "code_expired", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("code_expired", 410);
    }

    // The role gate: a role-restricted code requires a presented role
    // within the allowed set (agents carry no role claim — restricted
    // codes are operator-presented redemptions).
    if (record.allowedRoles.length > 0 && (presenterRole === undefined || !record.allowedRoles.includes(presenterRole))) {
      auditRefusal(context, tenantId, "tenant_role_mismatch", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("tenant_role_mismatch", 403);
    }

    // The policy gate: a pre-assigned device binds the code to that
    // device (a different device is a machine-stable policy refusal).
    if (record.deviceId !== undefined && record.deviceId !== deviceId) {
      auditRefusal(context, tenantId, "enrollment_refused_by_policy", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("enrollment_refused_by_policy", 403);
    }

    // The device record: the REAL domain enrollment + twin creation.
    const twins = store.list(ctx, "fleetos_device_twins");
    if (twins.some((row) => row.row["device_id"] === deviceId)) {
      auditRefusal(context, tenantId, "device_already_enrolled", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("device_already_enrolled", 409);
    }
    const identity: DeviceIdentity | undefined = (() => {
      const enrolled = enrollDevice({
        tenantId: asTenantId(tenantId),
        deviceId: asDeviceId(deviceId),
        adapterFamily,
        hardware: {
          manufacturer,
          model,
          serialNumber: stringField(hardware, "serialNumber"),
          assetTag: stringField(hardware, "assetTag"),
        },
        ownership: { ownerType: ownershipTypeOfKind(ownershipKindOf(record.ownershipKind)) },
        at: context.deps.now,
        provenance: {
          correlationId: context.deps.correlationId,
          reason: "server enrollment redemption",
        },
      });
      if (!enrolled.ok) return undefined;
      return enrolled.identity;
    })();
    if (identity === undefined) {
      auditRefusal(context, tenantId, "invalid_input", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("invalid_input", 400, "the device enrollment claims were refused by the domain");
    }
    const twinResult = createTwin({
      identity,
      ctx: {
        at: context.deps.now,
        correlationId: context.deps.correlationId,
        reason: "server enrollment redemption",
      },
    });
    if (!twinResult.ok) {
      auditRefusal(context, tenantId, "invalid_input", requestId, { deviceId });
      const flushed = await flushOrRefuse(context);
      if (!flushed.ok) return flushed.response;
      return refuseEnrollment("invalid_input", 400, "the device twin could not be created");
    }
    const twin = twinResult.twin;
    const twinPut = store.insert(
      ctx,
      "fleetos_device_twins",
      deviceId,
      frozen({
        tenant_id: tenantId,
        device_id: deviceId,
        revision: twin.revision,
        lifecycle_state: twin.identity.lifecycleState,
        enrolled_at: twin.identity.enrolledAt,
        twin: canonicalJson(twin),
        updated_at: context.deps.now,
      }),
    );
    if (!twinPut.ok) {
      return refuseEnrollment("server_store_write_failed", 503, "the device record insert was refused");
    }

    // The membership: the agt: principal through the REAL identity
    // repository (idempotent re-put for an already-present agent
    // principal is fine — the trust record is the uniqueness gate).
    const principal = makeAgentPrincipal(asTenantId(tenantId), asDeviceId(deviceId));
    const principals = createDurablePrincipalRepository(store);
    principals.putPrincipal(ctx, {
      tenantId: asTenantId(tenantId),
      principalId: principal.principalId,
      kind: "agent",
      memberRef: deviceId,
      displayName: `${manufacturer} ${model}`,
      createdAt: context.deps.now,
    });

    // The device-scoped trust record (the check-in credential).
    const trustToken = context.deps.entropy.trustToken();
    const expiresAt = new Date(Date.parse(context.deps.now) + AGENT_TRUST_TTL_MS).toISOString();
    const agentSessionId = `agses_${sha256Hex(`${tenantId}${deviceId}${trustToken}`).slice(0, 24)}`;
    const trustPut = store.insert(
      ctx,
      "fleetos_agent_sessions",
      agentSessionId,
      frozen({
        tenant_id: tenantId,
        agent_session_id: agentSessionId,
        device_id: deviceId,
        token: trustToken,
        enrollment_request_id: requestId,
        issued_at: context.deps.now,
        expires_at: expiresAt,
        last_seen_at: context.deps.now,
        revoked_at: null,
        check_in_count: 0,
      }),
    );
    if (!trustPut.ok) {
      return refuseEnrollment("server_store_write_failed", 503, "the trust record insert was refused");
    }

    // Fulfill the request (one-time): terminal.
    store.put(ctx, "fleetos_enrollment_requests", requestId, frozen({
      ...storedRow.row,
      status: "fulfilled",
      fulfilled_at: context.deps.now,
      fulfilled_device_id: deviceId,
    }));
    context.audit.appendServerRecord({
      tenantId: asTenantId(tenantId),
      action: SERVER_ENROLLMENT_AUDIT_ACTIONS.fulfilled,
      subject: requestId,
      occurredAt: context.deps.now,
      correlationId: context.deps.correlationId,
      actorPrincipalId: principal.principalId,
      details: {
        requestId,
        deviceId,
        principalId: principal.principalId,
        twinRevision: twin.revision,
        expiresAt,
      },
    });

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;

    const redemption: EnrollmentRedemptionBody = frozen({
      ok: true as const,
      tenantId,
      deviceId,
      enrollmentRequestId: requestId,
      issuedAt: context.deps.now,
      sessionToken: {
        value: trustToken,
        issuedAt: context.deps.now,
        expiresAt,
        issuer: AGENT_TRUST_ISSUER,
      },
      device: {
        lifecycleState: twin.identity.lifecycleState,
        enrolledAt: twin.identity.enrolledAt,
        twinRevision: twin.revision,
      },
    });
    return jsonResponse(redemption, 201);
  } catch {
    return refuseEnrollment("server_store_unavailable", 503, "the redemption could not be completed; nothing was recorded");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The ownership-kind lookup (validated against the four literals). */
function ownershipKindOf(raw: string): ServerOwnershipKind {
  const found = SERVER_OWNERSHIP_KINDS.find((kind) => kind === raw);
  return found ?? "corporate_owned";
}

/** Read the session cookie's tenant (without resolving the session). */
function readCookieTenant(request: Request): string | undefined {
  return parseSessionCookie(request)?.tenantId;
}
