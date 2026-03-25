import Link from "next/link"
import { getTreasuryEventSummaries } from "@/lib/treasury"
import { formatDate, formatPrice } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowUpRight, Calendar, DollarSign, Ticket } from "lucide-react"
import {
    CompletedEventsExportButton,
    type CompletedEventExportRow,
} from "@/components/treasury/CompletedEventsExportButton"

export const dynamic = "force-dynamic"

function getCategoryLabel(category: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA") {
    switch (category) {
        case "PISCINA_LIBRE":
            return "Piscina libre"
        case "ACADEMIA":
            return "Academia"
        default:
            return "Evento"
    }
}

export default async function TreasuryEventsPage() {
    const events = await getTreasuryEventSummaries()

    const totalRevenue = events.reduce((acc, event) => acc + event.grossRevenue, 0)
    const totalTickets = events.reduce((acc, event) => acc + event.ticketsSold, 0)
    const totalOrders = events.reduce((acc, event) => acc + event.totalOrders, 0)
    const completedEvents = events.filter((event) => event.isCompleted)

    const completedExportRows: CompletedEventExportRow[] = completedEvents.map((event) => ({
        title: event.title,
        category: getCategoryLabel(event.category),
        venue: event.venue,
        location: event.location,
        startDate: formatDate(event.startDate),
        endDate: formatDate(event.endDate),
        totalOrders: event.totalOrders,
        ticketsSold: event.ticketsSold,
        grossRevenue: event.grossRevenue,
        commissionAmount: event.commissionAmount,
        advanceAmount: event.advanceAmount,
        depositedAmount: event.depositedAmount,
    }))

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card>
                    <CardContent className="p-6">
                        <div className="rounded-lg bg-emerald-100 p-3 text-emerald-700">
                            <DollarSign className="h-5 w-5" />
                        </div>
                        <p className="mt-4 text-sm text-gray-500">Ingresos acumulados</p>
                        <p className="text-2xl font-bold text-gray-900">{formatPrice(totalRevenue)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="rounded-lg bg-cyan-100 p-3 text-cyan-700">
                            <Ticket className="h-5 w-5" />
                        </div>
                        <p className="mt-4 text-sm text-gray-500">Entradas vendidas</p>
                        <p className="text-2xl font-bold text-gray-900">{totalTickets}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="rounded-lg bg-violet-100 p-3 text-violet-700">
                            <Calendar className="h-5 w-5" />
                        </div>
                        <p className="mt-4 text-sm text-gray-500">Ordenes cobradas</p>
                        <p className="text-2xl font-bold text-gray-900">{totalOrders}</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Eventos y recaudacion</CardTitle>
                    <CardDescription>
                        Vista financiera por tipo de actividad, con fecha de fin, comision y deposito estimado.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {events.length === 0 ? (
                        <div className="py-10 text-center text-sm text-gray-500">
                            Todavia no hay eventos registrados.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-gray-500">
                                        <th className="py-2 pr-4 font-medium">Evento</th>
                                        <th className="py-2 pr-4 font-medium">Tipo</th>
                                        <th className="py-2 pr-4 font-medium">Estado</th>
                                        <th className="py-2 pr-4 font-medium">Inicio</th>
                                        <th className="py-2 pr-4 font-medium">Fin</th>
                                        <th className="py-2 pr-4 font-medium">Recaudacion</th>
                                        <th className="py-2 pr-4 font-medium">Comision + IGV</th>
                                        <th className="py-2 pr-4 font-medium">Adelanto</th>
                                        <th className="py-2 pr-4 font-medium">Depositado</th>
                                        <th className="py-2 pr-4 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {events.map((event) => (
                                        <tr key={event.id} className="border-b last:border-0">
                                            <td className="py-3 pr-4">
                                                <div>
                                                    <p className="font-medium text-gray-900">{event.title}</p>
                                                    <p className="text-xs text-gray-500">
                                                        {event.venue} · {event.location}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <Badge variant="outline">{getCategoryLabel(event.category)}</Badge>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <Badge
                                                    variant={event.isCompleted ? "secondary" : event.isPublished ? "success" : "outline"}
                                                >
                                                    {event.isCompleted ? "Culminado" : event.isPublished ? "Publicado" : "Borrador"}
                                                </Badge>
                                            </td>
                                            <td className="py-3 pr-4 text-gray-600">{formatDate(event.startDate)}</td>
                                            <td className="py-3 pr-4 text-gray-600">{formatDate(event.endDate)}</td>
                                            <td className="py-3 pr-4 font-medium text-emerald-700">
                                                {formatPrice(event.grossRevenue)}
                                            </td>
                                            <td className="py-3 pr-4 text-gray-700">
                                                {formatPrice(event.commissionAmount)}
                                            </td>
                                            <td className="py-3 pr-4 text-gray-700">
                                                {formatPrice(event.advanceAmount)}
                                            </td>
                                            <td className="py-3 pr-4 font-medium text-gray-900">
                                                {formatPrice(event.depositedAmount)}
                                            </td>
                                            <td className="py-3 pr-4 text-right">
                                                <Button asChild variant="outline" size="sm">
                                                    <Link href={`/tesoreria/eventos/${event.id}`}>
                                                        Abrir reporte
                                                        <ArrowUpRight className="ml-2 h-4 w-4" />
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
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle>Eventos culminados</CardTitle>
                        <CardDescription>
                            Descarga la relacion de eventos finalizados con fecha de fin, recaudacion y liquidacion estimada.
                        </CardDescription>
                    </div>
                    <CompletedEventsExportButton
                        rows={completedExportRows}
                        filenamePrefix="tesoreria_eventos_culminados"
                    />
                </CardHeader>
                <CardContent>
                    {completedEvents.length === 0 ? (
                        <div className="py-10 text-center text-sm text-gray-500">
                            No hay eventos culminados para exportar.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-gray-500">
                                        <th className="py-2 pr-4 font-medium">Evento</th>
                                        <th className="py-2 pr-4 font-medium">Tipo</th>
                                        <th className="py-2 pr-4 font-medium">Fecha fin</th>
                                        <th className="py-2 pr-4 font-medium">Recaudacion</th>
                                        <th className="py-2 pr-4 font-medium">Comision + IGV</th>
                                        <th className="py-2 pr-4 font-medium">Adelanto</th>
                                        <th className="py-2 pr-4 font-medium">Monto depositado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {completedEvents.map((event) => (
                                        <tr key={event.id} className="border-b last:border-0">
                                            <td className="py-3 pr-4 font-medium text-gray-900">{event.title}</td>
                                            <td className="py-3 pr-4">{getCategoryLabel(event.category)}</td>
                                            <td className="py-3 pr-4 text-gray-600">{formatDate(event.endDate)}</td>
                                            <td className="py-3 pr-4 text-emerald-700">{formatPrice(event.grossRevenue)}</td>
                                            <td className="py-3 pr-4">{formatPrice(event.commissionAmount)}</td>
                                            <td className="py-3 pr-4">{formatPrice(event.advanceAmount)}</td>
                                            <td className="py-3 pr-4 font-medium text-gray-900">
                                                {formatPrice(event.depositedAmount)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
