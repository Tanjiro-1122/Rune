import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "hvvrbpvsgjxiicigkwhu.supabase.co" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
};

export const config = {
  api: {
    "/api/chat": {
      maxDuration: 60,
    },
  },
};

export default nextConfig;
