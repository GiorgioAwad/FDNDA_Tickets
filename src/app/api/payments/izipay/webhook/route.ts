import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import {
    isIzipayCommunicationError,
    isIzipayPaymentApproved,
    parseEmbeddedAnswer,
    parseIzipaySdkPaymentResponse,
    verifyEmbeddedIpnHash,
    verifyIzipaySdkSignature,
    verifyIzipayWebhookSignature,
    type IzipayWebhookPayload,
} from "@/lib/izipay"
import { acquireLockWithStatus, releaseLock } from "@/lib/cache"
import {
    buildIzipayProviderResponse,
    cancelIzipayOrder,
    fulfillIzipayOrder,
    resolveIzipayOrderId,
} from "@/lib/izipay-payment"

export const runtime = "nodejs"

const WEBHOOK_LOCK_TTL_SECONDS = 30

export async function GET() {
    return NextResponse.json({
        success: true,
        endpoint: "izipay-webhook",
        accepts: ["embedded-ipn", "web-core-notification", "redirect-webhook"],
    })
}

// Izipay's embedded IPN (kr-answer/kr-hash) and the redirect/web-core form
// notification arrive as application/x-www-form-urlencoded, NOT JSON. Reading
// the body with request.json() throws on those bodies, the POST handler returns
// 500, and Izipay marks the notification as "Fallido" (pago cobrado pero la
// orden nunca se confirma). Parse defensively based on content-type, mirroring
// the redirect-result route which already uses request.formData().
async function parseWebhookBody(request: NextRequest): Promise<Record<string, unknown>> {
    const contentType = (request.headers.get("content-type") || "").toLowerCase()

    if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
    ) {
        const formData = await request.formData()
        return Object.fromEntries(formData.entries())
    }

    if (contentType.includes("application/json")) {
        return (await request.json()) as Record<string, unknown>
    }

    // Unknown/missing content-type: Izipay does not always set a reliable one on
    // its server-to-server IPN, so read raw and try JSON then form-encoded.
    const raw = await request.text()
    if (!raw.trim()) {
        return {}
    }

    try {
        return JSON.parse(raw) as Record<string, unknown>
    } catch {
        return Object.fromEntries(new URLSearchParams(raw).entries())
    }
}

function isEmbeddedIpn(body: Record<string, unknown>): boolean {
    return typeof body["kr-answer"] === "string" && typeof body["kr-hash"] === "string"
}

// The Web Core notification (popup/redirect/embedded checkout) arrives with the
// payment result inside `payloadHttp` (a JSON string), exactly like the browser
// return handled in redirect-result. It does NOT carry a top-level `code`, so the
// only reliable marker is the presence of `payloadHttp`.
function isWebCoreNotification(body: Record<string, unknown>): boolean {
    return typeof body.payloadHttp === "string" || typeof body.payloadhttp === "string"
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
        const lockStatus = await acquireLockWithStatus(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

        if (lockStatus === "busy") {
            return NextResponse.json({ success: true, processing: true })
        }

        if (lockStatus === "unavailable") {
            return NextResponse.json(
                { success: false, error: "Lock backend unavailable" },
                { status: 503 }
            )
        }

        lockAcquired = true

        if (paymentResult.status === "PAID") {
            const result = await fulfillIzipayOrder({
                orderId: resolvedOrderId,
                providerRef: paymentResult.transactionId,
                providerOrderNumber: paymentResult.orderId,
                providerTransactionId: paymentResult.transactionId,
                providerResponse: buildIzipayProviderResponse(
                    "embedded",
                    JSON.parse(krAnswer) as Prisma.InputJsonValue
                ),
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
                providerOrderNumber: paymentResult.orderId,
                providerTransactionId: paymentResult.transactionId,
                providerResponse: buildIzipayProviderResponse(
                    "embedded",
                    JSON.parse(krAnswer) as Prisma.InputJsonValue
                ),
            })
        }

        return NextResponse.json({ success: true })
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
}

async function handleWebCoreNotification(body: Record<string, unknown>): Promise<NextResponse> {
    const payloadHttp =
        typeof body.payloadHttp === "string"
            ? body.payloadHttp
            : typeof body.payloadhttp === "string"
                ? body.payloadhttp
                : ""
    const signature = typeof body.signature === "string" ? body.signature : ""
    const transactionId = typeof body.transactionId === "string" ? body.transactionId : ""

    // parseIzipaySdkPaymentResponse unwraps the payment result from payloadHttp
    // (and falls back to a flat response when payloadHttp is absent), mirroring
    // the proven redirect-result handler.
    const parsed = parseIzipaySdkPaymentResponse({
        ...body,
        payloadHttp,
        signature,
        transactionId,
    })

    if (!parsed || !parsed.orderId) {
        return NextResponse.json(
            { success: false, error: "Invalid notification data" },
            { status: 400 }
        )
    }

    if (signature && !verifyIzipaySdkSignature(parsed.payloadHttp, signature)) {
        return NextResponse.json(
            { success: false, error: "Invalid signature" },
            { status: 401 }
        )
    }

    const resolvedOrderId = await resolveIzipayOrderId(parsed.orderId)
    if (!resolvedOrderId) {
        return NextResponse.json(
            { success: false, error: "Order not found" },
            { status: 404 }
        )
    }

    const lockKey = `webhook:order:${resolvedOrderId}`
    let lockAcquired = false

    try {
        const lockStatus = await acquireLockWithStatus(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

        if (lockStatus === "busy") {
            return NextResponse.json({ success: true, processing: true })
        }

        if (lockStatus === "unavailable") {
            return NextResponse.json(
                { success: false, error: "Lock backend unavailable" },
                { status: 503 }
            )
        }

        lockAcquired = true

        const providerResponse = buildIzipayProviderResponse(
            "webhook",
            parsed.payload as unknown as Prisma.InputJsonValue
        )

        if (isIzipayPaymentApproved(parsed)) {
            const result = await fulfillIzipayOrder({
                orderId: resolvedOrderId,
                providerRef: parsed.transactionId,
                providerOrderNumber: parsed.orderId,
                providerTransactionId: parsed.transactionId,
                providerResponse,
            })

            if (!result.success) {
                return NextResponse.json(
                    { success: false, error: result.error || "Failed to fulfill order" },
                    { status: 500 }
                )
            }
        } else if (!isIzipayCommunicationError(parsed.code)) {
            // Definite refusal -> cancel and release inventory. A communication
            // error (code 021) is transient/pending, so leave the order PENDING.
            await cancelIzipayOrder({
                orderId: resolvedOrderId,
                providerOrderNumber: parsed.orderId,
                providerTransactionId: parsed.transactionId,
                providerResponse,
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
        const lockStatus = await acquireLockWithStatus(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

        if (lockStatus === "busy") {
            return NextResponse.json({ success: true, processing: true })
        }

        if (lockStatus === "unavailable") {
            return NextResponse.json(
                { success: false, error: "Lock backend unavailable" },
                { status: 503 }
            )
        }

        lockAcquired = true

        const { transactionDetails, orderStatus } = body

        if (orderStatus === "PAID") {
            const result = await fulfillIzipayOrder({
                orderId: resolvedOrderId,
                providerRef: transactionDetails.transactionId,
                providerOrderNumber: body.orderDetails.orderId,
                providerTransactionId: transactionDetails.transactionId,
                providerResponse: buildIzipayProviderResponse(
                    "webhook",
                    body as unknown as Prisma.InputJsonValue
                ),
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
                providerOrderNumber: body.orderDetails.orderId,
                providerTransactionId: transactionDetails.transactionId,
                providerResponse: buildIzipayProviderResponse(
                    "webhook",
                    body as unknown as Prisma.InputJsonValue
                ),
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
        const body = await parseWebhookBody(request)

        if (isEmbeddedIpn(body)) {
            return await handleEmbeddedIpn(body)
        }

        if (isWebCoreNotification(body)) {
            return await handleWebCoreNotification(body)
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
