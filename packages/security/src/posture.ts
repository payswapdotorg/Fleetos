/**
 * @fleetos/security — D1: the Security Doctor posture model.
 *
 * The control plane owns "security posture"
 * (`spec/ARCHITECTURE.md` § Control plane); the module map edge is
 * `security -> devices, observations, policy, audit`. Per the W031 work
 * order, the devices/observations edges are honored via the FROZEN
 * `@fleetos/contracts` shapes only: posture is derived deterministically
 * from canonical `Observation` values (kind `device.security`,
 * payload schema version 1 — the recognition vocabulary below). The
 * policy edge is honored with real code (`guardian-inputs.ts` derives
 * policy-typed posture summaries); the audit edge is the injected sink
 * seam (`audit-seam.ts`).
 *
 * Reality vs interpretation (`spec/ARCHITECTURE.md` § Canonical model):
 * observations are immutable reality; findings are VERSIONED
 * INTERPRETATIONS. Re-assessment appends NEW finding records
 * (interpretationVersion = prior + 1, `supersedes` pointing at the prior
 * record id); an existing record is NEVER rewritten
 * (versioned-interpretation discipline, ARCHITECTURE-LOCK item 3).
 *
 * Determinism guarantees (proven by test):
 *   - finding ids are deterministic digests of (tenantId, deviceId,
 *     code); record ids add the interpretation version;
 *   - the rule library is an ORDERED, frozen table; findings are
 *     emitted sorted by (severity rank desc, code asc) regardless of
 *     observation input order;
 *   - multiple observations supporting the same rule merge into ONE
 *     finding with evidence links sorted by observation id;
 *   - unrecognized payloads are SKIPPED with enumerable machine reasons
 *     (forward compatibility — newer agents may emit richer payloads);
 *   - no clock reads: `assessedAt` is injected; `observedAt` comes from
 *     the source observation.
 *
 * Decision boundary: findings may propose DRAFT
 * `SecurityRemediationIntent` payloads (the intent kind OWNED by this
 * package per `@fleetos/contracts` `intents.ts`) — payload shapes only:
 * no intent id, no lifecycle, no dispatch. Executing remediation is the
 * Fleet Actions wave (W041), and every action still passes the Contract
 * Guardian. Nothing here asserts an employee's intent — findings state
 * observable device conditions.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { DeviceId, FleetError, Observation, ObservationId, TenantId } from "@fleetos/contracts";
import { SECURITY_REMEDIATION_INTENT_KIND } from "@fleetos/contracts";
import type { SecurityRemediationIntentPayload } from "@fleetos/contracts";
import type { TenantScoped } from "@fleetos/contracts";
import type { FindingsLedgerEntry } from "./findings-ledger";
import {
  ERROR_CODES,
  SECURITY_PIPELINE_CORRELATION_ID,
  SYNTHETIC_SYSTEM_TENANT,
  canonicalJson,
  fnv1a32Hex,
  frozen,
  frozenArray,
  looksLikeIso,
  makeValidationError,
} from "./internal";

// ---------------------------------------------------------------------------
// Severity, classification, posture status
// ---------------------------------------------------------------------------

/** The severity of a posture finding. */
export type SecuritySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/** All finding severities, most-to-least severe order. */
export const ALL_SECURITY_SEVERITIES: readonly SecuritySeverity[] = Object.freeze([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
]);

/** The severity rank (higher = more severe). */
export const SECURITY_SEVERITY_RANK: Readonly<Record<SecuritySeverity, number>> = Object.freeze({
  CRITICAL: 3,
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
});

/**
 * The classification of a posture finding — the security domain the
 * condition belongs to.
 */
export type SecurityFindingClassification = "compliance" | "configuration" | "exposure" | "threat";

/** All finding classifications. */
export const ALL_SECURITY_FINDING_CLASSIFICATIONS: readonly SecurityFindingClassification[] =
  Object.freeze(["compliance", "configuration", "exposure", "threat"]);

/** The derived posture status of a device (most severe finding wins). */
export type SecurityPostureStatus = "HEALTHY" | "DEGRADED" | "AT_RISK" | "CRITICAL";

/** All posture statuses. */
export const ALL_SECURITY_POSTURE_STATUSES: readonly SecurityPostureStatus[] = Object.freeze([
  "HEALTHY",
  "DEGRADED",
  "AT_RISK",
  "CRITICAL",
]);

/** The posture-status rank (higher = more severe). */
export const SECURITY_POSTURE_STATUS_RANK: Readonly<Record<SecurityPostureStatus, number>> =
  Object.freeze({ HEALTHY: 0, DEGRADED: 1, AT_RISK: 2, CRITICAL: 3 });

/**
 * The version of the posture derivation model itself. Bumping this is a
 * versioned model change (new recognition vocabulary / severity table).
 */
export const SECURITY_POSTURE_MODEL_VERSION = 1;

// ---------------------------------------------------------------------------
// Findings — versioned interpretations with deterministic ids
// ---------------------------------------------------------------------------

/** An evidence link to the immutable observation that supports a finding. */
export interface FindingEvidence {
  /** The source observation (immutable reality). */
  readonly observationId: ObservationId;
  /** The observation kind (always a security kind for derived findings). */
  readonly kind: string;
}

/**
 * A DRAFT remediation proposal linked to the `SecurityRemediationIntent`
 * kind OWNED by this package (`@fleetos/contracts` `intents.ts`). Payload
 * shape ONLY: no intent id, no lifecycle, no dispatch (asserted by
 * test — the serialized proposal carries neither `intentId` nor
 * `status`).
 */
export interface SecurityRemediationProposal {
  /** The frozen intent kind this proposal drafts. */
  readonly intentKind: typeof SECURITY_REMEDIATION_INTENT_KIND;
  /** The draft payload (frozen shape from @fleetos/contracts). */
  readonly payload: SecurityRemediationIntentPayload;
}

/** A versioned security-posture finding (an interpretation, never a fact). */
export interface SecurityFinding extends TenantScoped {
  /** The stable finding identity: digest of (tenantId, deviceId, code). */
  readonly findingId: string;
  /** The record identity: digest of (tenantId, deviceId, code, version). */
  readonly recordId: string;
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device the finding concerns. */
  readonly deviceId: DeviceId;
  /** The machine-stable finding code (e.g. "security.device.disk_encryption.off"). */
  readonly code: string;
  /** The human title (never matched on). */
  readonly title: string;
  /** The severity. */
  readonly severity: SecuritySeverity;
  /** The classification. */
  readonly classification: SecurityFindingClassification;
  /** The interpretation version (>= 1; prior + 1 on re-assessment). */
  readonly interpretationVersion: number;
  /** The prior record this interpretation supersedes (absent on version 1). */
  readonly supersedes?: string;
  /** ISO 8601 timestamp of the assessment (injected). */
  readonly detectedAt: string;
  /** ISO 8601 timestamp of the source observation. */
  readonly observedAt: string;
  /** Evidence links to the supporting observations (observationId order). */
  readonly evidence: readonly FindingEvidence[];
  /** A DRAFT remediation proposal (CRITICAL/HIGH findings only). */
  readonly remediation?: SecurityRemediationProposal;
}

/**
 * The deterministic finding identity: digest of (tenantId, deviceId,
 * code). Stable across re-assessments — re-assessment bumps the
 * interpretation version, never the identity.
 *
 * @param tenantId the owning tenant
 * @param deviceId the device
 * @param code the machine-stable finding code
 * @returns the `sec_`-prefixed finding id
 */
export function securityFindingId(tenantId: TenantId, deviceId: DeviceId, code: string): string {
  return `sec_${fnv1a32Hex(canonicalJson([tenantId, deviceId, code]))}`;
}

/**
 * The deterministic finding RECORD identity: digest of (tenantId,
 * deviceId, code, interpretationVersion). Unique per version.
 */
export function securityFindingRecordId(
  tenantId: TenantId,
  deviceId: DeviceId,
  code: string,
  interpretationVersion: number,
): string {
  return `secfnd_${fnv1a32Hex(canonicalJson([tenantId, deviceId, code, interpretationVersion]))}`;
}

// ---------------------------------------------------------------------------
// The v1 `device.security` payload recognition vocabulary
// ---------------------------------------------------------------------------

/** The maximum screen-lock delay (seconds) the v1 model accepts. */
export const MAX_SCREEN_LOCK_SECONDS = 300;

/**
 * The recognition vocabulary for `device.security` observation payloads
 * at payload schema version 1. Fields are OPTIONAL: an observation may
 * report any subset. Unknown fields are TOLERATED (forward
 * compatibility); unknown shapes are SKIPPED with machine reasons.
 */
export interface SecurityPayloadV1 {
  readonly diskEncryption?: boolean;
  readonly screenLock?: { readonly enabled: boolean; readonly maxLockSeconds?: number };
  readonly firewall?: { readonly enabled: boolean };
  readonly endpointProtection?: { readonly enabled: boolean; readonly upToDate?: boolean };
  readonly osUpdates?: { readonly supported?: boolean; readonly pendingCritical?: number };
  readonly malware?: { readonly activeDetections?: number };
}

/** The machine-stable skip reasons of the derivation. */
export type PostureSkipReason =
  | "kind_not_security"
  | "payload_version_unsupported"
  | "payload_unrecognized"
  | "payload_invalid";

/** A skipped observation with its machine-stable reason. */
export interface PostureSkip {
  readonly observationId: ObservationId;
  readonly kind: string;
  readonly reason: PostureSkipReason;
}

// ---------------------------------------------------------------------------
// The deterministic rule library
// ---------------------------------------------------------------------------

/**
 * A posture derivation rule: an ordered, frozen table entry mapping a
 * recognized payload fact to a finding definition. Rules fire
 * independently; multiple observations supporting the same rule merge
 * into ONE finding (evidence sorted by observation id).
 */
interface PostureRule {
  readonly code: string;
  readonly title: string;
  readonly severity: SecuritySeverity;
  readonly classification: SecurityFindingClassification;
  readonly fires: (payload: SecurityPayloadV1) => boolean;
}

/**
 * The ordered posture rule library (v1). The order is part of the
 * deterministic model; findings are re-sorted by severity/code at the
 * end regardless.
 */
export const POSTURE_RULE_LIBRARY: readonly PostureRule[] = Object.freeze([
  Object.freeze({
    code: "security.device.disk_encryption.off",
    title: "Disk encryption is disabled",
    severity: "CRITICAL",
    classification: "compliance",
    fires: (p: SecurityPayloadV1) => p.diskEncryption === false,
  }),
  Object.freeze({
    code: "security.device.screen_lock.disabled",
    title: "Screen lock is disabled",
    severity: "MEDIUM",
    classification: "configuration",
    fires: (p: SecurityPayloadV1) => p.screenLock?.enabled === false,
  }),
  Object.freeze({
    code: "security.device.screen_lock.max_seconds_exceeded",
    title: "Screen lock delay exceeds the allowed maximum",
    severity: "LOW",
    classification: "configuration",
    fires: (p: SecurityPayloadV1) =>
      p.screenLock?.enabled === true &&
      typeof p.screenLock.maxLockSeconds === "number" &&
      p.screenLock.maxLockSeconds > MAX_SCREEN_LOCK_SECONDS,
  }),
  Object.freeze({
    code: "security.device.firewall.disabled",
    title: "Host firewall is disabled",
    severity: "HIGH",
    classification: "configuration",
    fires: (p: SecurityPayloadV1) => p.firewall?.enabled === false,
  }),
  Object.freeze({
    code: "security.device.endpoint_protection.disabled",
    title: "Endpoint protection is disabled",
    severity: "HIGH",
    classification: "threat",
    fires: (p: SecurityPayloadV1) => p.endpointProtection?.enabled === false,
  }),
  Object.freeze({
    code: "security.device.endpoint_protection.outdated",
    title: "Endpoint protection signatures are out of date",
    severity: "MEDIUM",
    classification: "threat",
    fires: (p: SecurityPayloadV1) => p.endpointProtection?.upToDate === false,
  }),
  Object.freeze({
    code: "security.device.os_unsupported",
    title: "Operating system is out of support",
    severity: "CRITICAL",
    classification: "exposure",
    fires: (p: SecurityPayloadV1) => p.osUpdates?.supported === false,
  }),
  Object.freeze({
    code: "security.device.os_updates.critical_pending",
    title: "Critical OS updates are pending",
    severity: "HIGH",
    classification: "exposure",
    fires: (p: SecurityPayloadV1) =>
      typeof p.osUpdates?.pendingCritical === "number" && p.osUpdates.pendingCritical > 0,
  }),
  Object.freeze({
    code: "security.device.malware.active_detections",
    title: "Active malware detections present",
    severity: "CRITICAL",
    classification: "threat",
    fires: (p: SecurityPayloadV1) =>
      typeof p.malware?.activeDetections === "number" && p.malware.activeDetections > 0,
  }),
]);

// ---------------------------------------------------------------------------
// Payload recognition (pure, tolerant, deterministic)
// ---------------------------------------------------------------------------

const RECOGNIZED_KEYS: readonly string[] = Object.freeze([
  "diskEncryption",
  "screenLock",
  "firewall",
  "endpointProtection",
  "osUpdates",
  "malware",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recognize a `device.security` payload at schema version 1. Returns:
 *   - `{ ok: true, payload }` — the recognized subset (unknown keys
 *     tolerated and dropped);
 *   - `{ ok: false, reason: "payload_unrecognized" }` — no recognized
 *     key at all (a shape the v1 model does not know);
 *   - `{ ok: false, reason: "payload_invalid" }` — a recognized key with
 *     an invalid value type (the observation is not interpretable).
 */
function recognizeSecurityPayload(
  raw: unknown,
): { ok: true; payload: SecurityPayloadV1 } | { ok: false; reason: "payload_unrecognized" | "payload_invalid" } {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "payload_unrecognized" };
  }
  let recognized = false;
  for (const key of RECOGNIZED_KEYS) {
    if (!(key in raw)) continue;
    recognized = true;
    if (!fieldValid(key, raw[key])) {
      return { ok: false, reason: "payload_invalid" };
    }
  }
  if (!recognized) {
    return { ok: false, reason: "payload_unrecognized" };
  }
  const payload: SecurityPayloadV1 = {
    diskEncryption: typeof raw["diskEncryption"] === "boolean" ? raw["diskEncryption"] : undefined,
    screenLock: isPlainObject(raw["screenLock"])
      ? {
          enabled: raw["screenLock"]["enabled"] === true,
          maxLockSeconds:
            typeof raw["screenLock"]["maxLockSeconds"] === "number"
              ? raw["screenLock"]["maxLockSeconds"]
              : undefined,
        }
      : undefined,
    firewall: isPlainObject(raw["firewall"])
      ? { enabled: raw["firewall"]["enabled"] === true }
      : undefined,
    endpointProtection: isPlainObject(raw["endpointProtection"])
      ? {
          enabled: raw["endpointProtection"]["enabled"] === true,
          upToDate:
            typeof raw["endpointProtection"]["upToDate"] === "boolean"
              ? raw["endpointProtection"]["upToDate"]
              : undefined,
        }
      : undefined,
    osUpdates: isPlainObject(raw["osUpdates"])
      ? {
          supported:
            typeof raw["osUpdates"]["supported"] === "boolean" ? raw["osUpdates"]["supported"] : undefined,
          pendingCritical:
            typeof raw["osUpdates"]["pendingCritical"] === "number"
              ? raw["osUpdates"]["pendingCritical"]
              : undefined,
        }
      : undefined,
    malware: isPlainObject(raw["malware"])
      ? {
          activeDetections:
            typeof raw["malware"]["activeDetections"] === "number"
              ? raw["malware"]["activeDetections"]
              : undefined,
        }
      : undefined,
  };
  return { ok: true, payload };
}

function fieldValid(key: string, value: unknown): boolean {
  switch (key) {
    case "diskEncryption":
      return typeof value === "boolean";
    case "screenLock":
      return (
        isPlainObject(value) &&
        typeof value["enabled"] === "boolean" &&
        (value["maxLockSeconds"] === undefined || typeof value["maxLockSeconds"] === "number")
      );
    case "firewall":
      return isPlainObject(value) && typeof value["enabled"] === "boolean";
    case "endpointProtection":
      return (
        isPlainObject(value) &&
        typeof value["enabled"] === "boolean" &&
        (value["upToDate"] === undefined || typeof value["upToDate"] === "boolean")
      );
    case "osUpdates":
      return (
        isPlainObject(value) &&
        (value["supported"] === undefined || typeof value["supported"] === "boolean") &&
        (value["pendingCritical"] === undefined || typeof value["pendingCritical"] === "number")
      );
    case "malware":
      return (
        isPlainObject(value) &&
        (value["activeDetections"] === undefined || typeof value["activeDetections"] === "number")
      );
    default:
      return true; // unknown keys are tolerated
  }
}

// ---------------------------------------------------------------------------
// Posture assessment (pure derivation)
// ---------------------------------------------------------------------------

/** Input for `assessSecurityPosture`. */
export interface AssessSecurityPostureInput extends TenantScoped {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The device being assessed. */
  readonly deviceId: DeviceId;
  /** The canonical observations to derive from (frozen contracts shapes). */
  readonly observations: readonly Observation[];
  /** The injected assessment instant. */
  readonly at: string;
  /**
   * The prior ledger history (optional) — stamps interpretation versions
   * and `supersedes` links (versioned-interpretation discipline).
   */
  readonly history?: readonly FindingsLedgerEntry[];
}

/** The derived posture of one device at one assessment instant. */
export interface SecurityPosture extends TenantScoped {
  /** The tenant scope (structural tenant isolation). */
  readonly tenantId: TenantId;
  /** The assessed device. */
  readonly deviceId: DeviceId;
  /** The posture model version (see `SECURITY_POSTURE_MODEL_VERSION`). */
  readonly postureModelVersion: number;
  /** The derived status (most severe finding wins). */
  readonly status: SecurityPostureStatus;
  /** The injected assessment instant. */
  readonly assessedAt: string;
  /** Counts of derived findings per severity. */
  readonly severityCounts: Readonly<Record<SecuritySeverity, number>>;
  /** The derived findings, sorted by (severity rank desc, code asc). */
  readonly findings: readonly SecurityFinding[];
}

/** The tagged assessment result. */
export type SecurityPostureAssessment =
  | {
      readonly ok: true;
      readonly posture: SecurityPosture;
      /** Observations skipped with machine-stable reasons (observationId order). */
      readonly skipped: readonly PostureSkip[];
    }
  | { readonly ok: false; readonly error: FleetError };

/**
 * Derive the security posture of a device from canonical observations.
 * PURE: every input (observations, instant, history) is injected; no
 * clock reads, no entropy. Deterministic: the same inputs produce
 * byte-identical findings regardless of observation input order.
 *
 * @param input the assessment input
 * @returns the tagged assessment result
 */
export function assessSecurityPosture(input: AssessSecurityPostureInput): SecurityPostureAssessment {
  const failures: { path: string; reason: string }[] = [];
  if (typeof input?.tenantId !== "string" || input.tenantId.length === 0) {
    failures.push({ path: "/tenantId", reason: "required" });
  }
  if (typeof input?.deviceId !== "string" || input.deviceId.length === 0) {
    failures.push({ path: "/deviceId", reason: "required" });
  }
  if (typeof input?.at !== "string" || !looksLikeIso(input.at)) {
    failures.push({ path: "/at", reason: "not_iso" });
  }
  if (!Array.isArray(input?.observations)) {
    failures.push({ path: "/observations", reason: "array_required" });
  } else {
    for (let i = 0; i < input.observations.length; i++) {
      const obs = input.observations[i];
      if (
        !isPlainObject(obs) ||
        typeof obs.id !== "string" ||
        obs.id.length === 0 ||
        typeof obs.kind !== "string" ||
        obs.kind.length === 0
      ) {
        failures.push({ path: `/observations/${i}`, reason: "bad_observation" });
      }
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: makeValidationError(
        ERROR_CODES.postureInvalid,
        "security posture assessment request is invalid",
        {
          tenantId: typeof input?.tenantId === "string" && input.tenantId.length > 0
            ? input.tenantId
            : SYNTHETIC_SYSTEM_TENANT,
          correlationId: SECURITY_PIPELINE_CORRELATION_ID,
        },
        failures,
      ),
    };
  }

  // Phase 1 — recognize security observations; skip the rest with
  // machine-stable reasons.
  const recognized: { observation: Observation; payload: SecurityPayloadV1 }[] = [];
  const skips: PostureSkip[] = [];
  for (const observation of input.observations) {
    if (observation.kind !== "device.security") {
      skips.push(
        frozen({ observationId: observation.id, kind: observation.kind, reason: "kind_not_security" }),
      );
      continue;
    }
    if (observation.schemaVersion !== 1) {
      skips.push(
        frozen({
          observationId: observation.id,
          kind: observation.kind,
          reason: "payload_version_unsupported",
        }),
      );
      continue;
    }
    const recognition = recognizeSecurityPayload(observation.payload);
    if (!recognition.ok) {
      skips.push(frozen({ observationId: observation.id, kind: observation.kind, reason: recognition.reason }));
      continue;
    }
    recognized.push({ observation, payload: recognition.payload });
  }

  // Phase 2 — run the ordered rule library; merge multiple supporting
  // observations into ONE finding per rule (evidence in observationId
  // order — input-order invariant).
  const evidenceByCode = new Map<string, FindingEvidence[]>();
  const observedAtByCode = new Map<string, string>();
  for (const rule of POSTURE_RULE_LIBRARY) {
    for (const { observation, payload } of recognized) {
      if (!rule.fires(payload)) continue;
      const list = evidenceByCode.get(rule.code) ?? [];
      list.push(frozen({ observationId: observation.id, kind: observation.kind }));
      evidenceByCode.set(rule.code, list);
      const prior = observedAtByCode.get(rule.code);
      if (prior === undefined || observation.observedAt > prior) {
        observedAtByCode.set(rule.code, observation.observedAt);
      }
    }
  }

  // Phase 3 — stamp versions from the prior history (supersession
  // discipline: new records supersede, never rewrite).
  const history = input.history ?? [];
  const findings: SecurityFinding[] = [];
  for (const rule of POSTURE_RULE_LIBRARY) {
    const evidence = evidenceByCode.get(rule.code);
    if (evidence === undefined) continue; // rule did not fire
    evidence.sort((a, b) => (a.observationId < b.observationId ? -1 : 1));
    const findingId = securityFindingId(input.tenantId, input.deviceId, rule.code);
    const priorVersion = latestFindingVersion(history, input.deviceId, findingId);
    const priorRecordId =
      priorVersion > 0
        ? securityFindingRecordId(input.tenantId, input.deviceId, rule.code, priorVersion)
        : undefined;
    const version = priorVersion + 1;
    const remediation: SecurityRemediationProposal | undefined =
      rule.severity === "CRITICAL" || rule.severity === "HIGH"
        ? frozen({
            intentKind: SECURITY_REMEDIATION_INTENT_KIND,
            payload: frozen({
              deviceId: input.deviceId,
              findingId,
              description: `Remediate ${rule.code} (${rule.severity}): ${rule.title}`,
            }),
          })
        : undefined;
    findings.push(
      frozen({
        findingId,
        recordId: securityFindingRecordId(input.tenantId, input.deviceId, rule.code, version),
        tenantId: input.tenantId,
        deviceId: input.deviceId,
        code: rule.code,
        title: rule.title,
        severity: rule.severity,
        classification: rule.classification,
        interpretationVersion: version,
        supersedes: priorRecordId,
        detectedAt: input.at,
        observedAt: observedAtByCode.get(rule.code) ?? input.at,
        evidence: frozenArray(evidence),
        remediation,
      }),
    );
  }

  // Deterministic output order: severity rank desc, then code asc.
  findings.sort((a, b) =>
    SECURITY_SEVERITY_RANK[b.severity] !== SECURITY_SEVERITY_RANK[a.severity]
      ? SECURITY_SEVERITY_RANK[b.severity] - SECURITY_SEVERITY_RANK[a.severity]
      : a.code < b.code
        ? -1
        : a.code > b.code
          ? 1
          : 0,
  );
  skips.sort((a, b) => (a.observationId < b.observationId ? -1 : 1));

  const severityCounts: Record<SecuritySeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  for (const finding of findings) {
    severityCounts[finding.severity]++;
  }

  // Status: the most severe finding wins (LOW alone stays HEALTHY in
  // model v1 — documented).
  let status: SecurityPostureStatus = "HEALTHY";
  if (severityCounts.CRITICAL > 0) status = "CRITICAL";
  else if (severityCounts.HIGH > 0) status = "AT_RISK";
  else if (severityCounts.MEDIUM > 0) status = "DEGRADED";

  return {
    ok: true,
    posture: frozen({
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      postureModelVersion: SECURITY_POSTURE_MODEL_VERSION,
      status,
      assessedAt: input.at,
      severityCounts: frozen(severityCounts),
      findings: frozenArray(findings),
    }),
    skipped: frozenArray(skips),
  };
}

/** The latest interpretation version of a finding in the history (0 when absent). */
function latestFindingVersion(
  history: readonly FindingsLedgerEntry[],
  deviceId: DeviceId,
  findingId: string,
): number {
  let latest = 0;
  for (const entry of history) {
    if (entry.kind !== "finding") continue;
    if (entry.finding.deviceId !== deviceId) continue;
    if (entry.finding.findingId !== findingId) continue;
    if (entry.finding.interpretationVersion > latest) {
      latest = entry.finding.interpretationVersion;
    }
  }
  return latest;
}
