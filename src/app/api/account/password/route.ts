import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import bcrypt from "bcryptjs"

export const runtime = "nodejs"

export async function PUT(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const currentPassword = String(body.currentPassword || "")
        const newPassword = String(body.newPassword || "")
        const confirmPassword = String(body.confirmPassword || "")

        if (!currentPassword || !newPassword || !confirmPassword) {
            return NextResponse.json({ success: false, error: "Completa todos los campos" }, { status: 400 })
        }

        if (newPassword.length < 8) {
            return NextResponse.json({ success: false, error: "La nueva contrasena debe tener al menos 8 caracteres" }, { status: 400 })
        }

        if (newPassword !== confirmPassword) {
            return NextResponse.json({ success: false, error: "Las contrasenas no coinciden" }, { status: 400 })
        }

        const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
        if (!dbUser) {
            return NextResponse.json({ success: false, error: "Usuario no encontrado" }, { status: 404 })
        }

        const isValid = await bcrypt.compare(currentPassword, dbUser.passwordHash)
        if (!isValid) {
            return NextResponse.json({ success: false, error: "Contrasena actual incorrecta" }, { status: 400 })
        }

        const passwordHash = await bcrypt.hash(newPassword, 10)
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash }
        })

        return NextResponse.json({ success: true, message: "Contrasena actualizada correctamente" })
    } catch (error) {
        console.error("Error changing password:", error)
        return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
    }
}
