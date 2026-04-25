import Link from "next/link"
import { getCachedPublishedEvents, type CachedEvent } from "@/lib/cached-queries"
import { formatDate, formatPrice } from "@/lib/utils"
import { richTextToPlainText } from "@/lib/sanitize-rich-text"
import { EventBannerMedia } from "@/components/events/EventBannerMedia"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar, MapPin, Waves, Search, Filter, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react"

export const revalidate = 60
export const dynamic = "force-dynamic"

const PAGE_SIZE = 12

interface EventsPageProps {
    searchParams: Promise<{
        search?: string
        discipline?: string
        location?: string
        venue?: string
        page?: string
    }>
}

function normalize(value?: string): string {
    return (value || "").trim().toLowerCase()
}

function buildQuery(params: {
    search?: string
    discipline?: string
    location?: string
    venue?: string
    page?: number
}) {
    const query = new URLSearchParams()
    if (params.search) query.set("search", params.search)
    if (params.discipline) query.set("discipline", params.discipline)
    if (params.location) query.set("location", params.location)
    if (params.venue) query.set("venue", params.venue)
    if (params.page && params.page > 1) query.set("page", String(params.page))
    const qs = query.toString()
    return qs ? `/eventos?${qs}` : "/eventos"
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
    const params = await searchParams
    const search = normalize(params.search)
    const discipline = params.discipline?.trim() || ""
    const location = normalize(params.location)
    const venue = params.venue?.trim() || ""

    const allEvents = await getCachedPublishedEvents()

    const disciplines = Array.from(
        new Set(
            allEvents
                .map((event) => event.discipline)
                .filter((value): value is string => Boolean(value))
        )
    ).sort((a, b) => a.localeCompare(b, "es"))

    const venues = Array.from(
        new Set(
            allEvents
                .map((event) => event.venue?.trim())
                .filter((value): value is string => Boolean(value))
        )
    ).sort((a, b) => a.localeCompare(b, "es"))

    const filteredEvents = allEvents.filter((event) => {
        if (discipline && event.discipline !== discipline) return false
        if (venue && event.venue !== venue) return false

        if (location) {
            const eventLocation = normalize(event.location)
            if (!eventLocation.includes(location)) return false
        }

        if (search) {
            const haystack = `${event.title} ${richTextToPlainText(event.description)} ${event.venue}`.toLowerCase()
            if (!haystack.includes(search)) return false
        }

        return true
    })

    const requestedPage = Number.parseInt(params.page || "1", 10)
    const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE))
    const safePage = Math.min(currentPage, totalPages)

    const start = (safePage - 1) * PAGE_SIZE
    const events = filteredEvents.slice(start, start + PAGE_SIZE)

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="bg-gradient-fdnda py-8 sm:py-12">
                <div className="container mx-auto px-4 text-center text-white">
                    <h1 className="mb-3 text-2xl font-bold sm:text-3xl md:text-4xl">Proximos Eventos</h1>
                    <p className="mx-auto max-w-2xl text-sm text-white/80 sm:text-base">
                        Descubre los mejores eventos de deportes acuaticos y asegura tu entrada.
                    </p>
                </div>
            </div>

            <div className="container mx-auto px-4 py-6 sm:py-8">
                <div className="bg-white rounded-xl shadow-sm p-3 sm:p-4 mb-6 sm:mb-8">
                    <form className="flex flex-col gap-3 md:flex-row md:gap-4">
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
                            defaultValue={discipline}
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm md:w-auto"
                        >
                            <option value="">Todas las disciplinas</option>
                            {disciplines.map((item) => (
                                <option key={item} value={item}>{item}</option>
                            ))}
                        </select>

                        <select
                            name="venue"
                            defaultValue={venue}
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm md:w-64"
                        >
                            <option value="">Todas las sedes</option>
                            {venues.map((item) => (
                                <option key={item} value={item}>{item}</option>
                            ))}
                        </select>

                        <Button type="submit" variant="outline" className="w-full gap-2 md:w-auto">
                            <Filter className="h-4 w-4" />
                            Filtrar
                        </Button>
                    </form>
                </div>

                {events.length > 0 ? (
                    <>
                        <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                            {events.map((event: CachedEvent) => (
                                <Link key={event.id} href={`/eventos/${event.slug}`}>
                                    <Card hover className="h-full overflow-hidden group">
                                        <div className="relative h-48 bg-gradient-fdnda overflow-hidden">
                                            {event.bannerUrl ? (
                                                <EventBannerMedia
                                                    src={event.bannerUrl}
                                                    alt={event.title}
                                                    sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
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

                                        <CardContent className="p-4 sm:p-5">
                                            <h3 className="font-bold text-lg mb-2 line-clamp-2 group-hover:text-[hsl(210,100%,40%)] transition-colors">
                                                {event.title}
                                            </h3>

                                            <div className="space-y-2 text-sm text-gray-600 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-4 w-4 text-gray-400" />
                                                    <span>
                                                        {formatDate(new Date(event.startDate))}
                                                        {new Date(event.startDate).toDateString() !== new Date(event.endDate).toDateString() && (
                                                            <> - {formatDate(new Date(event.endDate))}</>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <MapPin className="h-4 w-4 text-gray-400" />
                                                    <span className="line-clamp-1">{event.venue}, {event.location}</span>
                                                </div>
                                            </div>

                                            <p className="text-sm text-gray-500 line-clamp-2 mb-4">
                                                {richTextToPlainText(event.description)}
                                            </p>

                                            <div className="flex items-center justify-between pt-4 border-t">
                                                <div>
                                                    {typeof event.minTicketPrice === "number" && (
                                                        <div className="text-[hsl(210,100%,40%)] font-bold">
                                                            Desde {formatPrice(event.minTicketPrice)}
                                                        </div>
                                                    )}
                                                </div>
                                                <Button size="sm" variant="outline" className="gap-1">
                                                    Ver mas
                                                    <ArrowRight className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            ))}
                        </div>

                        {totalPages > 1 && (
                            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
                                <Button variant="outline" size="sm" asChild disabled={safePage <= 1}>
                                    <Link
                                        href={buildQuery({
                                            search: params.search,
                                            discipline,
                                            location: params.location,
                                            venue,
                                            page: safePage - 1,
                                        })}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Anterior
                                    </Link>
                                </Button>
                                <span className="text-sm text-gray-600 px-3">
                                    Pagina {safePage} de {totalPages}
                                </span>
                                <Button variant="outline" size="sm" asChild disabled={safePage >= totalPages}>
                                    <Link
                                        href={buildQuery({
                                            search: params.search,
                                            discipline,
                                            location: params.location,
                                            venue,
                                            page: safePage + 1,
                                        })}
                                    >
                                        Siguiente
                                        <ChevronRight className="h-4 w-4" />
                                    </Link>
                                </Button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center py-12 sm:py-16">
                        <Waves className="h-16 w-16 sm:h-20 sm:w-20 mx-auto text-gray-300 mb-4" />
                        <h3 className="text-xl font-semibold text-gray-600 mb-2">
                            No se encontraron eventos
                        </h3>
                        <p className="text-gray-500 mb-6">
                            {params.search || params.discipline || params.location || params.venue
                                ? "Intenta con otros filtros de busqueda"
                                : "Pronto anunciaremos nuevos eventos. Mantente atento."}
                        </p>
                        {(params.search || params.discipline || params.location || params.venue) && (
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
