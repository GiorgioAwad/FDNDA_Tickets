import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

// GET - Listar códigos de descuento
export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const discountCodes = await prisma.discountCode.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                event: { select: { id: true, title: true } },
                _count: { select: { usages: true } },
            },
        })

        return NextResponse.json({ success: true, data: discountCodes })
    } catch (error) {
        console.error("Error fetching discount codes:", error)
        return NextResponse.json({ success: false, error: "Error al obtener códigos" }, { status: 500 })
    }
}

// POST - Crear código de descuento
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const {
            code,
            description,
            type = "PERCENTAGE",
            value,
            eventId,
            minPurchase,
            maxUses,
            maxUsesPerUser = 1,
            validFrom,
            validUntil,
        } = body

        if (!code || value === undefined) {
            return NextResponse.json(
                { success: false, error: "Código y valor son requeridos" },
                { status: 400 }
            )
        }

        // Verificar que el código no exista
        const existingCode = await prisma.discountCode.findUnique({
            where: { code: code.toUpperCase() },
        })

        if (existingCode) {
            return NextResponse.json(
                { success: false, error: "Este código ya existe" },
                { status: 400 }
            )
        }

        const discountCode = await prisma.discountCode.create({
            data: {
                code: code.toUpperCase(),
                description,
                type,
                value,
                eventId: eventId || null,
                minPurchase: minPurchase || null,
                maxUses: maxUses || null,
                maxUsesPerUser,
                validFrom: validFrom ? new Date(validFrom) : new Date(),
                validUntil: validUntil ? new Date(validUntil) : null,
                createdBy: user.id,
            },
        })

        return NextResponse.json({ success: true, data: discountCode })
    } catch (error) {
        console.error("Error creating discount code:", error)
        return NextResponse.json({ success: false, error: "Error al crear código" }, { status: 500 })
    }
}
