import { Redis } from "@upstash/redis"

// ==================== REDIS CLIENT ====================

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null

// Cache en memoria como fallback para desarrollo
const memoryCache = new Map<string, { data: unknown; expiresAt: number }>()

// ==================== CACHE KEYS ====================

export const CacheKeys = {
    // Eventos
    event: (id: string) => `event:${id}`,
    eventBySlug: (slug: string) => `event:slug:${slug}`,
    eventsList: (filter?: string) => `events:list${filter ? `:${filter}` : ""}`,
    publishedEvents: () => "events:published",
    
    // Tipos de ticket
    ticketTypes: (eventId: string) => `ticket-types:${eventId}`,
    ticketTypeStock: (ticketTypeId: string) => `ticket-type:stock:${ticketTypeId}`,
    
    // Estadísticas de evento
    eventStats: (eventId: string) => `event:stats:${eventId}`,
    eventAttendance: (eventId: string, date: string) => `event:attendance:${eventId}:${date}`,
    
    // Usuario
    userTickets: (userId: string) => `user:tickets:${userId}`,
    userOrders: (userId: string) => `user:orders:${userId}`,
}

// ==================== TTL (Time To Live) ====================

export const CacheTTL = {
    SHORT: 30,           // 30 segundos - datos muy dinámicos
    MEDIUM: 300,         // 5 minutos - datos moderadamente dinámicos
    LONG: 3600,          // 1 hora - datos relativamente estáticos
    VERY_LONG: 86400,    // 24 horas - datos muy estáticos
}

// ==================== CACHE FUNCTIONS ====================

/**
 * Obtener valor del cache
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
    try {
        if (redis) {
            const data = await redis.get<T>(key)
            return data
        }
        
        // Fallback a memoria
        const entry = memoryCache.get(key)
        if (entry && entry.expiresAt > Date.now()) {
            return entry.data as T
        }
        memoryCache.delete(key)
        return null
    } catch (error) {
        console.error("Cache get error:", error)
        return null
    }
}

/**
 * Guardar valor en cache
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number = CacheTTL.MEDIUM): Promise<void> {
    try {
        if (redis) {
            await redis.set(key, value, { ex: ttlSeconds })
            return
        }
        
        // Fallback a memoria
        memoryCache.set(key, {
            data: value,
            expiresAt: Date.now() + (ttlSeconds * 1000),
        })
    } catch (error) {
        console.error("Cache set error:", error)
    }
}

/**
 * Eliminar valor del cache
 */
export async function cacheDelete(key: string): Promise<void> {
    try {
        if (redis) {
            await redis.del(key)
            return
        }
        memoryCache.delete(key)
    } catch (error) {
        console.error("Cache delete error:", error)
    }
}

/**
 * Eliminar múltiples keys por patrón
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
    try {
        if (redis) {
            // Upstash no soporta SCAN, usamos keys conocidas
            // En producción, mantener lista de keys o usar prefijos específicos
            const keys = await redis.keys(pattern)
            if (keys.length > 0) {
                await redis.del(...keys)
            }
            return
        }
        
        // Fallback a memoria
        const regex = new RegExp(pattern.replace("*", ".*"))
        for (const key of memoryCache.keys()) {
            if (regex.test(key)) {
                memoryCache.delete(key)
            }
        }
    } catch (error) {
        console.error("Cache delete pattern error:", error)
    }
}

/**
 * Obtener o establecer cache (cache-aside pattern)
 */
export async function cacheGetOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = CacheTTL.MEDIUM
): Promise<T> {
    // Intentar obtener del cache
    const cached = await cacheGet<T>(key)
    if (cached !== null) {
        return cached
    }
    
    // Si no está en cache, obtener datos frescos
    const fresh = await fetcher()
    
    // Guardar en cache (no esperar)
    void cacheSet(key, fresh, ttlSeconds)
    
    return fresh
}

/**
 * Invalidar cache de evento (cuando se actualiza)
 */
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
    
    await Promise.all(keysToDelete.map(key => cacheDelete(key)))
    
    // Invalidar listas de eventos
    await cacheDeletePattern("events:list*")
}

/**
 * Invalidar cache de tipo de ticket
 */
export async function invalidateTicketTypeCache(eventId: string, ticketTypeId?: string): Promise<void> {
    await cacheDelete(CacheKeys.ticketTypes(eventId))
    
    if (ticketTypeId) {
        await cacheDelete(CacheKeys.ticketTypeStock(ticketTypeId))
    }
}

/**
 * Invalidar cache de usuario
 */
export async function invalidateUserCache(userId: string): Promise<void> {
    await Promise.all([
        cacheDelete(CacheKeys.userTickets(userId)),
        cacheDelete(CacheKeys.userOrders(userId)),
    ])
}

// ==================== ATOMIC OPERATIONS ====================

/**
 * Incrementar contador atómicamente (para stock)
 */
export async function cacheIncrement(key: string, amount: number = 1): Promise<number> {
    try {
        if (redis) {
            return await redis.incrby(key, amount)
        }
        
        // Fallback a memoria (no atómico pero funcional)
        const entry = memoryCache.get(key)
        const current = (entry?.data as number) || 0
        const newValue = current + amount
        memoryCache.set(key, { data: newValue, expiresAt: Date.now() + CacheTTL.LONG * 1000 })
        return newValue
    } catch (error) {
        console.error("Cache increment error:", error)
        return 0
    }
}

/**
 * Decrementar contador atómicamente
 */
export async function cacheDecrement(key: string, amount: number = 1): Promise<number> {
    return cacheIncrement(key, -amount)
}

// ==================== DISTRIBUTED LOCK ====================

/**
 * Obtener lock distribuido (para operaciones críticas)
 */
export async function acquireLock(
    lockKey: string, 
    ttlSeconds: number = 10
): Promise<boolean> {
    try {
        if (redis) {
            const result = await redis.set(lockKey, "1", { ex: ttlSeconds, nx: true })
            return result === "OK"
        }
        
        // Fallback a memoria
        if (memoryCache.has(lockKey)) {
            const entry = memoryCache.get(lockKey)
            if (entry && entry.expiresAt > Date.now()) {
                return false
            }
        }
        memoryCache.set(lockKey, { data: "1", expiresAt: Date.now() + ttlSeconds * 1000 })
        return true
    } catch (error) {
        console.error("Acquire lock error:", error)
        return false
    }
}

/**
 * Liberar lock
 */
export async function releaseLock(lockKey: string): Promise<void> {
    await cacheDelete(lockKey)
}

export default redis
