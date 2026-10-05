/**
 * @fleetos/web — the server-side DECLARED-IMPORT plane (W145 deploy
 * convergence, TL scope: apps/web/src/server/**).
 *
 * POST /api/device/declared-import — an authenticated operator (the
 * httpOnly server session; operator-and-above per the W130 law) declares
 * a manual device record: the request body carries the DRAFT fields, the
 * server rebuilds the EXACT W145 journey (initial -> updateDraft ->
 * declaredImportCommand) with the duplicate review over the TENANT's
 * durable twins (`fleetos_device_twins`), then executes the command
 * through the REAL domain path (enrollDevice -> createTwin -> a durable
 * store.put) and audits it. The record is DURABLE — it survives page
 * reloads and sign-out/sign-in on the deployed tier.
 *
 * GET /api/device/twins — the tenant's durable twin list (the client
 * roster hydration source on the deployed tier; own partition only).
 *
 * FAIL-CLOSED on every refusal path, machine-stable reasons throughout,
 * exactly the W140 plane's shape (mirrors server-enrollment).
 */
import { asTenantId, asUserId, asDeviceId } from "@fleetos/contracts";
import type { TenantId } from "@fleetos/contracts";
import { enrollDevice, createTwin } from "@fleetos/device-model";
import type { DeviceTwin, TwinStore } from "@fleetos/device-model";
import { makeTenantContext } from "@fleetos/identity";
import type { DurableRow, DurableStoredRow } from "@fleetos/identity";
import {
  initialDeclaredImportJourney,
  updateDeclaredDeviceDraft,
  declaredImportCommand,
  verifyDeclaredImport,
} from "@fleetos/web-device/server";
import type { DeclaredDeviceDraftPatch } from "@fleetos/web-device/server";
import { experienceRoleFromAssignment, operatorRoleFor } from "@fleetos/web-product/src/role-bridge";
import { canInteract } from "@fleetos/web-shell/src/permissions";
import { parseJsonBody, jsonResponse, refusalBody, stringField, canonicalJson, frozen } from "./server-internal";
import { openServerRequest, flushOrRefuse } from "./server-context";
import { resolveOperatorSessionInContext, parseSessionCookie } from "./server-sessions";
import type { ServerHandlerDeps } from "./server-context";

// ---------------------------------------------------------------------------
// The refusal vocabulary
// ---------------------------------------------------------------------------

export type ServerDeclaredImportRefusal =
  | "invalid_json"
  | "invalid_input"
  | "unauthenticated"
  | "interaction_forbidden"
  | "invalid_scope"
  | "duplicate_device_id"
  | "declared_import_refused"
  | "server_store_unavailable"
  | "server_store_write_failed";

const REFUSAL_EXPLANATIONS: Readonly<Record<ServerDeclaredImportRefusal, string>> = frozen({
  invalid_json: "The declared-import request body is not valid JSON.",
  invalid_input: "The declared device draft is malformed. Check the device id, hardware and ownership fields, then try again.",
  unauthenticated: "No server session is present. Sign in and try again.",
  interaction_forbidden: "Declaring device records is a propose-class interaction — your role observes only. Ask a workspace operator to declare the record.",
  invalid_scope: "The demo workspace is not a declared-import scope.",
  duplicate_device_id: "A device record with this id already exists in your fleet. Declared imports never overwrite or merge an existing record.",
  declared_import_refused: "The domain boundary refused the declared-import command.",
  server_store_unavailable: "The server control plane's durable store is unavailable.",
  server_store_write_failed: "The durable write was refused.",
});

function refuse(
  reason: ServerDeclaredImportRefusal,
  status: number,
  detail?: string,
): Response {
  const explanation = detail ?? REFUSAL_EXPLANATIONS[reason];
  return jsonResponse(refusalBody(reason, explanation), status);
}

// ---------------------------------------------------------------------------
// The durable twin source (the W145 duplicate-review seam, server-side)
// ---------------------------------------------------------------------------

/** Rehydrate a DeviceTwin from its stored canonical JSON (the check-in pattern). */
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
 * The tenant's durable twin view over `fleetos_device_twins`: the
 * declared-import duplicate review reads the SAME durable records the
 * agent check-in path writes (own partition only — the rows arrive
 * already tenant-scoped).
 */
function durableTwinView(
  tenantId: TenantId,
  rows: readonly DurableStoredRow[],
): Pick<TwinStore, "get" | "list"> {
  const byId = new Map<string, DeviceTwin>();
  for (const row of rows) {
    const twin = twinFromRow(row.row);
    if (twin !== undefined) {
      byId.set(row.key, twin);
    }
  }
  return frozen({
    get: (tenant: TenantId, deviceId: string): DeviceTwin | undefined => {
      void tenant; // rows are already this tenant's partition
      return byId.get(deviceId);
    },
    list: (tenant: TenantId): readonly DeviceTwin[] => {
      void tenant;
      return Array.from(byId.values()).sort((a, b) =>
        (a.identity.deviceId as string).localeCompare(b.identity.deviceId as string),
      );
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/device/declared-import
// ---------------------------------------------------------------------------

export async function handleDeclareDeviceImport(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const source = body.body as Record<string, unknown>;

  // ---- The draft fields (the W145 journey's enter-step contract) ------
  const deviceId = stringField(source, "deviceId");
  const manufacturer = stringField(source, "manufacturer");
  const model = stringField(source, "model");
  const serialNumber = stringField(source, "serialNumber");
  const assetTag = stringField(source, "assetTag");
  const ownerType = stringField(source, "ownerType");
  const assignedTeam = stringField(source, "assignedTeam");
  const provenanceAcknowledged = source["provenanceAcknowledged"] === true;
  const duplicateSerialAcknowledged = source["duplicateSerialAcknowledged"] === true;

  if (
    deviceId === undefined || deviceId.trim().length === 0 ||
    manufacturer === undefined || manufacturer.trim().length === 0 ||
    model === undefined || model.trim().length === 0 ||
    ownerType === undefined || ownerType.trim().length === 0
  ) {
    return refuse("invalid_input", 400);
  }
  if (!provenanceAcknowledged) {
    return refuse("invalid_input", 400, "The provenance acknowledgment is required before a declared import can execute.");
  }

  // ---- The operator session (httpOnly cookie) — fail-closed -----------
  const cookieTenant = parseSessionCookie(request)?.tenantId;
  if (cookieTenant === undefined) {
    return refuse("unauthenticated", 401);
  }
  const opened = await openServerRequest([cookieTenant], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;

  try {
    const operator = resolveOperatorSessionInContext(context, request);
    if (!operator.ok) {
      return refuse("unauthenticated", 401, operator.reason);
    }
    if (operator.session.tenantId === "tnt_w091demo000001") {
      return refuse("invalid_scope", 403);
    }

    // The W130 permission law: declaring a record is PROPOSE-class.
    const mayDeclare = operator.session.assignedRoles.some((role) => {
      const experience = experienceRoleFromAssignment(role);
      return experience !== null && canInteract(operatorRoleFor(experience), "propose").ok;
    });
    if (!mayDeclare) {
      return refuse("interaction_forbidden", 403);
    }

    const tenantId = asTenantId(operator.session.tenantId);
    const store = context.store.store;
    const ctx = makeTenantContext(tenantId, context.deps.correlationId);

    // ---- The durable twin view (duplicate review over REAL rows) -------
    const twinView = durableTwinView(tenantId, store.list(ctx, "fleetos_device_twins"));

    // ---- Rebuild the EXACT W145 journey server-side --------------------
    const patch: DeclaredDeviceDraftPatch = {
      deviceId: deviceId.trim(),
      hardware: {
        manufacturer: manufacturer.trim(),
        model: model.trim(),
        ...(serialNumber !== undefined && serialNumber.trim().length > 0 ? { serialNumber: serialNumber.trim() } : {}),
        ...(assetTag !== undefined && assetTag.trim().length > 0 ? { assetTag: assetTag.trim() } : {}),
      },
      ownership: {
        ownerType: ownerType.trim(),
        ...(assignedTeam !== undefined && assignedTeam.trim().length > 0 ? { assignedTeam: assignedTeam.trim() } : {}),
      },
      provenanceAcknowledged,
      ...(duplicateSerialAcknowledged ? { duplicateSerialAcknowledged } : {}),
    };
    let journey = initialDeclaredImportJourney(tenantId);
    journey = updateDeclaredDeviceDraft(journey, patch);

    const command = declaredImportCommand(
      { tenantId },
      twinView,
      journey,
      {
        now: context.deps.now,
        correlationId: context.deps.correlationId,
        declaredBy: asUserId(operator.session.principalId),
      },
    );
    if (command === undefined) {
      // The blocking discriminator: an existing record with the same
      // device id (the review refuses before the command derives).
      const existing = twinView.get(tenantId, asDeviceId(deviceId.trim()));
      if (existing !== undefined) {
        return refuse("duplicate_device_id", 409);
      }
      return refuse("invalid_input", 400, "The declared-import command could not be derived from the draft.");
    }

    // ---- Execute through the REAL domain path ---------------------------
    const enrolled = enrollDevice({
      tenantId: command.tenantId,
      deviceId: command.deviceId,
      adapterFamily: command.adapterFamily,
      hardware: command.hardware,
      ownership: {
        ownerType: command.ownership.ownerType as "FLEET_PURCHASED",
        assignedTeam: command.ownership.assignedTeam,
      },
      at: command.declaredAt,
      provenance: {
        correlationId: command.enrollmentProvenance.correlationId,
        actor:
          command.enrollmentProvenance.actor.kind === "user"
            ? { kind: "user", userId: command.enrollmentProvenance.actor.userId }
            : { kind: "system" },
        reason: command.enrollmentProvenance.reason,
      },
    });
    if (!enrolled.ok) {
      return refuse("declared_import_refused", 422, enrolled.error.message);
    }
    const created = createTwin({
      identity: enrolled.identity,
      ctx: {
        at: command.declaredAt,
        correlationId: command.enrollmentProvenance.correlationId,
      },
    });
    if (!created.ok) {
      return refuse("declared_import_refused", 422, created.error.message);
    }

    // ---- The durable write (the check-in row shape, all NOT NULL
    // columns satisfied: revision + enrolled_at from the REAL twin) ----
    const existingRow = store.get(ctx, "fleetos_device_twins", command.deviceId as string);
    const put = store.put(ctx, "fleetos_device_twins", command.deviceId as string, frozen({
      ...(existingRow?.row ?? {}),
      tenant_id: operator.session.tenantId,
      device_id: command.deviceId as string,
      revision: created.twin.revision,
      lifecycle_state: created.twin.identity.lifecycleState,
      enrolled_at: command.declaredAt,
      twin: canonicalJson(created.twin),
      updated_at: context.deps.now,
    }));
    if (!put.ok) {
      return refuse("server_store_write_failed", 503);
    }

    // ---- Audit: ids + provenance facts only (never draft noise) ---------
    context.audit.appendServerRecord({
      tenantId,
      action: "device.record.declared",
      subject: command.deviceId as string,
      occurredAt: context.deps.now,
      correlationId: context.deps.correlationId,
      actorPrincipalId: operator.session.principalId,
      details: {
        deviceId: command.deviceId as string,
        adapterFamily: command.adapterFamily,
        provenance: "DECLARED",
        declaredBy: operator.session.principalId,
      },
    });

    const flushed = await flushOrRefuse(context);
    if (!flushed.ok) return flushed.response;

    // ---- The verification view over the DURABLE record (the FRESH
    // post-write view — the request-scoped cache now carries the row) ----
    const freshView = durableTwinView(tenantId, store.list(ctx, "fleetos_device_twins"));
    const verification = verifyDeclaredImport({ tenantId }, freshView, asDeviceId(command.deviceId as string));
    return jsonResponse(
      frozen({
        ok: true,
        deviceId: command.deviceId as string,
        provenance: "DECLARED",
        declaredAt: command.declaredAt,
        verification,
      }),
      201,
    );
  } finally {
    // The request-scoped store releases with the request.
  }
}

// ---------------------------------------------------------------------------
// GET /api/device/twins — the tenant's durable twin list (roster hydration)
// ---------------------------------------------------------------------------

export async function handleListDeviceTwins(
  request: Request,
  deps: ServerHandlerDeps = {},
): Promise<Response> {
  const cookieTenant = parseSessionCookie(request)?.tenantId;
  if (cookieTenant === undefined) {
    return refuse("unauthenticated", 401);
  }
  const opened = await openServerRequest([cookieTenant], deps);
  if (!opened.ok) return opened.response;
  const context = opened.context;
  const operator = resolveOperatorSessionInContext(context, request);
  if (!operator.ok) {
    return refuse("unauthenticated", 401, operator.reason);
  }
  if (operator.session.tenantId === "tnt_w091demo000001") {
    return refuse("invalid_scope", 403);
  }
  const store = context.store.store;
  const ctx = makeTenantContext(asTenantId(operator.session.tenantId), context.deps.correlationId);
  const rows = store.list(ctx, "fleetos_device_twins");
  const twins: readonly DeviceTwin[] = rows
    .map((row) => twinFromRow(row.row))
    .filter((twin): twin is DeviceTwin => twin !== undefined)
    .sort((a, b) => (a.identity.deviceId as string).localeCompare(b.identity.deviceId as string));
  return jsonResponse(
    frozen({
      ok: true,
      tenantId: operator.session.tenantId,
      count: twins.length,
      twins,
    }),
    200,
  );
}
