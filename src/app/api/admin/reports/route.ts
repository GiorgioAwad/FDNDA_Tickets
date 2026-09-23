import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { extractOrderPaymentDetails } from "@/lib/payment-details"
import {
    getCurrentLimaMonth,
    getLimaDateKey,
    getReportPeriodStart,
    projectMonthlyRevenue,
    type ReportPeriod,
} from "@/lib/reporting-period"
import type { Prisma } from "@prisma/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

function paymentDateRange(start: Date, end: Date): OrderWhereInput {
    return {
        OR: [
            { paidAt: { gte: start, lt: end } },
            { paidAt: null, createdAt: { gte: start, lt: end } },
        ],
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { searchParams } = new URL(request.url)
        const eventId = searchParams.get("eventId")
        const startDate = searchParams.get("startDate")
        const endDate = searchParams.get("endDate")
        const periodParam = searchParams.get("period")
        if (periodParam && !["7d", "30d", "all"].includes(periodParam)) {
            return NextResponse.json({ success: false, error: "Periodo inválido" }, { status: 400 })
        }

        const period = (periodParam || "all") as ReportPeriod
        const now = new Date()
        const periodStart = getReportPeriodStart(period, now)
        const month = getCurrentLimaMonth(now)

        const where: OrderWhereInput = { status: "PAID", orderType: "TICKET" }
        if (periodStart) {
            where.AND = [paymentDateRange(periodStart, now)]
        } else if (!periodParam && startDate && endDate) {
            // Preserve custom ranges for existing API consumers.
            where.createdAt = {
                gte: new Date(startDate),
                lte: new Date(endDate),
            }
        }

        const [orders, monthlyOrders] = await Promise.all([
            prisma.order.findMany({
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
            }),
            prisma.order.findMany({
                where: {
                    status: "PAID",
                    orderType: "TICKET",
                    AND: [paymentDateRange(month.start, now)],
                },
                select: {
                    totalAmount: true,
                    orderItems: { select: { ticketType: { select: { eventId: true } } } },
                },
            }),
        ])

        const filteredOrders = eventId
            ? orders.filter((order: ReportOrderItem) =>
                order.orderItems.some((item) => item.ticketType?.eventId === eventId)
            )
            : orders
        const filteredMonthlyOrders = eventId
            ? monthlyOrders.filter((order) =>
                order.orderItems.some((item) => item.ticketType?.eventId === eventId)
            )
            : monthlyOrders

        const totalRevenue = filteredOrders.reduce(
            (sum: number, order: ReportOrderItem) => sum + Number(order.totalAmount),
            0
        )
        const totalOrders = filteredOrders.length
        const ticketsSold = filteredOrders.reduce(
            (sum: number, order: ReportOrderItem) =>
                sum + order.orderItems.reduce((itemSum, item) => itemSum + item.quantity, 0),
            0
        )
        const monthToDateRevenue = filteredMonthlyOrders.reduce(
            (sum, order) => sum + Number(order.totalAmount),
            0
        )

        const salesByDay: Record<string, number> = {}
        filteredOrders.forEach((order: ReportOrderItem) => {
            const day = getLimaDateKey(order.paidAt || order.createdAt)
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
                monthToDateRevenue,
                monthlyProjection: projectMonthlyRevenue(monthToDateRevenue, now),
                projectionElapsedDays: month.elapsedDays,
                projectionDaysInMonth: month.daysInMonth,
                recentOrders: filteredOrders.slice(0, 10).map((order) => ({
                    ...order,
                    paymentOperationNumber: extractOrderPaymentDetails(order).operationNumber,
                })),
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

