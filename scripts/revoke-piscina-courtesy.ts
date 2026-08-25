/**
 * Anula (borra) una entrada de cortesia de PISCINA LIBRE emitida con
 * `grant-piscina-courtesy.ts`, devolviendo el cupo del horario/fecha.
 *
 * Es la contraparte del grant: sirve para deshacer una cortesia emitida en la
 * cuenta equivocada o por error. Solo borra ordenes de cortesia (provider
 * COURTESY, total 0, sin comprobante y sin escaneos): nunca toca una venta real.
 *
 * Uso:
 *   tsx scripts/revoke-piscina-courtesy.ts --ticket=XXXX-XXXX-XXXX [--no-release] [--confirm]
 *
 *   --confirm      ejecuta de verdad. Sin esta flag es DRY-RUN.
 *   --no-release   no devuelve el cupo (usalo si vas a reemitir en otra fecha).
 */
import "dotenv/config"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

function parseArgs(argv: string[]) {
    const flags: Record<string, string | boolean> = {}
    for (const arg of argv) {
        if (!arg.startsWith("--")) continue
        const [key, ...rest] = arg.slice(2).split("=")
        flags[key] = rest.length ? rest.join("=") : true
    }
    return flags
}

async function main() {
    const flags = parseArgs(process.argv.slice(2))
    const code = typeof flags.ticket === "string" ? flags.ticket.trim().toUpperCase() : null
    const confirm = flags.confirm === true
    const release = flags["no-release"] !== true

    if (!code) {
        console.error("Uso: tsx scripts/revoke-piscina-courtesy.ts --ticket=XXXX-XXXX-XXXX [--no-release] [--confirm]")
        process.exit(1)
    }

    const ticket = await prisma.ticket.findUnique({
        where: { ticketCode: code },
        select: {
            id: true,
            ticketCode: true,
            status: true,
            attendeeName: true,
            entitlements: { select: { id: true, date: true, status: true } },
            scans: { select: { id: true, result: true, scannedAt: true } },
            user: { select: { email: true, name: true } },
            event: { select: { id: true, title: true, category: true } },
            ticketType: { select: { id: true, name: true } },
            order: {
                select: {
                    id: true,
                    status: true,
                    provider: true,
                    totalAmount: true,
                    invoices: { select: { id: true, status: true } },
                    tickets: { select: { id: true } },
                    orderItems: { select: { id: true } },
                },
            },
        },
    })

    if (!ticket) {
        console.error(`No existe ticket con codigo "${code}".`)
        process.exit(1)
    }

    const order = ticket.order
    console.log("------------------------------------------")
    console.log(`Ticket:   ${ticket.ticketCode}  ${ticket.status}  (${ticket.attendeeName})`)
    console.log(`Cuenta:   ${ticket.user.name} <${ticket.user.email}>`)
    console.log(`Evento:   ${ticket.event.title}  [${ticket.event.category}]`)
    console.log(`Horario:  ${ticket.ticketType.name}`)
    console.log(`Fechas:   ${ticket.entitlements.map((e) => `${e.date.toISOString().slice(0, 10)}:${e.status}`).join(", ") || "(sin entitlements)"}`)
    console.log(`Orden:    #${order.id.slice(-8).toUpperCase()} ${order.status} ${order.provider} S/${order.totalAmount}`)
    console.log(`          tickets=${order.tickets.length} items=${order.orderItems.length} comprobantes=${order.invoices.length}`)
    console.log(`Escaneos: ${ticket.scans.length}${ticket.scans.length ? " -> " + ticket.scans.map((s) => `${s.result}@${s.scannedAt.toISOString()}`).join(", ") : ""}`)

    // Guardas: nunca borrar algo que no sea una cortesia limpia.
    if (order.provider !== "COURTESY") {
        console.error(`\nABORTA: la orden no es de cortesia (provider=${order.provider}). No se borran ventas reales.`)
        process.exit(1)
    }
    if (Number(order.totalAmount) !== 0) {
        console.error(`\nABORTA: la orden tiene monto S/${order.totalAmount}, no es una cortesia.`)
        process.exit(1)
    }
    if (order.invoices.length > 0) {
        console.error("\nABORTA: la orden tiene comprobantes asociados.")
        process.exit(1)
    }
    if (ticket.scans.length > 0) {
        console.error("\nABORTA: el ticket ya tiene escaneos; borrarlo perderia el registro de ingreso. Cancelalo en vez de borrarlo.")
        process.exit(1)
    }
    if (order.tickets.length !== 1) {
        console.error(`\nABORTA: la orden tiene ${order.tickets.length} tickets; este script solo maneja cortesias de 1 entrada.`)
        process.exit(1)
    }

    console.log("------------------------------------------")
    console.log(release ? "Se devolvera 1 cupo por cada fecha del ticket." : "NO se devuelve cupo (--no-release).")
    if (!confirm) {
        console.log("DRY-RUN: no se borro nada. Repeti con --confirm para anular.")
        return
    }

    await prisma.$transaction(async (tx) => {
        if (release) {
            for (const ent of ticket.entitlements) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE "ticket_type_date_inventories"
                    SET "sold" = GREATEST("sold" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "ticketTypeId" = ${ticket.ticketType.id}
                      AND "date" = ${ent.date}
                `)
            }
        }
        // Los entitlements caen por cascada al borrar el ticket.
        await tx.ticket.delete({ where: { id: ticket.id } })
        await tx.orderItem.deleteMany({ where: { orderId: order.id } })
        await tx.order.delete({ where: { id: order.id } })
    })

    console.log(`OK: cortesia ${ticket.ticketCode} anulada (ticket, item y orden #${order.id.slice(-8).toUpperCase()} borrados).`)

    for (const ent of ticket.entitlements) {
        const inv = await prisma.ticketTypeDateInventory.findUnique({
            where: { ticketTypeId_date: { ticketTypeId: ticket.ticketType.id, date: ent.date } },
            select: { capacity: true, sold: true },
        })
        if (inv) console.log(`   Cupo ${ent.date.toISOString().slice(0, 10)}: ${inv.sold}/${inv.capacity}`)
    }

    try {
        const { onTicketSold } = await import("@/lib/cached-queries")
        await onTicketSold(ticket.event.id, ticket.ticketType.id)
        console.log("   Cache de stock invalidado.")
    } catch (e) {
        console.log(`   (No se pudo invalidar el cache de stock: ${(e as Error).message})`)
    }
}

main()
    .catch((e) => {
        console.error("Error:", (e as Error).message ?? e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
        process.exit(process.exitCode ?? 0)
    })
