import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import type { Prisma, InvoiceStatus } from "@prisma/client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const VALID_STATUSES: InvoiceStatus[] = [
    "PENDING",
    "PROCESSING",
    "ISSUED",
    "FAILED",
    "FAILED_RETRYABLE",
    "FAILED_REQUIRES_REVIEW",
]

const PROBLEM_STATUSES: InvoiceStatus[] = [
    "PENDING",
    "FAILED",
    "FAILED_RETRYABLE",
    "FAILED_REQUIRES_REVIEW",
]

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function safeStringifyResponse(value: unknown): string | null {
    if (value === null || value === undefined) return null
    try {
        const json = typeof value === "string" ? value : JSON.stringify(value)
        if (!json) return null
        return json.length > 2000 ? `${json.slice(0, 2000)}...` : json
    } catch {
        return null
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const statusParam = searchParams.get("status")
        const onlyProblemsParam = searchParams.get("onlyProblems") === "true"
        const searchTerm = searchParams.get("q")?.trim()
        const limitRaw = Number(searchParams.get("limit") ?? DEFAULT_LIMIT)
        const limit = Number.isFinite(limitRaw)
            ? Math.min(Math.max(Math.floor(limitRaw), 1), MAX_LIMIT)
            : DEFAULT_LIMIT

        const where: Prisma.InvoiceWhereInput = {}

        if (statusParam && VALID_STATUSES.includes(statusParam as InvoiceStatus)) {
            where.status = statusParam as InvoiceStatus
        } else if (onlyProblemsParam) {
            where.status = { in: PROBLEM_STATUSES }
        }

        if (searchTerm) {
            where.OR = [
                { orderId: { contains: searchTerm, mode: "insensitive" } },
                { invoiceNumber: { contains: searchTerm, mode: "insensitive" } },
                { traceId: { contains: searchTerm, mode: "insensitive" } },
                { buyerEmail: { contains: searchTerm, mode: "insensitive" } },
                { buyerDocNumber: { contains: searchTerm, mode: "insensitive" } },
                { buyerName: { contains: searchTerm, mode: "insensitive" } },
                {
                    order: {
                        user: {
                            email: { contains: searchTerm, mode: "insensitive" },
                        },
                    },
                },
            ]
        }

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
            include: {
                order: {
                    select: {
                        id: true,
                        status: true,
                        totalAmount: true,
                        currency: true,
                        paidAt: true,
                        createdAt: true,
                        user: {
                            select: { id: true, name: true, email: true },
                        },
                    },
                },
            },
        })

        const counts = await prisma.invoice.groupBy({
            by: ["status"],
            _count: { _all: true },
            where: {
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
        })

        return NextResponse.json({
            success: true,
            data: {
                invoices: invoices.map((invoice) => ({
                    id: invoice.id,
                    orderId: invoice.orderId,
                    traceId: invoice.traceId,
                    invoiceNumber: invoice.invoiceNumber,
                    documentType: invoice.documentType,
                    status: invoice.status,
                    indicator: invoice.servilexIndicator,
                    sucursalCode: invoice.servilexSucursalCode,
                    assignedTotal: Number(invoice.assignedTotal),
                    buyerName: invoice.buyerName,
                    buyerDocType: invoice.buyerDocType,
                    buyerDocNumber: invoice.buyerDocNumber,
                    buyerEmail: invoice.buyerEmail,
                    httpStatus: invoice.httpStatus,
                    lastError: invoice.lastError,
                    retryCount: invoice.retryCount,
                    providerResponse: safeStringifyResponse(invoice.providerResponse),
                    pdfUrl: invoice.pdfUrl,
                    sentToProvider: invoice.sentToProvider,
                    sentAt: invoice.sentAt ? invoice.sentAt.toISOString() : null,
                    issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
                    createdAt: invoice.createdAt.toISOString(),
                    order: invoice.order
                        ? {
                              id: invoice.order.id,
                              status: invoice.order.status,
                              totalAmount: Number(invoice.order.totalAmount),
                              currency: invoice.order.currency,
                              paidAt: invoice.order.paidAt ? invoice.order.paidAt.toISOString() : null,
                              createdAt: invoice.order.createdAt.toISOString(),
                              user: invoice.order.user
                                  ? {
                                        id: invoice.order.user.id,
                                        name: invoice.order.user.name,
                                        email: invoice.order.user.email,
                                    }
                                  : null,
                          }
                        : null,
                })),
                summary7d: counts.map((c) => ({ status: c.status, count: c._count._all })),
                limit,
            },
        })
    } catch (error) {
        console.error("Error fetching ABIO invoices:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener invoices" },
            { status: 500 }
        )
    }
}
