const PRODUCTION_APP_URL = "https://ticketingfdnda.pe"
const LOCAL_APP_URL = "http://localhost:3000"

type EmailUrlEnvironment = {
    EMAIL_LINK_BASE_URL?: string
    NEXT_PUBLIC_APP_URL?: string
    NEXTAUTH_URL?: string
    NODE_ENV?: string
}

function normalizeHttpOrigin(value: string | undefined): string | null {
    const candidate = (value || "").trim()
    if (!candidate) return null

    try {
        const url = new URL(candidate)
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null
        }

        return url.origin
    } catch {
        return null
    }
}

// Dominios *.vercel.app son despliegues legacy: NUNCA deben usarse como origen
// de links de email (en ningún entorno), o el correo de verificación termina
// redirigiendo a Vercel en vez del dominio oficial.
function isVercelOrigin(origin: string): boolean {
    return new URL(origin).hostname.toLowerCase().endsWith(".vercel.app")
}

function isLoopbackOrigin(origin: string): boolean {
    const hostname = new URL(origin).hostname.toLowerCase()
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

export function resolveEmailBaseUrl(
    env: EmailUrlEnvironment = process.env
): string {
    const configuredUrls = [
        env.EMAIL_LINK_BASE_URL,
        env.NEXT_PUBLIC_APP_URL,
        env.NEXTAUTH_URL,
    ]

    for (const value of configuredUrls) {
        const configuredUrl = normalizeHttpOrigin(value)
        if (!configuredUrl) continue
        // Vercel jamás es válido como dominio de email.
        if (isVercelOrigin(configuredUrl)) continue
        // En producción tampoco aceptamos localhost / loopback.
        if (env.NODE_ENV === "production" && isLoopbackOrigin(configuredUrl)) {
            continue
        }

        return configuredUrl
    }

    return env.NODE_ENV === "production" ? PRODUCTION_APP_URL : LOCAL_APP_URL
}

export function buildEmailUrl(
    pathname: string,
    env: EmailUrlEnvironment = process.env
): string {
    return new URL(pathname, `${resolveEmailBaseUrl(env)}/`).toString()
}

export function canonicalizeQueuedEmailUrl(
    rawUrl: unknown,
    expectedPathname: string,
    env: EmailUrlEnvironment = process.env
): string {
    const canonicalUrl = new URL(expectedPathname, `${resolveEmailBaseUrl(env)}/`)

    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
        return canonicalUrl.toString()
    }

    try {
        const queuedUrl = new URL(rawUrl)
        canonicalUrl.search = queuedUrl.search
        canonicalUrl.hash = queuedUrl.hash
    } catch {
        // Invalid or legacy values still receive the current canonical origin.
    }

    return canonicalUrl.toString()
}
