/**
 * @fleetos/integration-aurum — D3: the injected emission transport seam.
 *
 * ALL transport is an INJECTED seam: the adapter never performs real
 * network I/O. The reference implementation is the in-memory transport
 * below (deterministic call recording; optional scripted refusals for
 * tests — no clock reads, no entropy). A production Aurum connector is a
 * later infrastructure wave; it implements THIS typed contract at the
 * binding site.
 *
 * The seam is provider-neutral (ARCHITECTURE-LOCK items 6-7): the
 * emission carries the normalized post-redaction message and the
 * acceptance carries only delivery-channel metadata — never a
 * provider-specific type.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { frozen, frozenArray } from "./internal";
import type { CommunicationIntent } from "./intents";

/**
 * The normalized emission handed to the transport: the post-redaction
 * message exactly as it was appended to the outbox. The transport NEVER
 * sees unredacted content (redaction is applied at build time).
 */
export interface TransportEmission {
  /** The outbox message identity. */
  readonly messageId: string;
  readonly tenantId: CommunicationIntent["tenantId"];
  readonly kind: CommunicationIntent["kind"];
  readonly subjectRef: string;
  readonly recipient: CommunicationIntent["recipient"];
  readonly priority: CommunicationIntent["priority"];
  readonly content: CommunicationIntent["content"];
  readonly contentDigest: string;
  readonly emittedAt: string;
  readonly correlationId: CommunicationIntent["correlationId"];
  readonly causationId?: CommunicationIntent["causationId"];
}

/** The transport's acceptance of one emission (channel metadata only). */
export type TransportAcceptance =
  | { readonly accepted: true; readonly providerRef: string | null }
  | { readonly accepted: false; readonly reason: string };

/**
 * The emission transport seam. Implementations deliver the emission to
 * the provider and return the acceptance synchronously. A refused
 * acceptance does NOT undo the outbox append — the outbox is the durable
 * record of what FleetOS asked Aurum to send; retries are a later
 * convergence concern (W051).
 */
export interface EmissionTransport {
  deliver(emission: TransportEmission): TransportAcceptance;
}

/** Project a communication intent onto the transport emission (pure). */
export function toTransportEmission(intent: CommunicationIntent): TransportEmission {
  return frozen({
    messageId: intent.messageId,
    tenantId: intent.tenantId,
    kind: intent.kind,
    subjectRef: intent.subjectRef,
    recipient: intent.recipient,
    priority: intent.priority,
    content: intent.content,
    contentDigest: intent.contentDigest,
    emittedAt: intent.emittedAt,
    correlationId: intent.correlationId,
    causationId: intent.causationId,
  });
}

/** Options for the in-memory reference transport. */
export interface InMemoryTransportOptions {
  /**
   * A deterministic refusal script: a predicate over the emission. When
   * provided and it returns a non-null reason string, the transport
   * refuses with that machine-stable reason. Test-controllable; never a
   * clock or entropy source.
   */
  readonly refusal?: (emission: TransportEmission) => string | null;
  /**
   * A deterministic provider-ref generator (defaults to
   * `aurum_ref_<n>` with a per-instance counter — deterministic per
   * transport instance).
   */
  readonly providerRef?: (emission: TransportEmission) => string | null;
}

/**
 * The in-memory reference transport: records every emission verbatim
 * (call order) + the acceptance returned. Deterministic; no network,
 * no clock, no entropy.
 *
 * @param opts the transport options
 * @returns the frozen in-memory transport + its call log
 */
export function createInMemoryTransport(
  opts: InMemoryTransportOptions = {},
): EmissionTransport & {
  readonly emissions: readonly TransportEmission[];
  readonly acceptances: readonly TransportAcceptance[];
} {
  const emissions: TransportEmission[] = [];
  const acceptances: TransportAcceptance[] = [];
  let counter = 0;
  return frozen({
    deliver(emission: TransportEmission): TransportAcceptance {
      emissions.push(emission);
      const refusal = opts.refusal ? opts.refusal(emission) : null;
      if (refusal !== null && refusal !== undefined) {
        const acceptance: TransportAcceptance = frozen({
          accepted: false,
          reason: refusal,
        });
        acceptances.push(acceptance);
        return acceptance;
      }
      counter += 1;
      const providerRef = opts.providerRef
        ? opts.providerRef(emission)
        : `aurum_ref_${String(counter).padStart(6, "0")}`;
      const acceptance: TransportAcceptance = frozen({ accepted: true, providerRef });
      acceptances.push(acceptance);
      return acceptance;
    },
    get emissions(): readonly TransportEmission[] {
      return frozenArray(emissions);
    },
    get acceptances(): readonly TransportAcceptance[] {
      return frozenArray(acceptances);
    },
  });
}
