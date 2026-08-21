import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { membershipChangeInclude, toChangeSnapshot } from "@/lib/membership-admin-snapshot"
import { applyMembershipChange } from "@/lib/membership-change-apply"
import { planMembershipChange } from "@/lib/membership-transfer"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SNAPSHOT_MISSING =
    "No se pudo identificar el item de la orden que corresponde a este carnet."

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== UserRole.ADMIN) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const { ticketId } = await params
        const body = (await request.json()) as {
            selection?: { category?: string; frequency?: string; hours?: Record<string, string> }
            reason?: string
            preview?: boolean
        }

        const reason = body.reason?.trim() ?? ""
        const isPreview = body.preview === true
        if (!isPreview && reason.length < 5) {
            return NextResponse.json(
                { success: false, error: "Indica el motivo del cambio (minimo 5 caracteres)." },
                { status: 400 }
            )
        }

        const record = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: membershipChangeInclude,
        })
        if (!record) {
            return NextResponse.json({ success: false, error: "Carnet no encontrado" }, { status: 404 })
        }
        const snapshot = toChangeSnapshot(record)
        if (!snapshot) {
            return NextResponse.json({ success: false, error: SNAPSHOT_MISSING }, { status: 409 })
        }

        const plan = planMembershipChange(snapshot, {
            kind: "SCHEDULE",
            scheduleInput: body.selection ?? {},
        })
        if (!plan.ok) {
            return NextResponse.json({ success: false, blockers: plan.blockers }, { status: 409 })
        }
        if (isPreview) {
            return NextResponse.json({ success: true, data: { plan } })
        }

        // Replanificar dentro de la transaccion: si el carnet cambio desde que
        // el admin vio la vista previa, se aborta en vez de escribir.
        await prisma.$transaction(async (tx) => {
            const fresh = await tx.ticket.findUnique({
                where: { id: ticketId },
                include: membershipChangeInclude,
            })
            const freshSnapshot = fresh ? toChangeSnapshot(fresh) : null
            if (!freshSnapshot) throw new Error(SNAPSHOT_MISSING)

            const freshPlan = planMembershipChange(freshSnapshot, {
                kind: "SCHEDULE",
                scheduleInput: body.selection ?? {},
            })
            if (!freshPlan.ok) {
                throw new Error(freshPlan.blockers.map((b) => b.message).join(" "))
            }
            if (freshPlan.fingerprint !== plan.fingerprint) {
                throw new Error(
                    "El carnet cambio desde que abriste la pantalla. Recarga y vuelve a revisar antes de aplicar."
                )
            }

            await applyMembershipChange(tx, {
                plan: freshPlan,
                ticketId,
                orderItemId: freshSnapshot.orderItem.id,
                actorId: user.id,
                reason,
            })
        })

        return NextResponse.json({ success: true, data: { plan } })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error interno"
        console.error("Error al cambiar el horario de la membresia:", error)
        return NextResponse.json({ success: false, error: message }, { status: 409 })
    }
}
