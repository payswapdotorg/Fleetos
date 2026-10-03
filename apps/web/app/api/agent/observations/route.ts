/**
 * W140 — the real observation ingestion endpoint.
 *
 *   POST /api/agent/observations — the observation batch
 *   (trust-token authenticated via Authorization: Bearer). Idempotent
 *   (batch key registry: duplicate ack / conflict), back-pressured
 *   (shed), event-deduped, twin-mutated through the REAL domain
 *   functions — observations are ingested as REAL observations, never
 *   fabricated.
 *
 * Thin wrapper; the domain lives in apps/web/src/server.
 */
import { handleAgentObservations } from "../../../../src/server/server-checkin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleAgentObservations(request);
}
