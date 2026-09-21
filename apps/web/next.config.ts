import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @portir/core ships TypeScript source; no build step in the workspace.
  transpilePackages: ["@portir/core"],
};

export default nextConfig;
