/**
 * @fleetos/integration-aurum — the emission boundary (D1/D3/D4).
 *
 * The ONLY place a communication intent becomes an emitted message:
 *
 *   1. the acting `TenantContext` is guarded (context-free and
 *      invalid-tenant access rejected even with the types bypassed);
 *   2. the intent is appended to the tenant-partitioned outbox ledger
 *      (idempotent by message identity; tamper-guarded by digest);
 *   3. an ACTUAL append (not an idempotent duplicate) is handed to the
 *      INJECTED transport seam (transport.ts — no real network I/O);
 *   4. consequential mutations audit through the INJECTED audit sink:
 *      `aurum.redaction.applied` when redaction fired, then
 *      `aurum.message.emitted` for the append; a REFUSAL audits
 *      `aurum.message.refused` carrying the machine-stable invariant.
 *
 * This boundary performs NO FleetOS domain mutation: it touches ONLY
 * the aurum adapter's own outbox ledger, the injected transport seam
 * and the injected audit sink. The authority boundary (AURUM.md:
 * "Aurum ... cannot mutate FleetOS truth") is enforced by construction
 * and asserted by the authority-boundary test.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 * No clock reads: `intent.emittedAt` was injected at build time.
 */

import type { CorrelationId, DomainError, FleetError, TenantId } from "@fleetos/contracts";
import type { TenantContext } from "@fleetos/identity";
import { requireTenantContext } from "@fleetos/identity";
import type { AurumAuditSink } from "./audit-seam";
import { AURUM_AUDIT_ACTIONS, NOOP_AURUM_AUDIT_SINK } from "./audit-seam";
import type { CommunicationIntent } from "./intents";
import type { EmissionTransport, TransportAcceptance } from "./transport";
import { toTransportEmission } from "./transport";
import type { OutboxAppendResult, OutboxEntry, OutboxLedger } from "./outbox";
import { AURUM_PIPELINE_CORRELATION_ID, SYNTHETIC_SYSTEM_TENANT_ID, frozen } from "./internal";

/** Options for `emitCommunicationMessage`. */
export interface EmissionOptions {
  /** The injected audit sink (consequential mutations emit; default: no-op). */
  readonly auditSink?: AurumAuditSink;
  /**
   * The injected emission transport (default: a refusing transport — an
   * unbound emission is never silently "delivered"; the outbox append
   * still records the intent). Inject the in-memory reference or a real
   * connector at the binding site.
   */
  readonly transport?: EmissionTransport;
}

/** The tagged result of an emission. */
export type EmissionResult =
  | {
      readonly ok: true;
      /** The outbox entry (freshly appended, or the prior entry when duplicate). */
      readonly entry: OutboxEntry;
      /** True when the append was an idempotent duplicate (nothing mutated). */
      readonly duplicate: boolean;
      /** The transport's acceptance (null when the emission was a duplicate — the transport is never re-invoked). */
      readonly acceptance: TransportAcceptance | null;
    }
  | { readonly ok: false; readonly error: FleetError };

/** The machine-stable refusal reason of the default (unbound) transport. */
export const UNBOUND_TRANSPORT_REFUSAL_REASON = "transport_not_bound" as const;

/** The default transport when none is injected: refuse deterministically. */
const UNBOUND_TRANSPORT: EmissionTransport = frozen({
  deliver: (_emission): TransportAcceptance =>
    frozen({ accepted: false, reason: UNBOUND_TRANSPORT_REFUSAL_REASON }),
});

/** The machine-stable emission refusal (a frozen DomainError). */
function emissionRefusal(
  tenantId: TenantId,
  correlationId: CorrelationId,
  message: string,
  invariant: string,
): DomainError {
  return frozen({
    kind: "DomainError",
    code: "aurum.emission.domain",
    message,
    tenantId,
    correlationId,
    domain: "aurum.emission",
    invariant,
  });
}

/** A non-empty-string check on an unknown-typed candidate. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The intent's correlation id, or the pipeline sentinel when absent. */
function correlationOf(intent: CommunicationIntent | undefined): CorrelationId {
  return isNonEmptyString(intent?.correlationId) ? intent.correlationId : AURUM_PIPELINE_CORRELATION_ID;
}

/**
 * Emit a communication message (the aurum boundary).
 *
 * Order of operations (deterministic): guard the context → append to the
 * outbox (idempotent; tamper-guarded) → on an ACTUAL append, deliver
 * through the injected transport → audit the consequential mutations.
 * A duplicate append (same identity, same digest) skips BOTH the
 * transport call and the audit emissions — nothing mutated, nothing
 * re-sent (idempotency by construction).
 *
 * @param ctx the acting tenant context (guarded)
 * @param outbox the outbox ledger (the adapter's OWN ledger)
 * @param intent the built communication intent (pure builder output)
 * @param options the injected sink + transport
 * @returns the tagged emission result
 */
export function emitCommunicationMessage(
  ctx: TenantContext,
  outbox: OutboxLedger,
  intent: CommunicationIntent,
  options: EmissionOptions = {},
): EmissionResult {
  let tenantId: TenantId;
  try {
    tenantId = requireTenantContext(ctx);
  } catch (err) {
    return {
      ok: false,
      error: emissionRefusal(
        SYNTHETIC_SYSTEM_TENANT_ID,
        correlationOf(intent),
        `emission refused: acting context rejected (${
          err instanceof Error ? err.message : String(err)
        })`,
        "acting_context_invalid",
      ),
    };
  }
  const correlationId = correlationOf(intent);
  const auditSink: AurumAuditSink = options.auditSink ?? NOOP_AURUM_AUDIT_SINK;
  const transport: EmissionTransport = options.transport ?? UNBOUND_TRANSPORT;

  let append: OutboxAppendResult;
  try {
    append = outbox.append(ctx, intent);
  } catch (err) {
    return {
      ok: false,
      error: emissionRefusal(
        tenantId,
        correlationId,
        `emission refused: outbox append threw (${err instanceof Error ? err.message : String(err)})`,
        "outbox_append_failed",
      ),
    };
  }
  if (!append.ok) {
    auditSink.append(
      frozen({
        tenantId,
        action: AURUM_AUDIT_ACTIONS.messageRefused,
        subject: isNonEmptyString(intent?.messageId) ? intent.messageId : null,
        occurredAt: isNonEmptyString(intent?.emittedAt) ? intent.emittedAt : "1970-01-01T00:00:00Z",
        correlationId,
        details: frozen({
          reason:
            append.error.kind === "DomainError" ? append.error.invariant ?? "outbox_refused" : "outbox_refused",
          kind: isNonEmptyString(intent?.kind) ? intent.kind : null,
        }),
      }),
    );
    return {
      ok: false,
      error: emissionRefusal(
        tenantId,
        correlationId,
        `emission refused: ${append.error.message}`,
        append.error.kind === "DomainError" ? append.error.invariant ?? "outbox_refused" : "outbox_refused",
      ),
    };
  }

  if (append.duplicate) {
    // Idempotent duplicate: nothing mutated, nothing re-sent, no audit.
    return { ok: true, entry: append.entry, duplicate: true, acceptance: null };
  }

  // An actual append: redaction audit first (when redaction fired at
  // build time), then the transport call, then the emission audit
  // carrying the acceptance.
  if (intent.redactedFieldKeys.length > 0) {
    auditSink.append(
      frozen({
        tenantId,
        action: AURUM_AUDIT_ACTIONS.redactionApplied,
        subject: intent.messageId,
        occurredAt: intent.emittedAt,
        correlationId,
        causationId: intent.causationId,
        details: frozen({
          kind: intent.kind,
          redactedFieldKeys: intent.redactedFieldKeys,
        }),
      }),
    );
  }
  const acceptance = transport.deliver(toTransportEmission(intent));
  auditSink.append(
    frozen({
      tenantId,
      action: AURUM_AUDIT_ACTIONS.messageEmitted,
      subject: intent.messageId,
      occurredAt: intent.emittedAt,
      correlationId,
      causationId: intent.causationId,
      details: frozen({
        kind: intent.kind,
        sequence: append.entry.sequence,
        contentDigest: intent.contentDigest,
        redactedFieldKeys: intent.redactedFieldKeys,
        transportAccepted: acceptance.accepted,
        transportProviderRef: acceptance.accepted ? acceptance.providerRef : null,
        transportRefusalReason: acceptance.accepted ? null : acceptance.reason,
      }),
    }),
  );
  return { ok: true, entry: append.entry, duplicate: false, acceptance };
}
