/**
 * Corrige la sede operativa de membresías sin alterar comprobantes ABIO.
 *
 * Consulta (por defecto):
 *   node --env-file=.env.production ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/reassign-membership-sites.ts
 *
 * Aplicación:
 *   node --env-file=.env.production ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/reassign-membership-sites.ts --apply
 */
import type { Prisma as PrismaTypes } from "@prisma/client"

type ReassignmentSpec = {
    label: string
    ticketId: string
    orderId: string
    orderItemId: string
    sourceEventId: string
    sourceTicketTypeId: string
    targetEventId: string
    targetTicketTypeId: string
    targetSucursal: string
    scheduleKey: "BRONCE" | "BRONCE_2X"
    matricula: string
    expectedPrice: number
    expectedStartDate: string
    expectedSessions: Array<{ weekday: number; start: string; end: string }>
}

const REASSIGNMENTS: ReassignmentSpec[] = [
    {
        label: "Onelia Portocarrero",
        ticketId: "cmr0xfh3k011201qn4snk9kq1",
        orderId: "cmr0xazip011001qn2wynwjkw",
        orderItemId: "cmr0xazjd011101qnankly5oz",
        sourceEventId: "cmqtpjkzl003g01qex3xwhgfl",
        sourceTicketTypeId: "cmqzybo7y00qj01qnoy61koak",
        targetEventId: "cmqto4hi8003801qe2peblce8",
        targetTicketTypeId: "cmqzya1mo00qb01qn0a59dfdg",
        targetSucursal: "01",
        scheduleKey: "BRONCE_2X",
        matricula: "5393830",
        expectedPrice: 890,
        expectedStartDate: "2026-08-01",
        expectedSessions: [
            { weekday: 2, start: "10:00", end: "11:00" },
            { weekday: 4, start: "10:00", end: "11:00" },
        ],
    },
    {
        label: "Valeria Chilo",
        ticketId: "cmrfho1rs00sz01pbl6vr2zrc",
        orderId: "cmrfhmn1300s801pbj9vidjnr",
        orderItemId: "cmrfhmn1t00s901pbfts5m7ft",
        sourceEventId: "cmqto4hi8003801qe2peblce8",
        sourceTicketTypeId: "cmqto8hq5003901qed9smx1cw",
        targetEventId: "cmqtpjkzl003g01qex3xwhgfl",
        targetTicketTypeId: "cmqtqr88u003s01qesb56krfw",
        targetSucursal: "03",
        scheduleKey: "BRONCE",
        matricula: "6176656",
        expectedPrice: 1090,
        expectedStartDate: "2026-08-01",
        expectedSessions: [
            { weekday: 1, start: "20:00", end: "21:00" },
            { weekday: 3, start: "20:00", end: "21:00" },
            { weekday: 5, start: "20:00", end: "21:00" },
        ],
    },
]

const APPLY = process.argv.includes("--apply")

function fail(message: string): never {
    throw new Error(message)
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function dateKey(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) fail(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}

function scheduleInputFromStored(value: unknown): {
    category: string
    frequency: string
    hours: Record<string, string>
} {
    const stored = asRecord(value)
    const groups = Array.isArray(stored.groups) ? stored.groups : []
    const hours: Record<string, string> = {}
    for (const rawGroup of groups) {
        const group = asRecord(rawGroup)
        if (
            typeof group.id === "string" &&
            typeof group.start === "string" &&
            typeof group.end === "string"
        ) {
            hours[group.id] = `${group.start}-${group.end}`
        }
    }
    return {
        category: typeof stored.category === "string" ? stored.category : "",
        frequency: typeof stored.frequency === "string" ? stored.frequency : "",
        hours,
    }
}

function normalizeSessions(value: unknown): string[] {
    const record = asRecord(value)
    const sessions = Array.isArray(record.sessions) ? record.sessions : []
    return sessions.map((raw) => {
        const session = asRecord(raw)
        return `${Number(session.weekday)}:${String(session.start)}-${String(session.end)}`
    }).sort()
}

function expectedSessionKeys(spec: ReassignmentSpec): string[] {
    return spec.expectedSessions
        .map((session) => `${session.weekday}:${session.start}-${session.end}`)
        .sort()
}

async function main() {
    const [{ prisma }, { Prisma }, scheduleModule] = await Promise.all([
        import("@/lib/prisma"),
        import("@prisma/client"),
        import("@/lib/membership-schedule"),
    ])
    const { getMembershipScheduleProfile, validateMembershipScheduleSelection } = scheduleModule

    const prepared: Array<{
        spec: ReassignmentSpec
        attendeeData: PrismaTypes.InputJsonValue
        membershipSchedule: PrismaTypes.InputJsonValue
        alreadyApplied: boolean
        before: Record<string, unknown>
    }> = []

    for (const spec of REASSIGNMENTS) {
        const [ticket, orderItem, sourceType, targetType] = await Promise.all([
            prisma.ticket.findUnique({
                where: { id: spec.ticketId },
                include: {
                    order: {
                        include: {
                            invoices: {
                                select: {
                                    id: true,
                                    status: true,
                                    servilexGroupKey: true,
                                    invoiceNumber: true,
                                },
                            },
                        },
                    },
                    scans: { select: { id: true, result: true, eventId: true } },
                    monthlySchedules: { select: { id: true } },
                },
            }),
            prisma.orderItem.findUnique({ where: { id: spec.orderItemId } }),
            prisma.ticketType.findUnique({
                where: { id: spec.sourceTicketTypeId },
                select: {
                    id: true,
                    eventId: true,
                    price: true,
                    capacity: true,
                    sold: true,
                    isActive: true,
                    isPackage: true,
                    packageDaysCount: true,
                    monthlyClassLimit: true,
                    membershipDurationMonths: true,
                    membershipScheduleKey: true,
                    event: true,
                },
            }),
            prisma.ticketType.findUnique({
                where: { id: spec.targetTicketTypeId },
                select: {
                    id: true,
                    eventId: true,
                    price: true,
                    capacity: true,
                    sold: true,
                    isActive: true,
                    isPackage: true,
                    packageDaysCount: true,
                    monthlyClassLimit: true,
                    membershipDurationMonths: true,
                    membershipScheduleKey: true,
                    event: true,
                },
            }),
        ])

        if (!ticket) fail(`${spec.label}: ticket no encontrado`)
        if (!orderItem) fail(`${spec.label}: OrderItem no encontrado`)
        if (!sourceType || !targetType) fail(`${spec.label}: tipo origen o destino no encontrado`)

        const isSourceState =
            ticket.eventId === spec.sourceEventId &&
            ticket.ticketTypeId === spec.sourceTicketTypeId &&
            orderItem.ticketTypeId === spec.sourceTicketTypeId
        const isTargetState =
            ticket.eventId === spec.targetEventId &&
            ticket.ticketTypeId === spec.targetTicketTypeId &&
            orderItem.ticketTypeId === spec.targetTicketTypeId
        if (!isSourceState && !isTargetState) {
            fail(`${spec.label}: ticket y OrderItem no están íntegramente en la sede origen ni en la destino`)
        }

        assertEqual(ticket.orderId, spec.orderId, `${spec.label}: orden del ticket`)
        assertEqual(ticket.status, "ACTIVE", `${spec.label}: estado del ticket`)
        assertEqual(dateKey(ticket.membershipStartDate), spec.expectedStartDate, `${spec.label}: inicio`)
        assertEqual(ticket.order.status, "PAID", `${spec.label}: estado de la orden`)
        assertEqual(orderItem.orderId, spec.orderId, `${spec.label}: orden del item`)
        assertEqual(orderItem.quantity, 1, `${spec.label}: cantidad del item`)
        assertEqual(Number(orderItem.unitPrice), spec.expectedPrice, `${spec.label}: precio unitario`)
        assertEqual(Number(orderItem.subtotal), spec.expectedPrice, `${spec.label}: subtotal`)
        assertEqual(sourceType.eventId, spec.sourceEventId, `${spec.label}: evento del tipo origen`)
        assertEqual(targetType.eventId, spec.targetEventId, `${spec.label}: evento del tipo destino`)
        assertEqual(targetType.event.servilexSucursalCode, spec.targetSucursal, `${spec.label}: sede destino`)
        assertEqual(Number(sourceType.price), spec.expectedPrice, `${spec.label}: precio del tipo origen`)
        assertEqual(Number(targetType.price), spec.expectedPrice, `${spec.label}: precio del tipo destino`)
        assertEqual(sourceType.membershipScheduleKey, spec.scheduleKey, `${spec.label}: perfil origen`)
        assertEqual(targetType.membershipScheduleKey, spec.scheduleKey, `${spec.label}: perfil destino`)
        assertEqual(sourceType.monthlyClassLimit, targetType.monthlyClassLimit, `${spec.label}: límite mensual equivalente`)
        assertEqual(sourceType.membershipDurationMonths, targetType.membershipDurationMonths, `${spec.label}: duración equivalente`)
        assertEqual(sourceType.isPackage, targetType.isPackage, `${spec.label}: modalidad equivalente`)
        if (isSourceState && sourceType.sold < 1) {
            fail(`${spec.label}: el contador sold de origen ya está en cero`)
        }
        if (isSourceState && targetType.capacity !== 0 && targetType.sold + 1 > targetType.capacity) {
            fail(`${spec.label}: el tipo destino no tiene cupo global`)
        }
        if (ticket.monthlySchedules.length > 0) {
            fail(`${spec.label}: tiene cambios mensuales de horario; requiere revisión manual`)
        }

        const issuedInvoice = ticket.order.invoices.find(
            (invoice) =>
                invoice.status === "ISSUED" &&
                invoice.servilexGroupKey.toUpperCase().endsWith(`:MATRICULA:${spec.matricula}`)
        )
        if (!issuedInvoice) fail(`${spec.label}: no se encontró el comprobante AC emitido de la matrícula`)

        const currentScheduleInput = scheduleInputFromStored(ticket.membershipSchedule)
        const profile = getMembershipScheduleProfile(spec.targetSucursal, spec.scheduleKey)
        if (!profile) fail(`${spec.label}: no existe el perfil de horario en la sede destino`)
        const scheduleResult = validateMembershipScheduleSelection(
            profile,
            currentScheduleInput,
            spec.targetSucursal
        )
        if (!scheduleResult.ok) fail(`${spec.label}: horario incompatible: ${scheduleResult.error}`)
        const targetMembershipSchedule = scheduleResult.selection
        const actualSessions = normalizeSessions(targetMembershipSchedule)
        const expectedSessions = expectedSessionKeys(spec)
        if (JSON.stringify(actualSessions) !== JSON.stringify(expectedSessions)) {
            fail(`${spec.label}: el horario normalizado no coincide (${actualSessions.join(", ")})`)
        }

        if (!Array.isArray(orderItem.attendeeData) || orderItem.attendeeData.length !== 1) {
            fail(`${spec.label}: attendeeData debe contener exactamente una persona`)
        }
        const attendee = asRecord(orderItem.attendeeData[0])
        assertEqual(String(attendee.matricula ?? ""), spec.matricula, `${spec.label}: matrícula en attendeeData`)
        const updatedAttendeeData = [{
            ...attendee,
            membershipSchedule: targetMembershipSchedule,
        }] as unknown as PrismaTypes.InputJsonValue

        prepared.push({
            spec,
            attendeeData: updatedAttendeeData,
            membershipSchedule: targetMembershipSchedule as unknown as PrismaTypes.InputJsonValue,
            alreadyApplied: isTargetState,
            before: {
                state: isTargetState ? "already_applied" : "source",
                ticketEventId: ticket.eventId,
                ticketTypeId: ticket.ticketTypeId,
                sourceSold: sourceType.sold,
                targetSold: targetType.sold,
                orderTotal: Number(ticket.order.totalAmount),
                invoiceId: issuedInvoice.id,
                invoiceNumber: issuedInvoice.invoiceNumber,
                invoiceGroupKey: issuedInvoice.servilexGroupKey,
                wrongEventScans: ticket.scans.filter((scan) => scan.result === "WRONG_EVENT").length,
                schedule: actualSessions,
            },
        })
    }

    console.log(JSON.stringify({ mode: APPLY ? "apply" : "query", records: prepared.map((entry) => ({
        person: entry.spec.label,
        before: entry.before,
        intended: {
            targetEventId: entry.spec.targetEventId,
            targetTicketTypeId: entry.spec.targetTicketTypeId,
            targetSucursal: entry.spec.targetSucursal,
        },
    })) }, null, 2))

    if (!APPLY) {
        const pending = prepared.filter((entry) => !entry.alreadyApplied).length
        console.log(
            pending === 0
                ? "Consulta validada. Ambas correcciones ya están aplicadas; no se realizó ninguna escritura."
                : `Consulta validada. Hay ${pending} corrección(es) pendiente(s); no se realizó ninguna escritura. Usa --apply para aplicarlas en una transacción.`
        )
        return
    }

    await prisma.$transaction(async (tx) => {
        for (const entry of prepared) {
            const { spec } = entry
            if (entry.alreadyApplied) continue
            const decremented = await tx.ticketType.updateMany({
                where: { id: spec.sourceTicketTypeId, eventId: spec.sourceEventId, sold: { gt: 0 } },
                data: { sold: { decrement: 1 } },
            })
            if (decremented.count !== 1) fail(`${spec.label}: no se pudo decrementar el contador origen`)

            const incremented = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "ticket_types"
                SET "sold" = "sold" + 1
                WHERE "id" = ${spec.targetTicketTypeId}
                  AND "eventId" = ${spec.targetEventId}
                  AND "isActive" = true
                  AND ("capacity" = 0 OR "sold" + 1 <= "capacity")
                RETURNING "id"
            `)
            if (!incremented[0]) fail(`${spec.label}: no se pudo reservar el cupo destino`)

            await tx.ticket.update({
                where: { id: spec.ticketId },
                data: {
                    eventId: spec.targetEventId,
                    ticketTypeId: spec.targetTicketTypeId,
                    membershipSchedule: entry.membershipSchedule,
                },
            })
            await tx.orderItem.update({
                where: { id: spec.orderItemId },
                data: {
                    ticketTypeId: spec.targetTicketTypeId,
                    attendeeData: entry.attendeeData,
                },
            })
        }
    })

    const { onEventUpdated } = await import("@/lib/cached-queries")
    await Promise.all(
        Array.from(new Set(REASSIGNMENTS.flatMap((spec) => [spec.sourceEventId, spec.targetEventId])))
            .map((eventId) => onEventUpdated(eventId))
    )

    const verification = await Promise.all(REASSIGNMENTS.map(async (spec) => {
        const [ticket, item, sourceType, targetType, invoices] = await Promise.all([
            prisma.ticket.findUniqueOrThrow({ where: { id: spec.ticketId } }),
            prisma.orderItem.findUniqueOrThrow({ where: { id: spec.orderItemId } }),
            prisma.ticketType.findUniqueOrThrow({ where: { id: spec.sourceTicketTypeId } }),
            prisma.ticketType.findUniqueOrThrow({ where: { id: spec.targetTicketTypeId } }),
            prisma.invoice.findMany({ where: { orderId: spec.orderId }, select: { id: true, status: true, servilexGroupKey: true } }),
        ])
        assertEqual(ticket.eventId, spec.targetEventId, `${spec.label}: verificación evento destino`)
        assertEqual(ticket.ticketTypeId, spec.targetTicketTypeId, `${spec.label}: verificación tipo destino`)
        assertEqual(item.ticketTypeId, spec.targetTicketTypeId, `${spec.label}: verificación item destino`)
        return {
            person: spec.label,
            ticketEventId: ticket.eventId,
            ticketTypeId: ticket.ticketTypeId,
            sourceSold: sourceType.sold,
            targetSold: targetType.sold,
            invoices,
        }
    }))

    console.log(JSON.stringify({ applied: true, verification }, null, 2))
    console.log("Corrección aplicada. Los comprobantes ABIO y el historial de escaneos no fueron modificados.")
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error)
        process.exitCode = 1
    })
    .finally(async () => {
        try {
            const { prisma } = await import("@/lib/prisma")
            await prisma.$disconnect()
        } catch {
            // El error principal ya fue reportado; no ocultarlo por el cierre del pool.
        }
        // El adaptador Neon mantiene temporizadores internos aun después de
        // desconectar Prisma. Este es un CLI de una sola ejecución: terminar de
        // forma explícita evita que el modo consulta o --apply quede colgado.
        process.exit(process.exitCode ?? 0)
    })
