import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import bcrypt from "bcryptjs"
import crypto from "crypto"

export async function POST(request: Request) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const { email, name } = body

        // Validate input
        if (!email || !name) {
            return NextResponse.json(
                { success: false, error: "Email y nombre son requeridos" },
                { status: 400 }
            )
        }

        // Check if email already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        })

        if (existingUser) {
            return NextResponse.json(
                { success: false, error: "Este email ya está registrado" },
                { status: 400 }
            )
        }

        // Generate temporary password
        const tempPassword = crypto.randomBytes(4).toString("hex") // 8 character password

        // Hash password
        const passwordHash = await bcrypt.hash(tempPassword, 12)

        // Create user with STAFF role and verified email
        const newUser = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                name,
                passwordHash,
                role: "STAFF",
                emailVerifiedAt: new Date(), // Auto-verify staff users
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
            }
        })

        return NextResponse.json({
            success: true,
            data: {
                user: newUser,
                tempPassword, // Send back temp password to show to admin
            },
            message: "Usuario Staff creado exitosamente"
        })
    } catch (error) {
        console.error("Error creating staff user:", error)
        return NextResponse.json(
            { success: false, error: "Error al crear usuario" },
            { status: 500 }
        )
    }
}
