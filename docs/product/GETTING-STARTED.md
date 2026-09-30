# FleetOS — Getting Started

STATUS: PRODUCT GUIDE CONTRACT — implementation follows docs/tech-lead/PRODUCT-READINESS-HANDOFF.md

FleetOS is a device operations platform: a web console plus device agents/connectors.

## The intended first session

1. Sign in or enter the clearly labeled staging/demo environment.
2. Create or join a workspace.
3. Choose the role(s) you perform.
4. Add your first device.
5. Install the FleetOS agent.
6. Wait for the first observation.
7. Open Device Doctor.
8. Follow the next recommended action.
9. Return to Control Tower.

## Role switching

A person can have multiple roles. Use the role switcher in the top bar to change the product lens without changing workspace.

Examples:

- Fleet Administrator — fleet-wide governance.
- Service Desk — device operations and recovery.
- Security & Compliance — policy, findings, approvals and evidence.
- Asset & Procurement Manager — workload, software, maintenance and purchasing.
- Team Manager — team-impact and approval lens.
- Employee / Device Owner — personal device and request lens.

Your role lens changes what FleetOS emphasizes. Authorization still comes from your actual assignments and policy.

## What FleetOS should unlock

- device health and diagnosis;
- security posture and policy decisions;
- device recovery;
- fleet actions and print routing;
- maintenance scheduling and verification;
- workload-based device/software recommendations;
- procurement and vendor exchange;
- connectivity orchestration;
- communication outcomes;
- evidence and audit history;
- learning/evaluation adoption.

## Important distinction

A recommendation is not an execution.

FleetOS shows:

observe -> diagnose -> recommend -> authorize -> execute -> verify -> learn

The UI should make each state visible.
