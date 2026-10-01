/**
 * @fleetos/agent — W100A: reproducible agent release packaging.
 *
 * spec/install/INSTALL-AND-ENROLLMENT-CONTRACT.md: "The implementation
 * should publish reproducible, versioned artifacts for Windows, macOS
 * and Linux. Each release provides: version; platform/architecture;
 * checksum; release notes; installation command/steps; uninstall
 * steps; rollback/revoke instructions. The exact packaging technology
 * is a worker decision provided the artifact is reproducible and the
 * install contract remains stable."
 *
 * This module is that worker decision:
 *
 *   - **Reproducible.** `buildAgentRelease` is a PURE function of its
 *     inputs: same version, same payloads, same notes/steps => a
 *     byte-identical manifest (canonical JSON, artifacts in canonical
 *     target order, no clock reads — `releasedAt` is injected and
 *     recorded, but checksums and the manifest digest depend ONLY on
 *     content).
 *   - **Checksums.** A lane-local deterministic FNV-1a 64 digest over
 *     the artifact content (`checksumAlgorithm: "fnv1a64"` recorded on
 *     every artifact + verifiable via `verifyArtifactChecksum`). The
 *     repo's established deterministic-hash convention (evidence refs
 *     ride `fnv1a32`); deployments wanting a stronger digest substitute
 *     it at their packaging step — the CONTRACT here is that the
 *     checksum is content-derived, recorded, and verifiable.
 *   - **Credential-free installers (fail-closed).** Every payload is
 *     scanned by `scanInstallerPayload` BEFORE packaging: the install
 *     contract's forbidden list (DATABASE_URL, Redis credentials, R2
 *     credentials, provider access keys, permanent tenant secrets)
 *     plus the staging provider env names. A violating payload refuses
 *     the whole build machine-stably — credentials never enter an
 *     installer, by construction.
 *   - **Version/checksum/release metadata.** The manifest carries the
 *     agent module name/version/protocol version (the frozen
 *     `AgentVersionInfo` discipline), release notes, per-platform
 *     artifacts (file name, size, checksum, install command),
 *     uninstall steps, and rollback/revoke instructions.
 *
 * PURE + DETERMINISTIC: no clock, no entropy, no I/O. No `any` in
 * public signatures. No runtime dependencies.
 */

// ---------------------------------------------------------------------------
// The release target taxonomy (Windows / macOS / Linux; x64 / arm64)
// ---------------------------------------------------------------------------

/** The supported installer platforms (the install contract's three). */
export type ReleasePlatform = "windows" | "macos" | "linux";

/** The supported architectures. */
export type ReleaseArch = "x64" | "arm64";

/** One release target (platform + architecture). */
export interface ReleaseTarget {
  readonly platform: ReleasePlatform;
  readonly arch: ReleaseArch;
}

/**
 * All release targets in CANONICAL order (windows, macos, linux ×
 * x64, arm64). Manifest artifacts are always sorted into this order —
 * reproducibility is order-stable.
 */
export const ALL_RELEASE_TARGETS: readonly ReleaseTarget[] = Object.freeze([
  { platform: "windows", arch: "x64" },
  { platform: "windows", arch: "arm64" },
  { platform: "macos", arch: "x64" },
  { platform: "macos", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
] as const);

/** Is the value a release platform? */
export function isReleasePlatform(value: unknown): value is ReleasePlatform {
  return value === "windows" || value === "macos" || value === "linux";
}

/** Is the value a release arch? */
export function isReleaseArch(value: unknown): value is ReleaseArch {
  return value === "x64" || value === "arm64";
}

// ---------------------------------------------------------------------------
// The checksum (lane-local deterministic FNV-1a 64)
// ---------------------------------------------------------------------------

/** The checksum algorithm every artifact records (and verifiers check). */
export const RELEASE_CHECKSUM_ALGORITHM = "fnv1a64" as const;

/**
 * The deterministic FNV-1a 64-bit digest over a payload string,
 * hex-encoded (16 lowercase chars). Pure: the same content always
 * digests identically. This is the lane's release-checksum convention
 * (the repo's established deterministic-hash family); it is recorded
 * on every artifact so verification is explicit, never assumed.
 */
export function fnv1a64Hex(content: string): string {
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = FNV_OFFSET;
  for (let i = 0; i < content.length; i++) {
    hash ^= BigInt(content.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

// ---------------------------------------------------------------------------
// The credential-free installer scanner (fail-closed)
// ---------------------------------------------------------------------------

/**
 * The forbidden credential patterns (the install contract's "The
 * installer never contains" list + the staging provider env surface).
 * A payload containing ANY of these refuses the build.
 */
export const INSTALLER_FORBIDDEN_CREDENTIAL_PATTERNS: readonly {
  readonly pattern: string;
  readonly label: string;
}[] = Object.freeze([
  { pattern: "DATABASE_URL", label: "database connection string" },
  { pattern: "DATABASE_PASSWORD", label: "database password" },
  { pattern: "NEON_CONNECTION", label: "Neon connection string" },
  { pattern: "REDIS_URL", label: "Redis credential" },
  { pattern: "redis://", label: "Redis URL" },
  { pattern: "UPSTASH_REDIS", label: "Upstash Redis credential" },
  { pattern: "UPSTASH_TOKEN", label: "Upstash token" },
  { pattern: "R2_ACCESS_KEY_ID", label: "R2 access key" },
  { pattern: "R2_SECRET_ACCESS_KEY", label: "R2 secret key" },
  { pattern: "AWS_ACCESS_KEY_ID", label: "AWS access key" },
  { pattern: "AWS_SECRET_ACCESS_KEY", label: "AWS secret key" },
  { pattern: "APIFY_TOKEN", label: "Apify token" },
  { pattern: "RESEND_API_KEY", label: "Resend API key" },
  { pattern: "FLEETOS_TENANT_SECRET", label: "permanent tenant secret" },
  { pattern: "BOOTSTRAP_TOKEN_PERMANENT", label: "permanent bootstrap token" },
] as const);

/** The credential-scan result. */
export type InstallerPayloadScan =
  | { readonly ok: true }
  | { readonly ok: false; readonly violation: { readonly pattern: string; readonly label: string } };

/**
 * Scan an installer payload for forbidden credentials. PURE + total:
 * any forbidden pattern => a refusal naming the pattern; the caller
 * (`buildAgentRelease`) treats a refusal as fatal — credentials never
 * enter an artifact.
 */
export function scanInstallerPayload(content: string): InstallerPayloadScan {
  for (const entry of INSTALLER_FORBIDDEN_CREDENTIAL_PATTERNS) {
    if (content.includes(entry.pattern)) {
      return { ok: false, violation: { pattern: entry.pattern, label: entry.label } };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The artifact descriptor + the release manifest
// ---------------------------------------------------------------------------

/** One reproducible installer artifact. */
export interface AgentArtifactDescriptor {
  /** The target platform. */
  readonly platform: ReleasePlatform;
  /** The target architecture. */
  readonly arch: ReleaseArch;
  /** The artifact file name (derived from version + target). */
  readonly fileName: string;
  /** The artifact size in bytes (UTF-8 length of the content). */
  readonly sizeBytes: number;
  /** The content checksum (FNV-1a 64, hex). */
  readonly checksum: string;
  /** The checksum algorithm (recorded; verification is explicit). */
  readonly checksumAlgorithm: typeof RELEASE_CHECKSUM_ALGORITHM;
  /** The one-line installation command (copied verbatim by the operator). */
  readonly installCommand: string;
}

/**
 * A complete, reproducible agent release manifest. Every field is
 * content-derived or injected — never clock-read; identical inputs
 * produce the byte-identical manifest (proven by test).
 */
export interface AgentReleaseManifest {
  /** The agent module name (mirrors the package's MODULE_NAME). */
  readonly moduleName: string;
  /** The agent module version (mirrors MODULE_VERSION). */
  readonly moduleVersion: string;
  /** The check-in protocol version (mirrors AgentVersionInfo.protocolVersion). */
  readonly protocolVersion: number;
  /** The release instant (INJECTED by the caller — not a clock read). */
  readonly releasedAt: string;
  /** The release notes. */
  readonly releaseNotes: string;
  /** The artifacts in canonical target order. */
  readonly artifacts: readonly AgentArtifactDescriptor[];
  /** The uninstall steps (rendered verbatim by the install center). */
  readonly uninstallSteps: readonly string[];
  /** The rollback/revoke instructions. */
  readonly rollbackInstructions: readonly string[];
  /** The content digest over the canonical manifest (without itself). */
  readonly manifestDigest: string;
}

// ---------------------------------------------------------------------------
// The build refusal taxonomy (machine-stable)
// ---------------------------------------------------------------------------

/** The machine-stable release-build refusal reasons. */
export const RELEASE_BUILD_REFUSAL_REASONS = Object.freeze([
  "unsupported_target",
  "duplicate_target",
  "missing_target",
  "empty_payload",
  "credential_in_payload",
  "invalid_version",
] as const);

export type ReleaseBuildRefusalReason = (typeof RELEASE_BUILD_REFUSAL_REASONS)[number];

/** The human explanations for release-build refusals. */
export const RELEASE_BUILD_REFUSAL_EXPLANATIONS: Readonly<
  Record<ReleaseBuildRefusalReason, string>
> = Object.freeze({
  unsupported_target: "The artifact targets a platform or architecture this release does not support.",
  duplicate_target: "Two artifacts target the same platform and architecture; each target may appear once.",
  missing_target: "The release does not cover every supported target required for a complete build.",
  empty_payload: "An artifact payload is empty; installers are never empty files.",
  credential_in_payload:
    "An installer payload contains a forbidden credential. Installers never carry provider or tenant credentials.",
  invalid_version: "The release version metadata is malformed (expected MAJOR.MINOR.PATCH and protocol >= 1).",
} as const);

/** One release-build refusal: machine-stable reason + human explanation. */
export interface ReleaseBuildRefusal {
  readonly reason: ReleaseBuildRefusalReason;
  readonly explanation: string;
  /** The offending target, when the refusal is target-scoped. */
  readonly target?: ReleaseTarget;
}

// ---------------------------------------------------------------------------
// The installer payload template (deterministic, credential-free)
// ---------------------------------------------------------------------------

/** Options for the installer script generator. */
export interface InstallerScriptOptions {
  /** The agent module version the script installs. */
  readonly moduleVersion: string;
  /**
   * The control-plane endpoint REFERENCE. A placeholder env name
   * (e.g. "FLEETOS_CONTROL_PLANE") — never a URL with credentials
   * baked in; the script reads the endpoint from the environment at
   * install time.
   */
  readonly controlPlaneEnvRef?: string;
}

/**
 * Generate the deterministic installer script for one target. The
 * exact packaging technology decision: per-platform install scripts
 * (PowerShell for Windows, zsh for macOS, bash for Linux) that
 * reference the control-plane endpoint through the ENVIRONMENT and
 * contain NO credentials, NO tokens, NO tenant secrets — the one-time
 * bootstrap code is ENTERED by the operator at run time, never
 * embedded. PURE: same inputs => the identical script.
 */
export function installerScriptFor(
  target: ReleaseTarget,
  options: InstallerScriptOptions,
): string {
  const envRef = options.controlPlaneEnvRef ?? "FLEETOS_CONTROL_PLANE";
  const version = options.moduleVersion;
  switch (target.platform) {
    case "windows":
      return [
        "# FleetOS device agent installer (Windows)",
        `# Version: ${version} | Target: windows/${target.arch}`,
        "# The control plane endpoint comes from the environment at install",
        "# time. This script contains NO credentials and NO tenant secrets.",
        `param([string]$ControlPlane = $env:${envRef})`,
        "if (-not $ControlPlane) { Write-Error 'Control plane endpoint is required.'; exit 1 }",
        `Write-Host 'Installing FleetOS agent ${version} (windows/${target.arch})...'`,
        "Write-Host 'Enter your one-time enrollment code when prompted.'",
        "$code = Read-Host 'Enrollment code'",
        "if (-not $code) { Write-Error 'An enrollment code is required.'; exit 1 }",
        `New-Item -ItemType Directory -Force -Path '$env:ProgramFiles\\FleetOS\\agent' | Out-Null`,
        "Set-Content -Path '$env:ProgramFiles\\FleetOS\\agent\\AGENT_VERSION' -Value '" + version + "'",
        "Write-Host 'Agent staged. The agent will check in and redeem the enrollment code.'",
      ].join("\n");
    case "macos":
      return [
        "#!/bin/zsh",
        "# FleetOS device agent installer (macOS)",
        `# Version: ${version} | Target: macos/${target.arch}`,
        "# The control plane endpoint comes from the environment at install",
        "# time. This script contains NO credentials and NO tenant secrets.",
        `CONTROL_PLANE="\${${envRef}:-}"`,
        "if [[ -z \"$CONTROL_PLANE\" ]]; then echo 'Control plane endpoint is required.' >&2; exit 1; fi",
        `echo 'Installing FleetOS agent ${version} (macos/${target.arch})...'`,
        "echo 'Enter your one-time enrollment code when prompted.'",
        "read -r 'code?Enrollment code: '",
        "if [[ -z \"$code\" ]]; then echo 'An enrollment code is required.' >&2; exit 1; fi",
        "mkdir -p /usr/local/fleetos/agent",
        `printf '%s' '${version}' > /usr/local/fleetos/agent/AGENT_VERSION`,
        "echo 'Agent staged. The agent will check in and redeem the enrollment code.'",
      ].join("\n");
    case "linux":
      return [
        "#!/bin/bash",
        "# FleetOS device agent installer (Linux)",
        `# Version: ${version} | Target: linux/${target.arch}`,
        "# The control plane endpoint comes from the environment at install",
        "# time. This script contains NO credentials and NO tenant secrets.",
        `CONTROL_PLANE="\${${envRef}:-}"`,
        "if [[ -z \"$CONTROL_PLANE\" ]]; then echo 'Control plane endpoint is required.' >&2; exit 1; fi",
        `echo 'Installing FleetOS agent ${version} (linux/${target.arch})...'`,
        "echo 'Enter your one-time enrollment code when prompted.'",
        "read -r -p 'Enrollment code: ' code",
        "if [[ -z \"$code\" ]]; then echo 'An enrollment code is required.' >&2; exit 1; fi",
        "mkdir -p /opt/fleetos/agent",
        `printf '%s' '${version}' > /opt/fleetos/agent/AGENT_VERSION`,
        "echo 'Agent staged. The agent will check in and redeem the enrollment code.'",
      ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// The release builder (pure, reproducible, fail-closed)
// ---------------------------------------------------------------------------

/** One payload input for the builder. */
export interface InstallerPayloadInput {
  readonly target: ReleaseTarget;
  /** The artifact content (the installer script). */
  readonly content: string;
  /** The one-line install command (defaults to the platform runner). */
  readonly installCommand?: string;
}

/** Inputs for `buildAgentRelease`. Every instant is INJECTED. */
export interface BuildAgentReleaseInputs {
  /** The agent module version (MAJOR.MINOR.PATCH). */
  readonly moduleVersion: string;
  /** The check-in protocol version (>= 1). */
  readonly protocolVersion: number;
  /** The release instant (injected — recorded, never read from a clock). */
  readonly releasedAt: string;
  /** The release notes. */
  readonly releaseNotes: string;
  /** The payloads, one per target. */
  readonly payloads: readonly InstallerPayloadInput[];
  /** The uninstall steps. */
  readonly uninstallSteps: readonly string[];
  /** The rollback/revoke instructions. */
  readonly rollbackInstructions: readonly string[];
  /** The agent module name (default: "agent"). */
  readonly moduleName?: string;
  /**
   * Require EVERY supported target (default: true — a release is
   * complete or it is not a release; partial builds are refused).
   */
  readonly requireCompleteTargetCoverage?: boolean;
}

/** The build result. */
export type AgentReleaseBuild =
  | { readonly ok: true; readonly manifest: AgentReleaseManifest }
  | { readonly ok: false; readonly refusal: ReleaseBuildRefusal };

/**
 * Build a reproducible agent release manifest. PURE and FAIL-CLOSED:
 *
 *   - every payload is credential-scanned FIRST (a violation refuses
 *     the whole build — credentials never enter an artifact);
 *   - targets must be supported, unique, and (by default) complete;
 *   - checksums are content-derived (fnv1a64) and recorded with the
 *     algorithm name;
 *   - artifacts are sorted into the canonical target order;
 *   - the manifest digest is computed over the canonical manifest
 *     JSON without the digest field itself.
 *
 * Same inputs => the byte-identical manifest (no clock, no entropy).
 */
export function buildAgentRelease(inputs: BuildAgentReleaseInputs): AgentReleaseBuild {
  const moduleName = inputs.moduleName ?? "agent";
  const requireComplete = inputs.requireCompleteTargetCoverage ?? true;

  if (
    typeof inputs.moduleVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(inputs.moduleVersion) ||
    !Number.isInteger(inputs.protocolVersion) ||
    inputs.protocolVersion < 1
  ) {
    return {
      ok: false,
      refusal: {
        reason: "invalid_version",
        explanation: RELEASE_BUILD_REFUSAL_EXPLANATIONS.invalid_version,
      },
    };
  }

  if (!Array.isArray(inputs.payloads) || inputs.payloads.length === 0) {
    return {
      ok: false,
      refusal: {
        reason: "missing_target",
        explanation: RELEASE_BUILD_REFUSAL_EXPLANATIONS.missing_target,
      },
    };
  }

  // Fail-closed credential scan FIRST — no artifact is packaged before
  // every payload is clean.
  for (const payload of inputs.payloads) {
    if (typeof payload?.content !== "string" || payload.content.trim().length === 0) {
      return {
        ok: false,
        refusal: {
          reason: "empty_payload",
          explanation: RELEASE_BUILD_REFUSAL_EXPLANATIONS.empty_payload,
          target: payload?.target,
        },
      };
    }
    const scan = scanInstallerPayload(payload.content);
    if (!scan.ok) {
      return {
        ok: false,
        refusal: {
          reason: "credential_in_payload",
          explanation: `${RELEASE_BUILD_REFUSAL_EXPLANATIONS.credential_in_payload} Detected: ${scan.violation.label} ("${scan.violation.pattern}").`,
          target: payload.target,
        },
      };
    }
  }

  const seen = new Map<string, InstallerPayloadInput>();
  for (const payload of inputs.payloads) {
    if (!isReleasePlatform(payload?.target?.platform) || !isReleaseArch(payload?.target?.arch)) {
      return {
        ok: false,
        refusal: {
          reason: "unsupported_target",
          explanation: RELEASE_BUILD_REFUSAL_EXPLANATIONS.unsupported_target,
          target: payload?.target,
        },
      };
    }
    const key = `${payload.target.platform}/${payload.target.arch}`;
    if (seen.has(key)) {
      return {
        ok: false,
        refusal: {
          reason: "duplicate_target",
          explanation: RELEASE_BUILD_REFUSAL_EXPLANATIONS.duplicate_target,
          target: payload.target,
        },
      };
    }
    seen.set(key, payload);
  }

  if (requireComplete) {
    for (const target of ALL_RELEASE_TARGETS) {
      if (!seen.has(`${target.platform}/${target.arch}`)) {
        return {
          ok: false,
          refusal: {
            reason: "missing_target",
            explanation: RELEASE_BUILD_REFUSAL_EXPLANATIONS.missing_target,
            target,
          },
        };
      }
    }
  }

  const artifacts: AgentArtifactDescriptor[] = ALL_RELEASE_TARGETS.filter((target) =>
    seen.has(`${target.platform}/${target.arch}`),
  ).map((target) => {
    const payload = seen.get(`${target.platform}/${target.arch}`)!;
    const installCommand =
      payload.installCommand ??
      defaultInstallCommand(target, inputs.moduleVersion);
    return Object.freeze({
      platform: target.platform,
      arch: target.arch,
      fileName: artifactFileName(target, inputs.moduleVersion),
      sizeBytes: utf8ByteLength(payload.content),
      checksum: fnv1a64Hex(payload.content),
      checksumAlgorithm: RELEASE_CHECKSUM_ALGORITHM,
      installCommand,
    }) satisfies AgentArtifactDescriptor;
  });

  const manifestBody = {
    moduleName,
    moduleVersion: inputs.moduleVersion,
    protocolVersion: inputs.protocolVersion,
    releasedAt: inputs.releasedAt,
    releaseNotes: inputs.releaseNotes,
    artifacts,
    uninstallSteps: [...inputs.uninstallSteps],
    rollbackInstructions: [...inputs.rollbackInstructions],
  };
  // The manifest digest is a CONTENT digest: it covers the version
  // metadata, notes, artifacts and steps — but NOT the recorded
  // release instant. Two builds of the same source produce the same
  // digest regardless of when they were stamped (reproducible-builds
  // semantics).
  const manifestDigest = fnv1a64Hex(
    canonicalJson({
      moduleName,
      moduleVersion: inputs.moduleVersion,
      protocolVersion: inputs.protocolVersion,
      releaseNotes: inputs.releaseNotes,
      artifacts,
      uninstallSteps: [...inputs.uninstallSteps],
      rollbackInstructions: [...inputs.rollbackInstructions],
    }),
  );

  return {
    ok: true,
    manifest: Object.freeze({
      ...manifestBody,
      artifacts: Object.freeze(artifacts),
      uninstallSteps: Object.freeze([...inputs.uninstallSteps]),
      rollbackInstructions: Object.freeze([...inputs.rollbackInstructions]),
      manifestDigest,
    }),
  };
}

// ---------------------------------------------------------------------------
// Manifest consumption (lookup + verification — the install center's seam)
// ---------------------------------------------------------------------------

/** The artifact-lookup refusal. */
export interface ReleaseLookupRefusal {
  readonly reason: "unsupported_platform";
  readonly explanation: string;
  readonly platform: string;
  readonly arch: string;
}

/**
 * Find the artifact for a platform/arch pair. Unknown or absent
 * targets refuse `unsupported_platform` machine-stably (the install
 * contract's failure state — never a silent fallback to another
 * platform).
 */
export function artifactForTarget(
  manifest: AgentReleaseManifest,
  platform: string,
  arch: string,
): { readonly ok: true; readonly artifact: AgentArtifactDescriptor } | { readonly ok: false; readonly refusal: ReleaseLookupRefusal } {
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.platform === platform && candidate.arch === arch,
  );
  if (artifact === undefined) {
    return {
      ok: false,
      refusal: {
        reason: "unsupported_platform",
        explanation: `No installer artifact exists for platform "${platform}" (${arch}) in this release.`,
        platform,
        arch,
      },
    };
  }
  return { ok: true, artifact };
}

/** The checksum-verification result. */
export type ArtifactChecksumVerification =
  | { readonly ok: true; readonly matches: boolean }
  | { readonly ok: false; readonly refusal: ReleaseLookupRefusal };

/**
 * Verify an artifact's checksum against candidate content. PURE: the
 * digest is recomputed and compared — the recorded algorithm is
 * honored (only `fnv1a64` is defined by this module; any other
 * recorded algorithm refuses rather than guessing).
 */
export function verifyArtifactChecksum(
  manifest: AgentReleaseManifest,
  platform: string,
  arch: string,
  content: string,
): ArtifactChecksumVerification {
  const lookup = artifactForTarget(manifest, platform, arch);
  if (!lookup.ok) return { ok: false, refusal: lookup.refusal };
  if (lookup.artifact.checksumAlgorithm !== RELEASE_CHECKSUM_ALGORITHM) {
    return { ok: true, matches: false };
  }
  return { ok: true, matches: fnv1a64Hex(content) === lookup.artifact.checksum };
}

// ---------------------------------------------------------------------------
// Local helpers (internal)
// ---------------------------------------------------------------------------

/** The artifact file name for a target + version. */
function artifactFileName(target: ReleaseTarget, version: string): string {
  const extension = target.platform === "windows" ? "ps1" : "sh";
  return `fleetos-agent-${version}-${target.platform}-${target.arch}.${extension}`;
}

/** The default install command for a target (copied verbatim). */
function defaultInstallCommand(target: ReleaseTarget, version: string): string {
  const fileName = artifactFileName(target, version);
  switch (target.platform) {
    case "windows":
      return `powershell -ExecutionPolicy Bypass -File .\\${fileName}`;
    case "macos":
      return `zsh ./${fileName}`;
    case "linux":
      return `bash ./${fileName}`;
  }
}

/** UTF-8 byte length (the artifact size in bytes). */
function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

/**
 * Canonical JSON: object keys sorted, arrays order-preserving, string
 * escaping via JSON.stringify. Deterministic across runs and runtimes.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
