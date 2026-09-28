/**
 * W060C web-workloads — the binding-site tests (the W040-disclosed
 * pattern).
 *
 * The REAL accepted domain records (W022 `WorkloadProfile` +
 * `WorkloadRecommendationLedger`, W032 `SoftwareSubscription`, W042
 * `ServiceWorkOrder`, W050A `ConnectivitySubmissionRecord`) are injected
 * through the structural seams: TypeScript structural typing accepts
 * them at the type level (the assignability assertions below), and these
 * tests are the runtime proof that every record flows through and
 * derives the right view-model values. The ownership gate permits these
 * cross-lane imports ONLY in test/ (src/ consumes the seams, never the
 * packages).
 */

import { test, expect } from "bun:test";
import {
  buildWorkloadProfileListView,
  buildWorkloadRecommendationDisplay,
  buildWorkloadResourceLinkageView,
  deriveRecommendationStatus,
  selectRecommendationRow,
  selectResourceKindRows,
  type ConnectivityResourceFacets,
  type HardwareResourceFacets,
  type MaintenanceResourceFacets,
  type RecommendationLedgerFacets,
  type SoftwareResourceFacets,
  type WorkloadProfileFacets,
} from "../src/index";
import type { WorkloadProfile, WorkloadRecommendationLedger } from "@fleetos/workloads";
import type { SoftwareSubscription } from "@fleetos/software";
import type { ServiceWorkOrder } from "@fleetos/maintenance";
import type { ConnectivitySubmissionRecord } from "@fleetos/integration-adcos";
import {
  CORR,
  TENANT_A,
  TENANT_B,
  fieldedLaptopCandidate,
  procurementWorkstationCandidate,
  realLedger,
  realParkedSubmission,
  realProfile,
  realSubscription,
  realWorkOrder,
} from "./helpers";
import { asWorkloadId } from "@fleetos/contracts";

// ---------------------------------------------------------------------------
// The type-level proofs: the REAL records satisfy the seams
// ---------------------------------------------------------------------------

test("TYPE PROOF: the real W022 WorkloadProfile satisfies WorkloadProfileFacets", () => {
  const profile: WorkloadProfile = realProfile();
  const seam: WorkloadProfileFacets = profile;
  expect(seam.workloadId).toBe(profile.workloadId);
  expect(seam.contentHash).toBe(profile.contentHash);
});

test("TYPE PROOF: the real W022 ledger satisfies RecommendationLedgerFacets", () => {
  const ledger: WorkloadRecommendationLedger = realLedger();
  const seam: RecommendationLedgerFacets = ledger;
  expect(seam.entries.length).toBe(ledger.entries.length);
});

test("TYPE PROOF: the real W032 SoftwareSubscription satisfies SoftwareResourceFacets", () => {
  const subscription: SoftwareSubscription = realSubscription();
  const seam: SoftwareResourceFacets = subscription;
  expect(seam.subscriptionId).toBe(subscription.subscriptionId);
});

test("TYPE PROOF: the real W042 ServiceWorkOrder satisfies MaintenanceResourceFacets", () => {
  const workOrder: ServiceWorkOrder = realWorkOrder();
  const seam: MaintenanceResourceFacets = workOrder;
  expect(seam.workOrderId).toBe(workOrder.workOrderId);
});

test("TYPE PROOF: the real W050A ConnectivitySubmissionRecord satisfies ConnectivityResourceFacets", () => {
  const submission: ConnectivitySubmissionRecord = realParkedSubmission();
  const seam: ConnectivityResourceFacets = submission;
  expect(seam.submissionId).toBe(submission.submissionId);
  expect(seam.status).toBe("PARKED");
});

// ---------------------------------------------------------------------------
// The listing surface over the REAL profile
// ---------------------------------------------------------------------------

test("the listing derives deterministic rows from the real W022 profile", () => {
  const profile = realProfile();
  const result = buildWorkloadProfileListView(TENANT_A, [profile]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const row = result.view.rows[0];
  expect(row).toBeDefined();
  expect(row?.workloadId).toBe(profile.workloadId);
  expect(row?.name).toBe("finance.analyst");
  expect(row?.revision).toBe(1);
  expect(row?.contentHash).toBe(profile.contentHash);
  expect(row?.constraints.requiredApplications).toBe(1);
  expect(row?.constraints.environments).toBe(2);
  expect(row?.constraints.peripherals).toBe(2);
  expect(row?.constraints.classification).toBe("confidential");
  expect(row?.evidenceCount).toBe(1);
  expect(row?.workingHours?.startHour).toBe(8);
  // Requirement highlights: value desc, name asc tie-break — the two 0.7s
  // (cpuDemand, downtimeSensitivity) sort by name, then mobility 0.9 is
  // first. mobility 0.9 > 0.8 power > 0.7 (cpu, downtime).
  expect(row?.requirementHighlights.map((h) => h.dimension)).toEqual([
    "mobilityDemand",
    "powerDependence",
    "cpuDemand",
  ]);
  expect(result.view.bySubjectKind).toEqual({ role: 1 });
});

test("the listing is order-independent (rows sort by workloadId)", () => {
  const a = realProfile();
  const pZ = { ...a, workloadId: asWorkloadId("wl_w060c_zzzz"), name: "z.first" };
  const pA = { ...a, workloadId: asWorkloadId("wl_w060c_aaaa"), name: "a.second" };
  const r1 = buildWorkloadProfileListView(TENANT_A, [pZ, pA]);
  const r2 = buildWorkloadProfileListView(TENANT_A, [pA, pZ]);
  expect(r1.ok && r2.ok).toBe(true);
  if (!r1.ok || !r2.ok) throw new Error("build failed");
  expect(r1.view.rows.map((r) => r.name)).toEqual(["a.second", "z.first"]);
  expect(r2.view.rows.map((r) => r.name)).toEqual(["a.second", "z.first"]);
});

test("the listing REFUSES cross-tenant profiles (tenant_mismatch)", () => {
  const result = buildWorkloadProfileListView(TENANT_B, [realProfile()]);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.kind).toBe("DomainError");
  expect(result.error.code).toBe("web-workloads.listing.tenant_mismatch");
});

// ---------------------------------------------------------------------------
// The recommendation display over the REAL ledger
// ---------------------------------------------------------------------------

test("the display derives versioned statuses from the real W022 ledger", () => {
  const ledger = realLedger();
  const result = buildWorkloadRecommendationDisplay(TENANT_A, ledger);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  const supersededRow = result.view.rows.find((r) => r.recommendationVersion === 1 && r.candidateId === "class.standard_laptop");
  const activeRow = result.view.rows.find((r) => r.recommendationVersion === 2 && r.candidateId === "class.standard_laptop");
  expect(supersededRow?.status).toBe("SUPERSEDED");
  expect(activeRow?.status).toBe("ACTIVE");
  expect(activeRow?.supersedes).toBe(supersededRow?.recommendationId ?? null);
  // The cross-check against the domain's own status resolution.
  expect(deriveRecommendationStatus(ledger.entries, activeRow?.recommendationId ?? "")).toBe("ACTIVE");
  expect(deriveRecommendationStatus(ledger.entries, supersededRow?.recommendationId ?? "")).toBe("SUPERSEDED");

  // The procurement candidate surfaces the procurement kind and a DRAFT
  // ProcurementIntent proposal as a read-only descriptor.
  const procurementRow = result.view.rows.find((r) => r.candidateId === "class.engineering_workstation");
  expect(procurementRow?.kind).toBe("procurement");
  expect(procurementRow?.proposedIntents.length).toBe(1);
  expect(procurementRow?.proposedIntents[0]?.intentKind).toBe("ProcurementIntent");
  expect(procurementRow?.proposedIntents[0]?.payloadSummary.some((p) => p.startsWith("description="))).toBe(true);

  // The lineage summary: two versions of the laptop, current = v2.
  const laptopLineage = result.view.lineages.find((l) => l.candidateId === "class.standard_laptop");
  expect(laptopLineage?.versions).toEqual([1, 2]);
  expect(laptopLineage?.currentRecommendationId).toBe(activeRow?.recommendationId);
});

test("the display refuses a cross-tenant ledger", () => {
  const result = buildWorkloadRecommendationDisplay(TENANT_B, realLedger());
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.error.code).toBe("web-workloads.recommendations.tenant_mismatch");
});

test("selectRecommendationRow resolves and refuses machine-stably", () => {
  const ledger = realLedger();
  const display = buildWorkloadRecommendationDisplay(TENANT_A, ledger);
  if (!display.ok) throw new Error(display.error.message);
  const activeRow = display.view.rows.find((r) => r.status === "ACTIVE" && r.candidateId === "class.standard_laptop");
  if (activeRow === undefined) throw new Error("active row missing");
  const selected = selectRecommendationRow(display.view, activeRow.recommendationId);
  expect(selected.ok).toBe(true);
  const missing = selectRecommendationRow(display.view, "rec_does_not_exist");
  expect(missing.ok).toBe(false);
  if (missing.ok) throw new Error("expected refusal");
  expect(missing.error.code).toBe("web-workloads.recommendations.unknown_recommendation");
});

// ---------------------------------------------------------------------------
// The LOCK 12 resource-linkage surface over the REAL resources
// ---------------------------------------------------------------------------

/** The four first-class resource links, all bound to the real profile. */
function realLinks() {
  const profile = realProfile();
  return [
    { kind: "hardware" as const, workloadId: profile.workloadId, tenantId: TENANT_A, resource: fieldedLaptopCandidate() },
    { kind: "software" as const, workloadId: profile.workloadId, tenantId: TENANT_A, resource: realSubscription() },
    { kind: "connectivity" as const, workloadId: profile.workloadId, tenantId: TENANT_A, resource: realParkedSubmission() },
    { kind: "maintenance" as const, workloadId: profile.workloadId, tenantId: TENANT_A, resource: realWorkOrder() },
  ];
}

test("the linkage surfaces ALL FOUR first-class resource kinds (LOCK 12)", () => {
  const profile = realProfile();
  const links = realLinks();
  const result = buildWorkloadResourceLinkageView(TENANT_A, profile, links);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.byKind).toEqual({ hardware: 1, software: 1, connectivity: 1, maintenance: 1 });
  // Canonical kind order: hardware, software, connectivity, maintenance.
  expect(result.view.rows.map((r) => r.kind)).toEqual([
    "hardware",
    "software",
    "connectivity",
    "maintenance",
  ]);
  const hardware = result.view.rows[0];
  expect(hardware?.linkageStatus).toBe("fielded_class");
  const software = result.view.rows[1];
  expect(software?.linkageStatus).toBe("allocated");
  expect(software?.details.find((d) => d.key === "seatCount")?.value).toBe("12");
  const connectivity = result.view.rows[2];
  expect(connectivity?.linkageStatus).toBe("PARKED");
  expect(connectivity?.details.find((d) => d.key === "outcome")?.value).toBe("secure_private_connectivity");
  const maintenance = result.view.rows[3];
  expect(maintenance?.linkageStatus).toBe("open");
  expect(maintenance?.details.find((d) => d.key === "serviceCategory")?.value).toBe("service.battery");

  // The per-kind selectors (LOCK 12: independently selectable).
  const onlySoftware = selectResourceKindRows(result.view, "software");
  expect(onlySoftware.ok && onlySoftware.rows.length).toBe(1);
  const onlyConnectivity = selectResourceKindRows(result.view, "connectivity");
  expect(onlyConnectivity.ok && onlyConnectivity.rows[0]?.resourceId).toBe("adcos-sub-w060c0001");
});

test("the linkage marks procurement-required hardware machine-stably", () => {
  const profile = realProfile();
  const result = buildWorkloadResourceLinkageView(TENANT_A, profile, [
    { kind: "hardware", workloadId: profile.workloadId, tenantId: TENANT_A, resource: procurementWorkstationCandidate() },
  ]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.view.rows[0]?.linkageStatus).toBe("procurement_required");
});

test("the linkage skips links to OTHER workloads and refuses cross-tenant links", () => {
  const profile = realProfile();
  // A link to a different workload id: not part of this linkage view.
  const withForeign = buildWorkloadResourceLinkageView(TENANT_A, profile, [
    { kind: "hardware", workloadId: asWorkloadId("wl_w060c_other"), tenantId: TENANT_A, resource: fieldedLaptopCandidate() },
  ]);
  expect(withForeign.ok && withForeign.view.rows.length).toBe(0);
  // A cross-tenant link: refused, never rendered.
  const refused = buildWorkloadResourceLinkageView(TENANT_B, profile, [
    { kind: "software", workloadId: profile.workloadId, tenantId: TENANT_A, resource: realSubscription() },
  ]);
  expect(refused.ok).toBe(false);
  if (refused.ok) throw new Error("expected refusal");
  expect(refused.error.code).toBe("web-workloads.resources.tenant_mismatch");
});

// ---------------------------------------------------------------------------
// Provider-neutrality: no provider topology/credentials in any view
// ---------------------------------------------------------------------------

test("PROVIDER NEUTRALITY: no surface view carries provider fields", () => {
  const profile = realProfile();
  const listing = buildWorkloadProfileListView(TENANT_A, [profile]);
  const display = buildWorkloadRecommendationDisplay(TENANT_A, realLedger());
  const linkage = buildWorkloadResourceLinkageView(TENANT_A, profile, realLinks());
  if (!listing.ok || !display.ok || !linkage.ok) throw new Error("build failed");
  const serialized = JSON.stringify([listing.view, display.view, linkage.view]);
  const denied = ["topology", "credential", "sdk", "token", "secret", "password", "apikey", "privatekey", "endpoint", "hostname", "handle"];
  for (const key of denied) {
    expect(serialized.includes(`"${key}`)).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Determinism: same inputs, byte-identical views
// ---------------------------------------------------------------------------

test("DETERMINISM: repeated builds are byte-identical", () => {
  const profile = realProfile();
  const one = buildWorkloadResourceLinkageView(TENANT_A, profile, realLinks());
  const two = buildWorkloadResourceLinkageView(TENANT_A, profile, realLinks());
  expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  const dOne = buildWorkloadRecommendationDisplay(TENANT_A, realLedger());
  const dTwo = buildWorkloadRecommendationDisplay(TENANT_A, realLedger());
  expect(JSON.stringify(dOne)).toBe(JSON.stringify(dTwo));
});

test("DETERMINISM: views are frozen and builders are pure (repeat-call stability)", () => {
  const profile = realProfile();
  const one = buildWorkloadProfileListView(TENANT_A, [profile]);
  const two = buildWorkloadProfileListView(TENANT_A, [profile]);
  expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  if (!one.ok) throw new Error(one.error.message);
  expect(Object.isFrozen(one.view)).toBe(true);
  expect(Object.isFrozen(one.view.rows[0])).toBe(true);
  const linkage = buildWorkloadResourceLinkageView(TENANT_A, profile, []);
  if (!linkage.ok) throw new Error(linkage.error.message);
  expect(Object.isFrozen(linkage.view)).toBe(true);
  void CORR;
});
