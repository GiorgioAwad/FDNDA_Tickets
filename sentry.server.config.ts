import * as Sentry from "@sentry/nextjs"

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: process.env.NODE_ENV === "production",

    // Performance: captura 20% de transacciones del servidor
    tracesSampleRate: 0.2,
})
