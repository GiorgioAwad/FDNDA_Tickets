/**
 * Emite una entrada de CORTESIA de PISCINA LIBRE (S/0) para un usuario que ya
 * existe en la web, en un horario y una fecha concretos.
 *
 * A diferencia del flujo de /admin/cortesias (que genera codigos de canje y crea
 * el ticket SIN TicketDayEntitlement), aqui el ticket nace con su entitlement del
 * dia. Eso importa: para PISCINA_LIBRE, un ticket sin entitlements hace que el
 * escaner le genere entitlements para TODO el rango del evento (o sea, un pase
 * mensual gratis en vez de una visita).
 *
 * Crea, en una sola transaccion:
 *   Order (provider=COURTESY, status=PAID, totalAmount=0) -> no genera boleta ABIO/SUNAT
 *   OrderItem (unitPrice 0, attendeeData con scheduleSelections del dia)
 *   Ticket ACTIVE + TicketDayEntitlement de la fecha
 *   y, salvo --no-reserve, descuenta el cupo en ticket_type_date_inventories
 *   (que es donde vive el aforo de piscina; ticket_types.sold NO se toca).
 *
 * Idempotente: si el usuario ya tiene un ticket ACTIVE de ese horario con
 * entitlement en esa fecha, no hace nada (salvo --force).
 *
 * Uso:
 *   tsx scripts/grant-piscina-courtesy.ts --email=x@y.com --event-slug=<slug> \
 *       --slot="18:00 - 19:00" --date=YYYY-MM-DD [--name="..."] [--dni=########] \
 *       [--no-reserve] [--over-capacity] [--force] [--confirm]
 *
 *   --confirm        ejecuta de verdad. Sin esta flag es DRY-RUN.
 *   --no-reserve     no descuenta cupo del horario/fecha.
 *   --over-capacity  descuenta cupo aunque el turno este lleno o deshabilitado.
 *   --force          emite aunque ya exista una entrada suya para ese horario/fecha.
 */
import "dotenv/config"
import { Prisma } from "@prisma/client"
import crypto from "node:crypto"

import { prisma } from "@/lib/prisma"
import { generateTicketCode, parseDateOnly } from "@/lib/utils"

type Flags = Record<string, string | boolean>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseArgs(argv: string[]): Flags {
    const flags: Flags = {}
    for (const arg of argv) {
        if (!arg.startsWith("--")) continue
        const [key, ...rest] = arg.slice(2).split("=")
        flags[key] = rest.length ? rest.join("=") : true
    }
    return flags
}

function str(flags: Flags, name: string): string | null {
    const value = flags[name]
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function maskDbHost(url?: string): string {
    if (!url) return "(sin DATABASE_URL)"
    try {
        const u = new URL(url)
        return `${u.host}${u.pathname}`
    } catch {
        return "(DATABASE_URL no parseable)"
    }
}

function splitName(fullName: string) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 4) {
        return {
            firstName: parts[0],
            secondName: parts.slice(1, parts.length - 2).join(" "),
            lastNamePaternal: parts[parts.length - 2],
            lastNameMaternal: parts[parts.length - 1],
        }
    }
    if (parts.length === 3) {
        return { firstName: parts[0], secondName: "", lastNamePaternal: parts[1], lastNameMaternal: parts[2] }
    }
    return { firstName: parts[0] ?? "", secondName: "", lastNamePaternal: parts[1] ?? "", lastNameMaternal: "" }
}

async function main() {
    const flags = parseArgs(process.argv.slice(2))
    const email = str(flags, "email")
    const eventSlug = str(flags, "event-slug")
    const slot = str(flags, "slot")
    const dateKey = str(flags, "date")
    const nameOverride = str(flags, "name")
    const dniOverride = str(flags, "dni")
    const confirm = flags.confirm === true
    const force = flags.force === true
    const reserve = flags["no-reserve"] !== true
    const overCapacity = flags["over-capacity"] === true

    if (!email || !eventSlug || !slot || !dateKey || !DATE_RE.test(dateKey)) {
        console.error(
            'Uso: tsx scripts/grant-piscina-courtesy.ts --email=x@y.com --event-slug=<slug> --slot="18:00 - 19:00" --date=YYYY-MM-DD [--name=".."] [--dni=..] [--no-reserve] [--over-capacity] [--force] [--confirm]'
        )
        process.exit(1)
    }

    console.log(`DB destino: ${maskDbHost(process.env.DATABASE_URL)}`)

    const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true, dni: true },
    })
    if (!user) {
        console.error(`No existe usuario con email "${email}".`)
        process.exit(1)
    }

    const event = await prisma.event.findUnique({
        where: { slug: eventSlug },
        select: { id: true, title: true, category: true, venue: true, startDate: true, endDate: true },
    })
    if (!event) {
        console.error(`No existe evento con slug "${eventSlug}".`)
        process.exit(1)
    }
    if (event.category !== "PISCINA_LIBRE") {
        console.error(`El evento "${event.title}" no es PISCINA_LIBRE (es ${event.category}). Abortando.`)
        process.exit(1)
    }

    const date = parseDateOnly(dateKey)
    const eventStart = event.startDate.toISOString().slice(0, 10)
    const eventEnd = event.endDate.toISOString().slice(0, 10)
    if (dateKey < eventStart || dateKey > eventEnd) {
        console.error(`La fecha ${dateKey} esta fuera del rango del evento (${eventStart} -> ${eventEnd}). Abortando.`)
        process.exit(1)
    }

    const ticketType = await prisma.ticketType.findFirst({
        where: { eventId: event.id, name: slot },
        select: { id: true, name: true, price: true, capacity: true, isActive: true },
    })
    if (!ticketType) {
        console.error(`El evento no tiene un horario llamado exactamente "${slot}".`)
        process.exit(1)
    }

    const inventory = await prisma.ticketTypeDateInventory.findUnique({
        where: { ticketTypeId_date: { ticketTypeId: ticketType.id, date } },
        select: { capacity: true, sold: true, isEnabled: true },
    })

    const attendeeName = nameOverride || user.name
    const attendeeDni = dniOverride || user.dni || null

    console.log("------------------------------------------")
    console.log(`Evento:    ${event.title} (${event.venue})`)
    console.log(`Horario:   ${ticketType.name}   activo=${ticketType.isActive}   precio lista S/${ticketType.price}`)
    console.log(`Fecha:     ${dateKey}`)
    console.log(`Usuario:   ${user.name} <${user.email}>  (id ${user.id})`)
    console.log(`Asistente: ${attendeeName}  DNI ${attendeeDni ?? "-"}`)
    console.log(
        `Cupo:      ${inventory ? `${inventory.sold}/${inventory.capacity} enabled=${inventory.isEnabled}` : "(sin fila de inventario para esa fecha)"}` +
            `${reserve ? "  -> se descuenta 1" : "  -> NO se descuenta (--no-reserve)"}`
    )

    const existing = await prisma.ticket.findFirst({
        where: {
            userId: user.id,
            ticketTypeId: ticketType.id,
            status: "ACTIVE",
            entitlements: { some: { date } },
        },
        select: { ticketCode: true },
    })
    if (existing && !force) {
        console.log("------------------------------------------")
        console.log(`Ya tiene una entrada ACTIVE para ese horario y fecha: ${existing.ticketCode}. Nada que hacer (usa --force).`)
        return
    }
    if (existing) {
        console.log(`AVISO: ya tenia la entrada ${existing.ticketCode} para ese horario/fecha; --force emite otra igual.`)
    }

    console.log("------------------------------------------")
    if (!confirm) {
        console.log("DRY-RUN: no se escribio nada. Repeti con --confirm para emitir.")
        return
    }

    const nameParts = splitName(attendeeName ?? "")
    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
        if (reserve) {
            const capacityGuard = overCapacity
                ? Prisma.sql``
                : Prisma.sql`AND "isEnabled" = true AND ("capacity" = 0 OR "sold" + 1 <= "capacity")`
            const updated = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "ticket_type_date_inventories"
                SET "sold" = "sold" + 1, "updatedAt" = CURRENT_TIMESTAMP
                WHERE "ticketTypeId" = ${ticketType.id}
                  AND "date" = ${date}
                  ${capacityGuard}
                RETURNING "id"
            `)
            if (updated.length === 0) {
                if (inventory) {
                    throw new Error(
                        `No hay cupo disponible para "${ticketType.name}" el ${dateKey} (${inventory.sold}/${inventory.capacity}, enabled=${inventory.isEnabled}). Usa --over-capacity si es intencional.`
                    )
                }
                await tx.$executeRaw(Prisma.sql`
                    INSERT INTO "ticket_type_date_inventories"
                        ("id", "ticketTypeId", "date", "capacity", "sold", "isEnabled", "createdAt", "updatedAt")
                    VALUES (${crypto.randomUUID()}, ${ticketType.id}, ${date}, ${ticketType.capacity}, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `)
            }
        }

        const order = await tx.order.create({
            data: {
                userId: user.id,
                status: "PAID",
                orderType: "TICKET",
                totalAmount: 0,
                currency: "PEN",
                provider: "COURTESY",
                paidAt: now,
                buyerName: attendeeName,
                buyerDocType: attendeeDni ? "1" : null,
                buyerDocNumber: attendeeDni,
                buyerEmail: user.email,
                orderItems: {
                    create: [
                        {
                            ticketTypeId: ticketType.id,
                            quantity: 1,
                            unitPrice: 0,
                            subtotal: 0,
                            attendeeData: [
                                {
                                    name: attendeeName,
                                    dni: attendeeDni ?? "",
                                    firstName: nameParts.firstName,
                                    secondName: nameParts.secondName,
                                    lastNamePaternal: nameParts.lastNamePaternal,
                                    lastNameMaternal: nameParts.lastNameMaternal,
                                    scheduleSelections: [{ date: dateKey, shift: "" }],
                                },
                            ] as Prisma.InputJsonValue,
                        },
                    ],
                },
            },
            select: { id: true },
        })

        const ticket = await tx.ticket.create({
            data: {
                orderId: order.id,
                userId: user.id,
                eventId: event.id,
                ticketTypeId: ticketType.id,
                ticketCode: generateTicketCode(),
                attendeeName,
                attendeeDni: attendeeDni ?? undefined,
                status: "ACTIVE",
                entitlements: { create: [{ date, status: "AVAILABLE" }] },
            },
            select: { id: true, ticketCode: true },
        })

        return { orderId: order.id, ticket }
    })

    console.log("OK: entrada de cortesia emitida")
    console.log(`   Orden:  #${result.orderId.slice(-8).toUpperCase()} (S/0, provider COURTESY, sin boleta)`)
    console.log(`   Ticket: ${result.ticket.ticketCode}  ->  ${ticketType.name} del ${dateKey}`)

    const after = await prisma.ticketTypeDateInventory.findUnique({
        where: { ticketTypeId_date: { ticketTypeId: ticketType.id, date } },
        select: { capacity: true, sold: true },
    })
    if (after) console.log(`   Cupo:   ${after.sold}/${after.capacity}`)

    try {
        const { onTicketSold } = await import("@/lib/cached-queries")
        await onTicketSold(event.id, ticketType.id)
        console.log("   Cache de stock invalidado.")
    } catch (e) {
        console.log(`   (No se pudo invalidar el cache de stock: ${(e as Error).message})`)
    }

    console.log("   La entrada ya aparece en 'Mis entradas' del usuario.")
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
