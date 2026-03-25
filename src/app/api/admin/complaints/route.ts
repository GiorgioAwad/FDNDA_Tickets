import { NextRequest, NextResponse } from "next/server"
import { ComplaintBookStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

const ALLOWED_STATUSES = new Set(Object.values(ComplaintBookStatus))

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { searchParams } = new URL(request.url)
        const query = searchParams.get("query")?.trim() || ""
        const status = searchParams.get("status")?.trim() || "ALL"
        const page = Math.max(1, Number(searchParams.get("page") || "1"))
        const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || "20")))

        const queryFilter = query
            ? {
                  OR: [
                      { ticketNumber: { contains: query, mode: "insensitive" as const } },
                      { customerName: { contains: query, mode: "insensitive" as const } },
                      { email: { contains: query, mode: "insensitive" as const } },
                      { documentNumber: { contains: query, mode: "insensitive" as const } },
                      { subjectDescription: { contains: query, mode: "insensitive" as const } },
                      { orderId: { contains: query, mode: "insensitive" as const } },
                      { eventName: { contains: query, mode: "insensitive" as const } },
                  ],
              }
            : {}

        const where = {
            ...queryFilter,
            ...(status !== "ALL" && ALLOWED_STATUSES.has(status as ComplaintBookStatus)
                ? { status: status as ComplaintBookStatus }
                : {}),
        }

        const [entries, total, summary] = await Promise.all([
            prisma.complaintBookEntry.findMany({
                where,
                orderBy: [{ createdAt: "desc" }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    ticketNumber: true,
                    type: true,
                    status: true,
                    customerName: true,
                    email: true,
                    eventName: true,
                    orderId: true,
                    subjectDescription: true,
                    createdAt: true,
                    respondedAt: true,
                },
            }),
            prisma.complaintBookEntry.count({ where }),
            prisma.complaintBookEntry.groupBy({
                by: ["status"],
                where: queryFilter,
                _count: { _all: true },
            }),
        ])

        const stats = {
            total: summary.reduce((acc, item) => acc + item._count._all, 0),
            received: summary.find((item) => item.status === "RECEIVED")?._count._all || 0,
            inReview: summary.find((item) => item.status === "IN_REVIEW")?._count._all || 0,
            responded: summary.find((item) => item.status === "RESPONDED")?._count._all || 0,
            closed: summary.find((item) => item.status === "CLOSED")?._count._all || 0,
        }

        return NextResponse.json({
            success: true,
            data: {
                entries,
                stats,
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / pageSize)),
                },
            },
        })
    } catch (error) {
        console.error("Error loading complaint book entries:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo cargar el libro de reclamaciones." },
            { status: 500 }
        )
    }
}
