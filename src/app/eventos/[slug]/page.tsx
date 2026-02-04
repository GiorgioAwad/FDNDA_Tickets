import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { formatDate } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import TicketPurchaseCard, { type TicketTypeClient } from "./TicketPurchaseCard"
import {
    Calendar,
    MapPin,
    Clock,
    Users,
    Waves,
    ArrowLeft,
} from "lucide-react"

export const dynamic = "force-dynamic"

interface EventPageProps {
    params: Promise<{ slug: string }>
}

type EventDayItem = {
    id: string
    date: Date
    openTime: string
    closeTime: string
    capacity: number
}

async function getEvent(slug: string) {
    const event = await prisma.event.findUnique({
        where: { slug },
        include: {
            eventDays: {
                orderBy: { date: "asc" },
            },
            ticketTypes: {
                where: { isActive: true },
                orderBy: { sortOrder: "asc" },
            },
        },
    })
    return event
}

export default async function EventDetailPage({ params }: EventPageProps) {
    const { slug } = await params
    const event = await getEvent(slug)

    if (!event || !event.isPublished) {
        notFound()
    }

    const ticketTypes: TicketTypeClient[] = event.ticketTypes.map((ticket) => ({
        id: ticket.id,
        name: ticket.name,
        description: ticket.description,
        price: Number(ticket.price),
        capacity: ticket.capacity,
        sold: ticket.sold,
        isPackage: ticket.isPackage,
        packageDaysCount: ticket.packageDaysCount,
    }))

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Hero */}
            <div className="relative h-64 md:h-96 bg-gradient-fdnda overflow-hidden">
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
                    <Image
                        src={event.bannerUrl}
                        alt={event.title}
                        fill
                        priority
                        sizes="100vw"
                        unoptimized
                        className="object-cover opacity-80"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Waves className="h-32 w-32 text-white/20" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                    <div className="container mx-auto">
                        <div className="flex flex-wrap gap-2 mb-3">
                            {event.discipline && (
                                <Badge className="bg-white/20 text-white border-0">
                                    {event.discipline}
                                </Badge>
                            )}
                        </div>

                        <h1 className="text-3xl md:text-4xl font-bold">{event.title}</h1>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Event Info */}
                        <Card>
                            <CardContent className="p-6">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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

                                <h2 className="text-lg font-semibold mb-3">Descripción</h2>
                                <div className="prose prose-gray max-w-none">
                                    <p className="whitespace-pre-wrap">{event.description}</p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Event Days */}
                        {event.eventDays.length > 0 && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Clock className="h-5 w-5" />
                                        Días del Evento
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {event.eventDays.map((day: EventDayItem) => (
                                            <div
                                                key={day.id}
                                                className="flex items-center justify-between p-3 rounded-lg bg-gray-50"
                                            >
                                                <div>
                                                    <div className="font-medium">
                                                        {formatDate(day.date, { dateStyle: "full" })}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        {day.openTime} - {day.closeTime}
                                                    </div>
                                                </div>
                                                {day.capacity > 0 && (
                                                    <Badge variant="secondary">
                                                        <Users className="h-3 w-3 mr-1" />
                                                        {day.capacity}
                                                    </Badge>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Sidebar - Tickets */}
                    <div className="space-y-6">
                        <TicketPurchaseCard
                            eventId={event.id}
                            eventTitle={event.title}
                            ticketTypes={ticketTypes}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}


