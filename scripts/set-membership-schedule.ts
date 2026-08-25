/**
 * Corrige el horario semanal BASE de una membresía (el que hace cumplir el
 * escáner), manteniendo en sincronía la copia del checkout.
 *
 * Por qué existe: el horario vive en DOS sitios que nacen iguales en el
 * fulfillment (`order-fulfillment.ts`) y luego se pueden separar:
 *   · `Ticket.membershipSchedule`  → lo que valida el escáner y muestra el carnet.
 *   · `OrderItem.attendeeData[].membershipSchedule` → snapshot del checkout.
 * Editar solo el segundo no cambia nada en la puerta. Este script escribe ambos
 * en una transacción.
 *
 * NO confundir con el cambio de horario POR MES (`api/membership/[id]/schedule`,
 * modelo `MembershipMonthlySchedule`): eso lo hace el alumno para el mes
 * siguiente. Esto es una corrección administrativa que rige desde ya y se hereda
 * hacia adelante.
 *
 * Consulta (por defecto):
 *   node --env-file=.env.production ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/set-membership-schedule.ts
 *
 * Aplicación:
 *   node --env-file=.env.production ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/set-membership-schedule.ts --apply
 */
import type { Prisma as PrismaTypes } from "@prisma/client"

type ScheduleFixSpec = {
    label: string
    ticketId: string
    orderId: string
    orderItemId: string
    /** Identifica a la persona dentro de `attendeeData` (los items pueden traer varias). */
    matricula: string
    expectedSucursal: string
    expectedScheduleKey: string
    /** Horario que debe quedar, en la forma que entiende el selector del checkout. */
    targetSchedule: { category: string; frequency: string; hours: Record<string, string> }
    /** Sesiones resultantes esperadas; guarda contra un `hours` mal escrito. */
    expectedSessions: Array<{ weekday: number; start: string; end: string }>
}

const FIXES: ScheduleFixSpec[] = [
    {
        // Pasa de L-M-V 4-5pm a L-M-V 3-4pm. El `attendeeData` ya tenía 15:00-16:00
        // por una edición previa que no llegó al Ticket, así que en la puerta
        // seguía rigiendo 16:00-17:00.
        label: "Aylin Oriana Lachira Panta",
        ticketId: "cmrtimzm104gh01nyyj53hwgr",
        orderId: "cmrtih58104gd01nyu7pwdit2",
        orderItemId: "cmrtih58p04ge01ny0k0zdj70",
        matricula: "2299469",
        expectedSucursal: "03",
        expectedScheduleKey: "BRONCE",
        targetSchedule: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
        expectedSessions: [
            { weekday: 1, start: "15:00", end: "16:00" },
            { weekday: 3, start: "15:00", end: "16:00" },
            { weekday: 5, start: "15:00", end: "16:00" },
        ],
    },
]

const APPLY = process.argv.includes("--apply")

function fail(message: string): never {
    throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) fail(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

/** "1:15:00-16:00" por sesión, ordenado — forma comparable de un horario. */
function normalizeSessions(value: unknown): string[] {
    const record = asRecord(value)
    const sessions = Array.isArray(record.sessions) ? record.sessions : []
    return sessions
        .map((raw) => {
            const s = asRecord(raw)
            return `${Number(s.weekday)}:${String(s.start)}-${String(s.end)}`
        })
        .sort()
}

function expectedSessionKeys(spec: ScheduleFixSpec): string[] {
    return spec.expectedSessions.map((s) => `${s.weekday}:${s.start}-${s.end}`).sort()
}

async function main() {
    const [{ prisma }, scheduleModule] = await Promise.all([
        import("@/lib/prisma"),
        import("@/lib/membership-schedule"),
    ])
    const { getMembershipScheduleProfile, validateMembershipScheduleSelection, formatScheduleSummary } = scheduleModule

    const prepared: Array<{
        spec: ScheduleFixSpec
        selection: PrismaTypes.InputJsonValue
        attendeeData: PrismaTypes.InputJsonValue
        alreadyApplied: boolean
        report: Record<string, unknown>
    }> = []

    for (const spec of FIXES) {
        const [ticket, orderItem] = await Promise.all([
            prisma.ticket.findUnique({
                where: { id: spec.ticketId },
                include: {
                    event: { select: { id: true, title: true, servilexSucursalCode: true } },
                    ticketType: { select: { id: true, name: true, membershipScheduleKey: true } },
                    monthlySchedules: { select: { monthIndex: true, selection: true } },
                    order: { select: { id: true, status: true } },
                    scans: { select: { id: true, date: true, result: true } },
                },
            }),
            prisma.orderItem.findUnique({ where: { id: spec.orderItemId } }),
        ])

        if (!ticket) fail(`${spec.label}: ticket no encontrado`)
        if (!orderItem) fail(`${spec.label}: OrderItem no encontrado`)

        assertEqual(ticket.orderId, spec.orderId, `${spec.label}: orden del ticket`)
        assertEqual(orderItem.orderId, spec.orderId, `${spec.label}: orden del item`)
        assertEqual(orderItem.ticketTypeId, ticket.ticketTypeId, `${spec.label}: el item no es el de este carnet`)
        assertEqual(ticket.status, "ACTIVE", `${spec.label}: estado del ticket`)
        assertEqual(ticket.order.status, "PAID", `${spec.label}: estado de la orden`)
        assertEqual(
            ticket.event.servilexSucursalCode,
            spec.expectedSucursal,
            `${spec.label}: sede del carnet`
        )
        assertEqual(
            ticket.ticketType.membershipScheduleKey,
            spec.expectedScheduleKey,
            `${spec.label}: perfil de horario del plan`
        )

        // Un cambio mensual pisaría la base a partir de su mes: no adivinar.
        if (ticket.monthlySchedules.length > 0) {
            fail(
                `${spec.label}: tiene ${ticket.monthlySchedules.length} cambio(s) mensual(es) de horario ` +
                    `(meses ${ticket.monthlySchedules.map((m) => m.monthIndex).join(", ")}) que pisarían esta ` +
                    `corrección; requiere revisión manual`
            )
        }

        const profile = getMembershipScheduleProfile(spec.expectedSucursal, spec.expectedScheduleKey)
        if (!profile) fail(`${spec.label}: la sede ${spec.expectedSucursal} no tiene catálogo para ${spec.expectedScheduleKey}`)
        const result = validateMembershipScheduleSelection(profile, spec.targetSchedule, spec.expectedSucursal)
        if (!result.ok) fail(`${spec.label}: horario no válido en esta sede: ${result.error}`)

        const nextSessions = normalizeSessions(result.selection)
        if (JSON.stringify(nextSessions) !== JSON.stringify(expectedSessionKeys(spec))) {
            fail(`${spec.label}: el horario normalizado no coincide con el esperado (${nextSessions.join(", ")})`)
        }

        // attendeeData: ubicar a la persona por matrícula y reemplazar solo su horario.
        if (!Array.isArray(orderItem.attendeeData)) {
            fail(`${spec.label}: attendeeData no es una lista`)
        }
        const attendees = orderItem.attendeeData as unknown[]
        const index = attendees.findIndex(
            (raw) => String(asRecord(raw).matricula ?? "") === spec.matricula
        )
        if (index < 0) fail(`${spec.label}: no se encontró la matrícula ${spec.matricula} en attendeeData`)
        const updatedAttendees = attendees.map((raw, i) =>
            i === index ? { ...asRecord(raw), membershipSchedule: result.selection } : raw
        )

        const ticketSessions = normalizeSessions(ticket.membershipSchedule)
        const attendeeSessions = normalizeSessions(asRecord(attendees[index]).membershipSchedule)
        const alreadyApplied =
            JSON.stringify(ticketSessions) === JSON.stringify(nextSessions) &&
            JSON.stringify(attendeeSessions) === JSON.stringify(nextSessions)

        prepared.push({
            spec,
            selection: result.selection as unknown as PrismaTypes.InputJsonValue,
            attendeeData: updatedAttendees as unknown as PrismaTypes.InputJsonValue,
            alreadyApplied,
            report: {
                carnet: ticket.ticketCode,
                alumno: ticket.attendeeName,
                sede: ticket.event.title,
                plan: ticket.ticketType.name,
                escaneos: ticket.scans.length,
                antes: {
                    // El que rige en la puerta.
                    ticket: ticketSessions,
                    // Snapshot del checkout (inerte, pero se corrige para que cuadre).
                    attendeeData: attendeeSessions,
                    sincronizados: JSON.stringify(ticketSessions) === JSON.stringify(attendeeSessions),
                },
                despues: nextSessions,
                resumen: formatScheduleSummary(result.selection),
                estado: alreadyApplied ? "ya aplicado" : "pendiente",
            },
        })
    }

    console.log(
        JSON.stringify(
            { mode: APPLY ? "apply" : "query", records: prepared.map((e) => e.report) },
            null,
            2
        )
    )

    const pending = prepared.filter((e) => !e.alreadyApplied)
    if (!APPLY) {
        console.log(
            pending.length === 0
                ? "Consulta validada. Nada pendiente; no se realizó ninguna escritura."
                : `Consulta validada. Hay ${pending.length} cambio(s) pendiente(s); no se realizó ninguna escritura. Usa --apply para aplicarlos en una transacción.`
        )
        return
    }

    await prisma.$transaction(async (tx) => {
        for (const entry of prepared) {
            if (entry.alreadyApplied) continue
            await tx.ticket.update({
                where: { id: entry.spec.ticketId },
                data: { membershipSchedule: entry.selection },
            })
            await tx.orderItem.update({
                where: { id: entry.spec.orderItemId },
                data: { attendeeData: entry.attendeeData },
            })
        }
    })

    const verification = await Promise.all(
        FIXES.map(async (spec) => {
            const [ticket, item] = await Promise.all([
                prisma.ticket.findUniqueOrThrow({ where: { id: spec.ticketId } }),
                prisma.orderItem.findUniqueOrThrow({ where: { id: spec.orderItemId } }),
            ])
            const attendees = (item.attendeeData ?? []) as unknown[]
            const attendee = Array.isArray(attendees)
                ? attendees.find((raw) => String(asRecord(raw).matricula ?? "") === spec.matricula)
                : null
            const ticketSessions = normalizeSessions(ticket.membershipSchedule)
            const attendeeSessions = normalizeSessions(asRecord(attendee).membershipSchedule)
            const expected = expectedSessionKeys(spec)
            if (JSON.stringify(ticketSessions) !== JSON.stringify(expected)) {
                fail(`${spec.label}: verificación del carnet falló (${ticketSessions.join(", ")})`)
            }
            if (JSON.stringify(attendeeSessions) !== JSON.stringify(expected)) {
                fail(`${spec.label}: verificación de attendeeData falló (${attendeeSessions.join(", ")})`)
            }
            return { person: spec.label, ticket: ticketSessions, attendeeData: attendeeSessions }
        })
    )

    console.log(JSON.stringify({ applied: true, verification }, null, 2))
    console.log("Horario corregido en el carnet y en la orden. Rige desde el próximo escaneo.")
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
        // Mismo cierre explícito que reassign-membership-sites.ts: el adaptador Neon
        // deja temporizadores vivos y colgaría este CLI de una sola ejecución.
        process.exit(process.exitCode ?? 0)
    })
