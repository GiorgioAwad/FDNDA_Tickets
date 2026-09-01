import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

const updateSchema = z.object({
    name: z.string().trim().min(2, "Ingresa el nombre de la sede.").max(100).optional(),
    address: z.string().trim().min(5, "Ingresa una direccion completa.").max(240).optional(),
    district: z.string().trim().max(100).optional().nullable(),
    instructions: z.string().trim().max(500).optional().nullable(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
}).refine((data) => Object.keys(data).length > 0, "No hay cambios para guardar.")

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: parsed.error.issues[0]?.message || "Datos invalidos" },
            { status: 400 }
        )
    }

    const { id } = await params
    const existing = await prisma.merchPickupLocation.findUnique({
        where: { id },
        include: { _count: { select: { products: true } } },
    })
    if (!existing) {
        return NextResponse.json({ success: false, error: "Sede no encontrada" }, { status: 404 })
    }

    const data = parsed.data
    if (data.isActive === false && existing._count.products > 0) {
        return NextResponse.json(
            {
                success: false,
                error: `Reasigna los ${existing._count.products} producto(s) vinculados antes de desactivar esta sede.`,
            },
            { status: 409 }
        )
    }
    const location = await prisma.merchPickupLocation.update({
        where: { id },
        data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.address !== undefined ? { address: data.address } : {}),
            ...(data.district !== undefined ? { district: data.district || null } : {}),
            ...(data.instructions !== undefined ? { instructions: data.instructions || null } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        },
        include: { _count: { select: { orders: true, products: true } } },
    })

    return NextResponse.json({ success: true, data: location })
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const { id } = await params
    const existing = await prisma.merchPickupLocation.findUnique({
        where: { id },
        include: { _count: { select: { orders: true, products: true } } },
    })
    if (!existing) {
        return NextResponse.json({ success: false, error: "Sede no encontrada" }, { status: 404 })
    }

    if (existing._count.products > 0) {
        return NextResponse.json(
            {
                success: false,
                error: `Reasigna los ${existing._count.products} producto(s) vinculados antes de eliminar esta sede.`,
            },
            { status: 409 }
        )
    }

    if (existing._count.orders > 0) {
        const location = await prisma.merchPickupLocation.update({
            where: { id },
            data: { isActive: false },
            include: { _count: { select: { orders: true, products: true } } },
        })
        return NextResponse.json({
            success: true,
            data: location,
            softDeleted: true,
            message: "La sede tiene pedidos asociados y fue desactivada para conservar el historial.",
        })
    }

    await prisma.merchPickupLocation.delete({ where: { id } })
    return NextResponse.json({ success: true, deleted: true })
}
