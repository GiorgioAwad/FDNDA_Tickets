/**
 * Migracion de TicketType existentes para eventos ACADEMIA.
 *
 * Setea `isPackage = true` y un `packageDaysCount` calculado, de forma que
 * el Carnet de asistencia muestre N cuadritos fijos en vez de contar
 * dias del calendario.
 *
 * Calculo del `packageDaysCount`:
 *   1) Si el nombre del ticket contiene "(\d+) clases?" → usa ese numero.
 *   2) Si no, y el evento tiene `academiaWeeklyFrequency` → frecuencia * 4 semanas.
 *   3) Si no, y el nombre contiene un patron de dias tipo "L-M-V" →
 *      cuenta los dias en el rango startDate..endDate (mismo calculo que hace el front).
 *   4) Si no → deja el ticket sin tocar (warning).
 *
 * Idempotente: no toca tickets que ya tienen isPackage=true con packageDaysCount > 0.
 *
 * Uso:
 *   DATABASE_URL=<neon-url> npx tsx scripts/migrate-academia-package-days.ts
 *
 *   Para dry-run (solo imprime cambios, no escribe):
 *   DATABASE_URL=<neon-url> npx tsx scripts/migrate-academia-package-days.ts --dry-run
 */

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL no esta seteado en el entorno.")
    process.exit(1)
}

const dryRun = process.argv.includes("--dry-run")

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const WEEKDAY_INDEX: Record<string, number> = {
    L: 1,
    M: 2,
    X: 3,
    J: 4,
    V: 5,
    S: 6,
    D: 0,
}

function extractClassCount(name: string): number | null {
    const match = name.match(/(\d+)\s*clases?/i)
    return match ? Number(match[1]) : null
}

function extractDaysLabel(name: string): string | null {
    const match = name.match(/Turno\s+([LMDXVJS-]+)/i) || name.match(/\b([LMDXVJS](?:-[LMDXVJS]){1,6})\b/i)
    return match?.[1]?.toUpperCase() ?? null
}

function getWeekdayIndexes(label: string): number[] {
    return label
        .split("-")
        .map((part) => WEEKDAY_INDEX[part.toUpperCase()])
        .filter((val) => val !== undefined)
}

function countDaysInRangeForWeekdays(start: Date, end: Date, label: string): number {
    const days = getWeekdayIndexes(label)
    if (!days.length) return 0
    let count = 0
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
    while (current <= last) {
        if (days.includes(current.getUTCDay())) count++
        current.setUTCDate(current.getUTCDate() + 1)
    }
    return count
}

async function main() {
    console.log(`[migrate-academia] ${dryRun ? "DRY RUN" : "WRITE MODE"}`)
    const events = await prisma.event.findMany({
        where: { category: "ACADEMIA" },
        include: { ticketTypes: true },
    })
    console.log(`[migrate-academia] Encontrados ${events.length} evento(s) ACADEMIA.`)

    let updated = 0
    let skippedAlreadyOk = 0
    let skippedUnknown = 0

    for (const event of events) {
        const freq = event.academiaWeeklyFrequency ?? null
        for (const ticket of event.ticketTypes) {
            if (ticket.isPackage && ticket.packageDaysCount && ticket.packageDaysCount > 0) {
                skippedAlreadyOk++
                continue
            }

            // 1) numero explicito en el nombre
            let count = extractClassCount(ticket.name)
            let source = "name regex (clases)"

            // 2) frecuencia del evento * 4
            if (!count && freq && freq > 0) {
                count = freq * 4
                source = `event.academiaWeeklyFrequency=${freq} x 4 sem`
            }

            // 3) patron de dias en el nombre + rango del evento
            if (!count) {
                const label = extractDaysLabel(ticket.name)
                if (label) {
                    const n = countDaysInRangeForWeekdays(event.startDate, event.endDate, label)
                    if (n > 0) {
                        count = n
                        source = `weekday label "${label}" entre ${event.startDate.toISOString().slice(0, 10)} y ${event.endDate.toISOString().slice(0, 10)}`
                    }
                }
            }

            if (!count || count < 1) {
                console.warn(`  [SKIP] ${event.title} / ${ticket.name} (id=${ticket.id}) — no se pudo inferir count`)
                skippedUnknown++
                continue
            }

            console.log(`  [OK]   ${event.title} / ${ticket.name} -> ${count} clases (${source})`)
            if (!dryRun) {
                await prisma.ticketType.update({
                    where: { id: ticket.id },
                    data: {
                        isPackage: true,
                        packageDaysCount: count,
                    },
                })
            }
            updated++
        }
    }

    console.log("")
    console.log(`Resumen: ${updated} actualizado(s), ${skippedAlreadyOk} ya estaban OK, ${skippedUnknown} sin inferir.`)
    if (skippedUnknown > 0) {
        console.log("Los SKIP los tendras que editar manualmente en /admin/eventos/<id>.")
    }
    if (dryRun) {
        console.log("[migrate-academia] DRY RUN — no se escribio nada. Re-correr sin --dry-run para aplicar.")
    }
}

main()
    .catch((error) => {
        console.error("[migrate-academia] Error:", error)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
