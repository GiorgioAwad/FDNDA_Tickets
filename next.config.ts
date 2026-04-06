import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isProduction = process.env.NODE_ENV === "production";

function buildContentSecurityPolicy() {
  const scriptSrc = isProduction
    ? [
        "'self'",
        "'unsafe-inline'", // Required by Izipay SDK — migrate to nonces when possible
        "https://checkout.izipay.pe",
      ]
    : [
        "'self'",
        "'unsafe-inline'",
        "https://sandbox-checkout.izipay.pe",
        "https://checkout.izipay.pe",
      ];

  const styleSrc = [
    "'self'",
    "'unsafe-inline'", // Required by Next.js for styled-jsx
  ];

  const connectSrc = isProduction
    ? [
        "'self'",
        "https://checkout.izipay.pe",
        "https://api-pw.izipay.pe",
        "https://api.izipay.pe",
      ]
    : [
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

  const frameSrc = isProduction
    ? [
        "'self'",
        "https://checkout.izipay.pe",
      ]
    : [
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
    `form-action 'self' ${isProduction ? "https://checkout.izipay.pe" : "https://sandbox-checkout.izipay.pe https://checkout.izipay.pe"}`,
    `manifest-src 'self'`,
    `worker-src 'self' blob:`,
  ];

  return directives.join("; ");
}

const nextConfig: NextConfig = {
  // Turbopack standalone copy fails on Windows for traced node:* chunks.
  ...(process.platform !== "win32" ? { output: "standalone" as const } : {}),
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
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "same-origin",
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

export default withSentryConfig(nextConfig, {
  // Solo sube source maps si hay auth token (produccion)
  silent: !process.env.SENTRY_AUTH_TOKEN,

  // Sube source maps para mejor stack traces en Sentry
  widenClientFileUpload: true,

  // Oculta source maps del publico (solo Sentry las ve)
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Desactiva el logger para no agregar peso al bundle
  disableLogger: true,
});
