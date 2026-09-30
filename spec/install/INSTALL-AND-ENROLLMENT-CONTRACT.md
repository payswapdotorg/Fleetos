# FleetOS Install + Enrollment Contract

STATUS: PRODUCTIZATION INSTALL CONTRACT — architecture remains FROZEN v1.0

## Product shape

FleetOS consists of:

1. a web control plane/console;
2. a device agent/connector installed on managed endpoints;
3. provider adapters/integrations outside core domain contracts.

A user can use the web console without procurement. Device enrollment is the primary path to unlock the full device-doctor experience.

## User journey

From the web console:

Get started -> workspace -> role(s) -> Add devices -> platform -> installer -> enrollment code -> install -> first check-in -> first observation -> Device Doctor

## Enrollment security

An enrollment request is:

- tenant-bound;
- scope-bound;
- one-time;
- short-lived;
- revocable;
- auditable.

The server stores only the necessary verifier/hash material for bootstrap credentials.

The installer never contains:

- DATABASE_URL;
- Redis credentials;
- R2 credentials;
- provider access keys;
- permanent tenant secrets.

After bootstrap, the agent receives a device-scoped credential/trust record through the existing enrollment/security boundary.

## Supported installation artifacts

The implementation should publish reproducible, versioned artifacts for:

- Windows;
- macOS;
- Linux.

Each release provides:

- version;
- platform/architecture;
- checksum;
- release notes;
- installation command/steps;
- uninstall steps;
- rollback/revoke instructions.

The exact packaging technology is a worker decision provided the artifact is reproducible and the install contract remains stable.

## Install center UI

The console needs a dedicated first-class install center entry point reachable from:

- Control Tower;
- Devices;
- empty fleet state;
- global search (install agent, add device, enroll device).

The install center presents:

1. platform selector;
2. corporate/BYOD scope;
3. enrollment scope;
4. one-time code;
5. download;
6. copy command;
7. installation verification;
8. first-check-in status;
9. next action.

## BYOD

The enrollment UI must explicitly distinguish:

- corporate-owned;
- leased;
- BYOD;
- third-party managed.

BYOD defaults are conservative and follow the existing W071 purpose-bound/data-minimization rules.

## Failure states

The UI must explain:

- code expired;
- code already used;
- device already enrolled;
- unsupported platform;
- agent cannot reach control plane;
- tenant/role mismatch;
- enrollment refused by policy.

Every refusal has a machine-stable reason and a human explanation.

## Uninstall / revoke

The same product experience must support:

- revoke device trust;
- disable enrollment code;
- uninstall instructions;
- post-uninstall state;
- audit/evidence link.

A destructive operation remains behind the existing authorization/approval model.

## Acceptance

The install contract is accepted only when a human can:

- create an enrollment request;
- download the matching artifact;
- install it on a supported target;
- complete bootstrap;
- see the enrolled device in the same tenant;
- see its first observation;
- open Device Doctor;
- verify the audit/evidence trail;
- revoke/uninstall through an authorized path.
