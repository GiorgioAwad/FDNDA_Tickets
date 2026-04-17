import { notFound } from "next/navigation"
import Link from "next/link"
import { timingSafeEqual } from "crypto"
import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { cn, formatDate } from "@/lib/utils"
import { EventBannerMedia } from "@/components/events/EventBannerMedia"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import TicketPurchaseCard, { type TicketTypeClient } from "./TicketPurchaseCard"
import {
    Calendar,
    MapPin,
    Clock,
    Waves,
    ArrowLeft,
} from "lucide-react"

export const revalidate = 30
export const dynamic = "force-dynamic"

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

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
    const { slug } = await params
    const event = await prisma.event.findUnique({
        where: { slug },
        select: { visibility: true, title: true },
    })
    if (event?.visibility === "PRIVATE") {
        return {
            title: event.title,
            robots: { index: false, follow: false },
        }
    }
    return {}
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
        <div className="min-h-screen bg-gray-50">
            {/* Hero */}
            <div className="relative h-56 sm:h-64 md:h-96 bg-gradient-fdnda overflow-hidden">
                <div className="absolute top-4 left-0 right-0 z-10">
                    <div className="container mx-auto px-4">
                        <Link
                            href="/eventos"
                            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm text-white/90 hover:text-white transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Volver a eventos
                        </Link>
                    </div>
                </div>
                {event.bannerUrl ? (
                    <EventBannerMedia
                        src={event.bannerUrl}
                        alt={event.title}
                        priority
                        sizes="100vw"
                        className="object-cover opacity-80"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Waves className="h-32 w-32 text-white/20" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                <div className="absolute bottom-0 left-0 right-0 p-4 text-white sm:p-6">
                    <div className="container mx-auto">
                        <div className="flex flex-wrap gap-2 mb-3">
                            {event.discipline && (
                                <Badge className="bg-white/20 text-white border-0">
                                    {event.discipline}
                                </Badge>
                            )}
                        </div>

                        <h1 className="text-2xl font-bold sm:text-3xl md:text-4xl">{event.title}</h1>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-5 sm:py-8">
                <div className={cn("grid grid-cols-1 gap-6 sm:gap-8", isPoolFreeEvent ? "" : "lg:grid-cols-3")}>
                    {/* Main Content */}
                    <div className={cn("space-y-6", isPoolFreeEvent ? "" : "lg:col-span-2")}>
                        {/* Event Info */}
                        <Card>
                            <CardContent className="p-4 sm:p-6">
                                <div className="mb-5 grid grid-cols-1 gap-4 sm:mb-6 sm:grid-cols-2">
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 rounded-lg bg-blue-50">
                                            <Calendar className="h-5 w-5 text-blue-600" />
                                        </div>
                                        <div>
                                            <div className="text-sm text-gray-500">Fecha</div>
                                            <div className="font-medium">
                                                {formatDate(event.startDate)}
                                                {event.startDate.toDateString() !== event.endDate.toDateString() && (
                                                    <> - {formatDate(event.endDate)}</>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <div className="p-2 rounded-lg bg-green-50">
                                            <MapPin className="h-5 w-5 text-green-600" />
                                        </div>
                                        <div>
                                            <div className="text-sm text-gray-500">Ubicación</div>
                                            <div className="font-medium">{event.venue}</div>
                                            <div className="text-sm text-gray-500">{event.location}</div>
                                        </div>
                                    </div>
                                </div>

                                <h2 className="mb-3 text-base font-semibold sm:text-lg">Descripción</h2>
                                <div className="prose prose-gray max-w-none">
                                    <p className="whitespace-pre-wrap">{event.description}</p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Event Days */}
                        {event.eventDays.length > 0 && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                                        <Clock className="h-5 w-5" />
                                        Días del Evento
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                                        {event.eventDays.map((day: EventDayItem) => (
                                            <div
                                                key={day.id}
                                                className="flex items-center justify-between rounded-lg bg-gray-50 p-2.5 sm:p-3"
                                            >
                                                <div>
                                                    <div className="font-medium">
                                                        {formatDate(day.date, { dateStyle: "full" })}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        {day.openTime} - {day.closeTime}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

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
                        <div className="space-y-6">
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


