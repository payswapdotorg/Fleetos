/**
 * @fleetos/device-adapters — W030: Shared in-memory seam machinery.
 *
 * The deterministic scripting/recording/evidence machinery shared by the
 * W030 in-memory family seams (`seams-inmemory-mobile.ts`,
 * `seams-inmemory-printer.ts`). Mirrors the W020 desktop fakes'
 * discipline (`seams-inmemory.ts`) without touching the accepted W020
 * module:
 *
 *   - scripted per-capability outcomes (first match wins; unscripted
 *     capabilities succeed deterministically),
 *   - content-addressed evidence over the canonical JSON of the platform
 *     command (FNV-1a — a TEST hash, never for security),
 *   - invocation recording (`calls()` / `reset()`) so tests can prove
 *     the SDK never reaches the seam on refusal,
 *   - scripted capability probes.
 *
 * No clock, no entropy, no network: two fakes built with the same
 * options behave identically, byte-for-byte (verified by test).
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import type { AdapterCapabilities, EvidenceRef } from "@fleetos/contracts";
import { canonicalJson, fnv1a32Hex, frozen, frozenArray } from "./internal";
import type { ObservationRecord } from "./observations";
import type { ScriptedSeamOutcome, SeamCallRecord } from "./seams-inmemory";
import type { SeamCapabilityProbe, SeamCommandResult } from "./seams";

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/** The mutable recording slot behind a recording in-memory seam. */
export interface SeamRecorder {
  readonly records: SeamCallRecord[];
}

/** Record an invocation on the recorder. */
export function recordSeamCall(
  recorder: SeamRecorder,
  surface: SeamCallRecord["surface"],
  method: string,
  detail: unknown,
): void {
  recorder.records.push({ surface, method, detail });
}

/** Snapshot the recorded invocations (frozen copy, call order). */
export function snapshotSeamCalls(recorder: SeamRecorder): readonly SeamCallRecord[] {
  return frozenArray(recorder.records);
}

/** Clear the recorded invocations (scripted data is preserved). */
export function resetSeamRecorder(recorder: SeamRecorder): void {
  recorder.records.length = 0;
}

// ---------------------------------------------------------------------------
// Scripted outcomes + results
// ---------------------------------------------------------------------------

/**
 * Resolve the scripted outcome for a capability (first match wins).
 * Mirrors the W020 fakes' `scriptedOutcomeFor`.
 */
export function scriptedOutcomeFor(
  outcomes: readonly ScriptedSeamOutcome[],
  capability: string,
): ScriptedSeamOutcome | undefined {
  return outcomes.find((outcome) => outcome.capability === capability);
}

/**
 * Content-addressed evidence for a platform/family command. Same scheme
 * as the W020 desktop fakes: the key is
 * `seam://<platform>/<capability>/<fnv1a32-of-canonical-json>`; FNV-1a
 * is a TEST hash — never for security (the contracts `EvidenceRef`
 * carries the algorithm name so this stays explicit).
 */
export function familySeamEvidenceFor(
  platform: string,
  capability: string,
  command: unknown,
): EvidenceRef {
  const canonical = canonicalJson({ capability, command });
  const hash = fnv1a32Hex(canonical);
  return frozen<EvidenceRef>({
    key: `seam://${platform}/${capability}/${hash}`,
    sizeBytes: canonical.length,
    hash,
    hashAlgorithm: "fnv1a32",
  });
}

/**
 * Build the normalized platform-command result for a typed family
 * command: the scripted outcome if one matches the capability (first
 * match wins), else a deterministic success carrying the command. Pure
 * function of (platform, capability, command, scripted outcomes).
 */
export function familySeamResultFor(
  platform: string,
  capability: string,
  command: unknown,
  outcomes: readonly ScriptedSeamOutcome[],
): SeamCommandResult {
  const evidence = frozenArray([familySeamEvidenceFor(platform, capability, command)]);
  const scripted = scriptedOutcomeFor(outcomes, capability);
  if (scripted !== undefined && scripted.status === "failed") {
    return frozen({
      status: "failed" as const,
      evidence,
      failure: frozen({
        kind: scripted.failureKind ?? "adapter_internal",
        message: scripted.message ?? `scripted failure for capability "${capability}" on ${platform}`,
      }),
    });
  }
  return frozen({
    status: "succeeded" as const,
    evidence,
    output: frozen({
      platform,
      capability,
      scripted: scripted !== undefined,
      command,
    }),
  });
}

/** Frozen copy of scripted observation records (persistent fixtures). */
export function scriptedObservationsCopy(
  records: readonly ObservationRecord[],
): readonly ObservationRecord[] {
  return frozenArray(records);
}

// ---------------------------------------------------------------------------
// Capability probe
// ---------------------------------------------------------------------------

/** Build the family capability probe with invocation recording. */
export function familyProbeFor(
  platform: string,
  recorder: SeamRecorder,
  probed: AdapterCapabilities | undefined,
): SeamCapabilityProbe {
  return frozen({
    probeId: `inmemory-${platform}-probe`,
    probe: (): AdapterCapabilities => {
      recordSeamCall(recorder, "probe", "probe", null);
      return frozen({ ...probed }) as AdapterCapabilities;
    },
  });
}
