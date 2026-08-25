/**
 * Congela manualmente un mes de una membresía (override administrativo).
 *
 * Es el equivalente por consola de POST /api/membership/[ticketId]/freeze, pero
 * sin las reglas de autoservicio (no retroactivo, 48h de anticipación, mes
 * completo dentro de la vigencia). Se usa cuando la federación aprueba un
 * congelamiento que el carnet ya no deja pedir: típicamente el mes EN CURSO o un
 * mes que arranca antes del inicio de la membresía.
 *
 * Se mantiene el invariante del modelo: máximo UN congelamiento por ticket
 * (MembershipFreeze.ticketId es @unique) y el rango es siempre el mes
 * calendario completo (día 1 → día 1 del mes siguiente, endDate exclusiva),
 * porque getMembershipFreezeRanges() reconstruye el rango desde `month`.
 *
 * Efecto: durante el mes el QR queda en estado FROZEN y la vigencia se corre
 * +1 mes (getMembershipExpiry suma un mes por freeze).
 *
 * Por defecto DRY-RUN: imprime el antes/después sin escribir nada.
 *   node --env-file=.env.production ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json \
 *     scripts/freeze-membership-month.ts --ticket <ticketId> --month 2026-08
 *
 * Para aplicar, agregar --apply. Para revertir, --undo (borra el freeze del ticket).
 *
 * También acepta --code JAUT-9S59-XGCB en vez de --ticket.
 */
import { prisma } from "@/lib/prisma"
import {
    getMembershipAnchor,
    getMembershipExpiry,
    getMembershipFreezeMonthRange,
    getMembershipFreezeRanges,
    type ScanTicket,
} from "@/lib/scan-helpers"

function getArg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}
const APPLY = process.argv.includes("--apply") || process.env.APPLY === "1"
const UNDO = process.argv.includes("--undo")
const ticketIdArg = getArg("ticket")
const codeArg = getArg("code")
const monthArg = (getArg("month") ?? "").trim()

/** Fecha "YYYY-MM-DD" como medianoche UTC: las columnas son @db.Date. */
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateKey = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "-")

async function main() {
    if (!ticketIdArg && !codeArg) throw new Error("falta --ticket <id> o --code <ticketCode>")
    if (!UNDO && !monthArg) throw new Error("falta --month YYYY-MM")

    const ticket = await prisma.ticket.findFirst({
        where: ticketIdArg ? { id: ticketIdArg } : { ticketCode: codeArg! },
        include: { event: true, ticketType: true, entitlements: true, membershipFreeze: true },
    })
    if (!ticket) throw new Error(`ticket no encontrado (${ticketIdArg ?? codeArg})`)

    const scanTicket = ticket as unknown as ScanTicket
    const anchor = getMembershipAnchor(scanTicket)
    const duration = ticket.ticketType.membershipDurationMonths ?? 0
    if (!anchor || duration <= 0) throw new Error("la entrada no es una membresía con vigencia configurada")

    const expiryBefore = getMembershipExpiry(anchor, duration, undefined, getMembershipFreezeRanges(scanTicket))

    console.log(`\n========== CONGELAMIENTO MANUAL  [${APPLY ? "APPLY (escribe)" : "DRY-RUN (solo lectura)"}] ==========\n`)
    console.log(`ticket        ${ticket.id}  ${ticket.ticketCode}  status=${ticket.status}`)
    console.log(`asistente     ${ticket.attendeeName ?? "-"}  DNI ${ticket.attendeeDni ?? "-"}`)
    console.log(`evento        ${ticket.event.title}`)
    console.log(`plan          ${ticket.ticketType.name} — ${duration} meses, cupo ${ticket.ticketType.monthlyClassLimit ?? "-"}/mes`)
    console.log(`inicio        ${dateKey(ticket.membershipStartDate) !== "-" ? dateKey(ticket.membershipStartDate) : dateKey(anchor)}`)
    console.log(`freeze actual ${ticket.membershipFreeze ? `${ticket.membershipFreeze.month} (${dateKey(ticket.membershipFreeze.startDate)} → ${dateKey(ticket.membershipFreeze.endDate)})` : "ninguno"}`)
    console.log(`vigencia      ${expiryBefore} (exclusiva)\n`)

    if (UNDO) {
        if (!ticket.membershipFreeze) {
            console.log("Nada que revertir: la membresía no tiene congelamiento.\n")
            return
        }
        const expiryAfter = getMembershipExpiry(anchor, duration, undefined, [])
        console.log(`REVERTIR      borra el freeze ${ticket.membershipFreeze.month}`)
        console.log(`vigencia      ${expiryBefore}  →  ${expiryAfter}\n`)
        if (!APPLY) {
            console.log("DRY-RUN: no se borró nada. Repetir con --apply.\n")
            return
        }
        await prisma.membershipFreeze.delete({ where: { ticketId: ticket.id } })
        console.log("Congelamiento eliminado.\n")
        return
    }

    const range = getMembershipFreezeMonthRange(monthArg)
    if (!range) throw new Error(`mes inválido: "${monthArg}" (formato YYYY-MM)`)
    if (ticket.status !== "ACTIVE") throw new Error(`la membresía no está ACTIVE (status=${ticket.status})`)
    if (ticket.membershipFreeze) {
        throw new Error(
            `esta membresía ya tiene un congelamiento (${ticket.membershipFreeze.month}). ` +
                `El modelo admite uno solo: revertir con --undo antes de recrearlo.`
        )
    }

    const expiryAfter = getMembershipExpiry(anchor, duration, undefined, [range])
    console.log(`CONGELAR      ${range.month}: ${range.startStr} → ${range.endStr} (fin exclusivo)`)
    console.log(`vigencia      ${expiryBefore}  →  ${expiryAfter}`)

    // Avisos: los mismos casos que la API de autoservicio bloquea y que aquí se
    // permiten a propósito. Se imprimen para que quede constancia del override.
    const todayStr = new Date().toISOString().slice(0, 10)
    const startStr = dateKey(anchor)
    if (range.startStr <= todayStr) {
        console.log(`  ! override: mes en curso/retroactivo (hoy ${todayStr}); el QR queda bloqueado desde ya hasta ${range.endStr}.`)
    }
    if (range.startStr < startStr) {
        console.log(`  ! override: el mes empieza antes del inicio de la membresía (${startStr}); igual cuenta como un mes completo.`)
    }
    if (range.endStr > expiryBefore) {
        console.log(`  ! override: el mes excede la vigencia vigente (${expiryBefore}).`)
    }

    const validScans = await prisma.scan.count({
        where: {
            ticketId: ticket.id,
            result: "VALID",
            date: { gte: dateOnly(range.startStr), lt: dateOnly(range.endStr) },
        },
    })
    console.log(`  clases válidas ya usadas en ${range.month}: ${validScans}`)
    console.log()

    if (!APPLY) {
        console.log("DRY-RUN: no se escribió nada. Repetir con --apply.\n")
        return
    }

    const freeze = await prisma.membershipFreeze.create({
        data: {
            ticketId: ticket.id,
            month: range.month,
            startDate: dateOnly(range.startStr),
            endDate: dateOnly(range.endStr),
        },
    })
    console.log(`Congelamiento creado: ${freeze.id}  ${freeze.month}  ${dateKey(freeze.startDate)} → ${dateKey(freeze.endDate)}`)
    console.log(`Nueva vigencia: ${expiryAfter} (exclusiva)\n`)
}

main()
    .catch((e) => {
        console.error(e instanceof Error ? `\nERROR: ${e.message}\n` : e)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
