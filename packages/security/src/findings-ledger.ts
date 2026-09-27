/**
 * @fleetos/security — D1/D4: the append-only posture findings ledger.
 *
 * Versioned-interpretation discipline (`spec/ARCHITECTURE-LOCK.md`
 * item 3): the ledger is APPEND-ONLY. Re-assessment appends NEW finding
 * records (the derivation stamps interpretationVersion = prior + 1 and
 * `supersedes` links); dismissal appends a dismissal entry. An existing
 * record is NEVER rewritten or removed — the ledger functions return
 * new state, and every record is frozen.
 *
 * The ACTIVE view (`resolveActiveFindings`) is DERIVED, never stored:
 * the latest finding record per finding identity, minus identities
 * whose LATEST entry is a dismissal. A re-derived finding after a
 * dismissal becomes active again at the next version — observable
 * evidence wins; the dismissal remains in history.
 *
 * Tenant isolation is BY CONSTRUCTION (W012's pattern, declared locally
 * because `@fleetos/identity` is worker-c's lane):
 *   - every operation takes the acting `SecurityTenantScope` as its
 *     FIRST parameter;
 *   - the runtime guard `checkSecurityTenantScope` rejects context-free
 *     and invalid-tenant access even when the types are bypassed;
 *   - storage is partitioned per tenant then per device; NO operation
 *     accepts a tenant override — a tenant-A scope can never read
 *     tenant-B findings. A finding/device that exists only in another
 *     tenant's partition is indistinguishable from an unknown one.
 *
 * Audit (D4): every posture-finding MUTATION emits an append-only audit
 * record to the injected sink — a finding recorded (version 1), a
 * finding superseded (version > 1), a finding dismissed. Pure reads and
 * the derived active view never audit.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { asTenantId } from "@fleetos/contracts";
import type { CorrelationId, DeviceId, FleetError, TenantId } from "@fleetos/contracts";
import type { SecurityAuditSink } from "./audit-seam";
import { NOOP_SECURITY_AUDIT_SINK, SECURITY_AUDIT_ACTIONS } from "./audit-seam";
import type { SecurityFinding } from "./posture";
import type { SecurityTenantScope } from "./internal";
import {
  ERROR_CODES,
  SECURITY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  checkSecurityTenantScope,
  frozen,
  frozenArray,
  makeDomainError,
} from "./internal";

// ---------------------------------------------------------------------------
// Ledger entries
// ---------------------------------------------------------------------------

/** A finding-record entry (a versioned interpretation). */
export interface FindingRecordEntry {
  readonly kind: "finding";
  readonly finding: SecurityFinding;
}

/** A machine-stable dismissal of a finding identity. */
export interface FindingDismissal {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device whose finding is dismissed. */
  readonly deviceId: DeviceId;
  /** The stable finding identity being dismissed. */
  readonly findingId: string;
  /** ISO 8601 dismissal timestamp (injected). */
  readonly at: string;
  /** Machine-stable reason (e.g. "remediated", "false_positive", "risk_accepted"). */
  readonly reason: string;
  /** The correlation id of the dismissal request. */
  readonly correlationId: CorrelationId;
}

/** A dismissal entry. */
export interface FindingDismissalEntry {
  readonly kind: "dismissal";
  readonly dismissal: FindingDismissal;
}

/** An entry in the append-only findings ledger. */
export type FindingsLedgerEntry = FindingRecordEntry | FindingDismissalEntry;

// ---------------------------------------------------------------------------
// The ledger contract
// ---------------------------------------------------------------------------

/** Options for a findings-recording operation. */
export interface RecordFindingsOptions {
  /** The injected record timestamp. */
  readonly at: string;
  /** The correlation id of the recording request. */
  readonly correlationId: CorrelationId;
  /** An injected audit sink override (default: the ledger's sink). */
  readonly auditSink?: SecurityAuditSink;
}

/** Options for a dismissal operation. */
export interface DismissFindingOptions {
  /** The injected dismissal timestamp. */
  readonly at: string;
  /** The machine-stable dismissal reason. */
  readonly reason: string;
  /** The correlation id of the dismissal request. */
  readonly correlationId: CorrelationId;
  /** An injected audit sink override (default: the ledger's sink). */
  readonly auditSink?: SecurityAuditSink;
}

/** The tagged result of a ledger write. */
export type FindingsLedgerWrite =
  | { readonly ok: true; readonly recorded: readonly SecurityFinding[] }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The tenant-scoped, append-only posture findings ledger. Every
 * operation takes the acting `SecurityTenantScope` as its FIRST
 * parameter and touches only the acting tenant's partition.
 */
export interface PostureFindingsLedger {
  /**
   * Append derived findings to the ACTING tenant's per-device ledger.
   * Version discipline: a finding whose identity has a prior record MUST
   * arrive at prior + 1 (the derivation stamps this from history); a new
   * identity MUST arrive at version 1. Nothing is ever rewritten.
   */
  recordFindings(
    scope: SecurityTenantScope,
    deviceId: DeviceId,
    findings: readonly SecurityFinding[],
    options: RecordFindingsOptions,
  ): FindingsLedgerWrite;
  /** Append a dismissal entry (the finding stays in history). */
  dismissFinding(
    scope: SecurityTenantScope,
    deviceId: DeviceId,
    findingId: string,
    options: DismissFindingOptions,
  ): FindingsLedgerWrite;
  /** The full append-only entry history (own partition only), append order. */
  listEntries(scope: SecurityTenantScope, deviceId: DeviceId): readonly FindingsLedgerEntry[];
  /** The DERIVED active findings: latest version per identity, minus dismissed. */
  resolveActiveFindings(scope: SecurityTenantScope, deviceId: DeviceId): readonly SecurityFinding[];
  /** The number of entries (records + dismissals) in the acting partition's device ledger. */
  size(scope: SecurityTenantScope, deviceId: DeviceId): number;
}

/** Options for the in-memory ledger. */
export interface InMemoryPostureFindingsLedgerOptions {
  /** The injected audit sink (default: no-op). */
  readonly auditSink?: SecurityAuditSink;
}

/**
 * Create the in-memory reference `PostureFindingsLedger`. Storage is
 * partitioned by tenant id, then by device id; entries are append-only.
 *
 * @param opts the ledger options
 * @returns a frozen PostureFindingsLedger
 */
export function createInMemoryPostureFindingsLedger(
  opts: InMemoryPostureFindingsLedgerOptions = {},
): PostureFindingsLedger {
  /** tenantId -> (deviceId -> entries, append order). */
  const partitions = new Map<string, Map<string, FindingsLedgerEntry[]>>();
  const sink: SecurityAuditSink = opts.auditSink ?? NOOP_SECURITY_AUDIT_SINK;

  function deviceLedger(tenantId: string, deviceId: string): FindingsLedgerEntry[] {
    let tenantPartition = partitions.get(tenantId);
    if (tenantPartition === undefined) {
      tenantPartition = new Map<string, FindingsLedgerEntry[]>();
      partitions.set(tenantId, tenantPartition);
    }
    let entries = tenantPartition.get(deviceId);
    if (entries === undefined) {
      entries = [];
      tenantPartition.set(deviceId, entries);
    }
    return entries;
  }

  function guarded(
    scope: SecurityTenantScope,
  ): { ok: true; tenantId: string } | { ok: false; error: FleetError } {
    const check = checkSecurityTenantScope(scope);
    if (!check.ok) {
      return {
        ok: false,
        error: makeDomainError(
          ERROR_CODES.ledgerDomain,
          `findings ledger refused access (${check.reason}: ${check.detail})`,
          { tenantId: SYNTHETIC_SYSTEM_TENANT, correlationId: SECURITY_PIPELINE_CORRELATION_ID },
          "security.findings.ledger",
          check.reason,
        ),
      };
    }
    return { ok: true, tenantId: check.tenantId };
  }

  function latestVersionOf(entries: readonly FindingsLedgerEntry[], findingId: string): number {
    let latest = 0;
    for (const entry of entries) {
      if (entry.kind === "finding" && entry.finding.findingId === findingId) {
        if (entry.finding.interpretationVersion > latest) {
          latest = entry.finding.interpretationVersion;
        }
      }
    }
    return latest;
  }

  return frozen({
    recordFindings(
      scope: SecurityTenantScope,
      deviceId: DeviceId,
      findings: readonly SecurityFinding[],
      options: RecordFindingsOptions,
    ): FindingsLedgerWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      const trace = {
        tenantId: asTenantId(tenantId),
        correlationId: options.correlationId,
      };
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.ledgerDomain,
            "findings recording requires a device id",
            trace,
            "security.findings.ledger",
            "device_required",
          ),
        };
      }
      if (!Array.isArray(findings)) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.ledgerDomain,
            "findings recording requires a findings array",
            trace,
            "security.findings.ledger",
            "findings_required",
          ),
        };
      }
      for (let i = 0; i < findings.length; i++) {
        const finding = findings[i];
        if (
          typeof finding?.tenantId !== "string" ||
          finding.tenantId !== tenantId ||
          finding.deviceId !== deviceId
        ) {
          return {
            ok: false,
            error: makeDomainError(
              ERROR_CODES.ledgerDomain,
              "finding tenant/device does not match the acting scope",
              trace,
              "security.findings.ledger",
              "tenant_or_device_mismatch",
            ),
          };
        }
      }
      const entries = deviceLedger(tenantId, deviceId);
      const recorded: SecurityFinding[] = [];
      for (const finding of findings) {
        const priorVersion = latestVersionOf(entries, finding.findingId);
        if (finding.interpretationVersion !== priorVersion + 1) {
          return {
            ok: false,
            error: makeDomainError(
              ERROR_CODES.ledgerDomain,
              `finding ${finding.findingId} must arrive at interpretation version ${priorVersion + 1} (got ${finding.interpretationVersion})`,
              trace,
              "security.findings.ledger",
              "version_out_of_sequence",
            ),
          };
        }
      }
      for (const finding of findings) {
        entries.push(frozen({ kind: "finding", finding }));
        recorded.push(finding);
        const emittingSink = options.auditSink ?? sink;
        emittingSink.append(
          frozen({
            action:
              finding.interpretationVersion > 1
                ? SECURITY_AUDIT_ACTIONS.findingSuperseded
                : SECURITY_AUDIT_ACTIONS.findingRecorded,
            tenantId: finding.tenantId,
            subject: finding.deviceId,
            occurredAt: options.at,
            correlationId: options.correlationId,
            details: frozen({
              findingId: finding.findingId,
              recordId: finding.recordId,
              code: finding.code,
              severity: finding.severity,
              classification: finding.classification,
              interpretationVersion: finding.interpretationVersion,
              supersedes: finding.supersedes,
              evidenceCount: finding.evidence.length,
              remediationProposed: finding.remediation !== undefined,
            }),
          }),
        );
      }
      return { ok: true, recorded: frozenArray(recorded) };
    },
    dismissFinding(
      scope: SecurityTenantScope,
      deviceId: DeviceId,
      findingId: string,
      options: DismissFindingOptions,
    ): FindingsLedgerWrite {
      const guard = guarded(scope);
      if (!guard.ok) return guard;
      const tenantId = guard.tenantId;
      const trace = {
        tenantId: asTenantId(tenantId),
        correlationId: options.correlationId,
      };
      if (typeof deviceId !== "string" || deviceId.length === 0 || typeof findingId !== "string" || findingId.length === 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.ledgerDomain,
            "finding dismissal requires a device id and a finding id",
            trace,
            "security.findings.ledger",
            "device_and_finding_required",
          ),
        };
      }
      if (typeof options.reason !== "string" || options.reason.length === 0) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.ledgerDomain,
            "finding dismissal requires a machine-stable reason",
            trace,
            "security.findings.ledger",
            "reason_required",
          ),
        };
      }
      const entries = deviceLedger(tenantId, deviceId);
      // A finding identity that exists only in another tenant's (or
      // device's) partition is indistinguishable from an unknown one —
      // no existence side channel. Dismissing an unknown identity is
      // still recorded (the dismissal is an assertion about the future
      // active view), but an identity that was never seen is rejected:
      // dismissals reference recorded findings only.
      const known = entries.some(
        (entry) => entry.kind === "finding" && entry.finding.findingId === findingId,
      );
      if (!known) {
        return {
          ok: false,
          error: makeDomainError(
            ERROR_CODES.ledgerDomain,
            "finding identity not found in the acting partition (unknown or foreign)",
            trace,
            "security.findings.ledger",
            "finding_unknown",
          ),
        };
      }
      const dismissal: FindingDismissal = frozen({
        tenantId: asTenantId(tenantId),
        deviceId,
        findingId,
        at: options.at,
        reason: options.reason,
        correlationId: options.correlationId,
      });
      entries.push(frozen({ kind: "dismissal", dismissal }));
      const emittingSink = options.auditSink ?? sink;
      emittingSink.append(
        frozen({
          action: SECURITY_AUDIT_ACTIONS.findingDismissed,
          tenantId: dismissal.tenantId,
          subject: dismissal.deviceId,
          occurredAt: options.at,
          correlationId: options.correlationId,
          details: frozen({
            findingId,
            reason: options.reason,
          }),
        }),
      );
      return { ok: true, recorded: [] };
    },
    listEntries(scope: SecurityTenantScope, deviceId: DeviceId): readonly FindingsLedgerEntry[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const tenantPartition = partitions.get(guard.tenantId);
      const entries = tenantPartition?.get(deviceId);
      return entries ? frozenArray(entries) : [];
    },
    resolveActiveFindings(scope: SecurityTenantScope, deviceId: DeviceId): readonly SecurityFinding[] {
      const guard = guarded(scope);
      if (!guard.ok) return [];
      const tenantPartition = partitions.get(guard.tenantId);
      const entries = tenantPartition?.get(deviceId) ?? [];
      const latest = new Map<string, SecurityFinding>();
      const dismissed = new Set<string>();
      for (const entry of entries) {
        if (entry.kind === "finding") {
          const prior = latest.get(entry.finding.findingId);
          if (prior === undefined || entry.finding.interpretationVersion > prior.interpretationVersion) {
            latest.set(entry.finding.findingId, entry.finding);
          }
          dismissed.delete(entry.finding.findingId); // a newer record re-activates.
        } else {
          dismissed.add(entry.dismissal.findingId);
        }
      }
      const active: SecurityFinding[] = [];
      for (const [findingId, finding] of latest) {
        if (!dismissed.has(findingId)) active.push(finding);
      }
      // Deterministic order: severity rank desc, code asc, findingId asc.
      const severityRank = (severity: SecurityFinding["severity"]): number =>
        ({ CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 })[severity];
      active.sort((a, b) => {
        const rankDiff = severityRank(b.severity) - severityRank(a.severity);
        if (rankDiff !== 0) return rankDiff;
        if (a.code !== b.code) return a.code < b.code ? -1 : 1;
        return a.findingId < b.findingId ? -1 : 1;
      });
      return frozenArray(active);
    },
    size(scope: SecurityTenantScope, deviceId: DeviceId): number {
      const guard = guarded(scope);
      if (!guard.ok) return 0;
      return partitions.get(guard.tenantId)?.get(deviceId)?.length ?? 0;
    },
  });
}
