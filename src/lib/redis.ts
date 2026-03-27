import { Redis } from "@upstash/redis"

const isProduction = process.env.NODE_ENV === "production"

export const redis =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        })
        : null

export const isRedisConfigured = Boolean(redis)
export const allowInMemoryFallback =
    !isProduction || process.env.ALLOW_IN_MEMORY_REDIS_FALLBACK === "true"

export function shouldUseInMemoryFallback(feature: string): boolean {
    if (allowInMemoryFallback) return true

    if (!isRedisConfigured) {
        console.warn(`[redis] ${feature} running without Redis in production`)
    }

    return false
}
