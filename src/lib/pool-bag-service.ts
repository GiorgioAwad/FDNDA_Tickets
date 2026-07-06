import { prisma } from "@/lib/prisma"
import { getTodayDateString, formatDateUTC } from "@/lib/qr"
import { parseDateOnly } from "@/lib/utils"
import {
    reserveTicketTypeDateInventory,
    releaseTicketTypeDateInventory,
} from "@/lib/ticket-date-inventory"
import { onTicketSold } from "@/lib/cached-queries"
import {
    isPoolBagTicketType,
    isPoolSlotTicketType,
    getPoolSlotShiftLabel,
} from "@/lib/pool-bag"

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export type PoolBagServiceResult<T> =
    | ({ ok: true } & T)
    | { ok: false; error: string; status: number }

// Reserva una visita de una bolsa: consume el cupo del horario elegido (atómico,
// sin sobreventa) y crea/reusa la fila PoolVisitReservation. Reusa una fila
// CANCELLED del mismo (ticket, fecha, horario) porque el índice único la retiene.
export async function reservePoolVisit(input: {
    userId: string
    ticketId: string
    slotTicketTypeId: string
    date: string
}): Promise<PoolBagServiceResult<{ reservationId: string; date: string; shift: string; slotName: string; eventId: string }>> {
    if (!DATE_REGEX.test(input.date)) {
        return { ok: false, error: "Fecha invalida", status: 400 }
    }

    const ticket = await prisma.ticket.findFirst({
        where: { id: input.ticketId, userId: input.userId },
        include: { ticketType: true, event: true },
    })

    if (!ticket) {
        return { ok: false, error: "Bolsa no encontrada", status: 404 }
    }

    if (ticket.status !== "ACTIVE") {
        return { ok: false, error: "La bolsa no esta activa", status: 400 }
    }

    if (
        !isPoolBagTicketType({
            eventCategory: ticket.event.category,
            isPackage: ticket.ticketType.isPackage,
            packageDaysCount: ticket.ticketType.packageDaysCount,
        })
    ) {
        return { ok: false, error: "Esta entrada no es una bolsa de visitas", status: 400 }
    }

    const slot = await prisma.ticketType.findUnique({
        where: { id: input.slotTicketTypeId },
    })

    if (
        !slot ||
        slot.eventId !== ticket.eventId ||
        !slot.isActive ||
        !isPoolSlotTicketType({ eventCategory: ticket.event.category, isPackage: slot.isPackage })
    ) {
        return { ok: false, error: "Horario no disponible", status: 400 }
    }

    // Vigencia: solo fechas dentro del rango del evento y no en el pasado (hora Lima).
    const today = getTodayDateString()
    const rangeStart = formatDateUTC(ticket.event.startDate)
    const rangeEnd = formatDateUTC(ticket.event.endDate)
    if (input.date < today) {
        return { ok: false, error: "No puedes reservar una fecha pasada", status: 400 }
    }
    if (input.date < rangeStart || input.date > rangeEnd) {
        return { ok: false, error: "La fecha esta fuera del periodo de la bolsa", status: 400 }
    }

    const shift = getPoolSlotShiftLabel({ name: slot.name, servilexExtraConfig: slot.servilexExtraConfig })
    const packageDaysCount = ticket.ticketType.packageDaysCount ?? 0
    const dateValue = parseDateOnly(input.date)

    try {
        const reservation = await prisma.$transaction(async (tx) => {
            // Créditos: reservas no canceladas < total de la bolsa.
            const activeCount = await tx.poolVisitReservation.count({
                where: { ticketId: ticket.id, status: { in: ["RESERVED", "USED"] } },
            })
            if (activeCount >= packageDaysCount) {
                throw new Error("SIN_CREDITOS")
            }

            const existing = await tx.poolVisitReservation.findUnique({
                where: {
                    ticketId_date_sourceTicketTypeId: {
                        ticketId: ticket.id,
                        date: dateValue,
                        sourceTicketTypeId: slot.id,
                    },
                },
            })
            if (existing && existing.status !== "CANCELLED") {
                throw new Error("YA_RESERVADA")
            }

            // Reserva atómica del cupo del horario (anti-sobreventa). Lanza si no hay.
            await reserveTicketTypeDateInventory(tx, {
                ticketTypeId: slot.id,
                templateCapacity: slot.capacity,
                reservations: new Map([[input.date, 1]]),
                ticketLabel: slot.name,
            })
            await tx.ticketType.update({
                where: { id: slot.id },
                data: { sold: { increment: 1 } },
            })

            if (existing) {
                return tx.poolVisitReservation.update({
                    where: { id: existing.id },
                    data: { status: "RESERVED", shift, usedAt: null },
                })
            }
            return tx.poolVisitReservation.create({
                data: {
                    ticketId: ticket.id,
                    sourceTicketTypeId: slot.id,
                    date: dateValue,
                    shift,
                    status: "RESERVED",
                },
            })
        })

        await onTicketSold(ticket.eventId, slot.id)

        return {
            ok: true,
            reservationId: reservation.id,
            date: input.date,
            shift,
            slotName: slot.name,
            eventId: ticket.eventId,
        }
    } catch (error) {
        const message = (error as Error).message
        if (message === "SIN_CREDITOS") {
            return { ok: false, error: "Ya usaste todas las visitas de tu bolsa", status: 400 }
        }
        if (message === "YA_RESERVADA") {
            return { ok: false, error: "Ya reservaste este horario para ese dia", status: 409 }
        }
        if (message.includes("No hay cupos")) {
            return { ok: false, error: "No hay cupos disponibles para ese horario", status: 409 }
        }
        console.error("reservePoolVisit error:", error)
        return { ok: false, error: "No se pudo reservar la visita", status: 500 }
    }
}

// Cancela una reserva futura: libera el cupo del horario y devuelve el crédito.
// Corte: solo antes del día de la visita (hora Lima). No cancela una visita USED.
export async function cancelPoolVisit(input: {
    userId: string
    reservationId: string
}): Promise<PoolBagServiceResult<{ reservationId: string }>> {
    const reservation = await prisma.poolVisitReservation.findUnique({
        where: { id: input.reservationId },
        include: { ticket: { select: { userId: true, eventId: true } } },
    })

    if (!reservation || reservation.ticket.userId !== input.userId) {
        return { ok: false, error: "Reserva no encontrada", status: 404 }
    }

    if (reservation.status !== "RESERVED") {
        return { ok: false, error: "Esta reserva no se puede cancelar", status: 400 }
    }

    const today = getTodayDateString()
    const reservationDate = formatDateUTC(reservation.date)
    if (reservationDate <= today) {
        return {
            ok: false,
            error: "Solo puedes cancelar antes del dia de la visita",
            status: 400,
        }
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Voltear la reserva primero (atómico). Si otra sesión ya la cambió, no
            // liberamos inventario (el throw hace rollback de toda la tx).
            const flipped = await tx.poolVisitReservation.updateMany({
                where: { id: reservation.id, status: "RESERVED" },
                data: { status: "CANCELLED", usedAt: null },
            })
            if (flipped.count === 0) {
                throw new Error("YA_CAMBIADA")
            }
            await releaseTicketTypeDateInventory(tx, {
                ticketTypeId: reservation.sourceTicketTypeId,
                reservations: new Map([[reservationDate, 1]]),
            })
            await tx.ticketType.update({
                where: { id: reservation.sourceTicketTypeId },
                data: { sold: { decrement: 1 } },
            })
        })

        await onTicketSold(reservation.ticket.eventId, reservation.sourceTicketTypeId)

        return { ok: true, reservationId: reservation.id }
    } catch (error) {
        if ((error as Error).message === "YA_CAMBIADA") {
            return { ok: false, error: "Esta reserva ya cambio de estado", status: 409 }
        }
        console.error("cancelPoolVisit error:", error)
        return { ok: false, error: "No se pudo cancelar la reserva", status: 500 }
    }
}
