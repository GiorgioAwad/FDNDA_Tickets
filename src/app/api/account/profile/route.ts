import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { sendVerificationEmail } from "@/lib/email"
import { randomBytes } from "crypto"
export const runtime = "nodejs"

export async function PUT(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const name = String(body.name || "").trim()
        const email = String(body.email || "").trim().toLowerCase()

        if (!name || !email) {
            return NextResponse.json({ success: false, error: "Nombre y email son requeridos" }, { status: 400 })
        }

        const existing = await prisma.user.findUnique({ where: { email } })
        if (existing && existing.id !== user.id) {
            return NextResponse.json({ success: false, error: "El email ya está registrado" }, { status: 400 })
        }

        const emailChanged = email !== user.email.toLowerCase()
        const verifyToken = emailChanged ? randomBytes(32).toString("hex") : null

        const updated = await prisma.user.update({
            where: { id: user.id },
            data: {
                name,
                email,
                emailVerifiedAt: emailChanged ? null : undefined,
                verifyToken: emailChanged ? verifyToken : undefined,
            },
        })

        let verificationSent = false
        let warning: string | null = null
        if (emailChanged && verifyToken) {
            const result = await sendVerificationEmail(email, name, verifyToken)
            verificationSent = result.success
            if (!result.success) {
                warning = result.error || "No se pudo enviar el correo de verificación"
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                id: updated.id,
                name: updated.name,
                email: updated.email,
                emailVerifiedAt: updated.emailVerifiedAt,
            },
            verificationSent,
            warning,
        })
    } catch (error) {
        console.error("Update profile error:", error)
        return NextResponse.json({ success: false, error: "Error al actualizar perfil" }, { status: 500 })
    }
}

