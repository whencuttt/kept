import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async rewrites() { return [{ source: "/.well-known/kept.json", destination: "/api/v1/key" }]; },
  async headers() { return [{ source: "/api/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" }, { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" }] }]; },
};
export default nextConfig;
