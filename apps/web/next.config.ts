import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  transpilePackages: ["@sdn268/shared", "@sdn268/ui"],
  async rewrites() {
    const apiOrigin = process.env.API_INTERNAL_URL ?? "http://localhost:4001";
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
