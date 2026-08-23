import { NextRequest, NextResponse } from "next/server"
import type { InvoiceStatus } from "@prisma/client"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const discardSchema = z.object({
    reason: z.string().trim().min(5).max(500),
})

const DISCARDABLE_STATUSES: InvoiceStatus[] = ["FAILED", "FAILED_RETRYABLE", "FAILED_REQUIRES_REVIEW"]

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const parsed = discardSchema.safeParse(await request.json())
        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Indica un motivo de entre 5 y 500 caracteres.",
                },
                { status: 400 },
            )
        }

        const { id } = await params
        const current = await prisma.invoice.findUnique({
            where: { id },
            select: { id: true, status: true },
        })

        if (!current) {
            return NextResponse.json({ success: false, error: "Comprobante no encontrado." }, { status: 404 })
        }

        if (current.status === "DISCARDED") {
            return NextResponse.json({
                success: true,
                data: current,
                message: "El comprobante ya estaba dado de baja.",
            })
        }

        if (!DISCARDABLE_STATUSES.includes(current.status)) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Solo se pueden dar de baja comprobantes fallidos.",
                },
                { status: 409 },
            )
        }

        const discardedAt = new Date()
        const result = await prisma.invoice.updateMany({
            where: { id, status: { in: DISCARDABLE_STATUSES } },
            data: {
                status: "DISCARDED",
                discardedAt,
                discardedReason: parsed.data.reason,
                discardedByUserId: user.id,
            },
        })

        if (result.count !== 1) {
            return NextResponse.json(
                {
                    success: false,
                    error: "El estado cambio. Actualiza la pagina e intenta nuevamente.",
                },
                { status: 409 },
            )
        }

        return NextResponse.json({
            success: true,
            data: {
                id,
                status: "DISCARDED",
                discardedAt: discardedAt.toISOString(),
                discardedReason: parsed.data.reason,
            },
            message: "Comprobante dado de baja. El historial se conserva.",
        })
    } catch (error) {
        console.error("Error discarding ABIO invoice:", error)
        return NextResponse.json({ success: false, error: "No se pudo dar de baja el comprobante." }, { status: 500 })
    }
}
