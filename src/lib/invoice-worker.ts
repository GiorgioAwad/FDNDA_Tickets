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
            order: {
                status: "PAID",
            },
            OR: [
                { status: "PENDING" },
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
    await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
            status: "FAILED",
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
    const [pending, failed, issued] = await Promise.all([
        prisma.invoice.count({ where: { status: "PENDING" } }),
        prisma.invoice.count({ where: { status: "FAILED" } }),
        prisma.invoice.count({ where: { status: "ISSUED" } }),
    ])

    return { pending, failed, issued }
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
                failed++
                continue
            }

            try {
                const payload = buildServilexPayload(invoice, config)
                const response = await sendServilexInvoice(payload, config)

                if (response.ok) {
                    await markInvoiceIssued(invoice, response)
                    processed++
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
                failed++
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
                failed++
            }
        }

        skipped = Math.max(0, invoices.length - processed - failed)
    } finally {
        isProcessing = false
    }

    return { processed, failed, skipped }
}
