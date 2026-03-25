import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import {
    parseEmbeddedAnswer,
    parseIzipayWebCoreResponse,
    verifyEmbeddedFormHash,
    verifyIzipayWebCoreSignature,
    type IzipayWebCorePaymentResponse,
} from "@/lib/izipay"
import { acquireLock, releaseLock } from "@/lib/cache"
import {
    cancelIzipayOrder,
    fulfillIzipayOrder,
    resolveIzipayOrderId,
} from "@/lib/izipay-payment"

export const runtime = "nodejs"

const LOCK_TTL_SECONDS = 30

async function handleEmbeddedValidation(body: Record<string, unknown>) {
    const krAnswer = typeof body["kr-answer"] === "string" ? body["kr-answer"] : ""
    const krHash = typeof body["kr-hash"] === "string" ? body["kr-hash"] : ""

    if (!krAnswer || !krHash) {
        return NextResponse.json(
            { success: false, error: "Datos de pago incompletos" },
            { status: 400 }
        )
    }

    const isValid = verifyEmbeddedFormHash(krAnswer, krHash)
    if (!isValid) {
        return NextResponse.json(
            { success: false, error: "Firma de pago invalida" },
            { status: 401 }
        )
    }

    const paymentResult = parseEmbeddedAnswer(krAnswer)
    if (!paymentResult || !paymentResult.orderId) {
        return NextResponse.json(
            { success: false, error: "No se pudo interpretar la respuesta de pago" },
            { status: 400 }
        )
    }

    const resolvedOrderId = await resolveIzipayOrderId(paymentResult.orderId)
    if (!resolvedOrderId) {
        return NextResponse.json(
            { success: false, error: "No se pudo resolver la orden de Izipay" },
            { status: 404 }
        )
    }

    const lockKey = `validate:order:${resolvedOrderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, LOCK_TTL_SECONDS)

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
                    { success: false, error: result.error || "Error al procesar orden" },
                    { status: 500 }
                )
            }

            return NextResponse.json({
                success: true,
                data: {
                    orderId: resolvedOrderId,
                    status: "PAID",
                    paymentMethod: paymentResult.paymentMethod,
                },
            })
        }

        if (paymentResult.status === "CANCELLED" || paymentResult.status === "ERROR") {
            await cancelIzipayOrder({
                orderId: resolvedOrderId,
                providerResponse: JSON.parse(krAnswer) as Prisma.InputJsonValue,
            })
        }

        return NextResponse.json({
            success: true,
            data: {
                orderId: resolvedOrderId,
                status:
                    paymentResult.status === "UNPAID"
                        ? "PENDING"
                        : paymentResult.status,
            },
        })
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
}

async function handleWebCoreValidation(body: Record<string, unknown>) {
    const rawPaymentResponse =
        typeof body.paymentResult === "object" && body.paymentResult !== null
            ? body.paymentResult
            : typeof body.paymentResponse === "object" && body.paymentResponse !== null
                ? body.paymentResponse
                : body

    const paymentResponse = rawPaymentResponse as IzipayWebCorePaymentResponse
    if (!paymentResponse.code) {
        return NextResponse.json(
            { success: false, error: "Respuesta de pago incompleta" },
            { status: 400 }
        )
    }

    const isValid = verifyIzipayWebCoreSignature(paymentResponse)
    if (!isValid) {
        return NextResponse.json(
            { success: false, error: "Firma de pago invalida" },
            { status: 401 }
        )
    }

    const paymentResult = parseIzipayWebCoreResponse(paymentResponse)
    if (!paymentResult) {
        return NextResponse.json(
            { success: false, error: "No se pudo interpretar la respuesta de Izipay" },
            { status: 400 }
        )
    }

    const resolvedOrderId = await resolveIzipayOrderId(paymentResult.orderId)
    if (!resolvedOrderId) {
        return NextResponse.json(
            { success: false, error: "No se pudo resolver la orden de Izipay" },
            { status: 404 }
        )
    }

    const lockKey = `validate:order:${resolvedOrderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, LOCK_TTL_SECONDS)

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
                    { success: false, error: result.error || "Error al procesar orden" },
                    { status: 500 }
                )
            }

            return NextResponse.json({
                success: true,
                data: {
                    orderId: resolvedOrderId,
                    status: "PAID",
                    paymentMethod: paymentResult.paymentMethod,
                },
            })
        }

        if (paymentResult.status === "ERROR") {
            await cancelIzipayOrder({
                orderId: resolvedOrderId,
                providerResponse: paymentResponse as unknown as Prisma.InputJsonValue,
            })
        }

        return NextResponse.json({
            success: true,
            data: {
                orderId: resolvedOrderId,
                status: paymentResult.status,
                message: paymentResult.message || null,
            },
        })
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
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

        const body = (await request.json()) as Record<string, unknown>

        if (typeof body["kr-answer"] === "string") {
            return await handleEmbeddedValidation(body)
        }

        return await handleWebCoreValidation(body)
    } catch (error) {
        console.error("Izipay validate error:", error)
        return NextResponse.json(
            { success: false, error: "Error al validar pago" },
            { status: 500 }
        )
    }
}
