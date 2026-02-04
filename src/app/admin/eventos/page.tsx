import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { formatDate, formatPrice } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
    Plus, 
    Edit, 
    MapPin, 
    Ticket, 
    Calendar,
    Eye,
    MoreVertical,
    Search,
    Filter,
    Grid3X3,
    List,
    DollarSign,
    Users,
} from "lucide-react"
import type { Prisma } from "@prisma/client"
export const dynamic = "force-dynamic"

// ==================== TYPES ====================

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

// ==================== PAGE ====================

export default async function AdminEventsPage() {
    const events = await prisma.event.findMany({
        include: {
            _count: {
                select: { 
                    tickets: true,
                    scans: true,
                }
            },
            ticketTypes: {
                select: {
                    id: true,
                    name: true,
                    price: true,
                    sold: true,
                    capacity: true,
                }
            }
        },
        orderBy: { startDate: "desc" }
    }) as EventWithStats[]

    // Calculate stats
    const totalEvents = events.length
    const publishedEvents = events.filter(e => e.isPublished).length
    const activeEvents = events.filter(e => new Date(e.endDate) >= new Date() && e.isPublished).length

    // Separate events by status
    const upcomingEvents = events.filter(e => new Date(e.startDate) > new Date())
    const ongoingEvents = events.filter(e => {
        const now = new Date()
        return new Date(e.startDate) <= now && new Date(e.endDate) >= now
    })
    const pastEvents = events.filter(e => new Date(e.endDate) < new Date())

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <p className="text-gray-500">Gestiona todos los eventos y sus entradas</p>
                </div>
                <Link href="/admin/eventos/nuevo">
                    <Button className="gap-2 w-full sm:w-auto">
                        <Plus className="h-4 w-4" />
                        Nuevo Evento
                    </Button>
                </Link>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
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
                            <div className="p-2 rounded-lg bg-green-100">
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
                            <div className="p-2 rounded-lg bg-orange-100">
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
                            <div className="p-2 rounded-lg bg-purple-100">
                                <Users className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {events.reduce((acc, e) => acc + e._count.tickets, 0)}
                                </p>
                                <p className="text-xs text-gray-500">Entradas Totales</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Ongoing Events */}
            {ongoingEvents.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        En Curso ({ongoingEvents.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {ongoingEvents.map((event) => (
                            <EventCard key={event.id} event={event} status="ongoing" />
                        ))}
                    </div>
                </div>
            )}

            {/* Upcoming Events */}
            {upcomingEvents.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold mb-3">
                        Próximos ({upcomingEvents.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {upcomingEvents.map((event) => (
                            <EventCard key={event.id} event={event} status="upcoming" />
                        ))}
                    </div>
                </div>
            )}

            {/* Past Events */}
            {pastEvents.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold mb-3 text-gray-500">
                        Pasados ({pastEvents.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {pastEvents.slice(0, 6).map((event) => (
                            <EventCard key={event.id} event={event} status="past" />
                        ))}
                    </div>
                    {pastEvents.length > 6 && (
                        <div className="text-center mt-4">
                            <Button variant="outline">
                                Ver todos los eventos pasados ({pastEvents.length - 6} más)
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Empty State */}
            {events.length === 0 && (
                <Card className="p-12 text-center">
                    <Calendar className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                        No hay eventos
                    </h3>
                    <p className="text-gray-500 mb-4">
                        Comienza creando tu primer evento
                    </p>
                    <Link href="/admin/eventos/nuevo">
                        <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Crear Evento
                        </Button>
                    </Link>
                </Card>
            )}
        </div>
    )
}

// ==================== EVENT CARD COMPONENT ====================

interface EventCardProps {
    event: EventWithStats
    status: "ongoing" | "upcoming" | "past"
}

function EventCard({ event, status }: EventCardProps) {
    const totalRevenue = event.ticketTypes.reduce(
        (acc, tt) => acc + (Number(tt.price) * tt.sold),
        0
    )
    const totalCapacity = event.ticketTypes.reduce(
        (acc, tt) => acc + (tt.capacity || 0),
        0
    )
    const totalSold = event.ticketTypes.reduce((acc, tt) => acc + tt.sold, 0)
    const soldPercentage = totalCapacity > 0 
        ? Math.round((totalSold / totalCapacity) * 100) 
        : 0

    return (
        <Link href={`/admin/eventos/${event.id}`}>
            <Card className={`overflow-hidden hover:shadow-lg transition-shadow h-full ${
                status === "past" ? "opacity-75" : ""
            }`}>
                {/* Banner */}
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
                    {/* Status Badge */}
                    <div className="absolute top-2 left-2">
                        {status === "ongoing" && (
                            <Badge className="bg-green-500 text-white">En Curso</Badge>
                        )}
                        {status === "upcoming" && event.isPublished && (
                            <Badge className="bg-blue-500 text-white">Publicado</Badge>
                        )}
                        {status === "upcoming" && !event.isPublished && (
                            <Badge variant="secondary">Borrador</Badge>
                        )}
                        {status === "past" && (
                            <Badge variant="outline" className="bg-white/90">Finalizado</Badge>
                        )}
                    </div>
                    {/* Discipline Badge */}
                    {event.discipline && (
                        <div className="absolute top-2 right-2">
                            <Badge variant="outline" className="bg-white/90 text-xs">
                                {event.discipline}
                            </Badge>
                        </div>
                    )}
                </div>

                <CardContent className="p-4">
                    {/* Title & Location */}
                    <h3 className="font-semibold text-gray-900 line-clamp-1 mb-1">
                        {event.title}
                    </h3>
                    <p className="text-sm text-gray-500 flex items-center gap-1 mb-3">
                        <MapPin className="h-3 w-3" />
                        {event.venue}
                    </p>

                    {/* Date */}
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{formatDate(event.startDate)}</span>
                        {event.startDate.toDateString() !== event.endDate.toDateString() && (
                            <span>- {formatDate(event.endDate)}</span>
                        )}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t">
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900">{event._count.tickets}</p>
                            <p className="text-xs text-gray-500">Entradas</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900">{event._count.scans}</p>
                            <p className="text-xs text-gray-500">Escaneos</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-green-600">
                                {formatPrice(totalRevenue).replace("S/", "S/")}
                            </p>
                            <p className="text-xs text-gray-500">Ingresos</p>
                        </div>
                    </div>

                    {/* Capacity Bar */}
                    {totalCapacity > 0 && (
                        <div className="mt-3">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>Ocupación</span>
                                <span>{soldPercentage}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full rounded-full transition-all ${
                                        soldPercentage >= 90 ? "bg-red-500" :
                                        soldPercentage >= 70 ? "bg-orange-500" :
                                        "bg-green-500"
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
