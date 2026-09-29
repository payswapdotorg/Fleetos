import type { NextConfig } from "next";

/**
 * FleetOS console — the Next.js runtime config (W091 [TL]).
 *
 * transpilePackages: the workspace @fleetos/* packages ship raw
 * TypeScript (the frozen architecture's source-of-truth rule) — the
 * runtime transpiles them at build time. No provider SDKs anywhere.
 */
const nextConfig: NextConfig = {
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
