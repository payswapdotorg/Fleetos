/**
 * W140 — the server-plane test seeding helper: identity state (tenant,
 * principals, role assignments, password credentials) written through
 * the REAL identity repositories over a request-scoped store bound to
 * the fake driver — the same seams the routes compose.
 */

import type { DurableDriver } from "../src/server/durable-driver";
import { createRequestScopedRecordStore } from "../src/server/neon-record-store";
import { createServerPasswordHasher } from "../src/server/server-password-hasher";
import {
  createDurableTenantRepository,
  createDurablePrincipalRepository,
  createDurableRoleAssignmentRepository,
  createDurablePasswordCredentialRepository,
  createPasswordCredentialService,
  makeUserPrincipal,
  makeTenantContext,
} from "@fleetos/identity";
import { asCorrelationId, asTenantId, asUserId } from "@fleetos/contracts";

/** One member to seed (a principal + roles + optional password credential). */
export interface SeedMember {
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly password?: string;
}

/** Seed a workspace + its members over the REAL identity seams. */
export async function seedWorkspace(
  driver: DurableDriver,
  input: {
    readonly tenantId: string;
    readonly name: string;
    readonly members: readonly SeedMember[];
  },
): Promise<void> {
  const scoped = await createRequestScopedRecordStore({ driver, tenants: [input.tenantId] });
  const store = scoped.store;
  const ctx = makeTenantContext(asTenantId(input.tenantId), asCorrelationId("cor_seed0000001"));
  const tenants = createDurableTenantRepository(store);
  const principals = createDurablePrincipalRepository(store);
  const assignments = createDurableRoleAssignmentRepository(store);
  const credentials = createDurablePasswordCredentialRepository(store);
  const passwordService = createPasswordCredentialService({
    credentials,
    hasher: createServerPasswordHasher(),
  });

  const put = tenants.putWorkspace(ctx, {
    tenantId: asTenantId(input.tenantId),
    name: input.name,
    status: "active",
    createdAt: "2026-10-02T00:00:00Z",
    createdBy: makeUserPrincipal(asTenantId(input.tenantId), asUserId(input.members[0]!.email)).principalId,
  });
  if (!put.ok && put.reason !== "already_exists") {
    throw new Error(`seed tenant refused: ${String(put.reason)}`);
  }
  for (const member of input.members) {
    const principal = makeUserPrincipal(asTenantId(input.tenantId), asUserId(member.email));
    const membership = principals.putPrincipal(ctx, {
      tenantId: asTenantId(input.tenantId),
      principalId: principal.principalId,
      kind: "user",
      memberRef: member.email,
      displayName: member.displayName,
      createdAt: "2026-10-02T00:00:00Z",
    });
    if (!membership.ok && membership.reason !== "already_exists") {
      throw new Error(`seed principal refused: ${String(membership.reason)}`);
    }
    for (const role of member.roles) {
      const assigned = assignments.addAssignment(ctx, {
        tenantId: asTenantId(input.tenantId),
        principalId: principal.principalId,
        roleName: role,
        assignedAt: "2026-10-02T00:00:00Z",
        assignedBy: principal.principalId,
      });
      if (!assigned.ok) {
        throw new Error("seed assignment refused");
      }
    }
    if (member.password !== undefined) {
      const registered = passwordService.registerCredential({
        now: "2026-10-02T00:00:00Z",
        tenantId: asTenantId(input.tenantId),
        principalId: principal.principalId,
        memberRef: member.email,
        plainPassword: member.password,
        createdBy: principal.principalId,
        correlationId: asCorrelationId("cor_seed0000002"),
      });
      if (!registered.ok && registered.reason !== "credential_already_exists") {
        throw new Error(`seed credential refused: ${registered.message}`);
      }
    }
  }
  await scoped.flush();
}
