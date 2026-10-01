/**
 * @fleetos/actions — Public API.
 *
 * Lane B (worker-b) implementation of Fleet Actions + Print orchestration
 * (W041): group selection (typed device-group selectors resolved
 * deterministically against device descriptors), action plan templates
 * (a plan is a versioned, immutable proposal: selected targets, intended
 * capability invocations per target, PROPOSAL status only), target
 * resolution (pure function: selector -> device set, injected device
 * registry view), policy-gated execution (action plans submit to the
 * W031 Guardian evaluation — a plan advances only when the Guardian
 * decision is ALLOW, or per decision semantics: REQUIRE_APPROVAL parks
 * the plan for approval; BLOCK rejects with the Guardian's machine-stable
 * reasons; NEVER auto-execute), print orchestration (printer routing on
 * top of the frozen PrintIntentPayload — print job requests as versioned
 * records, printer selection from typed printer descriptors, capability-
 * aware routing that refuses unsupported job features — never emulates,
 * deterministic routing rules with injectable preferences, queue-state
 * contracts per printer with observable evidence links), print
 * DISTRIBUTION planning (W100B: selected people + document -> each
 * person's APPROVED printer receives the job; per-person refusals
 * visible with machine-stable reasons + observable escalation context —
 * unapproved capable printers counted and named, never promoted), audit
 * + tenancy
 * (consequential mutations emit audit records through an injected sink —
 * structurally satisfied by @fleetos/audit's sink adapter; tenant
 * isolation by construction — tenant-A context can never read/act on
 * tenant-B plans or jobs).
 *
 * Module map (all pure, zero runtime dependencies, strict TS, no clock
 * reads — every timestamp is injected by the caller):
 *
 *   device-descriptor.ts  D1 — the minimal device descriptor + the
 *                              DeviceRegistryView interface (the actions
 *                              -> devices module-map edge honored via the
 *                              frozen contracts shapes only — the
 *                              consumer projects a TwinStore onto this
 *                              view at the binding site).
 *   fleet-action.ts       D1 — the FleetAction domain model: typed
 *                              device-group selectors, action plan
 *                              templates (PROPOSAL status only), the
 *                              pure target-resolution function, and the
 *                              plan transition table.
 *   policy-gate.ts        D2 — the policy-gated execution flow: a plan
 *                              submits to the W031 Guardian evaluation
 *                              (via @fleetos/policy's engine with an
 *                              injected rule set); a plan advances ONLY
 *                              when the Guardian decision is ALLOW (WARN
 *                              is non-blocking — advances with the
 *                              warning context); REQUIRE_APPROVAL parks
 *                              the plan for approval; BLOCK rejects with
 *                              the Guardian's machine-stable reasons.
 *                              The parked-plan approval step (the
 *                              W031-deferred human-approval transition)
 *                              lives here.
 *   print-orchestration.ts D3 — printer routing on top of the frozen
 *                              PrintIntentPayload: print job requests as
 *                              versioned records, printer selection from
 *                              typed printer descriptors, capability-
 *                              aware routing that refuses unsupported job
 *                              features (never emulates), deterministic
 *                              routing rules (injectable preferences:
 *                              cost / latency / proximity as typed
 *                              comparable inputs), queue-state contracts
 *                              per printer with observable evidence
 *                              links.
 *   action-store.ts       D4 — the tenant-scoped, append-only-per-version
 *                              ActionStore (plan revisions are append-
 *                              only per plan id).
 *   print-store.ts       D4 — the tenant-scoped, append-only-per-version
 *                              PrintStore (job revisions are append-only
 *                              per job id; the per-printer queue state
 *                              is derived).
 *   audit-seam.ts        D4 — the injected audit sink interface
 *                              (W011/W021/W022/W031's pattern;
 *                              structurally satisfied by @fleetos/audit's
 *                              sink adapter — proven by test).
 *
 * Decision boundary (`spec/ARCHITECTURE.md`): the W031 Contract Guardian
 * IS the deterministic policy layer — it decides whether an action is
 * permitted; it never executes anything. REQUIRE_APPROVAL holds for
 * human approval; BLOCK refuses. Approvals belong to THIS package (the
 * W031-deferred step); execution belongs to later waves (W060B /
 * device-adapters, not this package).
 *
 * Cross-lane domain types come from @fleetos/contracts only
 * (`tools/check-ownership.mjs` enforced). @fleetos/policy is same-lane
 * (worker-b) — the W031 Guardian engine is the policy authority.
 * @fleetos/audit is a TEST-scope dependency only (src/ NEVER imports it
 * — the ownership gate scans src/ only); the dependency exists so the
 * tests PROVE the seams are structurally satisfied by W012's sink
 * adapter (the W022/W031-disclosed pattern). @fleetos/device-model is
 * NOT imported in src/ — the work order's "module-map edges to devices
 * resolve via the frozen contracts shapes" clause; the consumer binds
 * a TwinStore to the local DeviceRegistryView at the call site. No `any`
 * in public signatures.
 */

// D4 — the audit emission seam (W011/W021/W022/W031's pattern)
export * from "./audit-seam";

// D1 — the minimal device descriptor + the DeviceRegistryView
export * from "./device-descriptor";

// D1 — the FleetAction domain model (group selection + plan templates +
// target resolution + plan transitions)
export * from "./fleet-action";

// D2 — the policy-gated execution flow
export * from "./policy-gate";

// D3 — print orchestration (printer routing + queue state)
export * from "./print-orchestration";

// D5 (W100B) — print DISTRIBUTION planning (selected people + document
// -> each person's approved printer receives the job)
export * from "./print-distribution";

// D4 — the tenant-scoped stores (ActionStore + PrintStore)
export * from "./action-store";
export * from "./print-store";

// Internal helpers re-exported for tests + same-lane consumers.
export type { ActionTenantScope } from "./internal";

// W001 placeholder markers (kept for the baseline tests; required by
// tools/verify-skeleton.mjs and tools/check-contracts.mjs).
export const MODULE_NAME = "actions" as const;
export const MODULE_VERSION = "0.1.0" as const;
