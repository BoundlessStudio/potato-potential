import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { withWorkflow } from "workflow/next";
loadEnvConfig(path.resolve(process.cwd(), "../.."));
if (
  process.env.VERCEL &&
  (process.env.DEMO_MODE === "true" ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true")
)
  throw new Error("Preview mode cannot be deployed.");
const config: NextConfig = {
  transpilePackages: ["@boundless/shared", "@boundless/control-plane"],
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return ["/api/:path*", "/auth/:path*", "/.well-known/workflow/:path*"].map(
      (source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      }),
    );
  },
};
export default withWorkflow(config);
