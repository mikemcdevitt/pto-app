import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baseline security headers on every response. Deliberately no full
  // Content-Security-Policy yet (that needs nonce/hash setup for Next's
  // inline scripts) -- just frame-ancestors, so no other site can embed
  // these pages in an iframe (clickjacking the admin forms).
  // public/grade-chart-element.js is loaded by Wix as a <script>, and
  // /api/grade-participation is fetched -- neither is framed, so DENY
  // doesn't affect them.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
