/**
 * @fleetos/web-recovery — D2: the recovery case surface (W040).
 *
 * The recovery case view-model: the versioned case record surfaced
 * READ-ONLY with its PROPOSAL-gated transition state machine made
 * VISIBLE. The transition table is INJECTED (`StatusMachineTable` —
 * the REAL `RECOVERY_CASE_TRANSITIONS` + terminal + active statuses at
 * the binding site), so the surface can never drift from the domain's
 * frozen tables; every transition remains the domain boundary's
 * decision — the surface only displays the current state, the legal
 * continuations, the append-only version history, the evidence basis,
 * and the machine-stable closure reason.
 *
 * The gated boundary is surfaced explicitly: `gating.acceptsDestructive`
 * shows whether the case is in an ACTIVE recovery state — the
 * precondition the W040 destructive gate enforces before any
 * lock/locate/wipe/reboot request is even recorded. Making the gate
 * visible is the LOCK item 19 duty of this surface.
 *
 * PURE + DETERMINISTIC: no clock, no randomness, no I/O. No `any` in
 * public signatures. Strict TS.
 */

import { SYNTHETIC_SYSTEM_TENANT, checkRecoveryUiTenantScope, frozen, frozenArray } from "./internal";
import type { RecoveryUiTenantScope } from "./internal";
import type { RecoveryCaseLike, RecoveryCaseSource, StatusMachineTable } from "./seams";
import type { DeviceId, TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The case state machine surface (read-only, injected table)
// ---------------------------------------------------------------------------

/**
 * The READ-ONLY case state machine view: the current status, the legal
 * next statuses (per the INJECTED domain transition table), the
 * terminal + active + parked flags, and the table snapshot. The view
 * never proposes or performs a transition.
 */
export interface CaseStateMachineView {
  readonly current: string;
  readonly legalNext: readonly string[];
  readonly isTerminal: boolean;
  /** Is the case in an ACTIVE recovery state (the destructive-gate precondition)? */
  readonly isActive: boolean;
  /** The statuses the domain marks active (verbatim, read-only). */
  readonly activeStatuses: readonly string[];
  /** The statuses the domain marks terminal (verbatim, read-only). */
  readonly terminalStatuses: readonly string[];
  /** The full injected transition table (read-only snapshot). */
  readonly transitions: Readonly<Record<string, readonly string[]>>;
}

/** Derive the read-only machine view for a status + injected table. PURE. */
export function caseStateMachineView(status: string, table: StatusMachineTable): CaseStateMachineView {
  const legalNext = table.transitions[status] ?? [];
  return frozen({
    current: status,
    legalNext: frozenArray(legalNext as readonly string[]),
    isTerminal: table.terminal.includes(status),
    isActive: (table.active ?? []).includes(status),
    activeStatuses: frozenArray(table.active ?? []),
    terminalStatuses: frozenArray(table.terminal),
    transitions: table.transitions,
  });
}

// ---------------------------------------------------------------------------
// The case view-model
// ---------------------------------------------------------------------------

/** The read-only trigger block. */
export interface CaseTriggerView {
  readonly kind: string;
  readonly reportedAt: string | undefined;
  readonly postureStatus: string | undefined;
  readonly findingRefCount: number;
  readonly note: string | undefined;
}

/** The read-only evidence basis (typed refs, opaque). */
export interface CaseEvidenceView {
  readonly lastSeenRecordId: string | undefined;
  readonly lastSeenObservedAt: string | undefined;
  readonly postureFindingRefs: readonly string[];
}

/** One append-only case revision, surfaced read-only. */
export interface CaseRevisionView {
  readonly version: number;
  readonly recordId: string;
  readonly status: string;
  readonly transitionedAt: string | undefined;
  readonly closureReason: string | undefined;
  readonly contentDigest: string;
}

/**
 * The recovery case view-model: the current revision + the read-only
 * state machine + the versioned history + the evidence basis + the
 * closure block + the visible destructive-gate precondition.
 */
export interface RecoveryCaseViewModel {
  readonly tenantId: TenantId | typeof SYNTHETIC_SYSTEM_TENANT;
  readonly caseId: string;
  readonly deviceId: DeviceId;
  readonly version: number;
  readonly status: string;
  readonly stateMachine: CaseStateMachineView;
  readonly trigger: CaseTriggerView;
  readonly evidenceBasis: CaseEvidenceView;
  readonly history: readonly CaseRevisionView[];
  readonly closure: { readonly reason: string; readonly closedAt: string } | undefined;
  /** The VISIBLE gated boundary: does this case accept destructive requests? */
  readonly gating: { readonly acceptsDestructive: boolean };
}

/**
 * Build the recovery case view-model. PURE and DETERMINISTIC. The
 * source is the INJECTED structural seam (the REAL case store at the
 * binding site); the transition table is INJECTED (the REAL frozen
 * domain table). Returns `undefined` when the case is not in the
 * acting tenant's partition (no existence side channel).
 *
 * @param scope the acting tenant scope (FIRST parameter)
 * @param source the injected recovery-case source
 * @param caseId the case to surface
 * @param table the injected status-machine table (the domain's frozen tables)
 * @returns the case view-model, or undefined when absent
 */
export function buildRecoveryCaseViewModel(
  scope: RecoveryUiTenantScope,
  source: RecoveryCaseSource,
  caseId: string,
  table: StatusMachineTable,
): RecoveryCaseViewModel | undefined {
  const guard = checkRecoveryUiTenantScope(scope);
  if (!guard.ok) return undefined;
  const latest = source.latest(guard.tenantId, caseId);
  if (latest === undefined) return undefined;
  const history = source.history(guard.tenantId, caseId);

  const closure =
    latest.closureReason !== undefined && latest.closedAt !== undefined
      ? frozen({ reason: latest.closureReason, closedAt: latest.closedAt })
      : undefined;

  return frozen({
    tenantId: guard.tenantId,
    caseId: latest.caseId,
    deviceId: latest.deviceId,
    version: latest.version,
    status: latest.status,
    stateMachine: caseStateMachineView(latest.status, table),
    trigger: frozen({
      kind: latest.trigger.kind,
      reportedAt: latest.trigger.reportedAt,
      postureStatus: latest.trigger.postureStatus,
      findingRefCount: latest.trigger.findingRefs?.length ?? 0,
      note: latest.trigger.note,
    }),
    evidenceBasis: frozen({
      lastSeenRecordId: latest.evidence.lastSeenRecordId,
      lastSeenObservedAt: latest.evidence.lastSeenObservedAt,
      postureFindingRefs: frozenArray(latest.evidence.postureFindingRefs),
    }),
    history: frozenArray(
      [...history]
        .sort((a, b) => a.version - b.version)
        .map((revision) =>
          frozen({
            version: revision.version,
            recordId: revision.recordId,
            status: revision.status,
            transitionedAt: revision.transitionedAt,
            closureReason: revision.closureReason,
            contentDigest: revision.contentDigest,
          }),
        ),
    ),
    closure,
    gating: frozen({
      acceptsDestructive: caseStateMachineView(latest.status, table).isActive,
    }),
  });
}

/**
 * The recovery case LIST view-model: every latest case revision in the
 * acting tenant's partition, deterministically ordered — PARKED-style
 * attention first (cases still in an active recovery state), then by
 * (openedAt desc? NO — deterministic simple order: active first, then
 * caseId ascending). Active cases first makes the recovery effort
 * visible; within a band, caseId order is total and stable.
 */
export interface RecoveryCaseListViewModel {
  readonly tenantId: TenantId | typeof SYNTHETIC_SYSTEM_TENANT;
  readonly cases: readonly {
    readonly caseId: string;
    readonly deviceId: DeviceId;
    readonly version: number;
    readonly status: string;
    readonly triggerKind: string;
    readonly openedAt: string;
    readonly isActive: boolean;
    readonly isTerminal: boolean;
  }[];
  readonly counts: {
    readonly total: number;
    readonly active: number;
    readonly closed: number;
  };
}

/**
 * Build the case list view-model. PURE and DETERMINISTIC: active cases
 * first (the visible recovery effort), then caseId ascending; a
 * refused scope yields the deterministic empty list.
 */
export function buildRecoveryCaseListViewModel(
  scope: RecoveryUiTenantScope,
  source: RecoveryCaseSource,
  table: StatusMachineTable,
): RecoveryCaseListViewModel {
  const guard = checkRecoveryUiTenantScope(scope);
  if (!guard.ok) {
    return frozen({
      tenantId: SYNTHETIC_SYSTEM_TENANT,
      cases: frozenArray([]),
      counts: frozen({ total: 0, active: 0, closed: 0 }),
    });
  }
  const latest = source.list(guard.tenantId);
  const rows = [...latest]
    .sort((a, b) => {
      const activeDelta =
        Number((table.active ?? []).includes(b.status)) - Number((table.active ?? []).includes(a.status));
      if (activeDelta !== 0) return activeDelta;
      return a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0;
    })
    .map((caseRecord) =>
      frozen({
        caseId: caseRecord.caseId,
        deviceId: caseRecord.deviceId,
        version: caseRecord.version,
        status: caseRecord.status,
        triggerKind: caseRecord.trigger.kind,
        openedAt: caseRecord.openedAt,
        isActive: (table.active ?? []).includes(caseRecord.status),
        isTerminal: table.terminal.includes(caseRecord.status),
      }),
    );
  return frozen({
    tenantId: guard.tenantId,
    cases: frozenArray(rows),
    counts: frozen({
      total: rows.length,
      active: rows.filter((row) => row.isActive).length,
      closed: rows.filter((row) => row.status === "CLOSED").length,
    }),
  });
}
