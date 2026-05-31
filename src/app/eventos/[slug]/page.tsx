import { notFound } from "next/navigation"
import { timingSafeEqual } from "crypto"
import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { getCachedEventBySlug } from "@/lib/cached-queries"
import { cn, formatDate } from "@/lib/utils"
import { normalizeRichTextForDisplay } from "@/lib/sanitize-rich-text"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EventHero } from "@/components/events/EventHero"
import { EventShareBar } from "@/components/events/EventShareBar"
import { EventCountdownStrip } from "@/components/events/EventCountdownStrip"
import TicketPurchaseCard, { type TicketTypeClient } from "./TicketPurchaseCard"
import {
    Calendar,
    MapPin,
    Clock,
    FileText,
} from "lucide-react"

export const revalidate = 30

interface EventPageProps {
    params: Promise<{ slug: string }>
    searchParams: Promise<{ t?: string | string[] }>
}

function tokensMatch(provided: string | undefined, expected: string | null): boolean {
    if (!expected || !provided) return false
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
}

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://ticketingfdnda.pe"

function buildMetaDescription(text: string, max = 160): string {
    const stripped = text
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    const clean = stripped.replace(/\s+/g, " ").trim()
    if (clean.length <= max) return clean
    return `${clean.slice(0, max - 1).trimEnd()}…`
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
    const { slug } = await params
    // Query de metadata cacheada (Redis): datos estáticos de SEO, sin stock.
    // Reduce de 2→1 las queries a Neon por request del detalle.
    const event = await getCachedEventBySlug(slug)
    if (!event) return {}

    if (event.visibility === "PRIVATE" || !event.isPublished) {
        return {
            title: event.title,
            robots: { index: false, follow: false },
        }
    }

    const description = buildMetaDescription(
        `${event.description} | ${event.venue}, ${event.location}.`
    )
    const canonical = `/eventos/${slug}`
    const images = event.bannerUrl ? [{ url: event.bannerUrl, alt: event.title }] : undefined

    return {
        title: event.title,
        description,
        alternates: { canonical },
        openGraph: {
            title: event.title,
            description,
            url: `${SITE_URL}${canonical}`,
            type: "website",
            locale: "es_PE",
            siteName: "Ticketing FDNDA",
            images,
        },
        twitter: {
            card: "summary_large_image",
            title: event.title,
            description,
            images: event.bannerUrl ? [event.bannerUrl] : undefined,
        },
    }
}

type EventDayItem = {
    id: string
    date: Date
    openTime: string
    closeTime: string
    capacity: number
}

async function getEvent(slug: string) {
    try {
        const event = await prisma.event.findUnique({
            where: { slug },
            include: {
                eventDays: {
                    orderBy: { date: "asc" },
                },
                ticketTypes: {
                    where: { isActive: true },
                    orderBy: { sortOrder: "asc" },
                    include: {
                        dateInventories: {
                            orderBy: { date: "asc" },
                        },
                    },
                },
            },
        })
        return event
    } catch (error) {
        console.error("[getEvent]", slug, error)
        throw error
    }
}

export default async function EventDetailPage({ params, searchParams }: EventPageProps) {
    const { slug } = await params
    const { t } = await searchParams
    const event = await getEvent(slug)

    if (!event || !event.isPublished) {
        notFound()
    }

    if (event.visibility === "PRIVATE") {
        const provided = Array.isArray(t) ? t[0] : t
        if (!tokensMatch(provided, event.accessToken)) {
            notFound()
        }
    }

    const isPoolFreeEvent = event.category === "PISCINA_LIBRE"

    const ticketPrices = event.ticketTypes
        .map((tt) => Number(tt.price))
        .filter((p) => Number.isFinite(p) && p >= 0)
    const lowestPrice = ticketPrices.length ? Math.min(...ticketPrices) : null
    const totalCapacity = event.ticketTypes.reduce((sum, tt) => sum + (tt.capacity ?? 0), 0)
    const eventUrl = `${SITE_URL}/eventos/${event.slug}`
    const eventJsonLd = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        name: event.title,
        description: buildMetaDescription(event.description, 5000),
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        url: eventUrl,
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
        organizer: {
            "@type": "SportsOrganization",
            name: "Federación Deportiva Nacional de Deportes Acuáticos",
            url: SITE_URL,
        },
        offers: lowestPrice !== null ? {
            "@type": "Offer",
            url: eventUrl,
            price: lowestPrice.toFixed(2),
            priceCurrency: "PEN",
            availability: "https://schema.org/InStock",
            validFrom: new Date().toISOString(),
        } : undefined,
    }

    const ticketTypes: TicketTypeClient[] = event.ticketTypes.map((ticket) => ({
        id: ticket.id,
        name: ticket.name,
        description: ticket.description,
        price: Number(ticket.price),
        capacity: ticket.capacity,
        sold: ticket.sold,
        isActive: ticket.isActive,
        isPackage: ticket.isPackage,
        packageDaysCount: ticket.packageDaysCount,
        validDays: ticket.validDays,
        servilexEnabled: ticket.servilexEnabled,
        servilexIndicator: ticket.servilexIndicator,
        servilexExtraConfig: ticket.servilexExtraConfig,
        dateInventories: ticket.dateInventories.map((inventory) => ({
            date: inventory.date.toISOString(),
            sold: inventory.sold,
            capacity: inventory.capacity,
            isEnabled: inventory.isEnabled,
        })),
    }))

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd) }}
            />

            <EventHero
                title={event.title}
                bannerUrl={event.bannerUrl}
                discipline={event.discipline}
                venue={event.venue}
                location={event.location}
            />

            <div className="container mx-auto px-4 py-6 sm:py-10">
                <div className={cn("grid grid-cols-1 gap-6 sm:gap-8", isPoolFreeEvent ? "" : "lg:grid-cols-3")}>
                    {/* Main Content */}
                    <div className={cn("space-y-6", isPoolFreeEvent ? "" : "lg:col-span-2")}>
                        {/* Pills */}
                        <div className="flex flex-wrap gap-2">
                            <InfoPill icon={Calendar} label={formatDate(event.startDate, { dateStyle: "long" })} />
                            <InfoPill icon={MapPin} label={`${event.venue} · ${event.location}`} />
                        </div>

                        {/* Countdown */}
                        <EventCountdownStrip startDate={event.startDate} />

                        {/* Description */}
                        <Card className="overflow-hidden">
                            <CardContent className="p-5 sm:p-7">
                                <div className="flex items-center gap-2 mb-4">
                                    <FileText className="h-5 w-5 text-fdnda-secondary" />
                                    <h2 className="font-display text-xl sm:text-2xl font-bold">Descripción</h2>
                                </div>
                                <div
                                    className="prose prose-sm sm:prose-base prose-gray max-w-none prose-headings:font-display prose-headings:text-foreground prose-a:text-fdnda-secondary prose-a:no-underline hover:prose-a:underline"
                                    dangerouslySetInnerHTML={{
                                        __html: normalizeRichTextForDisplay(event.description),
                                    }}
                                />
                            </CardContent>
                        </Card>

                        {/* Event Days */}
                        {event.eventDays.length > 0 && (
                            <Card className="overflow-hidden">
                                <CardHeader className="bg-gradient-to-r from-fdnda-light/40 to-transparent border-b border-border">
                                    <CardTitle className="flex items-center gap-2 font-display text-xl">
                                        <Clock className="h-5 w-5 text-fdnda-secondary" />
                                        Días del evento
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-5 sm:p-6">
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        {event.eventDays.map((day: EventDayItem) => (
                                            <div
                                                key={day.id}
                                                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-fdnda-secondary/40 hover:bg-fdnda-light/20"
                                            >
                                                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white shadow-md">
                                                    <span className="font-display text-base font-bold leading-none">
                                                        {day.date.toLocaleDateString("es-PE", { day: "2-digit" })}
                                                    </span>
                                                    <span className="text-[9px] uppercase tracking-wider opacity-90 mt-0.5">
                                                        {day.date.toLocaleDateString("es-PE", { month: "short" })}
                                                    </span>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-semibold text-sm truncate">
                                                        {formatDate(day.date, { dateStyle: "full" })}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                                                        <Clock className="h-3 w-3" />
                                                        {day.openTime} – {day.closeTime}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Share */}
                        <Card>
                            <CardContent className="p-5">
                                <EventShareBar title={event.title} url={`/eventos/${event.slug}`} />
                            </CardContent>
                        </Card>

                        {isPoolFreeEvent && (
                            <TicketPurchaseCard
                                eventId={event.id}
                                eventTitle={event.title}
                                eventCategory={event.category}
                                ticketTypes={ticketTypes}
                                eventStartDate={event.startDate}
                                eventEndDate={event.endDate}
                            />
                        )}
                    </div>

                    {/* Sidebar - Tickets */}
                    {!isPoolFreeEvent && (
                        <div className="lg:sticky lg:top-20 self-start space-y-6">
                            <TicketPurchaseCard
                                eventId={event.id}
                                eventTitle={event.title}
                                eventCategory={event.category}
                                ticketTypes={ticketTypes}
                                eventStartDate={event.startDate}
                                eventEndDate={event.endDate}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function InfoPill({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-foreground/80 shadow-sm">
            <Icon className="h-3.5 w-3.5 text-fdnda-secondary" />
            {label}
        </span>
    )
}
