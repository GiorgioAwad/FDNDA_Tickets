import { NextRequest, NextResponse } from "next/server"
import { OrderStatus, TicketStatus, UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { buildEventCapacityReportRows } from "@/lib/event-capacity-report"
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

        // El reporte es transversal: el selector incluye membresias, academia,
        // piscina libre y cualquier evento general creado en la plataforma.
        const events = await prisma.event.findMany({
            select: {
                id: true,
                title: true,
                category: true,
                servilexSucursalCode: true,
                startDate: true,
                endDate: true,
            },
            orderBy: { startDate: "desc" },
        })

        if (!eventId) {
            return NextResponse.json({ success: true, data: { events, occupancy: null, event: null } })
        }
        const event = events.find((candidate) => candidate.id === eventId)
        if (!event) {
            return NextResponse.json(
                { success: false, error: "Evento no encontrado" },
                { status: 404 }
            )
        }

        const today = getTodayDateString()

        const [tickets, types, eventDays] = await Promise.all([
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
                where: { eventId },
                select: {
                    id: true,
                    name: true,
                    capacity: true,
                    sold: true,
                    capacityByDate: true,
                    isPackage: true,
                    packageDaysCount: true,
                    validDays: true,
                    membershipScheduleKey: true,
                    membershipDurationMonths: true,
                    monthlyClassLimit: true,
                    price: true,
                    isActive: true,
                    dateInventories: {
                        select: { date: true, capacity: true, sold: true, isEnabled: true },
                        orderBy: { date: "asc" },
                    },
                },
                orderBy: { name: "asc" },
            }),
            prisma.eventDay.findMany({
                where: { eventId },
                select: { date: true, openTime: true, closeTime: true },
                orderBy: { date: "asc" },
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
                durationMonths: ticket.ticketType.membershipDurationMonths,
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

        const membershipTypes = types.filter(
            (type) =>
                (type.monthlyClassLimit ?? 0) > 0 &&
                (type.membershipDurationMonths ?? 0) > 0
        )
        const occupancy = buildMembershipOccupancy({
            tickets: snapshots,
            planTotals: membershipTypes.map((type) => ({
                ticketTypeId: type.id,
                name: type.name,
                capacity: type.capacity,
                sold: type.sold,
                planKey: type.membershipScheduleKey,
                durationMonths: type.membershipDurationMonths,
                monthlyClassLimit: type.monthlyClassLimit,
                price: Number(type.price),
                isActive: type.isActive,
            })),
            sucursalCode: event.servilexSucursalCode,
        })

        const capacityRows = buildEventCapacityReportRows({
            event: {
                category: event.category,
                startDate: event.startDate,
                endDate: event.endDate,
                eventDays,
            },
            ticketTypes: types,
            membershipOccupancy: occupancy,
        })

        return NextResponse.json({
            success: true,
            data: { events, event, occupancy, capacityRows, today },
        })
    } catch (error) {
        console.error("Error al calcular el reporte de cupos y horarios:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
