import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import {
    consolidatePoolBuyers,
    isoWeekday,
    matchesPoolReportSlot,
    type PoolBuyerVisit,
    type PoolInventoryReportRow,
} from "@/lib/pool-buyer-report"

export const dynamic = "force-dynamic"

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const MAX_RANGE_DAYS = 366

function dateKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

function parseDate(value: string): Date | null {
    if (!DATE_PATTERN.test(value)) return null
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isNaN(date.getTime()) || dateKey(date) !== value ? null : date
}

function parseWeekdays(value: string | null): number[] {
    const parsed = (value || "4,5")
        .split(",")
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    return Array.from(new Set(parsed)).sort((a, b) => a - b)
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const fromKey = searchParams.get("from") || ""
        const toKey = searchParams.get("to") || ""
        const startTime = searchParams.get("startTime") || "18:00"
        const endTime = searchParams.get("endTime") || "19:00"
        const weekdays = parseWeekdays(searchParams.get("weekdays"))
        const from = parseDate(fromKey)
        const to = parseDate(toKey)

        if (!from || !to) {
            return NextResponse.json(
                { success: false, error: "Selecciona un rango de fechas válido." },
                { status: 400 }
            )
        }
        if (to < from) {
            return NextResponse.json(
                { success: false, error: "La fecha final no puede ser anterior a la inicial." },
                { status: 400 }
            )
        }
        const rangeDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
        if (rangeDays > MAX_RANGE_DAYS) {
            return NextResponse.json(
                { success: false, error: "El rango máximo permitido es de 366 días." },
                { status: 400 }
            )
        }
        if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime) || startTime >= endTime) {
            return NextResponse.json(
                { success: false, error: "Selecciona una franja horaria válida." },
                { status: 400 }
            )
        }
        if (weekdays.length === 0) {
            return NextResponse.json(
                { success: false, error: "Selecciona al menos un día de la semana." },
                { status: 400 }
            )
        }

        const dateFilter = { gte: from, lte: to }
        const [inventories, directEntitlements, bagReservations] = await Promise.all([
            prisma.ticketTypeDateInventory.findMany({
                where: {
                    date: dateFilter,
                    ticketType: {
                        isPackage: false,
                        event: { category: "PISCINA_LIBRE" },
                    },
                },
                select: {
                    date: true,
                    capacity: true,
                    sold: true,
                    isEnabled: true,
                    ticketType: {
                        select: {
                            id: true,
                            name: true,
                            event: { select: { id: true, title: true } },
                        },
                    },
                },
                orderBy: [{ date: "asc" }, { ticketType: { sortOrder: "asc" } }],
            }),
            prisma.ticketDayEntitlement.findMany({
                where: {
                    date: dateFilter,
                    ticket: {
                        status: "ACTIVE",
                        event: { category: "PISCINA_LIBRE" },
                        ticketType: { isPackage: false },
                        order: { status: "PAID" },
                    },
                },
                select: {
                    date: true,
                    ticket: {
                        select: {
                            id: true,
                            attendeeName: true,
                            attendeeDni: true,
                            ticketType: { select: { name: true } },
                            event: { select: { id: true, title: true } },
                            order: {
                                select: {
                                    id: true,
                                    paidAt: true,
                                    createdAt: true,
                                    buyerName: true,
                                    buyerDocNumber: true,
                                    buyerEmail: true,
                                    buyerPhone: true,
                                    user: {
                                        select: { name: true, dni: true, email: true, phone: true },
                                    },
                                },
                            },
                        },
                    },
                },
            }),
            prisma.poolVisitReservation.findMany({
                where: {
                    date: dateFilter,
                    status: { in: ["RESERVED", "USED"] },
                    ticket: {
                        status: "ACTIVE",
                        event: { category: "PISCINA_LIBRE" },
                        order: { status: "PAID" },
                    },
                },
                select: {
                    id: true,
                    date: true,
                    sourceTicketType: { select: { name: true } },
                    ticket: {
                        select: {
                            attendeeName: true,
                            attendeeDni: true,
                            ticketType: { select: { name: true } },
                            event: { select: { id: true, title: true } },
                            order: {
                                select: {
                                    id: true,
                                    paidAt: true,
                                    createdAt: true,
                                    buyerName: true,
                                    buyerDocNumber: true,
                                    buyerEmail: true,
                                    buyerPhone: true,
                                    user: {
                                        select: { name: true, dni: true, email: true, phone: true },
                                    },
                                },
                            },
                        },
                    },
                },
            }),
        ])

        const matchesFilters = (date: Date, schedule: string) =>
            weekdays.includes(isoWeekday(dateKey(date))) &&
            matchesPoolReportSlot(schedule, startTime, endTime)

        const directVisits: PoolBuyerVisit[] = directEntitlements
            .filter((row) => matchesFilters(row.date, row.ticket.ticketType.name))
            .map((row) => {
                const { ticket } = row
                const { order } = ticket
                return {
                    eventId: ticket.event.id,
                    eventName: ticket.event.title,
                    date: dateKey(row.date),
                    schedule: ticket.ticketType.name,
                    source: "Entrada directa",
                    reservationId: ticket.id,
                    orderId: order.id,
                    paidAt: (order.paidAt || order.createdAt).toISOString(),
                    buyerName: order.buyerName || order.user.name || "",
                    buyerDocument: order.buyerDocNumber || order.user.dni || "",
                    buyerEmail: order.buyerEmail || order.user.email || "",
                    buyerPhone: order.buyerPhone || order.user.phone || "",
                    attendeeName: ticket.attendeeName || "",
                    attendeeDocument: ticket.attendeeDni || "",
                }
            })

        const bagVisits: PoolBuyerVisit[] = bagReservations
            .filter((row) => matchesFilters(row.date, row.sourceTicketType.name))
            .map((row) => {
                const { ticket } = row
                const { order } = ticket
                return {
                    eventId: ticket.event.id,
                    eventName: ticket.event.title,
                    date: dateKey(row.date),
                    schedule: row.sourceTicketType.name,
                    source: `Bolsa: ${ticket.ticketType.name}`,
                    reservationId: row.id,
                    orderId: order.id,
                    paidAt: (order.paidAt || order.createdAt).toISOString(),
                    buyerName: order.buyerName || order.user.name || "",
                    buyerDocument: order.buyerDocNumber || order.user.dni || "",
                    buyerEmail: order.buyerEmail || order.user.email || "",
                    buyerPhone: order.buyerPhone || order.user.phone || "",
                    attendeeName: ticket.attendeeName || "",
                    attendeeDocument: ticket.attendeeDni || "",
                }
            })

        const visits = [...directVisits, ...bagVisits].sort(
            (a, b) =>
                a.date.localeCompare(b.date) ||
                a.schedule.localeCompare(b.schedule, "es") ||
                a.buyerName.localeCompare(b.buyerName, "es")
        )

        const inventory: PoolInventoryReportRow[] = inventories
            .filter((row) => matchesFilters(row.date, row.ticketType.name))
            .map((row) => {
                const date = dateKey(row.date)
                const found = visits.filter(
                    (visit) =>
                        visit.eventId === row.ticketType.event.id &&
                        visit.date === date &&
                        visit.schedule === row.ticketType.name
                ).length
                return {
                    eventId: row.ticketType.event.id,
                    eventName: row.ticketType.event.title,
                    date,
                    schedule: row.ticketType.name,
                    capacity: row.capacity,
                    sold: row.sold,
                    found,
                    matches: row.sold === found,
                    enabled: row.isEnabled,
                }
            })

        const buyers = consolidatePoolBuyers(visits)
        return NextResponse.json({
            success: true,
            data: {
                filters: { from: fromKey, to: toKey, startTime, endTime, weekdays },
                summary: {
                    buyers: buyers.length,
                    visits: visits.length,
                    directVisits: directVisits.length,
                    bagVisits: bagVisits.length,
                    inventoryRows: inventory.length,
                },
                buyers,
                visits,
                inventory,
            },
        })
    } catch (error) {
        console.error("Error loading pool buyers report:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo generar el reporte de piscina libre." },
            { status: 500 }
        )
    }
}
