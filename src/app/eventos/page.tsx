import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { formatDate, formatPrice } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar, MapPin, Waves, Search, Filter, ArrowRight } from "lucide-react"
import type { Prisma } from "@prisma/client"
export const dynamic = "force-dynamic"

interface EventsPageProps {
    searchParams: Promise<{
        search?: string
        discipline?: string
        location?: string
    }>
}

type EventCard = {
    id: string
    slug: string
    title: string
    description: string
    startDate: Date
    endDate: Date
    venue: string
    location: string
    discipline?: string | null
    bannerUrl?: string | null
    ticketTypes: {
        price: Prisma.Decimal
    }[]
}

type DisciplineEvent = {
    discipline: string | null
}

async function getEvents(filters: {
    search?: string
    discipline?: string
    location?: string
}): Promise<EventCard[]> {
    const where: Record<string, unknown> = {
        isPublished: true,
        endDate: { gte: new Date() },
    }

    if (filters.discipline) {
        where.discipline = filters.discipline
    }

    if (filters.location) {
        where.location = { contains: filters.location, mode: "insensitive" }
    }

    if (filters.search) {
        where.OR = [
            { title: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
            { venue: { contains: filters.search, mode: "insensitive" } },
        ]
    }

    const events = await prisma.event.findMany({
        where,
        include: {
            ticketTypes: {
                where: { isActive: true },
                orderBy: { price: "asc" },
                take: 1,
            },
            eventDays: {
                orderBy: { date: "asc" },
            },
        },
        orderBy: { startDate: "asc" },
    })

    return events
}

async function getDisciplines() {
    const events = await prisma.event.findMany({
        where: { isPublished: true, discipline: { not: null } },
        select: { discipline: true },
        distinct: ["discipline"],
    })
    return events
        .map((event: DisciplineEvent) => event.discipline)
        .filter((discipline: string | null): discipline is string => Boolean(discipline))
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
    const params = await searchParams
    const events = await getEvents(params)
    const disciplines: string[] = await getDisciplines()

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-gradient-fdnda py-12">
                <div className="container mx-auto px-4 text-center text-white">
                    <h1 className="text-3xl md:text-4xl font-bold mb-4">Próximos Eventos</h1>
                    <p className="text-white/80 max-w-2xl mx-auto">
                        Descubre los mejores eventos de deportes acuáticos y asegura tu entrada
                    </p>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8">
                {/* Filters */}
                <div className="bg-white rounded-xl shadow-sm p-4 mb-8">
                    <form className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <Input
                                name="search"
                                placeholder="Buscar eventos..."
                                defaultValue={params.search}
                                className="pl-10"
                            />
                        </div>

                        <select
                            name="discipline"
                            defaultValue={params.discipline}
                            className="h-11 px-3 rounded-lg border border-input bg-background text-sm"
                        >
                            <option value="">Todas las disciplinas</option>
                            {disciplines.map((d) => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>

                        <Button type="submit" variant="outline" className="gap-2">
                            <Filter className="h-4 w-4" />
                            Filtrar
                        </Button>
                    </form>
                </div>

                {/* Events Grid */}
                {events.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {events.map((event: EventCard) => (
                            <Link key={event.id} href={`/eventos/${event.slug}`}>
                                <Card hover className="h-full overflow-hidden group">
                                    {/* Event image */}
                                    <div className="relative h-48 bg-gradient-fdnda overflow-hidden">
                                        {event.bannerUrl ? (
                                            <Image
                                                src={event.bannerUrl}
                                                alt={event.title}
                                                fill
                                                sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                                                unoptimized
                                                className="object-cover group-hover:scale-105 transition-transform duration-500"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Waves className="h-16 w-16 text-white/30" />
                                            </div>
                                        )}
                                        {event.discipline && (
                                            <Badge className="absolute top-3 left-3 bg-white/90 text-gray-800">
                                                {event.discipline}
                                            </Badge>
                                        )}
                                    </div>

                                    <CardContent className="p-5">
                                        <h3 className="font-bold text-lg mb-2 line-clamp-2 group-hover:text-[hsl(210,100%,40%)] transition-colors">
                                            {event.title}
                                        </h3>

                                        <div className="space-y-2 text-sm text-gray-600 mb-4">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-4 w-4 text-gray-400" />
                                                <span>
                                                    {formatDate(event.startDate)}
                                                    {event.startDate.toDateString() !== event.endDate.toDateString() && (
                                                        <> - {formatDate(event.endDate)}</>
                                                    )}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <MapPin className="h-4 w-4 text-gray-400" />
                                                <span className="line-clamp-1">{event.venue}, {event.location}</span>
                                            </div>
                                        </div>

                                        <p className="text-sm text-gray-500 line-clamp-2 mb-4">
                                            {event.description}
                                        </p>

                                        <div className="flex items-center justify-between pt-4 border-t">
                                            <div>
                                                {event.ticketTypes[0] && (
                                                    <div className="text-[hsl(210,100%,40%)] font-bold">
                                                        Desde {formatPrice(Number(event.ticketTypes[0].price))}
                                                    </div>
                                                )}
                                            </div>
                                            <Button size="sm" variant="outline" className="gap-1">
                                                Ver más
                                                <ArrowRight className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16">
                        <Waves className="h-20 w-20 mx-auto text-gray-300 mb-4" />
                        <h3 className="text-xl font-semibold text-gray-600 mb-2">
                            No se encontraron eventos
                        </h3>
                        <p className="text-gray-500 mb-6">
                            {params.search || params.discipline
                                ? "Intenta con otros filtros de búsqueda"
                                : "Pronto anunciaremos nuevos eventos. ¡Mantente atento!"}
                        </p>
                        {(params.search || params.discipline) && (
                            <Link href="/eventos">
                                <Button variant="outline">Limpiar filtros</Button>
                            </Link>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

