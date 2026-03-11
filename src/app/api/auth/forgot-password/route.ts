import { randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmailQueued } from "@/lib/email"
import { forgotPasswordSchema } from "@/lib/validations"
import { getClientIP, rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

const SUCCESS_MESSAGE =
    "Si existe una cuenta asociada a este correo, te enviaremos instrucciones para restablecer tu contraseña."

export async function POST(request: NextRequest) {
    try {
        const ip = getClientIP(request)
        const { success: rateLimitOk, remaining } = await rateLimit(ip, "auth")

        if (!rateLimitOk) {
            return NextResponse.json(
                { success: false, error: "Demasiados intentos. Intenta de nuevo en un minuto." },
                { status: 429, headers: { "X-RateLimit-Remaining": remaining.toString() } }
            )
        }

        const body = await request.json()
        const parsed = forgotPasswordSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: parsed.error.issues[0]?.message || "Email invalido" },
                { status: 400 }
            )
        }

        const email = parsed.data.email.trim().toLowerCase()
        const user = await prisma.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
        })

        if (!user) {
            return NextResponse.json({
                success: true,
                message: SUCCESS_MESSAGE,
            })
        }

        const resetToken = randomBytes(32).toString("hex")
        const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000)

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken,
                resetTokenExp,
            },
        })

        const emailResult = await sendPasswordResetEmailQueued(user.email, user.name, resetToken)
        if (!emailResult.success) {
            console.error("Password reset email failed:", emailResult.error)
        }

        return NextResponse.json({
            success: true,
            message: SUCCESS_MESSAGE,
        })
    } catch (error) {
        console.error("Forgot password error:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo procesar la solicitud" },
            { status: 500 }
        )
    }
}
