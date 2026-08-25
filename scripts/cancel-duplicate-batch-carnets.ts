/**
 * Anula los carnets DUPLICADOS que emitió el lote presencial `PRES-<batch>:`
 * cuando la MISMA persona (por DNI del alumno) ya tenía otro carnet ACTIVE del
 * mismo evento por otra vía (web/IZIPAY). Conserva el carnet no-presencial (el
 * que el socio pagó) y anula SOLO el presencial de mi lote.
 *
 * Por cada duplicado: ticket -> CANCELLED, su orden -> CANCELLED, y decrementa
 * ticket_types.sold en 1 (libera el cupo). DRY-RUN por defecto.
 *
 * Uso:
 *   tsx --env-file=.env scripts/cancel-duplicate-batch-carnets.ts --batch=membresias-2026
 *   tsx --env-file=.env scripts/cancel-duplicate-batch-carnets.ts --batch=membresias-2026 --confirm
 */
import { prisma } from "@/lib/prisma"

function parseArgs(argv: string[]) {
    const flags: Record<string, string | boolean> = {}
    for (const arg of argv) {
        if (arg.startsWith("--")) {
            const [k, ...rest] = arg.slice(2).split("=")
            flags[k] = rest.length ? rest.join("=") : true
        }
    }
    return flags
}

const cleanDni = (s: string | null) => (s ?? "").replace(/[^0-9kK]/g, "").trim()

async function main() {
    const flags = parseArgs(process.argv.slice(2))
    const batch = typeof flags.batch === "string" && flags.batch.trim() ? flags.batch.trim() : "membresias-2026"
    const confirm = flags.confirm === true || flags.confirm === "true" || flags.confirm === "1"
    const batchPrefix = `PRES-${batch}:`

    console.log(`Lote: ${batch}   Modo: ${confirm ? "CONFIRM" : "DRY-RUN"}`)
    console.log("")

    const tickets = await prisma.ticket.findMany({
        where: { status: "ACTIVE", event: { category: "ACADEMIA" } },
        select: {
            id: true,
            ticketCode: true,
            attendeeName: true,
            attendeeDni: true,
            eventId: true,
            ticketTypeId: true,
            order: { select: { id: true, provider: true, providerOrderNumber: true } },
        },
    })

    // Índice de tickets ACTIVE por (dni, eventId) para detectar el "gemelo" web.
    const byPersonEvent = new Map<string, typeof tickets>()
    for (const t of tickets) {
        const dni = cleanDni(t.attendeeDni)
        if (!dni) continue
        const key = `${dni}::${t.eventId}`
        const arr = byPersonEvent.get(key)
        if (arr) arr.push(t)
        else byPersonEvent.set(key, [t])
    }

    // Duplicados a anular: tickets de MI lote cuya persona+evento tiene además
    // otro ticket ACTIVE de OTRA orden (el que conservamos).
    const toCancel = tickets.filter((t) => {
        const isBatch = t.order?.providerOrderNumber?.startsWith(batchPrefix) ?? false
        if (!isBatch) return false
        const dni = cleanDni(t.attendeeDni)
        if (!dni) return false
        const group = byPersonEvent.get(`${dni}::${t.eventId}`) ?? []
        return group.some((o) => o.order?.id !== t.order?.id)
    })

    console.log(`Duplicados de mi lote a ANULAR: ${toCancel.length}`)
    for (const t of toCancel) {
        const group = byPersonEvent.get(`${cleanDni(t.attendeeDni)}::${t.eventId}`) ?? []
        const keep = group.filter((o) => o.order?.id !== t.order?.id)
        console.log(
            `  ANULAR ${t.ticketCode} (${t.attendeeName ?? ""} DNI ${cleanDni(t.attendeeDni)}) orden ${t.order?.providerOrderNumber}` +
            ` — se conserva: ${keep.map((k) => `${k.ticketCode}/${k.order?.provider}`).join(", ")}`
        )
    }
    console.log("")

    if (!confirm) {
        console.log("DRY-RUN: no se anuló nada. Repite con --confirm para anular estos duplicados.")
        return
    }
    if (toCancel.length === 0) {
        console.log("Nada que anular.")
        return
    }

    const result = await prisma.$transaction(async (tx) => {
        let cancelledTickets = 0
        let cancelledOrders = 0
        for (const t of toCancel) {
            await tx.ticket.update({ where: { id: t.id }, data: { status: "CANCELLED" } })
            cancelledTickets += 1
            if (t.order?.id) {
                const upd = await tx.order.updateMany({
                    where: { id: t.order.id, status: "PAID" },
                    data: { status: "CANCELLED" },
                })
                cancelledOrders += upd.count
            }
            // Liberar cupo (se incrementó al emitir).
            await tx.ticketType.updateMany({
                where: { id: t.ticketTypeId, sold: { gt: 0 } },
                data: { sold: { decrement: 1 } },
            })
        }
        return { cancelledTickets, cancelledOrders }
    }, { timeout: 60_000 })

    console.log("")
    console.log(`Anulados: ${result.cancelledTickets} ticket(s) y ${result.cancelledOrders} orden(es); cupo liberado.`)
    console.log("Se conservó el carnet no-presencial (el que el socio pagó).")
}

main()
    .catch((e) => {
        console.error("Error fatal:", e instanceof Error ? e.message : e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
        process.exit(process.exitCode ?? 0)
    })
