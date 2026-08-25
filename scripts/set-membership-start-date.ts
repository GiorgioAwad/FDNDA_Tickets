/** Corrige de forma segura la fecha de inicio de un carnet. Dry-run por defecto. */
import { prisma } from "@/lib/prisma"
import { parseDateOnly } from "@/lib/utils"

function flag(name: string): string | null {
    const prefix = `--${name}=`
    return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || null
}

function dateKey(value: Date | null): string {
    return value?.toISOString().slice(0, 10) ?? "-"
}

async function main() {
    const ticketCode = flag("ticket-code")?.toUpperCase()
    const email = flag("email")?.toLowerCase()
    const nextDate = flag("date")
    const expectedCurrent = flag("expected-current")
    const confirm = process.argv.includes("--confirm")

    if (!ticketCode || !email || !nextDate || !expectedCurrent || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
        throw new Error(
            "Uso: --ticket-code=... --email=... --date=YYYY-MM-DD " +
                "--expected-current=YYYY-MM-DD [--confirm]",
        )
    }
    const month = Number(nextDate.slice(5, 7))
    if (month === 1 || month === 2) throw new Error("Enero y febrero no pueden ser inicio de membresia.")

    const ticket = await prisma.ticket.findUnique({
        where: { ticketCode },
        select: {
            id: true,
            ticketCode: true,
            status: true,
            attendeeName: true,
            attendeeDni: true,
            membershipStartDate: true,
            user: { select: { email: true } },
            order: { select: { status: true } },
            event: { select: { title: true } },
            ticketType: { select: { name: true, membershipDurationMonths: true, monthlyClassLimit: true } },
        },
    })
    if (!ticket) throw new Error(`No existe el carnet ${ticketCode}.`)
    if (ticket.user.email.toLowerCase() !== email) throw new Error(`El carnet pertenece a ${ticket.user.email}.`)
    if (ticket.status !== "ACTIVE" || ticket.order.status !== "PAID") {
        throw new Error(`El carnet/orden no esta vigente: ${ticket.status}/${ticket.order.status}.`)
    }
    if ((ticket.ticketType.membershipDurationMonths ?? 0) <= 0 || (ticket.ticketType.monthlyClassLimit ?? 0) <= 0) {
        throw new Error("El carnet no corresponde a una membresia a termino fijo.")
    }
    const currentDate = dateKey(ticket.membershipStartDate)
    if (currentDate !== expectedCurrent) {
        throw new Error(`La fecha actual es ${currentDate}; se esperaba ${expectedCurrent}.`)
    }

    console.log(`${ticket.ticketCode} | ${ticket.attendeeName ?? "-"} DNI ${ticket.attendeeDni ?? "-"}`)
    console.log(`${ticket.event.title} | ${ticket.ticketType.name}`)
    console.log(`Inicio: ${currentDate} -> ${nextDate}`)
    if (!confirm) {
        console.log("DRY-RUN: no se modifico nada.")
        return
    }

    const result = await prisma.ticket.updateMany({
        where: { id: ticket.id, membershipStartDate: parseDateOnly(expectedCurrent), status: "ACTIVE" },
        data: { membershipStartDate: parseDateOnly(nextDate) },
    })
    if (result.count !== 1) throw new Error(`Se esperaba actualizar 1 carnet y se actualizaron ${result.count}.`)

    const verified = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { membershipStartDate: true },
    })
    if (dateKey(verified.membershipStartDate) !== nextDate) throw new Error("Fallo la verificacion posterior.")
    console.log(`APLICADO: inicio ${nextDate}.`)
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(async () => prisma.$disconnect())
