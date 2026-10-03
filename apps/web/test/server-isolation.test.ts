/**
 * W140 — the SERVER-ONLY MODULE ISOLATION proof (the import-boundary
 * check): a static import-graph walk from every CLIENT entry point of
 * the console application proves that NO client-reachable module
 * transitively imports the server plane (apps/web/src/server/**) or
 * the Neon driver (@neondatabase/serverless). The driver lives
 * server-only; no secret VALUE reaches a client bundle or a response.
 */

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const WEB_ROOT = path.resolve(import.meta.dir, "..");

/** The client entry points (everything Next.js can bundle for the browser). */
const CLIENT_ENTRIES: readonly string[] = [
  "src/index.ts",
  "src/console-app.tsx",
  "app/layout.tsx",
];

/** Resolve a module specifier against a file (relative + @fleetos/* + @/). */
function resolveSpecifier(fromFile: string, spec: string): string | undefined {
  if (spec.startsWith("@fleetos/")) {
    // A workspace package: resolve through the root node_modules link.
    const pkgDir = findWorkspacePackage(spec);
    if (pkgDir === undefined) return undefined;
    const entry = path.join(pkgDir, "src", "index.ts");
    return fs.existsSync(entry) ? entry : undefined;
  }
  if (spec.startsWith("@/")) {
    const target = path.join(WEB_ROOT, "src", spec.slice(2));
    return resolveFile(target);
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const target = path.resolve(path.dirname(fromFile), spec);
    return resolveFile(target);
  }
  return undefined; // external package — out of the walk's scope
}

/** Find a @fleetos/* package's directory (packages/* or apps/web/*). */
function findWorkspacePackage(name: string): string | undefined {
  const short = name.slice("@fleetos/".length);
  const candidates = [
    path.resolve(WEB_ROOT, "..", "packages", short),
    path.resolve(WEB_ROOT, short),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return undefined;
}

/** Resolve a path to a file (.ts/.tsx/index). */
function resolveFile(target: string): string | undefined {
  for (const candidate of [`${target}.ts`, `${target}.tsx`, path.join(target, "index.ts"), path.join(target, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Extract every import specifier from a source file (static + dynamic). */
function importSpecifiersOf(source: string): readonly string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match !== null) {
      specs.push(match[1]!);
      match = pattern.exec(source);
    }
  }
  return specs;
}

/** Walk the import graph from one entry (visited-set bounded). */
function walkFrom(entry: string): readonly string[] {
  const visited = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of importSpecifiersOf(source)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved !== undefined && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return [...visited];
}

describe("W140 server-only module isolation (the import-boundary proof)", () => {
  test("no client-reachable module imports the server plane or the Neon driver", () => {
    for (const entry of CLIENT_ENTRIES) {
      const entryPath = path.join(WEB_ROOT, entry);
      expect(fs.existsSync(entryPath)).toBe(true);
      const reachable = walkFrom(entryPath);
      for (const file of reachable) {
        const rel = path.relative(WEB_ROOT, file);
        expect(rel.startsWith("src/server/")).toBe(false);
        const source = fs.readFileSync(file, "utf8");
        expect(source.includes("@neondatabase/serverless")).toBe(false);
      }
    }
  });

  test("the driver module is imported ONLY by the server plane and the API routes", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === "test") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          const source = fs.readFileSync(full, "utf8");
          if (source.includes("@neondatabase/serverless")) {
            const rel = path.relative(WEB_ROOT, full);
            const allowed = rel.startsWith("src/server/") || rel.startsWith("app/api/");
            if (!allowed) offenders.push(rel);
          }
        }
      }
    };
    walk(WEB_ROOT);
    expect(offenders).toEqual([]);
  });

  test("the server plane's modules import only sanctioned packages (never the adapter/integration lanes)", () => {
    const serverDir = path.join(WEB_ROOT, "src", "server");
    const forbidden = /@fleetos\/(device-adapters|integrations)/;
    for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
      if (!entry.name.endsWith(".ts")) continue;
      const source = fs.readFileSync(path.join(serverDir, entry.name), "utf8");
      const specs = importSpecifiersOf(source);
      for (const spec of specs) {
        expect(forbidden.test(spec)).toBe(false);
      }
    }
  });

  test("no route response ever echoes a secret VALUE (the env law: names only)", async () => {
    // A canary secret: if any route echoed the DATABASE_URL value, the
    // canary would appear in a response body.
    const canary = "postgres://w140-canary-secret-value-do-not-leak@db.example/db";
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = canary;
    try {
      const { handleServerResolveSession } = await import("../src/server/server-sessions");
      const response = await handleServerResolveSession(new Request("http://localhost/api/session", { method: "GET" }));
      const text = await response.text();
      expect(text).not.toContain(canary);
      expect(text).not.toContain("postgres://");
    } finally {
      if (saved === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = saved;
      }
    }
  });
});
