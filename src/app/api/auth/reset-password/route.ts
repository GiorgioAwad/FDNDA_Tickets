import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hashPassword } from "@/lib/auth"
import { resetPasswordSchema } from "@/lib/validations"
import { getClientIP, rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

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
        const parsed = resetPasswordSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: parsed.error.issues[0]?.message || "Datos invalidos" },
                { status: 400 }
            )
        }

        const user = await prisma.user.findFirst({
            where: {
                resetToken: parsed.data.token,
                resetTokenExp: {
                    gt: new Date(),
                },
            },
        })

        if (!user) {
            return NextResponse.json(
                { success: false, error: "Token invalido o expirado" },
                { status: 400 }
            )
        }

        const passwordHash = await hashPassword(parsed.data.password)

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExp: null,
            },
        })

        return NextResponse.json({
            success: true,
            message: "Tu contraseña fue actualizada correctamente.",
        })
    } catch (error) {
        console.error("Reset password error:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo restablecer la contraseña" },
            { status: 500 }
        )
    }
}
