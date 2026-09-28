/**
 * W061 shell test fixtures (deterministic; no clock, no entropy).
 */
import { makeTenantId, makeDeviceId } from "@fleetos/contracts/testing";
import type { ShellRecordSummary, ShellBandedSummary } from "../src/seams";

export const TENANT = makeTenantId("w061-shell-tenant");

export function makeScope(): { tenantId: typeof TENANT } {
  return { tenantId: TENANT };
}

export function makeSummary(
  area: ShellRecordSummary["area"],
  recordId: string,
  title: string,
  keywords: readonly string[],
): ShellRecordSummary {
  return { area, recordId, title, keywords };
}

export function makeBandedSummary(
  area: ShellBandedSummary["area"],
  recordId: string,
  title: string,
  keywords: readonly string[],
  band: string,
  subtitle: string,
): ShellBandedSummary {
  return { area, recordId, title, keywords, band, subtitle };
}

export const DEVICE_ID = makeDeviceId("w061-device-1");

/** A small deterministic cross-surface corpus for search/coherence tests. */
export function corpus(): readonly ShellRecordSummary[] {
  return [
    makeSummary("device", "dev-1", "EliteBook 840", ["laptop", "elitebook", "hr"]),
    makeSummary("device", "dev-2", "Mac mini", ["desktop", "mac", "finance"]),
    makeSummary("security", "fnd-1", "Stale TLS certificate", ["tls", "certificate", "exposure"]),
    makeSummary("security", "fnd-2", "Unenrolled agent", ["agent", "enrollment", "compliance"]),
    makeSummary("actions", "plan-1", "Rotate credentials plan", ["credentials", "rotation"]),
    makeSummary("workloads", "wl-1", "Payroll batch plan", ["payroll", "batch", "finance"]),
    makeSummary("commerce", "po-1", "Keyboard procurement", ["keyboard", "procurement"]),
  ];
}
