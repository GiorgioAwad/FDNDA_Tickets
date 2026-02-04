import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

// PUT - Actualizar código de descuento
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json()
        const {
            code,
            description,
            type,
            value,
            eventId,
            minPurchase,
            maxUses,
            maxUsesPerUser,
            validFrom,
            validUntil,
            isActive,
        } = body

        // Verificar que el código exista
        const existingCode = await prisma.discountCode.findUnique({
            where: { id },
        })

        if (!existingCode) {
            return NextResponse.json(
                { success: false, error: "Código no encontrado" },
                { status: 404 }
            )
        }

        // Si cambia el código, verificar que no exista otro igual
        if (code && code.toUpperCase() !== existingCode.code) {
            const duplicateCode = await prisma.discountCode.findUnique({
                where: { code: code.toUpperCase() },
            })
            if (duplicateCode) {
                return NextResponse.json(
                    { success: false, error: "Este código ya existe" },
                    { status: 400 }
                )
            }
        }

        const discountCode = await prisma.discountCode.update({
            where: { id },
            data: {
                ...(code && { code: code.toUpperCase() }),
                ...(description !== undefined && { description }),
                ...(type && { type }),
                ...(value !== undefined && { value }),
                ...(eventId !== undefined && { eventId: eventId || null }),
                ...(minPurchase !== undefined && { minPurchase: minPurchase || null }),
                ...(maxUses !== undefined && { maxUses: maxUses || null }),
                ...(maxUsesPerUser !== undefined && { maxUsesPerUser }),
                ...(validFrom !== undefined && { validFrom: validFrom ? new Date(validFrom) : new Date() }),
                ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
                ...(isActive !== undefined && { isActive }),
            },
        })

        return NextResponse.json({ success: true, data: discountCode })
    } catch (error) {
        console.error("Error updating discount code:", error)
        return NextResponse.json({ success: false, error: "Error al actualizar código" }, { status: 500 })
    }
}

// DELETE - Eliminar código de descuento
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await params

        // Verificar que el código exista
        const existingCode = await prisma.discountCode.findUnique({
            where: { id },
            include: { _count: { select: { usages: true } } },
        })

        if (!existingCode) {
            return NextResponse.json(
                { success: false, error: "Código no encontrado" },
                { status: 404 }
            )
        }

        // Si tiene usos, solo desactivar en vez de eliminar
        if (existingCode._count.usages > 0) {
            await prisma.discountCode.update({
                where: { id },
                data: { isActive: false },
            })
            return NextResponse.json({ 
                success: true, 
                message: "Código desactivado (tiene historial de uso)" 
            })
        }

        // Si no tiene usos, eliminar
        await prisma.discountCode.delete({
            where: { id },
        })

        return NextResponse.json({ success: true, message: "Código eliminado" })
    } catch (error) {
        console.error("Error deleting discount code:", error)
        return NextResponse.json({ success: false, error: "Error al eliminar código" }, { status: 500 })
    }
}
