import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { formatPrice, formatDate } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { KpiCard } from "@/components/ui/kpi-card"
import { EmptyState } from "@/components/ui/empty-state"
import {
    Calendar,
    Ticket,
    DollarSign,
    Plus,
    ArrowUpRight,
    CreditCard,
    Percent,
    Eye,
    AlertTriangle,
    ScanLine,
    Users,
    ShoppingBag,
    TrendingUp,
} from "lucide-react"
import type { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

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

import {
    IZIPAY_COMMISSION_RATE,
    TOTAL_COMMISSION_RATE,
    calculateIzipayCommission,
} from "@/lib/commission-rates"
import { getUsdToPenRate } from "@/lib/exchange-rate"

export default async function AdminDashboardPage() {
    const thisMonth = new Date()
    thisMonth.setDate(1)
    thisMonth.setHours(0, 0, 0, 0)

    const lastMonth = new Date(thisMonth)
    lastMonth.setMonth(lastMonth.getMonth() - 1)

    let dashboardData:
        | {
              totalUsers: number
              totalEvents: number
              activeEvents: number
              totalTickets: number
              paidSummary: {
                  _sum: { totalAmount: Prisma.Decimal | null }
                  _count: { _all: number }
              }
              thisMonthSummary: { _sum: { totalAmount: Prisma.Decimal | null } }
              lastMonthSummary: { _sum: { totalAmount: Prisma.Decimal | null } }
              recentOrders: RecentOrder[]
              upcomingEvents: ActiveEvent[]
              todayScans: number
          }
        | null = null

    try {
        const [
            totalUsers,
            totalEvents,
            activeEvents,
            totalTickets,
            paidSummary,
            thisMonthSummary,
            lastMonthSummary,
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
            prisma.order.aggregate({
                where: { status: "PAID" },
                _sum: { totalAmount: true },
                _count: { _all: true },
            }),
            prisma.order.aggregate({
                where: {
                    status: "PAID",
                    createdAt: { gte: thisMonth },
                },
                _sum: { totalAmount: true },
            }),
            prisma.order.aggregate({
                where: {
                    status: "PAID",
                    createdAt: {
                        gte: lastMonth,
                        lt: thisMonth,
                    },
                },
                _sum: { totalAmount: true },
            }),
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

        dashboardData = {
            totalUsers,
            totalEvents,
            activeEvents,
            totalTickets,
            paidSummary,
            thisMonthSummary,
            lastMonthSummary,
            recentOrders,
            upcomingEvents,
            todayScans,
        }
    } catch (error) {
        console.error("Failed to load admin dashboard data", error)
    }

    if (!dashboardData) {
        return (
            <Card className="border-warning/30 bg-warning/5">
                <CardContent className="flex flex-col gap-3 p-6">
                    <div className="flex items-center gap-3 text-warning">
                        <AlertTriangle className="h-5 w-5" />
                        <h2 className="font-display text-lg font-semibold">No se pudo cargar el dashboard</h2>
                    </div>
                    <p className="text-sm text-foreground/80">
                        El servidor no pudo leer datos de administración. Revisa migraciones pendientes y logs.
                    </p>
                </CardContent>
            </Card>
        )
    }

    const {
        totalUsers,
        totalEvents,
        activeEvents,
        totalTickets,
        paidSummary,
        thisMonthSummary,
        lastMonthSummary,
        recentOrders,
        upcomingEvents,
        todayScans,
    } = dashboardData

    const grossRevenue = Number(paidSummary._sum.totalAmount ?? 0)
    const completedOrdersCount = paidSummary._count._all
    const exchangeRate = await getUsdToPenRate()
    const commissionBreakdown = calculateIzipayCommission(grossRevenue, completedOrdersCount, exchangeRate.rate)
    const izipayCommission = commissionBreakdown.total
    const fixedFeePerTx = commissionBreakdown.fixedFeePerTx
    const netRevenue = grossRevenue - izipayCommission

    const thisMonthRevenue = Number(thisMonthSummary._sum.totalAmount ?? 0)
    const lastMonthRevenue = Number(lastMonthSummary._sum.totalAmount ?? 0)

    const revenueChange = lastMonthRevenue > 0
        ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
        : 0

    return (
        <div className="space-y-6">
            {/* Welcome banner */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary text-white p-6 sm:p-8 shadow-elevated">
                <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-coral/30 blur-3xl" aria-hidden="true" />
                <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-fdnda-accent/20 blur-3xl" aria-hidden="true" />
                <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-fdnda-accent mb-1">Panel administrativo</p>
                        <h2 className="font-display text-2xl sm:text-3xl font-bold">
                            ¡Bienvenido al panel!
                        </h2>
                        <p className="text-white/80 mt-1 text-sm sm:text-base">
                            Resumen de tu sistema de tickets y ventas en tiempo real.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href="/scanner">
                            <Button variant="glass" size="sm" className="rounded-full">
                                <ScanLine className="h-4 w-4" /> Escáner
                            </Button>
                        </Link>
                        <Link href="/admin/eventos/nuevo">
                            <Button variant="coral" size="sm" className="rounded-full">
                                <Plus className="h-4 w-4" /> Nuevo evento
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Primary KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                    label="Ingresos brutos"
                    value={formatPrice(grossRevenue)}
                    icon={<DollarSign />}
                    tone="success"
                    delta={revenueChange !== 0 ? revenueChange : undefined}
                    deltaLabel={revenueChange !== 0 ? "vs. mes anterior" : undefined}
                />
                <KpiCard
                    label="Ingresos netos"
                    value={formatPrice(netRevenue)}
                    icon={<CreditCard />}
                    tone="primary"
                    hint={`Comisión ${grossRevenue > 0 ? ((izipayCommission / grossRevenue) * 100).toFixed(2) : (TOTAL_COMMISSION_RATE * 100).toFixed(2)}%`}
                />
                <KpiCard
                    label="Entradas vendidas"
                    value={totalTickets.toLocaleString("es-PE")}
                    icon={<Ticket />}
                    tone="accent"
                />
                <KpiCard
                    label="Eventos activos"
                    value={activeEvents}
                    icon={<Calendar />}
                    tone="coral"
                    hint={`de ${totalEvents} totales`}
                />
            </div>

            {/* Secondary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SmallStat icon={Users} label="Usuarios" value={totalUsers.toLocaleString("es-PE")} tone="bg-fdnda-primary/10 text-fdnda-primary" />
                <SmallStat icon={ShoppingBag} label="Órdenes pagadas" value={completedOrdersCount.toLocaleString("es-PE")} tone="bg-fdnda-secondary/10 text-fdnda-secondary" />
                <SmallStat icon={ScanLine} label="Escaneos hoy" value={todayScans.toLocaleString("es-PE")} tone="bg-fdnda-accent/15 text-fdnda-accent" />
                <SmallStat icon={TrendingUp} label="Mes actual" value={formatPrice(thisMonthRevenue)} tone="bg-coral/10 text-coral-strong" />
            </div>

            {/* Main content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recent orders */}
                <Card className="lg:col-span-2 overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-3">
                        <div>
                            <CardTitle className="font-display text-lg">Ventas recientes</CardTitle>
                            <CardDescription>Últimas 5 compras pagadas</CardDescription>
                        </div>
                        <Link href="/admin/ingresos">
                            <Button variant="ghost" size="sm" className="text-fdnda-secondary hover:text-fdnda-primary">
                                Ver todas
                                <ArrowUpRight className="h-4 w-4" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {recentOrders.length > 0 ? (
                            <div className="divide-y divide-border">
                                {recentOrders.map((order) => (
                                    <div key={order.id} className="flex items-center justify-between py-3">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary flex items-center justify-center text-white font-bold text-sm">
                                                {order.user.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-semibold text-sm truncate">{order.user.name}</p>
                                                <p className="text-xs text-muted-foreground truncate">{order.user.email}</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-display font-bold text-success">
                                                +{formatPrice(Number(order.totalAmount))}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground">
                                                {formatDate(order.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyState variant="generic" title="Sin ventas recientes" description="Cuando se procesen pedidos pagados aparecerán aquí." className="py-8" />
                        )}
                    </CardContent>
                </Card>

                {/* Upcoming events */}
                <Card className="overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-3">
                        <div>
                            <CardTitle className="font-display text-lg">Próximos eventos</CardTitle>
                            <CardDescription>Activos y publicados</CardDescription>
                        </div>
                        <Link href="/admin/eventos">
                            <Button variant="ghost" size="sm" className="text-fdnda-secondary hover:text-fdnda-primary">
                                Ver todos
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {upcomingEvents.length > 0 ? (
                            <div className="space-y-2">
                                {upcomingEvents.map((event) => (
                                    <Link
                                        key={event.id}
                                        href={`/admin/eventos/${event.id}`}
                                        className="block p-3 rounded-xl border border-border bg-card hover:border-fdnda-secondary/50 hover:bg-fdnda-light/30 transition-all group"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-sm line-clamp-1 group-hover:text-fdnda-primary transition-colors">
                                                    {event.title}
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{event.venue}</p>
                                                <div className="flex items-center gap-2 mt-2">
                                                    <Badge variant="outline" className="text-[10px]">
                                                        {formatDate(event.startDate)}
                                                    </Badge>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        · {event._count.tickets} entradas
                                                    </span>
                                                </div>
                                            </div>
                                            <Eye className="h-4 w-4 text-muted-foreground group-hover:text-fdnda-primary flex-shrink-0 transition-colors" />
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        ) : (
                            <EmptyState variant="no-events" title="Sin eventos próximos" description="Crea uno nuevo para empezar." className="py-8" />
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Commission card */}
            <Card className="border-fdnda-accent/30 bg-gradient-to-r from-fdnda-light/30 via-white to-fdnda-light/30">
                <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fdnda-accent/15 text-fdnda-accent shrink-0">
                            <Percent className="h-5 w-5" />
                        </div>
                        <div>
                            <h4 className="font-display font-semibold mb-0.5">Información de comisiones</h4>
                            <p className="text-sm text-muted-foreground">
                                Comisión Izipay: <strong className="text-foreground">{(IZIPAY_COMMISSION_RATE * 100).toFixed(2)}% + IGV</strong> ({(TOTAL_COMMISSION_RATE * 100).toFixed(2)}% total) + <strong className="text-foreground">S/ {fixedFeePerTx.toFixed(2)}</strong> fijo por transacción.
                                <span className="block text-xs mt-1">Tipo de cambio: S/ {exchangeRate.rate.toFixed(4)} ({exchangeRate.source}). Los ingresos netos ya descuentan esta comisión.</span>
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function SmallStat({
    icon: Icon,
    label,
    value,
    tone,
}: {
    icon: React.ComponentType<{ className?: string }>
    label: string
    value: string
    tone: string
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-3 text-center transition-colors hover:border-fdnda-secondary/30">
            <div className={`mx-auto mb-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="h-4 w-4" />
            </div>
            <p className="font-display text-lg font-bold tabular-nums">{value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
    )
}
