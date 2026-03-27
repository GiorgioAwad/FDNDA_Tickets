import { allowInMemoryFallback, redis, shouldUseInMemoryFallback } from "@/lib/redis"

const memoryCache = new Map<string, { data: unknown; expiresAt: number }>()
const memoryNamespaceIndex = new Map<string, Set<string>>()

const CACHE_NAMESPACE_PREFIX = "cache:ns:"

function getNamespaceIndexKey(namespace: string): string {
    return `${CACHE_NAMESPACE_PREFIX}${namespace}`
}

function inferCacheNamespaces(key: string): string[] {
    const namespaces: string[] = []

    if (key.startsWith("events:list") || key === CacheKeys.publishedEvents()) {
        namespaces.push("events:list")
    }

    return namespaces
}

function registerMemoryKey(key: string, namespaces: string[]) {
    for (const namespace of namespaces) {
        const bucket = memoryNamespaceIndex.get(namespace) || new Set<string>()
        bucket.add(key)
        memoryNamespaceIndex.set(namespace, bucket)
    }
}

function unregisterMemoryKey(key: string) {
    for (const [namespace, bucket] of memoryNamespaceIndex.entries()) {
        bucket.delete(key)
        if (bucket.size === 0) {
            memoryNamespaceIndex.delete(namespace)
        }
    }
}

async function registerRedisNamespaces(key: string, namespaces: string[], ttlSeconds: number) {
    if (!redis || namespaces.length === 0) return
    const redisClient = redis

    await Promise.all(
        namespaces.map(async (namespace) => {
            const namespaceKey = getNamespaceIndexKey(namespace)
            await redisClient.sadd(namespaceKey, key)
            await redisClient.expire(namespaceKey, Math.max(ttlSeconds * 4, CacheTTL.VERY_LONG))
        })
    )
}

async function deleteRedisNamespace(namespace: string) {
    if (!redis) return

    const namespaceKey = getNamespaceIndexKey(namespace)
    const keys = (await redis.smembers(namespaceKey)) as string[]

    if (keys.length > 0) {
        await redis.del(...keys)
    }

    await redis.del(namespaceKey)
}

export const CacheKeys = {
    event: (id: string) => `event:${id}`,
    eventBySlug: (slug: string) => `event:slug:${slug}`,
    eventsList: (filter?: string) => `events:list${filter ? `:${filter}` : ""}`,
    publishedEvents: () => "events:published",
    ticketTypes: (eventId: string) => `ticket-types:${eventId}`,
    ticketTypeStock: (ticketTypeId: string) => `ticket-type:stock:${ticketTypeId}`,
    eventStats: (eventId: string) => `event:stats:${eventId}`,
    eventAttendance: (eventId: string, date: string) => `event:attendance:${eventId}:${date}`,
    userTickets: (userId: string) => `user:tickets:${userId}`,
    userOrders: (userId: string) => `user:orders:${userId}`,
}

export const CacheTTL = {
    SHORT: 30,
    MEDIUM: 300,
    LONG: 3600,
    VERY_LONG: 86400,
}

export async function cacheGet<T>(key: string): Promise<T | null> {
    try {
        if (redis) {
            return await redis.get<T>(key)
        }

        if (!shouldUseInMemoryFallback("cache.get")) {
            return null
        }

        const entry = memoryCache.get(key)
        if (entry && entry.expiresAt > Date.now()) {
            return entry.data as T
        }

        if (entry) {
            memoryCache.delete(key)
            unregisterMemoryKey(key)
        }

        return null
    } catch (error) {
        console.error("Cache get error:", error)
        return null
    }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number = CacheTTL.MEDIUM): Promise<void> {
    const namespaces = inferCacheNamespaces(key)

    try {
        if (redis) {
            await redis.set(key, value, { ex: ttlSeconds })
            await registerRedisNamespaces(key, namespaces, ttlSeconds)
            return
        }

        if (!shouldUseInMemoryFallback("cache.set")) {
            return
        }

        memoryCache.set(key, {
            data: value,
            expiresAt: Date.now() + ttlSeconds * 1000,
        })
        registerMemoryKey(key, namespaces)
    } catch (error) {
        console.error("Cache set error:", error)
    }
}

export async function cacheDelete(key: string): Promise<void> {
    try {
        if (redis) {
            await redis.del(key)
            return
        }

        if (!allowInMemoryFallback) {
            return
        }

        memoryCache.delete(key)
        unregisterMemoryKey(key)
    } catch (error) {
        console.error("Cache delete error:", error)
    }
}

export async function cacheDeleteNamespace(namespace: string): Promise<void> {
    try {
        if (redis) {
            await deleteRedisNamespace(namespace)
            return
        }

        if (!allowInMemoryFallback) {
            return
        }

        const keys = Array.from(memoryNamespaceIndex.get(namespace) || [])
        for (const key of keys) {
            memoryCache.delete(key)
        }
        memoryNamespaceIndex.delete(namespace)
    } catch (error) {
        console.error("Cache delete namespace error:", error)
    }
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
    if (pattern.endsWith("*")) {
        await cacheDeleteNamespace(pattern.slice(0, -1))
        return
    }

    await cacheDelete(pattern)
}

export async function cacheGetOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = CacheTTL.MEDIUM
): Promise<T> {
    const cached = await cacheGet<T>(key)
    if (cached !== null) {
        return cached
    }

    const fresh = await fetcher()
    void cacheSet(key, fresh, ttlSeconds)
    return fresh
}

export async function invalidateEventCache(eventId: string, slug?: string): Promise<void> {
    const keysToDelete = [
        CacheKeys.event(eventId),
        CacheKeys.ticketTypes(eventId),
        CacheKeys.eventStats(eventId),
        CacheKeys.publishedEvents(),
    ]

    if (slug) {
        keysToDelete.push(CacheKeys.eventBySlug(slug))
    }

    await Promise.all(keysToDelete.map((key) => cacheDelete(key)))
    await cacheDeleteNamespace("events:list")
}

export async function invalidateTicketTypeCache(eventId: string, ticketTypeId?: string): Promise<void> {
    await cacheDelete(CacheKeys.ticketTypes(eventId))

    if (ticketTypeId) {
        await cacheDelete(CacheKeys.ticketTypeStock(ticketTypeId))
    }
}

export async function invalidateUserCache(userId: string): Promise<void> {
    await Promise.all([
        cacheDelete(CacheKeys.userTickets(userId)),
        cacheDelete(CacheKeys.userOrders(userId)),
    ])
}

export async function cacheIncrement(key: string, amount: number = 1): Promise<number> {
    try {
        if (redis) {
            return await redis.incrby(key, amount)
        }

        if (!shouldUseInMemoryFallback("cache.increment")) {
            return 0
        }

        const entry = memoryCache.get(key)
        const current = (entry?.data as number) || 0
        const newValue = current + amount
        memoryCache.set(key, {
            data: newValue,
            expiresAt: Date.now() + CacheTTL.LONG * 1000,
        })
        return newValue
    } catch (error) {
        console.error("Cache increment error:", error)
        return 0
    }
}

export async function cacheDecrement(key: string, amount: number = 1): Promise<number> {
    return cacheIncrement(key, -amount)
}

export async function acquireLock(lockKey: string, ttlSeconds: number = 10): Promise<boolean> {
    try {
        if (redis) {
            const result = await redis.set(lockKey, "1", { ex: ttlSeconds, nx: true })
            return result === "OK"
        }

        if (!shouldUseInMemoryFallback("cache.lock")) {
            return false
        }

        const entry = memoryCache.get(lockKey)
        if (entry && entry.expiresAt > Date.now()) {
            return false
        }

        memoryCache.set(lockKey, {
            data: "1",
            expiresAt: Date.now() + ttlSeconds * 1000,
        })
        return true
    } catch (error) {
        console.error("Acquire lock error:", error)
        return false
    }
}

export async function releaseLock(lockKey: string): Promise<void> {
    await cacheDelete(lockKey)
}

export default redis
