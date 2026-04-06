import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
    buildServilexPayload,
    buildStableTraceId,
    getServilexConfig,
    getServilexMissingConfig,
    sendServilexInvoice,
} from "@/lib/servilex"

type InvoiceQueueItem = Awaited<ReturnType<typeof loadInvoices>>[number]

const CLAIMABLE_STATUSES = ["PENDING", "FAILED", "FAILED_RETRYABLE"] as const

const toJsonValue = (
    value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput => {
    if (value === undefined || value === null) return Prisma.JsonNull
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value) ||
        typeof value === "object"
    ) {
        return value as Prisma.InputJsonValue
    }
    return String(value)
}

async function loadInvoices(maxJobs: number) {
    const config = getServilexConfig()
    return prisma.invoice.findMany({
        where: {
            servilexIndicator: { not: null },
            order: {
                status: "PAID",
            },
            OR: [
                { status: "PENDING" },
                {
                    status: "FAILED_RETRYABLE",
                    retryCount: { lt: config.maxRetries },
                },
                {
                    status: "FAILED",
                    retryCount: { lt: config.maxRetries },
                },
            ],
        },
        include: {
            order: {
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                        },
                    },
                    orderItems: {
                        include: {
                            ticketType: {
                                include: {
                                    event: {
                                        select: {
                                            id: true,
                                            startDate: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        orderBy: { createdAt: "asc" },
        take: maxJobs,
    })
}

async function claimInvoice(invoiceId: string) {
    const result = await prisma.invoice.updateMany({
        where: {
            id: invoiceId,
            status: { in: [...CLAIMABLE_STATUSES] },
        },
        data: {
            status: "PROCESSING",
            sentAt: new Date(),
        },
    })

    return result.count === 1
}

async function markInvoiceIssued(
    invoice: InvoiceQueueItem,
    response: Awaited<ReturnType<typeof sendServilexInvoice>>
) {
    const now = new Date()

    await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
            status: "ISSUED",
            traceId: buildStableTraceId(invoice),
            requestPayload: response.rawPayload,
            requestSignature: response.signature,
            httpStatus: response.status,
            providerResponse: toJsonValue(response.responseBody),
            reciboHash: response.reciboHash || invoice.reciboHash,
            pdfUrl: response.pdfUrl || invoice.pdfUrl,
            invoiceNumber: response.invoiceNumber || invoice.invoiceNumber,
            sentToProvider: true,
            sentAt: now,
            issuedAt: invoice.issuedAt || now,
            lastError: null,
        },
    })
}

async function markInvoiceFailed(
    invoice: InvoiceQueueItem,
    traceId: string,
    rawPayload: string | null,
    signature: string | null,
    status: number | null,
    responseBody: unknown,
    errorMessage: string
) {
    const config = getServilexConfig()
    const nextRetryCount = invoice.retryCount + 1
    const nextStatus =
        nextRetryCount >= config.maxRetries
            ? "FAILED_REQUIRES_REVIEW"
            : "FAILED_RETRYABLE"

    await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
            status: nextStatus,
            traceId,
            requestPayload: rawPayload,
            requestSignature: signature,
            httpStatus: status,
            providerResponse: toJsonValue(responseBody),
            sentAt: new Date(),
            retryCount: { increment: 1 },
            lastError: errorMessage,
        },
    })
}

let isProcessing = false

export async function getInvoiceQueueStats() {
    const [pending, processing, failed, issued] = await Promise.all([
        prisma.invoice.count({
            where: {
                status: {
                    in: ["PENDING", "FAILED", "FAILED_RETRYABLE"],
                },
            },
        }),
        prisma.invoice.count({ where: { status: "PROCESSING" } }),
        prisma.invoice.count({
            where: {
                status: {
                    in: ["FAILED_REQUIRES_REVIEW"],
                },
            },
        }),
        prisma.invoice.count({ where: { status: "ISSUED" } }),
    ])

    return { pending, processing, failed, issued }
}

export async function processInvoiceQueue(maxJobs: number = 10): Promise<{
    processed: number
    failed: number
    skipped: number
}> {
    const config = getServilexConfig()
    if (!config.enabled || isProcessing) {
        return { processed: 0, failed: 0, skipped: 0 }
    }

    isProcessing = true
    let processed = 0
    let failed = 0
    let skipped = 0

    try {
        const invoices = await loadInvoices(maxJobs)
        const missingConfig = getServilexMissingConfig(config)

        for (const invoice of invoices) {
            const claimed = await claimInvoice(invoice.id)

            if (!claimed) {
                skipped += 1
                continue
            }

            if (missingConfig.length > 0) {
                await markInvoiceFailed(
                    invoice,
                    buildStableTraceId(invoice),
                    null,
                    null,
                    null,
                    null,
                    `Configuracion Servilex incompleta: ${missingConfig.join(", ")}`
                )
                failed += 1
                continue
            }

            try {
                const payload = buildServilexPayload(
                    {
                        ...invoice,
                        servilexAssignedTotal: invoice.assignedTotal,
                    },
                    config
                )
                const response = await sendServilexInvoice(payload, config)

                if (response.ok) {
                    await markInvoiceIssued(invoice, response)
                    processed += 1
                    continue
                }

                await markInvoiceFailed(
                    invoice,
                    buildStableTraceId(invoice),
                    response.rawPayload,
                    response.signature,
                    response.status,
                    response.responseBody,
                    response.errorMessage || "Error enviando invoice a Servilex"
                )
                failed += 1
            } catch (error) {
                const message = error instanceof Error ? error.message : "Error procesando invoice"
                await markInvoiceFailed(
                    invoice,
                    buildStableTraceId(invoice),
                    null,
                    null,
                    null,
                    null,
                    message
                )
                failed += 1
            }
        }
    } finally {
        isProcessing = false
    }

    return { processed, failed, skipped }
}
