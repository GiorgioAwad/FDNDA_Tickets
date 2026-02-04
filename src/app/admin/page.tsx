import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { formatPrice, formatDate } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Users,
    Calendar,
    Ticket,
    DollarSign,
    TrendingUp,
    Plus,
    ArrowUpRight,
    ArrowDownRight,
    CreditCard,
    Percent,
    Eye,
} from "lucide-react"
import type { Prisma } from "@prisma/client"
export const dynamic = "force-dynamic"

// ==================== TYPES ====================

type RevenueOrder = {
    totalAmount: Prisma.Decimal
    createdAt: Date
}

type RecentOrder = {
    id: string
    totalAmount: Prisma.Decimal
    createdAt: Date
    user: {
        name: string
        email: string
    }
}

type ActiveEvent = {
    id: string
    title: string
    slug: string
    startDate: Date
    endDate: Date
    venue: string
    isPublished: boolean
    _count: {
        tickets: number
    }
}

// ==================== CONSTANTS ====================

// Comisión de Izipay (3.99% + IGV)
const IZIPAY_COMMISSION_RATE = 0.0399
const IGV_RATE = 0.18
const TOTAL_COMMISSION_RATE = IZIPAY_COMMISSION_RATE * (1 + IGV_RATE) // ~4.71%

// ==================== PAGE ====================

export default async function AdminDashboardPage() {
    // Fetch all stats in parallel
    const [
        totalUsers,
        totalEvents,
        activeEvents,
        totalTickets,
        orders,
        recentOrders,
        upcomingEvents,
        todayScans,
    ] = await Promise.all([
        prisma.user.count({ where: { role: "USER" } }),
        prisma.event.count(),
        prisma.event.count({
            where: { endDate: { gte: new Date() }, isPublished: true }
        }),
        prisma.ticket.count({ where: { status: "ACTIVE" } }),
        prisma.order.findMany({
            where: { status: "PAID" },
            select: { totalAmount: true, createdAt: true }
        }) as Promise<RevenueOrder[]>,
        prisma.order.findMany({
            where: { status: "PAID" },
            take: 5,
            orderBy: { createdAt: "desc" },
            include: { user: true }
        }) as Promise<RecentOrder[]>,
        prisma.event.findMany({
            where: { 
                endDate: { gte: new Date() },
                isPublished: true 
            },
            take: 5,
            orderBy: { startDate: "asc" },
            include: {
                _count: { select: { tickets: true } }
            }
        }) as Promise<ActiveEvent[]>,
        prisma.scan.count({
            where: {
                scannedAt: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0))
                },
                result: "VALID"
            }
        }),
    ])

    // Calculate revenue metrics
    const grossRevenue = orders.reduce(
        (sum, order) => sum + Number(order.totalAmount),
        0
    )
    const izipayCommission = grossRevenue * TOTAL_COMMISSION_RATE
    const netRevenue = grossRevenue - izipayCommission

    // Calculate this month's revenue
    const thisMonth = new Date()
    thisMonth.setDate(1)
    thisMonth.setHours(0, 0, 0, 0)
    const thisMonthOrders = orders.filter(o => new Date(o.createdAt) >= thisMonth)
    const thisMonthRevenue = thisMonthOrders.reduce(
        (sum, order) => sum + Number(order.totalAmount),
        0
    )

    // Calculate last month's revenue for comparison
    const lastMonth = new Date(thisMonth)
    lastMonth.setMonth(lastMonth.getMonth() - 1)
    const lastMonthOrders = orders.filter(o => {
        const date = new Date(o.createdAt)
        return date >= lastMonth && date < thisMonth
    })
    const lastMonthRevenue = lastMonthOrders.reduce(
        (sum, order) => sum + Number(order.totalAmount),
        0
    )

    const revenueChange = lastMonthRevenue > 0
        ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
        : 0

    return (
        <div className="space-y-6">
            {/* Welcome Banner */}
            <Card className="bg-gradient-to-r from-blue-600 to-blue-700 text-white border-0">
                <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-bold">¡Bienvenido al Panel de Admin!</h2>
                            <p className="text-blue-100 mt-1">
                                Aquí tienes un resumen de tu sistema de tickets
                            </p>
                        </div>
                        <Link href="/admin/eventos/nuevo">
                            <Button className="bg-white text-blue-700 hover:bg-blue-50">
                                <Plus className="h-4 w-4 mr-2" />
                                Nuevo Evento
                            </Button>
                        </Link>
                    </div>
                </CardContent>
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Gross Revenue */}
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div className="p-2 rounded-lg bg-green-100">
                                <DollarSign className="h-5 w-5 text-green-600" />
                            </div>
                            {revenueChange !== 0 && (
                                <Badge variant={revenueChange > 0 ? "success" : "destructive"} className="text-xs">
                                    {revenueChange > 0 ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                                    {Math.abs(revenueChange).toFixed(1)}%
                                </Badge>
                            )}
                        </div>
                        <div className="mt-3">
                            <p className="text-sm text-gray-500">Ingresos Brutos</p>
                            <p className="text-2xl font-bold">{formatPrice(grossRevenue)}</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Net Revenue */}
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <CreditCard className="h-5 w-5 text-blue-600" />
                            </div>
                            <Badge variant="outline" className="text-xs">
                                <Percent className="h-3 w-3 mr-1" />
                                -{(TOTAL_COMMISSION_RATE * 100).toFixed(2)}%
                            </Badge>
                        </div>
                        <div className="mt-3">
                            <p className="text-sm text-gray-500">Ingresos Netos</p>
                            <p className="text-2xl font-bold">{formatPrice(netRevenue)}</p>
                            <p className="text-xs text-gray-400 mt-1">
                                Comisión Izipay: {formatPrice(izipayCommission)}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Tickets Sold */}
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div className="p-2 rounded-lg bg-purple-100">
                                <Ticket className="h-5 w-5 text-purple-600" />
                            </div>
                        </div>
                        <div className="mt-3">
                            <p className="text-sm text-gray-500">Entradas Vendidas</p>
                            <p className="text-2xl font-bold">{totalTickets.toLocaleString()}</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Active Events */}
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div className="p-2 rounded-lg bg-orange-100">
                                <Calendar className="h-5 w-5 text-orange-600" />
                            </div>
                        </div>
                        <div className="mt-3">
                            <p className="text-sm text-gray-500">Eventos Activos</p>
                            <p className="text-2xl font-bold">{activeEvents}</p>
                            <p className="text-xs text-gray-400 mt-1">
                                de {totalEvents} eventos totales
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Secondary Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-gray-50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-gray-900">{totalUsers}</p>
                        <p className="text-xs text-gray-500">Usuarios Registrados</p>
                    </CardContent>
                </Card>
                <Card className="bg-gray-50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
                        <p className="text-xs text-gray-500">Órdenes Completadas</p>
                    </CardContent>
                </Card>
                <Card className="bg-gray-50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-gray-900">{todayScans}</p>
                        <p className="text-xs text-gray-500">Escaneos Hoy</p>
                    </CardContent>
                </Card>
                <Card className="bg-gray-50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-gray-900">
                            {formatPrice(thisMonthRevenue)}
                        </p>
                        <p className="text-xs text-gray-500">Ingresos Este Mes</p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recent Orders */}
                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div>
                            <CardTitle className="text-lg">Ventas Recientes</CardTitle>
                            <CardDescription>Últimas 5 compras completadas</CardDescription>
                        </div>
                        <Link href="/admin/ingresos">
                            <Button variant="ghost" size="sm">
                                Ver todas
                                <ArrowUpRight className="h-4 w-4 ml-1" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {recentOrders.map((order) => (
                                <div key={order.id} className="flex items-center justify-between py-3 border-b last:border-0">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-medium">
                                            {order.user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-medium text-sm">{order.user.name}</p>
                                            <p className="text-xs text-gray-500">{order.user.email}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-green-600">
                                            +{formatPrice(Number(order.totalAmount))}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {formatDate(order.createdAt)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                            {recentOrders.length === 0 && (
                                <div className="text-center text-gray-500 py-8">
                                    No hay ventas recientes
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Upcoming Events */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div>
                            <CardTitle className="text-lg">Próximos Eventos</CardTitle>
                            <CardDescription>Eventos activos</CardDescription>
                        </div>
                        <Link href="/admin/eventos">
                            <Button variant="ghost" size="sm">
                                Ver todos
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {upcomingEvents.map((event) => (
                                <Link 
                                    key={event.id} 
                                    href={`/admin/eventos/${event.id}`}
                                    className="block p-3 rounded-lg border hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">{event.title}</p>
                                            <p className="text-xs text-gray-500 mt-1">{event.venue}</p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <Badge variant="outline" className="text-xs">
                                                    {formatDate(event.startDate)}
                                                </Badge>
                                                <span className="text-xs text-gray-400">
                                                    {event._count.tickets} entradas
                                                </span>
                                            </div>
                                        </div>
                                        <Eye className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                    </div>
                                </Link>
                            ))}
                            {upcomingEvents.length === 0 && (
                                <div className="text-center text-gray-500 py-8">
                                    No hay eventos próximos
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Commission Info Card */}
            <Card className="bg-yellow-50 border-yellow-200">
                <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-yellow-100">
                            <Percent className="h-5 w-5 text-yellow-600" />
                        </div>
                        <div>
                            <h4 className="font-medium text-yellow-800">Información de Comisiones</h4>
                            <p className="text-sm text-yellow-700 mt-1">
                                La comisión de Izipay es de <strong>{(IZIPAY_COMMISSION_RATE * 100).toFixed(2)}% + IGV</strong> ({(TOTAL_COMMISSION_RATE * 100).toFixed(2)}% total) 
                                por cada transacción. Los ingresos netos ya descuentan esta comisión.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
