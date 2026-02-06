import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { getTodayDateString } from "@/lib/qr"
import {
    type ScanResultType,
    type ScanTicket,
    matchesToday,
    buildAttendanceSummary,
    generateEntitlements,
} from "@/lib/scan-helpers"

export const runtime = "nodejs"

// ==================== MAIN HANDLER ====================

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
        const ticketCode = (body.ticketCode as string | undefined)?.trim()
        const eventId = body.eventId as string | undefined

        if (!ticketCode || !eventId) {
            return NextResponse.json(
                { success: false, error: "Datos incompletos" },
                { status: 400 }
            )
        }

        const ticket = await prisma.ticket.findUnique({
            where: { ticketCode },
            include: {
                event: true,
                ticketType: true,
                entitlements: true,
            },
        }) as ScanTicket | null

        if (!ticket) {
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "TICKET_NOT_FOUND",
                message: "Ticket no encontrado",
            })
        }

        // Generate entitlements if missing
        const validDays = generateEntitlements(ticket)
        if (validDays.length > 0) {
            await prisma.ticketDayEntitlement.createMany({
                data: validDays.map((date) => ({
                    ticketId: ticket.id,
                    date,
                    status: "AVAILABLE",
                })),
                skipDuplicates: true,
            })

            ticket.entitlements = await prisma.ticketDayEntitlement.findMany({
                where: { ticketId: ticket.id },
                orderBy: { date: "asc" },
            })
        }

        // Check ticket status
        if (ticket.status !== "ACTIVE") {
            await logScan(ticket.id, user.id, eventId, "EXPIRED", `Estado: ${ticket.status}`)
            return NextResponse.json({
                success: false,
                valid: false,
                reason: ticket.status === "CANCELLED" ? "CANCELLED" : "EXPIRED",
                message: ticket.status === "CANCELLED" ? "Ticket cancelado" : "Ticket expirado",
            })
        }

        // Check if correct event
        if (ticket.eventId !== eventId) {
            await logScan(ticket.id, user.id, eventId, "WRONG_EVENT", "Evento incorrecto")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "WRONG_EVENT",
                message: "Este ticket es para otro evento",
            })
        }


        const today = getTodayDateString()
        const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
        const isPackageLike = Boolean(
            ticket.ticketType.isPackage || ticket.ticketType.packageDaysCount || nameMatch
        )
        const packageLimit = isPackageLike
            ? (ticket.ticketType.packageDaysCount ?? (nameMatch ? Number(nameMatch[1]) : null))
            : null

        let scanCount = 0
        if (isPackageLike) {
            scanCount = await prisma.scan.count({
                where: { ticketId: ticket.id, result: "VALID" },
            })
        }

        const computeAttendance = () => {
            if (isPackageLike && packageLimit) {
                const usedEntitlements = ticket.entitlements.filter((item) => item.status === "USED").length
                const used = Math.max(usedEntitlements, scanCount)
                return { total: packageLimit, used, remaining: Math.max(packageLimit - used, 0) }
            }
            return buildAttendanceSummary(ticket)
        }

        let entitlement = ticket.entitlements.find(
            (item) => matchesToday(item.date, today)
        )

        if (!entitlement) {
            const availableEntitlement = ticket.entitlements.find((item) => item.status === "AVAILABLE")
            if (availableEntitlement) {
                entitlement = await prisma.ticketDayEntitlement.update({
                    where: { id: availableEntitlement.id },
                    data: { date: new Date(`${today}T00:00:00`) },
                })
                const idx = ticket.entitlements.findIndex((item) => item.id === availableEntitlement.id)
                if (idx >= 0) ticket.entitlements[idx] = entitlement
            }
        }

        if (!entitlement && isPackageLike) {
            const attendance = computeAttendance()
            if (packageLimit && attendance.remaining <= 0) {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", "Sin clases disponibles")
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "NO_CLASSES",
                    message: "No tiene clases disponibles",
                    scannedAt: new Date().toISOString(),
                    attendance,
                })
            }

            entitlement = await prisma.ticketDayEntitlement.create({
                data: {
                    ticketId: ticket.id,
                    date: new Date(`${today}T00:00:00`),
                    status: "AVAILABLE",
                },
            })
            ticket.entitlements.push(entitlement)
        }

        if (!entitlement) {
            await logScan(ticket.id, user.id, eventId, "WRONG_DAY", "Sin derecho para hoy")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "WRONG_DAY",
                message: "Este ticket no es válido para hoy",
                scannedAt: new Date().toISOString(),
                attendance: computeAttendance(),
            })
        }

        // Check if already used today
        if (entitlement.status === "USED") {
            await logScan(ticket.id, user.id, eventId, "ALREADY_USED", "Ya usado hoy")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "ALREADY_USED",
                message: "Asistencia ya registrada hoy",
                ticket: {
                    id: ticket.id,
                    ticketCode: ticket.ticketCode,
                    attendeeName: ticket.attendeeName,
                    attendeeDni: ticket.attendeeDni,
                    eventTitle: ticket.event.title,
                    ticketTypeName: ticket.ticketType.name,
                    usedAt: entitlement.usedAt,
                },
                scannedAt: (entitlement.usedAt ?? new Date()).toISOString(),
                attendance: computeAttendance(),
            })
        }

        // Mark as used
        const usedAt = new Date()
        await prisma.ticketDayEntitlement.update({
            where: { id: entitlement.id },
            data: {
                status: "USED",
                usedAt,
            },
        })
        entitlement.status = "USED"
        entitlement.usedAt = usedAt

        await logScan(ticket.id, user.id, eventId, "VALID")

        return NextResponse.json({
            success: true,
            valid: true,
            reason: "VALID",
            message: "Asistencia registrada",
            ticket: {
                id: ticket.id,
                ticketCode: ticket.ticketCode,
                attendeeName: ticket.attendeeName,
                attendeeDni: ticket.attendeeDni,
                eventTitle: ticket.event.title,
                ticketTypeName: ticket.ticketType.name,
                entryDate: today,
            },
            scannedAt: usedAt.toISOString(),
            attendance: computeAttendance(),
        })
    } catch (error) {
        console.error("Manual scan lookup error:", error)
        return NextResponse.json(
            { success: false, error: "Error al buscar ticket" },
            { status: 500 }
        )
    }
}

// ==================== HELPER FUNCTIONS ====================

async function logScan(
    ticketId: string,
    staffId: string,
    eventId: string,
    result: ScanResultType,
    notes?: string
) {
    try {
        await prisma.scan.create({
            data: {
                ticketId,
                staffId,
                eventId,
                date: new Date(),
                result,
                notes,
            },
        })
    } catch (error) {
        console.error("Failed to log scan:", error)
    }
}
