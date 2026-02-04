import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        // Fetch all users with stats
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                emailVerifiedAt: true,
                createdAt: true,
                _count: {
                    select: {
                        tickets: true,
                        orders: true,
                    }
                }
            },
            orderBy: { createdAt: "desc" }
        })

        // Calculate stats
        const totalUsers = users.length
        const admins = users.filter(u => u.role === "ADMIN").length
        const scanners = users.filter(u => u.role === "STAFF").length  // STAFF is the scanner role
        const verified = users.filter(u => u.emailVerifiedAt !== null).length

        return NextResponse.json({
            success: true,
            data: {
                users,
                totalUsers,
                admins,
                scanners,
                verified,
            }
        })
    } catch (error) {
        console.error("Error fetching users:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener usuarios" },
            { status: 500 }
        )
    }
}
