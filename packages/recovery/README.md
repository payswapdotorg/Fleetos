# @fleetos/recovery

Last-seen evidence, recovery state, lock/locate and replacement escalation. Destructive recovery actions require explicit policy grant and evidence trail.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`).

## Frozen spec source

spec/work-items/WORK-ITEM-CATALOG.md W040; spec/ARCHITECTURE-LOCK.md item 16; spec/MODULE-DEPENDENCY-MAP.md (`recovery -> devices, security, actions, vendors, audit`).

## W040 state — real contracts

The Recovery + Find My Device module (W040, lane A). Zero runtime
dependencies; strict TS; no clock reads (every timestamp injected); no
`any` in public signatures.

### Module map

- `src/last-seen.ts` — **D1**: the deterministic last-seen evidence
  ledger per device, derived from canonical observation batches (the
  FROZEN `@fleetos/contracts` `Observation`/`ObservationBatch` shapes —
  the devices edge). Every record carries source evidence refs
  (observation ids), an injected timestamp, and a derived staleness
  classification (fresh/stale/unknown against INJECTED thresholds).
  The Find-My-Device view derives the latest location-bearing evidence
  (kind `device.location`); absent location evidence is machine-stable
  `no_location_evidence` — never a guess. Append-only versioned
  records; deterministic ids; re-derivation from the same observations
  is byte-identical.
- `src/recovery-case.ts` — **D2**: recovery cases + the typed state
  machine (OPENED -> SECURING -> SECURED / ESCALATED ->
  REPLACEMENT_PROPOSED / CLOSED with machine-stable closure reasons).
  Versioned PROPOSAL-gated transitions (append-only revisions,
  deterministic content digests). The case records the evidence basis
  (last-seen + posture finding refs — the security edge via a
  structural trigger input).
- `src/policy-seam.ts` — **D3a**: the injected Contract Guardian
  evaluation seam (`GuardianEvaluateFn<R>`). `@fleetos/policy`'s
  `evaluateGuardianRequest` satisfies it STRUCTURALLY (the ownership
  gate forbids the cross-lane src import — recovery is lane A, policy
  is lane B); the binding site injects the REAL engine + its compiled
  rule set, proven by test against the real Guardian
  (ALLOW/WARN/REQUIRE_APPROVAL/BLOCK).
- `src/destructive-request.ts` — **D3b**: the destructive request
  record model — the FROZEN `RecoveryIntentPayload` (`deviceId?` +
  `action: lock/locate/wipe/reboot`) consumed VERBATIM as the durable
  intent record — plus the tenant-partitioned append-only store.
- `src/destructive-gate.ts` — **D3c**: the destructive recovery gate.
  Capability-aware refusals BEFORE any seam call (UNSUPPORTED or
  unauthorized destructive capabilities refused with machine-stable
  reasons — never emulated, never a fallback); Guardian routing (ALLOW
  advances + dispatches; WARN advances with the warning context,
  non-blocking per the frozen `isBlockingDecision`;
  REQUIRE_APPROVAL parks for human approval — the parked ->
  approved/rejected transitions are ledger entries; BLOCK rejects with
  the Guardian's machine-stable reasons — NEVER auto-execute);
  execution dispatch through the W020 `EndpointAdapter` interface (the
  same-lane `@fleetos/device-adapters` import, injected adapter seam);
  the full ARCHITECTURE-LOCK §16 evidence trail (policy decision + rule
  ids + observation evidence) on every granted action.
- `src/replacement.ts` — **D4**: warranty-aware replacement escalation
  records consuming W021 health's versioned diagnosis hypotheses
  carrying DRAFT `ReplacementIntentPayload`s (the frozen shape,
  verbatim) + W032 vendor warranty terms (typed comparable values —
  the vendors edge). In-warranty vs out-of-warranty against the
  vendor's typed warranty duration from an injected warranty-start
  instant. PROPOSALS only: append-only ledger, supersession discipline
  — never automatic procurement.
- `src/audit-seam.ts` — **D5**: the injected audit sink
  (`RecoveryAuditSink`) — the W011/W021/W022/W031/W041 pattern;
  structurally satisfied by `@fleetos/audit`'s sink adapter, proven by
  test into the hash-chained AuditLog (chain verifies; per-tenant
  chains separate).
- `src/internal.ts` — internal helpers (NOT public API): canonical
  JSON, FNV-1a digests, immutability helpers, the tenant-scope guard,
  FleetError constructors mapped onto the frozen taxonomy.

### Decision boundaries honored

- The deterministic policy layer (the W031 Guardian in
  `@fleetos/policy`) remains the sole authority for consequential
  actions: REQUIRE_APPROVAL parks, BLOCK rejects, and nothing here
  auto-executes.
- Capability-aware adapters (W020/W030 in `@fleetos/device-adapters`)
  refuse UNSUPPORTED capabilities with machine-stable reasons — never
  emulated.
- Escalations and case transitions are versioned PROPOSALS; the
  evidence trail is cited, never re-derived.
- Tenant isolation by construction: TenantContext-first stores
  partitioned per tenant; runtime guards reject context-free/invalid/
  cross-tenant access with the types bypassed; foreign ids are
  indistinguishable from unknown ones.

### Cross-lane edges

`src/` imports only `@fleetos/contracts` + the same-lane
`@fleetos/device-adapters`. The `recovery -> security / policy /
vendors / audit` module edges are honored via structural seams
(`packages/recovery/test/**` imports the real sibling packages and
proves the structural compatibility — the established
W011/W021/W022/W031/W032/W041 pattern; the ownership gate scans only
`src/` files).

## Testing

`bun test` from the repo root; the recovery suite lives in
`packages/recovery/test/` (contract conformance against
`@fleetos/contracts/testing` fixture builders; last-seen + Find My
Device; recovery cases; the Guardian gate with the REAL
`evaluateGuardianRequest`; capability refusal (seam-never-invoked
proofs); warranty-aware escalation with the REAL health + vendor
packages; audit into the REAL hash-chained AuditLog; exhaustive tenant
isolation; byte-identical determinism across runs + input
permutations).
