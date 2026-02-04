import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json()
        const { role } = body

        // Validate role
        if (!["USER", "STAFF", "ADMIN"].includes(role)) {
            return NextResponse.json(
                { success: false, error: "Rol invalido" },
                { status: 400 }
            )
        }

        // Prevent changing own role
        if (id === user.id) {
            return NextResponse.json(
                { success: false, error: "No puedes cambiar tu propio rol" },
                { status: 400 }
            )
        }

        // Check if user exists
        const targetUser = await prisma.user.findUnique({
            where: { id }
        })

        if (!targetUser) {
            return NextResponse.json(
                { success: false, error: "Usuario no encontrado" },
                { status: 404 }
            )
        }

        // Update role
        const updatedUser = await prisma.user.update({
            where: { id },
            data: { role },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
            }
        })

        return NextResponse.json({
            success: true,
            data: updatedUser,
            message: `Rol actualizado a ${role}`
        })
    } catch (error) {
        console.error("Error updating user role:", error)
        return NextResponse.json(
            { success: false, error: "Error al actualizar rol" },
            { status: 500 }
        )
    }
}
