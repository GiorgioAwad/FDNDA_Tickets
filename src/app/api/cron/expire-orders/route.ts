import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { onTicketSold } from "@/lib/cached-queries"

export const runtime = "nodejs"
export const maxDuration = 60

const ORDER_EXPIRATION_MINUTES = 30
const MAX_ORDERS_PER_RUN = 200

function isCronAuthorized(request: NextRequest): boolean {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return true

    const authHeader = request.headers.get("authorization")
    if (authHeader === `Bearer ${cronSecret}`) return true

    const vercelCron = request.headers.get("x-vercel-cron")
    if (vercelCron === "1" || vercelCron === "true") return true

    return false
}

export async function POST(request: NextRequest) {
    if (!isCronAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const cutoffDate = new Date(Date.now() - ORDER_EXPIRATION_MINUTES * 60 * 1000)

        const pendingOrders = await prisma.order.findMany({
            where: {
                status: "PENDING",
                createdAt: { lte: cutoffDate },
            },
            select: {
                id: true,
            },
            orderBy: { createdAt: "asc" },
            take: MAX_ORDERS_PER_RUN,
        })

        let expiredOrders = 0
        let releasedTickets = 0
        const invalidations = new Set<string>()

        for (const order of pendingOrders) {
            const result = await prisma.$transaction(async (tx) => {
                const cancelled = await tx.order.updateMany({
                    where: {
                        id: order.id,
                        status: "PENDING",
                        createdAt: { lte: cutoffDate },
                    },
                    data: {
                        status: "CANCELLED",
                    },
                })

                if (cancelled.count === 0) {
                    return { expired: false, released: 0, keys: [] as string[] }
                }

                const orderItems = await tx.orderItem.findMany({
                    where: { orderId: order.id },
                    select: {
                        ticketTypeId: true,
                        quantity: true,
                        ticketType: {
                            select: { eventId: true },
                        },
                    },
                })

                let released = 0
                const keys: string[] = []

                for (const item of orderItems) {
                    const decrement = await tx.ticketType.updateMany({
                        where: {
                            id: item.ticketTypeId,
                            sold: { gte: item.quantity },
                        },
                        data: {
                            sold: { decrement: item.quantity },
                        },
                    })

                    if (decrement.count > 0) {
                        released += item.quantity
                        keys.push(`${item.ticketType.eventId}:${item.ticketTypeId}`)
                    }
                }

                return { expired: true, released, keys }
            })

            if (result.expired) {
                expiredOrders += 1
                releasedTickets += result.released
                for (const key of result.keys) {
                    invalidations.add(key)
                }
            }
        }

        await Promise.all(
            Array.from(invalidations).map((entry) => {
                const [eventId, ticketTypeId] = entry.split(":")
                return onTicketSold(eventId, ticketTypeId)
            })
        )

        return NextResponse.json({
            success: true,
            processed: pendingOrders.length,
            expiredOrders,
            releasedTickets,
            cutoffDate: cutoffDate.toISOString(),
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error("Error expiring pending orders:", error)
        return NextResponse.json(
            { success: false, error: "Failed to expire pending orders" },
            { status: 500 }
        )
    }
}
