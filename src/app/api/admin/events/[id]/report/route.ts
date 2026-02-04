import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
export const runtime = "nodejs"

type TicketTypeSummary = {
    id: string
    name: string
    price: number
    currency: string
    capacity: number
    isActive: boolean
    sold: number
    revenue: number
    ordersCount: number
}

type AttendeeRow = {
    ticketId: string
    ticketCode: string
    attendeeName: string | null
    attendeeDni: string | null
    ticketTypeName: string
    orderId: string
    paidAt: string | null
    buyerName: string | null
    buyerEmail: string | null
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id: eventId } = await params
        const { searchParams } = new URL(request.url)
        const ticketTypeId = searchParams.get("ticketTypeId")

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { id: true },
        })

        if (!event) {
            return NextResponse.json(
                { success: false, error: "Evento no encontrado" },
                { status: 404 }
            )
        }

        const ticketTypes = await prisma.ticketType.findMany({
            where: { eventId },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
                id: true,
                name: true,
                price: true,
                currency: true,
                capacity: true,
                isActive: true,
            },
        })

        const filteredTicketTypes = ticketTypeId
            ? ticketTypes.filter((ticketType) => ticketType.id === ticketTypeId)
            : ticketTypes

        const items = await prisma.orderItem.findMany({
            where: {
                ticketType: { eventId },
                order: { status: "PAID" },
                ...(ticketTypeId ? { ticketTypeId } : {}),
            },
            select: {
                orderId: true,
                ticketTypeId: true,
                quantity: true,
                subtotal: true,
            },
        })

        const totals = {
            totalRevenue: 0,
            ticketsSold: 0,
            orderIds: new Set<string>(),
        }

        const ticketTypeMap = new Map<string, { sold: number; revenue: number; orderIds: Set<string> }>()

        filteredTicketTypes.forEach((ticketType) => {
            ticketTypeMap.set(ticketType.id, { sold: 0, revenue: 0, orderIds: new Set() })
        })

        items.forEach((item) => {
            totals.totalRevenue += Number(item.subtotal)
            totals.ticketsSold += item.quantity
            totals.orderIds.add(item.orderId)

            if (!ticketTypeMap.has(item.ticketTypeId)) {
                ticketTypeMap.set(item.ticketTypeId, { sold: 0, revenue: 0, orderIds: new Set() })
            }
            const entry = ticketTypeMap.get(item.ticketTypeId)!
            entry.sold += item.quantity
            entry.revenue += Number(item.subtotal)
            entry.orderIds.add(item.orderId)
        })

        const byTicketType: TicketTypeSummary[] = filteredTicketTypes.map((ticketType) => {
            const stats = ticketTypeMap.get(ticketType.id) || {
                sold: 0,
                revenue: 0,
                orderIds: new Set<string>(),
            }
            return {
                id: ticketType.id,
                name: ticketType.name,
                price: Number(ticketType.price),
                currency: ticketType.currency,
                capacity: ticketType.capacity,
                isActive: ticketType.isActive,
                sold: stats.sold,
                revenue: stats.revenue,
                ordersCount: stats.orderIds.size,
            }
        })

        const tickets = await prisma.ticket.findMany({
            where: {
                eventId,
                order: { status: "PAID" },
                ...(ticketTypeId ? { ticketTypeId } : {}),
            },
            include: {
                ticketType: { select: { name: true } },
                order: {
                    select: {
                        id: true,
                        paidAt: true,
                        user: { select: { name: true, email: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        })

        const attendees: AttendeeRow[] = tickets.map((ticket) => ({
            ticketId: ticket.id,
            ticketCode: ticket.ticketCode,
            attendeeName: ticket.attendeeName,
            attendeeDni: ticket.attendeeDni,
            ticketTypeName: ticket.ticketType?.name || "",
            orderId: ticket.order?.id || "",
            paidAt: ticket.order?.paidAt ? ticket.order.paidAt.toISOString() : null,
            buyerName: ticket.order?.user?.name || null,
            buyerEmail: ticket.order?.user?.email || null,
        }))

        const commissionPercentRaw =
            process.env.IZIPAY_FEE_PERCENT ||
            process.env.NEXT_PUBLIC_IZIPAY_FEE_PERCENT ||
            "0"
        const commissionPercent = Number(commissionPercentRaw)
        const commissionRate = Number.isFinite(commissionPercent) ? commissionPercent : 0
        const commissionAmount = (totals.totalRevenue * commissionRate) / 100
        const netRevenue = totals.totalRevenue - commissionAmount

        return NextResponse.json({
            success: true,
            data: {
                totalRevenue: totals.totalRevenue,
                totalOrders: totals.orderIds.size,
                ticketsSold: totals.ticketsSold,
                commissionPercent: commissionRate,
                commissionAmount,
                netRevenue,
                byTicketType,
                attendees,
            },
        })
    } catch (error) {
        console.error("Error fetching event report:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener reporte" },
            { status: 500 }
        )
    }
}
