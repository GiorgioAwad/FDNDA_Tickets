import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import {
    membershipChangeInclude,
    ticketTypeSnapshotSelect,
    toChangeSnapshot,
    toTicketTypeSnapshot,
} from "@/lib/membership-admin-snapshot"
import {
    applyMembershipChange,
    lockMembershipTicket,
    MembershipChangeAbort,
} from "@/lib/membership-change-apply"
import {
    isMembershipTicketType,
    NOT_A_MEMBERSHIP_ERROR,
    planMembershipChange,
    type MembershipChangeIntent,
} from "@/lib/membership-transfer"
import { onEventUpdated } from "@/lib/cached-queries"
import { prisma } from "@/lib/prisma"
import {
    buildTicketDateReservationCounts,
    getRequiredTicketDateSelections,
    usesTicketDateCapacity,
} from "@/lib/ticket-date-capacity"
import {
    releaseTicketTypeDateInventory,
    reserveTicketTypeDateInventory,
} from "@/lib/ticket-date-inventory"

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
            targetTicketTypeId?: string
            selection?: { category?: string; frequency?: string; hours?: Record<string, string> }
            reason?: string
            preview?: boolean
            allowOverCapacity?: boolean
            eventTicketsScope?: boolean
            // Contrato con la UI (Tarea 10), igual que en schedule/route.ts: la
            // huella (`plan.fingerprint`) que la respuesta de preview le
            // devolvio al admin. Al confirmar, la ruta la reenvia tal cual y ES
            // ESA la que se compara contra el estado releido dentro de la
            // transaccion -no la recalculada en este mismo POST-, porque la
            // ventana que hay que proteger es la que va desde que el admin vio
            // la vista previa hasta que apreto "Aplicar". Si no viene
            // (compatibilidad hacia atras), se cae a comparar contra la huella
            // recalculada aqui mismo.
            fingerprint?: string
        }

        const targetTicketTypeId = body.targetTicketTypeId?.trim() ?? ""
        if (!targetTicketTypeId) {
            return NextResponse.json(
                { success: false, error: "Indica el tipo de entrada destino." },
                { status: 400 }
            )
        }
        const reason = body.reason?.trim() ?? ""
        const isPreview = body.preview === true
        if (!isPreview && reason.length < 5) {
            return NextResponse.json(
                { success: false, error: "Indica el motivo del cambio (minimo 5 caracteres)." },
                { status: 400 }
            )
        }
        if (!isPreview && body.allowOverCapacity === true && reason.length < 10) {
            return NextResponse.json(
                {
                    success: false,
                    error: "El sobrecupo requiere un motivo detallado (minimo 10 caracteres).",
                },
                { status: 400 }
            )
        }

        const [record, targetRecord] = await Promise.all([
            prisma.ticket.findUnique({ where: { id: ticketId }, include: membershipChangeInclude }),
            prisma.ticketType.findUnique({
                where: { id: targetTicketTypeId },
                select: ticketTypeSnapshotSelect,
            }),
        ])
        if (!record) {
            return NextResponse.json({ success: false, error: "Carnet no encontrado" }, { status: 404 })
        }
        if (!targetRecord) {
            return NextResponse.json(
                { success: false, error: "Tipo de entrada destino no encontrado" },
                { status: 404 }
            )
        }
        // Mismo criterio que la ficha: esta ruta mueve el `ticketTypeId` y el
        // `sold` entre tipos. Sin este filtro un ADMIN podria, con una request
        // a mano, mover de evento una entrada que no es membresia y arrastrarle
        // el contador de vendidos. Aqui no hay ni siquiera un requisito de
        // perfil de horario que lo tapara por accidente.
        if (!body.eventTicketsScope && !isMembershipTicketType(record.ticketType)) {
            return NextResponse.json(
                { success: false, error: NOT_A_MEMBERSHIP_ERROR },
                { status: 404 }
            )
        }
        const snapshot = toChangeSnapshot(record)
        if (!snapshot) {
            return NextResponse.json({ success: false, error: SNAPSHOT_MISSING }, { status: 409 })
        }

        const intent: MembershipChangeIntent = {
            kind: "TRANSFER",
            targetType: toTicketTypeSnapshot(targetRecord),
            scheduleInput: body.selection ?? null,
            allowOverCapacity: body.allowOverCapacity === true,
            allowAnySameEventTicket: body.eventTicketsScope === true,
        }

        const plan = planMembershipChange(snapshot, intent)
        if (!plan.ok) {
            return NextResponse.json({ success: false, blockers: plan.blockers }, { status: 409 })
        }
        if (isPreview) {
            return NextResponse.json({ success: true, data: { plan } })
        }

        // Replanificar dentro de la transaccion: si el carnet o el tipo destino
        // cambiaron desde que el admin vio la vista previa, se aborta en vez de
        // escribir. El lock de fila va ANTES de releer: sin el, dos "Aplicar"
        // concurrentes sobre el mismo carnet podrian releer el mismo estado,
        // pasar ambos la comparacion de huella, y mover el cupo dos veces con
        // un solo carnet movido.
        const appliedPlan = await prisma.$transaction(async (tx) => {
            await lockMembershipTicket(tx, ticketId)

            const [fresh, freshTarget] = await Promise.all([
                tx.ticket.findUnique({ where: { id: ticketId }, include: membershipChangeInclude }),
                tx.ticketType.findUnique({
                    where: { id: targetTicketTypeId },
                    select: ticketTypeSnapshotSelect,
                }),
            ])
            const freshSnapshot = fresh ? toChangeSnapshot(fresh) : null
            if (!freshSnapshot || !freshTarget) throw new MembershipChangeAbort(SNAPSHOT_MISSING)

            const freshPlan = planMembershipChange(freshSnapshot, {
                ...intent,
                targetType: toTicketTypeSnapshot(freshTarget),
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

            if (
                usesTicketDateCapacity({
                    eventCategory: freshSnapshot.sourceType.eventCategory,
                    capacityByDate: freshSnapshot.sourceType.capacityByDate,
                })
            ) {
                const attendees = Array.isArray(freshSnapshot.orderItem.attendeeData)
                    ? freshSnapshot.orderItem.attendeeData
                    : []
                const sourceReservations = buildTicketDateReservationCounts({
                    attendees,
                    quantity: freshSnapshot.orderItem.quantity,
                    validDays: freshSnapshot.sourceType.validDays,
                    eventStartDate: freshSnapshot.sourceType.eventStartDate,
                    eventEndDate: freshSnapshot.sourceType.eventEndDate,
                    ticketLabel: freshSnapshot.sourceType.name,
                    requiredSelections: getRequiredTicketDateSelections(freshSnapshot.sourceType),
                })
                const targetSnapshot = toTicketTypeSnapshot(freshTarget)
                const targetReservations = buildTicketDateReservationCounts({
                    attendees,
                    quantity: freshSnapshot.orderItem.quantity,
                    validDays: targetSnapshot.validDays,
                    eventStartDate: targetSnapshot.eventStartDate,
                    eventEndDate: targetSnapshot.eventEndDate,
                    ticketLabel: targetSnapshot.name,
                    requiredSelections: getRequiredTicketDateSelections(targetSnapshot),
                })
                await releaseTicketTypeDateInventory(tx, {
                    ticketTypeId: freshSnapshot.sourceType.id,
                    reservations: sourceReservations,
                    requireExisting: true,
                })
                await reserveTicketTypeDateInventory(tx, {
                    ticketTypeId: targetSnapshot.id,
                    templateCapacity: targetSnapshot.capacity,
                    reservations: targetReservations,
                    ticketLabel: targetSnapshot.name,
                    requireConfigured: true,
                    allowOverCapacity: body.allowOverCapacity === true,
                })
            }

            await applyMembershipChange(tx, {
                plan: freshPlan,
                ticketId,
                orderItemId: freshSnapshot.orderItem.id,
                actorId: user.id,
                reason,
            })

            // Se devuelve el plan REPLANIFICADO y efectivamente escrito, no el
            // de la lectura inicial: la huella no incluye el `sold` del tipo
            // destino, asi que `plan.after` podria mostrarle al admin un
            // `targetSold` desfasado del que realmente se escribio.
            return freshPlan
        })

        await Promise.all(
            Array.from(new Set([record.eventId, targetRecord.eventId])).map((eventId) =>
                onEventUpdated(eventId)
            )
        )

        return NextResponse.json({ success: true, data: { plan: appliedPlan } })
    } catch (error) {
        if (error instanceof MembershipChangeAbort) {
            return NextResponse.json({ success: false, error: error.message }, { status: 409 })
        }
        console.error("Error al mover el carnet de tipo:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
