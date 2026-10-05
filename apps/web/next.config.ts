import type { NextConfig } from "next";

/**
 * FleetOS console — the Next.js runtime config (W091 [TL]).
 *
 * transpilePackages: the workspace @fleetos/* packages ship raw
 * TypeScript (the frozen architecture's source-of-truth rule) — the
 * runtime transpiles them at build time. No provider SDKs anywhere.
 */
const nextConfig: NextConfig = {
  // W144 deploy convergence: Next.js only inlines NEXT_PUBLIC_* into the
  // client bundle by default — FLEETOS_ENV (the deployment-tier label,
  // a NAME not a secret) must ALSO be inlined at build time so the client
  // composition root can select the server driver on the deployed tier.
  // Without this, the client always saw "development" and the W140 server
  // plane was unreachable from the deployed product.
  env: {
    FLEETOS_ENV: process.env.FLEETOS_ENV ?? "development",
  },
  transpilePackages: [
    "@fleetos/contracts",
    "@fleetos/device-model",
    "@fleetos/security",
    "@fleetos/policy",
    "@fleetos/actions",
    "@fleetos/audit",
    "@fleetos/learning",
    "@fleetos/web-shell",
    "@fleetos/web-device",
    "@fleetos/web-recovery",
    "@fleetos/web-security",
    "@fleetos/web-actions",
    "@fleetos/web-learning",
    "@fleetos/web-workloads",
    "@fleetos/web-commerce",
  ],
};

export default nextConfig;
