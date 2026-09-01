import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

const locationSchema = z.object({
    name: z.string().trim().min(2, "Ingresa el nombre de la sede.").max(100, "El nombre admite hasta 100 caracteres."),
    address: z.string().trim().min(5, "Ingresa una direccion completa.").max(240, "La direccion admite hasta 240 caracteres."),
    district: z.string().trim().max(100, "El distrito admite hasta 100 caracteres.").optional().nullable(),
    instructions: z.string().trim().max(500, "Las indicaciones admiten hasta 500 caracteres.").optional().nullable(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
})

export async function GET() {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const locations = await prisma.merchPickupLocation.findMany({
        orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { orders: true } } },
    })

    return NextResponse.json({ success: true, data: locations })
}

export async function POST(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const parsed = locationSchema.safeParse(await request.json())
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: parsed.error.issues[0]?.message || "Datos invalidos" },
            { status: 400 }
        )
    }

    const data = parsed.data
    const location = await prisma.merchPickupLocation.create({
        data: {
            name: data.name,
            address: data.address,
            district: data.district || null,
            instructions: data.instructions || null,
            isActive: data.isActive ?? true,
            sortOrder: data.sortOrder ?? 0,
        },
        include: { _count: { select: { orders: true } } },
    })

    return NextResponse.json({ success: true, data: location }, { status: 201 })
}
