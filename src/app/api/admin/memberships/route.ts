import { NextRequest, NextResponse } from "next/server"
import { OrderStatus, Prisma, TicketStatus, UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { isBlackoutMonth } from "@/lib/membership-config"
import { prisma } from "@/lib/prisma"
import { formatDateUTC } from "@/lib/qr"
import {
    getMembershipExpiry,
    getMembershipFreezeRanges,
    type MembershipFreezeMonthRange,
} from "@/lib/scan-helpers"
import { parseDateOnly } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100

const TICKET_STATUS_VALUES = new Set<TicketStatus>([
    TicketStatus.ACTIVE,
    TicketStatus.CANCELLED,
    TicketStatus.EXPIRED,
])

const membershipTicketSelect = {
    id: true,
    orderId: true,
    userId: true,
    eventId: true,
    ticketTypeId: true,
    ticketCode: true,
    attendeeName: true,
    attendeeDni: true,
    membershipStartDate: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    event: {
        select: {
            id: true,
            title: true,
            venue: true,
            location: true,
            servilexSucursalCode: true,
            startDate: true,
            endDate: true,
            membershipStartFixed: true,
            membershipStartMin: true,
            membershipStartMax: true,
        },
    },
    ticketType: {
        select: {
            id: true,
            name: true,
            monthlyClassLimit: true,
            membershipDurationMonths: true,
            membershipScheduleKey: true,
            allowMultipleDailyScans: true,
        },
    },
    order: {
        select: {
            id: true,
            status: true,
            paidAt: true,
            buyerName: true,
            buyerDocNumber: true,
            buyerPhone: true,
        },
    },
    user: {
        select: {
            id: true,
            name: true,
            email: true,
        },
    },
    membershipFreeze: {
        select: {
            id: true,
            month: true,
            startDate: true,
            endDate: true,
        },
    },
    _count: {
        select: {
            scans: true,
        },
    },
} satisfies Prisma.TicketSelect

type MembershipTicketRecord = Prisma.TicketGetPayload<{ select: typeof membershipTicketSelect }>

const membershipTicketWhere: Prisma.TicketWhereInput = {
    order: { status: OrderStatus.PAID },
    ticketType: {
        monthlyClassLimit: { gt: 0 },
        membershipDurationMonths: { gt: 0 },
    },
}

function dateKey(date: Date | null | undefined) {
    return date ? formatDateUTC(date) : null
}

function getFreezeRanges(ticket: Pick<MembershipTicketRecord, "membershipFreeze">) {
    return getMembershipFreezeRanges(ticket).map((freeze) => ({
        month: freeze.month,
        startStr: freeze.startStr,
        endStr: freeze.endStr,
    }))
}

function serializeMembershipTicket(ticket: MembershipTicketRecord) {
    const durationMonths = ticket.ticketType.membershipDurationMonths ?? 0
    const monthlyClassLimit = ticket.ticketType.monthlyClassLimit ?? 0
    const resolvedStartDate = ticket.membershipStartDate ?? ticket.event.membershipStartFixed ?? null
    const freezeRanges = getFreezeRanges(ticket)
    const membershipExpiry =
        resolvedStartDate && durationMonths > 0
            ? getMembershipExpiry(resolvedStartDate, durationMonths, undefined, freezeRanges)
            : null

    return {
        id: ticket.id,
        orderId: ticket.orderId,
        userId: ticket.userId,
        eventId: ticket.eventId,
        ticketTypeId: ticket.ticketTypeId,
        ticketCode: ticket.ticketCode,
        status: ticket.status,
        attendeeName: ticket.attendeeName,
        attendeeDni: ticket.attendeeDni,
        membershipStartDate: dateKey(ticket.membershipStartDate),
        resolvedMembershipStartDate: dateKey(resolvedStartDate),
        startSource: ticket.membershipStartDate
            ? "ticket"
            : ticket.event.membershipStartFixed
              ? "event"
              : null,
        membershipExpiry,
        monthlyClassLimit,
        durationMonths,
        scanCount: ticket._count.scans,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        paidAt: ticket.order.paidAt?.toISOString() ?? null,
        event: {
            id: ticket.event.id,
            title: ticket.event.title,
            venue: ticket.event.venue,
            location: ticket.event.location,
            servilexSucursalCode: ticket.event.servilexSucursalCode,
            startDate: dateKey(ticket.event.startDate),
            endDate: dateKey(ticket.event.endDate),
            membershipStartFixed: dateKey(ticket.event.membershipStartFixed),
            membershipStartMin: dateKey(ticket.event.membershipStartMin),
            membershipStartMax: dateKey(ticket.event.membershipStartMax),
        },
        ticketType: {
            id: ticket.ticketType.id,
            name: ticket.ticketType.name,
            monthlyClassLimit,
            membershipDurationMonths: durationMonths,
            membershipScheduleKey: ticket.ticketType.membershipScheduleKey,
            allowMultipleDailyScans: ticket.ticketType.allowMultipleDailyScans,
        },
        order: {
            id: ticket.order.id,
            status: ticket.order.status,
            buyerName: ticket.order.buyerName,
            buyerDocNumber: ticket.order.buyerDocNumber,
            buyerPhone: ticket.order.buyerPhone,
        },
        user: ticket.user,
        freeze: ticket.membershipFreeze
            ? {
                  id: ticket.membershipFreeze.id,
                  month: ticket.membershipFreeze.month,
                  startDate: dateKey(ticket.membershipFreeze.startDate),
                  endDate: dateKey(ticket.membershipFreeze.endDate),
              }
            : null,
    }
}

function buildSearchFilter(search: string): Prisma.TicketWhereInput {
    if (!search) return {}

    return {
        OR: [
            { ticketCode: { contains: search, mode: "insensitive" } },
            { attendeeName: { contains: search, mode: "insensitive" } },
            { attendeeDni: { contains: search, mode: "insensitive" } },
            { user: { name: { contains: search, mode: "insensitive" } } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            { order: { buyerName: { contains: search, mode: "insensitive" } } },
            { order: { buyerDocNumber: { contains: search, mode: "insensitive" } } },
            { order: { buyerPhone: { contains: search, mode: "insensitive" } } },
            { event: { title: { contains: search, mode: "insensitive" } } },
            { event: { venue: { contains: search, mode: "insensitive" } } },
            { event: { location: { contains: search, mode: "insensitive" } } },
            { ticketType: { name: { contains: search, mode: "insensitive" } } },
        ],
    }
}

function isValidDateKey(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day
    )
}

function validateMembershipStartDateInput(value: string) {
    if (!isValidDateKey(value)) {
        return "Selecciona una fecha valida."
    }

    const month = Number(value.slice(5, 7))
    if (isBlackoutMonth(month)) {
        return "Enero y febrero no se pueden usar como inicio de membresia."
    }

    return null
}

function findInvalidFreezeRange(
    startDate: string,
    durationMonths: number,
    freezeRanges: MembershipFreezeMonthRange[]
) {
    const baseExpiry = getMembershipExpiry(parseDateOnly(startDate), durationMonths, undefined, [])
    return freezeRanges.find((freeze) => freeze.startStr < startDate || freeze.endStr > baseExpiry) ?? null
}

async function requireAdmin() {
    const user = await getCurrentUser()
    return user?.role === UserRole.ADMIN
}

export async function GET(request: NextRequest) {
    try {
        if (!(await requireAdmin())) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const page = Math.max(1, Number(searchParams.get("page") || "1"))
        const pageSize = Math.min(
            PAGE_SIZE_MAX,
            Math.max(1, Number(searchParams.get("pageSize") || String(PAGE_SIZE_DEFAULT)))
        )
        const search = searchParams.get("search")?.trim() || ""
        const statusParam = (searchParams.get("status") || "ACTIVE").toUpperCase()

        const statusFilter: Prisma.TicketWhereInput =
            statusParam !== "ALL" && TICKET_STATUS_VALUES.has(statusParam as TicketStatus)
                ? { status: statusParam as TicketStatus }
                : {}

        const where: Prisma.TicketWhereInput = {
            ...membershipTicketWhere,
            ...buildSearchFilter(search),
            ...statusFilter,
        }

        const [tickets, total, totalMemberships, activeMemberships, missingTicketStart] =
            await Promise.all([
                prisma.ticket.findMany({
                    where,
                    select: membershipTicketSelect,
                    orderBy: { createdAt: "desc" },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
                prisma.ticket.count({ where }),
                prisma.ticket.count({ where: membershipTicketWhere }),
                prisma.ticket.count({
                    where: { ...membershipTicketWhere, status: TicketStatus.ACTIVE },
                }),
                prisma.ticket.count({
                    where: {
                        ...membershipTicketWhere,
                        status: TicketStatus.ACTIVE,
                        membershipStartDate: null,
                    },
                }),
            ])

        return NextResponse.json({
            success: true,
            data: {
                memberships: tickets.map(serializeMembershipTicket),
                stats: {
                    totalMemberships,
                    activeMemberships,
                    missingTicketStart,
                    filteredTotal: total,
                },
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / pageSize)),
                },
            },
        })
    } catch (error) {
        console.error("Error fetching memberships:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener membresias" },
            { status: 500 }
        )
    }
}

export async function PATCH(request: NextRequest) {
    try {
        if (!(await requireAdmin())) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json().catch(() => null)
        const ticketId = typeof body?.ticketId === "string" ? body.ticketId.trim() : ""
        const membershipStartDate =
            typeof body?.membershipStartDate === "string" ? body.membershipStartDate.trim() : ""

        if (!ticketId) {
            return NextResponse.json(
                { success: false, error: "Ticket requerido" },
                { status: 400 }
            )
        }

        const validationError = validateMembershipStartDateInput(membershipStartDate)
        if (validationError) {
            return NextResponse.json(
                { success: false, error: validationError },
                { status: 400 }
            )
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: membershipTicketSelect,
        })

        if (!ticket) {
            return NextResponse.json(
                { success: false, error: "Membresia no encontrada" },
                { status: 404 }
            )
        }

        const durationMonths = ticket.ticketType.membershipDurationMonths ?? 0
        const monthlyClassLimit = ticket.ticketType.monthlyClassLimit ?? 0
        if (
            ticket.order.status !== OrderStatus.PAID ||
            durationMonths <= 0 ||
            monthlyClassLimit <= 0
        ) {
            return NextResponse.json(
                { success: false, error: "El ticket no corresponde a una membresia vigente" },
                { status: 400 }
            )
        }

        if (ticket.status !== TicketStatus.ACTIVE) {
            return NextResponse.json(
                { success: false, error: "Solo se pueden editar membresias activas" },
                { status: 400 }
            )
        }

        const freezeRanges = getFreezeRanges(ticket)
        const invalidFreeze = findInvalidFreezeRange(
            membershipStartDate,
            durationMonths,
            freezeRanges
        )
        if (invalidFreeze) {
            return NextResponse.json(
                {
                    success: false,
                    error: `El congelamiento ${invalidFreeze.month} queda fuera de la nueva vigencia.`,
                },
                { status: 400 }
            )
        }

        const updatedTicket = await prisma.ticket.update({
            where: { id: ticket.id },
            data: { membershipStartDate: parseDateOnly(membershipStartDate) },
            select: membershipTicketSelect,
        })

        return NextResponse.json({
            success: true,
            data: {
                membership: serializeMembershipTicket(updatedTicket),
            },
        })
    } catch (error) {
        console.error("Error updating membership start date:", error)
        return NextResponse.json(
            { success: false, error: "Error al actualizar la membresia" },
            { status: 500 }
        )
    }
}
