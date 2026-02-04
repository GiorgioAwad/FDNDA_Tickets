import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { createQRPayload, generateQRDataURL, formatDateLocal, formatDateUTC } from "@/lib/qr"
import { getDaysBetween } from "@/lib/utils"
export const runtime = "nodejs"

type TicketEntitlement = {
    date: Date
}

const getWeekdayIndexes = (label: string) => {
    const map: Record<string, number> = {
        L: 1, // Monday
        M: 2, // Tuesday
        X: 3, // Wednesday
        J: 4, // Thursday
        V: 5, // Friday
        S: 6, // Saturday
        D: 0, // Sunday
    }
    return label
        .split("-")
        .map((part) => map[part.toUpperCase()])
        .filter((val) => val !== undefined)
}

const extractDaysLabel = (name: string) => {
    const match = name.match(/Turno\s+([LMDXVJS-]+)/i) || name.match(/\b([LMDXVJS](?:-[LMDXVJS]){1,6})\b/i)
    return match?.[1]?.toUpperCase() ?? null
}

const buildValidDaysFromLabel = (start: Date, end: Date, label: string) => {
    const days = getWeekdayIndexes(label)
    if (!days.length) return []
    const results: Date[] = []
    const current = new Date(start)
    current.setHours(0, 0, 0, 0)
    const endDate = new Date(end)
    endDate.setHours(0, 0, 0, 0)

    while (current <= endDate) {
        if (days.includes(current.getDay())) {
            results.push(new Date(current))
        }
        current.setDate(current.getDate() + 1)
    }
    return results
}

// GET /api/tickets/[id] - Get single ticket with QR
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params
        const { searchParams } = new URL(request.url)
        const dateParam = searchParams.get("date")

        const ticket = await prisma.ticket.findFirst({
            where: {
                OR: [{ id }, { ticketCode: id }],
                userId: user.id,
            },
            include: {
                event: true,
                ticketType: true,
                entitlements: {
                    orderBy: { date: "asc" },
                },
                order: {
                    select: {
                        id: true,
                        status: true,
                        paidAt: true,
                        user: {
                            select: {
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
                courtesyInfo: true,
            },
        })

        if (!ticket) {
            return NextResponse.json(
                { success: false, error: "Ticket no encontrado" },
                { status: 404 }
            )
        }

        let entitlements = ticket.entitlements
        const isPackageTicket = ticket.ticketType.isPackage
        const packageDaysCount = ticket.ticketType.packageDaysCount ?? null

        if (!ticket.ticketType.isPackage && entitlements.length === 0 && ticket.event?.startDate && ticket.event?.endDate) {
            let validDays: Date[] = []

            if (Array.isArray(ticket.ticketType.validDays)) {
                validDays = (ticket.ticketType.validDays as string[]).map((date) => new Date(date))
            } else {
                const label = extractDaysLabel(ticket.ticketType.name)
                validDays = label
                    ? buildValidDaysFromLabel(ticket.event.startDate, ticket.event.endDate, label)
                    : getDaysBetween(ticket.event.startDate, ticket.event.endDate)
            }

            if (validDays.length) {
                await prisma.ticketDayEntitlement.createMany({
                    data: validDays.map((date) => ({
                        ticketId: ticket.id,
                        date,
                        status: "AVAILABLE",
                    })),
                    skipDuplicates: true,
                })

                entitlements = await prisma.ticketDayEntitlement.findMany({
                    where: { ticketId: ticket.id },
                    orderBy: { date: "asc" },
                })
            }
        }

        const scans = await prisma.scan.findMany({
            where: {
                ticketId: ticket.id,
                result: "VALID",
            },
            select: {
                date: true,
                scannedAt: true,
            },
            orderBy: { scannedAt: "asc" },
        })
        const scanCount = scans.length

        if (scans.length) {
            for (const scan of scans) {
                await prisma.ticketDayEntitlement.upsert({
                    where: {
                        ticketId_date: {
                            ticketId: ticket.id,
                            date: scan.date,
                        },
                    },
                    update: {
                        status: "USED",
                        usedAt: scan.scannedAt,
                    },
                    create: {
                        ticketId: ticket.id,
                        date: scan.date,
                        status: "USED",
                        usedAt: scan.scannedAt,
                    },
                })
            }

            entitlements = await prisma.ticketDayEntitlement.findMany({
                where: { ticketId: ticket.id },
                orderBy: { date: "asc" },
            })
        }

        let entitlementDates = entitlements
            .map((entitlement: TicketEntitlement) => formatDateUTC(entitlement.date))
            .sort()

        if (entitlementDates.length === 0 && ticket.event?.startDate && ticket.event?.endDate) {
            const fallbackDates = getDaysBetween(ticket.event.startDate, ticket.event.endDate)
            entitlementDates = fallbackDates.map((date) => date.toISOString().split("T")[0])
        }

        // Generate QR for the specified date (or today)
        let qrDate = dateParam ? new Date(dateParam) : new Date()
        qrDate.setHours(0, 0, 0, 0)

        // Check if this date is valid for the ticket
        let dateStr = formatDateLocal(qrDate)
        const usedCount = entitlements.filter((item) => item.status === "USED").length
        const isPackage = isPackageTicket && packageDaysCount
        const eventStart = ticket.event?.startDate ? formatDateLocal(ticket.event.startDate) : null
        const eventEnd = ticket.event?.endDate ? formatDateLocal(ticket.event.endDate) : null
        const isWithinEventRange = eventStart && eventEnd ? dateStr >= eventStart && dateStr <= eventEnd : true
        let hasEntitlement = isPackage
            ? isWithinEventRange && usedCount < packageDaysCount!
            : entitlementDates.includes(dateStr)

        if (!isPackage && !hasEntitlement && !dateParam && entitlementDates.length > 0) {
            const nextEntitlement =
                entitlementDates.find((entitlement) => entitlement >= dateStr) ??
                entitlementDates[0]
            qrDate = new Date(nextEntitlement)
            qrDate.setHours(0, 0, 0, 0)
            dateStr = nextEntitlement
            hasEntitlement = true
        }

        let qrDataUrl: string | null = null

        if (hasEntitlement && ticket.status === "ACTIVE") {
            const qrPayload = createQRPayload(
                ticket.id,
                ticket.eventId,
                ticket.userId,
                ticket.ticketCode,
                qrDate
            )
            qrDataUrl = await generateQRDataURL(qrPayload)
        }

        return NextResponse.json({
            success: true,
            data: {
                ...ticket,
                entitlements,
                scanCount,
                qrDataUrl,
                qrDate: dateStr,
            },
        })
    } catch (error) {
        console.error("Error fetching ticket:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener ticket" },
            { status: 500 }
        )
    }
}

