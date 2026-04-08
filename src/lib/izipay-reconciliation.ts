import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getIzipayQueryLanguage, searchIzipayTransaction } from "@/lib/izipay"
import { acquireLockWithStatus, releaseLock } from "@/lib/cache"
import {
    buildIzipayProviderResponse,
    cancelIzipayOrder,
    fulfillIzipayOrder,
    getIzipayStoredSource,
} from "@/lib/izipay-payment"

type OrderStatusView = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"
type StatusSource = "db" | "ipn" | "query"

const RECONCILE_LOCK_TTL_SECONDS = 30
export const IZIPAY_RECONCILE_COOLDOWN_MS = 30_000
export const IZIPAY_MAX_SYNC_ATTEMPTS = 6
const DEFAULT_RECONCILE_BATCH_SIZE = 25

type OrderSnapshot = {
    id: string
    status: OrderStatusView
    provider: string
    providerRef: string | null
    providerResponse: Prisma.JsonValue | null
    providerOrderNumber: string | null
    providerTransactionId: string | null
    paymentSyncAttempts: number
    paymentLastSyncAt: Date | null
    paymentNeedsReview: boolean
    orderItems: Array<{
        ticketType: {
            event: {
                title: string
            }
        }
    }>
}

export interface IzipayOrderStatusResult {
    success: boolean
    orderId: string
    status: OrderStatusView
    source: StatusSource
    reviewRequired: boolean
    eventTitle: string | null
    processing?: boolean
    message?: string
    error?: string
}

export interface ReconcilePendingIzipayOrdersResult {
    success: boolean
    processed: number
    paid: number
    cancelled: number
    pending: number
    reviewRequired: number
    errors: number
}

function getEventTitle(order: Pick<OrderSnapshot, "orderItems">): string | null {
    return order.orderItems[0]?.ticketType.event.title || null
}

function hasIzipayCorrelation(order: Pick<OrderSnapshot, "providerOrderNumber" | "providerTransactionId">) {
    return Boolean(order.providerOrderNumber && order.providerTransactionId)
}

function isFinalStatus(status: OrderStatusView): boolean {
    return status === "PAID" || status === "CANCELLED" || status === "REFUNDED"
}

function isReconcileThrottled(order: Pick<OrderSnapshot, "paymentLastSyncAt">, now: Date): boolean {
    if (!order.paymentLastSyncAt) {
        return false
    }

    return now.getTime() - order.paymentLastSyncAt.getTime() < IZIPAY_RECONCILE_COOLDOWN_MS
}

async function getOrderSnapshot(orderId: string): Promise<OrderSnapshot | null> {
    return prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            status: true,
            provider: true,
            providerRef: true,
            providerResponse: true,
            providerOrderNumber: true,
            providerTransactionId: true,
            paymentSyncAttempts: true,
            paymentLastSyncAt: true,
            paymentNeedsReview: true,
            orderItems: {
                take: 1,
                select: {
                    ticketType: {
                        select: {
                            event: {
                                select: {
                                    title: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    }) as Promise<OrderSnapshot | null>
}

async function updateSyncState(input: {
    orderId: string
    attempts: number
    lastSyncAt: Date
    reviewRequired: boolean
}) {
    await prisma.order.update({
        where: { id: input.orderId },
        data: {
            paymentSyncAttempts: input.attempts,
            paymentLastSyncAt: input.lastSyncAt,
            paymentNeedsReview: input.reviewRequired,
        },
    })
}

export async function getIzipayOrderStatusById(input: {
    orderId: string
    force?: boolean
}): Promise<IzipayOrderStatusResult> {
    const order = await getOrderSnapshot(input.orderId)

    if (!order) {
        return {
            success: false,
            orderId: input.orderId,
            status: "PENDING",
            source: "db",
            reviewRequired: false,
            eventTitle: null,
            error: "Orden no encontrada",
        }
    }

    const eventTitle = getEventTitle(order)
    const storedSource = getIzipayStoredSource(order.providerResponse)

    if (isFinalStatus(order.status)) {
        return {
            success: true,
            orderId: order.id,
            status: order.status,
            source: storedSource,
            reviewRequired: order.paymentNeedsReview,
            eventTitle,
        }
    }

    if (order.provider !== "IZIPAY" || !hasIzipayCorrelation(order)) {
        return {
            success: true,
            orderId: order.id,
            status: order.status,
            source: "db",
            reviewRequired: order.paymentNeedsReview,
            eventTitle,
        }
    }

    if (order.paymentNeedsReview) {
        return {
            success: true,
            orderId: order.id,
            status: "PENDING",
            source: "db",
            reviewRequired: true,
            eventTitle,
            message: "Pago pendiente de validacion manual",
        }
    }

    const now = new Date()
    if (!input.force && isReconcileThrottled(order, now)) {
        return {
            success: true,
            orderId: order.id,
            status: "PENDING",
            source: "db",
            reviewRequired: false,
            eventTitle,
        }
    }

    const merchantCode = process.env.IZIPAY_MERCHANT_CODE || ""
    if (!merchantCode) {
        return {
            success: false,
            orderId: order.id,
            status: "PENDING",
            source: "db",
            reviewRequired: false,
            eventTitle,
            error: "IZIPAY_MERCHANT_CODE no configurado",
        }
    }

    const lockKey = `izipay:reconcile:order:${order.id}`
    const lockStatus = await acquireLockWithStatus(lockKey, RECONCILE_LOCK_TTL_SECONDS)

    if (lockStatus === "busy") {
        return {
            success: true,
            orderId: order.id,
            status: "PENDING",
            source: "db",
            reviewRequired: false,
            eventTitle,
            processing: true,
        }
    }

    if (lockStatus === "unavailable") {
        return {
            success: false,
            orderId: order.id,
            status: "PENDING",
            source: "db",
            reviewRequired: false,
            eventTitle,
            error: "Lock backend unavailable",
        }
    }

    try {
        const nextAttempts = order.paymentSyncAttempts + 1
        const syncTimestamp = new Date()
        const query = await searchIzipayTransaction({
            merchantCode,
            orderNumber: order.providerOrderNumber || "",
            transactionId: order.providerTransactionId || "",
            language: getIzipayQueryLanguage(),
        })

        if (query.success && query.status === "PAID") {
            const result = await fulfillIzipayOrder({
                orderId: order.id,
                providerRef: query.transactionId || order.providerRef || order.providerTransactionId || undefined,
                providerOrderNumber: order.providerOrderNumber || undefined,
                providerTransactionId: query.transactionId || order.providerTransactionId || undefined,
                providerResponse: buildIzipayProviderResponse(
                    "query",
                    (query.raw || {
                        status: query.status,
                        orderNumber: order.providerOrderNumber,
                        transactionId: query.transactionId || order.providerTransactionId,
                    }) as Prisma.InputJsonValue
                ),
            })

            if (!result.success) {
                const currentOrder = await getOrderSnapshot(order.id)

                if (currentOrder && isFinalStatus(currentOrder.status)) {
                    return {
                        success: true,
                        orderId: currentOrder.id,
                        status: currentOrder.status,
                        source: getIzipayStoredSource(currentOrder.providerResponse),
                        reviewRequired: currentOrder.paymentNeedsReview,
                        eventTitle: getEventTitle(currentOrder),
                    }
                }

                return {
                    success: false,
                    orderId: order.id,
                    status: "PENDING",
                    source: "db",
                    reviewRequired: false,
                    eventTitle,
                    error: result.error || "No se pudo confirmar la orden",
                }
            }

            await updateSyncState({
                orderId: order.id,
                attempts: nextAttempts,
                lastSyncAt: syncTimestamp,
                reviewRequired: false,
            })

            return {
                success: true,
                orderId: order.id,
                status: "PAID",
                source: "query",
                reviewRequired: false,
                eventTitle,
                message: query.message,
            }
        }

        if (query.success && query.status === "CANCELLED") {
            const cancellation = await cancelIzipayOrder({
                orderId: order.id,
                providerOrderNumber: order.providerOrderNumber || undefined,
                providerTransactionId: query.transactionId || order.providerTransactionId || undefined,
                providerResponse: buildIzipayProviderResponse(
                    "query",
                    (query.raw || {
                        status: query.status,
                        orderNumber: order.providerOrderNumber,
                        transactionId: query.transactionId || order.providerTransactionId,
                    }) as Prisma.InputJsonValue
                ),
            })

            if (!cancellation.cancelled) {
                const currentOrder = await getOrderSnapshot(order.id)

                if (currentOrder) {
                    return {
                        success: true,
                        orderId: currentOrder.id,
                        status: currentOrder.status,
                        source: getIzipayStoredSource(currentOrder.providerResponse),
                        reviewRequired: currentOrder.paymentNeedsReview,
                        eventTitle: getEventTitle(currentOrder),
                    }
                }
            }

            await updateSyncState({
                orderId: order.id,
                attempts: nextAttempts,
                lastSyncAt: syncTimestamp,
                reviewRequired: false,
            })

            return {
                success: true,
                orderId: order.id,
                status: "CANCELLED",
                source: "query",
                reviewRequired: false,
                eventTitle,
                message: query.message,
            }
        }

        const reviewRequired = nextAttempts >= IZIPAY_MAX_SYNC_ATTEMPTS
        await updateSyncState({
            orderId: order.id,
            attempts: nextAttempts,
            lastSyncAt: syncTimestamp,
            reviewRequired,
        })

        return {
            success: true,
            orderId: order.id,
            status: "PENDING",
            source: query.success ? "query" : "db",
            reviewRequired,
            eventTitle,
            message: query.message || query.error,
        }
    } finally {
        await releaseLock(lockKey)
    }
}

export async function reconcilePendingIzipayOrders(options?: {
    batchSize?: number
}): Promise<ReconcilePendingIzipayOrdersResult> {
    const cutoff = new Date(Date.now() - IZIPAY_RECONCILE_COOLDOWN_MS)
    const batchSize = options?.batchSize ?? DEFAULT_RECONCILE_BATCH_SIZE

    const orders = await prisma.order.findMany({
        where: {
            status: "PENDING",
            provider: "IZIPAY",
            paymentNeedsReview: false,
            providerOrderNumber: { not: null },
            providerTransactionId: { not: null },
            OR: [
                { paymentLastSyncAt: null },
                { paymentLastSyncAt: { lte: cutoff } },
            ],
        },
        select: {
            id: true,
        },
        orderBy: { createdAt: "asc" },
        take: batchSize,
    })

    const result: ReconcilePendingIzipayOrdersResult = {
        success: true,
        processed: 0,
        paid: 0,
        cancelled: 0,
        pending: 0,
        reviewRequired: 0,
        errors: 0,
    }

    for (const order of orders) {
        const reconciliation = await getIzipayOrderStatusById({
            orderId: order.id,
            force: true,
        })

        result.processed += 1

        if (!reconciliation.success) {
            result.errors += 1
            continue
        }

        if (reconciliation.status === "PAID") {
            result.paid += 1
            continue
        }

        if (reconciliation.status === "CANCELLED") {
            result.cancelled += 1
            continue
        }

        if (reconciliation.reviewRequired) {
            result.reviewRequired += 1
            continue
        }

        result.pending += 1
    }

    return result
}
