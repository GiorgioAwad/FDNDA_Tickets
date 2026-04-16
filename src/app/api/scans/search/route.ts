import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import {
    type ScanTicket,
    buildAttendanceSummary,
    generateEntitlements,
    matchesToday,
} from "@/lib/scan-helpers"
import { getTodayDateString } from "@/lib/qr"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "STAFF")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const eventId = typeof body.eventId === "string" ? body.eventId.trim() : ""
        const query = typeof body.query === "string" ? body.query.trim() : ""

        if (!eventId) {
            return NextResponse.json(
                { success: false, error: "Evento requerido" },
                { status: 400 }
            )
        }

        if (query.length < 3) {
            return NextResponse.json(
                { success: false, error: "Ingresa al menos 3 caracteres" },
                { status: 400 }
            )
        }

        const tickets = await prisma.ticket.findMany({
            where: {
                eventId,
                status: "ACTIVE",
                OR: [
                    { attendeeDni: { contains: query } },
                    { attendeeName: { contains: query, mode: "insensitive" } },
                    { user: { dni: { contains: query } } },
                    { user: { name: { contains: query, mode: "insensitive" } } },
                ],
            },
            include: {
                event: true,
                ticketType: true,
                entitlements: { orderBy: { date: "asc" } },
                user: { select: { name: true, dni: true } },
            },
            take: 20,
            orderBy: { createdAt: "desc" },
        })

        const today = getTodayDateString()

        const results = await Promise.all(
            tickets.map(async (ticket) => {
                const scanTicket = ticket as unknown as ScanTicket

                // Generate entitlements if missing
                const validDays = generateEntitlements(scanTicket)
                if (validDays.length > 0) {
                    await prisma.ticketDayEntitlement.createMany({
                        data: validDays.map((date) => ({
                            ticketId: ticket.id,
                            date,
                            status: "AVAILABLE" as const,
                        })),
                        skipDuplicates: true,
                    })

                    scanTicket.entitlements = await prisma.ticketDayEntitlement.findMany({
                        where: { ticketId: ticket.id },
                        orderBy: { date: "asc" },
                    })
                }

                const attendance = buildAttendanceSummary(scanTicket)

                const todayEntitlement = scanTicket.entitlements.find((e) =>
                    matchesToday(e.date, today)
                )
                let todayStatus: "AVAILABLE" | "USED" | "NO_ENTITLEMENT" = "NO_ENTITLEMENT"
                if (todayEntitlement) {
                    todayStatus = todayEntitlement.status === "USED" ? "USED" : "AVAILABLE"
                } else if (attendance.remaining > 0) {
                    // Package tickets can create entitlements on the fly
                    todayStatus = "AVAILABLE"
                }

                return {
                    id: ticket.id,
                    ticketCode: ticket.ticketCode,
                    attendeeName: ticket.attendeeName || ticket.user?.name || null,
                    attendeeDni: ticket.attendeeDni || ticket.user?.dni || null,
                    ticketType: {
                        name: ticket.ticketType.name,
                        isPackage: ticket.ticketType.isPackage,
                    },
                    attendance,
                    todayStatus,
                }
            })
        )

        return NextResponse.json({ success: true, data: results })
    } catch (error) {
        console.error("Scan search error:", error)
        return NextResponse.json(
            { success: false, error: "Error al buscar tickets" },
            { status: 500 }
        )
    }
}
