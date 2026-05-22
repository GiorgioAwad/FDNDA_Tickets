import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import type { Prisma, TicketIssuanceOutcome } from "@prisma/client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const VALID_OUTCOMES: TicketIssuanceOutcome[] = [
    "OK",
    "NO_ENTITLEMENT",
    "TICKET_NOT_ACTIVE",
    "TICKET_NOT_FOUND",
    "UNAUTHORIZED",
    "QR_GENERATION_ERROR",
    "INTERNAL_ERROR",
]

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const outcomeParam = searchParams.get("outcome")
        const ticketIdParam = searchParams.get("ticketId")?.trim()
        const userIdParam = searchParams.get("userId")?.trim()
        const onlyProblemsParam = searchParams.get("onlyProblems") === "true"
        const limitRaw = Number(searchParams.get("limit") ?? DEFAULT_LIMIT)
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), MAX_LIMIT) : DEFAULT_LIMIT

        const where: Prisma.TicketIssuanceLogWhereInput = {}

        if (outcomeParam && VALID_OUTCOMES.includes(outcomeParam as TicketIssuanceOutcome)) {
            where.outcome = outcomeParam as TicketIssuanceOutcome
        } else if (onlyProblemsParam) {
            where.outcome = { not: "OK" }
        }

        if (ticketIdParam) where.ticketId = ticketIdParam
        if (userIdParam) where.userId = userIdParam

        const logs = await prisma.ticketIssuanceLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
        })

        const ticketIds = Array.from(new Set(logs.map((l) => l.ticketId).filter((v): v is string => Boolean(v))))
        const userIds = Array.from(new Set(logs.map((l) => l.userId).filter((v): v is string => Boolean(v))))
        const eventIds = Array.from(new Set(logs.map((l) => l.eventId).filter((v): v is string => Boolean(v))))

        const [tickets, users, events] = await Promise.all([
            ticketIds.length
                ? prisma.ticket.findMany({
                      where: { id: { in: ticketIds } },
                      select: { id: true, ticketCode: true, attendeeName: true, status: true },
                  })
                : [],
            userIds.length
                ? prisma.user.findMany({
                      where: { id: { in: userIds } },
                      select: { id: true, name: true, email: true },
                  })
                : [],
            eventIds.length
                ? prisma.event.findMany({
                      where: { id: { in: eventIds } },
                      select: { id: true, title: true },
                  })
                : [],
        ])

        const ticketMap = new Map(tickets.map((t) => [t.id, t]))
        const userMap = new Map(users.map((u) => [u.id, u]))
        const eventMap = new Map(events.map((e) => [e.id, e]))

        const counts = await prisma.ticketIssuanceLog.groupBy({
            by: ["outcome"],
            _count: { _all: true },
            where: {
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
        })

        return NextResponse.json({
            success: true,
            data: {
                logs: logs.map((log) => ({
                    id: log.id,
                    outcome: log.outcome,
                    reason: log.reason,
                    qrDate: log.qrDate,
                    qrShift: log.qrShift,
                    requestedDate: log.requestedDate,
                    userAgent: log.userAgent,
                    ipAddress: log.ipAddress,
                    createdAt: log.createdAt.toISOString(),
                    ticket: log.ticketId ? ticketMap.get(log.ticketId) ?? { id: log.ticketId } : null,
                    user: log.userId ? userMap.get(log.userId) ?? { id: log.userId } : null,
                    event: log.eventId ? eventMap.get(log.eventId) ?? { id: log.eventId } : null,
                })),
                summary7d: counts.map((c) => ({ outcome: c.outcome, count: c._count._all })),
                limit,
            },
        })
    } catch (error) {
        console.error("Error fetching ticket issuance logs:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener logs" },
            { status: 500 }
        )
    }
}
