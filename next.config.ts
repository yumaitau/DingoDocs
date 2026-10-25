import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "public/fonts/**/*",
      "node_modules/node-cron/**/*",
      "node_modules/@aws-sdk/client-license-manager/**/*",
      "node_modules/@aws-sdk/client-sesv2/**/*",
    ],
  },
  poweredByHeader: false,
  async headers() {
    const developmentEval =
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${developmentEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
      // Inline previews of uploaded or generated content must never run
      // script on the app origin. Next applies the matching header listed
      // last, and route-handler CSP headers lose to the global one above, so
      // the preview policies live here.
      {
        source: "/api/v1/evidence/:id/preview",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          },
        ],
      },
      {
        source: "/api/(v1|portal)/reports/:id/preview",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; sandbox",
          },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
    // Server actions post to page routes, which pass through src/proxy.ts.
    proxyClientMaxBodySize: "16mb",
  },
};

export default nextConfig;
