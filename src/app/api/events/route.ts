import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseDateOnly } from "@/lib/utils"
import { getCachedPublishedEvents, onEventUpdated } from "@/lib/cached-queries"
import slugify from "slugify"
export const runtime = "nodejs"

type TicketTypePayload = {
    name: string
    price: number | string
    capacity: number | string
    isPackage?: boolean
    packageDaysCount?: number | string | null
    validDays?: string[]
}

type EventDayPayload = {
    date: string | Date
    openTime: string
    closeTime: string
    capacity: number | string
}

type EventPayload = {
    title: string
    description: string
    location: string
    venue: string
    startDate: string | Date
    endDate: string | Date
    mode: "RANGE" | "DAYS"
    isPublished?: boolean
    bannerUrl?: string
    discipline?: string
    ticketTypes?: TicketTypePayload[]
    eventDays?: EventDayPayload[]
}

// GET /api/events - List events (public or admin)
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const isAdmin = searchParams.get("admin") === "true"

        // If admin request, verify role
        if (isAdmin) {
            const user = await getCurrentUser()
            if (!user || !hasRole(user.role, "ADMIN")) {
                return NextResponse.json(
                    { success: false, error: "No autorizado" },
                    { status: 401 }
                )
            }

            // Admin: fetch fresh data (no cache)
            const events = await prisma.event.findMany({
                include: {
                    ticketTypes: true,
                    _count: {
                        select: { tickets: true },
                    },
                },
                orderBy: { startDate: "asc" },
            })

            return NextResponse.json({
                success: true,
                data: events,
            })
        }

        // Public: use cached data
        const cachedEvents = await getCachedPublishedEvents()

        return NextResponse.json({
            success: true,
            data: cachedEvents,
        })
    } catch (error) {
        console.error("Error fetching events:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener eventos" },
            { status: 500 }
        )
    }
}

// POST /api/events - Create event (Admin only)
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json() as EventPayload
        const {
            title,
            description,
            location,
            venue,
            startDate,
            endDate,
            mode,
            isPublished,
            bannerUrl,
            discipline,
            ticketTypes, // Optional array of ticket types to create
            eventDays,   // Optional array of days to create
        } = body

        // Generate slug
        let slug = slugify(title, { lower: true, strict: true })

        // Ensure unique slug
        let count = 0
        while (await prisma.event.findUnique({ where: { slug } })) {
            count++
            slug = `${slugify(title, { lower: true, strict: true })}-${count}`
        }

        // Create event with nested relations if provided
        const event = await prisma.event.create({
            data: {
                title,
                slug,
                description,
                location,
                venue,
                startDate: parseDateOnly(startDate),
                endDate: parseDateOnly(endDate),
                mode,
                isPublished,
                bannerUrl,
                discipline,
                createdBy: user.id,
                ticketTypes: ticketTypes
                    ? {
                        create: ticketTypes.map((ticketType) => {
                            const packageDaysCountRaw = ticketType.packageDaysCount
                            const packageDaysCount =
                                packageDaysCountRaw === undefined ||
                                    packageDaysCountRaw === null ||
                                    packageDaysCountRaw === ""
                                    ? null
                                    : Number(packageDaysCountRaw)

                            return {
                                name: ticketType.name,
                                price: Number(ticketType.price),
                                capacity: Number(ticketType.capacity),
                                isPackage: ticketType.isPackage || false,
                                packageDaysCount: Number.isNaN(packageDaysCount)
                                    ? null
                                    : packageDaysCount,
                                validDays: ticketType.validDays || [],
                            }
                        }),
                    }
                    : undefined,
                eventDays: eventDays
                    ? {
                        create: eventDays.map((day) => ({
                            date: parseDateOnly(day.date),
                            openTime: day.openTime,
                            closeTime: day.closeTime,
                            capacity: Number(day.capacity),
                        })),
                    }
                    : undefined,
            },
            include: {
                ticketTypes: true,
                eventDays: true,
            },
        })

        return NextResponse.json({
            success: true,
            data: event,
        })
    } catch (error) {
        console.error("Error creating event:", error)
        return NextResponse.json(
            { success: false, error: "Error al crear evento" },
            { status: 500 }
        )
    }
}

