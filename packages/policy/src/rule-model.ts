/**
 * @fleetos/policy — D2: the Contract Guardian rule model.
 *
 * "Rules evaluate principal, device, workload, data classification,
 * contract/obligation, destination, network, printer, time/geography and
 * action." — `spec/ARCHITECTURE.md` § Contract Guardian (verbatim also in
 * `spec/policy/CONTRACT-GUARDIAN.md` Inputs).
 *
 * The rule model is TYPED and DETERMINISTIC:
 *   - every facet of a `GuardianRequestContext` is an OBSERVABLE fact
 *     (identity, platform, zone, classification, destination category,
 *     approved-printer flag, instant, country, action kind). There is NO
 *     intent input anywhere in the model — the system "records observable
 *     evidence and must not present inferred employee intent as fact"
 *     (`spec/ARCHITECTURE-LOCK.md` item 11);
 *   - rule ids are deterministic digests of the rule's stable identity
 *     (tenant + name): the same definition always yields the same id;
 *   - rules are VERSIONED records: `reviseGuardianRule` produces a NEW
 *     frozen rule (version + 1); the prior version is never rewritten
 *     (versioned-interpretation discipline, ARCHITECTURE-LOCK item 3);
 *   - rule sets are VERSIONED and deterministically ordered: compiling
 *     the same rules in any input order produces a byte-identical rule
 *     set (rules sorted by ruleId) with a content digest.
 *
 * Effects reuse the FROZEN decision types from `@fleetos/contracts`
 * (ALLOW / WARN / REQUIRE_APPROVAL / BLOCK) — never re-declared here.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import { asPolicyId } from "@fleetos/contracts";
import type {
  DeviceId,
  EvidenceRef,
  FleetError,
  GuardianDecisionType,
  PolicyId,
  TenantId,
  UserId,
  WorkloadId,
} from "@fleetos/contracts";
import { ALL_GUARDIAN_DECISION_TYPES } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { PolicyTenantScope } from "./internal";
import {
  ERROR_CODES,
  POLICY_PIPELINE_CORRELATION_ID,
  canonicalJson,
  checkPolicyTenantScope,
  deepFrozen,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Request facets — the typed rule inputs (observable facts only)
// ---------------------------------------------------------------------------

/**
 * The data-classification lattice. Ordered from least to most
 * restrictive; rules may match on membership (`in`) or exclusion
 * (`notIn`).
 */
export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

/** All data classifications, least-to-most restrictive order. */
export const ALL_DATA_CLASSIFICATIONS: readonly DataClassification[] = Object.freeze([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
]);

/**
 * The sentinel classification matched when a request carries NO
 * classified data (the `dataClassification` facet is absent). Rules that
 * target sensitive data exclude it: `notIn: ["PUBLIC", "UNCLASSIFIED"]`.
 */
export const UNCLASSIFIED = "UNCLASSIFIED" as const;

/** The effective classification a request presents (facet or sentinel). */
export type EffectiveDataClassification = DataClassification | typeof UNCLASSIFIED;

/** The observable network zone a request originates from / operates in. */
export type NetworkZone = "corporate" | "vpn" | "trusted-partner" | "public" | "unknown";

/** All network zones. */
export const ALL_NETWORK_ZONES: readonly NetworkZone[] = Object.freeze([
  "corporate",
  "vpn",
  "trusted-partner",
  "public",
  "unknown",
]);

/** The observable destination category of a transfer/upload/export. */
export type DestinationCategory =
  | "internal"
  | "sanctioned"
  | "external-ai"
  | "external"
  | "removable-media"
  | "unknown";

/** All destination categories. */
export const ALL_DESTINATION_CATEGORIES: readonly DestinationCategory[] = Object.freeze([
  "internal",
  "sanctioned",
  "external-ai",
  "external",
  "removable-media",
  "unknown",
]);

/** The observable device ownership model (ARCHITECTURE.md § Mission). */
export type DeviceOwnership =
  | "corporate"
  | "leased"
  | "customer-owned"
  | "third-party-supplied"
  | "byod";

/** All device ownership models. */
export const ALL_DEVICE_OWNERSHIPS: readonly DeviceOwnership[] = Object.freeze([
  "corporate",
  "leased",
  "customer-owned",
  "third-party-supplied",
  "byod",
]);

/**
 * The device's security-posture summary, as derived by the Security
 * Doctor (`@fleetos/security` — the `security -> policy` module-map
 * edge). Declared HERE because rule inputs are policy-owned;
 * `@fleetos/security` derives the value from its findings ledger
 * (`deriveGuardianDevicePosture`).
 */
export interface GuardianDevicePosture {
  /** The derived posture status (most severe finding wins). */
  readonly status: "HEALTHY" | "DEGRADED" | "AT_RISK" | "CRITICAL";
  /** Count of active CRITICAL findings. */
  readonly criticalFindings: number;
  /** Count of active HIGH findings. */
  readonly highFindings: number;
  /** Count of active MEDIUM findings. */
  readonly mediumFindings: number;
  /** Count of active LOW findings. */
  readonly lowFindings: number;
  /** ISO 8601 timestamp of the posture assessment (injected upstream). */
  readonly assessedAt: string;
}

/** The restrictiveness rank of posture statuses (higher = more severe). */
export const GUARDIAN_POSTURE_STATUS_RANK: Readonly<Record<GuardianDevicePosture["status"], number>> =
  Object.freeze({ HEALTHY: 0, DEGRADED: 1, AT_RISK: 2, CRITICAL: 3 });

/** The acting principal facet (observable identity facts). */
export interface GuardianPrincipalFacet {
  /** The authenticated user, when the action is user-initiated. */
  readonly userId?: UserId;
  /** The principal's role in the tenant (e.g. "employee", "manager"). */
  readonly role?: string;
  /** The principal's organizational department. */
  readonly department?: string;
  /** True when the principal is a service/agent principal, not a human. */
  readonly isServicePrincipal?: boolean;
}

/** The device facet (observable device facts + posture summary). */
export interface GuardianDeviceFacet {
  /** The device the action concerns. */
  readonly deviceId: DeviceId;
  /** The platform family (e.g. "windows", "macos" — open string). */
  readonly platform?: string;
  /** The ownership model. */
  readonly ownership?: DeviceOwnership;
  /** The security-posture summary derived by the Security Doctor. */
  readonly posture?: GuardianDevicePosture;
}

/** The workload facet (observable workload facts). */
export interface GuardianWorkloadFacet {
  /** The workload profile the action concerns. */
  readonly workloadId: WorkloadId;
  /** The workload's security classification, when classified. */
  readonly classification?: DataClassification;
}

/** The contract/obligation facet (observable in-force obligations). */
export interface GuardianContractFacet {
  /** The contract identifier, when a specific contract is in scope. */
  readonly contractId?: string;
  /** The obligation codes currently in force for this scope. */
  readonly obligations?: readonly string[];
}

/** The destination facet (observable transfer destination facts). */
export interface GuardianDestinationFacet {
  /** The destination category. */
  readonly category?: DestinationCategory;
  /** The destination host, when addressable (e.g. "api.vendor.example"). */
  readonly host?: string;
}

/** The network facet (observable connectivity zone). */
export interface GuardianNetworkFacet {
  /** The zone the request operates from. */
  readonly zone?: NetworkZone;
}

/** The printer facet (observable print-target facts). */
export interface GuardianPrinterFacet {
  /** The printer the print action targets. */
  readonly printerId?: string;
  /** Whether the printer is on the tenant's approved list (observable). */
  readonly approved?: boolean;
}

/** The time facet (when the action is requested — an injected instant). */
export interface GuardianTimeFacet {
  /** ISO 8601 timestamp of the requested action. */
  readonly at: string;
}

/** The geography facet (observable location of the request/device). */
export interface GuardianGeographyFacet {
  /** ISO 3166-1 alpha-2 country code, uppercase. */
  readonly countryCode?: string;
}

/**
 * Canonical Guardian action kinds (open string union — adapters and later
 * waves may introduce additional kinds; consumers MUST tolerate unknown
 * kinds, mirroring the frozen `ObservationKind` convention).
 */
export const ACTION_FILE_UPLOAD = "file.upload" as const;
export const ACTION_FILE_DOWNLOAD = "file.download" as const;
export const ACTION_FILE_WRITE = "file.write" as const;
export const ACTION_DOCUMENT_PRINT = "document.print" as const;
export const ACTION_DATA_EXPORT = "data.export" as const;
export const ACTION_SOFTWARE_INSTALL = "software.install" as const;
export const ACTION_DEVICE_WIPE = "device.wipe" as const;
export const ACTION_DEVICE_LOCK = "device.lock" as const;
export const ACTION_ACCESS_REQUEST = "access.request" as const;

/** The kind of action being evaluated (open union). */
export type GuardianActionKind =
  | typeof ACTION_FILE_UPLOAD
  | typeof ACTION_FILE_DOWNLOAD
  | typeof ACTION_FILE_WRITE
  | typeof ACTION_DOCUMENT_PRINT
  | typeof ACTION_DATA_EXPORT
  | typeof ACTION_SOFTWARE_INSTALL
  | typeof ACTION_DEVICE_WIPE
  | typeof ACTION_DEVICE_LOCK
  | typeof ACTION_ACCESS_REQUEST
  | (string & {});

/** The action facet — the only REQUIRED facet (every evaluation is about an action). */
export interface GuardianActionFacet {
  /** The action kind (open union above). */
  readonly action: GuardianActionKind;
  /** The kind of entity the action targets, when applicable. */
  readonly targetKind?: string;
}

/**
 * A Contract Guardian evaluation request. Every facet is an OBSERVABLE
 * fact supplied by the caller; absent facets mean "not applicable /
 * unclassified", never "unknown intent". `evidence` carries the
 * observable evidence artifacts supporting the request's facts — the
 * engine links them into the decision without interpreting their
 * contents (per the frozen `EvidenceRef` contract).
 */
export interface GuardianRequestContext extends TenantScoped {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The action being evaluated (required). */
  readonly action: GuardianActionFacet;
  /** The acting principal, when known. */
  readonly principal?: GuardianPrincipalFacet;
  /** The device concerned, when applicable. */
  readonly device?: GuardianDeviceFacet;
  /** The workload concerned, when applicable. */
  readonly workload?: GuardianWorkloadFacet;
  /** The data classification, when classified data is involved. */
  readonly dataClassification?: DataClassification;
  /** The contract/obligation scope, when applicable. */
  readonly contract?: GuardianContractFacet;
  /** The transfer destination, when applicable. */
  readonly destination?: GuardianDestinationFacet;
  /** The network zone, when known. */
  readonly network?: GuardianNetworkFacet;
  /** The print target, when applicable. */
  readonly printer?: GuardianPrinterFacet;
  /** The requested-action instant (injected upstream; defaults to the decision instant). */
  readonly time?: GuardianTimeFacet;
  /** The observable geography, when known. */
  readonly geography?: GuardianGeographyFacet;
  /** Observable evidence artifacts supporting the request's facts. */
  readonly evidence?: readonly EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Conditions — typed, deterministic matchers over the facets
// ---------------------------------------------------------------------------

/**
 * A set matcher over string values. Semantics (deterministic, uniform
 * across every facet):
 *   - `in` (non-empty): the facet value must be a member;
 *   - `notIn` (non-empty): the facet value must NOT be a member — an
 *     ABSENT value satisfies `notIn` (fail-closed: a rule expressing
 *     "only these zones may..." fires when the zone is unknown);
 *   - both specified: both must hold;
 *   - at least one MUST be specified (enforced at rule definition).
 */
export interface StringSetMatcher {
  readonly in?: readonly string[];
  readonly notIn?: readonly string[];
}

/** Matches the principal facet. Absent facet never matches. */
export interface PrincipalCondition {
  readonly kind: "principal";
  /** Matched against `principal.role`. */
  readonly roles?: StringSetMatcher;
  /** Matched against `principal.userId`. */
  readonly userIds?: StringSetMatcher;
  /** Matched against `principal.department`. */
  readonly departments?: StringSetMatcher;
  /** Match: service principals (true) vs human principals (false). */
  readonly servicePrincipals?: boolean;
}

/** Matches the device facet. Absent facet never matches. */
export interface DeviceCondition {
  readonly kind: "device";
  /** Matched against `device.deviceId`. */
  readonly deviceIds?: StringSetMatcher;
  /** Matched against `device.platform`. */
  readonly platforms?: StringSetMatcher;
  /** Matched against `device.ownership`. */
  readonly ownerships?: StringSetMatcher;
  /**
   * Fires when the device's posture status is AT LEAST this severe
   * (HEALTHY < DEGRADED < AT_RISK < CRITICAL). Never fires when the
   * device facet (or its posture summary) is absent.
   */
  readonly minPostureStatus?: GuardianDevicePosture["status"];
}

/** Matches the workload facet. Absent facet never matches. */
export interface WorkloadCondition {
  readonly kind: "workload";
  /** Matched against `workload.workloadId`. */
  readonly workloadIds?: StringSetMatcher;
  /** Matched against `workload.classification`. */
  readonly classifications?: StringSetMatcher;
}

/**
 * Matches the request's data classification. An absent facet matches as
 * the `UNCLASSIFIED` sentinel.
 */
export interface DataClassificationCondition {
  readonly kind: "dataClassification";
  /** Matched against `dataClassification ?? UNCLASSIFIED`. */
  readonly classification: StringSetMatcher;
}

/** Matches the contract/obligation facet. */
export interface ContractCondition {
  readonly kind: "contract";
  /** Matched against `contract.contractId`. */
  readonly contractIds?: StringSetMatcher;
  /**
   * Fires when ANY of these obligations is NOT in force. Fail-closed: an
   * absent contract facet (or empty obligation list) fires.
   */
  readonly missingAnyObligations?: readonly string[];
  /** Fires when ANY of these obligations IS in force. */
  readonly presentAnyObligations?: readonly string[];
}

/** Matches the destination facet. */
export interface DestinationCondition {
  readonly kind: "destination";
  /** Matched against `destination.category`. */
  readonly categories?: StringSetMatcher;
  /** Matched against `destination.host`. */
  readonly hosts?: StringSetMatcher;
}

/** Matches the network facet. */
export interface NetworkCondition {
  readonly kind: "network";
  /** Matched against `network.zone`. */
  readonly zones?: StringSetMatcher;
}

/** Matches the printer facet. */
export interface PrinterCondition {
  readonly kind: "printer";
  /** Matched against `printer.printerId`. */
  readonly printerIds?: StringSetMatcher;
  /**
   * When true, fires UNLESS `printer.approved === true` (fail-closed: an
   * absent printer facet or an unapproved/unknown printer fires).
   */
  readonly unapprovedOnly?: boolean;
}

/** An inclusive UTC hour-of-day window [from, to], 0-23, from <= to. */
export interface HourWindow {
  readonly from: number;
  readonly to: number;
}

/** Matches the effective request instant (see `evaluateGuardianRequest`). */
export interface TimeCondition {
  readonly kind: "time";
  /** Fires when the instant is INSIDE this UTC hour window. */
  readonly withinHoursUtc?: HourWindow;
  /** Fires when the instant is OUTSIDE this UTC hour window. */
  readonly outsideHoursUtc?: HourWindow;
  /** Fires when the UTC day-of-week (0=Sunday..6=Saturday) is in the list. */
  readonly weekdaysUtc?: readonly number[];
}

/** Matches the geography facet. */
export interface GeographyCondition {
  readonly kind: "geography";
  /** Matched against `geography.countryCode`. */
  readonly countryCodes?: StringSetMatcher;
}

/** Matches the action facet (always present on a request). */
export interface ActionCondition {
  readonly kind: "action";
  /** Matched against `action.action`. */
  readonly actions?: StringSetMatcher;
  /** Matched against `action.targetKind`. */
  readonly targetKinds?: StringSetMatcher;
}

/** Conjunction: fires when EVERY sub-condition fires (non-empty, enforced). */
export interface AllOfCondition {
  readonly kind: "allOf";
  readonly conditions: readonly GuardianRuleCondition[];
}

/**
 * A Contract Guardian rule condition. The discriminated union covers the
 * ten spec inputs (time and geography realized as separate facets,
 * documented as jointly covering the spec's "time/geography" input).
 */
export type GuardianRuleCondition =
  | PrincipalCondition
  | DeviceCondition
  | WorkloadCondition
  | DataClassificationCondition
  | ContractCondition
  | DestinationCondition
  | NetworkCondition
  | PrinterCondition
  | TimeCondition
  | GeographyCondition
  | ActionCondition
  | AllOfCondition;

/** The condition kinds (one per facet + the conjunction). */
export const ALL_RULE_CONDITION_KINDS: readonly GuardianRuleCondition["kind"][] = Object.freeze([
  "principal",
  "device",
  "workload",
  "dataClassification",
  "contract",
  "destination",
  "network",
  "printer",
  "time",
  "geography",
  "action",
  "allOf",
]);

// ---------------------------------------------------------------------------
// Rules — deterministic ids, versioned records
// ---------------------------------------------------------------------------

/** A versioned Contract Guardian rule. Frozen at construction. */
export interface GuardianRule extends TenantScoped {
  /**
   * The deterministic rule identity: digest of (tenantId, name). Stable
   * across revisions — the SAME definition inputs always produce the
   * same id, and a revision keeps its id while its version increments.
   */
  readonly ruleId: PolicyId;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The stable human name (part of the identity digest; non-empty). */
  readonly name: string;
  /** Human description (never matched on). */
  readonly description?: string;
  /** The rule version (>= 1; increments on every revision). */
  readonly version: number;
  /** The typed condition. */
  readonly condition: GuardianRuleCondition;
  /** The effect when the condition fires (frozen decision types). */
  readonly effect: GuardianDecisionType;
  /** Disabled rules never fire (kept for history — deletion never happens). */
  readonly enabled: boolean;
  /** ISO 8601 timestamp of the initial definition (injected). */
  readonly createdAt: string;
  /** ISO 8601 timestamp of the latest revision (injected; absent on v1). */
  readonly revisedAt?: string;
  /** Canonical digest of the rule's CONTENT (identity fields excluded). */
  readonly contentDigest: string;
}

/** Input for `defineGuardianRule`. */
export interface DefineGuardianRuleInput {
  /** Stable name (non-empty; part of the identity digest). */
  readonly name: string;
  /** Optional description. */
  readonly description?: string;
  /** The typed condition. */
  readonly condition: GuardianRuleCondition;
  /** The effect (one of the frozen decision types). */
  readonly effect: GuardianDecisionType;
  /** Enabled by default. */
  readonly enabled?: boolean;
  /** Injected definition timestamp. */
  readonly at: string;
}

/** Changes accepted by `reviseGuardianRule` (at least one required). */
export interface ReviseGuardianRuleInput {
  readonly condition?: GuardianRuleCondition;
  readonly effect?: GuardianDecisionType;
  readonly enabled?: boolean;
  readonly description?: string;
  /** Injected revision timestamp. */
  readonly at: string;
}

/** The tagged result of a rule build. */
export type GuardianRuleBuild =
  | { readonly ok: true; readonly rule: GuardianRule }
  | { readonly ok: false; readonly error: FleetError };

/**
 * The deterministic rule-id digest: FNV-1a over the canonical JSON of the
 * identity tuple (tenantId, name). Exposed for tests and callers that
 * need to predict ids.
 *
 * @param tenantId the owning tenant
 * @param name the stable rule name
 * @returns the `pol_`-prefixed id
 */
export function guardianRuleId(tenantId: TenantId, name: string): PolicyId {
  return asPolicyId(`pol_${fnv1a32Hex(canonicalJson([tenantId, name]))}`);
}

/** Canonical digest of a rule's content (identity fields excluded). */
function ruleContentDigest(input: {
  name: string;
  condition: GuardianRuleCondition;
  effect: GuardianDecisionType;
  enabled: boolean;
}): string {
  return fnv1a32Hex(
    canonicalJson({
      name: input.name,
      condition: input.condition,
      effect: input.effect,
      enabled: input.enabled,
    }),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMatcher(
  matcher: StringSetMatcher | undefined,
  path: string,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(matcher)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  const hasIn = Array.isArray(matcher.in) && matcher.in.length > 0;
  const hasNotIn = Array.isArray(matcher.notIn) && matcher.notIn.length > 0;
  if (!hasIn && !hasNotIn) {
    failures.push({ path, reason: "in_or_notIn_required" });
    return;
  }
  for (const [key, values] of [
    ["in", matcher.in],
    ["notIn", matcher.notIn],
  ] as const) {
    if (values === undefined) continue;
    if (!Array.isArray(values)) {
      failures.push({ path: `${path}.${key}`, reason: "array_required" });
      continue;
    }
    for (let i = 0; i < values.length; i++) {
      if (typeof values[i] !== "string" || (values[i] as string).length === 0) {
        failures.push({ path: `${path}.${key}/${i}`, reason: "non_empty_string_required" });
      }
    }
  }
}

function validateHourWindow(
  window: HourWindow,
  path: string,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(window)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  const from = window.from;
  const to = window.to;
  if (typeof from !== "number" || !Number.isInteger(from) || from < 0 || from > 23) {
    failures.push({ path: `${path}.from`, reason: "hour_0_23_required" });
  }
  if (typeof to !== "number" || !Number.isInteger(to) || to < 0 || to > 23) {
    failures.push({ path: `${path}.to`, reason: "hour_0_23_required" });
  }
  if (
    typeof from === "number" &&
    typeof to === "number" &&
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from <= 23 &&
    to <= 23 &&
    from >= 0 &&
    to >= 0 &&
    from > to
  ) {
    failures.push({ path, reason: "from_must_not_exceed_to" });
  }
}

/**
 * Validate a rule condition (recursive). Appends failures to the list;
 * empty additions mean valid. Enforces: known kind, well-formed
 * matchers (at least one of in/notIn), non-empty allOf, well-formed
 * hour windows and weekday lists. Pure; never throws.
 *
 * @param condition the candidate condition
 * @param path the JSON-pointer path for failure reporting
 * @param failures the accumulating failure list
 */
export function validateRuleCondition(
  condition: unknown,
  path: string,
  failures: { path: string; reason: string }[],
): void {
  if (!isPlainObject(condition)) {
    failures.push({ path, reason: "object_required" });
    return;
  }
  const kind = condition["kind"];
  if (typeof kind !== "string" || !(ALL_RULE_CONDITION_KINDS as readonly string[]).includes(kind)) {
    failures.push({ path: `${path}.kind`, reason: "unknown_condition_kind" });
    return;
  }
  switch (kind as GuardianRuleCondition["kind"]) {
    case "principal": {
      const c = condition as unknown as PrincipalCondition;
      let specified = 0;
      if (c.roles !== undefined) {
        validateMatcher(c.roles, `${path}.roles`, failures);
        specified++;
      }
      if (c.userIds !== undefined) {
        validateMatcher(c.userIds, `${path}.userIds`, failures);
        specified++;
      }
      if (c.departments !== undefined) {
        validateMatcher(c.departments, `${path}.departments`, failures);
        specified++;
      }
      if (c.servicePrincipals !== undefined) {
        if (typeof c.servicePrincipals !== "boolean") {
          failures.push({ path: `${path}.servicePrincipals`, reason: "boolean_required" });
        }
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "device": {
      const c = condition as unknown as DeviceCondition;
      let specified = 0;
      if (c.deviceIds !== undefined) {
        validateMatcher(c.deviceIds, `${path}.deviceIds`, failures);
        specified++;
      }
      if (c.platforms !== undefined) {
        validateMatcher(c.platforms, `${path}.platforms`, failures);
        specified++;
      }
      if (c.ownerships !== undefined) {
        validateMatcher(c.ownerships, `${path}.ownerships`, failures);
        specified++;
      }
      if (c.minPostureStatus !== undefined) {
        if (!(c.minPostureStatus in GUARDIAN_POSTURE_STATUS_RANK)) {
          failures.push({ path: `${path}.minPostureStatus`, reason: "unknown_posture_status" });
        }
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "workload": {
      const c = condition as unknown as WorkloadCondition;
      let specified = 0;
      if (c.workloadIds !== undefined) {
        validateMatcher(c.workloadIds, `${path}.workloadIds`, failures);
        specified++;
      }
      if (c.classifications !== undefined) {
        validateMatcher(c.classifications, `${path}.classifications`, failures);
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "dataClassification": {
      const c = condition as unknown as DataClassificationCondition;
      validateMatcher(c.classification, `${path}.classification`, failures);
      return;
    }
    case "contract": {
      const c = condition as unknown as ContractCondition;
      let specified = 0;
      if (c.contractIds !== undefined) {
        validateMatcher(c.contractIds, `${path}.contractIds`, failures);
        specified++;
      }
      if (c.missingAnyObligations !== undefined) {
        if (!Array.isArray(c.missingAnyObligations) || c.missingAnyObligations.length === 0) {
          failures.push({ path: `${path}.missingAnyObligations`, reason: "non_empty_array_required" });
        }
        specified++;
      }
      if (c.presentAnyObligations !== undefined) {
        if (!Array.isArray(c.presentAnyObligations) || c.presentAnyObligations.length === 0) {
          failures.push({ path: `${path}.presentAnyObligations`, reason: "non_empty_array_required" });
        }
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "destination": {
      const c = condition as unknown as DestinationCondition;
      let specified = 0;
      if (c.categories !== undefined) {
        validateMatcher(c.categories, `${path}.categories`, failures);
        specified++;
      }
      if (c.hosts !== undefined) {
        validateMatcher(c.hosts, `${path}.hosts`, failures);
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "network": {
      const c = condition as unknown as NetworkCondition;
      validateMatcher(c.zones, `${path}.zones`, failures);
      return;
    }
    case "printer": {
      const c = condition as unknown as PrinterCondition;
      let specified = 0;
      if (c.printerIds !== undefined) {
        validateMatcher(c.printerIds, `${path}.printerIds`, failures);
        specified++;
      }
      if (c.unapprovedOnly !== undefined) {
        if (typeof c.unapprovedOnly !== "boolean") {
          failures.push({ path: `${path}.unapprovedOnly`, reason: "boolean_required" });
        }
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "time": {
      const c = condition as unknown as TimeCondition;
      let specified = 0;
      if (c.withinHoursUtc !== undefined) {
        validateHourWindow(c.withinHoursUtc, `${path}.withinHoursUtc`, failures);
        specified++;
      }
      if (c.outsideHoursUtc !== undefined) {
        validateHourWindow(c.outsideHoursUtc, `${path}.outsideHoursUtc`, failures);
        specified++;
      }
      if (c.weekdaysUtc !== undefined) {
        if (!Array.isArray(c.weekdaysUtc) || c.weekdaysUtc.length === 0) {
          failures.push({ path: `${path}.weekdaysUtc`, reason: "non_empty_array_required" });
        } else {
          for (let i = 0; i < c.weekdaysUtc.length; i++) {
            const day = c.weekdaysUtc[i];
            if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
              failures.push({ path: `${path}.weekdaysUtc/${i}`, reason: "day_0_6_required" });
            }
          }
        }
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "geography": {
      const c = condition as unknown as GeographyCondition;
      validateMatcher(c.countryCodes, `${path}.countryCodes`, failures);
      return;
    }
    case "action": {
      const c = condition as unknown as ActionCondition;
      let specified = 0;
      if (c.actions !== undefined) {
        validateMatcher(c.actions, `${path}.actions`, failures);
        specified++;
      }
      if (c.targetKinds !== undefined) {
        validateMatcher(c.targetKinds, `${path}.targetKinds`, failures);
        specified++;
      }
      if (specified === 0) {
        failures.push({ path, reason: "at_least_one_constraint_required" });
      }
      return;
    }
    case "allOf": {
      const c = condition as unknown as AllOfCondition;
      if (!Array.isArray(c.conditions) || c.conditions.length === 0) {
        failures.push({ path: `${path}.conditions`, reason: "non_empty_array_required" });
        return;
      }
      for (let i = 0; i < c.conditions.length; i++) {
        validateRuleCondition(c.conditions[i], `${path}.conditions/${i}`, failures);
      }
      return;
    }
  }
}

/**
 * Define a new Guardian rule (version 1). The rule id is the
 * deterministic digest of (tenantId, name); the content digest covers
 * name + condition + effect + enabled. Validation is tagged (no throw).
 *
 * @param tenantId the owning tenant
 * @param input the definition input
 * @returns the tagged build result
 */
export function defineGuardianRule(
  tenantId: TenantId,
  input: DefineGuardianRuleInput,
): GuardianRuleBuild {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.name !== "string" || input.name.length === 0) {
    failures.push({ path: "/name", reason: "non_empty_string_required" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (
    input?.effect === undefined ||
    !(ALL_GUARDIAN_DECISION_TYPES as readonly string[]).includes(input.effect)
  ) {
    failures.push({ path: "/effect", reason: "unknown_decision_type" });
  }
  if (input?.enabled !== undefined && typeof input.enabled !== "boolean") {
    failures.push({ path: "/enabled", reason: "boolean_required" });
  }
  if (input?.description !== undefined && typeof input.description !== "string") {
    failures.push({ path: "/description", reason: "string_required" });
  }
  if (input?.condition === undefined) {
    failures.push({ path: "/condition", reason: "required" });
  } else {
    validateRuleCondition(input.condition, "/condition", failures);
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.ruleInvalid,
        "guardian rule definition is invalid",
        { tenantId, correlationId: POLICY_PIPELINE_CORRELATION_ID },
        failures,
      ),
    };
  }
  const enabled = input.enabled ?? true;
  const rule: GuardianRule = frozen({
    ruleId: guardianRuleId(tenantId, input.name),
    tenantId,
    name: input.name,
    description: input.description,
    version: 1,
    condition: deepFrozen(input.condition) as GuardianRuleCondition,
    effect: input.effect,
    enabled,
    createdAt: input.at,
    contentDigest: ruleContentDigest({
      name: input.name,
      condition: input.condition,
      effect: input.effect,
      enabled,
    }),
  });
  return { ok: true, rule };
}

/**
 * Revise a rule: produce the NEXT version (prior + 1) as a NEW frozen
 * record. The prior record is never rewritten (versioned-interpretation
 * discipline). At least one change must be supplied; the identity
 * (ruleId, name) is immutable.
 *
 * @param rule the prior version
 * @param input the changes (at least one field besides `at`)
 * @returns the tagged build result
 */
export function reviseGuardianRule(
  rule: GuardianRule,
  input: ReviseGuardianRuleInput,
): GuardianRuleBuild {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (
    input?.effect !== undefined &&
    !(ALL_GUARDIAN_DECISION_TYPES as readonly string[]).includes(input.effect)
  ) {
    failures.push({ path: "/effect", reason: "unknown_decision_type" });
  }
  if (input?.enabled !== undefined && typeof input.enabled !== "boolean") {
    failures.push({ path: "/enabled", reason: "boolean_required" });
  }
  if (input?.description !== undefined && typeof input.description !== "string") {
    failures.push({ path: "/description", reason: "string_required" });
  }
  if (input?.condition !== undefined) {
    validateRuleCondition(input.condition, "/condition", failures);
  }
  const changed =
    input?.condition !== undefined ||
    input?.effect !== undefined ||
    input?.enabled !== undefined ||
    input?.description !== undefined;
  if (!changed) {
    failures.push({ path: "/", reason: "at_least_one_change_required" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.ruleInvalid,
        "guardian rule revision is invalid",
        { tenantId: rule.tenantId, correlationId: POLICY_PIPELINE_CORRELATION_ID },
        failures,
      ),
    };
  }
  const condition = input.condition ?? rule.condition;
  const effect = input.effect ?? rule.effect;
  const enabled = input.enabled ?? rule.enabled;
  const description = input.description !== undefined ? input.description : rule.description;
  const next: GuardianRule = frozen({
    ruleId: rule.ruleId,
    tenantId: rule.tenantId,
    name: rule.name,
    description,
    version: rule.version + 1,
    condition:
      input.condition !== undefined
        ? (deepFrozen(input.condition) as GuardianRuleCondition)
        : rule.condition,
    effect,
    enabled,
    createdAt: rule.createdAt,
    revisedAt: input.at,
    contentDigest: ruleContentDigest({ name: rule.name, condition, effect, enabled }),
  });
  return { ok: true, rule: next };
}

// ---------------------------------------------------------------------------
// Rule sets — versioned, deterministically ordered
// ---------------------------------------------------------------------------

/** A versioned Contract Guardian rule set. Frozen at construction. */
export interface GuardianRuleSet extends TenantScoped {
  /** Deterministic content identity: digest over tenant + version + member rules. */
  readonly ruleSetId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The rule-set version (>= 1, monotonic per tenant — caller-supplied). */
  readonly version: number;
  /** The member rules, sorted by ruleId (deterministic order). */
  readonly rules: readonly GuardianRule[];
  /** ISO 8601 compile timestamp (injected). */
  readonly compiledAt: string;
  /** Canonical digest of the member rules (ids + versions + content digests). */
  readonly contentDigest: string;
}

/** Input for `compileGuardianRuleSet`. */
export interface CompileGuardianRuleSetInput {
  /** The member rules (all owned by the same tenant). */
  readonly rules: readonly GuardianRule[];
  /** The rule-set version (>= 1). */
  readonly version: number;
  /** Injected compile timestamp. */
  readonly at: string;
}

/** The tagged result of a rule-set compile. */
export type GuardianRuleSetCompile =
  | { readonly ok: true; readonly ruleSet: GuardianRuleSet }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Compile a versioned rule set. Deterministic: the member rules are
 * sorted by ruleId, so compiling the same rules in ANY input order
 * produces a byte-identical rule set. Duplicate rule ids and
 * cross-tenant members are rejected.
 *
 * @param tenantId the owning tenant
 * @param input the compile input
 * @returns the tagged compile result
 */
export function compileGuardianRuleSet(
  tenantId: TenantId,
  input: CompileGuardianRuleSetInput,
): GuardianRuleSetCompile {
  const failures: { path: string; reason: string }[] = [];
  if (!Array.isArray(input?.rules)) {
    failures.push({ path: "/rules", reason: "array_required" });
  }
  if (typeof input?.version !== "number" || !Number.isInteger(input.version) || input.version < 1) {
    failures.push({ path: "/version", reason: "integer_at_least_1_required" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.ruleSetInvalid,
        "guardian rule set compile is invalid",
        { tenantId, correlationId: POLICY_PIPELINE_CORRELATION_ID },
        failures,
      ),
    };
  }
  const seen = new Set<string>();
  const sorted = [...input.rules].sort((a, b) =>
    a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0,
  );
  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i];
    if (rule.tenantId !== tenantId) {
      failures.push({ path: `/rules/${i}/tenantId`, reason: "tenant_mismatch" });
    }
    if (seen.has(rule.ruleId)) {
      failures.push({ path: `/rules/${i}/ruleId`, reason: "duplicate_rule_id" });
    }
    seen.add(rule.ruleId);
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.ruleSetInvalid,
        "guardian rule set compile is invalid",
        { tenantId, correlationId: POLICY_PIPELINE_CORRELATION_ID },
        failures,
      ),
    };
  }
  const memberDigest = fnv1a32Hex(
    canonicalJson(sorted.map((rule) => [rule.ruleId, rule.version, rule.contentDigest])),
  );
  const ruleSet: GuardianRuleSet = frozen({
    ruleSetId: `grs_${fnv1a32Hex(canonicalJson([tenantId, input.version, memberDigest]))}`,
    tenantId,
    version: input.version,
    rules: frozenArray(sorted),
    compiledAt: input.at,
    contentDigest: memberDigest,
  });
  return { ok: true, ruleSet };
}

export type { PolicyTenantScope };
export { checkPolicyTenantScope };
