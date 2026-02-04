import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import type { Prisma } from "@prisma/client"
export const runtime = "nodejs"

type OrderWhereInput = Prisma.OrderWhereInput

type ReportOrderItem = Prisma.OrderGetPayload<{
    include: {
        user: { select: { name: true, email: true } }
        orderItems: {
            include: {
                ticketType: { select: { name: true, eventId: true } }
            }
        }
    }
}>

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { searchParams } = new URL(request.url)
        const eventId = searchParams.get("eventId")
        const startDate = searchParams.get("startDate")
        const endDate = searchParams.get("endDate")

        // Build query
        const where: OrderWhereInput = { status: "PAID" }

        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate),
                lte: new Date(endDate),
            }
        }

        // Fetch orders
        const orders = await prisma.order.findMany({
            where,
            include: {
                user: { select: { name: true, email: true } },
                orderItems: {
                    include: {
                        ticketType: { select: { name: true, eventId: true } }
                    }
                }
            },
            orderBy: { createdAt: "desc" },
        })

        // Filter by event if needed (post-fetch since orderItems are nested)
        const filteredOrders = eventId
            ? orders.filter((order: ReportOrderItem) =>
                order.orderItems.some((item) => item.ticketType.eventId === eventId)
            )
            : orders

        // Calculate stats
        const totalRevenue = filteredOrders.reduce(
            (sum: number, order: ReportOrderItem) => sum + Number(order.totalAmount),
            0
        )
        const totalOrders = filteredOrders.length
        const ticketsSold = filteredOrders.reduce(
            (sum: number, order: ReportOrderItem) =>
                sum +
                order.orderItems.reduce((itemSum, item) => itemSum + item.quantity, 0),
            0
        )

        // Group by day
        const salesByDay: Record<string, number> = {}
        filteredOrders.forEach((order: ReportOrderItem) => {
            const day = order.createdAt.toISOString().split("T")[0]
            salesByDay[day] = (salesByDay[day] || 0) + Number(order.totalAmount)
        })

        const chartData = Object.entries(salesByDay)
            .map(([date, amount]) => ({ date, amount }))
            .sort((a, b) => a.date.localeCompare(b.date))

        return NextResponse.json({
            success: true,
            data: {
                totalRevenue,
                totalOrders,
                ticketsSold,
                chartData,
                recentOrders: filteredOrders.slice(0, 10),
            },
        })
    } catch (error) {
        console.error("Error fetching reports:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener reportes" },
            { status: 500 }
        )
    }
}

