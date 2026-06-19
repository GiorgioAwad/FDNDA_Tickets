/**
 * Emite una entrada de CORTESÍA para el comprador de una orden, sin tocar
 * inventario ni facturación (a diferencia de fulfill-order-manual). Útil cuando
 * una orden quedó cobrada-sin-entrada pero su cupo por fecha ya está cerrado y la
 * recuperación normal fallaría al re-reservar inventario.
 *
 * Crea, bajo el MISMO usuario y orden, un Ticket ACTIVE por cada entrada con su
 * TicketDayEntitlement en la fecha comprada (de attendeeData.scheduleSelections),
 * o en --date / fecha de inicio del evento como fallback. NO cambia el estado de
 * la orden, NO descuenta stock, NO emite boleta.
 *
 * Idempotente: si la orden ya tiene tickets, no hace nada (salvo --force).
 *
 * Uso (dentro del contenedor con env de producción):
 *   tsx scripts/grant-courtesy-ticket.ts <ORDEN|CODIGO> [--confirm] [--date=YYYY-MM-DD] [--force]
 *
 *   <ORDEN>     id completo (cuid) o código corto / nº de pedido Izipay.
 *   --confirm   ejecuta de verdad. Sin esta flag es DRY-RUN.
 *   --date      fuerza la fecha del entitlement (si la orden no trae selección).
 *   --force     emite aunque la orden ya tenga tickets (úsese con cuidado).
 */
import { prisma } from "@/lib/prisma"
import { generateTicketCode, parseDateOnly } from "@/lib/utils"
import { normalizeScheduleSelections } from "@/lib/ticket-schedule"

function parseArgs(argv: string[]) {
    const positional: string[] = []
    const flags: Record<string, string | boolean> = {}
    for (const a of argv) {
        if (a.startsWith("--")) {
            const [k, v] = a.slice(2).split("=")
            flags[k] = v ?? true
        } else {
            positional.push(a)
        }
    }
    return { positional, flags }
}

function maskDbHost(url?: string): string {
    if (!url) return "(sin DATABASE_URL)"
    try {
        const u = new URL(url)
        return `${u.protocol}//${u.host}${u.pathname}`
    } catch {
        return "(DATABASE_URL no parseable)"
    }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type StoredAttendee = { name?: unknown; dni?: unknown; scheduleSelections?: unknown }

async function main() {
    const { positional, flags } = parseArgs(process.argv.slice(2))
    const ref = positional[0]
    const confirm = Boolean(flags.confirm)
    const force = Boolean(flags.force)
    const dateOverride = typeof flags.date === "string" && DATE_RE.test(flags.date) ? flags.date : null

    if (!ref) {
        console.error("Uso: tsx scripts/grant-courtesy-ticket.ts <ORDEN|CODIGO> [--confirm] [--date=YYYY-MM-DD] [--force]")
        process.exit(1)
    }

    console.log(`DB destino: ${maskDbHost(process.env.DATABASE_URL)}`)

    const norm = ref.replace(/^#/, "").trim()
    const order = await prisma.order.findFirst({
        where: {
            OR: [
                { id: norm },
                { id: { endsWith: norm.toLowerCase() } },
                { providerOrderNumber: norm },
            ],
        },
        include: {
            user: { select: { id: true, name: true } },
            tickets: { select: { id: true } },
            orderItems: {
                include: {
                    ticketType: { include: { event: true } },
                },
            },
        },
    })

    if (!order) {
        console.error(`No se encontró ninguna orden para "${ref}".`)
        process.exit(1)
    }

    const shortCode = order.id.slice(-8).toUpperCase()
    console.log("──────────────────────────────────────────")
    console.log(`Orden:   #${shortCode}  (id: ${order.id})`)
    console.log(`Cliente: ${order.user.name} (userId: ${order.user.id})`)
    console.log(`Estado:  ${order.status}   Tickets ya emitidos: ${order.tickets.length}`)

    const ticketItems = order.orderItems.filter((it) => it.ticketType && it.ticketTypeId)
    if (ticketItems.length === 0) {
        console.error("La orden no tiene items de entrada (¿merch?). Abortando.")
        process.exit(1)
    }

    if (order.tickets.length > 0 && !force) {
        console.log("La orden YA tiene tickets emitidos. Nada que hacer (usa --force para emitir igual).")
        return
    }

    // Planificar: una entrada por unidad, con su fecha (de la selección comprada).
    type Plan = { ticketTypeId: string; eventId: string; date: Date; dateKey: string; label: string }
    const plan: Plan[] = []
    for (const item of ticketItems) {
        const tt = item.ticketType!
        const attendees = Array.isArray(item.attendeeData) ? (item.attendeeData as StoredAttendee[]) : []
        for (let i = 0; i < item.quantity; i++) {
            const sel = normalizeScheduleSelections(attendees[i]?.scheduleSelections)
            const dateKey =
                sel[0]?.date && DATE_RE.test(sel[0].date)
                    ? sel[0].date
                    : dateOverride ??
                      `${tt.event.startDate.getUTCFullYear()}-${String(tt.event.startDate.getUTCMonth() + 1).padStart(2, "0")}-${String(tt.event.startDate.getUTCDate()).padStart(2, "0")}`
            plan.push({
                ticketTypeId: item.ticketTypeId!,
                eventId: tt.eventId,
                date: parseDateOnly(dateKey),
                dateKey,
                label: tt.name,
            })
        }
    }

    console.log("Entradas de cortesía a emitir:")
    for (const p of plan) {
        console.log(`  · ${p.label} — fecha ${p.dateKey}`)
    }
    console.log("──────────────────────────────────────────")

    if (!confirm) {
        console.log("DRY-RUN: no se escribió nada. Repetí con --confirm para emitir.")
        return
    }

    const created: string[] = []
    await prisma.$transaction(async (tx) => {
        for (const p of plan) {
            const ticket = await tx.ticket.create({
                data: {
                    orderId: order.id,
                    userId: order.user.id,
                    eventId: p.eventId,
                    ticketTypeId: p.ticketTypeId,
                    ticketCode: generateTicketCode(),
                    attendeeName: order.user.name,
                    status: "ACTIVE",
                    entitlements: {
                        create: [{ date: p.date, status: "AVAILABLE" }],
                    },
                },
            })
            created.push(`${ticket.ticketCode} (${p.dateKey})`)
        }
    })

    console.log(`✅ Emitidas ${created.length} entrada(s) de cortesía:`)
    for (const c of created) console.log(`   - ${c}`)
    console.log("El cliente ya debería verlas en 'Mis entradas'.")
}

main()
    .catch((e) => {
        console.error("Error fatal:", e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
        process.exit(process.exitCode ?? 0)
    })
