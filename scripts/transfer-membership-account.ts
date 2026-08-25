/**
 * Reasigna un carnet de membresia existente a otra cuenta sin modificar la
 * orden/boleta original, el QR, el horario, la vigencia ni sus asistencias.
 *
 * Dry-run por defecto. Para aplicar, repetir exactamente con --confirm.
 */
import { prisma } from "@/lib/prisma"

function flag(name: string): string | null {
    const prefix = `--${name}=`
    return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || null
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`)
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase()
}

async function main() {
    const ticketCode = flag("ticket-code")?.toUpperCase()
    const fromEmail = flag("from")
    const toEmail = flag("to")
    const attendeeDni = flag("attendee-dni")
    const confirm = hasFlag("confirm")

    if (!ticketCode || !fromEmail || !toEmail || !attendeeDni) {
        throw new Error(
            "Uso: --ticket-code=XXXX-XXXX-XXXX --from=correo --to=correo " +
                "--attendee-dni=######## [--confirm]",
        )
    }

    const [sourceUser, targetUser] = await Promise.all([
        prisma.user.findFirst({
            where: { email: { equals: normalizeEmail(fromEmail), mode: "insensitive" } },
            select: { id: true, name: true, email: true, dni: true, emailVerifiedAt: true },
        }),
        prisma.user.findFirst({
            where: { email: { equals: normalizeEmail(toEmail), mode: "insensitive" } },
            select: { id: true, name: true, email: true, dni: true, emailVerifiedAt: true },
        }),
    ])

    if (!sourceUser) throw new Error(`No existe la cuenta origen ${fromEmail}.`)
    if (!targetUser) throw new Error(`No existe la cuenta destino ${toEmail}.`)
    if (sourceUser.id === targetUser.id) throw new Error("La cuenta origen y destino son la misma.")

    const ticket = await prisma.ticket.findUnique({
        where: { ticketCode },
        include: {
            user: { select: { id: true, name: true, email: true } },
            event: { select: { id: true, title: true, servilexSucursalCode: true } },
            ticketType: {
                select: { id: true, name: true, membershipDurationMonths: true, monthlyClassLimit: true },
            },
            order: { select: { id: true, status: true, buyerName: true, buyerEmail: true } },
            _count: { select: { scans: true, entitlements: true, monthlySchedules: true } },
        },
    })

    if (!ticket) throw new Error(`No existe el ticket ${ticketCode}.`)
    if (ticket.userId !== sourceUser.id) {
        throw new Error(`El ticket pertenece a ${ticket.user.email}, no a ${sourceUser.email}.`)
    }
    if ((ticket.attendeeDni ?? "").replace(/\D/g, "") !== attendeeDni.replace(/\D/g, "")) {
        throw new Error(`El DNI del ticket (${ticket.attendeeDni ?? "sin DNI"}) no coincide con ${attendeeDni}.`)
    }
    if (ticket.status !== "ACTIVE") throw new Error(`El ticket no esta activo: ${ticket.status}.`)
    if (ticket.order.status !== "PAID") throw new Error(`La orden no esta pagada: ${ticket.order.status}.`)
    if ((ticket.ticketType.membershipDurationMonths ?? 0) <= 0) {
        throw new Error("El ticket no corresponde a una membresia a termino fijo.")
    }

    const duplicate = await prisma.ticket.findFirst({
        where: {
            id: { not: ticket.id },
            userId: targetUser.id,
            eventId: ticket.eventId,
            attendeeDni: ticket.attendeeDni,
            status: "ACTIVE",
            order: { status: "PAID" },
            ticketType: { membershipDurationMonths: { gt: 0 } },
        },
        select: { ticketCode: true, attendeeName: true, ticketType: { select: { name: true } } },
    })
    if (duplicate) {
        throw new Error(
            `La cuenta destino ya tiene la membresia activa ${duplicate.ticketCode} ` +
                `(${duplicate.ticketType.name}, ${duplicate.attendeeName ?? "sin nombre"}).`,
        )
    }

    console.log(`Carnet:     ${ticket.ticketCode} | ${ticket.attendeeName ?? "-"} | DNI ${ticket.attendeeDni ?? "-"}`)
    console.log(`Membresia:  ${ticket.event.title} | ${ticket.ticketType.name}`)
    console.log(`Origen:     ${sourceUser.name} <${sourceUser.email}>`)
    console.log(`Destino:    ${targetUser.name} <${targetUser.email}> | DNI cuenta ${targetUser.dni ?? "-"}`)
    console.log(`Estado:     ticket ${ticket.status} | orden ${ticket.order.status}`)
    console.log(
        `Relacionados: ${ticket._count.scans} escaneo(s), ${ticket._count.entitlements} entitlement(s), ` +
            `${ticket._count.monthlySchedules} cambio(s) mensual(es)`,
    )
    console.log("La orden y los datos del comprador permanecen en la cuenta original.")

    if (!confirm) {
        console.log("DRY-RUN: no se modifico nada. Repetir con --confirm para aplicar.")
        return
    }

    const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.ticket.updateMany({
            where: { id: ticket.id, userId: sourceUser.id, status: "ACTIVE" },
            data: { userId: targetUser.id },
        })
        if (result.count !== 1) {
            throw new Error(`Se esperaba actualizar 1 ticket y se actualizaron ${result.count}.`)
        }
        return tx.ticket.findUniqueOrThrow({
            where: { id: ticket.id },
            select: {
                ticketCode: true,
                attendeeName: true,
                attendeeDni: true,
                user: { select: { id: true, name: true, email: true } },
                order: { select: { id: true, userId: true, buyerName: true, buyerEmail: true } },
            },
        })
    })

    if (updated.user.id !== targetUser.id || updated.order.userId !== sourceUser.id) {
        throw new Error("La verificacion posterior no coincide con la reasignacion esperada.")
    }
    console.log(`APLICADO: ${updated.ticketCode} ahora figura en ${updated.user.email}.`)
    console.log(`Comprador/orden conservados: ${updated.order.buyerName ?? "-"} <${updated.order.buyerEmail ?? sourceUser.email}>.`)
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
