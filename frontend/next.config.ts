import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the frontend to call the proxy control API on port 3001
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
