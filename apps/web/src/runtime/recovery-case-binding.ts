/**
 * @fleetos/web — W148: the session-scoped RECOVERY-CASE store + factory
 * (the O5 case-creation affordance's binding).
 *
 * The W141 lane shipped the per-case seven-stage journey + the typed-CONFIRM
 * destructive gate (the surface's honest refusal without an active case is
 * LOCK 16's law — never an ungated path). What the composed runtime was
 * missing is the BINDING: a session-scoped recovery-case store (the demo
 * tier's in-memory truth; the deployed tier's server-plane persistence
 * arrives with the W140 server-route lane), and the case-creation factory
 * that produces a REAL `RecoveryCaseLike` (the W040 record pattern) over
 * the acting tenant's selected device.
 *
 * The case is the durable context that gates every destructive recovery
 * action; creating one is a PROPOSAL (never an execution). The destructive
 * gate stays honest — it refuses without an active case; the typed-CONFIRM
 * gate becomes reachable when a case exists.
 *
 * PURE + DETERMINISTIC: no clock (every instant injected), no I/O, no `any`
 * in public signatures. Strict TS.
 */
import { asCorrelationId, asDeviceId, asTenantId } from "@fleetos/contracts";
import type { CorrelationId, DeviceId, TenantId } from "@fleetos/contracts";
import type {
  RecoveryCaseLike,
  RecoveryCaseSource,
  RecoveryTriggerLike,
  RecoveryCaseEvidenceLike,
} from "@fleetos/web-recovery";

// ---------------------------------------------------------------------------
// The session-scoped recovery-case store
// ---------------------------------------------------------------------------

/**
 * The session-scoped recovery-case store: an in-memory append-only store
 * the demo tier shares; fresh workspaces get their own. One store per
 * active session (per tenant). The store satisfies `RecoveryCaseSource`
 * structurally (`list` / `history` / `latest` — all tenant-partitioned;
 * a foreign tenant never observes another tenant's cases — the W122
 * isolation law).
 */
export interface SessionRecoveryCaseStore {
  /** The tenant scope (every read is bound to it). */
  readonly tenantId: TenantId;
  /** The recorded cases (append-only; the latest revision per caseId). */
  readonly cases: readonly RecoveryCaseLike[];
  /**
   * Append a new case revision (PURE: returns a new store with the
   * revision added). The case's `version` increments on each append
   * for the same caseId.
   */
  append(revision: RecoveryCaseLike): SessionRecoveryCaseStore;
}

/** An empty session store (the fresh-session state). */
export function createSessionRecoveryCaseStore(tenantId: TenantId): SessionRecoveryCaseStore {
  return {
    tenantId,
    cases: Object.freeze([]) as readonly RecoveryCaseLike[],
    append(revision: RecoveryCaseLike): SessionRecoveryCaseStore {
      return {
        tenantId,
        cases: Object.freeze([...this.cases, revision]) as readonly RecoveryCaseLike[],
        append: this.append,
      };
    },
  };
}

/**
 * Adapt the session store to the recovery feed's `RecoveryCaseSource`
 * seam (structurally — the lane package's frozen interface).
 */
export function sessionRecoveryCaseSource(
  store: SessionRecoveryCaseStore,
): RecoveryCaseSource {
  return {
    list: (tenantId: TenantId): readonly RecoveryCaseLike[] => {
      if (tenantId !== store.tenantId) return [];
      // The latest revision per caseId, deterministic order (caseId asc).
      const latest = new Map<string, RecoveryCaseLike>();
      for (const revision of store.cases) {
        if (revision.tenantId !== tenantId) continue;
        const existing = latest.get(revision.caseId);
        if (existing === undefined || revision.version > existing.version) {
          latest.set(revision.caseId, revision);
        }
      }
      return [...latest.values()].sort((a, b) =>
        a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0,
      );
    },
    history: (tenantId: TenantId, caseId: string): readonly RecoveryCaseLike[] => {
      if (tenantId !== store.tenantId) return [];
      return store.cases
        .filter((revision) => revision.tenantId === tenantId && revision.caseId === caseId)
        .sort((a, b) => a.version - b.version);
    },
    latest: (tenantId: TenantId, caseId: string): RecoveryCaseLike | undefined => {
      if (tenantId !== store.tenantId) return undefined;
      const revisions = store.cases.filter(
        (revision) => revision.tenantId === tenantId && revision.caseId === caseId,
      );
      if (revisions.length === 0) return undefined;
      return revisions.reduce((acc, revision) =>
        revision.version > acc.version ? revision : acc,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The case-creation factory (the REAL W040 record pattern)
// ---------------------------------------------------------------------------

/** The case-creation input (the binding site supplies these from the session). */
export interface CreateRecoveryCaseInput {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  /** The case id (deterministic — the binding site derives it). */
  readonly caseId: string;
  /** The trigger kind (lost-device / posture-escalation — machine-stable). */
  readonly triggerKind: string;
  /** The trigger's reported-at instant (the lost-device report / escalation). */
  readonly triggerReportedAt: string;
  /** The trigger's note (operator-supplied; machine-stable). */
  readonly triggerNote?: string;
  /** The case's opened-at instant (injected). */
  readonly openedAt: string;
  /** The correlation id (the audit trail's join key). */
  readonly correlationId: CorrelationId;
}

/**
 * The case-creation factory: produces a REAL `RecoveryCaseLike` (the
 * W040 record pattern) over the acting tenant's selected device. The
 * case enters the OPEN status (the active-recovery state that gates
 * destructive requests). The factory is PURE — it never performs I/O,
 * never writes to the store (the binding site's `append` does that).
 *
 * The trigger's evidence basis is honest: an empty evidence ledger
 * until location-bearing observations arrive (LOCK 16: an absence of
 * evidence is never treated as freshness).
 */
export function createRecoveryCase(input: CreateRecoveryCaseInput): RecoveryCaseLike {
  const trigger: RecoveryTriggerLike = {
    kind: input.triggerKind,
    reportedAt: input.triggerReportedAt,
    postureStatus: undefined,
    findingRefs: [],
    note: input.triggerNote,
  };
  const evidence: RecoveryCaseEvidenceLike = {
    lastSeenRecordId: undefined,
    lastSeenObservedAt: undefined,
    postureFindingRefs: [],
  };
  return {
    caseId: input.caseId,
    recordId: `${input.caseId}-v1`,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    version: 1,
    status: "OPEN",
    trigger,
    evidence,
    openedAt: input.openedAt,
    transitionedAt: input.openedAt,
    contentDigest: `w148-${input.caseId}-${input.openedAt}`,
  };
}

/**
 * The deterministic case-id derivation (the binding site uses this so
 * the demo tier's case ids are stable across re-dispatches).
 */
export function recoveryCaseId(
  tenantId: TenantId,
  deviceId: DeviceId,
  at: string,
): string {
  // Strip non-alphanumerics from the device id + the instant for a
  // deterministic, machine-stable case id.
  const slug = (deviceId as string).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const stamp = at.replace(/[^0-9]/g, "").slice(0, 14);
  return `case_w148_${slug}_${stamp}`;
}

// ---------------------------------------------------------------------------
// The convenience factory (the binding site's single call)
// ---------------------------------------------------------------------------

/**
 * Create a recovery case AND append it to the session store. The
 * binding site (the console runtime) calls this from the case-creation
 * affordance's click handler. Returns the new store + the new case.
 */
export function createAndAppendRecoveryCase(
  store: SessionRecoveryCaseStore,
  input: Omit<CreateRecoveryCaseInput, "caseId" | "correlationId">,
): { readonly store: SessionRecoveryCaseStore; readonly caseRecord: RecoveryCaseLike } {
  const caseId = recoveryCaseId(input.tenantId, input.deviceId, input.openedAt);
  const correlationId = asCorrelationId(`cor_w148_${caseId}`);
  const caseRecord = createRecoveryCase({
    ...input,
    caseId,
    correlationId,
  });
  return { store: store.append(caseRecord), caseRecord };
}

// Re-export the type helpers for the binding site.
export type { DeviceId, TenantId };
export { asDeviceId, asTenantId };
