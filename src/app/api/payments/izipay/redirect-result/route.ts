import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import {
    isIzipayPaymentApproved,
    parseIzipaySdkPaymentResponse,
    verifyIzipaySdkSignature,
} from "@/lib/izipay"
import { acquireLock, releaseLock } from "@/lib/cache"
import { cancelIzipayOrder, fulfillIzipayOrder } from "@/lib/izipay-payment"
import { getPublicAppUrl } from "@/lib/public-url"

export const runtime = "nodejs"

const LOCK_TTL_SECONDS = 30

function buildRedirectUrl(request: NextRequest, pathname: string, orderId?: string, message?: string) {
    const url = new URL(pathname, getPublicAppUrl(request))
    if (orderId) {
        url.searchParams.set("orderId", orderId)
    }
    if (message) {
        url.searchParams.set("message", message)
    }
    return url
}

export async function POST(request: NextRequest) {
    const formData = await request.formData()
    const body = Object.fromEntries(formData.entries())
    const payloadHttp =
        typeof body.payloadHttp === "string"
            ? body.payloadHttp
            : typeof body.payloadhttp === "string"
                ? body.payloadhttp
                : ""
    const signature =
        typeof body.signature === "string"
            ? body.signature
            : request.headers.get("signature") || ""
    const transactionId =
        typeof body.transactionId === "string"
            ? body.transactionId
            : request.headers.get("transactionId") || ""

    const parsed = parseIzipaySdkPaymentResponse({
        ...body,
        payloadHttp,
        signature,
        transactionId,
    })

    if (!parsed || !parsed.orderId) {
        return NextResponse.redirect(
            buildRedirectUrl(
                request,
                "/checkout/cancel",
                undefined,
                "No se pudo interpretar la respuesta de Izipay"
            ),
            { status: 303 }
        )
    }

    if (signature) {
        const isValid = verifyIzipaySdkSignature(parsed.payloadHttp, signature)
        if (!isValid) {
            return NextResponse.redirect(
                buildRedirectUrl(
                    request,
                    "/checkout/cancel",
                    parsed.orderId,
                    "La firma de Izipay no es valida"
                ),
                { status: 303 }
            )
        }
    }

    const lockKey = `redirect:order:${parsed.orderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, LOCK_TTL_SECONDS)

        if (lockAcquired) {
            const providerResponse = parsed.payload as Prisma.InputJsonValue

            if (isIzipayPaymentApproved(parsed)) {
                const result = await fulfillIzipayOrder({
                    orderId: parsed.orderId,
                    providerRef: parsed.transactionId,
                    providerResponse,
                })

                if (!result.success) {
                    return NextResponse.redirect(
                        buildRedirectUrl(
                            request,
                            "/checkout/cancel",
                            parsed.orderId,
                            result.error || "No se pudo confirmar la orden"
                        ),
                        { status: 303 }
                    )
                }

                return NextResponse.redirect(
                    buildRedirectUrl(request, "/checkout/success", parsed.orderId),
                    { status: 303 }
                )
            }

            await cancelIzipayOrder({
                orderId: parsed.orderId,
                providerResponse,
            })
        }

        return NextResponse.redirect(
            buildRedirectUrl(
                request,
                "/checkout/cancel",
                parsed.orderId,
                parsed.messageUser || parsed.message
            ),
            { status: 303 }
        )
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
}
