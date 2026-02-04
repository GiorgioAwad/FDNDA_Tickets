import { prisma } from "./prisma"
import { 
    cacheGetOrSet, 
    cacheDelete, 
    CacheKeys, 
    CacheTTL,
    invalidateEventCache,
    invalidateTicketTypeCache
} from "./cache"

// ==================== TYPES ====================

export interface CachedEvent {
    id: string
    slug: string
    title: string
    description: string
    location: string
    venue: string
    bannerUrl: string | null
    startDate: string
    endDate: string
    mode: string
    isPublished: boolean
    discipline: string | null
}

export interface CachedTicketType {
    id: string
    eventId: string
    name: string
    description: string | null
    price: number
    currency: string
    capacity: number
    sold: number
    available: number
    isPackage: boolean
    packageDaysCount: number | null
    validDays: string[] | null
    isActive: boolean
    sortOrder: number
}

export interface EventWithTicketTypes extends CachedEvent {
    ticketTypes: CachedTicketType[]
}

// ==================== CACHED QUERIES ====================

/**
 * Obtener evento por ID (con cache)
 */
export async function getCachedEvent(eventId: string): Promise<CachedEvent | null> {
    return cacheGetOrSet(
        CacheKeys.event(eventId),
        async () => {
            const event = await prisma.event.findUnique({
                where: { id: eventId },
            })
            
            if (!event) return null
            
            return {
                id: event.id,
                slug: event.slug,
                title: event.title,
                description: event.description,
                location: event.location,
                venue: event.venue,
                bannerUrl: event.bannerUrl,
                startDate: event.startDate.toISOString(),
                endDate: event.endDate.toISOString(),
                mode: event.mode,
                isPublished: event.isPublished,
                discipline: event.discipline,
            }
        },
        CacheTTL.MEDIUM
    )
}

/**
 * Obtener evento por slug (con cache)
 */
export async function getCachedEventBySlug(slug: string): Promise<CachedEvent | null> {
    return cacheGetOrSet(
        CacheKeys.eventBySlug(slug),
        async () => {
            const event = await prisma.event.findUnique({
                where: { slug },
            })
            
            if (!event) return null
            
            return {
                id: event.id,
                slug: event.slug,
                title: event.title,
                description: event.description,
                location: event.location,
                venue: event.venue,
                bannerUrl: event.bannerUrl,
                startDate: event.startDate.toISOString(),
                endDate: event.endDate.toISOString(),
                mode: event.mode,
                isPublished: event.isPublished,
                discipline: event.discipline,
            }
        },
        CacheTTL.MEDIUM
    )
}

/**
 * Obtener tipos de ticket por evento (con cache)
 */
export async function getCachedTicketTypes(eventId: string): Promise<CachedTicketType[]> {
    return cacheGetOrSet(
        CacheKeys.ticketTypes(eventId),
        async () => {
            const ticketTypes = await prisma.ticketType.findMany({
                where: { 
                    eventId,
                    isActive: true,
                },
                orderBy: { sortOrder: "asc" },
            })
            
            return ticketTypes.map(tt => ({
                id: tt.id,
                eventId: tt.eventId,
                name: tt.name,
                description: tt.description,
                price: Number(tt.price),
                currency: tt.currency,
                capacity: tt.capacity,
                sold: tt.sold,
                available: tt.capacity === 0 ? 999999 : Math.max(0, tt.capacity - tt.sold),
                isPackage: tt.isPackage,
                packageDaysCount: tt.packageDaysCount,
                validDays: tt.validDays as string[] | null,
                isActive: tt.isActive,
                sortOrder: tt.sortOrder,
            }))
        },
        CacheTTL.SHORT // Cache corto porque el stock cambia frecuentemente
    )
}

/**
 * Obtener eventos publicados (con cache)
 */
export async function getCachedPublishedEvents(): Promise<CachedEvent[]> {
    return cacheGetOrSet(
        CacheKeys.publishedEvents(),
        async () => {
            const events = await prisma.event.findMany({
                where: {
                    isPublished: true,
                    endDate: { gte: new Date() },
                },
                orderBy: { startDate: "asc" },
            })
            
            return events.map(event => ({
                id: event.id,
                slug: event.slug,
                title: event.title,
                description: event.description,
                location: event.location,
                venue: event.venue,
                bannerUrl: event.bannerUrl,
                startDate: event.startDate.toISOString(),
                endDate: event.endDate.toISOString(),
                mode: event.mode,
                isPublished: event.isPublished,
                discipline: event.discipline,
            }))
        },
        CacheTTL.MEDIUM
    )
}

/**
 * Obtener evento completo con tipos de ticket (con cache)
 */
export async function getCachedEventWithTicketTypes(eventId: string): Promise<EventWithTicketTypes | null> {
    const event = await getCachedEvent(eventId)
    if (!event) return null
    
    const ticketTypes = await getCachedTicketTypes(eventId)
    
    return {
        ...event,
        ticketTypes,
    }
}

/**
 * Obtener evento por slug con tipos de ticket
 */
export async function getCachedEventBySlugWithTicketTypes(slug: string): Promise<EventWithTicketTypes | null> {
    const event = await getCachedEventBySlug(slug)
    if (!event) return null
    
    const ticketTypes = await getCachedTicketTypes(event.id)
    
    return {
        ...event,
        ticketTypes,
    }
}

// ==================== CACHE INVALIDATION HELPERS ====================

/**
 * Invalidar cache cuando se actualiza un evento
 */
export async function onEventUpdated(eventId: string, slug?: string): Promise<void> {
    await invalidateEventCache(eventId, slug)
}

/**
 * Invalidar cache cuando se actualiza un tipo de ticket
 */
export async function onTicketTypeUpdated(eventId: string, ticketTypeId?: string): Promise<void> {
    await invalidateTicketTypeCache(eventId, ticketTypeId)
}

/**
 * Invalidar cache cuando se vende un ticket (actualiza stock)
 */
export async function onTicketSold(eventId: string, ticketTypeId: string): Promise<void> {
    // Solo invalidar el cache de tipos de ticket (stock)
    await cacheDelete(CacheKeys.ticketTypes(eventId))
    await cacheDelete(CacheKeys.ticketTypeStock(ticketTypeId))
}

// ==================== ESTADÍSTICAS CON CACHE ====================

export interface EventStats {
    totalTickets: number
    soldTickets: number
    revenue: number
    attendanceToday: number
}

/**
 * Obtener estadísticas de evento (con cache corto)
 */
export async function getCachedEventStats(eventId: string): Promise<EventStats> {
    return cacheGetOrSet(
        CacheKeys.eventStats(eventId),
        async () => {
            const [ticketTypes, todayScans] = await Promise.all([
                prisma.ticketType.findMany({
                    where: { eventId },
                    select: { capacity: true, sold: true, price: true },
                }),
                prisma.scan.count({
                    where: {
                        eventId,
                        result: "VALID",
                        date: new Date(new Date().toISOString().split("T")[0]),
                    },
                }),
            ])
            
            const totalTickets = ticketTypes.reduce((sum, tt) => sum + tt.capacity, 0)
            const soldTickets = ticketTypes.reduce((sum, tt) => sum + tt.sold, 0)
            const revenue = ticketTypes.reduce((sum, tt) => sum + (tt.sold * Number(tt.price)), 0)
            
            return {
                totalTickets,
                soldTickets,
                revenue,
                attendanceToday: todayScans,
            }
        },
        CacheTTL.SHORT // 30 segundos para estadísticas
    )
}
