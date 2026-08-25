/**
 * Reporte de ENTRADAS VENDIDAS por DÍA / TURNO / TIPO DE ENTRADA.
 *
 * Pensado para eventos tipo festival donde se habilitan varias entradas y cada
 * comprador elige día + turno (guardado en OrderItem.attendeeData[].scheduleSelections).
 * Cuenta solo órdenes PAGADAS. SOLO LECTURA: no escribe en la BD.
 *
 * Uso (desde fdnda-tickets/):
 *   npx tsx --tsconfig tsconfig.json scripts/report-festival-dia-turno.ts
 *   npx tsx ... scripts/report-festival-dia-turno.ts --slug festival-de-menores-en-pc-2026-lima
 *   npx tsx ... scripts/report-festival-dia-turno.ts --out "C:/ruta/reporte.xlsx"
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

const DEFAULT_SLUG = "festival-de-menores-en-pc-2026-lima"

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
/** Día de la semana en español a partir de "YYYY-MM-DD" (sin líos de zona horaria). */
function weekday(dateStr: string): string {
    const [y, m, d] = dateStr.split("-").map(Number)
    if (!y || !m || !d) return "—"
    // Usar UTC para no correr el día con la zona local.
    return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** Normaliza el shift crudo (string u objeto {name,startTime,endTime}) a un label. */
function shiftLabel(raw: unknown): string | null {
    if (typeof raw === "string") {
        const t = raw.trim()
        return t ? t : null
    }
    if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>
        const name = typeof r.name === "string" ? r.name.trim() : ""
        const s = typeof r.startTime === "string" ? r.startTime.trim() : ""
        const e = typeof r.endTime === "string" ? r.endTime.trim() : ""
        if (!name) return null
        return s && e ? `${name} (${s}-${e})` : name
    }
    return null
}

const SIN_TURNO = "Día completo (sin turno)"

/** Clave de orden para turnos: por hora de inicio embebida; "día completo" al final. */
function turnoSortKey(turno: string): string {
    if (turno === SIN_TURNO) return "zzz"
    const m = /\((\d{2}):(\d{2})/.exec(turno)
    if (m) return `${m[1]}${m[2]}_${turno}`
    return `yyy_${turno}`
}

async function main() {
    const XLSX = await import("xlsx")
    const { prisma } = await import("@/lib/prisma")

    const slug = getArg("slug") || DEFAULT_SLUG
    const outArg = getArg("out")

    const event = await prisma.event.findUnique({
        where: { slug },
        select: { id: true, title: true, slug: true, startDate: true, endDate: true },
    })
    if (!event) {
        console.error(`No se encontró el evento con slug "${slug}".`)
        console.error("Eventos disponibles:")
        const all = await prisma.event.findMany({ select: { slug: true, title: true }, orderBy: { startDate: "desc" } })
        for (const e of all) console.error(`  ${e.slug}  ->  ${e.title}`)
        process.exit(1)
    }

    // Tipos de entrada del evento (para orden de columnas y precio).
    const ticketTypes = await prisma.ticketType.findMany({
        where: { eventId: event.id },
        select: { id: true, name: true, price: true, sold: true },
        orderBy: { sortOrder: "asc" },
    })
    const ttOrder = ticketTypes.map((t) => t.name.trim())
    const ttPrice = new Map(ticketTypes.map((t) => [t.name.trim(), Number(t.price)]))

    // Todos los items de órdenes PAGADAS de este evento.
    const items = await prisma.orderItem.findMany({
        where: {
            order: { status: "PAID" },
            ticketType: { eventId: event.id },
        },
        select: {
            quantity: true,
            unitPrice: true,
            attendeeData: true,
            ticketType: { select: { name: true } },
        },
    })

    // ---- Acumuladores ----
    // clave: `${date}||${turno}||${entrada}`
    const cell = new Map<string, { fecha: string; turno: string; entrada: string; entradas: number; ingresos: number }>()
    const setFechas = new Set<string>()
    const setTurnos = new Set<string>()

    let totalSelecciones = 0
    let itemsSinDetalle = 0 // items PAID sin attendeeData utilizable

    for (const it of items) {
        const entrada = (it.ticketType?.name ?? "—").trim()
        const price = Number(it.unitPrice)
        const attendees = Array.isArray(it.attendeeData) ? it.attendeeData : []

        // Recolectar (fecha, turno) de cada asistente.
        let selectionsInItem = 0
        for (const att of attendees) {
            if (!att || typeof att !== "object") continue
            const sels = (att as Record<string, unknown>).scheduleSelections
            if (!Array.isArray(sels)) continue
            for (const s of sels) {
                if (!s || typeof s !== "object") continue
                const rec = s as Record<string, unknown>
                const date = typeof rec.date === "string" ? rec.date.trim() : ""
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
                const turno = shiftLabel(rec.shift) ?? SIN_TURNO
                selectionsInItem++
                totalSelecciones++
                setFechas.add(date)
                setTurnos.add(turno)
                const key = `${date}||${turno}||${entrada}`
                const cur = cell.get(key) ?? { fecha: date, turno, entrada, entradas: 0, ingresos: 0 }
                cur.entradas += 1
                cur.ingresos += price
                cell.set(key, cur)
            }
        }

        // Fallback: item pagado sin scheduleSelections utilizables -> contar por quantity, sin día/turno.
        if (selectionsInItem === 0) {
            itemsSinDetalle += 1
            const date = "Sin fecha"
            const turno = "Sin detalle"
            setFechas.add(date)
            setTurnos.add(turno)
            const key = `${date}||${turno}||${entrada}`
            const cur = cell.get(key) ?? { fecha: date, turno, entrada, entradas: 0, ingresos: 0 }
            cur.entradas += it.quantity
            cur.ingresos += price * it.quantity
            cell.set(key, cur)
        }
    }

    // Orden de fechas y turnos.
    const fechas = [...setFechas].sort((a, b) => {
        if (a === "Sin fecha") return 1
        if (b === "Sin fecha") return -1
        return a.localeCompare(b)
    })
    const turnos = [...setTurnos].sort((a, b) => turnoSortKey(a).localeCompare(turnoSortKey(b)))
    // Columnas de entradas: primero las del orden configurado, luego cualquier extra.
    const entradasCols = [
        ...ttOrder,
        ...[...new Set([...cell.values()].map((c) => c.entrada))].filter((e) => !ttOrder.includes(e)),
    ]

    // ================= HOJA 1: Matriz Día × Turno (entradas por tipo) =================
    type MatrixRow = Record<string, string | number>
    const matrixRows: MatrixRow[] = []
    let grandTotal = 0
    const colTotals: Record<string, number> = {}
    for (const e of entradasCols) colTotals[e] = 0

    for (const fecha of fechas) {
        // ¿hay algún turno con datos para esta fecha?
        const turnosConDatos = turnos.filter((turno) =>
            entradasCols.some((e) => cell.has(`${fecha}||${turno}||${e}`))
        )
        for (const turno of turnosConDatos) {
            const row: MatrixRow = {
                Fecha: fecha,
                Día: fecha === "Sin fecha" ? "—" : weekday(fecha),
                Turno: turno,
            }
            let rowTotal = 0
            for (const e of entradasCols) {
                const c = cell.get(`${fecha}||${turno}||${e}`)
                const v = c ? c.entradas : 0
                row[e] = v
                rowTotal += v
                colTotals[e] += v
            }
            row["TOTAL"] = rowTotal
            grandTotal += rowTotal
            matrixRows.push(row)
        }
    }
    // Fila de totales.
    const totalRow: MatrixRow = { Fecha: "TOTAL", Día: "", Turno: "" }
    for (const e of entradasCols) totalRow[e] = colTotals[e]
    totalRow["TOTAL"] = grandTotal
    matrixRows.push(totalRow)

    const matrixHeader = ["Fecha", "Día", "Turno", ...entradasCols, "TOTAL"]
    const wsMatrix = XLSX.utils.json_to_sheet(matrixRows, { header: matrixHeader })
    wsMatrix["!cols"] = [
        { wch: 12 }, { wch: 10 }, { wch: 24 },
        ...entradasCols.map(() => ({ wch: 16 })),
        { wch: 10 },
    ]

    // ================= HOJA 2: Detalle (una fila por Día/Turno/Entrada) =================
    type DetailRow = { Fecha: string; Día: string; Turno: string; "Tipo de Entrada": string; "Entradas Vendidas": number; "Ingresos (S/)": number }
    const detailRows: DetailRow[] = [...cell.values()]
        .map((c) => ({
            Fecha: c.fecha,
            Día: c.fecha === "Sin fecha" ? "—" : weekday(c.fecha),
            Turno: c.turno,
            "Tipo de Entrada": c.entrada,
            "Entradas Vendidas": c.entradas,
            "Ingresos (S/)": Math.round(c.ingresos * 100) / 100,
        }))
        .sort(
            (a, b) =>
                a.Fecha.localeCompare(b.Fecha) ||
                turnoSortKey(a.Turno).localeCompare(turnoSortKey(b.Turno)) ||
                a["Tipo de Entrada"].localeCompare(b["Tipo de Entrada"], "es")
        )
    const detailHeader = ["Fecha", "Día", "Turno", "Tipo de Entrada", "Entradas Vendidas", "Ingresos (S/)"]
    const wsDetail = XLSX.utils.json_to_sheet(detailRows, { header: detailHeader })
    wsDetail["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 30 }, { wch: 18 }, { wch: 14 }]
    if (wsDetail["!ref"]) wsDetail["!autofilter"] = { ref: wsDetail["!ref"] }

    // ================= HOJA 3: Resumen por Día =================
    const byDay = new Map<string, { entradas: number; ingresos: number }>()
    for (const c of cell.values()) {
        const cur = byDay.get(c.fecha) ?? { entradas: 0, ingresos: 0 }
        cur.entradas += c.entradas
        cur.ingresos += c.ingresos
        byDay.set(c.fecha, cur)
    }
    const dayRows = fechas.map((f) => ({
        Fecha: f,
        Día: f === "Sin fecha" ? "—" : weekday(f),
        "Entradas Vendidas": byDay.get(f)?.entradas ?? 0,
        "Ingresos (S/)": Math.round((byDay.get(f)?.ingresos ?? 0) * 100) / 100,
    }))
    dayRows.push({
        Fecha: "TOTAL",
        Día: "",
        "Entradas Vendidas": dayRows.reduce((s, r) => s + r["Entradas Vendidas"], 0),
        "Ingresos (S/)": Math.round(dayRows.reduce((s, r) => s + r["Ingresos (S/)"], 0) * 100) / 100,
    })
    const wsDay = XLSX.utils.json_to_sheet(dayRows, { header: ["Fecha", "Día", "Entradas Vendidas", "Ingresos (S/)"] })
    wsDay["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 14 }]

    // ================= HOJA 4: Resumen por Tipo de Entrada =================
    const byType = new Map<string, { entradas: number; ingresos: number }>()
    for (const c of cell.values()) {
        const cur = byType.get(c.entrada) ?? { entradas: 0, ingresos: 0 }
        cur.entradas += c.entradas
        cur.ingresos += c.ingresos
        byType.set(c.entrada, cur)
    }
    const typeRows = entradasCols
        .filter((e) => byType.has(e))
        .map((e) => ({
            "Tipo de Entrada": e,
            "Precio (S/)": ttPrice.get(e) ?? "—",
            "Entradas Vendidas": byType.get(e)!.entradas,
            "Ingresos (S/)": Math.round(byType.get(e)!.ingresos * 100) / 100,
        }))
    typeRows.push({
        "Tipo de Entrada": "TOTAL",
        "Precio (S/)": "",
        "Entradas Vendidas": typeRows.reduce((s, r) => s + r["Entradas Vendidas"], 0),
        "Ingresos (S/)": Math.round(typeRows.reduce((s, r) => s + r["Ingresos (S/)"], 0) * 100) / 100,
    })
    const wsType = XLSX.utils.json_to_sheet(typeRows, { header: ["Tipo de Entrada", "Precio (S/)", "Entradas Vendidas", "Ingresos (S/)"] })
    wsType["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 18 }, { wch: 14 }]

    // ================= HOJA 5: Reconciliación =================
    const ticketsActivos = await prisma.ticket.count({ where: { eventId: event.id, status: "ACTIVE", order: { status: "PAID" } } })
    const ticketsTodos = await prisma.ticket.count({ where: { eventId: event.id } })
    const sumSold = ticketTypes.reduce((s, t) => s + t.sold, 0)
    const reconRows = [
        { Métrica: "Evento", Valor: event.title },
        { Métrica: "Rango", Valor: `${event.startDate.toISOString().slice(0, 10)} a ${event.endDate.toISOString().slice(0, 10)}` },
        { Métrica: "Generado", Valor: new Date().toISOString() },
        { Métrica: "", Valor: "" },
        { Métrica: "Entradas contadas (selecciones día/turno, PAID)", Valor: totalSelecciones },
        { Métrica: "Total en matriz (grand total)", Valor: grandTotal },
        { Métrica: "Tickets ACTIVE de órdenes PAID", Valor: ticketsActivos },
        { Métrica: "Tickets totales (cualquier estado)", Valor: ticketsTodos },
        { Métrica: "Suma de contador 'sold' (por tipo, incluye reservas)", Valor: sumSold },
        { Métrica: "Items PAID sin detalle día/turno (fallback)", Valor: itemsSinDetalle },
    ]
    const wsRecon = XLSX.utils.json_to_sheet(reconRows, { header: ["Métrica", "Valor"] })
    wsRecon["!cols"] = [{ wch: 52 }, { wch: 40 }]

    // ---- Ensamblar libro ----
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsMatrix, "Día×Turno×Entrada")
    XLSX.utils.book_append_sheet(wb, wsDetail, "Detalle")
    XLSX.utils.book_append_sheet(wb, wsDay, "Por Día")
    XLSX.utils.book_append_sheet(wb, wsType, "Por Entrada")
    XLSX.utils.book_append_sheet(wb, wsRecon, "Reconciliación")

    const today = new Date().toISOString().slice(0, 10)
    const outXlsx = outArg
        ? resolve(process.cwd(), outArg)
        : resolve(process.cwd(), "..", `reporte-${slug}-${today}.xlsx`)
    XLSX.writeFile(wb, outXlsx)

    // ---- Consola ----
    console.log(`Evento: ${event.title}`)
    console.log(`Entradas vendidas (selecciones día/turno, PAID): ${totalSelecciones}`)
    console.log(`Tickets ACTIVE (órdenes PAID): ${ticketsActivos}\n`)
    console.log("Matriz Día × Turno (total de entradas):")
    for (const fecha of fechas) {
        const turnosConDatos = turnos.filter((t) => entradasCols.some((e) => cell.has(`${fecha}||${t}||${e}`)))
        if (turnosConDatos.length === 0) continue
        console.log(`  ${fecha} (${fecha === "Sin fecha" ? "—" : weekday(fecha)})`)
        for (const turno of turnosConDatos) {
            const tot = entradasCols.reduce((s, e) => s + (cell.get(`${fecha}||${turno}||${e}`)?.entradas ?? 0), 0)
            console.log(`     ${turno}: ${tot}`)
        }
    }
    if (itemsSinDetalle > 0) console.log(`\n⚠ ${itemsSinDetalle} item(s) PAID sin detalle de día/turno (ver hoja Reconciliación).`)
    console.log(`\nExcel: ${outXlsx}`)

    await prisma.$disconnect()
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1) })
