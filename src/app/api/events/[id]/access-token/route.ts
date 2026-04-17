import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { onEventUpdated } from "@/lib/cached-queries"

export const runtime = "nodejs"

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params
        const accessToken = randomBytes(24).toString("base64url")

        const event = await prisma.event.update({
            where: { id },
            data: { accessToken },
            select: { id: true, slug: true, accessToken: true },
        })

        await onEventUpdated(event.id, event.slug)

        return NextResponse.json({
            success: true,
            data: { accessToken: event.accessToken },
        })
    } catch (error) {
        console.error("Error regenerating access token:", error)
        return NextResponse.json(
            { success: false, error: "Error al regenerar el enlace" },
            { status: 500 }
        )
    }
}
