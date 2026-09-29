/**
 * W092 [TL] — the runtime environment module tests.
 *
 * Covers: the frozen environment union, fail-closed resolution, the
 * operator-facing labels, and the staging secret NAMES (presence
 * only — never values).
 */
import { describe, expect, test } from "bun:test";
import {
  FLEETOS_ENVS,
  REQUIRED_STAGING_SECRET_NAMES,
  fleetOsEnv,
  environmentLabel,
  stagingSecretPresence,
} from "../src/runtime/env";

describe("W092 runtime environment module", () => {
  test("the environment union is frozen and machine-stable", () => {
    expect([...FLEETOS_ENVS]).toEqual(["development", "staging", "production"]);
    expect(Object.isFrozen(FLEETOS_ENVS)).toBe(true);
  });

  test("resolution is fail-closed to development for unknown values", () => {
    const saved = process.env.FLEETOS_ENV;
    process.env.FLEETOS_ENV = "nonsense";
    expect(fleetOsEnv()).toBe("development");
    process.env.FLEETOS_ENV = "staging";
    expect(fleetOsEnv()).toBe("staging");
    process.env.FLEETOS_ENV = "production";
    expect(fleetOsEnv()).toBe("production");
    delete process.env.FLEETOS_ENV;
    expect(fleetOsEnv()).toBe("development");
    if (typeof saved === "string") process.env.FLEETOS_ENV = saved;
  });

  test("the labels are operator-facing and non-commercial staging is disclosed", () => {
    const saved = process.env.FLEETOS_ENV;
    process.env.FLEETOS_ENV = "staging";
    expect(environmentLabel()).toBe("staging (free tier — non-commercial)");
    delete process.env.FLEETOS_ENV;
    expect(environmentLabel()).toBe("development");
    if (typeof saved === "string") process.env.FLEETOS_ENV = saved;
  });

  test("the staging secret NAMES are the frozen required set (names only, never values)", () => {
    expect([...REQUIRED_STAGING_SECRET_NAMES]).toEqual([
      "FLEETOS_ENV",
      "FLEETOS_BASE_URL",
      "DATABASE_URL",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ]);
    const presence = stagingSecretPresence();
    expect(presence.every((entry) => typeof entry.present === "boolean")).toBe(true);
    // The presence report carries NAMES ONLY — no value ever leaks.
    expect(JSON.stringify(presence)).not.toMatch(/[a-z0-9]{20,}/);
  });
});
