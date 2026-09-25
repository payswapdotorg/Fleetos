# FleetOS Architecture v1.0

STATUS: FROZEN

## Mission

FleetOS continuously keeps an organization's physical computing system useful, secure, compliant and available.

A device may be customer-owned, leased, purchased through Fleet, or supplied by a third party. FleetOS must deliver value after installation without requiring Fleet procurement.

## Canonical model

The canonical durable object is the Fleet Device Twin.

It joins identity/ownership, hardware capabilities, telemetry, software/security posture, workload assignment, connectivity capabilities, maintenance history/predictions, policy scope, current actions/recovery state, and evidence/provenance.

Reality is represented by observations/events. Diagnoses, predictions and recommendations are versioned interpretations.

## Device lifecycle

ENROLL -> OBSERVE -> ASSESS -> DIAGNOSE -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> LEARN

Actions may be automatic, approval-required or prohibited according to tenant policy.

## Device adapters

A Device Adapter exposes normalized capabilities:
identify, observe, diagnose, enforce, remediate, lock, locate, wipe, reboot, update, health.

Capability support is explicit. Unsupported destructive behavior may never be emulated.

Initial adapter families:
- Windows
- macOS
- Linux
- iOS/iPadOS management
- Android Enterprise
- printer/copier/network-device connectors
- generic network/IoT adapter boundary

## Control plane

FleetOS owns:
- tenants and identities;
- Device Twins;
- observations/events;
- health/diagnosis;
- security posture;
- workload intelligence;
- Contract Guardian;
- Fleet Actions;
- maintenance plans;
- recovery;
- procurement/software/service demand;
- audit/evidence.

## Intent model

User and system requests become durable Fleet Intents:
MaintainDeviceIntent, SecurityRemediationIntent, ConnectivityIntent, ProcurementIntent, SoftwareSubscriptionIntent, ReplacementIntent, RecoveryIntent, PrintIntent, FleetActionIntent.

Each intent is versioned, idempotent and traceable from request through verified outcome.

## Decision boundary

The decision engine may propose diagnoses, risk classification, treatment, procurement plan, connectivity plan, software allocation and vendor selection.

A deterministic policy/authorization layer remains authoritative for whether an action is permitted.

ML/LLM capabilities are advisory or experimental until adopted into an explicit versioned decision contract.

## Contract Guardian

Rules evaluate principal, device, workload, data classification, contract/obligation, destination, network, printer, time/geography and action.

Decision types:
ALLOW, WARN, REQUIRE_APPROVAL, BLOCK.

The system records observable evidence and must not present inferred employee intent as fact.

## Workload Intelligence

A Workload Profile describes what a role/process requires.

Observed factors can include application set/versions, CPU/GPU/RAM/storage/network demand, working hours, power dependence, environment where lawful, travel/office/home distribution, peripherals, security classification, downtime cost and repair/failure outcomes.

Recommendation:
workload -> capabilities -> device configuration -> software -> connectivity -> lifecycle policy

Historical outcomes feed Arena learning experiments.

## Procurement/service exchange

FleetOS is the demand-side orchestrator. Local vendors own inventory, pricing and fulfillment.

Flow:
demand -> matching -> quote -> acceptance -> fulfillment -> delivery -> verification

Matching considers workload, quantity, deadline, location, substitutions, budget, warranty, SLA, vendor quality and inventory.

Compatible orders may be aggregated before a customer deadline. Individual customer contracts remain auditable.

## ADCOS

FleetOS expresses connectivity outcomes, not network-native topology.

Examples:
- low-latency communication between selected devices;
- secure local/private connectivity;
- high-throughput transfer;
- resilient connectivity;
- temporary private connectivity groups.

ADCOS owns network-native execution and optimization. FleetOS consumes normalized connectivity contracts, status and evidence.

## Arena

FleetOS exports authorized learning/evaluation cases according to tenant policy.

Arena may develop/certify capabilities for failure prediction, diagnosis, treatment recommendation, workload/device matching and maintenance scheduling.

FleetOS adopts only versioned compatible capabilities.

## Aurum

FleetOS owns operational truth. Aurum is an organizational communication/intelligence channel.

FleetOS may emit maintenance notices, security warnings, approval requests, recovery messages, procurement updates and manager briefings.

Aurum returns delivery/outcome metadata and cannot mutate FleetOS truth except through authorized FleetOS action APIs.

## Storage

Reference stack:
- Next.js/TypeScript control plane;
- PostgreSQL for authoritative state;
- Redis-compatible queue/cache/lock;
- object storage for evidence/artifacts;
- background workers;
- device agents/connectors outside the web runtime.

These are replaceable deployment choices.

## Module boundaries

Foundation: auth, organizations, audit
Device truth: devices, observations, health, security
Business semantics: workloads, policy, actions, maintenance, recovery
Commerce: vendors, procurement, software
Network/communication/learning: connectivity, notifications, learning

External adapters live under integrations.

## UX principle

Every architecture-level capability must be discoverable in the product:
Control Tower, Devices, Device Doctor, Workloads, Policies, Fleet Actions, Maintenance, Procurement, Software, Vendors, Connectivity, Recovery, Evidence/Audit.