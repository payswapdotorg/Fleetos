/**
 * W100C — the adapter: the fixed guard order, the fail-visible
 * provider-unavailable states, and the budget discipline.
 */

import { test, expect } from "bun:test";
import { asTenantId } from "@fleetos/contracts";
import {
  createApifyTokenSource,
  createInMemoryTransport,
  createInMemoryUsageLedger,
  createApifyEnrichmentAdapter,
} from "../src/index";
import type { ApifyTransportResult } from "../src/index";

const TENANT_A = asTenantId("tnt_alpha000001");
const NOW = "2026-10-01T09:00:00Z";
const QUERY = { tenantId: TENANT_A, query: "laptop repair Berlin", now: NOW };

const CONFIGURED = createApifyTokenSource(() => "token-value-never-inspected");
const UNCONFIGURED = createApifyTokenSource(() => undefined);

function successResponse(): ApifyTransportResult {
  return {
    ok: true,
    runId: "run_1",
    datasetId: "ds_1",
    items: [{ name: "Nordwerk IT Service", region: "Berlin", categories: ["repair"] }],
  };
}

test("a successful discovery returns PROPOSALS with attribution", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 500 });
  const transport = createInMemoryTransport({ responses: [successResponse()] });
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: CONFIGURED,
    usageLedger: ledger,
    transport,
  });

  const result = adapter.discoverVendorCandidates(QUERY);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.proposals.length).toBe(1);
  expect(result.proposals[0]!.proposalStatus).toBe("PROPOSAL");
  expect(result.proposals[0]!.candidateName).toBe("Nordwerk IT Service");
  expect(result.attribution.runId).toBe("run_1");
  expect(result.attribution.rawItemCount).toBe(1);
  // The run reserved its cost.
  expect(ledger.remainingCents).toBe(475);
});

test("GUARD 1: an unconfigured provider refuses WITHOUT spending", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 500 });
  const transport = createInMemoryTransport({ responses: [successResponse()] });
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: UNCONFIGURED,
    usageLedger: ledger,
    transport,
  });

  const result = adapter.discoverVendorCandidates(QUERY);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.unavailable.state).toBe("unconfigured");
  expect(result.unavailable.reason).toBe("apify_token_missing");
  expect(result.unavailable.retryable).toBe(false);
  expect(result.escalationPath).toContain("APIFY_TOKEN");
  // Nothing spent, nothing requested.
  expect(ledger.remainingCents).toBe(500);
  expect(transport.requests.length).toBe(0);
});

test("GUARD 2: an exhausted budget refuses BEFORE the transport fires", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 10 });
  const transport = createInMemoryTransport({ responses: [successResponse()] });
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: CONFIGURED,
    usageLedger: ledger,
    transport,
    discoveryRunCostCents: 25,
  });

  const result = adapter.discoverVendorCandidates(QUERY);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.unavailable.state).toBe("budget_exhausted");
  expect(result.unavailable.reason).toBe("apify_free_credit_exhausted");
  expect(result.unavailable.retryable).toBe(true);
  expect(result.escalationPath).toContain("next billing cycle");
  // The transport never fired; the ledger is unchanged.
  expect(transport.requests.length).toBe(0);
  expect(ledger.remainingCents).toBe(10);
});

test("the availability probe reports the machine-stable states without spending", () => {
  const empty = createApifyEnrichmentAdapter({
    tokenSource: UNCONFIGURED,
    usageLedger: createInMemoryUsageLedger(),
    transport: createInMemoryTransport(),
  });
  expect(empty.availability()).toEqual({
    state: "unconfigured",
    reason: "apify_token_missing",
    retryable: false,
  });

  const spent = createApifyEnrichmentAdapter({
    tokenSource: CONFIGURED,
    usageLedger: createInMemoryUsageLedger({ initialCents: 0 }),
    transport: createInMemoryTransport(),
  });
  expect(spent.availability().state).toBe("budget_exhausted");

  const healthy = createApifyEnrichmentAdapter({
    tokenSource: CONFIGURED,
    usageLedger: createInMemoryUsageLedger(),
    transport: createInMemoryTransport(),
  });
  expect(healthy.availability()).toEqual({ state: "available" });
});

test("GUARD 3a: an unreachable transport refuses and RELEASES the reservation", () => {
  const ledger = createInMemoryUsageLedger({ initialCents: 500 });
  const transport = createInMemoryTransport({
    responses: [{ ok: false, kind: "unreachable", detail: "dns" }],
  });
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: CONFIGURED,
    usageLedger: ledger,
    transport,
  });

  const result = adapter.discoverVendorCandidates(QUERY);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.unavailable.state).toBe("unreachable");
  expect(result.unavailable.reason).toBe("apify_transport_unreachable");
  expect(result.unavailable.retryable).toBe(true);
  // A network failure never reached the provider: the cost is released.
  expect(ledger.remainingCents).toBe(500);
  expect(transport.requests.length).toBe(1);
});

test("GUARD 3b: provider-side failures (http_error / rate_limited) keep the spend", () => {
  for (const kind of ["http_error", "rate_limited"] as const) {
    const ledger = createInMemoryUsageLedger({ initialCents: 500 });
    const transport = createInMemoryTransport({
      responses: [{ ok: false, kind, detail: "provider said no" }],
    });
    const adapter = createApifyEnrichmentAdapter({
      tokenSource: CONFIGURED,
      usageLedger: ledger,
      transport,
    });
    const result = adapter.discoverVendorCandidates(QUERY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.unavailable.state).toBe("unreachable");
    expect(result.unavailable.reason).toBe(`apify_transport_${kind}`);
    // The provider DID execute a run: the spend stands.
    expect(ledger.remainingCents).toBe(475);
  }
});

test("an empty provider dataset is a VISIBLE zero, not an error", () => {
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: CONFIGURED,
    usageLedger: createInMemoryUsageLedger(),
    transport: createInMemoryTransport(), // no script => empty dataset
  });
  const result = adapter.discoverVendorCandidates(QUERY);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.proposals).toEqual([]);
  expect(result.attribution.rawItemCount).toBe(0);
  expect(result.attribution.proposalCount).toBe(0);
});

test("the transport request carries the tenant scope and query verbatim", () => {
  const transport = createInMemoryTransport({ responses: [successResponse()] });
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: CONFIGURED,
    usageLedger: createInMemoryUsageLedger(),
    transport,
  });
  adapter.discoverVendorCandidates({ ...QUERY, region: "Berlin" });
  const request = transport.requests[0]!;
  expect(request.tenantId).toBe(TENANT_A);
  expect(request.query).toBe("laptop repair Berlin");
  expect(request.region).toBe("Berlin");
  expect(request.requestedAt).toBe(NOW);
});

test("the token VALUE never appears in any result (names and presence only)", () => {
  const transport = createInMemoryTransport({ responses: [successResponse()] });
  const adapter = createApifyEnrichmentAdapter({
    tokenSource: createApifyTokenSource(() => "SECRET_TOKEN_VALUE_123"),
    usageLedger: createInMemoryUsageLedger(),
    transport,
  });
  const result = adapter.discoverVendorCandidates(QUERY);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("SECRET_TOKEN_VALUE_123");
});
