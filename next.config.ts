import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

function buildContentSecurityPolicy() {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "https://sandbox-checkout.izipay.pe",
    "https://checkout.izipay.pe",
  ];

  const styleSrc = [
    "'self'",
    "'unsafe-inline'",
  ];

  const connectSrc = [
    "'self'",
    "https://sandbox-checkout.izipay.pe",
    "https://checkout.izipay.pe",
    "https://sandbox-api-pw.izipay.pe",
    "https://api-pw.izipay.pe",
  ];

  const imgSrc = [
    "'self'",
    "data:",
    "blob:",
    "https:",
  ];

  const frameSrc = [
    "'self'",
    "https://sandbox-checkout.izipay.pe",
    "https://checkout.izipay.pe",
  ];

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `img-src ${imgSrc.join(" ")}`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
    `form-action 'self' https://sandbox-checkout.izipay.pe https://checkout.izipay.pe`,
    `manifest-src 'self'`,
    `worker-src 'self' blob:`,
  ];

  return directives.join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.0.162:3000",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "**.fdnda.org.pe",
      },
      {
        protocol: "https",
        hostname: "ticketingfdnda.pe",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
      },
    ],
  },
  // Security headers for production
  async headers() {
    const securityHeaders = [
      {
        key: "X-DNS-Prefetch-Control",
        value: "on",
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "SAMEORIGIN",
      },
      {
        key: "X-XSS-Protection",
        value: "1; mode=block",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(), geolocation=()",
      },
    ];

    if (isProduction) {
      securityHeaders.push({
        key: "Content-Security-Policy",
        value: buildContentSecurityPolicy(),
      });
    }

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
