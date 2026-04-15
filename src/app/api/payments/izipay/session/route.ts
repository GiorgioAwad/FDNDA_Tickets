import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import {
    IZIPAY_EMBEDDED_CONTAINER_ID,
    buildIzipayOrderNumber,
    createIzipaySession,
    formatIzipayDateTime,
    getIzipayMode,
    getIzipayScriptUrl,
    resolveIzipayPublicKey,
    type IzipayWebCoreCheckoutConfig,
} from "@/lib/izipay"
import { storeIzipayOrderCorrelation } from "@/lib/izipay-payment"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import { getPublicAppUrl } from "@/lib/public-url"

export const runtime = "nodejs"
const MOBILE_CHECKOUT_REGEX =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet|kindle|silk/i

function normalizeIzipayText(value: string, maxLength: number) {
    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9\s.,\-/#]/g, " ")
        .replace(/\s+/g, " ")
        .trim()

    return normalized.slice(0, maxLength).trim()
}

function normalizeIzipayPhone(value: string | null | undefined) {
    const digits = (value || "").replace(/\D/g, "").slice(0, 15)
    return digits.length >= 7 ? digits : "999999999"
}

function normalizeIzipayPostalCode(value: string | null | undefined) {
    const normalized = (value || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)
    return normalized.length >= 5 ? normalized : "15001"
}

function normalizeIzipayDocument(value: string | null | undefined) {
    const normalized = (value || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 15)
    return normalized.length >= 8 ? normalized : ""
}

function splitName(fullName: string): { firstName: string; lastName: string } {
    const normalized = normalizeIzipayText(fullName, 80)
    if (!normalized) {
        return { firstName: "Cliente", lastName: "FDNDA" }
    }

    const [firstName, ...rest] = normalized.split(" ")
    return {
        firstName: firstName.slice(0, 50),
        lastName: (rest.join(" ") || firstName).slice(0, 50),
    }
}

function buildBuyerName(order: {
    buyerFirstName: string | null
    buyerSecondName: string | null
    buyerLastNamePaternal: string | null
    buyerLastNameMaternal: string | null
    buyerName: string | null
    user: {
        name: string
    }
}) {
    const personParts = [
        order.buyerFirstName,
        order.buyerSecondName,
        order.buyerLastNamePaternal,
        order.buyerLastNameMaternal,
    ]
        .filter(Boolean)
        .join(" ")
        .trim()

    return personParts || order.buyerName?.trim() || order.user.name
}

function buildCheckoutConfig(input: {
    order: {
        id: string
        userId: string
        currency: string
        totalAmount: unknown
        buyerDocType: string | null
        buyerDocNumber: string | null
        buyerAddress: string | null
        buyerEmail: string | null
        buyerPhone: string | null
        buyerUbigeo: string | null
        buyerFirstName: string | null
        buyerSecondName: string | null
        buyerLastNamePaternal: string | null
        buyerLastNameMaternal: string | null
        buyerName: string | null
        user: {
            name: string
            email: string
            phone: string | null
        }
    }
    merchantCode: string
    transactionId: string
    appUrl: string
    mode: "popup" | "redirect" | "embedded"
}): IzipayWebCoreCheckoutConfig {
    const fullName = buildBuyerName(input.order)
    const { firstName, lastName } = splitName(fullName)
    const email = (input.order.buyerEmail || input.order.user.email || "").trim().slice(0, 50)
    const phoneNumber = normalizeIzipayPhone(input.order.buyerPhone || input.order.user.phone)
    const street = normalizeIzipayText(input.order.buyerAddress || "Lima", 40) || "Lima"
    const postalCode = normalizeIzipayPostalCode(input.order.buyerUbigeo)
    const documentType = input.order.buyerDocType === "6" ? "RUC" : "DNI"
    const document = normalizeIzipayDocument(input.order.buyerDocNumber)
    const amount = Number(input.order.totalAmount).toFixed(2)
    const orderNumber = buildIzipayOrderNumber(input.order.id)
    const city = normalizeIzipayText("Lima", 40) || "Lima"
    const state = normalizeIzipayText("Lima", 40) || "Lima"

    const billing = {
        firstName,
        lastName,
        email,
        phoneNumber,
        street,
        city,
        state,
        country: "PE",
        postalCode,
        documentType,
        document,
    }
    const redirectResultUrl = `${input.appUrl}/api/payments/izipay/redirect-result`

    return {
        action: "pay",
        merchantCode: input.merchantCode,
        transactionId: input.transactionId,
        order: {
            orderNumber,
            currency: input.order.currency,
            amount,
            processType: "AT",
            merchantBuyerId: input.order.userId,
            dateTimeTransaction: formatIzipayDateTime(),
        },
        billing,
        shipping: billing,
        render: {
            typeForm:
                input.mode === "embedded"
                    ? "embedded"
                    : input.mode === "redirect"
                        ? "redirect"
                        : "pop-up",
            container:
                input.mode === "embedded" ? `#${IZIPAY_EMBEDDED_CONTAINER_ID}` : undefined,
            showButtonProcessForm: input.mode === "embedded" ? true : undefined,
            redirectUrls:
                input.mode === "redirect"
                    ? {
                        onSuccess: redirectResultUrl,
                        onError: redirectResultUrl,
                        onCancel: redirectResultUrl,
                    }
                    : undefined,
        },
        urlIPN: `${input.appUrl}/api/payments/izipay/webhook`,
    }
}

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

        await storeIzipayOrderCorrelation({
            orderId: order.id,
            providerOrderNumber: config.order.orderNumber,
            providerTransactionId: transactionId,
        })

        const session = await createIzipaySession(config)

        if (!session.success || !session.sessionToken) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        session.error ||
                        "Izipay no devolvio el token de sesion para Web Core",
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
