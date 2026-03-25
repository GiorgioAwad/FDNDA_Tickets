import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { getTreasuryEventSummaries } from "@/lib/treasury"
import { formatDate, formatPrice } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    CompletedEventsExportButton,
    type CompletedEventExportRow,
} from "@/components/treasury/CompletedEventsExportButton"
import {
    Plus,
    MapPin,
    Ticket,
    Calendar,
    Eye,
    Users,
} from "lucide-react"
import type { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

type EventWithStats = {
    id: string
    title: string
    slug: string
    venue: string
    location: string
    bannerUrl: string | null
    startDate: Date
    endDate: Date
    mode: "RANGE" | "DAYS"
    category: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
    discipline: string | null
    isPublished: boolean
    _count: {
        tickets: number
        scans: number
    }
    ticketTypes: {
        id: string
        name: string
        price: Prisma.Decimal
        sold: number
        capacity: number
    }[]
}

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

export default async function AdminEventsPage() {
    const [events, financeSummaries] = await Promise.all([
        prisma.event.findMany({
            include: {
                _count: {
                    select: {
                        tickets: true,
                        scans: true,
                    },
                },
                ticketTypes: {
                    select: {
                        id: true,
                        name: true,
                        price: true,
                        sold: true,
                        capacity: true,
                    },
                },
            },
            orderBy: { startDate: "desc" },
        }) as Promise<EventWithStats[]>,
        getTreasuryEventSummaries(),
    ])

    const totalEvents = events.length
    const publishedEvents = events.filter((event) => event.isPublished).length
    const activeEvents = events.filter((event) => new Date(event.endDate) >= new Date() && event.isPublished).length

    const upcomingEvents = events.filter((event) => new Date(event.startDate) > new Date())
    const ongoingEvents = events.filter((event) => {
        const now = new Date()
        return new Date(event.startDate) <= now && new Date(event.endDate) >= now
    })
    const pastEvents = events.filter((event) => new Date(event.endDate) < new Date())

    const completedExportRows: CompletedEventExportRow[] = financeSummaries
        .filter((event) => event.isCompleted)
        .map((event) => ({
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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-gray-500">Gestiona eventos, clasificacion comercial y resultados financieros.</p>
                </div>
                <Link href="/admin/eventos/nuevo">
                    <Button className="w-full gap-2 sm:w-auto">
                        <Plus className="h-4 w-4" />
                        Nuevo Evento
                    </Button>
                </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-blue-100 p-2">
                                <Calendar className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{totalEvents}</p>
                                <p className="text-xs text-gray-500">Total Eventos</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-green-100 p-2">
                                <Eye className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{publishedEvents}</p>
                                <p className="text-xs text-gray-500">Publicados</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-orange-100 p-2">
                                <Ticket className="h-5 w-5 text-orange-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{activeEvents}</p>
                                <p className="text-xs text-gray-500">Activos Ahora</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-purple-100 p-2">
                                <Users className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {events.reduce((acc, event) => acc + event._count.tickets, 0)}
                                </p>
                                <p className="text-xs text-gray-500">Entradas Totales</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {ongoingEvents.length > 0 && (
                <div>
                    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        En Curso ({ongoingEvents.length})
                    </h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {ongoingEvents.map((event) => (
                            <EventCard key={event.id} event={event} status="ongoing" />
                        ))}
                    </div>
                </div>
            )}

            {upcomingEvents.length > 0 && (
                <div>
                    <h2 className="mb-3 text-lg font-semibold">Proximos ({upcomingEvents.length})</h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {upcomingEvents.map((event) => (
                            <EventCard key={event.id} event={event} status="upcoming" />
                        ))}
                    </div>
                </div>
            )}

            {pastEvents.length > 0 && (
                <div>
                    <h2 className="mb-3 text-lg font-semibold text-gray-500">Pasados ({pastEvents.length})</h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {pastEvents.slice(0, 6).map((event) => (
                            <EventCard key={event.id} event={event} status="past" />
                        ))}
                    </div>
                </div>
            )}

            <Card>
                <CardContent className="space-y-4 p-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Eventos culminados para descarga</h2>
                            <p className="text-sm text-gray-500">
                                Incluye tipo, fecha de fin, recaudacion, comision + IGV, adelanto y monto depositado.
                            </p>
                        </div>
                        <CompletedEventsExportButton
                            rows={completedExportRows}
                            filenamePrefix="admin_eventos_culminados"
                        />
                    </div>

                    {completedExportRows.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
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
                                    {completedExportRows.map((row) => (
                                        <tr key={`${row.title}-${row.endDate}`} className="border-b last:border-0">
                                            <td className="py-3 pr-4 font-medium text-gray-900">{row.title}</td>
                                            <td className="py-3 pr-4">{row.category}</td>
                                            <td className="py-3 pr-4 text-gray-600">{row.endDate}</td>
                                            <td className="py-3 pr-4 text-emerald-700">{formatPrice(row.grossRevenue)}</td>
                                            <td className="py-3 pr-4">{formatPrice(row.commissionAmount)}</td>
                                            <td className="py-3 pr-4">{formatPrice(row.advanceAmount)}</td>
                                            <td className="py-3 pr-4 font-medium text-gray-900">
                                                {formatPrice(row.depositedAmount)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {events.length === 0 && (
                <Card className="p-12 text-center">
                    <Calendar className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                    <h3 className="mb-2 text-lg font-medium text-gray-900">No hay eventos</h3>
                    <p className="mb-4 text-gray-500">Comienza creando tu primer evento</p>
                    <Link href="/admin/eventos/nuevo">
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Crear Evento
                        </Button>
                    </Link>
                </Card>
            )}
        </div>
    )
}

function EventCard({
    event,
    status,
}: {
    event: EventWithStats
    status: "ongoing" | "upcoming" | "past"
}) {
    const totalRevenue = event.ticketTypes.reduce(
        (acc, ticketType) => acc + Number(ticketType.price) * ticketType.sold,
        0
    )
    const totalCapacity = event.ticketTypes.reduce(
        (acc, ticketType) => acc + (ticketType.capacity || 0),
        0
    )
    const totalSold = event.ticketTypes.reduce((acc, ticketType) => acc + ticketType.sold, 0)
    const soldPercentage = totalCapacity > 0 ? Math.round((totalSold / totalCapacity) * 100) : 0

    return (
        <Link href={`/admin/eventos/${event.id}`}>
            <Card className={`h-full overflow-hidden transition-shadow hover:shadow-lg ${status === "past" ? "opacity-80" : ""}`}>
                <div className="relative h-32 bg-gradient-to-br from-blue-600 to-blue-700">
                    {event.bannerUrl ? (
                        <Image
                            src={event.bannerUrl}
                            alt={event.title}
                            fill
                            className="object-cover"
                            unoptimized
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Calendar className="h-12 w-12 text-white/30" />
                        </div>
                    )}
                    <div className="absolute left-2 top-2">
                        {status === "ongoing" && <Badge className="bg-green-500 text-white">En curso</Badge>}
                        {status === "upcoming" && event.isPublished && <Badge className="bg-blue-500 text-white">Publicado</Badge>}
                        {status === "upcoming" && !event.isPublished && <Badge variant="secondary">Borrador</Badge>}
                        {status === "past" && <Badge variant="outline" className="bg-white/90">Finalizado</Badge>}
                    </div>
                    <div className="absolute right-2 top-2">
                        <Badge variant="outline" className="bg-white/90 text-xs">
                            {getCategoryLabel(event.category)}
                        </Badge>
                    </div>
                </div>

                <CardContent className="p-4">
                    <h3 className="mb-1 line-clamp-1 font-semibold text-gray-900">{event.title}</h3>
                    <p className="mb-2 text-sm text-gray-500">{event.discipline || getCategoryLabel(event.category)}</p>
                    <p className="mb-3 flex items-center gap-1 text-sm text-gray-500">
                        <MapPin className="h-3 w-3" />
                        {event.venue}
                    </p>

                    <div className="mb-3 text-sm text-gray-600">
                        <p>Inicio: {formatDate(event.startDate)}</p>
                        <p>Fin: {formatDate(event.endDate)}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t pt-3">
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900">{event._count.tickets}</p>
                            <p className="text-xs text-gray-500">Entradas</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900">{event._count.scans}</p>
                            <p className="text-xs text-gray-500">Escaneos</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-green-600">{formatPrice(totalRevenue)}</p>
                            <p className="text-xs text-gray-500">Ingresos</p>
                        </div>
                    </div>

                    {totalCapacity > 0 && (
                        <div className="mt-3">
                            <div className="mb-1 flex justify-between text-xs text-gray-500">
                                <span>Ocupacion</span>
                                <span>{soldPercentage}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                                <div
                                    className={`h-full rounded-full ${
                                        soldPercentage >= 90
                                            ? "bg-red-500"
                                            : soldPercentage >= 70
                                              ? "bg-orange-500"
                                              : "bg-green-500"
                                    }`}
                                    style={{ width: `${Math.min(soldPercentage, 100)}%` }}
                                />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </Link>
    )
}
