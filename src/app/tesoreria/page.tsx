import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { formatDateTimeForExport, formatPrice } from "@/lib/utils"
import { extractOrderPaymentDetails } from "@/lib/payment-details"
import { TOTAL_COMMISSION_RATE, getTreasuryEventSummaries } from "@/lib/treasury"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    ArrowUpRight,
    BarChart3,
    Calendar,
    CreditCard,
    DollarSign,
    FileText,
    Receipt,
    Wallet,
} from "lucide-react"

export const dynamic = "force-dynamic"

export default async function TreasuryDashboardPage() {
    const thisMonth = new Date()
    thisMonth.setDate(1)
    thisMonth.setHours(0, 0, 0, 0)

    const lastMonth = new Date(thisMonth)
    lastMonth.setMonth(lastMonth.getMonth() - 1)

    const [
        paidSummary,
        pendingSummary,
        refundedSummary,
        thisMonthSummary,
        lastMonthSummary,
        recentOrders,
        events,
    ] = await Promise.all([
        prisma.order.aggregate({
            where: { status: "PAID" },
            _sum: { totalAmount: true },
            _count: { _all: true },
        }),
        prisma.order.aggregate({
            where: { status: "PENDING" },
            _sum: { totalAmount: true },
            _count: { _all: true },
        }),
        prisma.order.aggregate({
            where: { status: "REFUNDED" },
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
            take: 6,
            orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
            select: {
                id: true,
                totalAmount: true,
                currency: true,
                provider: true,
                providerRef: true,
                providerResponse: true,
                paidAt: true,
                createdAt: true,
                user: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
                orderItems: {
                    take: 1,
                    select: {
                        ticketType: {
                            select: {
                                event: {
                                    select: {
                                        title: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        }),
        getTreasuryEventSummaries(),
    ])

    const grossRevenue = Number(paidSummary._sum.totalAmount ?? 0)
    const pendingRevenue = Number(pendingSummary._sum.totalAmount ?? 0)
    const refundedRevenue = Number(refundedSummary._sum.totalAmount ?? 0)
    const commissionAmount = grossRevenue * TOTAL_COMMISSION_RATE
    const netRevenue = grossRevenue - commissionAmount
    const thisMonthRevenue = Number(thisMonthSummary._sum.totalAmount ?? 0)
    const lastMonthRevenue = Number(lastMonthSummary._sum.totalAmount ?? 0)
    const monthChange =
        lastMonthRevenue > 0
            ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
            : 0

    const activeEvents = events.filter((event) => event.isPublished && event.endDate >= new Date())
    const topEvents = [...events]
        .sort((a, b) => b.grossRevenue - a.grossRevenue)
        .slice(0, 5)

    return (
        <div className="space-y-6">
            <Card className="border-0 bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-700 text-white">
                <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="text-2xl font-bold">Resumen financiero</h2>
                        <p className="mt-1 text-sm text-emerald-50">
                            Ingresos, comisiones, reportes y seguimiento por evento en un solo panel.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Button asChild className="bg-white text-emerald-700 hover:bg-emerald-50">
                            <Link href="/tesoreria/reportes">
                                <FileText className="mr-2 h-4 w-4" />
                                Ver reportes
                            </Link>
                        </Button>
                        <Button
                            asChild
                            variant="outline"
                            className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                        >
                            <Link href="/tesoreria/eventos">
                                <Calendar className="mr-2 h-4 w-4" />
                                Revisar eventos
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <div className="rounded-lg bg-emerald-100 p-3 text-emerald-700">
                                <DollarSign className="h-5 w-5" />
                            </div>
                            <span className="text-xs font-medium text-gray-500">
                                {paidSummary._count._all} pagos confirmados
                            </span>
                        </div>
                        <p className="mt-4 text-sm text-gray-500">Ingresos brutos</p>
                        <p className="text-2xl font-bold text-gray-900">{formatPrice(grossRevenue)}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="rounded-lg bg-cyan-100 p-3 text-cyan-700">
                            <Wallet className="h-5 w-5" />
                        </div>
                        <p className="mt-4 text-sm text-gray-500">Ingreso neto estimado</p>
                        <p className="text-2xl font-bold text-gray-900">{formatPrice(netRevenue)}</p>
                        <p className="mt-1 text-xs text-gray-400">
                            Comision estimada {(TOTAL_COMMISSION_RATE * 100).toFixed(2)}%
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="rounded-lg bg-amber-100 p-3 text-amber-700">
                            <CreditCard className="h-5 w-5" />
                        </div>
                        <p className="mt-4 text-sm text-gray-500">Cobros pendientes</p>
                        <p className="text-2xl font-bold text-gray-900">{formatPrice(pendingRevenue)}</p>
                        <p className="mt-1 text-xs text-gray-400">
                            {pendingSummary._count._all} ordenes en espera de pago
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="rounded-lg bg-rose-100 p-3 text-rose-700">
                            <Receipt className="h-5 w-5" />
                        </div>
                        <p className="mt-4 text-sm text-gray-500">Reembolsos</p>
                        <p className="text-2xl font-bold text-gray-900">{formatPrice(refundedRevenue)}</p>
                        <p className="mt-1 text-xs text-gray-400">
                            {refundedSummary._count._all} ordenes reembolsadas
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                    <CardHeader className="flex flex-row items-start justify-between gap-4">
                        <div>
                            <CardTitle>Eventos con mayor recaudacion</CardTitle>
                            <CardDescription>
                                Vista rapida de ingresos, ordenes y entradas vendidas.
                            </CardDescription>
                        </div>
                        <Button asChild variant="outline" size="sm">
                            <Link href="/tesoreria/eventos">
                                Ver todos
                                <ArrowUpRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {topEvents.length === 0 ? (
                            <div className="py-10 text-center text-sm text-gray-500">
                                Todavia no hay ventas registradas.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="border-b text-left text-gray-500">
                                            <th className="py-2 pr-4 font-medium">Evento</th>
                                            <th className="py-2 pr-4 font-medium">Fecha</th>
                                            <th className="py-2 pr-4 font-medium">Ingresos</th>
                                            <th className="py-2 pr-4 font-medium">Ordenes</th>
                                            <th className="py-2 pr-4 font-medium">Entradas</th>
                                            <th className="py-2 pr-4 font-medium"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topEvents.map((event) => (
                                            <tr key={event.id} className="border-b last:border-0">
                                                <td className="py-3 pr-4">
                                                    <div>
                                                        <p className="font-medium text-gray-900">{event.title}</p>
                                                        <p className="text-xs text-gray-500">{event.venue}</p>
                                                    </div>
                                                </td>
                                                <td className="py-3 pr-4 text-gray-600">
                                                    {new Intl.DateTimeFormat("es-PE", {
                                                        day: "2-digit",
                                                        month: "short",
                                                        year: "numeric",
                                                        timeZone: "America/Lima",
                                                    }).format(event.startDate)}
                                                </td>
                                                <td className="py-3 pr-4 font-medium text-emerald-700">
                                                    {formatPrice(event.grossRevenue)}
                                                </td>
                                                <td className="py-3 pr-4">{event.totalOrders}</td>
                                                <td className="py-3 pr-4">{event.ticketsSold}</td>
                                                <td className="py-3 pr-4 text-right">
                                                    <Button asChild variant="ghost" size="sm">
                                                        <Link href={`/tesoreria/eventos/${event.id}`}>
                                                            Abrir
                                                        </Link>
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Indicadores clave</CardTitle>
                        <CardDescription>Seguimiento financiero y de actividad.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-xs text-gray-500">Ingresos este mes</p>
                            <p className="mt-1 text-2xl font-bold text-gray-900">
                                {formatPrice(thisMonthRevenue)}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                                Variacion vs mes anterior: {monthChange.toFixed(1)}%
                            </p>
                        </div>

                        <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-xs text-gray-500">Comision estimada</p>
                            <p className="mt-1 text-2xl font-bold text-gray-900">
                                {formatPrice(grossRevenue * TOTAL_COMMISSION_RATE)}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                                Calculado sobre los pagos confirmados
                            </p>
                        </div>

                        <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-xs text-gray-500">Eventos activos</p>
                            <p className="mt-1 text-2xl font-bold text-gray-900">{activeEvents.length}</p>
                            <p className="mt-1 text-xs text-gray-400">
                                Eventos publicados con fecha futura o vigente
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Button asChild variant="outline" className="justify-start">
                                <Link href="/tesoreria/ingresos">
                                    <DollarSign className="mr-2 h-4 w-4" />
                                    Ingresos
                                </Link>
                            </Button>
                            <Button asChild variant="outline" className="justify-start">
                                <Link href="/tesoreria/estadisticas">
                                    <BarChart3 className="mr-2 h-4 w-4" />
                                    Estadisticas
                                </Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Ultimos pagos confirmados</CardTitle>
                    <CardDescription>
                        Trazabilidad reciente para conciliacion y revision de operaciones.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {recentOrders.length === 0 ? (
                        <div className="py-10 text-center text-sm text-gray-500">
                            Aun no hay pagos confirmados.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-gray-500">
                                        <th className="py-2 pr-4 font-medium">Operacion</th>
                                        <th className="py-2 pr-4 font-medium">Cliente</th>
                                        <th className="py-2 pr-4 font-medium">Evento</th>
                                        <th className="py-2 pr-4 font-medium">Metodo</th>
                                        <th className="py-2 pr-4 font-medium">Monto</th>
                                        <th className="py-2 pr-4 font-medium">Pagado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentOrders.map((order) => {
                                        const payment = extractOrderPaymentDetails(order)
                                        return (
                                            <tr key={order.id} className="border-b last:border-0">
                                                <td className="py-3 pr-4">
                                                    <div>
                                                        <p className="font-medium text-gray-900">
                                                            #{order.id.slice(-8).toUpperCase()}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {order.providerRef || "Sin referencia"}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="py-3 pr-4">
                                                    <div>
                                                        <p className="font-medium text-gray-900">
                                                            {order.user?.name || "Sin nombre"}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {order.user?.email || "-"}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="py-3 pr-4 text-gray-700">
                                                    {order.orderItems[0]?.ticketType.event.title || "-"}
                                                </td>
                                                <td className="py-3 pr-4 text-gray-700">
                                                    {payment.methodLabel || order.provider || "-"}
                                                </td>
                                                <td className="py-3 pr-4 font-medium text-emerald-700">
                                                    {formatPrice(Number(order.totalAmount), order.currency)}
                                                </td>
                                                <td className="py-3 pr-4 text-gray-600">
                                                    {formatDateTimeForExport(order.paidAt || order.createdAt)}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
