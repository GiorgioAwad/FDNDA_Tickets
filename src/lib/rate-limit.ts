import { Ratelimit } from "@upstash/ratelimit"
import { redis, shouldUseInMemoryFallback } from "@/lib/redis"

const memoryCache = new Map<string, { count: number; resetAt: number }>()

export const rateLimiters = {
    auth: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(5, "1 m"),
            analytics: true,
            prefix: "ratelimit:auth",
        })
        : null,
    api: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(100, "1 m"),
            analytics: true,
            prefix: "ratelimit:api",
        })
        : null,
    payment: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(10, "1 m"),
            analytics: true,
            prefix: "ratelimit:payment",
        })
        : null,
    scanner: redis
        ? new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(300, "1 m"),
            analytics: true,
            prefix: "ratelimit:scanner",
        })
        : null,
}

export async function rateLimit(
    identifier: string,
    type: keyof typeof rateLimiters = "api"
): Promise<{ success: boolean; remaining: number; reset: number }> {
    const limiter = rateLimiters[type]

    if (limiter) {
        const result = await limiter.limit(identifier)
        return {
            success: result.success,
            remaining: result.remaining,
            reset: result.reset,
        }
    }

    if (!shouldUseInMemoryFallback(`rate-limit.${type}`)) {
        return {
            success: true,
            remaining: Number.MAX_SAFE_INTEGER,
            reset: Date.now() + 60_000,
        }
    }

    const limits: Record<keyof typeof rateLimiters, { max: number; window: number }> = {
        auth: { max: 5, window: 60_000 },
        api: { max: 100, window: 60_000 },
        payment: { max: 10, window: 60_000 },
        scanner: { max: 300, window: 60_000 },
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

    entry.count += 1
    return { success: true, remaining: max - entry.count, reset: entry.resetAt }
}

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
