import "server-only"

import { prisma } from "@/lib/prisma"
import {
    IZIPAY_COMMISSION_RATE,
    IGV_RATE,
    TOTAL_COMMISSION_RATE,
} from "@/lib/commission-rates"
import {
    allocateAmountsProportionally,
    roundCurrency,
} from "@/lib/order-revenue"

export { IZIPAY_COMMISSION_RATE, IGV_RATE, TOTAL_COMMISSION_RATE }

export interface TreasuryEventSummary {
    id: string
    title: string
    slug: string
    venue: string
    location: string
    startDate: Date
    endDate: Date
    category: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
    advanceAmount: number
    isPublished: boolean
    isCompleted: boolean
    grossRevenue: number
    commissionAmount: number
    totalOrders: number
    ticketsSold: number
    netRevenue: number
    depositedAmount: number
}

export async function getTreasuryEventSummaries(): Promise<TreasuryEventSummary[]> {
    const events = await prisma.event.findMany({
        select: {
            id: true,
            title: true,
            slug: true,
            venue: true,
            location: true,
            startDate: true,
            endDate: true,
            category: true,
            advanceAmount: true,
            isPublished: true,
            ticketTypes: {
                select: {
                    id: true,
                },
            },
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    })

    if (events.length === 0) {
        return []
    }

    const ticketTypeToEvent = new Map<string, string>()
    const statsByEvent = new Map<
        string,
        { grossRevenue: number; ticketsSold: number; orderIds: Set<string> }
    >()

    for (const event of events) {
        statsByEvent.set(event.id, {
            grossRevenue: 0,
            ticketsSold: 0,
            orderIds: new Set<string>(),
        })

        for (const ticketType of event.ticketTypes) {
            ticketTypeToEvent.set(ticketType.id, event.id)
        }
    }

    const paidOrders = await prisma.order.findMany({
        where: {
            status: "PAID",
            orderItems: {
                some: {
                    ticketType: {
                        eventId: {
                            in: events.map((event) => event.id),
                        },
                    },
                },
            },
        },
        select: {
            id: true,
            totalAmount: true,
            orderItems: {
                select: {
                    ticketTypeId: true,
                    quantity: true,
                    subtotal: true,
                },
            },
        },
    })

    for (const order of paidOrders) {
        const allocatedAmounts = allocateAmountsProportionally(
            order.orderItems.map((item) => Number(item.subtotal)),
            Number(order.totalAmount)
        )

        order.orderItems.forEach((item, index) => {
            if (!item.ticketTypeId) return
            const eventId = ticketTypeToEvent.get(item.ticketTypeId)
            if (!eventId) return

            const stats = statsByEvent.get(eventId)
            if (!stats) return

            stats.grossRevenue += allocatedAmounts[index] || 0
            stats.ticketsSold += item.quantity
            stats.orderIds.add(order.id)
        })
    }

    return events.map((event) => {
        const stats = statsByEvent.get(event.id) || {
            grossRevenue: 0,
            ticketsSold: 0,
            orderIds: new Set<string>(),
        }
        const grossRevenue = roundCurrency(stats.grossRevenue)
        const commissionAmount = grossRevenue * TOTAL_COMMISSION_RATE
        const advanceAmount = Number(event.advanceAmount || 0)
        const netRevenue = grossRevenue - commissionAmount
        const depositedAmount = netRevenue - advanceAmount

        return {
            id: event.id,
            title: event.title,
            slug: event.slug,
            venue: event.venue,
            location: event.location,
            startDate: event.startDate,
            endDate: event.endDate,
            category: event.category,
            advanceAmount,
            isPublished: event.isPublished,
            isCompleted: event.endDate < new Date(),
            grossRevenue,
            commissionAmount,
            totalOrders: stats.orderIds.size,
            ticketsSold: stats.ticketsSold,
            netRevenue,
            depositedAmount,
        }
    })
}
