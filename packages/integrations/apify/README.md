# @fleetos/integration-apify

The OPTIONAL Apify enrichment adapter (W100C, worker-c lane).

Role: vendor/catalog DISCOVERY ENRICHMENT ONLY — proposal-grade data with
full provenance, never authoritative inventory, price, policy or
fulfillment truth. Vendor records in `@fleetos/vendors` remain the only
authority.

Provider-unavailable is FAIL-VISIBLE: `unconfigured` (no token in the
environment seam), `budget_exhausted` (free-tier credit spent), and
`unreachable` (transport failure) are explicit machine-stable states the
consuming surface renders with a reason and escalation path — never a
silent empty result.

All seams are injected (token source, usage ledger, transport); the
package performs no network I/O and imports no provider SDK. The W102
[TL] staging binding implements the transport seam over the real Apify
API at the runtime boundary, with the token from `APIFY_TOKEN`.
