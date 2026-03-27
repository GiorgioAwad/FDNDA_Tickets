import * as Sentry from "@sentry/nextjs"

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: process.env.NODE_ENV === "production",

    // Performance: captura 20% de transacciones en produccion
    tracesSampleRate: 0.2,

    // Session Replay: captura 10% de sesiones y 100% de sesiones con errores
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
        Sentry.replayIntegration(),
        Sentry.browserTracingIntegration(),
    ],

    // No enviar errores de red comunes que no son bugs reales
    ignoreErrors: [
        "ResizeObserver loop",
        "AbortError",
        "Network request failed",
        "Load failed",
    ],
})
