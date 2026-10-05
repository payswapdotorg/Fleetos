/**
 * @fleetos/web — W144 deploy convergence (TL scope): the DECLARED-IMPORT
 * console binding.
 *
 * The W145 lane shipped the journey (draft -> review -> confirm ->
 * recorded), the review/command projections, and the rendered screen —
 * all PURE and fully machine-tested. What the composed runtime was
 * missing is the BINDING: a session-scoped twin store the declared
 * records land in, and the executor that runs the command view through
 * the REAL domain boundary (`enrollDevice` -> `createTwin` ->
 * `TwinStore.put`) — the exact path the W145 composition test pins as
 * "the way the console runtime will execute it".
 *
 * Everything here is TL-scope (new runtime/composition files); the
 * device lane stays frozen.
 */
import { asCorrelationId } from "@fleetos/contracts";
import type { CorrelationId } from "@fleetos/contracts";
import { createInMemoryTwinStore, enrollDevice, createTwin } from "@fleetos/device-model";
import type { DeviceTwin, TwinStore } from "@fleetos/device-model";
import { DECLARED_IMPORT_PROVENANCE_REASON } from "@fleetos/web-device";
import type { DeclaredImportCommandView } from "@fleetos/web-device";

// ---------------------------------------------------------------------------
// The session store
// ---------------------------------------------------------------------------

/**
 * A fresh session-scoped twin store for a non-demo workspace — where
 * that workspace's DECLARED records live until an agent-observed record
 * path replaces the tier. One store per active session (per tenant).
 */
export function createSessionTwinStore(): TwinStore {
  return createInMemoryTwinStore();
}

// ---------------------------------------------------------------------------
// The executor — the REAL domain path (never an adapter, never a mock)
// ---------------------------------------------------------------------------

/** The executor's outcome: the REAL twin on success; the boundary's machine-stable reason on refusal. */
export type DeclaredImportExecution =
  | { readonly ok: true; readonly twin: DeviceTwin }
  | { readonly ok: false; readonly reason: string };

/**
 * Execute a declared-import command the way the console runtime does:
 * the REAL `enrollDevice` boundary with the command's provenance
 * VERBATIM (reason = fleetos.declared-import), `createTwin`, and a
 * `TwinStore.put`. Mirrors the W145 composition test's executor exactly.
 */
export function executeDeclaredImportCommand(
  command: DeclaredImportCommandView,
  store: TwinStore,
): DeclaredImportExecution {
  if (command.enrollmentProvenance.reason !== DECLARED_IMPORT_PROVENANCE_REASON) {
    return { ok: false, reason: "provenance_reason_not_declared_import" };
  }
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
    return { ok: false, reason: enrolled.error.message };
  }
  const created = createTwin({
    identity: enrolled.identity,
    ctx: {
      at: command.declaredAt,
      correlationId: command.enrollmentProvenance.correlationId,
    },
  });
  if (!created.ok) {
    return { ok: false, reason: created.error.message };
  }
  store.put(created.twin);
  return { ok: true, twin: created.twin };
}

// ---------------------------------------------------------------------------
// The shell-side inputs
// ---------------------------------------------------------------------------

/** The ownership-type options the console injects into the journey screen. */
export const DECLARE_OWNERSHIP_TYPE_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = Object.freeze([
  Object.freeze({ value: "FLEET_PURCHASED", label: "Fleet-purchased" }),
  Object.freeze({ value: "LEASED", label: "Leased" }),
]);

/**
 * A fresh correlation id for a declared-import submission (browser-tier
 * entropy; the command view carries it into the REAL audit provenance).
 */
export function newDeclaredImportCorrelationId(): CorrelationId {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return asCorrelationId(`cor_declared${rand}`);
}
