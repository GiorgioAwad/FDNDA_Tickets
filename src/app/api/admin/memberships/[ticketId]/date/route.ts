import { NextRequest, NextResponse } from "next/server"
import { Prisma, UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { onEventUpdated } from "@/lib/cached-queries"
import {
    membershipChangeInclude,
    toChangeSnapshot,
} from "@/lib/membership-admin-snapshot"
import {
    lockMembershipTicket,
    MembershipChangeAbort,
} from "@/lib/membership-change-apply"
import { isPoolBagTicketType } from "@/lib/pool-bag"
import { prisma } from "@/lib/prisma"
import { formatDateUTC, getTodayDateString } from "@/lib/qr"
import {
    getTicketSelectableDates,
    usesTicketDateCapacity,
} from "@/lib/ticket-date-capacity"
import {
    releaseTicketTypeDateInventory,
    reserveTicketTypeDateInventory,
} from "@/lib/ticket-date-inventory"
import {
    getShiftOptionsForDate,
    normalizeScheduleSelections,
    parseTicketScheduleConfig,
} from "@/lib/ticket-schedule"
import { parseDateOnly } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DateChangeInput = {
    sourceDate: string
    targetDate: string
    targetShift: string | null
    allowOverCapacity: boolean
}

function buildDateChangePlan(
    record: Awaited<ReturnType<typeof loadRecord>>,
    input: DateChangeInput
) {
    if (!record) throw new MembershipChangeAbort("Entrada no encontrada")
    const snapshot = toChangeSnapshot(record)
    if (!snapshot) {
        throw new MembershipChangeAbort(
            "No se pudo identificar el item individual de esta entrada."
        )
    }
    if (record.status !== "ACTIVE" || record.order.status !== "PAID") {
        throw new MembershipChangeAbort("Solo se pueden cambiar entradas activas y pagadas.")
    }
    if (snapshot.orderItem.quantity !== 1) {
        throw new MembershipChangeAbort(
            "La compra agrupa varias entradas. No se puede cambiar una sola desde este panel."
        )
    }
    if (
        !usesTicketDateCapacity({
            eventCategory: record.event.category,
            capacityByDate: record.ticketType.capacityByDate,
        })
    ) {
        throw new MembershipChangeAbort("Esta modalidad no administra cupos por fecha.")
    }
    if (
        isPoolBagTicketType({
            eventCategory: record.event.category,
            isPackage: record.ticketType.isPackage,
            packageDaysCount: record.ticketType.packageDaysCount,
        })
    ) {
        throw new MembershipChangeAbort(
            "Las visitas de una bolsa se cambian desde sus reservas."
        )
    }

    const attendees = Array.isArray(snapshot.orderItem.attendeeData)
        ? snapshot.orderItem.attendeeData
        : []
    const attendee =
        attendees[0] && typeof attendees[0] === "object"
            ? (attendees[0] as Record<string, unknown>)
            : null
    if (!attendee) {
        throw new MembershipChangeAbort("La entrada no tiene datos del asistente.")
    }
    const selections = normalizeScheduleSelections(attendee.scheduleSelections)
    const sourceIndex = selections.findIndex((item) => item.date === input.sourceDate)
    if (sourceIndex < 0) {
        throw new MembershipChangeAbort("La fecha de origen ya no pertenece a esta entrada.")
    }
    const source = selections[sourceIndex]
    const entitlement = record.entitlements.find(
        (item) => formatDateUTC(item.date) === input.sourceDate
    )
    if (!entitlement || entitlement.status !== "AVAILABLE") {
        throw new MembershipChangeAbort(
            "La fecha de origen ya fue usada o no está disponible para cambiar."
        )
    }
    if (
        input.sourceDate !== input.targetDate &&
        record.entitlements.some(
            (item) => formatDateUTC(item.date) === input.targetDate
        )
    ) {
        throw new MembershipChangeAbort(
            "La entrada ya tiene un derecho de acceso para la fecha destino."
        )
    }

    const today = getTodayDateString()
    const allowedDates = new Set(
        getTicketSelectableDates({
            validDays: record.ticketType.validDays,
            eventStartDate: record.event.startDate,
            eventEndDate: record.event.endDate,
        })
    )
    if (input.targetDate < today || !allowedDates.has(input.targetDate)) {
        throw new MembershipChangeAbort("La nueva fecha no está disponible para esta entrada.")
    }
    if (
        selections.some(
            (item, index) => index !== sourceIndex && item.date === input.targetDate
        )
    ) {
        throw new MembershipChangeAbort("La entrada ya incluye la fecha destino.")
    }

    const schedule = parseTicketScheduleConfig(record.ticketType.validDays)
    const shifts = getShiftOptionsForDate(schedule, input.targetDate)
    let targetShift = input.targetShift?.trim() || null
    if (
        !targetShift &&
        source.shift &&
        (shifts.length === 0 || shifts.includes(source.shift))
    ) {
        targetShift = source.shift
    }
    if (!targetShift && shifts.length === 1) targetShift = shifts[0]
    if (schedule.requireShiftSelection && shifts.length > 0 && !targetShift) {
        throw new MembershipChangeAbort("Selecciona un turno para la nueva fecha.")
    }
    if (targetShift && shifts.length > 0 && !shifts.includes(targetShift)) {
        throw new MembershipChangeAbort("El turno elegido no está disponible en esa fecha.")
    }
    if (input.sourceDate === input.targetDate && source.shift === targetShift) {
        throw new MembershipChangeAbort("La fecha y el turno destino son los actuales.")
    }

    const inventory = record.ticketType.dateInventories.find(
        (item) => formatDateUTC(item.date) === input.targetDate
    )
    const changesDate = input.sourceDate !== input.targetDate
    if (changesDate && (!inventory || !inventory.isEnabled)) {
        throw new MembershipChangeAbort("La fecha destino está cerrada o no tiene inventario.")
    }
    const isFull =
        changesDate &&
        Boolean(inventory && inventory.capacity > 0 && inventory.sold + 1 > inventory.capacity)
    if (isFull && !input.allowOverCapacity) {
        throw new MembershipChangeAbort(
            `La fecha destino no tiene cupo: ${inventory?.sold ?? 0} ocupados de ${inventory?.capacity ?? 0}.`
        )
    }

    const updatedSelections = selections.map((item, index) =>
        index === sourceIndex
            ? { date: input.targetDate, shift: targetShift }
            : item
    )
    const before = {
        ticketTypeName: record.ticketType.name,
        sucursalCode: record.ticketType.event.servilexSucursalCode,
        scheduleSummary: [input.sourceDate, source.shift].filter(Boolean).join(" · "),
        date: input.sourceDate,
        shift: source.shift,
    }
    const after = {
        ticketTypeName: record.ticketType.name,
        sucursalCode: record.ticketType.event.servilexSucursalCode,
        scheduleSummary: [input.targetDate, targetShift].filter(Boolean).join(" · "),
        date: input.targetDate,
        shift: targetShift,
        capacityOverride: isFull && input.allowOverCapacity,
    }
    const fingerprint = JSON.stringify({
        ticketStatus: record.status,
        orderStatus: record.order.status,
        itemId: snapshot.orderItem.id,
        source,
        targetDate: input.targetDate,
        targetShift,
        inventory: inventory
            ? {
                  sold: inventory.sold,
                  capacity: inventory.capacity,
                  isEnabled: inventory.isEnabled,
              }
            : null,
        allowOverCapacity: input.allowOverCapacity,
    })

    return {
        snapshot,
        attendee,
        updatedSelections,
        changesDate,
        before,
        after,
        fingerprint,
        overCapacityOverride: isFull && input.allowOverCapacity,
    }
}

function loadRecord(ticketId: string) {
    return prisma.ticket.findUnique({
        where: { id: ticketId },
        include: membershipChangeInclude,
    })
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== UserRole.ADMIN) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const { ticketId } = await params
        const body = (await request.json().catch(() => null)) as {
            sourceDate?: string
            targetDate?: string
            targetShift?: string | null
            allowOverCapacity?: boolean
            preview?: boolean
            fingerprint?: string
            reason?: string
        } | null
        const sourceDate = body?.sourceDate?.trim() ?? ""
        const targetDate = body?.targetDate?.trim() ?? ""
        const datePattern = /^\d{4}-\d{2}-\d{2}$/
        if (!datePattern.test(sourceDate) || !datePattern.test(targetDate)) {
            return NextResponse.json(
                { success: false, error: "Indica una fecha de origen y destino válidas." },
                { status: 400 }
            )
        }
        const reason = body?.reason?.trim() ?? ""
        const preview = body?.preview === true
        if (!preview && reason.length < 5) {
            return NextResponse.json(
                { success: false, error: "Indica el motivo del cambio (mínimo 5 caracteres)." },
                { status: 400 }
            )
        }
        if (!preview && body?.allowOverCapacity && reason.length < 10) {
            return NextResponse.json(
                { success: false, error: "El sobrecupo requiere un motivo detallado." },
                { status: 400 }
            )
        }

        const input: DateChangeInput = {
            sourceDate,
            targetDate,
            targetShift: body?.targetShift?.trim() || null,
            allowOverCapacity: body?.allowOverCapacity === true,
        }
        const record = await loadRecord(ticketId)
        const plan = buildDateChangePlan(record, input)
        const publicPlan = {
            kind: "SCHEDULE" as const,
            label: "Cambio de fecha o turno",
            before: plan.before,
            after: plan.after,
            fingerprint: plan.fingerprint,
            overCapacityOverride: plan.overCapacityOverride,
        }
        if (preview) {
            return NextResponse.json({ success: true, data: { plan: publicPlan } })
        }

        const applied = await prisma.$transaction(async (tx) => {
            await lockMembershipTicket(tx, ticketId)
            const fresh = await tx.ticket.findUnique({
                where: { id: ticketId },
                include: membershipChangeInclude,
            })
            const freshPlan = buildDateChangePlan(fresh, input)
            if (freshPlan.fingerprint !== (body?.fingerprint ?? plan.fingerprint)) {
                throw new MembershipChangeAbort(
                    "La entrada o el cupo cambió desde la vista previa. Recarga y vuelve a revisar."
                )
            }

            if (freshPlan.changesDate) {
                await reserveTicketTypeDateInventory(tx, {
                    ticketTypeId: freshPlan.snapshot.sourceType.id,
                    templateCapacity: freshPlan.snapshot.sourceType.capacity,
                    reservations: new Map([[targetDate, 1]]),
                    ticketLabel: freshPlan.snapshot.sourceType.name,
                    requireConfigured: true,
                    allowOverCapacity: input.allowOverCapacity,
                })
                await releaseTicketTypeDateInventory(tx, {
                    ticketTypeId: freshPlan.snapshot.sourceType.id,
                    reservations: new Map([[sourceDate, 1]]),
                    requireExisting: true,
                })
                const moved = await tx.ticketDayEntitlement.updateMany({
                    where: {
                        ticketId,
                        date: parseDateOnly(sourceDate),
                        status: "AVAILABLE",
                    },
                    data: { date: parseDateOnly(targetDate) },
                })
                if (moved.count !== 1) {
                    throw new MembershipChangeAbort(
                        "La fecha de origen cambió antes de confirmar."
                    )
                }
            }

            await tx.orderItem.update({
                where: { id: freshPlan.snapshot.orderItem.id },
                data: {
                    attendeeData: [
                        {
                            ...freshPlan.attendee,
                            scheduleSelections: freshPlan.updatedSelections,
                        },
                    ] as unknown as Prisma.InputJsonValue,
                },
            })
            await tx.membershipAdminChange.create({
                data: {
                    ticketId,
                    actorId: user.id,
                    kind: "SCHEDULE",
                    reason: freshPlan.overCapacityOverride
                        ? `Sobrecupo autorizado: ${reason}`
                        : reason,
                    before: freshPlan.before,
                    after: freshPlan.after,
                },
            })
            return {
                ...publicPlan,
                before: freshPlan.before,
                after: freshPlan.after,
                fingerprint: freshPlan.fingerprint,
                overCapacityOverride: freshPlan.overCapacityOverride,
            }
        })

        await onEventUpdated(record!.eventId)
        return NextResponse.json({ success: true, data: { plan: applied } })
    } catch (error) {
        if (error instanceof MembershipChangeAbort) {
            return NextResponse.json({ success: false, error: error.message }, { status: 409 })
        }
        console.error("Error al cambiar fecha o turno:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
