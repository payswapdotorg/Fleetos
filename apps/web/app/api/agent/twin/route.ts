/**
 * W140 — the agent's Device Twin confirmation (the enrollment
 * journey's terminal goal).
 *
 *   GET /api/agent/twin — trust-token authenticated. Does the device
 *   record exist, and how many REAL observations has it produced (the
 *   admitted-events registry is the honest count).
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleAgentTwinStatus } from "../../../../src/server/server-checkin";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleAgentTwinStatus(request);
}
