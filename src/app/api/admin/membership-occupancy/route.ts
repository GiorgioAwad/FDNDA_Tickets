import { NextRequest, NextResponse } from "next/server"
import { OrderStatus, TicketStatus, UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { toScanTicket } from "@/lib/membership-admin-snapshot"
import { buildMembershipOccupancy, type OccupancyTicketSnapshot } from "@/lib/membership-occupancy"
import { prisma } from "@/lib/prisma"
import { getTodayDateString } from "@/lib/qr"
import {
    getMembershipAccessStatus,
    getMembershipAnchor,
    getMembershipPeriod,
} from "@/lib/scan-helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function requireAdmin() {
    const user = await getCurrentUser()
    return user?.role === UserRole.ADMIN
}

export async function GET(request: NextRequest) {
    try {
        if (!(await requireAdmin())) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const eventId = new URL(request.url).searchParams.get("eventId")?.trim() ?? ""

        // Eventos que venden membresias: al menos un tipo con cupo mensual y
        // duracion fija. Sirve para poblar el selector.
        const events = await prisma.event.findMany({
            where: {
                ticketTypes: {
                    some: { monthlyClassLimit: { gt: 0 }, membershipDurationMonths: { gt: 0 } },
                },
            },
            select: { id: true, title: true, servilexSucursalCode: true },
            orderBy: { startDate: "desc" },
        })

        if (!eventId) {
            return NextResponse.json({ success: true, data: { events, occupancy: null, event: null } })
        }
        const event = events.find((candidate) => candidate.id === eventId)
        if (!event) {
            return NextResponse.json(
                { success: false, error: "Evento de membresias no encontrado" },
                { status: 404 }
            )
        }

        const today = getTodayDateString()

        const [tickets, types] = await Promise.all([
            prisma.ticket.findMany({
                where: {
                    eventId,
                    status: TicketStatus.ACTIVE,
                    order: { status: OrderStatus.PAID },
                    ticketType: {
                        monthlyClassLimit: { gt: 0 },
                        membershipDurationMonths: { gt: 0 },
                    },
                },
                select: {
                    id: true,
                    ticketTypeId: true,
                    membershipStartDate: true,
                    membershipSchedule: true,
                    monthlySchedules: { select: { monthIndex: true, selection: true } },
                    membershipFreeze: { select: { month: true, startDate: true, endDate: true } },
                    event: {
                        select: { title: true, startDate: true, endDate: true, membershipStartFixed: true },
                    },
                    ticketType: {
                        select: {
                            name: true,
                            isPackage: true,
                            monthlyClassLimit: true,
                            membershipDurationMonths: true,
                            membershipScheduleKey: true,
                        },
                    },
                },
            }),
            prisma.ticketType.findMany({
                where: {
                    eventId,
                    monthlyClassLimit: { gt: 0 },
                    membershipDurationMonths: { gt: 0 },
                },
                select: { id: true, name: true, capacity: true, sold: true },
                orderBy: { name: "asc" },
            }),
        ])

        const snapshots: OccupancyTicketSnapshot[] = tickets.map((ticket) => {
            // Mismo adaptador que la ficha (Task 5): sin orden ni entitlements
            // reales porque este endpoint solo necesita el diagnostico de
            // vigencia, no el historial de asistencia.
            const scanTicket = toScanTicket({
                id: ticket.id,
                ticketTypeId: ticket.ticketTypeId,
                status: TicketStatus.ACTIVE,
                eventId,
                membershipStartDate: ticket.membershipStartDate,
                membershipSchedule: ticket.membershipSchedule,
                monthlySchedules: ticket.monthlySchedules,
                membershipFreeze: ticket.membershipFreeze,
                event: {
                    title: ticket.event.title,
                    startDate: ticket.event.startDate,
                    endDate: ticket.event.endDate,
                    membershipStartFixed: ticket.event.membershipStartFixed,
                },
                ticketType: {
                    name: ticket.ticketType.name,
                    isPackage: ticket.ticketType.isPackage,
                    monthlyClassLimit: ticket.ticketType.monthlyClassLimit,
                    membershipDurationMonths: ticket.ticketType.membershipDurationMonths,
                    membershipScheduleKey: ticket.ticketType.membershipScheduleKey,
                },
                entitlements: [],
            })

            const anchor = getMembershipAnchor(scanTicket)
            const period = anchor ? getMembershipPeriod(today, anchor) : null
            const access = getMembershipAccessStatus(scanTicket, today).status

            return {
                id: ticket.id,
                ticketTypeId: ticket.ticketTypeId,
                ticketTypeName: ticket.ticketType.name,
                planKey: ticket.ticketType.membershipScheduleKey,
                baseSchedule: ticket.membershipSchedule,
                monthlySchedules: ticket.monthlySchedules,
                monthIndex: period?.index ?? 0,
                // Cuenta quien de verdad ocupa un lugar en la piscina hoy:
                // descarta los que aun no inician, los vencidos y los congelados
                // este mes.
                //
                // NOT_APPLICABLE tambien cuenta. Ese estado no significa "no
                // vigente" sino "no es membresia a termino fijo": son los
                // carnets legacy sin ancla (getMembershipAccessStatus devuelve
                // NOT_APPLICABLE y el escaner cae a la logica legacy, que los
                // deja entrar). Tienen horario semanal y asisten, asi que
                // ocupan cupo. Descartarlos subcontaba en silencio la matriz
                // con la que el admin decide a donde mover a alguien.
                counts: access === "OK" || access === "NOT_APPLICABLE",
            }
        })

        const occupancy = buildMembershipOccupancy({
            tickets: snapshots,
            planTotals: types.map((type) => ({
                ticketTypeId: type.id,
                name: type.name,
                capacity: type.capacity,
                sold: type.sold,
            })),
        })

        return NextResponse.json({ success: true, data: { events, event, occupancy, today } })
    } catch (error) {
        console.error("Error al calcular la ocupacion de membresias:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
