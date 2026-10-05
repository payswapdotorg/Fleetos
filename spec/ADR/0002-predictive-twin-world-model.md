# ADR-0002: Predictive Twin / World Model Layer

Status: ACCEPTED
Date: 2026-10-03
Owner: Tech Lead

## Context

FleetOS defines the Fleet Device Twin as the canonical durable representation of a managed device. Its authoritative state is built from immutable observations/events plus versioned diagnoses, predictions and recommendations.

The current model is sufficient to represent what is known about a device, but it does not yet define a first-class learned representation of:

- temporal device state;
- latent operational regimes;
- predicted state trajectories;
- likely outcomes under alternative interventions;
- uncertainty around those predictions;
- cross-device and workload context at multiple timescales.

The operator requested a stronger digital-twin representation inspired by System-1/System-2-style fast/slow reasoning and, more specifically, JEPA (Joint Embedding Predictive Architecture) style predictive representations.

The architecture must remain provider/model neutral. A particular neural architecture must not become FleetOS truth, authorization logic, or a mandatory infrastructure dependency.

## Decision

Introduce an additive **Predictive Twin / World Model Layer** around the canonical Fleet Device Twin.

The canonical Device Twin remains authoritative and unchanged.

The new layer has four conceptual parts:

1. **Authoritative state**
   - identities, ownership, observations, events, evidence, current lifecycle state and verified outcomes remain the source of truth.
   - raw observations are never replaced by learned representations.

2. **Predictive representation**
   - a model-neutral representation of recent state/history.
   - supports temporal context and multiple horizons.
   - may be implemented by JEPA-family models, other predictive latent-state models, or deterministic/reference implementations.
   - predictions remain versioned interpretations.

3. **Counterfactual / action-conditioned prediction**
   - given an observed state and a candidate action, the layer may estimate the resulting future representation/state trajectory.
   - outputs are advisory and uncertainty-bearing.
   - it must never authorize or execute the action.

4. **Evaluation and adoption boundary**
   - every learned capability is evaluated against historical/held-out cases and Arena-compatible evaluation flows.
   - a learned model can only become an adopted FleetOS capability through an explicit versioned adoption record.
   - Contract Guardian / authorization remains authoritative.

System-1/System-2 terminology is treated as an architectural analogy, not as an implementation requirement:
- fast/reactive consumers use predictive state for anomaly/trajectory triage;
- slower planning consumers use simulations/counterfactuals for diagnosis, maintenance, recovery, workload and procurement planning.

## Proposed model-neutral surface

The first implementation should establish a provider-neutral seam with operations equivalent to:

- represent(history, context)
- predict(representation, horizon)
- predictAfterAction(representation, candidateAction, horizon)
- compare(representationA, representationB)
- uncertainty(prediction)
- provenance(prediction)

The exact TypeScript/API names are implementation details and should be frozen only after worker validation.

## Hard invariants

1. The predictive representation is never business truth.
2. Observations/events remain immutable and auditable.
3. Every prediction carries model/capability version, horizon, evidence references and uncertainty metadata.
4. Predictions cannot mutate authorization state.
5. Contract Guardian remains the sole policy authority for consequential actions.
6. A failed or unavailable predictive model must degrade to an honest deterministic/unknown state rather than fabricate confidence.
7. Tenant isolation applies to training data, inference context, representations, predictions and evaluation cases.
8. BYOD/privacy rules apply before features enter the predictive layer.
9. Provider-specific model SDKs stay behind adapters.
10. Learned capabilities must be independently testable and reproducible enough to support Arena evaluation and later adoption.
11. No requirement is introduced that FleetOS operate a GPU service in the default free-tier deployment.
12. The representation layer must support deterministic reference behavior for tests and environments without ML infrastructure.

## Initial predictive targets

The first reference use cases are:

- failure/health trajectory;
- workload-fit drift;
- maintenance timing;
- security-posture trajectory;
- recovery outcome estimation;
- action outcome estimation;
- fleet/site-level operational state summaries.

Long-horizon project/company representations are explicitly supported by the design but are not required for the first implementation.

## Alternatives considered

1. Replace the Device Twin with a latent embedding
   - Rejected: destroys authoritative provenance and makes business truth opaque.

2. Put an LLM directly in the Device Twin
   - Rejected: an LLM is not a stable canonical state representation and would blur prediction, interpretation and authorization.

3. Commit immediately to one JEPA implementation/provider
   - Rejected: research and hardware choices must remain replaceable.

4. Use only handcrafted feature vectors
   - Rejected as the long-term architecture: useful as a deterministic reference implementation, but insufficient for richer learned temporal representations.

## Architecture impact

Additive only.

The existing canonical Device Twin, lifecycle, intent model, authorization boundary, audit/evidence law, tenant isolation and provider-neutral integration rules remain intact.

The predictive layer sits between observation/history and versioned interpretation/planning.

## Acceptance

An implementation is only accepted when:

- the canonical Device Twin remains authoritative;
- deterministic reference behavior exists;
- predictions carry evidence/version/uncertainty/provenance;
- counterfactual outputs are visibly distinct from observed facts;
- unavailable-model behavior is fail-closed and honest;
- tenant isolation is machine-tested;
- no predictive result can bypass Guardian authorization;
- at least one real FleetOS journey demonstrates predictive output being used as advisory context;
- the capability can be exported/evaluated through Arena without making Arena operational truth;
- live product UI clearly distinguishes observed, predicted and hypothetical state.

## Rollback

Disable the predictive layer at the composition boundary. Existing observation, diagnosis, planning, authorization, action, verification and learning flows continue without learned predictive outputs.
