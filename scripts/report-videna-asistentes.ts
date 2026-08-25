/**
 * Reporte simplificado de asistentes de MEMBRESÍAS VIDENA (sede sucursal "03").
 *
 * Una fila por asistente (ticket ACTIVE de una orden PAID). Columnas:
 *   Asistente · DNI · Membresía · Categoría · Horario · Mes de inicio ·
 *   Comprador · Correo · Teléfono · Entradas compradas (en la misma orden)
 *
 * Genera un .xlsx (y también un .csv por si acaso). SOLO LECTURA: no escribe en la BD.
 *
 * Uso (desde fdnda-tickets/):
 *   npx tsx --tsconfig tsconfig.json scripts/report-videna-asistentes.ts
 *   npx tsx ... scripts/report-videna-asistentes.ts --out "C:/ruta/asistentes.xlsx"
 *   npx tsx ... scripts/report-videna-asistentes.ts --status ALL   # incluye no-activos
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// --- cargar .env antes de importar prisma ---
for (const f of [".env", ".env.production"]) {
    try {
        const txt = readFileSync(resolve(process.cwd(), f), "utf8")
        for (const line of txt.split("\n")) {
            const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
            if (!m) continue
            let v = m[2].trim()
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
            if (!process.env[m[1]]) process.env[m[1]] = v
        }
    } catch {}
}
process.env.PRISMA_DATABASE_ADAPTER = process.env.PRISMA_DATABASE_ADAPTER || "neon"

function getArg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

/** "Agosto 2026" a partir de un @db.Date (se leen las partes en UTC para no correr el día). */
function monthLabel(d: Date | null | undefined): string {
    if (!d) return "—"
    return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

async function main() {
    const XLSX = await import("xlsx")
    const { prisma } = await import("@/lib/prisma")
    const { parseMembershipScheduleSelection, formatTime12h } = await import("@/lib/membership-schedule")

    const statusFilter = (getArg("status") ?? "ACTIVE").toUpperCase()
    const outArg = getArg("out")

    // Evento(s) VIDENA: sede sucursal "03".
    const events = await prisma.event.findMany({
        where: { servilexSucursalCode: "03" },
        select: { id: true, title: true, startDate: true },
    })
    if (events.length === 0) {
        console.error("No se encontró ningún evento en la sede VIDENA (sucursalCode 03).")
        process.exit(1)
    }
    const eventIds = events.map((e) => e.id)

    const tickets = await prisma.ticket.findMany({
        where: {
            eventId: { in: eventIds },
            ...(statusFilter !== "ALL" ? { status: statusFilter as "ACTIVE" | "CANCELLED" | "EXPIRED" } : {}),
        },
        include: {
            event: { select: { title: true, startDate: true } },
            ticketType: { select: { name: true, membershipScheduleKey: true } },
            order: {
                select: {
                    id: true,
                    status: true,
                    buyerName: true,
                    buyerEmail: true,
                    buyerPhone: true,
                    buyerDocNumber: true,
                    user: { select: { name: true, email: true, phone: true, dni: true } },
                },
            },
        },
    })

    // Solo asistentes con orden pagada (los "confirmados").
    const paidTickets = tickets.filter((t) => t.order.status === "PAID")

    // Entradas compradas = # de tickets (mismo estado) en la misma orden.
    const perOrderCount = new Map<string, number>()
    for (const t of paidTickets) perOrderCount.set(t.order.id, (perOrderCount.get(t.order.id) ?? 0) + 1)

    type Row = {
        Asistente: string
        DNI: string
        Membresía: string
        Categoría: string
        Horario: string
        "Mes de inicio": string
        Comprador: string
        Correo: string
        Teléfono: string
        "Entradas compradas": number
        Código: string
    }

    const rows: Row[] = paidTickets.map((t) => {
        const o = t.order
        const sel = parseMembershipScheduleSelection(t.membershipSchedule)

        // Horario: por grupo de días → "Lunes a Viernes: 6:00 a.m.–7:00 a.m."
        let horario = "—"
        let categoria = "—"
        if (sel && sel.groups.length > 0) {
            horario = sel.groups
                .map((g) => `${g.label}: ${formatTime12h(g.start)}–${formatTime12h(g.end)}`)
                .join(" | ")
            categoria = sel.categoryLabel || (sel.category === "NINOS" ? "Niños" : "Adultos")
        } else if (!t.ticketType.membershipScheduleKey) {
            horario = "Sin horario fijo (ORO)"
        }

        const startDate = t.membershipStartDate ?? t.event.startDate

        return {
            Asistente: t.attendeeName?.trim() || o.user.name || "—",
            DNI: t.attendeeDni?.trim() || o.buyerDocNumber || o.user.dni || "—",
            Membresía: t.ticketType.name,
            Categoría: categoria,
            Horario: horario,
            "Mes de inicio": monthLabel(startDate),
            Comprador: o.buyerName?.trim() || o.user.name || "—",
            Correo: o.buyerEmail?.trim() || o.user.email || "—",
            Teléfono: o.buyerPhone?.trim() || o.user.phone || "—",
            "Entradas compradas": perOrderCount.get(o.id) ?? 1,
            Código: t.ticketCode,
        }
    })

    // Orden: por membresía, luego categoría, luego asistente.
    rows.sort(
        (a, b) =>
            a.Membresía.localeCompare(b.Membresía, "es") ||
            a.Categoría.localeCompare(b.Categoría, "es") ||
            a.Asistente.localeCompare(b.Asistente, "es")
    )

    const header: (keyof Row)[] = [
        "Asistente",
        "DNI",
        "Membresía",
        "Categoría",
        "Horario",
        "Mes de inicio",
        "Comprador",
        "Correo",
        "Teléfono",
        "Entradas compradas",
        "Código",
    ]

    const ws = XLSX.utils.json_to_sheet(rows, { header: header as string[] })
    ws["!cols"] = [
        { wch: 30 }, // Asistente
        { wch: 12 }, // DNI
        { wch: 34 }, // Membresía
        { wch: 18 }, // Categoría
        { wch: 46 }, // Horario
        { wch: 16 }, // Mes de inicio
        { wch: 30 }, // Comprador
        { wch: 30 }, // Correo
        { wch: 14 }, // Teléfono
        { wch: 12 }, // Entradas compradas
        { wch: 22 }, // Código
    ]
    if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Asistentes VIDENA")

    const today = new Date().toISOString().slice(0, 10)
    const outXlsx = outArg
        ? resolve(process.cwd(), outArg)
        : resolve(process.cwd(), "..", `asistentes-videna-${today}.xlsx`)
    XLSX.writeFile(wb, outXlsx)

    const outCsv = outXlsx.replace(/\.xlsx$/i, ".csv")
    XLSX.writeFile(wb, outCsv, { bookType: "csv" })

    // Resumen por membresía.
    const byPlan = new Map<string, number>()
    for (const r of rows) byPlan.set(r.Membresía, (byPlan.get(r.Membresía) ?? 0) + 1)

    console.log(`Evento(s): ${events.map((e) => e.title).join(", ")}`)
    console.log(`Asistentes (tickets ${statusFilter} + orden PAID): ${rows.length}`)
    console.log("Por membresía:")
    for (const [plan, n] of [...byPlan.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  - ${plan}: ${n}`)
    }
    console.log(`\nExcel: ${outXlsx}`)
    console.log(`CSV:   ${outCsv}`)

    await prisma.$disconnect()
}

main().catch((e) => {
    console.error("ERROR:", e)
    process.exit(1)
})
