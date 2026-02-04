import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"

export const runtime = "nodejs"

// POST - Validar código de descuento
export async function POST(request: NextRequest) {
    try {
        const session = await auth()
        const userId = session?.user?.id

        const body = await request.json()
        const { code, eventId, subtotal } = body

        if (!code) {
            return NextResponse.json(
                { valid: false, error: "Código requerido" },
                { status: 400 }
            )
        }

        const discountCode = await prisma.discountCode.findUnique({
            where: { code: code.toUpperCase() },
            include: {
                event: { select: { id: true, title: true } },
                _count: { select: { usages: true } },
            },
        })

        if (!discountCode) {
            return NextResponse.json({ valid: false, error: "Código no válido" })
        }

        if (!discountCode.isActive) {
            return NextResponse.json({ valid: false, error: "Código inactivo" })
        }

        // Verificar fechas de validez
        const now = new Date()
        if (discountCode.validFrom && now < discountCode.validFrom) {
            return NextResponse.json({ valid: false, error: "Código aún no vigente" })
        }
        if (discountCode.validUntil && now > discountCode.validUntil) {
            return NextResponse.json({ valid: false, error: "Código expirado" })
        }

        // Verificar máximo de usos totales
        if (discountCode.maxUses && discountCode._count.usages >= discountCode.maxUses) {
            return NextResponse.json({ valid: false, error: "Código agotado" })
        }

        // Verificar si es específico para un evento
        if (discountCode.eventId && eventId && discountCode.eventId !== eventId) {
            return NextResponse.json({ 
                valid: false, 
                error: `Este código solo es válido para: ${discountCode.event?.title}` 
            })
        }

        // Verificar compra mínima
        if (discountCode.minPurchase && subtotal && subtotal < discountCode.minPurchase) {
            return NextResponse.json({ 
                valid: false, 
                error: `Compra mínima: S/ ${discountCode.minPurchase.toFixed(2)}` 
            })
        }

        // Verificar usos por usuario (si está logueado)
        if (userId && discountCode.maxUsesPerUser) {
            const userUsages = await prisma.discountUsage.count({
                where: {
                    discountCodeId: discountCode.id,
                    userId,
                },
            })
            if (userUsages >= discountCode.maxUsesPerUser) {
                return NextResponse.json({ 
                    valid: false, 
                    error: "Ya usaste este código el máximo permitido" 
                })
            }
        }

        // Calcular descuento
        let discountAmount = 0
        const discountValue = Number(discountCode.value)
        if (subtotal) {
            if (discountCode.type === "PERCENTAGE") {
                discountAmount = (subtotal * discountValue) / 100
            } else {
                discountAmount = Math.min(discountValue, subtotal)
            }
        }

        return NextResponse.json({
            valid: true,
            discount: {
                id: discountCode.id,
                code: discountCode.code,
                type: discountCode.type,
                value: discountValue,
                description: discountCode.description,
                eventId: discountCode.eventId,
                minPurchase: discountCode.minPurchase ? Number(discountCode.minPurchase) : null,
            },
            discountAmount,
        })
    } catch (error) {
        console.error("Error validating discount code:", error)
        return NextResponse.json({ valid: false, error: "Error al validar código" }, { status: 500 })
    }
}
