import { describe, expect, test } from "bun:test";
import {
  decideDeploymentPlan,
  makeDeploymentManifest,
  makeDeploymentPlan,
} from "../src/deployment";
import { asTenantId } from "@fleetos/contracts";

const TENANT = asTenantId("tnt_ops_deploy");
const NOW = "2026-09-28T12:00:00Z";

const GOOD_MANIFEST = {
  components: [
    { name: "@fleetos/audit", contentDigest: "aaaaaaaa" },
    { name: "@fleetos/contracts", contentDigest: "bbbbbbbb" },
  ],
  environment: "production",
  tenantId: TENANT,
  createdAt: NOW,
  releaseLabel: "release-2026-09-28",
};

describe("W080 D1 — deployment manifests", () => {
  test("a well-formed manifest is content-addressed and byte-stable", () => {
    const a = makeDeploymentManifest(GOOD_MANIFEST);
    const b = makeDeploymentManifest({ ...GOOD_MANIFEST, components: [...GOOD_MANIFEST.components].reverse() });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    if (!b.ok) return;
    // Input component order does NOT change the manifest id (sorted at construction).
    expect(a.manifest.manifestId).toBe(b.manifest.manifestId);
    expect(a.manifest.components[0].name).toBe("@fleetos/audit");
    expect(a.manifest.schemaVersion).toBe(1);
    expect(a.manifest.manifestId).toHaveLength(8);
  });

  test("different content => different manifest id (determinism discipline)", () => {
    const a = makeDeploymentManifest(GOOD_MANIFEST);
    const b = makeDeploymentManifest({ ...GOOD_MANIFEST, releaseLabel: "release-2026-09-29" });
    if (!a.ok || !b.ok) throw new Error("expected both ok");
    expect(a.manifest.manifestId).not.toBe(b.manifest.manifestId);
  });

  test("malformed manifests refuse machine-stably with SORTED accumulated reasons", () => {
    const bad = makeDeploymentManifest({
      components: [
        { name: "", contentDigest: "zz" },
        { name: "x", contentDigest: "zzz" },
        { name: "x", contentDigest: "aaaaaaaa" },
      ],
      environment: "prod",
      tenantId: "",
      createdAt: "not-a-date",
      releaseLabel: "",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const reasons = [...bad.reasons];
    const sorted = [...bad.reasons].sort();
    expect(reasons).toEqual(sorted);
    expect(reasons).toContain("component_name_required");
    expect(reasons).toContain("duplicate_component");
    expect(reasons).toContain("component_digest_malformed");
    expect(reasons).toContain("environment_invalid");
    expect(reasons).toContain("tenant_id_required");
    expect(reasons).toContain("release_label_required");
  });

  test("a non-object input refuses input_required", () => {
    const bad = makeDeploymentManifest(null);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toEqual(["input_required"]);
  });
});

describe("W080 D1 — deployment plans (PROPOSAL-gated, human approval)", () => {
  test("a plan over a matching manifest is PROPOSED with a deterministic id", () => {
    const manifest = makeDeploymentManifest(GOOD_MANIFEST);
    if (!manifest.ok) throw new Error("manifest expected");
    const plan = makeDeploymentPlan({
      manifest: GOOD_MANIFEST,
      environment: "production",
      proposedAt: NOW,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.status).toBe("PROPOSED");
    expect(plan.plan.decision).toBeUndefined();
    expect(plan.plan.manifest.manifestId).toBe(manifest.manifest.manifestId);
    const again = makeDeploymentPlan({ manifest: GOOD_MANIFEST, environment: "production", proposedAt: NOW });
    if (!again.ok) throw new Error("expected ok");
    expect(again.plan.planId).toBe(plan.plan.planId);
  });

  test("environment mismatch refuses machine-stably", () => {
    const plan = makeDeploymentPlan({
      manifest: GOOD_MANIFEST,
      environment: "staging",
      proposedAt: NOW,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.kind).toBe("environment_mismatch");
    if (plan.kind === "environment_mismatch") {
      expect(plan.expected).toBe("production");
      expect(plan.actual).toBe("staging");
    }
  });

  test("an unknown superseded target refuses (never guessed)", () => {
    const plan = makeDeploymentPlan({
      manifest: GOOD_MANIFEST,
      environment: "production",
      supersedes: "deadbeef",
      knownManifestIds: ["00000000", "11111111"],
      proposedAt: NOW,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.kind).toBe("plan_malformed");
    if (plan.kind === "plan_malformed") expect(plan.reasons).toEqual(["superseded_target_unknown"]);
  });

  test("the human decision transitions PROPOSED -> APPROVED; non-PROPOSED refuses", () => {
    const plan = makeDeploymentPlan({ manifest: GOOD_MANIFEST, environment: "production", proposedAt: NOW });
    if (!plan.ok) throw new Error("expected ok");
    const decided = decideDeploymentPlan(plan.plan, {
      status: "APPROVED",
      decidedBy: "usr_operator",
      decidedAt: "2026-09-28T12:30:00Z",
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.plan.status).toBe("APPROVED");
    expect(decided.plan.decision?.decidedBy).toBe("usr_operator");

    // Re-deciding an already-decided plan refuses machine-stably.
    const reDecided = decideDeploymentPlan(decided.plan, {
      status: "REJECTED",
      decidedBy: "usr_operator",
      decidedAt: "2026-09-28T13:00:00Z",
    });
    expect(reDecided.ok).toBe(false);
    if (reDecided.ok) return;
    expect(reDecided.kind).toBe("plan_not_proposed");
  });

  test("a decision before the proposal refuses (temporal discipline)", () => {
    const plan = makeDeploymentPlan({ manifest: GOOD_MANIFEST, environment: "production", proposedAt: NOW });
    if (!plan.ok) throw new Error("expected ok");
    const bad = decideDeploymentPlan(plan.plan, {
      status: "APPROVED",
      decidedBy: "usr_operator",
      decidedAt: "2026-09-28T11:00:00Z",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.kind).toBe("decision_malformed");
    if (bad.kind === "decision_malformed") expect(bad.reasons).toEqual(["decided_before_proposed"]);
  });
});
