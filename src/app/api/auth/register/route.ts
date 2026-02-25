import { NextRequest, NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { sendVerificationEmail } from "@/lib/email"
import { randomBytes } from "crypto"
import { rateLimit, getClientIP } from "@/lib/rate-limit"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        // Rate limiting
        const ip = getClientIP(request)
        const { success: rateLimitOk, remaining } = await rateLimit(ip, "auth")
        
        if (!rateLimitOk) {
            return NextResponse.json(
                { success: false, error: "Demasiados intentos. Intenta de nuevo en un minuto." },
                { status: 429, headers: { "X-RateLimit-Remaining": remaining.toString() } }
            )
        }

        const body = await request.json()
        const name = String(body.name || "").trim()
        const email = String(body.email || "").trim().toLowerCase()
        const password = String(body.password || "")
        const dni = String(body.dni || "").trim()
        const phone = String(body.phone || "").trim()
        const birthDate = body.birthDate ? String(body.birthDate).trim() : ""
        const distrito = String(body.distrito || "").trim()

        if (!name || !email || !password || !dni || !phone || !birthDate || !distrito) {
            return NextResponse.json(
                { success: false, error: "Faltan datos requeridos" },
                { status: 400 }
            )
        }

        // Validate DNI format (8 digits)
        if (!/^\d{8}$/.test(dni)) {
            return NextResponse.json(
                { success: false, error: "El DNI debe tener exactamente 8 dígitos" },
                { status: 400 }
            )
        }

        // Validate phone format (9 digits)
        if (!/^\d{9}$/.test(phone)) {
            return NextResponse.json(
                { success: false, error: "El teléfono debe tener exactamente 9 dígitos" },
                { status: 400 }
            )
        }

        // Validate birth date
        const parsedBirthDate = new Date(birthDate)
        if (isNaN(parsedBirthDate.getTime())) {
            return NextResponse.json(
                { success: false, error: "Fecha de nacimiento inválida" },
                { status: 400 }
            )
        }

        // Check if user exists
        const existingUser = await prisma.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
        })

        if (existingUser) {
            if (existingUser.emailVerifiedAt) {
                return NextResponse.json(
                    { success: false, error: "El email ya está registrado" },
                    { status: 400 }
                )
            }

            // Allow re-registering when email is not verified: update credentials and resend verification
            const passwordHash = await hash(password, 12)
            const verifyToken = randomBytes(32).toString("hex")

            const updatedUser = await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                    name,
                    email,
                    passwordHash,
                    dni,
                    phone,
                    birthDate: parsedBirthDate,
                    distrito,
                    verifyToken,
                    emailVerifiedAt: null,
                    resetToken: null,
                    resetTokenExp: null,
                },
            })

            const emailResult = await sendVerificationEmail(email, name, verifyToken)
            if (!emailResult.success) {
                console.error("Verification email failed:", emailResult.error)
                return NextResponse.json(
                    {
                        success: false,
                        error: `No se pudo enviar el correo de verificación. ${emailResult.error ?? ""}`.trim(),
                    },
                    { status: 500 }
                )
            }

            return NextResponse.json({
                success: true,
                data: {
                    id: updatedUser.id,
                    name: updatedUser.name,
                    email: updatedUser.email,
                },
            })
        }

        // Hash password
        const passwordHash = await hash(password, 12)

        // Generate verification token
        const verifyToken = randomBytes(32).toString("hex")

        // Create user
        const user = await prisma.user.create({
            data: {
                name,
                email,
                passwordHash,
                dni,
                phone,
                birthDate: parsedBirthDate,
                distrito,
                role: "USER",
                verifyToken,
            },
        })

        // Send verification email
        const emailResult = await sendVerificationEmail(email, name, verifyToken)
        if (!emailResult.success) {
            console.error("Verification email failed:", emailResult.error)
            return NextResponse.json(
                {
                    success: false,
                    error: `No se pudo enviar el correo de verificación. ${emailResult.error ?? ""}`.trim(),
                },
                { status: 500 }
            )
        }

        return NextResponse.json({
            success: true,
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
            },
        })
    } catch (error) {
        console.error("Registration error:", error)
        return NextResponse.json(
            { success: false, error: "Error al registrar usuario" },
            { status: 500 }
        )
    }
}

