import { redirect, notFound } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { EventForm } from "@/components/admin/EventForm"
import { EventDashboard } from "@/components/admin/EventDashboard"
import { DuplicateEventButton } from "@/components/admin/DuplicateEventButton"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import type { TicketType } from "@prisma/client"
export const dynamic = "force-dynamic"

interface EditEventPageProps {
    params: Promise<{ id: string }>
}

export default async function EditEventPage({ params }: EditEventPageProps) {
    const user = await getCurrentUser()

    if (!user || user.role !== "ADMIN") {
        redirect("/")
    }

    const { id } = await params
    let event
    try {
        event = await prisma.event.findUnique({
            where: { id },
            include: {
                ticketTypes: {
                    include: {
                        dateInventories: {
                            orderBy: { date: "asc" },
                        },
                    },
                },
                eventDays: true,
            },
        })
    } catch (error) {
        console.error("[AdminEditEvent]", id, error)
        throw error
    }

    if (!event) {
        notFound()
    }

    const ticketTypeOptions = event.ticketTypes.map((ticketType: TicketType) => ({
        id: ticketType.id,
        name: ticketType.name,
    }))

    const serializedEvent = {
        ...event,
        advanceAmount: Number(event.advanceAmount),
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        ticketTypes: event.ticketTypes.map((ticketType) => ({
            ...ticketType,
            price: Number(ticketType.price),
            createdAt: ticketType.createdAt.toISOString(),
            updatedAt: ticketType.updatedAt.toISOString(),
            dateInventories: ticketType.dateInventories.map((inventory) => ({
                ...inventory,
                date: inventory.date.toISOString(),
                createdAt: inventory.createdAt.toISOString(),
                updatedAt: inventory.updatedAt.toISOString(),
            })),
        })),
        eventDays: event.eventDays.map((day) => ({
            ...day,
            date: day.date.toISOString(),
        })),
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" asChild>
                    <Link href="/admin/eventos" className="inline-flex items-center">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Volver
                    </Link>
                </Button>
                <DuplicateEventButton
                    eventId={event.id}
                    eventTitle={event.title}
                    eventStartDate={event.startDate.toISOString()}
                    eventEndDate={event.endDate.toISOString()}
                    eventCategory={event.category}
                />
            </div>
            <EventDashboard eventId={event.id} ticketTypes={ticketTypeOptions} />
            <EventForm initialData={serializedEvent} isEditing showBack={false} />
        </div>
    )
}

