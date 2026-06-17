import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseQRPayload, verifySignature, getTodayDateString } from "@/lib/qr"
import { getShiftOptionsForDate, normalizeShiftLabel, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import {
    getExpectedShiftForDate,
    getTicketScheduleSelectionsForAttendee,
    shiftsMatch,
} from "@/lib/ticket-shift"
import { canReassignToScanDate, ticketUsesPurchasedDates } from "@/lib/ticket-date-policy"
import { rateLimit } from "@/lib/rate-limit"
import {
    type ScanResultType,
    type ScanTicket,
    matchesToday,
    buildAttendanceSummary,
    buildMembershipMonthlySummary,
    generateEntitlements,
    isMembershipTicket,
    isWithinEventRange,
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
        // Forzado de ingreso de emergencia: omite la validación estricta de
        // día/turno para piscina libre (ej. el usuario no vino el día que compró).
        // Lo pueden activar Staff y Admin (la ruta ya exige STAFF+) y queda registrado.
        const override = body.override === true

        if (!qrData || !eventId) {
            return NextResponse.json(
                { success: false, error: "Datos incompletos" },
                { status: 400 }
            )
        }

        const payload = parseQRPayload(qrData)
        const today = getTodayDateString()
        const todayDate = new Date(`${today}T12:00:00Z`)

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

        const isPiscina = ticket.event?.category === "PISCINA_LIBRE"
        const clasesLabel = isPiscina ? "asistencias" : "clases"

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

        // Validación de fecha:
        // - Piscina libre conserva la validación estricta por fecha comprada (los cupos
        //   se controlan por día, no se puede ingresar otro día con el mismo ticket).
        // - El resto de eventos permite ingresar cualquier día dentro del rango del evento.
        //   Esto cubre el fallback "compró su entrada para un día pero asiste otro día".
        const withinEventRange = isWithinEventRange(ticket, today)
        if (isPiscina) {
            if (payload.date !== today && !override) {
                await logScan(ticket.id, user.id, eventId, "INVALID", "QR fuera de fecha")
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "QR_EXPIRED",
                    isPiscina: true,
                    message: "El QR no corresponde al dia de hoy. Abre tu ticket para actualizarlo.",
                })
            }
        } else if (!withinEventRange) {
            await logScan(ticket.id, user.id, eventId, "EXPIRED", "Fecha fuera del rango del evento")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "QR_EXPIRED",
                message: "El evento no esta activo en esta fecha.",
            })
        }

        const scheduleConfig = parseTicketScheduleConfig(ticket.ticketType.validDays)
        const strictDateSchedule = scheduleConfig.dates.length > 0
        const configuredShifts = getShiftOptionsForDate(scheduleConfig, today)
        const requiresShiftSelection = scheduleConfig.requireShiftSelection && configuredShifts.length > 0
        const hasMultipleShifts = configuredShifts.length > 1

        const scheduleSelections = await getTicketScheduleSelectionsForAttendee({
            orderId: ticket.orderId,
            ticketTypeId: ticket.ticketTypeId,
            attendeeName: ticket.attendeeName,
            attendeeDni: ticket.attendeeDni,
        })
        const usesPurchasedDates = ticketUsesPurchasedDates({
            eventCategory: ticket.event?.category,
            scheduleSelections,
        })
        const expectedShift = getExpectedShiftForDate(scheduleSelections, today)
        const qrShift = normalizeShiftLabel(payload.shift)

        // Para tickets por turno, el turno esperado viene de la compra.
        // Para full day, el turno es opcional, pero si se envia debe existir para el dia.
        // override (emergencia): se omite toda la validación de turno/hora.
        if (!override) {
        if (requiresShiftSelection) {
            if (qrShift && expectedShift && !shiftsMatch(qrShift, expectedShift)) {
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
                    message: expectedShift
                        ? `Selecciona el turno actual (${expectedShift}) para validar este ticket.`
                        : `Selecciona el turno actual para validar este ticket.`,
                })
            }

            if (expectedShift && !shiftsMatch(currentShift, expectedShift)) {
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

            if (!configuredShifts.some((shiftOption) => shiftsMatch(shiftOption, currentShift))) {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", `Turno no configurado: ${currentShift}`)
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "WRONG_SHIFT",
                    message: `Este turno no esta configurado para este dia.`,
                })
            }
        } else if (hasMultipleShifts && currentShift) {
            const isValidShift = configuredShifts.some((shiftOption) =>
                shiftsMatch(shiftOption, currentShift)
            )
            if (!isValidShift) {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", `Turno no configurado: ${currentShift}`)
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "WRONG_SHIFT",
                    message: `Este turno no esta configurado para este dia.`,
                })
            }
        } else if (expectedShift) {
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
                    isPiscina,
                    message: `Este ticket es valido para el turno "${expectedShift}".`,
                })
            }
        }
        }

        const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
        let isPackageLike = Boolean(
            ticket.ticketType.isPackage || ticket.ticketType.packageDaysCount || nameMatch
        )
        let packageLimit = isPackageLike
            ? (ticket.ticketType.packageDaysCount ?? (nameMatch ? Number(nameMatch[1]) : null))
            : null

        // Piscina libre: tratar como paquete de 1 asistencia
        if (isPiscina) {
            isPackageLike = true
            packageLimit = 1
        }

        // Membresías: el cupo es por mes (reinicio sin acumular). Se comporta como
        // paquete, pero el "límite" y las clases usadas se cuentan dentro del mes
        // en curso (ver computeAttendance + buildMembershipMonthlySummary).
        const isMembership = isMembershipTicket(ticket)
        if (isMembership) {
            isPackageLike = true
            packageLimit = ticket.ticketType.monthlyClassLimit ?? null
        }
        const noClassesMessage = isMembership
            ? "Cupo mensual de clases agotado"
            : `No tiene ${clasesLabel} disponibles`

        // Scans validos previos del ticket. En tickets full-day (varios turnos por dia)
        // cada turno escaneado es una entrada independiente, asi que contamos por scans,
        // no por dias/entitlements.
        const multiShiftAttendance = !requiresShiftSelection && hasMultipleShifts
        let scanCount = await prisma.scan.count({
            where: { ticketId: ticket.id, result: "VALID" },
        })

        const computeAttendance = () => {
            // Membresía: cupo del mes en curso (las clases de meses anteriores no
            // descuentan del mes actual).
            if (isMembership) {
                return buildMembershipMonthlySummary(ticket, today)
            }
            const shiftMultiplier = multiShiftAttendance ? configuredShifts.length : 1
            if (isPackageLike && packageLimit) {
                const adjustedTotal = packageLimit * shiftMultiplier
                const usedEntitlements = ticket.entitlements.filter((item) => item.status === "USED").length
                const used = Math.max(usedEntitlements, scanCount)
                return { total: adjustedTotal, used, remaining: Math.max(adjustedTotal - used, 0) }
            }
            const summary = buildAttendanceSummary(ticket)
            if (multiShiftAttendance) {
                const used = Math.max(summary.used, scanCount)
                return { total: summary.total, used, remaining: Math.max(summary.total - used, 0) }
            }
            return summary
        }

        // Buscar entitlement para hoy
        let entitlement = ticket.entitlements.find((e) => matchesToday(e.date, today))

        // Reasignacion automatica: se permite en tickets flexibles y, como fallback,
        // en cualquier ticket (salvo piscina libre) que se escanee dentro del rango del
        // evento. Asi, si el comprador eligio un dia pero asiste otro, su entrada
        // disponible se mueve al dia del escaneo y se contabiliza alli.
        const canReassign =
            canReassignToScanDate({
                strictDateSchedule,
                isPackageLike,
                usesPurchasedDates,
            }) || (!isPiscina && withinEventRange) || override
        if (!entitlement && canReassign) {
            const availableEntitlement = ticket.entitlements.find((e) => e.status === "AVAILABLE")

            if (availableEntitlement) {
                const reassignedDate = todayDate
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

        if (!entitlement && isPackageLike && (override || (!strictDateSchedule && !usesPurchasedDates))) {
            const attendance = computeAttendance()
            if (packageLimit && attendance.remaining <= 0) {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", `Sin ${clasesLabel} disponibles`)
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "NO_CLASSES",
                    message: noClassesMessage,
                    scannedAt: new Date().toISOString(),
                    attendance,
                })
            }

            entitlement = await prisma.ticketDayEntitlement.create({
                data: {
                    ticketId: ticket.id,
                    date: todayDate,
                    status: "AVAILABLE",
                },
            })
            ticket.entitlements.push(entitlement)
        }

        if (!entitlement) {
            const attendance = computeAttendance()
            if (packageLimit && attendance.remaining <= 0) {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", `Sin ${clasesLabel} disponibles`)
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "NO_CLASSES",
                    message: `No tiene ${clasesLabel} disponibles`,
                    scannedAt: new Date().toISOString(),
                    attendance,
                })
            }

            const wrongDayMessage = strictDateSchedule
                ? "Este ticket no es valido para hoy"
                : noClassesMessage
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
            if (!requiresShiftSelection && hasMultipleShifts && currentShift) {
                const todayScans = await prisma.scan.findMany({
                    where: {
                        ticketId: ticket.id,
                        result: "VALID",
                        date: entitlement.date,
                    },
                    select: { shift: true },
                })

                const alreadyScannedThisShift = todayScans.some(
                    (scanItem) => shiftsMatch(scanItem.shift, currentShift)
                )

                if (!alreadyScannedThisShift) {
                    // Turno diferente, permitir scan
                    const usedAt = new Date()
                    await logScan(ticket.id, user.id, eventId, "VALID", undefined, currentShift, entitlement.date)
                    scanCount += 1

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
                message: hasMultipleShifts && currentShift
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

        await logScan(
            ticket.id,
            user.id,
            eventId,
            "VALID",
            override ? "OVERRIDE emergencia (fuera de dia/turno)" : undefined,
            currentShift,
            entitlement.date
        )

        return NextResponse.json({
            success: true,
            valid: true,
            reason: "VALID",
            overridden: override,
            isMembership,
            message: override ? "Asistencia registrada (ingreso forzado)" : "Asistencia registrada",
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
    shift?: string | null,
    scanDate?: Date | null
) {
    if (!ticketId) return

    try {
        await prisma.scan.create({
            data: {
                ticketId,
                staffId,
                eventId,
                // `date` es el DÍA de la entrada consumida (no el timestamp del escaneo,
                // que vive en `scannedAt`). Guardar el día del entitlement evita el
                // desfase de zona horaria que dejaba los cuadros del carnet en 0 e
                // inflaba el total con entitlements fantasma.
                date: scanDate ?? new Date(),
                result,
                shift: shift || null,
                notes,
            },
        })
    } catch (error) {
        console.error("Failed to log scan:", error)
    }
}
