import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import {
    createIzipaySession,
    getIzipayMode,
    getIzipayScriptUrl,
    resolveIzipayPublicKey,
} from "@/lib/izipay"
import { buildCheckoutConfig, findIzipayConfigViolations } from "@/lib/izipay-config"
import { storeIzipayOrderCorrelation } from "@/lib/izipay-payment"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import { getPublicAppUrl } from "@/lib/public-url"

export const runtime = "nodejs"
const MOBILE_CHECKOUT_REGEX =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet|kindle|silk/i

function isMobileCheckoutRequest(request: NextRequest): boolean {
    const mobileHint = request.headers.get("sec-ch-ua-mobile")
    if (mobileHint === "?1") {
        return true
    }

    const userAgent = request.headers.get("user-agent") || ""
    return MOBILE_CHECKOUT_REGEX.test(userAgent)
}

function resolveCheckoutMode(
    request: NextRequest,
    configuredMode: ReturnType<typeof getIzipayMode>
): "popup" | "redirect" | "embedded" {
    if (configuredMode === "embedded") return "embedded"
    if (configuredMode === "popup") return "popup"
    if (configuredMode === "redirect") return "redirect"
    return isMobileCheckoutRequest(request) ? "redirect" : "popup"
}

export async function POST(request: NextRequest) {
    try {
        const paymentsMode = process.env.PAYMENTS_MODE || "mock"
        if (paymentsMode !== "izipay") {
            return NextResponse.json(
                { success: false, error: "Ruta no disponible" },
                { status: 404 }
            )
        }

        const merchantCode = process.env.IZIPAY_MERCHANT_CODE || ""
        const publicKey = resolveIzipayPublicKey()
        const apiKey = process.env.IZIPAY_API_KEY || ""
        const hashKey = process.env.IZIPAY_HASH_KEY || ""
        const appUrl = getPublicAppUrl(request)
        const mode = resolveCheckoutMode(request, getIzipayMode())

        if (!merchantCode || !apiKey || !hashKey || !publicKey || !appUrl) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Falta configuracion Izipay. Revisa IZIPAY_MERCHANT_CODE, IZIPAY_API_KEY, IZIPAY_HASH_KEY, IZIPAY_PUBLIC_KEY y NEXT_PUBLIC_APP_URL.",
                },
                { status: 500 }
            )
        }

        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const orderId = typeof body?.orderId === "string" ? body.orderId : ""
        if (!orderId) {
            return NextResponse.json(
                { success: false, error: "Falta orderId" },
                { status: 400 }
            )
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    },
                },
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
        })

        if (!order) {
            return NextResponse.json(
                { success: false, error: "Orden no encontrada" },
                { status: 404 }
            )
        }

        if (order.userId !== user.id && !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 403 }
            )
        }

        if (order.status === "PAID") {
            return NextResponse.json({
                success: true,
                data: {
                    orderId: order.id,
                    alreadyPaid: true,
                },
            })
        }

        if (order.status !== "PENDING") {
            return NextResponse.json(
                { success: false, error: "La orden no esta disponible para pago" },
                { status: 400 }
            )
        }

        const totalAmount = Number(order.totalAmount)
        if (!Number.isFinite(totalAmount) || totalAmount < 0) {
            return NextResponse.json(
                { success: false, error: "Monto de orden invalido" },
                { status: 400 }
            )
        }

        if (totalAmount === 0) {
            const result = await fulfillPaidOrder({
                orderId: order.id,
                providerRef: `FREE-${order.id}`,
                providerResponse: { autoApproved: true, reason: "zero_amount" },
            })

            if (!result.success) {
                return NextResponse.json(
                    { success: false, error: result.error || "No se pudo confirmar la orden" },
                    { status: 500 }
                )
            }

            return NextResponse.json({
                success: true,
                data: {
                    orderId: order.id,
                    alreadyPaid: true,
                    zeroAmount: true,
                },
            })
        }

        const amountInCents = Math.round(totalAmount * 100)
        if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
            return NextResponse.json(
                { success: false, error: "Monto de pago invalido" },
                { status: 400 }
            )
        }

        const transactionId = `${Date.now()}${order.id.replace(/[^a-zA-Z0-9]/g, "").slice(-24)}`
            .slice(0, 40)
        const config = buildCheckoutConfig({
            order,
            merchantCode,
            transactionId,
            appUrl,
            mode,
        })

        const violations = findIzipayConfigViolations(config)
        if (violations.length > 0) {
            console.error("[izipay/session] config con parametros fuera de regla", {
                orderId: order.id,
                violations,
            })
        }

        await storeIzipayOrderCorrelation({
            orderId: order.id,
            providerOrderNumber: config.order.orderNumber,
            providerTransactionId: transactionId,
        })

        const session = await createIzipaySession(config)

        if (!session.success || !session.sessionToken) {
            // El error crudo de Izipay puede ser HTML/JSON ilegible: se loguea
            // completo aqui y al usuario solo le llega un mensaje accionable.
            console.error("[izipay/session] Token/Generate fallo", {
                orderId: order.id,
                orderNumber: config.order.orderNumber,
                transactionId,
                amount: config.order.amount,
                mode,
                violations,
                providerError: session.error,
            })
            return NextResponse.json(
                {
                    success: false,
                    error: `No pudimos iniciar el pago con Izipay. Vuelve a intentarlo en unos minutos. (Ref: ${config.order.orderNumber})`,
                },
                { status: 502 }
            )
        }

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.id,
                authorization: session.sessionToken,
                keyRSA: publicKey,
                scriptUrl: getIzipayScriptUrl(mode),
                config,
            },
        })
    } catch (error) {
        console.error("IziPay session error:", error)
        return NextResponse.json(
            { success: false, error: "Error al iniciar pago con IziPay" },
            { status: 500 }
        )
    }
}
