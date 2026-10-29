import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === "production" ? { output: "export" as const } : {}),
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@sdn268/shared", "@sdn268/ui"],
  ...(process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          const apiOrigin = process.env.API_INTERNAL_URL ?? "http://localhost:4001";
          return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
        },
      }
    : {}),
};

export default nextConfig;
