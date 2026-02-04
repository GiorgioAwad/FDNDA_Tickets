import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const token = searchParams.get("token")

        if (!token) {
            return NextResponse.json(
                { success: false, error: "Token no proporcionado" },
                { status: 400 }
            )
        }

        // Find user with this token
        const user = await prisma.user.findFirst({
            where: { verifyToken: token },
        })

        if (!user) {
            return NextResponse.json(
                { success: false, error: "Token inválido o expirado" },
                { status: 400 }
            )
        }

        // Check if already verified
        if (user.emailVerifiedAt) {
            return NextResponse.json({
                success: true,
                message: "Email ya verificado anteriormente",
            })
        }

        // Update user as verified
        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerifiedAt: new Date(),
                verifyToken: null,
            },
        })

        return NextResponse.json({
            success: true,
            message: "Email verificado exitosamente",
        })
    } catch (error) {
        console.error("Verification error:", error)
        return NextResponse.json(
            { success: false, error: "Error al verificar email" },
            { status: 500 }
        )
    }
}

