import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hashPassword } from "@/lib/auth"
import crypto from "crypto"

export const runtime = "nodejs"

// Generate a random temporary password
function generateTempPassword(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    let password = ""
    for (let i = 0; i < 10; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password + "!"
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || currentUser.role !== "ADMIN") {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params

        // Find the user
        const user = await prisma.user.findUnique({
            where: { id }
        })

        if (!user) {
            return NextResponse.json(
                { success: false, error: "Usuario no encontrado" },
                { status: 404 }
            )
        }

        // Generate new temporary password
        const tempPassword = generateTempPassword()
        const passwordHash = await hashPassword(tempPassword)

        // Update user password
        await prisma.user.update({
            where: { id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExp: null,
                updatedAt: new Date(),
            }
        })

        return NextResponse.json({
            success: true,
            data: {
                tempPassword,
                userId: user.id,
                email: user.email,
            }
        })
    } catch (error) {
        console.error("Reset password error:", error)
        return NextResponse.json(
            { success: false, error: "Error al resetear contraseña" },
            { status: 500 }
        )
    }
}
