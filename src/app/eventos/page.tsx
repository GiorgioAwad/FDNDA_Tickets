import Link from "next/link"
import type { Metadata } from "next"
import { getCachedPublishedEvents } from "@/lib/cached-queries"
import { richTextToPlainText } from "@/lib/sanitize-rich-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import { EventCard, type EventCardEvent } from "@/components/home/EventCard"
import { Search, Filter, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react"

export const revalidate = 60

const PAGE_SIZE = 12

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://ticketingfdnda.pe"

export const metadata: Metadata = {
    title: "Eventos",
    description:
        "Todos los eventos oficiales de deportes acuáticos de la FDNDA en Perú: natación, waterpolo, clavados, nado artístico y piscina libre. Compra tus entradas oficiales.",
    alternates: { canonical: "/eventos" },
    openGraph: {
        title: "Eventos | Ticketing FDNDA",
        description:
            "Explora los eventos oficiales de deportes acuáticos de la FDNDA y asegura tu lugar.",
        url: `${SITE_URL}/eventos`,
        type: "website",
        locale: "es_PE",
        siteName: "Ticketing FDNDA",
    },
}

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
    const hasFilters = Boolean(params.search || params.discipline || params.location || params.venue)

    // JSON-LD ItemList: ayuda a Google a entender el catálogo de eventos y a
    // mostrar el carrusel de "Eventos". Cada item referencia su página de detalle
    // (que ya lleva su propio SportsEvent JSON-LD).
    const itemListJsonLd = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: events.map((event, index) => {
            const eventUrl = `${SITE_URL}/eventos/${event.slug}`
            return {
                "@type": "ListItem",
                position: start + index + 1,
                item: {
                    "@type": "SportsEvent",
                    name: event.title,
                    url: eventUrl,
                    startDate: event.startDate,
                    endDate: event.endDate,
                    eventStatus: "https://schema.org/EventScheduled",
                    eventAttendanceMode:
                        "https://schema.org/OfflineEventAttendanceMode",
                    image: event.bannerUrl ? [event.bannerUrl] : undefined,
                    location: {
                        "@type": "Place",
                        name: event.venue,
                        address: {
                            "@type": "PostalAddress",
                            addressLocality: event.location,
                            addressCountry: "PE",
                        },
                    },
                    ...(typeof event.minTicketPrice === "number"
                        ? {
                              offers: {
                                  "@type": "Offer",
                                  url: eventUrl,
                                  price: event.minTicketPrice.toFixed(2),
                                  priceCurrency: "PEN",
                                  availability: "https://schema.org/InStock",
                              },
                          }
                        : {}),
                },
            }
        }),
    }

    const cardEvents: EventCardEvent[] = events.map((event) => ({
        id: event.id,
        slug: event.slug,
        title: event.title,
        bannerUrl: event.bannerUrl,
        discipline: event.discipline,
        startDate: new Date(event.startDate),
        venue: event.venue,
        location: event.location,
        minPrice: typeof event.minTicketPrice === "number" ? event.minTicketPrice : undefined,
    }))

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/40 via-white to-white">
            {events.length > 0 && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
                />
            )}

            {/* Compact hero */}
            <section className="relative overflow-hidden bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary text-white">
                <div className="absolute -top-32 right-1/4 h-72 w-72 rounded-full bg-fdnda-accent/30 blur-3xl" aria-hidden="true" />
                <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-coral/20 blur-3xl" aria-hidden="true" />
                <div className="relative container mx-auto px-4 py-12 sm:py-16">
                    <div className="max-w-3xl mx-auto text-center">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-md ring-1 ring-white/25 px-3 py-1 text-xs font-semibold mb-4">
                            <Sparkles className="h-3 w-3 text-fdnda-accent" />
                            {filteredEvents.length} {filteredEvents.length === 1 ? "evento disponible" : "eventos disponibles"}
                        </div>
                        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold mb-4 tracking-tight leading-[1.05]">
                            Encuentra tu próxima{" "}
                            <span className="text-gradient-coral">experiencia acuática</span>
                        </h1>
                        <p className="text-white/85 text-base sm:text-lg max-w-2xl mx-auto">
                            Explora los eventos oficiales de la FDNDA y asegura tu lugar.
                        </p>
                    </div>
                </div>
            </section>

            <div className="container mx-auto px-4 py-8 sm:py-10">
                {/* Sticky filter bar */}
                <div className="sticky top-16 z-30 -mx-4 sm:mx-0 mb-6 sm:mb-8">
                    <div className="bg-white/95 backdrop-blur-xl border border-border rounded-none sm:rounded-2xl shadow-card px-4 py-3 sm:px-5 sm:py-4">
                        <form className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3">
                            <div className="flex-1 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    name="search"
                                    placeholder="Buscar por nombre, sede o disciplina..."
                                    defaultValue={params.search}
                                    className="pl-9 h-11 rounded-xl bg-muted/40"
                                />
                            </div>

                            <div className="flex flex-col sm:flex-row gap-2">
                                <select
                                    name="discipline"
                                    defaultValue={discipline}
                                    className="h-11 w-full rounded-xl border border-input bg-white px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-fdnda-primary/30 sm:w-48"
                                >
                                    <option value="">Todas las disciplinas</option>
                                    {disciplines.map((item) => (
                                        <option key={item} value={item}>{item}</option>
                                    ))}
                                </select>

                                <select
                                    name="venue"
                                    defaultValue={venue}
                                    className="h-11 w-full rounded-xl border border-input bg-white px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-fdnda-primary/30 sm:w-56"
                                >
                                    <option value="">Todas las sedes</option>
                                    {venues.map((item) => (
                                        <option key={item} value={item}>{item}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex gap-2">
                                <Button type="submit" className="flex-1 lg:flex-none gap-2 rounded-xl">
                                    <Filter className="h-4 w-4" />
                                    Filtrar
                                </Button>
                                {hasFilters && (
                                    <Link href="/eventos">
                                        <Button type="button" variant="ghost" size="icon" aria-label="Limpiar filtros" className="rounded-xl">
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </Link>
                                )}
                            </div>
                        </form>

                        {hasFilters && (
                            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
                                <span className="text-xs text-muted-foreground">Filtros activos:</span>
                                {params.search && (
                                    <Badge variant="info" className="gap-1 font-normal">
                                        “{params.search}”
                                    </Badge>
                                )}
                                {discipline && <Badge variant="coral-soft" className="font-normal">{discipline}</Badge>}
                                {venue && <Badge variant="info" className="font-normal">{venue}</Badge>}
                            </div>
                        )}
                    </div>
                </div>

                {events.length > 0 ? (
                    <>
                        <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                            {cardEvents.map((event) => (
                                <EventCard key={event.id} event={event} />
                            ))}
                        </div>

                        {totalPages > 1 && (
                            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
                                <Button variant="outline" size="sm" asChild disabled={safePage <= 1} className="rounded-full">
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
                                <span className="text-sm text-muted-foreground px-3 font-medium">
                                    Página {safePage} de {totalPages}
                                </span>
                                <Button variant="outline" size="sm" asChild disabled={safePage >= totalPages} className="rounded-full">
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
                    <EmptyState
                        variant={hasFilters ? "no-results" : "no-events"}
                        title={hasFilters ? "Sin resultados con esos filtros" : "Pronto, nuevos eventos"}
                        description={
                            hasFilters
                                ? "Intenta con otros filtros o limpia la búsqueda para ver todos los eventos disponibles."
                                : "Estamos preparando experiencias únicas. Vuelve pronto para descubrirlas."
                        }
                        action={
                            hasFilters
                                ? { label: "Limpiar filtros", href: "/eventos", variant: "default" }
                                : { label: "Volver al inicio", href: "/", variant: "default" }
                        }
                    />
                )}
            </div>
        </div>
    )
}
