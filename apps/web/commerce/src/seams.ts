/**
 * @fleetos/web-commerce — the structural seams (the W040-disclosed pattern).
 *
 * `src/` in this package imports `@fleetos/contracts` ONLY (the frozen
 * shared seam). Every domain record the commerce surfaces consume is
 * declared here as a FACET interface — the minimum the display needs —
 * and the REAL accepted domain records (W032 `ProcurementDemand` /
 * `VendorMatch` / `Quote` / `QuoteLedger` / `AggregatedOrder`,
 * `Vendor` from `@fleetos/vendors`, `SoftwareSubscription` from
 * `@fleetos/software`, W042 `ServiceWorkOrder` / `ServiceVendorMatch` /
 * `AggregatedServiceOrder` from `@fleetos/maintenance`, W050A
 * `ConnectivitySubmissionRecord` / `ConnectivityRecord` from
 * `@fleetos/integration-adcos`, W050C `OutboxEntry` / `DeliveryRecord`
 * from `@fleetos/integration-aurum`) are ASSIGNABLE to those facets by
 * TypeScript structural typing. The binding site (the W061 shell)
 * injects the real records; the test suite in `test/` is the runtime
 * proof (the ownership gate permits cross-lane imports in `test/` only).
 *
 * Provider-neutrality (ARCHITECTURE-LOCK items 6-8): the ADCOS facets
 * deliberately EXCLUDE the opaque provider handle, the provider refusal
 * DETAIL, and every provider topology/credential field — the surface
 * displays the machine-stable refusal REASON only. The Aurum facets
 * deliberately EXCLUDE the provider's own message handle
 * (`providerMessageId`) — the metadata-only display shows the
 * provider-neutral recipient ref + channel (LOCK 10: FleetOS remains
 * operational authority; Aurum returns metadata only).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { CorrelationId, GuardianDecision, TenantId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// Vendor facets (W032's vendor model, @fleetos/vendors at the binding site)
// ---------------------------------------------------------------------------

/** One capability a vendor declares. */
export interface VendorCapabilityFacets {
  readonly kind: string;
  readonly id: string;
}

/** One inventory signal (availability + lead time). */
export interface VendorInventoryFacets {
  readonly capability: VendorCapabilityFacets;
  readonly availability: { readonly ratio: number };
  readonly leadTime: { readonly days: number };
}

/** The typed vendor terms (quality / SLA / warranty). */
export interface VendorTermsFacets {
  readonly quality: { readonly score: number };
  readonly sla: { readonly coverage: number };
  readonly warranty: { readonly days: number };
}

/**
 * The vendor facets — the W032 `Vendor` is ASSIGNABLE to this shape.
 * The catalog + matching displays consume identity, capabilities,
 * inventory signals, terms and regions.
 */
export interface VendorFacets {
  readonly vendorId: string;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description: string;
  readonly revision: number;
  readonly capabilities: readonly VendorCapabilityFacets[];
  readonly inventory: readonly VendorInventoryFacets[];
  readonly terms: VendorTermsFacets;
  readonly regions: readonly string[];
  readonly createdAt: string;
  readonly contentHash: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

// ---------------------------------------------------------------------------
// Procurement facets (W032, @fleetos/procurement at the binding site)
// ---------------------------------------------------------------------------

/**
 * The procurement-demand facets — the W032 `ProcurementDemand` is
 * ASSIGNABLE to this shape. The typed floors (budget / SLA / warranty /
 * quality / availability) are the headroom-rank display inputs.
 */
export interface ProcurementDemandFacets {
  readonly demandId: string;
  readonly tenantId: TenantId;
  readonly workloadId: string;
  readonly description: string;
  readonly quantity: number;
  readonly createdAt: string;
  readonly deadline: string;
  readonly deliveryArea: string;
  readonly budget: { readonly usd: number };
  readonly slaFloor: { readonly coverage: number };
  readonly warrantyFloor: { readonly days: number };
  readonly qualityFloor: { readonly score: number };
  readonly availabilityFloor: { readonly ratio: number };
  readonly allowedSubstitutions: readonly string[];
  readonly rejectionEvidence: readonly { candidateId: string; reason: string }[];
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

/**
 * The vendor-match facets — the W032 `VendorMatch` is ASSIGNABLE to this
 * shape. `vendor` is the FULL vendor facets record (the headroom ranks
 * derive from the vendor's typed terms against the demand's floors).
 */
export interface VendorMatchFacets {
  readonly vendor: VendorFacets;
  readonly matchedCapability: VendorCapabilityFacets | null;
  readonly matchedInventory: VendorInventoryFacets | null;
  readonly rankScore: number;
  readonly satisfiable: boolean;
  readonly reasons: readonly { readonly kind: string; readonly detail: string }[];
}

/**
 * The quote facets — the W032 `Quote` is ASSIGNABLE to this shape.
 * The status union is surfaced verbatim (machine-stable).
 */
export interface QuoteFacets {
  readonly quoteId: string;
  readonly tenantId: TenantId;
  readonly demandId: string;
  readonly vendorId: string;
  readonly matchedCapabilityId: string | null;
  readonly quoteVersion: number;
  readonly supersedes?: string;
  readonly unitPriceUsd: number;
  readonly totalPriceUsd: number;
  readonly leadTimeDays: number;
  readonly warrantyDays: number;
  readonly slaCoverage: number;
  readonly status: string;
  readonly issuedAt: string;
  readonly acceptedAt?: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

/** One quote-ledger entry (the W032 union, widened to facets). */
export type QuoteLedgerEntryFacets =
  | { readonly kind: "quote"; readonly quote: QuoteFacets }
  | { readonly kind: "acceptance"; readonly acceptance: { readonly quoteId: string; readonly acceptedAt: string; readonly correlationId: CorrelationId } }
  | { readonly kind: "supersession"; readonly supersession: { readonly quoteId: string; readonly supersededBy: string; readonly supersededAt: string; readonly correlationId: CorrelationId } };

/** The quote-ledger facets — the W032 `QuoteLedger` is ASSIGNABLE. */
export interface QuoteLedgerFacets {
  readonly tenantId: TenantId;
  readonly entries: readonly QuoteLedgerEntryFacets[];
}

/**
 * The aggregated-order facets — the W032 `AggregatedOrder` is ASSIGNABLE
 * (LOCK 14: per-contract identity preserved via memberDemandIds).
 */
export interface AggregatedOrderFacets {
  readonly aggregationId: string;
  readonly tenantId: TenantId;
  readonly vendorId: string;
  readonly deliveryArea: string;
  readonly deadline: string;
  readonly memberDemandIds: readonly string[];
  readonly totalQuantity: number;
  readonly totalAggregatedPriceUsd: number;
  readonly formedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

// ---------------------------------------------------------------------------
// Software facets (W032's software model, @fleetos/software)
// ---------------------------------------------------------------------------

/**
 * The software-subscription facets (the catalog's software arm) — the
 * W032 `SoftwareSubscription` is ASSIGNABLE to this shape. The typed
 * terms: seatCount + termDays (the subscription's warranty window is
 * its term).
 */
export interface SoftwareSubscriptionFacets {
  readonly subscriptionId: string;
  readonly tenantId: TenantId;
  readonly softwareId: string;
  readonly seatCount: number;
  readonly termDays: number;
  readonly workloadId: string;
  readonly revision: number;
  readonly supersedes?: string;
  readonly allocatedAt: string;
  readonly contentHash: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

// ---------------------------------------------------------------------------
// Maintenance facets (W042, @fleetos/maintenance at the binding site)
// ---------------------------------------------------------------------------

/** The diagnosis-evidence facets (W021 refs, surfaced machine-stable). */
export interface DiagnosisEvidenceFacets {
  readonly hypothesisId: string;
  readonly recommendationId: string;
  readonly causeId: string;
  readonly confidence: number;
  readonly observationIds: readonly string[];
}

/** The warranty-eligibility rules (typed, against vendor terms). */
export interface WarrantyRulesFacets {
  readonly warrantyFloor: { readonly days: number };
  readonly requireInWarranty: boolean;
}

/**
 * The service-work-order facets — the W042 `ServiceWorkOrder` is
 * ASSIGNABLE to this shape (the diagnosis evidence + warranty rules +
 * floors are the warranty-aware eligibility display inputs).
 */
export interface ServiceWorkOrderFacets {
  readonly workOrderId: string;
  readonly tenantId: TenantId;
  readonly deviceId: string;
  readonly revision: number;
  readonly supersedes?: string;
  readonly diagnosis: DiagnosisEvidenceFacets;
  readonly serviceArea: string;
  readonly deadline: string;
  readonly slaFloor: { readonly coverage: number };
  readonly warrantyRules: WarrantyRulesFacets;
  readonly qualityFloor: { readonly score: number };
  readonly availabilityFloor: { readonly ratio: number };
  readonly serviceCategory: string;
  readonly allowedSubstitutions: readonly string[];
  readonly createdAt: string;
  readonly contentDigest: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

/**
 * The service vendor-match facets — the W042 `ServiceVendorMatch` is
 * ASSIGNABLE to this shape.
 */
export interface ServiceVendorMatchFacets {
  readonly vendor: VendorFacets;
  readonly matchedCapability: VendorCapabilityFacets | null;
  readonly matchedInventory: VendorInventoryFacets | null;
  readonly rankScore: number;
  readonly satisfiable: boolean;
  readonly reasons: readonly { readonly kind: string; readonly detail: string }[];
}

/**
 * The aggregated service-order facets — the W042 `AggregatedServiceOrder`
 * is ASSIGNABLE (LOCK 14: member work-order identities preserved).
 */
export interface AggregatedServiceOrderFacets {
  readonly aggregationId: string;
  readonly tenantId: TenantId;
  readonly vendorId: string;
  readonly serviceArea: string;
  readonly deadline: string;
  readonly memberWorkOrderIds: readonly string[];
  readonly memberCount: number;
  readonly totalWarrantyHeadroomDays: number;
  readonly formedAt: string;
  readonly schemaVersion: number;
  readonly modelVersion: number;
}

// ---------------------------------------------------------------------------
// ADCOS facets (W050A, @fleetos/integration-adcos at the binding site)
// ---------------------------------------------------------------------------

/**
 * The connectivity-submission facets — the W050A
 * `ConnectivitySubmissionRecord` is ASSIGNABLE to this shape. The seam
 * deliberately EXCLUDES: the opaque provider handle, the provider
 * refusal DETAIL (the machine-stable reason is surfaced), and every
 * provider topology/credential field (ARCHITECTURE-LOCK items 6-8).
 *
 * The revision facets carry the FULL Guardian decision context (the
 * FROZEN `GuardianDecision` from the contracts — decision type, matched
 * rules, evidence) plus the widened evaluation reasons, so PARKED
 * approvals are visible with their decision context.
 */
export interface ConnectivitySubmissionFacets {
  readonly tenantId: TenantId;
  readonly submissionId: string;
  readonly request: {
    readonly intentRef: { readonly intentId: string; readonly version: number; readonly createdAt: string };
    readonly outcome: { readonly canonical: string; readonly raw: string };
    readonly targets: {
      readonly sourceDeviceId?: string;
      readonly targetDeviceId?: string;
      readonly workloadId?: string;
    };
    readonly properties: {
      readonly maxLatencyMs?: number;
      readonly minThroughputMbps?: number;
      readonly availabilityTarget?: number;
      readonly isolation: string;
      readonly redundancy: string;
    };
    readonly constraints: {
      readonly requiredZones: readonly string[];
      readonly forbiddenZones: readonly string[];
      readonly maxPathHops?: number;
      readonly egressAllowed: boolean;
    };
    readonly duration: { readonly startAt: string; readonly endAt?: string; readonly indefinite?: boolean };
    readonly budget?: { readonly budgetRef?: string; readonly policyRefs: readonly string[] };
    readonly security: {
      readonly encryption: string;
      readonly privateRouting: boolean;
      readonly complianceRefs: readonly string[];
    };
  };
  readonly status: string;
  readonly revisions: readonly {
    readonly revision: number;
    readonly status: string;
    readonly at: string;
    readonly decision: GuardianDecision | null;
    readonly reasons: readonly {
      readonly code: string;
      readonly ruleId?: string;
      readonly ruleVersion?: number;
      readonly effect?: string;
      readonly chosen?: string;
    }[];
    readonly matchedRules: readonly { readonly ruleId: string; readonly version: number }[];
    readonly providerRefusal: { readonly reason: string } | null;
  }[];
}

/**
 * The connectivity-record facets — the W050A `ConnectivityRecord` (the
 * adopted status timeline) is ASSIGNABLE to this shape. The seam EXCLUDES
 * the opaque provider handle; the timeline surfaces the NORMALIZED
 * execution states + the machine-stable degradation/failure taxonomies
 * (kinds only — the classification detail stays in the domain).
 */
export interface ConnectivityRecordFacets {
  readonly tenantId: TenantId;
  readonly connectivityId: string;
  readonly intentRef: { readonly intentId: string; readonly version: number; readonly createdAt: string } | null;
  readonly requestDigest: string | null;
  readonly executionState: string;
  readonly revisions: readonly {
    readonly revision: number;
    readonly adoptedAt: string;
    readonly executionState: string;
    readonly measurements: readonly { readonly kind: string; readonly value: number; readonly measuredAt: string }[];
    readonly degradation: { readonly kind: string };
    readonly failure: { readonly kind: string };
    readonly termination: { readonly reason: string; readonly terminatedAt: string } | null;
    readonly contentDigest: string;
    readonly priorDigest: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Aurum facets (W050C, @fleetos/integration-aurum at the binding site)
// ---------------------------------------------------------------------------

/** The derived message-content facets (title/summary/ordered fields). */
export interface MessageContentFacets {
  readonly title: string;
  readonly summary: string;
  readonly fields: readonly { readonly key: string; readonly value: string; readonly sensitivity: string }[];
}

/**
 * The communication-intent facets — the W050C `CommunicationIntent` is
 * ASSIGNABLE to this shape (the six provider-neutral message kinds).
 */
export interface CommunicationIntentFacets {
  readonly messageId: string;
  readonly tenantId: TenantId;
  readonly kind: string;
  readonly subjectRef: string;
  readonly recipient: { readonly kind: string; readonly role?: string; readonly principalId?: string };
  readonly priority: string;
  readonly content: MessageContentFacets;
  readonly redactedFieldKeys: readonly string[];
  readonly contentDigest: string;
  readonly emittedAt: string;
  readonly correlationId: CorrelationId;
  readonly schemaVersion: number;
}

/**
 * The outbox-entry facets — the W050C `OutboxEntry` is ASSIGNABLE.
 * READ-ONLY display of the emission ledger (LOCK 10: metadata only).
 */
export interface OutboxEntryFacets {
  readonly sequence: number;
  readonly tenantId: TenantId;
  readonly intent: CommunicationIntentFacets;
  readonly schemaVersion: number;
}

/**
 * The delivery-record facets — the W050C `DeliveryRecord` is ASSIGNABLE,
 * EXCLUDING the provider's own message handle (`providerMessageId`):
 * the metadata-only display surfaces the provider-neutral recipient
 * ref + channel + state + disposition (LOCK 10).
 */
export interface DeliveryRecordFacets {
  readonly tenantId: TenantId;
  readonly messageRef: string;
  readonly deliveryAttempt: number;
  readonly state: string;
  readonly recipient: { readonly recipientRef: string; readonly channel: string };
  readonly disposition: string;
  readonly ingestedAt: string;
  readonly correlationId: CorrelationId;
  readonly schemaVersion: number;
}

// ---------------------------------------------------------------------------
// The shared display field (ordered key/value pair)
// ---------------------------------------------------------------------------

/** One display field (ordered, deterministic rendering). */
export interface SurfaceFieldView {
  readonly key: string;
  readonly value: string;
}
