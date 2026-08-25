import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { rateLimit, getClientIP } from "@/lib/rate-limit"
import { calculateDiscountAmount, getDiscountEligibleSubtotal } from "@/lib/discounts"
import { formatDateUTC } from "@/lib/qr"

export const runtime = "nodejs"

// POST - Validar código de descuento
export async function POST(request: NextRequest) {
    try {
        // Rate limiting to prevent discount code enumeration
        const ip = getClientIP(request)
        const { success: rateLimitOk } = await rateLimit(ip, "api")
        if (!rateLimitOk) {
            return NextResponse.json(
                { valid: false, error: "Demasiados intentos. Intenta de nuevo en un minuto." },
                { status: 429 }
            )
        }

        const session = await auth()
        const userId = session?.user?.id

        const body = await request.json()
        const { code, eventId, subtotal } = body
        const cartItems = Array.isArray(body.items) ? body.items : []

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
                ticketType: { select: { id: true, name: true } },
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
        if (discountCode.eventId && discountCode.eventId !== eventId) {
            return NextResponse.json({ 
                valid: false, 
                error: `Este código solo es válido para: ${discountCode.event?.title}` 
            })
        }

        const validDateKey = discountCode.validDate
            ? formatDateUTC(discountCode.validDate)
            : null
        const eligibleSubtotal = discountCode.ticketTypeId || validDateKey
            ? getDiscountEligibleSubtotal({
                items: cartItems,
                ticketTypeId: discountCode.ticketTypeId,
                validDate: validDateKey,
            })
            : Number(subtotal || 0)

        if (eligibleSubtotal <= 0) {
            const scope = [
                discountCode.ticketType?.name,
                validDateKey
                    ? new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeZone: "UTC" })
                        .format(discountCode.validDate!)
                    : null,
            ].filter(Boolean).join(" · ")
            return NextResponse.json({
                valid: false,
                error: scope
                    ? `Este código solo aplica a: ${scope}`
                    : "Este código no aplica a las entradas seleccionadas",
            })
        }

        // Verificar compra mínima
        if (discountCode.minPurchase && Number(subtotal || 0) < Number(discountCode.minPurchase)) {
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
        const discountValue = Number(discountCode.value)
        const discountAmount = calculateDiscountAmount({
            eligibleSubtotal,
            type: discountCode.type,
            value: discountValue,
        })

        return NextResponse.json({
            valid: true,
            discount: {
                id: discountCode.id,
                code: discountCode.code,
                type: discountCode.type,
                value: discountValue,
                description: discountCode.description,
                eventId: discountCode.eventId,
                ticketTypeId: discountCode.ticketTypeId,
                validDate: validDateKey,
                minPurchase: discountCode.minPurchase ? Number(discountCode.minPurchase) : null,
            },
            discountAmount,
        })
    } catch (error) {
        console.error("Error validating discount code:", error)
        return NextResponse.json({ valid: false, error: "Error al validar código" }, { status: 500 })
    }
}
