/**
 * @fleetos/web — the runtime environment module (W092 [TL]).
 *
 * Environment separation per docs/tech-lead/FREE-TIER-DEPLOYMENT.md:
 * the deployment tier is declared by FLEETOS_ENV (development |
 * staging | production) and consumed ONLY at the server/runtime
 * boundary. Secrets NEVER reach client-side bundles: this module
 * exposes NAMES and TIER LABELS, never values.
 */
export type FleetOsEnv = "development" | "staging" | "production";

/** The frozen environment label union (machine-stable refusal). */
export const FLEETOS_ENVS: readonly FleetOsEnv[] = Object.freeze([
  "development",
  "staging",
  "production",
] as const);

/** Resolve the deployment tier (fail-closed to development). */
export function fleetOsEnv(): FleetOsEnv {
  const raw = process.env.FLEETOS_ENV;
  if (raw === "staging" || raw === "production") return raw;
  return "development";
}

/** Operator-facing environment label (the AppShell's identity chip). */
export function environmentLabel(): string {
  const env = fleetOsEnv();
  if (env === "staging") return "staging (free tier — non-commercial)";
  if (env === "production") return "production";
  return "development";
}

/** The staging secret NAMES the deployment requires (never values). */
export const REQUIRED_STAGING_SECRET_NAMES: readonly string[] = Object.freeze([
  "FLEETOS_ENV",
  "FLEETOS_BASE_URL",
  "DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const);

/** Which staging secret NAMES are present in this process (names only). */
export function stagingSecretPresence(): readonly { readonly name: string; readonly present: boolean }[] {
  return REQUIRED_STAGING_SECRET_NAMES.map((name) => ({
    name,
    present: typeof process.env[name] === "string" && process.env[name]!.length > 0,
  }));
}
