import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { formatDateUTC, getTodayDateString } from "@/lib/qr"
import { getShiftOptionsForDate, normalizeShiftLabel, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import {
    getExpectedShiftForDate,
    getTicketScheduleSelectionsForAttendee,
    shiftsMatch,
} from "@/lib/ticket-shift"
import { ticketUsesPurchasedDates } from "@/lib/ticket-date-policy"
import {
    type ScanResultType,
    type ScanTicket,
    matchesToday,
    buildAttendanceSummary,
    generateEntitlements,
    isFixedTermMembership,
    getMembershipAccessStatus,
} from "@/lib/scan-helpers"

export const runtime = "nodejs"

const TICKET_CODE_REGEX = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/
const TICKET_CODE_COMPACT_REGEX = /^[A-Z2-9]{12}$/
const TICKET_CODE_GROUP_FINDER_REGEX = /([A-Z2-9]{4}(?:-[A-Z2-9]{4}){2})/i
const TICKET_CODE_COMPACT_FINDER_REGEX = /([A-Z2-9]{12})/i
const CUID_REGEX = /^c[a-z0-9]{24}$/i

function normalizeTicketCode(value?: string | null): string | null {
    if (!value) return null
    const upper = value.trim().toUpperCase()
    if (!upper) return null
    if (TICKET_CODE_REGEX.test(upper)) return upper

    const compact = upper.replace(/[^A-Z2-9]/g, "")
    if (!TICKET_CODE_COMPACT_REGEX.test(compact)) return null

    return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`
}

function extractTicketCodeCandidate(value?: string | null): string | null {
    if (!value) return null
    const direct = normalizeTicketCode(value)
    if (direct) return direct

    const upper = value.toUpperCase()
    const grouped = upper.match(TICKET_CODE_GROUP_FINDER_REGEX)?.[1]
    if (grouped) {
        const normalized = normalizeTicketCode(grouped)
        if (normalized) return normalized
    }

    const compact = upper.match(TICKET_CODE_COMPACT_FINDER_REGEX)?.[1]
    if (compact) {
        const normalized = normalizeTicketCode(compact)
        if (normalized) return normalized
    }

    return null
}

function normalizeTicketId(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed || !CUID_REGEX.test(trimmed)) return null
    return trimmed
}

function parseJsonObject(input: string): Record<string, unknown> | null {
    const trimmed = input.trim()
    if (!trimmed) return null

    const candidates = [trimmed]
    const firstBrace = trimmed.indexOf("{")
    const lastBrace = trimmed.lastIndexOf("}")
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
            }
        } catch {
            // Ignore invalid JSON candidate
        }
    }

    return null
}

function extractLookupFromUrl(input: string): { ticketCode?: string; ticketId?: string } | null {
    try {
        const url = new URL(input)
        const queryCode =
            extractTicketCodeCandidate(url.searchParams.get("ticketCode")) ??
            extractTicketCodeCandidate(url.searchParams.get("code")) ??
            extractTicketCodeCandidate(url.searchParams.get("ticket"))

        const queryId =
            normalizeTicketId(url.searchParams.get("ticketId")) ??
            normalizeTicketId(url.searchParams.get("id")) ??
            normalizeTicketId(url.searchParams.get("ticket"))

        if (queryCode || queryId) {
            return { ticketCode: queryCode ?? undefined, ticketId: queryId ?? undefined }
        }

        const pathSegments = url.pathname
            .split("/")
            .map((part) => decodeURIComponent(part))
            .filter(Boolean)
        const lastSegment = pathSegments[pathSegments.length - 1]
        const pathCode = extractTicketCodeCandidate(lastSegment)
        const pathId = normalizeTicketId(lastSegment)
        if (pathCode || pathId) {
            return { ticketCode: pathCode ?? undefined, ticketId: pathId ?? undefined }
        }
    } catch {
        // Not a URL
    }

    return null
}

function parseLookupCandidates(
    ticketCodeInput?: string,
    ticketIdInput?: string,
    rawInput?: string
): { ticketCodes: string[]; ticketId: string | null } {
    const ticketCodeSet = new Set<string>()
    let ticketId: string | null = normalizeTicketId(ticketIdInput)

    const addTicketCode = (value?: string | null) => {
        const normalized = extractTicketCodeCandidate(value)
        if (normalized) {
            ticketCodeSet.add(normalized)
        }
    }

    addTicketCode(ticketCodeInput)

    if (rawInput) {
        addTicketCode(rawInput)

        const fromUrl = extractLookupFromUrl(rawInput)
        if (fromUrl?.ticketCode) ticketCodeSet.add(fromUrl.ticketCode)
        if (!ticketId && fromUrl?.ticketId) ticketId = fromUrl.ticketId

        const parsedJson = parseJsonObject(rawInput)
        if (parsedJson) {
            addTicketCode(String(parsedJson.ticketCode ?? ""))
            addTicketCode(String(parsedJson.code ?? ""))
            addTicketCode(String(parsedJson.ticket ?? ""))

            if (!ticketId) {
                ticketId =
                    normalizeTicketId(parsedJson.ticketId) ??
                    normalizeTicketId(parsedJson.id) ??
                    normalizeTicketId(parsedJson.ticket)
            }
        }
    }

    if (!ticketId) {
        ticketId = normalizeTicketId(ticketCodeInput)
    }

    return {
        ticketCodes: Array.from(ticketCodeSet),
        ticketId,
    }
}

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
        const ticketCodeInput = typeof body.ticketCode === "string" ? body.ticketCode : undefined
        const ticketIdInput = typeof body.ticketId === "string" ? body.ticketId : undefined
        const rawInput = typeof body.rawInput === "string" ? body.rawInput : undefined
        const eventId = body.eventId as string | undefined
        const currentShift = normalizeShiftLabel(body.currentShift)
        // Forzado de ingreso de emergencia (Staff/Admin): omite la validación
        // estricta de día/turno para piscina libre. Queda registrado en el scan.
        const override = body.override === true

        if (!eventId) {
            return NextResponse.json(
                { success: false, error: "Datos incompletos" },
                { status: 400 }
            )
        }

        const { ticketCodes, ticketId } = parseLookupCandidates(ticketCodeInput, ticketIdInput, rawInput)
        if (!ticketId && ticketCodes.length === 0) {
            return NextResponse.json({
                success: false,
                valid: false,
                reason: "TICKET_NOT_FOUND",
                message: "Ticket no encontrado",
            })
        }

        const whereConditions = [
            ...(ticketId ? [{ id: ticketId }] : []),
            ...ticketCodes.map((ticketCode) => ({ ticketCode })),
        ]

        const ticket = await prisma.ticket.findFirst({
            where: {
                OR: whereConditions,
            },
            include: {
                event: true,
                ticketType: true,
                entitlements: true,
                membershipFreeze: true,
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

        const today = getTodayDateString()
        const todayDate = new Date(`${today}T12:00:00Z`)
        const fixedTermMembership = isFixedTermMembership(ticket)
        if (fixedTermMembership && !override) {
            const access = getMembershipAccessStatus(ticket, today)
            if (access.status === "BLACKOUT") {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", "Membresía en blackout (ene/feb)")
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "MEMBERSHIP_BLACKOUT",
                    message: "Tu membresía no aplica para enero y febrero por términos y condiciones.",
                })
            }
            if (access.status === "FROZEN") {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", "Membresía congelada")
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "MEMBERSHIP_FROZEN",
                    message: `Tu membresía está congelada del ${formatDmy(access.freeze?.startStr ?? "")} al ${formatDmy(lastValidDay(access.freeze?.endStr ?? ""))}.`,
                })
            }
            if (access.status === "NOT_STARTED") {
                await logScan(ticket.id, user.id, eventId, "EXPIRED", "Membresía aún no inicia")
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "MEMBERSHIP_NOT_STARTED",
                    message: `Tu membresía inicia el ${formatDmy(access.startStr)}.`,
                })
            }
            if (access.status === "EXPIRED") {
                await logScan(ticket.id, user.id, eventId, "EXPIRED", "Membresía vencida")
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "MEMBERSHIP_EXPIRED",
                    message: `Tu membresía venció el ${formatDmy(lastValidDay(access.expiryStr))}.`,
                })
            }
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

        // Para tickets por turno, el turno esperado viene de la compra.
        // Para full day, el turno es opcional, pero si se envia debe existir para el dia.
        // override (emergencia): se omite toda la validación de turno/hora.
        if (!override) {
        if (requiresShiftSelection) {
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
                    `Turno incorrecto. Esperado: ${expectedShift}`,
                    currentShift
                )
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "WRONG_SHIFT",
                    message: `Este ticket es valido para el turno "${expectedShift}".`,
                })
            }

            if (!configuredShifts.some((shiftOption) => shiftsMatch(shiftOption, currentShift))) {
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", `Turno no configurado: ${currentShift}`, currentShift)
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
                await logScan(ticket.id, user.id, eventId, "WRONG_DAY", `Turno no configurado: ${currentShift}`, currentShift)
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
                    `Turno incorrecto. Esperado: ${expectedShift}`,
                    currentShift
                )
                return NextResponse.json({
                    success: false,
                    valid: false,
                    reason: "WRONG_SHIFT",
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

        let scanCount = 0
        if (isPackageLike) {
            scanCount = await prisma.scan.count({
                where: { ticketId: ticket.id, result: "VALID" },
            })
        }

        const computeAttendance = () => {
            if (isPackageLike && packageLimit) {
                const shiftMultiplier = !requiresShiftSelection && hasMultipleShifts ? configuredShifts.length : 1
                const adjustedTotal = packageLimit * shiftMultiplier
                const usedEntitlements = ticket.entitlements.filter((item) => item.status === "USED").length
                const used = Math.max(usedEntitlements, scanCount)
                return { total: adjustedTotal, used, remaining: Math.max(adjustedTotal - used, 0) }
            }
            return buildAttendanceSummary(ticket)
        }

        let entitlement = ticket.entitlements.find((item) => matchesToday(item.date, today))

        // override (emergencia) permite reasignar el día comprado a hoy aun en piscina.
        if (!entitlement && (override || (!strictDateSchedule && !usesPurchasedDates))) {
            const availableEntitlement = ticket.entitlements.find((item) => item.status === "AVAILABLE")
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
                    const idx = ticket.entitlements.findIndex((item) => item.id === availableEntitlement.id)
                    if (idx >= 0) ticket.entitlements[idx] = entitlement
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
                    message: `No tiene ${clasesLabel} disponibles`,
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

            await logScan(ticket.id, user.id, eventId, "WRONG_DAY", "Sin derecho para hoy")
            return NextResponse.json({
                success: false,
                valid: false,
                reason: strictDateSchedule ? "WRONG_DAY" : "NO_CLASSES",
                message: strictDateSchedule
                    ? "Este ticket no es valido para hoy"
                    : `No tiene ${clasesLabel} disponibles`,
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
                        date: todayDate,
                    },
                    select: { shift: true },
                })

                const alreadyScannedThisShift = todayScans.some(
                    (scanItem) => shiftsMatch(scanItem.shift, currentShift)
                )

                if (!alreadyScannedThisShift) {
                    const usedAt = new Date()
                    await logScan(ticket.id, user.id, eventId, "VALID", undefined, currentShift)
                    if (isPackageLike) {
                        scanCount += 1
                    }

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
            currentShift
        )

        return NextResponse.json({
            success: true,
            valid: true,
            reason: "VALID",
            overridden: override,
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
        console.error("Manual scan lookup error:", error)
        return NextResponse.json(
            { success: false, error: "Error al buscar ticket" },
            { status: 500 }
        )
    }
}

function formatDmy(isoDate: string): string {
    const [y, m, d] = isoDate.split("-")
    if (!y || !m || !d) return isoDate
    return `${d}/${m}/${y}`
}

function lastValidDay(expiryExclusive: string): string {
    if (!expiryExclusive) return expiryExclusive
    const d = new Date(`${expiryExclusive}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return formatDateUTC(d)
}

async function logScan(
    ticketId: string,
    staffId: string,
    eventId: string,
    result: ScanResultType,
    notes?: string,
    shift?: string | null
) {
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
