# Contract Guardian Policy Model

Inputs:
principal, device, workload, data classification, contract/obligation, destination, network, printer, time, geography and action.

Decision:
ALLOW | WARN | REQUIRE_APPROVAL | BLOCK

Every decision records policy version, matching rules, evidence, subject, action, decision and expiry/re-evaluation.

Examples:
- block confidential client upload to unapproved external AI;
- allow print only to approved devices;
- restrict removable media;
- require corporate network for sensitive data;
- permit a manager-approved exception.

Record observable facts; never present inferred intent as fact.