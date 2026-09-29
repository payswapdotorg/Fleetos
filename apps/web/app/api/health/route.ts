/**
 * The console's post-deploy health route (W092 [TL]).
 *
 * Returns the deployment's observable health shape: the environment
 * tier, the module identities of the composed surface, and the
 * PRESENCE (never values) of the required staging secret names.
 * Machine-stable JSON: sorted keys, no clock, no ids from unstable
 * sources — the same deployment yields the same response.
 */
import { NextResponse } from "next/server";
import { fleetOsEnv, stagingSecretPresence } from "../../../src/runtime/env";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  const secrets = stagingSecretPresence();
  return NextResponse.json(
    {
      env: fleetOsEnv(),
      health: "healthy" as const,
      module: "web" as const,
      secrets: secrets.map((entry) => ({ name: entry.name, present: entry.present })),
    },
    { status: 200 },
  );
}
