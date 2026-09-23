export const POOL_REPORT_WEEKDAYS = [
    { value: 1, label: "Lun" },
    { value: 2, label: "Mar" },
    { value: 3, label: "Mié" },
    { value: 4, label: "Jue" },
    { value: 5, label: "Vie" },
    { value: 6, label: "Sáb" },
    { value: 7, label: "Dom" },
] as const

export interface PoolBuyerVisit {
    eventId: string
    eventName: string
    date: string
    schedule: string
    source: string
    reservationId: string
    orderId: string
    paidAt: string
    buyerName: string
    buyerDocument: string
    buyerEmail: string
    buyerPhone: string
    attendeeName: string
    attendeeDocument: string
}

export interface PoolInventoryReportRow {
    eventId: string
    eventName: string
    date: string
    schedule: string
    capacity: number
    sold: number
    found: number
    matches: boolean
    enabled: boolean
}

export interface ConsolidatedPoolBuyer {
    buyerName: string
    buyerDocument: string
    buyerEmail: string
    buyerPhone: string
    attendees: string[]
    visits: string[]
    sources: string[]
    orderIds: string[]
    visitCount: number
}

export function isoWeekday(dateKey: string): number {
    const [year, month, day] = dateKey.split("-").map(Number)
    const jsDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
    return jsDay === 0 ? 7 : jsDay
}

export function matchesPoolReportSlot(name: string, startTime: string, endTime: string): boolean {
    const times = name.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?=\D|$)/g)
    if (!times || times.length < 2) return false

    const normalized = times.slice(0, 2).map((value) => {
        const match = value.match(/([01]?\d|2[0-3]):([0-5]\d)/)
        return match ? `${match[1].padStart(2, "0")}:${match[2]}` : ""
    })

    return normalized[0] === startTime && normalized[1] === endTime
}

export function consolidatePoolBuyers(visits: PoolBuyerVisit[]): ConsolidatedPoolBuyer[] {
    const buyers = new Map<
        string,
        Omit<ConsolidatedPoolBuyer, "attendees" | "sources" | "orderIds" | "visitCount"> & {
            attendees: Set<string>
            sources: Set<string>
            orderIds: Set<string>
        }
    >()

    for (const visit of visits) {
        const key =
            visit.buyerDocument ||
            visit.buyerEmail ||
            visit.buyerPhone ||
            visit.buyerName ||
            visit.orderId
        const buyer = buyers.get(key) ?? {
            buyerName: visit.buyerName,
            buyerDocument: visit.buyerDocument,
            buyerEmail: visit.buyerEmail,
            buyerPhone: visit.buyerPhone,
            attendees: new Set<string>(),
            visits: [],
            sources: new Set<string>(),
            orderIds: new Set<string>(),
        }

        const attendee = [visit.attendeeName, visit.attendeeDocument].filter(Boolean).join(" · ")
        if (attendee) buyer.attendees.add(attendee)
        buyer.visits.push(`${visit.date} | ${visit.schedule} | ${visit.eventName}`)
        buyer.sources.add(visit.source)
        buyer.orderIds.add(visit.orderId)
        buyers.set(key, buyer)
    }

    return Array.from(buyers.values())
        .map((buyer) => ({
            ...buyer,
            attendees: Array.from(buyer.attendees).sort(),
            sources: Array.from(buyer.sources).sort(),
            orderIds: Array.from(buyer.orderIds).sort(),
            visitCount: buyer.visits.length,
        }))
        .sort((a, b) => a.buyerName.localeCompare(b.buyerName, "es"))
}
