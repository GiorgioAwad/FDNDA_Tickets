import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseQRPayload, verifySignature, getTodayDateString, formatDateUTC } from "@/lib/qr"
import { rateLimit } from "@/lib/rate-limit"
import {
    type ScanResultType,
    type ScanTicket,
    matchesToday,
    buildAttendanceSummary,
    generateEntitlements,
    isPackageLimitReached,
    isWithinEventRange as checkWithinEventRange,
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

        // Rate limiting para scanner: 60 escaneos por minuto por staff
        const { success: rateLimitOk } = await rateLimit(`scanner:${user.id}`, "scanner")
        if (!rateLimitOk) {
            return NextResponse.json(
                { success: false, error: "Demasiados escaneos. Espera un momento." },
                { status: 429 }
            )
        }

        const body = await request.json()
        const { qrData, eventId } = body

        if (!qrData || !eventId) {
            return NextResponse.json(
                { success: false, error: "Datos incompletos" },
                { status: 400 }
            )
        }

        // Parse QR payload
        const payload = parseQRPayload(qrData)

        if (!payload) {
            await logScan(null, user.id, eventId, "INVALID", "QR inválido o mal formado")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "INVALID",
                message: "Código QR inválido",
            })
        }

        // Verify signature
        if (!verifySignature(payload)) {
            await logScan(payload.ticketId, user.id, eventId, "INVALID", "Firma inválida")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "INVALID_SIGNATURE",
                message: "Código QR manipulado o inválido",
            })
        }

        // Check if ticket exists
        const ticket = await prisma.ticket.findUnique({
            where: { id: payload.ticketId },
            include: {
                event: true,
                ticketType: true,
                entitlements: true,
            },
        }) as ScanTicket | null

        if (!ticket) {
            await logScan(payload.ticketId, user.id, eventId, "INVALID", "Ticket no existe")
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


        const isPackage = Boolean(ticket.ticketType.isPackage)
        const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
        const packageLimit = isPackage
            ? (ticket.ticketType.packageDaysCount ?? (nameMatch ? Number(nameMatch[1]) : null))
            : null

        let scanCount = 0
        if (isPackage) {
            scanCount = await prisma.scan.count({
                where: { ticketId: ticket.id, result: "VALID" },
            })
        }

        const computeAttendance = () => {
            if (isPackage && packageLimit) {
                const usedEntitlements = ticket.entitlements.filter((item) => item.status === "USED").length
                const used = Math.max(usedEntitlements, scanCount)
                return { total: packageLimit, used, remaining: Math.max(packageLimit - used, 0) }
            }
            return buildAttendanceSummary(ticket)
        }

        // NOTA: Se eliminó validación estricta de días para permitir RECUPERACIONES
        // El asistente puede venir cualquier día mientras tenga clases disponibles
        const today = getTodayDateString()

        // Check entitlement for today (or create one if has available classes)
        let entitlement = ticket.entitlements.find(
            (e) => matchesToday(e.date, today)
        )

        // Si no tiene entitlement para hoy, buscar uno disponible (para recuperación)
        if (!entitlement) {
            const availableEntitlement = ticket.entitlements.find(e => e.status === "AVAILABLE")
            
            if (availableEntitlement) {
                // Usar el entitlement disponible para hoy (recuperación)
                entitlement = await prisma.ticketDayEntitlement.update({
                    where: { id: availableEntitlement.id },
                    data: { date: new Date(`${today}T00:00:00`) },
                })
                // Actualizar en memoria
                const idx = ticket.entitlements.findIndex(e => e.id === availableEntitlement.id)
                if (idx >= 0) ticket.entitlements[idx] = entitlement
            }
        }


        if (!entitlement && isPackage) {
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
            await logScan(ticket.id, user.id, eventId, "WRONG_DAY", "Sin clases disponibles")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "NO_CLASSES",
                message: "No tiene clases disponibles",
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

        // Log successful scan
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
        console.error("Scan validation error:", error)
        return NextResponse.json(
            { success: false, error: "Error al validar" },
            { status: 500 }
        )
    }
}

// ==================== HELPER FUNCTIONS ====================

async function logScan(
    ticketId: string | null,
    staffId: string,
    eventId: string,
    result: ScanResultType,
    notes?: string
) {
    if (!ticketId) return

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
