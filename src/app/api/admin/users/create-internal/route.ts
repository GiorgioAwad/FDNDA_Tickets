import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

const allowedRoles = ["STAFF", "TREASURY"] as const
type InternalRole = (typeof allowedRoles)[number]

export async function POST(request: Request) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const { email, name, role } = body as {
            email?: string
            name?: string
            role?: InternalRole
        }

        if (!email || !name || !role) {
            return NextResponse.json(
                { success: false, error: "Email, nombre y rol son requeridos" },
                { status: 400 }
            )
        }

        if (!allowedRoles.includes(role)) {
            return NextResponse.json(
                { success: false, error: "Rol invalido" },
                { status: 400 }
            )
        }

        const normalizedEmail = email.toLowerCase().trim()
        const normalizedName = name.trim()

        if (!normalizedEmail || !normalizedName) {
            return NextResponse.json(
                { success: false, error: "Email y nombre no pueden estar vacios" },
                { status: 400 }
            )
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        })

        if (existingUser) {
            return NextResponse.json(
                { success: false, error: "Este email ya esta registrado" },
                { status: 400 }
            )
        }

        const tempPassword = crypto.randomBytes(4).toString("hex")
        const passwordHash = await bcrypt.hash(tempPassword, 12)

        const newUser = await prisma.user.create({
            data: {
                email: normalizedEmail,
                name: normalizedName,
                passwordHash,
                role,
                emailVerifiedAt: new Date(),
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
            },
        })

        return NextResponse.json({
            success: true,
            data: {
                user: newUser,
                tempPassword,
            },
            message: `Usuario ${role === "TREASURY" ? "de tesoreria" : "staff"} creado exitosamente`,
        })
    } catch (error) {
        console.error("Error creating internal user:", error)
        return NextResponse.json(
            { success: false, error: "Error al crear usuario interno" },
            { status: 500 }
        )
    }
}
