import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { createQRPayload, generateQRDataURL, formatDateLocal, formatDateUTC, getTodayDateString } from "@/lib/qr"
import { getDaysBetween, parseDateOnly } from "@/lib/utils"
import { extractTicketValidDates, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import { getExpectedShiftForDate, getTicketScheduleSelectionsForAttendee } from "@/lib/ticket-shift"
import { logTicketIssuance } from "@/lib/ticket-issuance-log"
import {
    getPurchasedDateKeys,
    pickQrDateForTicket,
    ticketUsesPurchasedDates,
} from "@/lib/ticket-date-policy"
import { getMembershipPeriod, getMembershipExpiry } from "@/lib/scan-helpers"
import {
    getMembershipScheduleProfile,
    parseMembershipScheduleSelection,
    getEffectiveMembershipSchedule,
    scheduleSelectionToInput,
    formatScheduleSummary,
} from "@/lib/membership-schedule"
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
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))

    while (current <= endDate) {
        if (days.includes(current.getUTCDay())) {
            results.push(new Date(current))
        }
        current.setUTCDate(current.getUTCDate() + 1)
    }
    return results
}

// GET /api/tickets/[id] - Get single ticket with QR
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: rawId } = await params
    const { searchParams } = new URL(request.url)
    const dateParam = searchParams.get("date")

    try {
        const user = await getCurrentUser()

        if (!user) {
            await logTicketIssuance({
                outcome: "UNAUTHORIZED",
                reason: "Sesión no autenticada al solicitar QR",
                ticketId: rawId,
                requestedDate: dateParam,
                request,
            })
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const id = rawId

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
                monthlySchedules: { select: { monthIndex: true, selection: true } },
            },
        })

        if (!ticket) {
            await logTicketIssuance({
                outcome: "TICKET_NOT_FOUND",
                reason: `No existe ticket con id/code "${rawId}" para el usuario ${user.id}`,
                ticketId: rawId,
                userId: user.id,
                requestedDate: dateParam,
                request,
            })
            return NextResponse.json(
                { success: false, error: "Ticket no encontrado" },
                { status: 404 }
            )
        }

        let entitlements = ticket.entitlements
        const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
        const isPiscina = ticket.event?.category === "PISCINA_LIBRE"
        const isMembership =
            ticket.ticketType.monthlyClassLimit != null && ticket.ticketType.monthlyClassLimit > 0
        let isPackageLike = Boolean(
            ticket.ticketType.isPackage || ticket.ticketType.packageDaysCount || nameMatch
        )
        let packageDaysCount = ticket.ticketType.packageDaysCount ?? (nameMatch ? Number(nameMatch[1]) : null)

        // Piscina libre: tratar como paquete de 1 asistencia
        if (isPiscina) {
            isPackageLike = true
            packageDaysCount = 1
        }

        // Membresía: el cupo es el mensual y NO se pre-generan entitlements (se
        // crean al vuelo en el escaneo). El "usado" se cuenta dentro del mes en curso.
        if (isMembership) {
            isPackageLike = true
            packageDaysCount = ticket.ticketType.monthlyClassLimit ?? null
        }

        if (!isPackageLike && entitlements.length === 0 && ticket.event?.startDate && ticket.event?.endDate) {
            let validDays: Date[] = []
            const explicitValidDates = extractTicketValidDates(ticket.ticketType.validDays)

            if (explicitValidDates.length > 0) {
                validDays = explicitValidDates.map((date) => new Date(date))
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
                shift: true,
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

        const scheduleSelections = await getTicketScheduleSelectionsForAttendee({
            orderId: ticket.orderId,
            ticketTypeId: ticket.ticketTypeId,
            attendeeName: ticket.attendeeName,
            attendeeDni: ticket.attendeeDni,
        })

        const todayStr = getTodayDateString()
        const usesPurchasedDates = ticketUsesPurchasedDates({
            eventCategory: ticket.event?.category,
            scheduleSelections,
        })
        const selectedQrDate = pickQrDateForTicket({
            dateParam,
            today: todayStr,
            scheduleSelections,
            entitlements,
            usePurchasedDates: usesPurchasedDates,
        })

        // Generate QR for the requested date, purchased date, or today.
        let qrDate = parseDateOnly(selectedQrDate ?? todayStr)

        // Check if this date is valid for the ticket
        let dateStr = formatDateUTC(qrDate)
        // Membresía: solo cuentan las clases usadas dentro del mes en curso
        // (reinicio sin acumular). El ciclo se ancla a la fecha de inicio elegida
        // por el comprador (membresías a término fijo) o, en legacy, al inicio del
        // evento. El resto del cómputo de paquete sigue igual.
        const membershipAnchor = ticket.membershipStartDate ?? ticket.event.startDate
        const membershipPeriod = isMembership ? getMembershipPeriod(todayStr, membershipAnchor) : null
        const isFixedTerm =
            isMembership &&
            ticket.membershipStartDate != null &&
            ticket.ticketType.membershipDurationMonths != null &&
            ticket.ticketType.membershipDurationMonths > 0
        const membershipExpiry = isFixedTerm
            ? getMembershipExpiry(membershipAnchor, ticket.ticketType.membershipDurationMonths!)
            : null
        // Membresía con varios ingresos por día (ORO): el cupo cuenta por SCANS VALID
        // del mes (cada ingreso es una clase), no por días/entitlements.
        const allowMultiDaily = isMembership && ticket.ticketType.allowMultipleDailyScans === true
        let usedCount: number
        if (isMembership && allowMultiDaily && membershipPeriod) {
            usedCount = await prisma.scan.count({
                where: {
                    ticketId: ticket.id,
                    result: "VALID",
                    date: {
                        gte: new Date(`${membershipPeriod.startStr}T00:00:00Z`),
                        lt: new Date(`${membershipPeriod.endStr}T00:00:00Z`),
                    },
                },
            })
        } else if (isMembership && membershipPeriod) {
            usedCount = entitlements.filter((item) => {
                if (item.status !== "USED") return false
                const d = formatDateUTC(item.date)
                return d >= membershipPeriod.startStr && d < membershipPeriod.endStr
            }).length
        } else {
            usedCount = entitlements.filter((item) => item.status === "USED").length
        }
        const isPackage = isPackageLike && packageDaysCount
        const eventStart = ticket.event?.startDate ? formatDateLocal(ticket.event.startDate) : null
        const eventEnd = ticket.event?.endDate ? formatDateLocal(ticket.event.endDate) : null
        const isWithinEventRange = eventStart && eventEnd ? dateStr >= eventStart && dateStr <= eventEnd : true
        const purchasedDateKeys = getPurchasedDateKeys(scheduleSelections)
        const dateBoundDates = new Set([
            ...entitlementDates,
            ...purchasedDateKeys,
        ])
        const isAllowedPurchasedDate =
            !usesPurchasedDates || (isWithinEventRange && dateBoundDates.has(dateStr))
        let hasEntitlement = isPackage
            ? usedCount < packageDaysCount! && isAllowedPurchasedDate
            : (isWithinEventRange && entitlementDates.includes(dateStr))

        if (!isPackage && !hasEntitlement && !dateParam && entitlementDates.length > 0) {
            const nextEntitlement =
                entitlementDates.find((entitlement) => entitlement >= dateStr) ??
                entitlementDates[0]
            qrDate = parseDateOnly(nextEntitlement)
            dateStr = nextEntitlement
            hasEntitlement = true
        }

        let qrDataUrl: string | null = null
        let qrShift: string | null = null

        if (ticket.status !== "ACTIVE") {
            await logTicketIssuance({
                outcome: "TICKET_NOT_ACTIVE",
                reason: `Ticket en estado ${ticket.status} — no se genera QR`,
                ticketId: ticket.id,
                userId: ticket.userId,
                eventId: ticket.eventId,
                qrDate: dateStr,
                requestedDate: dateParam,
                request,
            })
        } else if (!hasEntitlement) {
            const reasonParts: string[] = []
            if (!isWithinEventRange) {
                reasonParts.push(`Fecha ${dateStr} fuera del rango del evento (${eventStart} a ${eventEnd})`)
            }
            if (entitlementDates.length === 0) {
                reasonParts.push("El ticket no tiene entitlements (días válidos) configurados")
            } else if (!entitlementDates.includes(dateStr)) {
                reasonParts.push(`Fecha ${dateStr} no está en los días habilitados (${entitlementDates.join(", ")})`)
            }
            if (isPackage && usedCount >= (packageDaysCount ?? 0)) {
                reasonParts.push(`Paquete agotado: ${usedCount}/${packageDaysCount} usos consumidos`)
            }
            await logTicketIssuance({
                outcome: "NO_ENTITLEMENT",
                reason: reasonParts.join(" | ") || "Sin entitlement disponible para la fecha solicitada",
                ticketId: ticket.id,
                userId: ticket.userId,
                eventId: ticket.eventId,
                qrDate: dateStr,
                requestedDate: dateParam,
                request,
            })
        } else {
            qrShift = getExpectedShiftForDate(scheduleSelections, dateStr)

            try {
                const qrPayload = createQRPayload(
                    ticket.id,
                    ticket.eventId,
                    ticket.userId,
                    ticket.ticketCode,
                    qrDate,
                    qrShift
                )
                qrDataUrl = await generateQRDataURL(qrPayload)
                await logTicketIssuance({
                    outcome: "OK",
                    ticketId: ticket.id,
                    userId: ticket.userId,
                    eventId: ticket.eventId,
                    qrDate: dateStr,
                    qrShift,
                    requestedDate: dateParam,
                    request,
                })
            } catch (qrErr) {
                const message = qrErr instanceof Error ? `${qrErr.name}: ${qrErr.message}` : String(qrErr)
                console.error("QR generation error:", qrErr)
                await logTicketIssuance({
                    outcome: "QR_GENERATION_ERROR",
                    reason: message,
                    ticketId: ticket.id,
                    userId: ticket.userId,
                    eventId: ticket.eventId,
                    qrDate: dateStr,
                    qrShift,
                    requestedDate: dateParam,
                    request,
                })
                qrDataUrl = null
            }
        }

        const scheduleConfig = parseTicketScheduleConfig(ticket.ticketType.validDays)

        // Cambio de horario mensual (semestral/anual BRONCE/PLATA): horario
        // efectivo del mes en curso + el del próximo mes (para mantener o cambiar).
        const scheduleProfile =
            isFixedTerm && (ticket.ticketType.membershipDurationMonths ?? 0) > 1
                ? getMembershipScheduleProfile(
                      ticket.event.servilexSucursalCode,
                      ticket.ticketType.membershipScheduleKey
                  )
                : null
        const baseSchedule = parseMembershipScheduleSelection(ticket.membershipSchedule)
        let monthlySchedule: {
            profile: NonNullable<typeof scheduleProfile>
            current: ReturnType<typeof getEffectiveMembershipSchedule>
            next: {
                monthIndex: number
                monthStart: string
                input: ReturnType<typeof scheduleSelectionToInput>
                summary: string
            } | null
        } | null = null
        if (scheduleProfile && baseSchedule && membershipPeriod) {
            const overrides = (ticket.monthlySchedules ?? []).map((m) => ({
                monthIndex: m.monthIndex,
                selection: parseMembershipScheduleSelection(m.selection),
            }))
            const curIdx = membershipPeriod.index
            const curEff = getEffectiveMembershipSchedule(baseSchedule, overrides, curIdx)
            const nextStart = membershipPeriod.endStr
            const hasNext = !membershipExpiry || nextStart < membershipExpiry
            const nextEff = hasNext
                ? getEffectiveMembershipSchedule(baseSchedule, overrides, curIdx + 1)
                : null
            monthlySchedule = {
                profile: scheduleProfile,
                current: curEff,
                next: hasNext
                    ? {
                          monthIndex: curIdx + 1,
                          monthStart: nextStart,
                          input: scheduleSelectionToInput(nextEff),
                          summary: formatScheduleSummary(nextEff),
                      }
                    : null,
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                ...ticket,
                entitlements,
                scanCount,
                scans: scans.map(s => ({ date: formatDateUTC(s.date), shift: s.shift })),
                shifts: scheduleConfig.shifts,
                scheduleSelections,
                qrDataUrl,
                qrDate: dateStr,
                qrShift,
                isMembership,
                // Cupo del mes en curso para membresías (reinicio sin acumular)
                membershipAttendance: isMembership
                    ? {
                          total: packageDaysCount ?? 0,
                          used: usedCount,
                          remaining: Math.max((packageDaysCount ?? 0) - usedCount, 0),
                          periodStart: membershipPeriod?.startStr ?? null,
                          // Membresías a término fijo (anual/semestral)
                          membershipStart: ticket.membershipStartDate
                              ? formatDateUTC(ticket.membershipStartDate)
                              : null,
                          membershipExpiry,
                          durationMonths: ticket.ticketType.membershipDurationMonths ?? null,
                      }
                    : null,
                monthlySchedule,
            },
        })
    } catch (error) {
        console.error("Error fetching ticket:", error)
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        await logTicketIssuance({
            outcome: "INTERNAL_ERROR",
            reason: message,
            ticketId: rawId,
            requestedDate: dateParam,
            request,
        })
        return NextResponse.json(
            { success: false, error: "Error al obtener ticket" },
            { status: 500 }
        )
    }
}

