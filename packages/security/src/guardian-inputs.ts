/**
 * @fleetos/security — the `security -> policy` module-map edge.
 *
 * `spec/MODULE-DEPENDENCY-MAP.md`: `security -> devices, observations,
 * policy, audit`. The devices/observations edges are honored via the
 * frozen `@fleetos/contracts` shapes (see `posture.ts`); the audit edge
 * is the injected sink seam (`audit-seam.ts`). THIS module honors the
 * policy edge with real code: it projects a derived `SecurityPosture`
 * onto the policy-owned `GuardianDevicePosture` rule-input shape, which
 * the Contract Guardian's device condition evaluates
 * (`minPostureStatus`).
 *
 * The import direction is the module map's direction (security depends
 * on policy — both are worker-b lane packages, permitted by the
 * ownership gate; policy never imports security). The projection is a
 * pure, deterministic function: no interpretation beyond the counts and
 * the status the posture model already derived — and never an intent
 * inference.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { GuardianDevicePosture } from "@fleetos/policy";
import { frozen } from "./internal";
import type { SecurityPosture } from "./posture";

/**
 * Project a derived posture onto the Contract Guardian's device-posture
 * rule input. Pure and deterministic: the counts and status pass through
 * verbatim; `assessedAt` is the posture's injected assessment instant.
 *
 * Consumers feed the result into a `GuardianRequestContext`'s device
 * facet so rules like "REQUIRE_APPROVAL when the device posture is at
 * least AT_RISK" can evaluate — the deterministic policy layer stays
 * authoritative for whether the action is permitted.
 *
 * @param posture the derived posture (from `assessSecurityPosture`)
 * @returns a frozen GuardianDevicePosture rule input
 */
export function deriveGuardianDevicePosture(posture: SecurityPosture): GuardianDevicePosture {
  return frozen({
    status: posture.status,
    criticalFindings: posture.severityCounts.CRITICAL,
    highFindings: posture.severityCounts.HIGH,
    mediumFindings: posture.severityCounts.MEDIUM,
    lowFindings: posture.severityCounts.LOW,
    assessedAt: posture.assessedAt,
  });
}

/**
 * The full device facet for a Guardian request: the device identity plus
 * the derived posture projection. Convenience for callers evaluating
 * device-scoped actions.
 *
 * @param deviceId the device the action concerns
 * @param posture the derived posture (from `assessSecurityPosture`)
 * @returns a frozen GuardianDeviceFacet
 */
export function guardianDeviceFacetFromPosture(
  deviceId: SecurityPosture["deviceId"],
  posture: SecurityPosture,
): import("@fleetos/policy").GuardianDeviceFacet {
  return frozen({
    deviceId,
    posture: deriveGuardianDevicePosture(posture),
  });
}
