import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { membershipChangeInclude, toChangeSnapshot } from "@/lib/membership-admin-snapshot"
import {
    applyMembershipChange,
    lockMembershipTicket,
    MembershipChangeAbort,
} from "@/lib/membership-change-apply"
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
            // Contrato con la UI (Tarea 10): la huella (`plan.fingerprint`) que
            // la respuesta de preview le devolvio al admin. Al confirmar, la
            // ruta la reenvia tal cual y ES ESA la que se compara contra el
            // estado releido dentro de la transaccion -no la recalculada en
            // este mismo POST-, porque la ventana que hay que proteger es la
            // que va desde que el admin vio la vista previa hasta que apreto
            // "Aplicar", no la de esta request. Si no viene (compatibilidad
            // hacia atras), se cae a comparar contra la huella recalculada
            // aqui mismo, que solo protege la ventana de esta request.
            fingerprint?: string
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
        // el admin vio la vista previa, se aborta en vez de escribir. El lock
        // de fila va ANTES de releer: sin el, dos "Aplicar" concurrentes
        // podrian releer el mismo estado, pasar ambos la comparacion de huella
        // y aplicar el cambio dos veces.
        const appliedPlan = await prisma.$transaction(async (tx) => {
            await lockMembershipTicket(tx, ticketId)

            const fresh = await tx.ticket.findUnique({
                where: { id: ticketId },
                include: membershipChangeInclude,
            })
            const freshSnapshot = fresh ? toChangeSnapshot(fresh) : null
            if (!freshSnapshot) throw new MembershipChangeAbort(SNAPSHOT_MISSING)

            const freshPlan = planMembershipChange(freshSnapshot, {
                kind: "SCHEDULE",
                scheduleInput: body.selection ?? {},
            })
            if (!freshPlan.ok) {
                throw new MembershipChangeAbort(freshPlan.blockers.map((b) => b.message).join(" "))
            }
            // La huella que el admin realmente vio (enviada por la UI) manda;
            // la recalculada en este mismo POST solo es respaldo si no vino.
            const expectedFingerprint = body.fingerprint ?? plan.fingerprint
            if (freshPlan.fingerprint !== expectedFingerprint) {
                throw new MembershipChangeAbort(
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

            // Se devuelve el plan REPLANIFICADO y efectivamente escrito, no el
            // de la lectura inicial: en TRANSFER (Tarea 7) el fingerprint no
            // incluye el `sold` del tipo destino, asi que `plan.after` podria
            // mostrarle al admin un `targetSold` desfasado del que se escribio.
            return freshPlan
        })

        return NextResponse.json({ success: true, data: { plan: appliedPlan } })
    } catch (error) {
        if (error instanceof MembershipChangeAbort) {
            return NextResponse.json({ success: false, error: error.message }, { status: 409 })
        }
        console.error("Error al cambiar el horario de la membresia:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
