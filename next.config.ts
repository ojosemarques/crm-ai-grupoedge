import type { NextConfig } from "next";

import { createStaticSecurityHeaders } from "./src/shared/core/security/security-headers";

const canonicalUrl = process.env.APP_CANONICAL_URL;
const useHsts = (process.env.APP_ENV === "staging" || process.env.APP_ENV === "production")
  && canonicalUrl?.startsWith("https://") === true;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...createStaticSecurityHeaders({ https: useHsts })],
      },
    ];
  },
};

export default nextConfig;
