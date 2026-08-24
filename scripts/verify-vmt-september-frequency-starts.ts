/** Verificación independiente, de solo lectura, de la migración VMT septiembre. */

import { prisma } from "@/lib/prisma"
import { normalizeScheduleSelections, parseTicketScheduleConfig } from "@/lib/ticket-schedule"

const EVENT_ID = "cmsqihgwf04sy01p8tjw289a9"
const LMV = ["2026-09-02", "2026-09-04", "2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14", "2026-09-16", "2026-09-18", "2026-09-21", "2026-09-23", "2026-09-25", "2026-09-28"]
const MJS = ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-08", "2026-09-10", "2026-09-12", "2026-09-15", "2026-09-17", "2026-09-19", "2026-09-22", "2026-09-24", "2026-09-26"]
const MJ = ["2026-09-01", "2026-09-03", "2026-09-08", "2026-09-10", "2026-09-15", "2026-09-17", "2026-09-22", "2026-09-24"]
const SATURDAY = ["2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"]

function expectedDates(name: string): string[] {
    const normalized = name.trim().toUpperCase()
    if (normalized.startsWith("LUN - MIE - VIE ")) return LMV
    if (normalized.startsWith("SÁB (")) return SATURDAY
    if (normalized.startsWith("MAR - JUE (") && !normalized.includes("SÁB")) return MJ
    if (normalized.startsWith("MAR - JUE") && normalized.includes("SÁB")) return MJS
    throw new Error(`Frecuencia no reconocida: ${name}`)
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
}

function dateKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

async function main() {
    const event = await prisma.event.findUnique({
        where: { id: EVENT_ID },
        select: {
            ticketTypes: {
                select: {
                    id: true,
                    name: true,
                    packageDaysCount: true,
                    validDays: true,
                    tickets: {
                        where: { status: { not: "CANCELLED" } },
                        select: {
                            id: true,
                            entitlements: {
                                orderBy: { date: "asc" },
                                select: { date: true, status: true },
                            },
                        },
                    },
                    orderItems: {
                        where: { order: { status: { not: "CANCELLED" } } },
                        select: { id: true, attendeeData: true },
                    },
                },
            },
        },
    })

    if (!event || event.ticketTypes.length !== 40) {
        throw new Error(`Se esperaban 40 horarios; encontrados: ${event?.ticketTypes.length ?? 0}`)
    }

    let tickets = 0
    let orderItems = 0
    let attendees = 0
    let entitlements = 0

    for (const ticketType of event.ticketTypes) {
        const expected = expectedDates(ticketType.name)
        const configured = parseTicketScheduleConfig(ticketType.validDays).dates
        if (ticketType.packageDaysCount !== expected.length || !sameValues(configured, expected)) {
            throw new Error(`Calendario incorrecto en ${ticketType.name}`)
        }

        for (const ticket of ticketType.tickets) {
            const dates = ticket.entitlements.map((entitlement) => dateKey(entitlement.date))
            if (!sameValues(dates, expected)) throw new Error(`Entitlements incorrectos en ${ticket.id}`)
            if (ticket.entitlements.some((entitlement) => entitlement.status !== "AVAILABLE")) {
                throw new Error(`Estado inesperado en los entitlements de ${ticket.id}`)
            }
            tickets += 1
            entitlements += dates.length
        }

        for (const orderItem of ticketType.orderItems) {
            if (!Array.isArray(orderItem.attendeeData)) throw new Error(`attendeeData inválido en ${orderItem.id}`)
            for (const attendee of orderItem.attendeeData) {
                const record = attendee && typeof attendee === "object" && !Array.isArray(attendee)
                    ? attendee as Record<string, unknown>
                    : {}
                const dates = normalizeScheduleSelections(record.scheduleSelections).map((selection) => selection.date)
                if (!sameValues(dates, expected)) throw new Error(`Selección incorrecta en ${orderItem.id}`)
                attendees += 1
            }
            orderItems += 1
        }
    }

    console.log(
        `VERIFICADO: 40 horarios, ${tickets} carnets, ${entitlements} entitlements, ` +
        `${orderItems} items y ${attendees} asistentes alineados por frecuencia.`
    )
}

main()
    .finally(() => prisma.$disconnect())
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
