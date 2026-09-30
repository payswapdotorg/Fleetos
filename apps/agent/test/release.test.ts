/**
 * W100A tests — reproducible agent release packaging
 * (@fleetos/agent/src/release.ts).
 *
 * Proves:
 *   - the release target taxonomy is exactly Windows/macOS/Linux ×
 *     x64/arm64, in canonical order;
 *   - `buildAgentRelease` is REPRODUCIBLE: identical inputs produce a
 *     byte-identical manifest (canonical JSON, canonical artifact
 *     order, no clock reads — releasedAt is injected and does not
 *     perturb checksums);
 *   - checksums are content-derived (fnv1a64) and any content change
 *     changes the checksum + manifest digest;
 *   - `verifyArtifactChecksum` recomputes and compares (unknown
 *     algorithm => no match, never a guess);
 *   - the FAIL-CLOSED credential scanner: every forbidden pattern
 *     refuses the build (credentials never enter an installer);
 *     clean payloads pass;
 *   - the generated installer scripts are deterministic, per-platform
 *     distinct, and credential-free (the control-plane endpoint is an
 *     ENV REFERENCE; the one-time code is entered at run time);
 *   - target coverage is enforced (missing/duplicate/unsupported
 *     targets refused machine-stably);
 *   - version/checksum/release metadata discipline: MAJOR.MINOR.PATCH
 *     + protocol >= 1; artifacts carry file name, size, checksum,
 *     algorithm, install command; the manifest carries notes,
 *     uninstall steps, rollback instructions, and a content digest;
 *   - `artifactForTarget` refuses unsupported platforms machine-stably
 *     (never a silent fallback).
 */

import { describe, expect, test } from "bun:test";
import {
  ALL_RELEASE_TARGETS,
  INSTALLER_FORBIDDEN_CREDENTIAL_PATTERNS,
  RELEASE_BUILD_REFUSAL_EXPLANATIONS,
  RELEASE_CHECKSUM_ALGORITHM,
  artifactForTarget,
  buildAgentRelease,
  fnv1a64Hex,
  installerScriptFor,
  isReleaseArch,
  isReleasePlatform,
  scanInstallerPayload,
  verifyArtifactChecksum,
  type AgentReleaseManifest,
  type InstallerPayloadInput,
} from "../src/release";

const VERSION = "1.2.3";
const RELEASED_AT = "2026-03-01T00:00:00Z";

function defaultPayloads(): InstallerPayloadInput[] {
  return ALL_RELEASE_TARGETS.map((target) => ({
    target,
    content: installerScriptFor(target, { moduleVersion: VERSION }),
  }));
}

function buildDefault(): AgentReleaseManifest {
  const built = buildAgentRelease({
    moduleVersion: VERSION,
    protocolVersion: 1,
    releasedAt: RELEASED_AT,
    releaseNotes: "Initial productized agent release.",
    payloads: defaultPayloads(),
    uninstallSteps: ["Run the uninstaller from Settings > Apps.", "Remove the agent directory."],
    rollbackInstructions: [
      "Revoke the device trust from the console (authorized operators only).",
      "Reinstall the previous agent version and re-enroll with a new code.",
    ],
  });
  if (!built.ok) throw new Error(`build failed: ${built.refusal.reason}`);
  return built.manifest;
}

describe("W100A release target taxonomy", () => {
  test("the targets are exactly windows/macos/linux x x64/arm64 in canonical order", () => {
    expect(ALL_RELEASE_TARGETS.map((t) => `${t.platform}/${t.arch}`)).toEqual([
      "windows/x64",
      "windows/arm64",
      "macos/x64",
      "macos/arm64",
      "linux/x64",
      "linux/arm64",
    ]);
  });

  test("the platform/arch predicates accept exactly the taxonomy", () => {
    for (const p of ["windows", "macos", "linux"]) expect(isReleasePlatform(p)).toBe(true);
    for (const a of ["x64", "arm64"]) expect(isReleaseArch(a)).toBe(true);
    expect(isReleasePlatform("ios")).toBe(false);
    expect(isReleasePlatform("")).toBe(false);
    expect(isReleaseArch("x86")).toBe(false);
    expect(isReleaseArch(null)).toBe(false);
  });
});

describe("W100A reproducibility (the install contract's hard requirement)", () => {
  test("identical inputs produce a BYTE-IDENTICAL manifest", () => {
    const first = buildDefault();
    const second = buildDefault();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("a different releasedAt changes only the recorded instant — checksums + digest are content-derived", () => {
    const first = buildDefault();
    const later = buildAgentRelease({
      moduleVersion: VERSION,
      protocolVersion: 1,
      releasedAt: "2026-06-01T00:00:00Z",
      releaseNotes: "Initial productized agent release.",
      payloads: defaultPayloads(),
      uninstallSteps: ["Run the uninstaller from Settings > Apps.", "Remove the agent directory."],
      rollbackInstructions: [
        "Revoke the device trust from the console (authorized operators only).",
        "Reinstall the previous agent version and re-enroll with a new code.",
      ],
    });
    if (!later.ok) throw new Error("later build failed");
    expect(later.manifest.releasedAt).not.toBe(first.releasedAt);
    // Checksums AND the manifest digest depend ONLY on content — two
    // builds of the same source produce the same digest regardless of
    // the recorded release instant (reproducible-builds semantics).
    expect(later.manifest.artifacts.map((a) => a.checksum)).toEqual(
      first.artifacts.map((a) => a.checksum),
    );
    expect(later.manifest.manifestDigest).toBe(first.manifestDigest);
  });

  test("any payload content change changes that artifact's checksum + the manifest digest", () => {
    const base = buildDefault();
    const payloads = defaultPayloads();
    const idx = payloads.findIndex((p) => p.target.platform === "linux" && p.target.arch === "x64");
    payloads[idx] = {
      ...payloads[idx],
      content: `${payloads[idx].content}\n# patched`,
    };
    const patched = buildAgentRelease({
      moduleVersion: VERSION,
      protocolVersion: 1,
      releasedAt: RELEASED_AT,
      releaseNotes: "Initial productized agent release.",
      payloads,
      uninstallSteps: ["Run the uninstaller from Settings > Apps.", "Remove the agent directory."],
      rollbackInstructions: [
        "Revoke the device trust from the console (authorized operators only).",
        "Reinstall the previous agent version and re-enroll with a new code.",
      ],
    });
    if (!patched.ok) throw new Error("patched build failed");
    expect(patched.manifest.manifestDigest).not.toBe(base.manifestDigest);
    const baseLinux = artifactForTarget(base, "linux", "x64");
    const patchedLinux = artifactForTarget(patched.manifest, "linux", "x64");
    if (!baseLinux.ok || !patchedLinux.ok) throw new Error("lookup failed");
    expect(patchedLinux.artifact.checksum).not.toBe(baseLinux.artifact.checksum);
    // Untouched artifacts keep their checksums.
    expect(artifactForTarget(patched.manifest, "windows", "x64")).toEqual(artifactForTarget(base, "windows", "x64"));
  });

  test("artifacts are ordered into the canonical target order regardless of payload input order", () => {
    const manifest = buildAgentRelease({
      moduleVersion: VERSION,
      protocolVersion: 1,
      releasedAt: RELEASED_AT,
      releaseNotes: "Initial productized agent release.",
      payloads: [...defaultPayloads()].reverse(),
      uninstallSteps: ["Run the uninstaller from Settings > Apps.", "Remove the agent directory."],
      rollbackInstructions: [
        "Revoke the device trust from the console (authorized operators only).",
        "Reinstall the previous agent version and re-enroll with a new code.",
      ],
    });
    if (!manifest.ok) throw new Error("build failed");
    expect(manifest.manifest.artifacts.map((a) => `${a.platform}/${a.arch}`)).toEqual(
      ALL_RELEASE_TARGETS.map((t) => `${t.platform}/${t.arch}`),
    );
    // ...and input order does not change the manifest bytes.
    expect(JSON.stringify(manifest.manifest)).toBe(JSON.stringify(buildDefault()));
  });
});

describe("W100A checksums (content-derived, recorded, verifiable)", () => {
  test("the digest is deterministic and content-sensitive", () => {
    expect(fnv1a64Hex("agent installer")).toBe(fnv1a64Hex("agent installer"));
    expect(fnv1a64Hex("agent installer")).not.toBe(fnv1a64Hex("agent installer2"));
    expect(fnv1a64Hex("")).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64Hex("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("every artifact records its checksum + algorithm + size + file name + install command", () => {
    const manifest = buildDefault();
    for (const artifact of manifest.artifacts) {
      expect(artifact.checksumAlgorithm).toBe(RELEASE_CHECKSUM_ALGORITHM);
      expect(artifact.checksum).toMatch(/^[0-9a-f]{16}$/);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      expect(artifact.fileName).toContain(`fleetos-agent-${VERSION}-${artifact.platform}-${artifact.arch}`);
      expect(artifact.installCommand.length).toBeGreaterThan(0);
    }
  });

  test("verifyArtifactChecksum recomputes and compares", () => {
    const manifest = buildDefault();
    const payloads = defaultPayloads();
    const linux = payloads.find((p) => p.target.platform === "linux" && p.target.arch === "arm64")!;
    expect(verifyArtifactChecksum(manifest, "linux", "arm64", linux.content)).toEqual({
      ok: true,
      matches: true,
    });
    expect(verifyArtifactChecksum(manifest, "linux", "arm64", `${linux.content} tampered`)).toEqual({
      ok: true,
      matches: false,
    });
    expect(verifyArtifactChecksum(manifest, "plan9", "x64", linux.content).ok).toBe(false);
  });
});

describe("W100A the credential-free installer scanner (fail-closed)", () => {
  test("every forbidden pattern refuses the scan", () => {
    for (const entry of INSTALLER_FORBIDDEN_CREDENTIAL_PATTERNS) {
      const scan = scanInstallerPayload(`echo ${entry.pattern}=some-value`);
      expect(scan.ok).toBe(false);
      if (scan.ok) throw new Error("unreachable");
      expect(scan.violation.pattern).toBe(entry.pattern);
    }
  });

  test("clean payloads pass", () => {
    expect(scanInstallerPayload("#!/bin/bash\necho hello")).toEqual({ ok: true });
    expect(scanInstallerPayload("")).toEqual({ ok: true });
  });

  test("a credential-bearing payload refuses the whole build machine-stably", () => {
    const payloads = defaultPayloads();
    const idx = payloads.findIndex((p) => p.target.platform === "windows" && p.target.arch === "x64");
    payloads[idx] = { ...payloads[idx], content: `${payloads[idx].content}\n$env:DATABASE_URL = "postgres://..."` };
    const built = buildAgentRelease({
      moduleVersion: VERSION,
      protocolVersion: 1,
      releasedAt: RELEASED_AT,
      releaseNotes: "n",
      payloads,
      uninstallSteps: [],
      rollbackInstructions: [],
    });
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("unreachable");
    expect(built.refusal.reason).toBe("credential_in_payload");
    expect(built.refusal.explanation).toContain("DATABASE_URL");
  });

  test("the GENERATED installer scripts are credential-free (every target, every pattern)", () => {
    for (const target of ALL_RELEASE_TARGETS) {
      const script = installerScriptFor(target, { moduleVersion: VERSION });
      for (const entry of INSTALLER_FORBIDDEN_CREDENTIAL_PATTERNS) {
        expect(script.includes(entry.pattern)).toBe(false);
      }
    }
  });
});

describe("W100A generated installer scripts (deterministic, per-platform)", () => {
  test("same inputs => identical scripts; different versions => different scripts", () => {
    const target = { platform: "macos" as const, arch: "arm64" as const };
    expect(installerScriptFor(target, { moduleVersion: VERSION })).toBe(
      installerScriptFor(target, { moduleVersion: VERSION }),
    );
    expect(installerScriptFor(target, { moduleVersion: VERSION })).not.toBe(
      installerScriptFor(target, { moduleVersion: "1.2.4" }),
    );
  });

  test("the scripts reference the control plane through the ENVIRONMENT and prompt for the code", () => {
    for (const target of ALL_RELEASE_TARGETS) {
      const script = installerScriptFor(target, { moduleVersion: VERSION });
      expect(script).toContain("FLEETOS_CONTROL_PLANE");
      // The one-time code is ENTERED at run time — never embedded.
      expect(script.toLowerCase()).toContain("enrollment code");
      expect(script).toContain(VERSION);
    }
  });

  test("the three platforms produce distinct script families", () => {
    const windows = installerScriptFor({ platform: "windows", arch: "x64" }, { moduleVersion: VERSION });
    const macos = installerScriptFor({ platform: "macos", arch: "x64" }, { moduleVersion: VERSION });
    const linux = installerScriptFor({ platform: "linux", arch: "x64" }, { moduleVersion: VERSION });
    expect(windows).not.toBe(macos);
    expect(macos).not.toBe(linux);
    expect(windows).not.toBe(linux);
  });
});

describe("W100A build refusals (machine-stable + human explanations)", () => {
  function refusalOf(
    payloads: readonly InstallerPayloadInput[],
    options?: { readonly moduleVersion?: string; readonly protocolVersion?: number },
  ) {
    const built = buildAgentRelease({
      moduleVersion: options?.moduleVersion ?? VERSION,
      protocolVersion: options?.protocolVersion ?? 1,
      releasedAt: RELEASED_AT,
      releaseNotes: "n",
      payloads,
      uninstallSteps: [],
      rollbackInstructions: [],
    });
    if (built.ok) throw new Error("expected a refusal");
    return built.refusal;
  }

  test("invalid version metadata is refused", () => {
    expect(refusalOf(defaultPayloads(), { moduleVersion: "1.2" }).reason).toBe("invalid_version");
    expect(refusalOf(defaultPayloads(), { moduleVersion: "latest" }).reason).toBe("invalid_version");
    expect(refusalOf(defaultPayloads(), { protocolVersion: 0 }).reason).toBe("invalid_version");
  });

  test("missing/duplicate/unsupported targets are refused (complete coverage by default)", () => {
    expect(refusalOf(defaultPayloads().slice(0, 5)).reason).toBe("missing_target");
    const dup = [...defaultPayloads(), defaultPayloads()[0]];
    expect(refusalOf(dup).reason).toBe("duplicate_target");
    const bogus = [...defaultPayloads(), { target: { platform: "plan9" as never, arch: "x64" }, content: "x" }];
    expect(refusalOf(bogus).reason).toBe("unsupported_target");
    expect(refusalOf([]).reason).toBe("missing_target");
  });

  test("an empty payload is refused", () => {
    const payloads = defaultPayloads();
    const idx = payloads.findIndex((p) => p.target.platform === "linux" && p.target.arch === "x64");
    payloads[idx] = { ...payloads[idx], content: "   " };
    expect(refusalOf(payloads).reason).toBe("empty_payload");
  });

  test("every refusal reason carries its human explanation", () => {
    for (const reason of ["unsupported_target", "duplicate_target", "missing_target", "empty_payload", "credential_in_payload", "invalid_version"] as const) {
      expect(RELEASE_BUILD_REFUSAL_EXPLANATIONS[reason].length).toBeGreaterThan(20);
    }
  });

  test("partial coverage is possible only when explicitly opted into", () => {
    const built = buildAgentRelease({
      moduleVersion: VERSION,
      protocolVersion: 1,
      releasedAt: RELEASED_AT,
      releaseNotes: "n",
      payloads: defaultPayloads().slice(0, 3),
      uninstallSteps: [],
      rollbackInstructions: [],
      requireCompleteTargetCoverage: false,
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.manifest.artifacts.length).toBe(3);
  });
});

describe("W100A artifact lookup (unsupported platform is explicit)", () => {
  test("a supported target resolves its artifact", () => {
    const manifest = buildDefault();
    const lookup = artifactForTarget(manifest, "windows", "arm64");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) throw new Error("unreachable");
    expect(lookup.artifact.platform).toBe("windows");
    expect(lookup.artifact.arch).toBe("arm64");
  });

  test("an unsupported platform refuses machine-stably (never a silent fallback)", () => {
    const manifest = buildDefault();
    const lookup = artifactForTarget(manifest, "solaris", "x64");
    expect(lookup.ok).toBe(false);
    if (lookup.ok) throw new Error("unreachable");
    expect(lookup.refusal.reason).toBe("unsupported_platform");
    expect(lookup.refusal.explanation).toContain("solaris");
  });
});

describe("W100A release manifest metadata discipline", () => {
  test("the manifest carries version + notes + uninstall + rollback + digest", () => {
    const manifest = buildDefault();
    expect(manifest.moduleName).toBe("agent");
    expect(manifest.moduleVersion).toBe(VERSION);
    expect(manifest.protocolVersion).toBe(1);
    expect(manifest.releasedAt).toBe(RELEASED_AT);
    expect(manifest.releaseNotes).toBe("Initial productized agent release.");
    expect(manifest.uninstallSteps.length).toBe(2);
    expect(manifest.rollbackInstructions.length).toBe(2);
    expect(manifest.manifestDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(manifest.artifacts.length).toBe(ALL_RELEASE_TARGETS.length);
  });

  test("the manifest digest is the fnv1a64 over the canonical manifest CONTENT body (no release instant)", () => {
    const manifest = buildDefault();
    // Recompute: body = manifest minus the digest field and the
    // recorded release instant (the digest is content-only),
    // canonicalized.
    const { manifestDigest, releasedAt, ...body } = manifest;
    expect(releasedAt).toBe(RELEASED_AT);
    const recomputed = fnv1a64Hex(canonical(body as unknown as Record<string, unknown>));
    expect(recomputed).toBe(manifestDigest);
  });
});

// Canonical JSON mirroring the lane-local serializer (test-local copy
// so the test does not reach into module internals).
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
