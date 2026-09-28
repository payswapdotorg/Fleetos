/**
 * @fleetos/recovery — W071: the data-minimization projection over
 * recovery evidence.
 *
 * ARCHITECTURE-LOCK.md item 15: "Telemetry is minimized and
 * purpose-bound; BYOD and corporate-owned scopes are distinct." This
 * module surfaces the W040 last-seen / Find-My-Device evidence ledger
 * (last-seen.ts — untouched) through a REDACTION POLICY:
 *
 *   - The **non-location** last-seen summary (record id, observedAt,
 *     recordedAt, staleness, evidence refs) is always available — it is
 *     presence evidence, not payload data.
 *   - The **location payload** is DROPPED unless a typed disclosure
 *     grant is present. The grant is never ambient: it carries the
 *     approver, the grant instant, an optional expiry, and the exact
 *     tenant + device scope it unlocks. No grant, an expired grant, or
 *     a grant scoped to another tenant/device => the payload is
 *     withheld with a machine-stable redaction reason and only the
 *     existence evidence (observation id, observedAt, staleness,
 *     source record) survives.
 *
 * Machine-stable redaction states: `no_location_evidence` (the W040
 * verbatim absent-evidence state — never a guess), `located_redacted`
 * (location evidence EXISTS but the payload is withheld), `located`
 * (the grant unlocked the payload — the W040 verbatim located state).
 *
 * Every disclosure (a grant unlocking a payload) and every redaction
 * (the policy withholding one) is auditable through the injected
 * `RecoveryAuditSink` seam (the W011/W040 pattern) — a disclosure is a
 * consequential read of sensitive evidence; a redaction is the
 * boundary holding, which is evidence too.
 *
 * ADDITIVE ONLY: the W040 `findMyDevice` view and its types are
 * consumed verbatim; this module projects OVER them and never edits
 * them.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: every timestamp is injected by the caller.
 */

import type { CorrelationId, CausationId, DeviceId, TenantId } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type {
  FindMyDeviceLastSeen,
  FindMyDeviceView,
  LastSeenStaleness,
} from "./last-seen";
import { LOCATED, NO_LOCATION_EVIDENCE } from "./last-seen";
import type { RecoveryAuditSink } from "./audit-seam";
import { NOOP_RECOVERY_AUDIT_SINK } from "./audit-seam";
import {
  ERROR_CODES,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  looksLikeIso,
  parseIsoMs,
} from "./internal";
import type { RecoveryTenantScope } from "./internal";
import { checkRecoveryTenantScope } from "./internal";
import { makeDomainError } from "./internal";

// ---------------------------------------------------------------------------
// W071.1 — The typed location-disclosure grant
// ---------------------------------------------------------------------------

/**
 * The typed grant that unlocks a location payload. NEVER ambient: the
 * grant carries the approver (the principal who approved the
 * disclosure), the grant instant, an optional expiry, and the exact
 * tenant + device scope. A missing, expired, or scope-mismatched grant
 * withholds the payload — data minimization is the default state.
 */
export interface LocationDisclosureGrant extends TenantScoped {
  /** The device whose location payload the grant unlocks. */
  readonly deviceId: DeviceId;
  /** The approving principal (e.g. "usr_..." or a service principal id). */
  readonly approver: string;
  /** ISO 8601 instant the grant was issued (injected — no clock reads). */
  readonly grantedAt: string;
  /** Optional ISO 8601 instant after which the grant no longer unlocks. */
  readonly expiresAt?: string;
}

/** Inputs for constructing a grant. */
export interface LocationDisclosureGrantInputs {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly approver: string;
  readonly grantedAt: string;
  readonly expiresAt?: string;
}

/**
 * Construct a `LocationDisclosureGrant`. Pure, deterministic, frozen.
 * Validates the observable shape: non-empty approver, ISO `grantedAt`,
 * ISO `expiresAt` when present, and expiry not preceding the grant
 * instant. Returns a tagged result — never throws.
 */
export function makeLocationDisclosureGrant(
  inputs: unknown,
):
  | { readonly ok: true; readonly grant: LocationDisclosureGrant }
  | { readonly ok: false; readonly reason: "grant_malformed"; readonly detail: string } {
  if (inputs === null || typeof inputs !== "object") {
    return { ok: false, reason: "grant_malformed", detail: "grant is absent" };
  }
  const candidate = inputs as {
    tenantId?: unknown;
    deviceId?: unknown;
    approver?: unknown;
    grantedAt?: unknown;
    expiresAt?: unknown;
  };
  if (typeof candidate.tenantId !== "string" || candidate.tenantId.length === 0) {
    return { ok: false, reason: "grant_malformed", detail: "tenantId is required" };
  }
  if (typeof candidate.deviceId !== "string" || candidate.deviceId.length === 0) {
    return { ok: false, reason: "grant_malformed", detail: "deviceId is required" };
  }
  if (typeof candidate.approver !== "string" || candidate.approver.length === 0) {
    return { ok: false, reason: "grant_malformed", detail: "approver is required" };
  }
  if (typeof candidate.grantedAt !== "string" || !looksLikeIso(candidate.grantedAt)) {
    return { ok: false, reason: "grant_malformed", detail: "grantedAt is not ISO 8601" };
  }
  if (candidate.expiresAt !== undefined) {
    if (typeof candidate.expiresAt !== "string" || !looksLikeIso(candidate.expiresAt)) {
      return { ok: false, reason: "grant_malformed", detail: "expiresAt is not ISO 8601" };
    }
    if (parseIsoMs(candidate.expiresAt) < parseIsoMs(candidate.grantedAt)) {
      return {
        ok: false,
        reason: "grant_malformed",
        detail: "expiresAt precedes grantedAt",
      };
    }
  }
  return {
    ok: true,
    grant: frozen({
      tenantId: candidate.tenantId as TenantId,
      deviceId: candidate.deviceId as DeviceId,
      approver: candidate.approver,
      grantedAt: candidate.grantedAt,
      ...(candidate.expiresAt !== undefined ? { expiresAt: candidate.expiresAt } : {}),
    }),
  };
}

/**
 * Is the grant valid (unlocks a payload) at the injected instant?
 * PURE. A grant with an expiry is valid strictly before it. Malformed
 * instants classify as invalid (fail-closed — minimization is the
 * default state).
 */
export function isGrantValidAt(grant: LocationDisclosureGrant, at: string): boolean {
  if (!looksLikeIso(at) || !looksLikeIso(grant.grantedAt)) return false;
  if (grant.expiresAt === undefined) return true;
  if (!looksLikeIso(grant.expiresAt)) return false;
  return parseIsoMs(at) < parseIsoMs(grant.expiresAt);
}

// ---------------------------------------------------------------------------
// W071.2 — Machine-stable redaction taxonomy
// ---------------------------------------------------------------------------

/** The redacted located state: evidence EXISTS, the payload is withheld. */
export const LOCATED_REDACTED = "located_redacted" as const;

/**
 * The machine-stable reasons a location payload was withheld.
 * Data minimization is the default; each reason is the specific
 * boundary that held.
 */
export type LocationRedactionReason =
  | "no_grant"
  | "grant_malformed"
  | "grant_expired"
  | "grant_scope_mismatch";

/** Every redaction reason, frozen, for validation + iteration. */
export const ALL_LOCATION_REDACTION_REASONS: readonly LocationRedactionReason[] = Object.freeze([
  "no_grant",
  "grant_malformed",
  "grant_expired",
  "grant_scope_mismatch",
]);

/**
 * The minimized last-known-location state of a device: the W040
 * `FindMyDeviceLocation` union with the payload-bearing `located`
 * state either kept verbatim (grant unlocked) or replaced by the
 * `located_redacted` state (payload withheld, existence evidence kept).
 */
export type MinimizedLocation =
  | { readonly status: typeof NO_LOCATION_EVIDENCE }
  | {
      readonly status: typeof LOCATED_REDACTED;
      /** The evidence ref: the immutable location observation's id (existence evidence — kept). */
      readonly observationId: string;
      /** ISO 8601 timestamp of the location observation (kept). */
      readonly observedAt: string;
      /** The staleness of the location evidence, re-derived at view time (kept). */
      readonly staleness: LastSeenStaleness;
      /** The last-seen record the location evidence was captured in (kept). */
      readonly fromRecordId: string;
      /** The machine-stable reason the payload was withheld. */
      readonly redactionReason: LocationRedactionReason;
    }
  | {
      readonly status: typeof LOCATED;
      readonly observationId: string;
      readonly observedAt: string;
      readonly kind: string;
      /** The location payload — present ONLY under a valid grant. */
      readonly payload: unknown;
      readonly staleness: LastSeenStaleness;
      readonly fromRecordId: string;
    };

/**
 * The minimized Find-My-Device view: the W040 view with the location
 * half projected through the redaction policy. The last-seen summary
 * (presence evidence) rides verbatim.
 */
export interface MinimizedFindMyDeviceView extends TenantScoped {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The current last-seen summary, verbatim from the W040 view. */
  readonly lastSeen: FindMyDeviceLastSeen | undefined;
  /** The minimized location state. */
  readonly location: MinimizedLocation;
}

// ---------------------------------------------------------------------------
// W071.3 — The redaction policy (the minimization projection)
// ---------------------------------------------------------------------------

/** Options for the minimization projection. */
export interface MinimizationOptions {
  /** The injected view instant (ISO 8601) — the grant validity reference. */
  readonly at: string;
  /** The typed disclosure grant, when one was issued (never ambient). */
  readonly grant?: LocationDisclosureGrant;
  /** The injected audit sink (disclosures + redactions emit; default: no-op). */
  readonly auditSink?: RecoveryAuditSink;
  /** Correlation id stamped on the audit records. */
  readonly correlationId?: CorrelationId;
  /** Causation id, when the projection is caused by a specific command/event. */
  readonly causationId?: CausationId;
}

/** Stable machine audit action names for the minimization layer. */
export const MINIMIZATION_AUDIT_ACTIONS = frozen({
  /** A valid grant unlocked a location payload (a consequential sensitive read). */
  locationDisclosed: "recovery.minimization.location_disclosed",
  /** A location payload was withheld by the redaction policy (the boundary holding is evidence). */
  locationRedacted: "recovery.minimization.location_redacted",
} as const);

/** The tagged result of the minimization projection. */
export type MinimizedProjectionResult =
  | { readonly ok: true; readonly view: MinimizedFindMyDeviceView }
  | { readonly ok: false; readonly error: ReturnType<typeof makeDomainError> };

/**
 * Project the W040 Find-My-Device view through the redaction policy.
 * PURE read + projection: no ledger mutation. The location payload
 * survives ONLY when a grant is present, well-formed, valid at the
 * injected instant, and scoped to exactly this view's tenant + device;
 * otherwise the payload is DROPPED and the existence evidence carries
 * the machine-stable redaction reason. The last-seen summary rides
 * verbatim (presence evidence, not payload data).
 *
 * Audit: a DISCLOSURE (payload unlocked) emits
 * `recovery.minimization.location_disclosed` with the grant context
 * (approver + instant — who unlocked what, when); a REDACTION emits
 * `recovery.minimization.location_redacted` with the reason. Absent
 * location evidence emits nothing (a pure negative — nothing was
 * either disclosed or withheld).
 */
export function projectMinimizedFindMyDevice(
  scope: RecoveryTenantScope,
  view: FindMyDeviceView,
  options: MinimizationOptions,
): MinimizedProjectionResult {
  const guard = checkRecoveryTenantScope(scope);
  if (!guard.ok) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.lastSeenStoreDomain,
        `minimization projection refused access (${guard.reason}: ${guard.detail})`,
        { tenantId: view.tenantId, correlationId: options.correlationId ?? ("" as CorrelationId) },
        "recovery.minimization",
        guard.reason,
      ),
    };
  }
  // Tenant isolation by construction: the VIEW's tenant must match the
  // acting scope (a foreign view is refused — never projected, never
  // audited under the acting tenant).
  if ((view.tenantId as string) !== (guard.tenantId as string)) {
    return {
      ok: false,
      error: makeDomainError(
        ERROR_CODES.lastSeenStoreDomain,
        "minimization projection refused: view tenant does not match the acting tenant scope",
        { tenantId: guard.tenantId, correlationId: options.correlationId ?? ("" as CorrelationId) },
        "recovery.minimization",
        "tenant_mismatch",
      ),
    };
  }
  const sink: RecoveryAuditSink = options.auditSink ?? NOOP_RECOVERY_AUDIT_SINK;
  const correlationId: CorrelationId = options.correlationId ?? ("" as CorrelationId);
  const deviceId = view.deviceId;

  if (view.location.status === NO_LOCATION_EVIDENCE) {
    // The W040 verbatim absent-evidence state: nothing to minimize,
    // nothing to disclose, nothing to audit.
    return {
      ok: true,
      view: frozen({
        tenantId: view.tenantId,
        deviceId,
        lastSeen: view.lastSeen,
        location: frozen({ status: NO_LOCATION_EVIDENCE }),
      }),
    };
  }

  // Location evidence EXISTS (status === LOCATED). Apply the grant policy.
  const located = view.location;
  const grant = options.grant;
  if (grant === undefined) {
    return withRedaction(
      view,
      located.observationId as string,
      located.observedAt,
      located.staleness,
      located.fromRecordId,
      "no_grant",
      sink,
      correlationId,
      options,
    );
  }
  // A malformed grant cannot unlock anything — but it also must not
  // masquerade as "no grant": the boundary that held is its malformed
  // shape. (makeLocationDisclosureGrant validated the constructor; a
  // structurally-typed grant that bypassed it is checked here.)
  const grantShape = makeLocationDisclosureGrant(grant);
  if (!grantShape.ok) {
    return withRedaction(
      view,
      located.observationId as string,
      located.observedAt,
      located.staleness,
      located.fromRecordId,
      "grant_malformed",
      sink,
      correlationId,
      options,
    );
  }
  if (!isGrantValidAt(grant, options.at)) {
    return withRedaction(
      view,
      located.observationId as string,
      located.observedAt,
      located.staleness,
      located.fromRecordId,
      "grant_expired",
      sink,
      correlationId,
      options,
    );
  }
  if (
    (grant.tenantId as string) !== (view.tenantId as string) ||
    (grant.deviceId as string) !== (deviceId as string)
  ) {
    return withRedaction(
      view,
      located.observationId as string,
      located.observedAt,
      located.staleness,
      located.fromRecordId,
      "grant_scope_mismatch",
      sink,
      correlationId,
      options,
    );
  }

  // The grant is present, valid, and scoped exactly to this view: the
  // payload is disclosed (audited — a consequential sensitive read).
  sink.append(
    frozen({
      action: MINIMIZATION_AUDIT_ACTIONS.locationDisclosed,
      tenantId: view.tenantId,
      subject: deviceId as string,
      occurredAt: options.at,
      correlationId,
      causationId: options.causationId,
      details: frozen({
        deviceId: deviceId as string,
        observationId: located.observationId as string,
        fromRecordId: located.fromRecordId,
        approver: grant.approver,
        grantedAt: grant.grantedAt,
        grantExpiresAt: grant.expiresAt ?? null,
        disclosedAt: options.at,
      }),
    }),
  );
  return {
    ok: true,
    view: frozen({
      tenantId: view.tenantId,
      deviceId,
      lastSeen: view.lastSeen,
      location: frozen({
        status: LOCATED,
        observationId: located.observationId,
        observedAt: located.observedAt,
        kind: located.kind,
        payload: located.payload,
        staleness: located.staleness,
        fromRecordId: located.fromRecordId,
      }),
    }),
  };
}

/** Internal: build the redacted view + emit the redaction audit record. */
function withRedaction(
  view: FindMyDeviceView,
  observationId: string,
  observedAt: string,
  staleness: LastSeenStaleness,
  fromRecordId: string,
  redactionReason: LocationRedactionReason,
  sink: RecoveryAuditSink,
  correlationId: CorrelationId,
  options: MinimizationOptions,
): MinimizedProjectionResult {
  sink.append(
    frozen({
      action: MINIMIZATION_AUDIT_ACTIONS.locationRedacted,
      tenantId: view.tenantId,
      subject: view.deviceId as string,
      occurredAt: options.at,
      correlationId,
      causationId: options.causationId,
      details: frozen({
        deviceId: view.deviceId as string,
        observationId,
        fromRecordId,
        redactionReason,
      }),
    }),
  );
  return {
    ok: true,
    view: frozen({
      tenantId: view.tenantId,
      deviceId: view.deviceId,
      lastSeen: view.lastSeen,
      location: frozen({
        status: LOCATED_REDACTED,
        observationId,
        observedAt,
        staleness,
        fromRecordId,
        redactionReason,
      }),
    }),
  };
}

/**
 * The deterministic digest of a minimized view's CONTENT (identity
 * fields excluded) — FNV-1a over canonical JSON (never for security).
 * Two projections of structurally equal inputs are byte-identical.
 */
export function minimizedViewContentDigest(view: MinimizedFindMyDeviceView): string {
  return fnv1a32Hex(
    canonicalJson([
      view.tenantId,
      view.deviceId,
      view.lastSeen ?? null,
      view.location,
    ]),
  );
}
