import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        // Fetch orders for stats
        const paidOrders = await prisma.order.findMany({
            where: { status: "PAID" },
            include: {
                orderItems: {
                    include: {
                        ticketType: {
                            include: {
                                event: { select: { title: true } }
                            }
                        }
                    }
                }
            }
        })

        // Sales by event
        const eventSales: Record<string, number> = {}
        paidOrders.forEach(order => {
            order.orderItems.forEach(item => {
                const eventTitle = item.ticketType.event.title
                eventSales[eventTitle] = (eventSales[eventTitle] || 0) + Number(item.subtotal)
            })
        })
        const salesByEvent = Object.entries(eventSales)
            .map(([name, total]) => ({ name, total }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)

        // Sales by day (last 30 days)
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        
        const recentOrders = paidOrders.filter(o => new Date(o.paidAt || o.createdAt) >= thirtyDaysAgo)
        const dailySales: Record<string, number> = {}
        recentOrders.forEach(order => {
            const date = new Date(order.paidAt || order.createdAt).toISOString().split("T")[0]
            dailySales[date] = (dailySales[date] || 0) + Number(order.totalAmount)
        })
        const salesByDay = Object.entries(dailySales)
            .map(([date, amount]) => ({ date, amount }))
            .sort((a, b) => a.date.localeCompare(b.date))

        // Tickets by type
        const ticketTypes = await prisma.ticketType.findMany({
            select: {
                name: true,
                sold: true,
            }
        })
        const ticketsByType = ticketTypes
            .filter(tt => tt.sold > 0)
            .map(tt => ({ name: tt.name, count: tt.sold }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6)

        // Top events
        const events = await prisma.event.findMany({
            include: {
                _count: { select: { tickets: true } },
                ticketTypes: { select: { price: true, sold: true } }
            }
        })
        const topEvents = events
            .map(e => ({
                title: e.title,
                tickets: e._count.tickets,
                revenue: e.ticketTypes.reduce((acc, tt) => acc + (Number(tt.price) * tt.sold), 0)
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5)

        // Calculate metrics
        const totalRevenue = paidOrders.reduce((acc, o) => acc + Number(o.totalAmount), 0)
        const avgOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0

        // Simple conversion rate (paid / total orders)
        const totalOrders = await prisma.order.count()
        const conversionRate = totalOrders > 0 ? (paidOrders.length / totalOrders) * 100 : 0

        return NextResponse.json({
            success: true,
            data: {
                salesByEvent,
                salesByDay,
                ticketsByType,
                topEvents,
                conversionRate,
                avgOrderValue,
            }
        })
    } catch (error) {
        console.error("Error fetching stats:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener estadísticas" },
            { status: 500 }
        )
    }
}
