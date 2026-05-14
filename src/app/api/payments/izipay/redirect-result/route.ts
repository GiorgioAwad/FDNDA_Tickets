import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import {
    isIzipayPaymentApproved,
    parseIzipaySdkPaymentResponse,
    verifyIzipaySdkSignature,
} from "@/lib/izipay"
import { acquireLock, releaseLock } from "@/lib/cache"
import { cancelIzipayOrder, fulfillIzipayOrder, resolveIzipayOrderId } from "@/lib/izipay-payment"
import { prisma } from "@/lib/prisma"
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

// Izipay hace GET cuando el usuario presiona "Redirigir al comercio" en la
// pagina de resumen hospedada (con countdown). El payload del pago llega por
// POST/IPN, asi que aqui consultamos el estado real de la orden antes de
// decidir el destino: PAID -> success, CANCELLED/EXPIRED -> cancel,
// PENDING -> mensaje de procesamiento.
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams
    const orderRef =
        params.get("orderId") ||
        params.get("orderNumber") ||
        params.get("merchantOrderNumber") ||
        ""

    const resolvedOrderId = orderRef ? await resolveIzipayOrderId(orderRef) : null

    if (resolvedOrderId) {
        const order = await prisma.order.findUnique({
            where: { id: resolvedOrderId },
            select: { status: true },
        })

        if (order?.status === "PAID") {
            return NextResponse.redirect(
                buildRedirectUrl(request, "/checkout/success", resolvedOrderId),
                { status: 303 }
            )
        }

        if (order?.status === "CANCELLED" || order?.status === "REFUNDED") {
            return NextResponse.redirect(
                buildRedirectUrl(
                    request,
                    "/checkout/cancel",
                    resolvedOrderId,
                    "El pago no se completo. Puedes reintentar cuando quieras."
                ),
                { status: 303 }
            )
        }

        return NextResponse.redirect(
            buildRedirectUrl(
                request,
                "/checkout/cancel",
                resolvedOrderId,
                "Tu pago aun se esta procesando. Te avisaremos por correo cuando se confirme."
            ),
            { status: 303 }
        )
    }

    return NextResponse.redirect(
        buildRedirectUrl(
            request,
            "/checkout/cancel",
            undefined,
            "Volviste sin completar el pago. Puedes reintentar cuando quieras."
        ),
        { status: 303 }
    )
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

    // Resolve Izipay's merchant order number to our internal order ID
    const resolvedOrderId = await resolveIzipayOrderId(parsed.orderId)
    if (!resolvedOrderId) {
        return NextResponse.redirect(
            buildRedirectUrl(
                request,
                "/checkout/cancel",
                parsed.orderId,
                "No se pudo resolver la orden"
            ),
            { status: 303 }
        )
    }

    const lockKey = `redirect:order:${resolvedOrderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, LOCK_TTL_SECONDS)

        if (lockAcquired) {
            const providerResponse = parsed.payload as Prisma.InputJsonValue

            if (isIzipayPaymentApproved(parsed)) {
                const result = await fulfillIzipayOrder({
                    orderId: resolvedOrderId,
                    providerRef: parsed.transactionId,
                    providerResponse,
                })

                if (!result.success) {
                    return NextResponse.redirect(
                        buildRedirectUrl(
                            request,
                            "/checkout/cancel",
                            resolvedOrderId,
                            result.error || "No se pudo confirmar la orden"
                        ),
                        { status: 303 }
                    )
                }

                return NextResponse.redirect(
                    buildRedirectUrl(request, "/checkout/success", resolvedOrderId),
                    { status: 303 }
                )
            }

            await cancelIzipayOrder({
                orderId: resolvedOrderId,
                providerResponse,
            })
        }

        return NextResponse.redirect(
            buildRedirectUrl(
                request,
                "/checkout/cancel",
                resolvedOrderId,
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
