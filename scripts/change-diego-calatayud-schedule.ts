/** Cambia a Diego Calatayud de L-M-V 4–5 p. m. a L-M-V 5–6 p. m. en VMT. */

import { prisma } from "@/lib/prisma"

const TICKET_ID = "cmt3eegt40e9w01nrbf0jnelr"
const EVENT_ID = "cmsqihgwf04sy01p8tjw289a9"
const ATTENDEE_DNI = "78071277"
const SOURCE_TYPE_ID = "fdbdd9ec-ecea-4a1a-b0ee-fec9bb6c8acd"
const TARGET_TYPE_ID = "cc10acd1-7edf-4a24-837c-80513e9e9771"
const SOURCE_NAME = "LUN - MIE - VIE (5 A 17 AÑOS ) - 4PM A 5PM"
const TARGET_NAME = "LUN - MIE - VIE (5 A 17 AÑOS ) - 5PM A 6PM"
const APPLY = process.argv.includes("--apply")

function attendeeDni(value: unknown): string {
    if (!Array.isArray(value) || value.length !== 1) {
        throw new Error("El item debe contener exactamente un asistente")
    }
    const attendee = value[0]
    if (!attendee || typeof attendee !== "object" || Array.isArray(attendee)) {
        throw new Error("El asistente guardado es inválido")
    }
    return String((attendee as Record<string, unknown>).dni ?? "")
}

async function main() {
    const [ticket, source, target] = await Promise.all([
        prisma.ticket.findUnique({
            where: { id: TICKET_ID },
            include: {
                order: {
                    include: {
                        orderItems: true,
                        invoices: { select: { status: true, invoiceNumber: true } },
                    },
                },
                scans: { where: { result: "VALID" }, select: { id: true } },
                entitlements: { orderBy: { date: "asc" }, select: { date: true, status: true } },
            },
        }),
        prisma.ticketType.findUnique({ where: { id: SOURCE_TYPE_ID } }),
        prisma.ticketType.findUnique({ where: { id: TARGET_TYPE_ID } }),
    ])

    if (!ticket || !source || !target) throw new Error("No se encontró el carnet o uno de los horarios")
    const alreadyApplied = ticket.ticketTypeId === TARGET_TYPE_ID
    if (!alreadyApplied && ticket.ticketTypeId !== SOURCE_TYPE_ID) {
        throw new Error(`El carnet está en un horario inesperado: ${ticket.ticketTypeId}`)
    }
    if (ticket.eventId !== EVENT_ID || source.eventId !== EVENT_ID || target.eventId !== EVENT_ID) {
        throw new Error("El carnet y los horarios no pertenecen al mismo evento esperado")
    }
    if (ticket.attendeeDni !== ATTENDEE_DNI || ticket.attendeeName !== "DIEGO MATIAS CALATAYUD CORDOVA") {
        throw new Error("La identidad del carnet no coincide")
    }
    if (source.name !== SOURCE_NAME || target.name !== TARGET_NAME) throw new Error("Cambió el nombre de uno de los horarios")
    if (!target.isActive) throw new Error("El horario destino está inactivo")
    if (Number(source.price) !== Number(target.price) || Number(target.price) !== 230) {
        throw new Error("Los horarios no tienen el mismo precio de S/230")
    }
    if (source.isPackage !== target.isPackage || source.packageDaysCount !== target.packageDaysCount) {
        throw new Error("Los horarios no tienen la misma modalidad/cantidad de clases")
    }
    if (ticket.status !== "ACTIVE" || ticket.order.status !== "PAID") throw new Error("El carnet o la orden no están activos")
    if (ticket.scans.length > 0) throw new Error("El carnet ya tiene asistencias; requiere revisión manual")

    const matchingItems = ticket.order.orderItems.filter((item) => {
        if (item.ticketTypeId !== (alreadyApplied ? TARGET_TYPE_ID : SOURCE_TYPE_ID)) return false
        try { return attendeeDni(item.attendeeData) === ATTENDEE_DNI } catch { return false }
    })
    if (matchingItems.length !== 1) throw new Error(`Se esperaban 1 item de Diego; se encontraron ${matchingItems.length}`)
    const orderItem = matchingItems[0]
    if (orderItem.quantity !== 1 || Number(orderItem.unitPrice) !== 230 || Number(orderItem.subtotal) !== 230) {
        throw new Error("El item no es una unidad de S/230")
    }
    if (!alreadyApplied && source.sold < 1) throw new Error("El horario origen ya no tiene una venta para descontar")
    if (!alreadyApplied && target.capacity !== 0 && target.sold + 1 > target.capacity) throw new Error("El horario destino no tiene cupo")

    console.table([{
        carnet: ticket.ticketCode,
        alumno: ticket.attendeeName,
        antes: alreadyApplied ? TARGET_NAME : SOURCE_NAME,
        despues: TARGET_NAME,
        cupoOrigen: `${source.sold}/${source.capacity}`,
        cupoDestino: `${target.sold}/${target.capacity}`,
        fechas: ticket.entitlements.map((item) => item.date.toISOString().slice(0, 10)).join(", "),
        comprobanteEmitido: ticket.order.invoices.some((invoice) => invoice.status === "ISSUED") ? "sí" : "no",
        estado: alreadyApplied ? "ya aplicado" : "pendiente",
    }])

    if (!APPLY || alreadyApplied) {
        console.log(alreadyApplied ? "Nada que aplicar: el cambio ya estaba hecho." : "DRY RUN: usa --apply para aplicar.")
        return
    }

    await prisma.$transaction(async (tx) => {
        const movedTicket = await tx.ticket.updateMany({
            where: { id: TICKET_ID, eventId: EVENT_ID, ticketTypeId: SOURCE_TYPE_ID, status: "ACTIVE" },
            data: { ticketTypeId: TARGET_TYPE_ID },
        })
        const movedItem = await tx.orderItem.updateMany({
            where: { id: orderItem.id, orderId: ticket.orderId, ticketTypeId: SOURCE_TYPE_ID },
            data: { ticketTypeId: TARGET_TYPE_ID },
        })
        const decremented = await tx.ticketType.updateMany({
            where: { id: SOURCE_TYPE_ID, eventId: EVENT_ID, sold: { gte: 1 } },
            data: { sold: { decrement: 1 } },
        })
        const incremented = await tx.$executeRaw`
            UPDATE ticket_types
            SET sold = sold + 1, "updatedAt" = NOW()
            WHERE id = ${TARGET_TYPE_ID} AND "eventId" = ${EVENT_ID}
              AND (capacity = 0 OR sold + 1 <= capacity)
        `
        if (movedTicket.count !== 1 || movedItem.count !== 1 || decremented.count !== 1 || incremented !== 1) {
            throw new Error("Una fila cambió durante la operación; se revierte todo")
        }
    })

    const verification = await prisma.ticket.findUnique({
        where: { id: TICKET_ID },
        select: { ticketTypeId: true, order: { select: { orderItems: { select: { id: true, ticketTypeId: true } } } } },
    })
    const verifiedItem = verification?.order.orderItems.find((item) => item.id === orderItem.id)
    if (verification?.ticketTypeId !== TARGET_TYPE_ID || verifiedItem?.ticketTypeId !== TARGET_TYPE_ID) {
        throw new Error("Falló la verificación posterior")
    }
    console.log("APLICADO Y VERIFICADO: Diego quedó en L-M-V de 5:00 a 6:00 p. m.")
}

main()
    .finally(() => prisma.$disconnect())
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
