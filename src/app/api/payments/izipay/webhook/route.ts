import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import {
    parseEmbeddedAnswer,
    parseIzipayWebCoreResponse,
    verifyEmbeddedIpnHash,
    verifyIzipayWebhookSignature,
    verifyIzipayWebCoreSignature,
    type IzipayWebhookPayload,
    type IzipayWebCorePaymentResponse,
} from "@/lib/izipay"
import { acquireLock, releaseLock } from "@/lib/cache"
import {
    cancelIzipayOrder,
    fulfillIzipayOrder,
    resolveIzipayOrderId,
} from "@/lib/izipay-payment"

export const runtime = "nodejs"

const WEBHOOK_LOCK_TTL_SECONDS = 30

function isEmbeddedIpn(body: Record<string, unknown>): boolean {
    return typeof body["kr-answer"] === "string" && typeof body["kr-hash"] === "string"
}

function isWebCoreNotification(body: Record<string, unknown>): boolean {
    return (
        typeof body.code === "string" &&
        typeof body.payloadHttp === "string" &&
        typeof body.signature === "string"
    )
}

async function handleEmbeddedIpn(body: Record<string, unknown>): Promise<NextResponse> {
    const krAnswer = body["kr-answer"] as string
    const krHash = body["kr-hash"] as string

    const isValid = verifyEmbeddedIpnHash(krAnswer, krHash)
    if (!isValid) {
        return NextResponse.json(
            { success: false, error: "Invalid signature" },
            { status: 401 }
        )
    }

    const paymentResult = parseEmbeddedAnswer(krAnswer)
    if (!paymentResult || !paymentResult.orderId) {
        return NextResponse.json(
            { success: false, error: "Invalid IPN data" },
            { status: 400 }
        )
    }

    const resolvedOrderId = await resolveIzipayOrderId(paymentResult.orderId)
    if (!resolvedOrderId) {
        return NextResponse.json(
            { success: false, error: "Order not found" },
            { status: 404 }
        )
    }

    const lockKey = `webhook:order:${resolvedOrderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

        if (!lockAcquired) {
            return NextResponse.json({ success: true, processing: true })
        }

        if (paymentResult.status === "PAID") {
            const result = await fulfillIzipayOrder({
                orderId: resolvedOrderId,
                providerRef: paymentResult.transactionId,
                providerResponse: JSON.parse(krAnswer) as Prisma.InputJsonValue,
            })

            if (!result.success) {
                return NextResponse.json(
                    { success: false, error: result.error || "Failed to fulfill order" },
                    { status: 500 }
                )
            }
        } else if (paymentResult.status === "CANCELLED" || paymentResult.status === "ERROR") {
            await cancelIzipayOrder({
                orderId: resolvedOrderId,
                providerResponse: JSON.parse(krAnswer) as Prisma.InputJsonValue,
            })
        }

        return NextResponse.json({ success: true })
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
}

async function handleWebCoreNotification(
    paymentResponse: IzipayWebCorePaymentResponse
): Promise<NextResponse> {
    const isValid = verifyIzipayWebCoreSignature(paymentResponse)
    if (!isValid) {
        return NextResponse.json(
            { success: false, error: "Invalid signature" },
            { status: 401 }
        )
    }

    const paymentResult = parseIzipayWebCoreResponse(paymentResponse)
    if (!paymentResult || !paymentResult.orderId) {
        return NextResponse.json(
            { success: false, error: "Invalid notification data" },
            { status: 400 }
        )
    }

    const resolvedOrderId = await resolveIzipayOrderId(paymentResult.orderId)
    if (!resolvedOrderId) {
        return NextResponse.json(
            { success: false, error: "Order not found" },
            { status: 404 }
        )
    }

    const lockKey = `webhook:order:${resolvedOrderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

        if (!lockAcquired) {
            return NextResponse.json({ success: true, processing: true })
        }

        if (paymentResult.status === "PAID") {
            const result = await fulfillIzipayOrder({
                orderId: resolvedOrderId,
                providerRef: paymentResult.transactionId,
                providerResponse: paymentResponse as unknown as Prisma.InputJsonValue,
            })

            if (!result.success) {
                return NextResponse.json(
                    { success: false, error: result.error || "Failed to fulfill order" },
                    { status: 500 }
                )
            }
        } else if (paymentResult.status === "ERROR") {
            await cancelIzipayOrder({
                orderId: resolvedOrderId,
                providerResponse: paymentResponse as unknown as Prisma.InputJsonValue,
            })
        }

        return NextResponse.json({ success: true })
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
}

async function handleRedirectWebhook(body: IzipayWebhookPayload): Promise<NextResponse> {
    const isValid = verifyIzipayWebhookSignature(body, body.hash)
    if (!isValid) {
        return NextResponse.json(
            { success: false, error: "Invalid signature" },
            { status: 401 }
        )
    }

    const resolvedOrderId = await resolveIzipayOrderId(body.orderDetails.orderId)
    if (!resolvedOrderId) {
        return NextResponse.json(
            { success: false, error: "Order not found" },
            { status: 404 }
        )
    }

    const lockKey = `webhook:order:${resolvedOrderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

        if (!lockAcquired) {
            return NextResponse.json({ success: true, processing: true })
        }

        const { transactionDetails, orderStatus } = body

        if (orderStatus === "PAID") {
            const result = await fulfillIzipayOrder({
                orderId: resolvedOrderId,
                providerRef: transactionDetails.transactionId,
                providerResponse: body as unknown as Prisma.InputJsonValue,
            })

            if (!result.success) {
                return NextResponse.json(
                    { success: false, error: result.error || "Failed to fulfill order" },
                    { status: 500 }
                )
            }
        } else if (orderStatus === "CANCELLED" || orderStatus === "ERROR") {
            await cancelIzipayOrder({
                orderId: resolvedOrderId,
                providerResponse: body as unknown as Prisma.InputJsonValue,
            })
        }

        return NextResponse.json({ success: true })
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as Record<string, unknown>

        if (isEmbeddedIpn(body)) {
            return await handleEmbeddedIpn(body)
        }

        if (isWebCoreNotification(body)) {
            return await handleWebCoreNotification(body as IzipayWebCorePaymentResponse)
        }

        return await handleRedirectWebhook(body as unknown as IzipayWebhookPayload)
    } catch (error) {
        console.error("Webhook error:", error)
        return NextResponse.json(
            { success: false, error: "Webhook processing failed" },
            { status: 500 }
        )
    }
}
