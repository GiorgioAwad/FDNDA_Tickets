import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseQRPayload, verifySignature, getTodayDateString } from "@/lib/qr"
import { extractTicketValidDates, extractTicketShiftOptions, normalizeShiftLabel } from "@/lib/ticket-schedule"
import {
    getExpectedShiftForDate,
    getTicketScheduleSelectionsForAttendee,
    shiftsMatch,
} from "@/lib/ticket-shift"
import { rateLimit } from "@/lib/rate-limit"
import {
    type ScanResultType,
    type ScanTicket,
    matchesToday,
    buildAttendanceSummary,
    generateEntitlements,
} from "@/lib/scan-helpers"

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
        const currentShift = normalizeShiftLabel(body.currentShift)

        if (!qrData || !eventId) {
            return NextResponse.json(
                { success: false, error: "Datos incompletos" },
                { status: 400 }
            )
        }

        const payload = parseQRPayload(qrData)
        const today = getTodayDateString()

        if (!payload) {
            await logScan(null, user.id, eventId, "INVALID", "QR invalido o mal formado")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "INVALID",
                message: "Codigo QR invalido",
            })
        }

        if (!verifySignature(payload)) {
            await logScan(payload.ticketId, user.id, eventId, "INVALID", "Firma invalida")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "INVALID_SIGNATURE",
                message: "Codigo QR manipulado o invalido",
            })
        }

        if (payload.date !== today) {
            await logScan(payload.ticketId, user.id, eventId, "INVALID", "QR fuera de fecha")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "QR_EXPIRED",
                message: "El QR no corresponde al dia de hoy. Abre tu ticket para actualizarlo.",
            })
        }

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

        if (ticket.status !== "ACTIVE") {
            await logScan(ticket.id, user.id, eventId, "EXPIRED", `Estado: ${ticket.status}`)
            return NextResponse.json({
                success: false,
                valid: false,
                reason: ticket.status === "CANCELLED" ? "CANCELLED" : "EXPIRED",
                message: ticket.status === "CANCELLED" ? "Ticket cancelado" : "Ticket expirado",
            })
        }

        if (ticket.eventId !== eventId) {
            await logScan(ticket.id, user.id, eventId, "WRONG_EVENT", "Evento incorrecto")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "WRONG_EVENT",
                message: "Este ticket es para otro evento",
            })
        }

        const strictDateSchedule = extractTicketValidDates(ticket.ticketType.validDays).length > 0
        const configuredShifts = extractTicketShiftOptions(ticket.ticketType.validDays)
        const hasMultipleShifts = configuredShifts.length > 1

        const scheduleSelections = await getTicketScheduleSelectionsForAttendee({
            orderId: ticket.orderId,
            ticketTypeId: ticket.ticketTypeId,
            attendeeName: ticket.attendeeName,
            attendeeDni: ticket.attendeeDni,
        })
        const expectedShift = getExpectedShiftForDate(scheduleSelections, today)
        const qrShift = normalizeShiftLabel(payload.shift)

        // Para tickets con multiples turnos: validar que el turno seleccionado
        // en el scanner sea uno de los configurados (permite un scan por turno)
        if (hasMultipleShifts) {
            if (!currentShift) {
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "SHIFT_REQUIRED",
                    message: `Selecciona el turno actual para validar este ticket.`,
                })
            }

            const isValidShift = configuredShifts.some(
                (s) => normalizeShiftLabel(s)?.toLowerCase() === currentShift?.toLowerCase()
            )
            if (!isValidShift) {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", `Turno no configurado: ${currentShift}`)
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "WRONG_SHIFT",
                    message: `Este turno no esta configurado para este tipo de ticket.`,
                })
            }
        } else if (expectedShift) {
            // Ticket con un solo turno: validar contra el turno esperado
            if (qrShift && !shiftsMatch(qrShift, expectedShift)) {
                await logScan(ticket.id, user.id, eventId, "INVALID", "Turno del QR no coincide")
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "INVALID_SHIFT",
                    message: "El QR no coincide con el turno configurado para este ticket.",
                })
            }

            if (!currentShift) {
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "SHIFT_REQUIRED",
                    message: `Selecciona el turno actual (${expectedShift}) para validar este ticket.`,
                })
            }

            if (!shiftsMatch(currentShift, expectedShift)) {
                await logScan(
                    ticket.id,
                    user.id,
                    eventId,
                    "WRONG_DAY",
                    `Turno incorrecto. Esperado: ${expectedShift}`
                )
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "WRONG_SHIFT",
                    message: `Este ticket es valido para el turno "${expectedShift}".`,
                })
            }
        }

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

        // Buscar entitlement para hoy
        let entitlement = ticket.entitlements.find((e) => matchesToday(e.date, today))

        // Reasignacion automatica: para paquetes siempre se permite reasignar
        // un entitlement AVAILABLE al dia de hoy; para tickets sin calendario
        // estricto tambien se permite.
        const canReassign = !strictDateSchedule || isPackageLike
        if (!entitlement && canReassign) {
            const availableEntitlement = ticket.entitlements.find((e) => e.status === "AVAILABLE")

            if (availableEntitlement) {
                const reassignedDate = new Date(`${today}T00:00:00`)
                const moved = await prisma.ticketDayEntitlement.updateMany({
                    where: {
                        id: availableEntitlement.id,
                        status: "AVAILABLE",
                    },
                    data: { date: reassignedDate },
                })

                if (moved.count > 0) {
                    entitlement = {
                        ...availableEntitlement,
                        date: reassignedDate,
                    }
                    const idx = ticket.entitlements.findIndex((e) => e.id === availableEntitlement.id)
                    if (idx >= 0) {
                        ticket.entitlements[idx] = entitlement
                    }
                } else {
                    const latestEntitlement = await prisma.ticketDayEntitlement.findUnique({
                        where: { id: availableEntitlement.id },
                    })
                    if (latestEntitlement) {
                        entitlement = latestEntitlement
                    }
                }
            }
        }

        if (!entitlement && isPackageLike && !strictDateSchedule) {
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

            const wrongDayMessage = strictDateSchedule
                ? "Este ticket no es valido para hoy"
                : "No tiene clases disponibles"
            await logScan(ticket.id, user.id, eventId, "WRONG_DAY", wrongDayMessage)
            return NextResponse.json({
                success: false,
                valid: false,
                reason: strictDateSchedule ? "WRONG_DAY" : "NO_CLASSES",
                message: wrongDayMessage,
                scannedAt: new Date().toISOString(),
                attendance,
            })
        }

        if (entitlement.status === "USED") {
            // Si hay multiples turnos, permitir un scan por cada turno distinto
            if (hasMultipleShifts && currentShift) {
                const todayScans = await prisma.scan.findMany({
                    where: {
                        ticketId: ticket.id,
                        result: "VALID",
                        date: new Date(`${today}T00:00:00`),
                    },
                    select: { shift: true },
                })

                const scannedShifts = todayScans
                    .map((s) => s.shift)
                    .filter(Boolean)
                    .map((s) => normalizeShiftLabel(s!))

                const currentShiftNorm = normalizeShiftLabel(currentShift)
                const alreadyScannedThisShift = scannedShifts.some(
                    (s) => s === currentShiftNorm
                )

                if (!alreadyScannedThisShift) {
                    // Turno diferente, permitir scan
                    const usedAt = new Date()
                    await logScan(ticket.id, user.id, eventId, "VALID", undefined, currentShift)

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
                }
            }

            await logScan(ticket.id, user.id, eventId, "ALREADY_USED", "Ya usado hoy", currentShift)
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "ALREADY_USED",
                message: hasMultipleShifts
                    ? "Ya registrado en este turno"
                    : "Asistencia ya registrada hoy",
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

        const usedAt = new Date()
        const markUsed = await prisma.ticketDayEntitlement.updateMany({
            where: {
                id: entitlement.id,
                status: "AVAILABLE",
            },
            data: {
                status: "USED",
                usedAt,
            },
        })

        if (markUsed.count === 0) {
            const latest = await prisma.ticketDayEntitlement.findUnique({
                where: { id: entitlement.id },
                select: { usedAt: true },
            })

            await logScan(ticket.id, user.id, eventId, "ALREADY_USED", "Ya usado por otro scanner", currentShift)
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
                    usedAt: latest?.usedAt ?? null,
                },
                scannedAt: (latest?.usedAt ?? new Date()).toISOString(),
                attendance: computeAttendance(),
            })
        }

        entitlement.status = "USED"
        entitlement.usedAt = usedAt

        await logScan(ticket.id, user.id, eventId, "VALID", undefined, currentShift)

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

async function logScan(
    ticketId: string | null,
    staffId: string,
    eventId: string,
    result: ScanResultType,
    notes?: string,
    shift?: string | null
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
                shift: shift || null,
                notes,
            },
        })
    } catch (error) {
        console.error("Failed to log scan:", error)
    }
}
