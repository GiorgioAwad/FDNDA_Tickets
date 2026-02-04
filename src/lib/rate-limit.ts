import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

// Rate limiter usando memoria en desarrollo, Upstash Redis en producción
const isProduction = process.env.NODE_ENV === "production"

// Crear instancia de Redis solo si hay credenciales
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null

// Cache en memoria para desarrollo
const memoryCache = new Map<string, { count: number; resetAt: number }>()

// Rate limiters para diferentes endpoints
export const rateLimiters = {
    // Login: 5 intentos por minuto por IP
    auth: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(5, "1 m"),
            analytics: true,
            prefix: "ratelimit:auth",
        })
        : null,

    // API general: 100 requests por minuto por IP
    api: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(100, "1 m"),
            analytics: true,
            prefix: "ratelimit:api",
        })
        : null,

    // Pagos: 10 intentos por minuto por usuario
    payment: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(10, "1 m"),
            analytics: true,
            prefix: "ratelimit:payment",
        })
        : null,

    // Scanner: 300 escaneos por minuto (5 por segundo) - Alto volumen para colas
    scanner: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(300, "1 m"),
            analytics: true,
            prefix: "ratelimit:scanner",
        })
        : null,
}

// Función de rate limit con fallback a memoria
export async function rateLimit(
    identifier: string,
    type: keyof typeof rateLimiters = "api"
): Promise<{ success: boolean; remaining: number; reset: number }> {
    const limiter = rateLimiters[type]

    // Si hay limiter de Upstash, usarlo
    if (limiter) {
        const result = await limiter.limit(identifier)
        return {
            success: result.success,
            remaining: result.remaining,
            reset: result.reset,
        }
    }

    // Fallback: rate limiting en memoria (solo para desarrollo)
    const limits: Record<keyof typeof rateLimiters, { max: number; window: number }> = {
        auth: { max: 5, window: 60000 },
        api: { max: 100, window: 60000 },
        payment: { max: 10, window: 60000 },
        scanner: { max: 300, window: 60000 }, // 5 escaneos por segundo
    }

    const { max, window } = limits[type]
    const key = `${type}:${identifier}`
    const now = Date.now()

    const entry = memoryCache.get(key)

    if (!entry || entry.resetAt < now) {
        memoryCache.set(key, { count: 1, resetAt: now + window })
        return { success: true, remaining: max - 1, reset: now + window }
    }

    if (entry.count >= max) {
        return { success: false, remaining: 0, reset: entry.resetAt }
    }

    entry.count++
    return { success: true, remaining: max - entry.count, reset: entry.resetAt }
}

// Helper para obtener IP del request
export function getClientIP(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for")
    const realIP = request.headers.get("x-real-ip")
    
    if (forwarded) {
        return forwarded.split(",")[0].trim()
    }
    
    if (realIP) {
        return realIP
    }
    
    return "unknown"
}
