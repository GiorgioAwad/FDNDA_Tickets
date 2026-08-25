/**
 * Auditoría de solo lectura de calendarios y entitlements del evento Academia VMT
 * de septiembre 2026. No admite flags de escritura.
 */

import { prisma } from "@/lib/prisma"
import { parseTicketScheduleConfig } from "@/lib/ticket-schedule"

const EVENT_ID = "cmsqihgwf04sy01p8tjw289a9"
const EXPECTED_TITLE = "ACADEMIA DE NATACIÓN (VMT/FDNDA) - DEL 1 AL 30 DE SEPTIEMBRE"

function dateKey(value: Date): string {
    return value.toISOString().slice(0, 10)
}

async function main() {
    const event = await prisma.event.findUnique({
        where: { id: EVENT_ID },
        select: {
            title: true,
            startDate: true,
            endDate: true,
            ticketTypes: {
                orderBy: { sortOrder: "asc" },
                select: {
                    name: true,
                    servilexScheduleCode: true,
                    packageDaysCount: true,
                    validDays: true,
                    tickets: {
                        where: { status: { not: "CANCELLED" } },
                        select: {
                            entitlements: {
                                orderBy: { date: "asc" },
                                select: { date: true, status: true },
                            },
                        },
                    },
                },
            },
        },
    })

    if (!event) throw new Error(`No existe el evento ${EVENT_ID}`)
    if (event.title !== EXPECTED_TITLE) throw new Error(`Título inesperado: ${event.title}`)

    console.log(`Evento: ${event.title}`)
    console.log(`Rango: ${dateKey(event.startDate)} → ${dateKey(event.endDate)}`)

    const rows = event.ticketTypes.map((ticketType) => {
        const dates = parseTicketScheduleConfig(ticketType.validDays).dates
        const entitlementSignatures = new Set(
            ticketType.tickets.map((ticket) =>
                ticket.entitlements.map((entitlement) => dateKey(entitlement.date)).join(", ")
            )
        )
        const nonAvailable = ticketType.tickets.reduce(
            (total, ticket) => total + ticket.entitlements.filter((entitlement) => entitlement.status !== "AVAILABLE").length,
            0,
        )

        return {
            codigo: ticketType.servilexScheduleCode,
            horario: ticketType.name,
            clases: ticketType.packageDaysCount,
            carnets: ticketType.tickets.length,
            fechasTipo: dates.join(", ") || "(vacío)",
            calendariosCarnet: entitlementSignatures.size,
            fechasCarnet: entitlementSignatures.size === 1 ? [...entitlementSignatures][0] || "(vacío)" : "MÚLTIPLES",
            usados: nonAvailable,
        }
    })

    console.table(rows)
    console.log(`Horarios: ${rows.length}; carnets activos: ${rows.reduce((sum, row) => sum + row.carnets, 0)}`)
    console.log("AUDITORÍA COMPLETA: no se realizaron escrituras.")
}

main()
    .finally(() => prisma.$disconnect())
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
