import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const envFile = process.env.ENV_FILE || process.argv[2] || ".env.production"
const eventSlug = process.env.EVENT_SLUG || process.argv[3] || ""

function readDatabaseUrl() {
    const raw = fs.readFileSync(path.join(repoRoot, envFile), "utf8")
    const match = raw.match(/^DATABASE_URL="?([^"\n]+)"?/m)
    if (!match) throw new Error(`DATABASE_URL not found in ${envFile}`)
    return match[1]
}

function limaDateTime(value = new Date()) {
    const parts = new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).formatToParts(value)
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`
}

function limaDateKey(value = new Date()) {
    return limaDateTime(value).slice(0, 10)
}

function filenameTimestamp(value = new Date()) {
    return value.toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

function weekday(dateKey) {
    const date = new Date(`${dateKey}T12:00:00-05:00`)
    const names = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"]
    return names[date.getUTCDay()]
}

function pct(numerator, denominator) {
    if (!denominator) return "n/a"
    return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function number(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
}

function csvEscape(value) {
    const text = String(value ?? "")
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
}

function table(headers, rows) {
    if (rows.length === 0) return "_Sin datos._\n"
    const lines = []
    lines.push(`| ${headers.join(" | ")} |`)
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`)
    for (const row of rows) lines.push(`| ${row.join(" | ")} |`)
    return `${lines.join("\n")}\n`
}

function sortHourLabel(a, b) {
    const hourA = String(a.horario).match(/\d{2}:\d{2}/)?.[0] || String(a.horario)
    const hourB = String(b.horario).match(/\d{2}:\d{2}/)?.[0] || String(b.horario)
    return hourA.localeCompare(hourB) || String(a.horario).localeCompare(String(b.horario))
}

const connectionString = readDatabaseUrl()
const client = new pg.Client({ connectionString })
await client.connect()

const dbNowResult = await client.query("SELECT NOW() AS now")
const dbNow = dbNowResult.rows[0].now
const asOf = limaDateTime(dbNow)
const today = limaDateKey(dbNow)

const slugFilter = eventSlug ? [eventSlug] : []
const eventWhere = eventSlug ? `AND e.slug = $1` : ""

const eventsResult = await client.query(
    `
    SELECT
        e.id,
        e.title,
        e.slug,
        to_char(e."startDate", 'YYYY-MM-DD') AS start_date,
        to_char(e."endDate", 'YYYY-MM-DD') AS end_date,
        e."isPublished"
    FROM events e
    WHERE e.category = 'PISCINA_LIBRE'
      ${eventWhere}
    ORDER BY e."startDate" ASC, e.title ASC
    `,
    slugFilter
)

if (eventsResult.rows.length === 0) {
    throw new Error(eventSlug ? `No PISCINA_LIBRE event found for ${eventSlug}` : "No PISCINA_LIBRE events found")
}

const inventoryResult = await client.query(
    `
    SELECT
        e.id AS event_id,
        e.title AS event_title,
        e.slug AS event_slug,
        tt.id AS ticket_type_id,
        tt.name AS horario,
        tt.capacity AS base_capacity,
        tt."isActive" AS ticket_active,
        tt."sortOrder" AS sort_order,
        to_char(inv."date", 'YYYY-MM-DD') AS date_key,
        inv.capacity,
        inv.sold AS inventory_sold,
        inv."isEnabled" AS is_enabled
    FROM events e
    JOIN ticket_types tt ON tt."eventId" = e.id
    LEFT JOIN ticket_type_date_inventories inv ON inv."ticketTypeId" = tt.id
    WHERE e.category = 'PISCINA_LIBRE'
      ${eventWhere}
    ORDER BY e."startDate" ASC, inv."date" ASC NULLS LAST, tt."sortOrder" ASC, tt.name ASC
    `,
    slugFilter
)

const paidSalesResult = await client.query(
    `
    SELECT
        e.id AS event_id,
        e.title AS event_title,
        e.slug AS event_slug,
        tt.id AS ticket_type_id,
        tt.name AS horario,
        to_char(tde."date", 'YYYY-MM-DD') AS date_key,
        COUNT(*)::int AS paid_sold
    FROM ticket_day_entitlements tde
    JOIN tickets t ON t.id = tde."ticketId"
    JOIN orders o ON o.id = t."orderId"
    JOIN ticket_types tt ON tt.id = t."ticketTypeId"
    JOIN events e ON e.id = t."eventId"
    WHERE e.category = 'PISCINA_LIBRE'
      AND o.status = 'PAID'
      AND t.status = 'ACTIVE'
      ${eventWhere}
    GROUP BY e.id, e.title, e.slug, tt.id, tt.name, to_char(tde."date", 'YYYY-MM-DD')
    ORDER BY date_key ASC, horario ASC
    `,
    slugFilter
)

await client.end()

const eventById = new Map(eventsResult.rows.map((event) => [event.id, event]))
const rowsByKey = new Map()

for (const row of inventoryResult.rows) {
    if (!row.date_key) continue
    const key = `${row.event_id}|${row.ticket_type_id}|${row.date_key}`
    const capacity = number(row.capacity)
    const inventorySold = number(row.inventory_sold)
    const isEnabled = Boolean(row.is_enabled)
    const wasOffered = isEnabled || capacity > 0 || inventorySold > 0
    if (!wasOffered) continue
    rowsByKey.set(key, {
        eventId: row.event_id,
        eventTitle: row.event_title,
        eventSlug: row.event_slug,
        ticketTypeId: row.ticket_type_id,
        horario: row.horario,
        date: row.date_key,
        weekday: weekday(row.date_key),
        capacity,
        inventorySold,
        paidSold: 0,
        isEnabled,
        ticketActive: Boolean(row.ticket_active),
    })
}

for (const row of paidSalesResult.rows) {
    const key = `${row.event_id}|${row.ticket_type_id}|${row.date_key}`
    const existing = rowsByKey.get(key)
    if (existing) {
        existing.paidSold = number(row.paid_sold)
        continue
    }
    rowsByKey.set(key, {
        eventId: row.event_id,
        eventTitle: row.event_title,
        eventSlug: row.event_slug,
        ticketTypeId: row.ticket_type_id,
        horario: row.horario,
        date: row.date_key,
        weekday: weekday(row.date_key),
        capacity: 0,
        inventorySold: 0,
        paidSold: number(row.paid_sold),
        isEnabled: false,
        ticketActive: true,
    })
}

const rows = Array.from(rowsByKey.values()).sort((a, b) => {
    return (
        a.eventTitle.localeCompare(b.eventTitle) ||
        a.date.localeCompare(b.date) ||
        sortHourLabel(a, b)
    )
})

const totals = rows.reduce(
    (acc, row) => {
        acc.capacity += row.capacity
        acc.paidSold += row.paidSold
        acc.inventorySold += row.inventorySold
        acc.enabledSlots += row.isEnabled ? 1 : 0
        return acc
    },
    { capacity: 0, paidSold: 0, inventorySold: 0, enabledSlots: 0 }
)

function groupByDay(eventRows) {
    const grouped = new Map()
    for (const row of eventRows) {
        const key = `${row.eventId}|${row.date}`
        const current =
            grouped.get(key) ||
            {
                eventId: row.eventId,
                eventTitle: row.eventTitle,
                date: row.date,
                weekday: row.weekday,
                paidSold: 0,
                capacity: 0,
                slots: 0,
                enabledSlots: 0,
            }
        current.paidSold += row.paidSold
        current.capacity += row.capacity
        current.slots += 1
        current.enabledSlots += row.isEnabled ? 1 : 0
        grouped.set(key, current)
    }
    return Array.from(grouped.values()).sort((a, b) => a.paidSold - b.paidSold || a.date.localeCompare(b.date))
}

function groupByHour(eventRows) {
    const grouped = new Map()
    for (const row of eventRows) {
        const key = `${row.eventId}|${row.ticketTypeId}`
        const current =
            grouped.get(key) ||
            {
                eventId: row.eventId,
                eventTitle: row.eventTitle,
                horario: row.horario,
                paidSold: 0,
                capacity: 0,
                days: 0,
                enabledDays: 0,
            }
        current.paidSold += row.paidSold
        current.capacity += row.capacity
        current.days += 1
        current.enabledDays += row.isEnabled ? 1 : 0
        grouped.set(key, current)
    }
    return Array.from(grouped.values())
        .map((row) => ({
            ...row,
            avgPaidSold: row.days ? row.paidSold / row.days : 0,
        }))
        .sort((a, b) => a.avgPaidSold - b.avgPaidSold || a.paidSold - b.paidSold || sortHourLabel(a, b))
}

function weakestSlots(eventRows) {
    return [...eventRows].sort(
        (a, b) =>
            a.paidSold - b.paidSold ||
            a.date.localeCompare(b.date) ||
            sortHourLabel(a, b)
    )
}

function eventRows(eventId) {
    return rows.filter((row) => row.eventId === eventId)
}

const markdown = []
const daySummaryRows = []
const hourSummaryRows = []

markdown.push(`# Reporte piscina libre - horarios y dias mas debiles`)
markdown.push("")
markdown.push(`Generado: ${asOf} America/Lima`)
markdown.push(`Fuente: base de datos ${envFile}; conteo principal = tickets ACTIVE de ordenes PAID.`)
markdown.push(`Eventos incluidos: ${eventsResult.rows.length}`)
markdown.push("")
markdown.push(`## Resumen general`)
markdown.push("")
markdown.push(
    table(
        ["Metrica", "Cantidad"],
        [
            ["Entradas pagadas", totals.paidSold],
            ["Fechas con horarios configurados", new Set(rows.map((row) => `${row.eventId}|${row.date}`)).size],
            ["Horarios distintos configurados", new Set(rows.map((row) => `${row.eventId}|${row.ticketTypeId}`)).size],
        ]
    )
)

for (const event of eventsResult.rows) {
    const scopedRows = eventRows(event.id)
    const closedRows = scopedRows.filter((row) => row.date < today)
    const dayRows = groupByDay(closedRows)
    const hourRows = groupByHour(closedRows)
    const eventTotals = scopedRows.reduce(
        (acc, row) => {
            acc.capacity += row.capacity
            acc.paidSold += row.paidSold
            acc.inventorySold += row.inventorySold
            return acc
        },
        { capacity: 0, paidSold: 0, inventorySold: 0 }
    )

    markdown.push(`## ${event.title}`)
    markdown.push("")
    markdown.push(`Periodo del evento: ${event.start_date} a ${event.end_date}`)
    markdown.push(`Slug: \`${event.slug}\``)
    markdown.push("")
    markdown.push(
        table(
            ["Entradas pagadas", "Fechas cerradas analizadas", "Horarios analizados"],
            [[eventTotals.paidSold, dayRows.length, hourRows.length]]
        )
    )

    markdown.push(`### Dias mas debiles (fechas cerradas)`)
    markdown.push("")
    markdown.push(`Ordenado por menor cantidad vendida. Solo incluye fechas anteriores a ${today}; hoy y fechas futuras no se mezclan con resultados cerrados.`)
    markdown.push("")
    markdown.push(
        table(
            ["Dia", "Fecha", "Vendidas"],
            dayRows.slice(0, 10).map((row) => [
                row.weekday,
                row.date,
                row.paidSold,
            ])
        )
    )

    for (const row of dayRows) {
        daySummaryRows.push([
            event.title,
            event.slug,
            row.date,
            row.weekday,
            row.paidSold,
        ])
    }

    markdown.push(`### Horarios mas debiles (fechas cerradas)`)
    markdown.push("")
    markdown.push(`Ordenado por menor promedio vendido por dia ofrecido.`)
    markdown.push("")
    markdown.push(
        table(
            ["Horario", "Vendidas", "Dias ofrecidos", "Promedio por dia"],
            hourRows.slice(0, 10).map((row) => [
                row.horario,
                row.paidSold,
                row.days,
                row.avgPaidSold.toFixed(1),
            ])
        )
    )

    for (const row of hourRows) {
        hourSummaryRows.push([
            event.title,
            event.slug,
            row.horario,
            row.paidSold,
            row.days,
            row.avgPaidSold.toFixed(1),
        ])
    }
}

const dayCsvHeaders = [
    "event_title",
    "event_slug",
    "date",
    "weekday",
    "paid_sold",
]

const hourCsvHeaders = [
    "event_title",
    "event_slug",
    "horario",
    "paid_sold",
    "days_offered",
    "average_paid_sold_per_day",
]

const outDir = path.join(repoRoot, "scripts", "out")
fs.mkdirSync(outDir, { recursive: true })
const stamp = filenameTimestamp(dbNow)
const base = eventSlug ? `piscina-libre-debiles-simple-${eventSlug}-${stamp}` : `piscina-libre-debiles-simple-${stamp}`
const mdPath = path.join(outDir, `${base}.md`)
const dayCsvPath = path.join(outDir, `${base}-dias.csv`)
const hourCsvPath = path.join(outDir, `${base}-horarios.csv`)

fs.writeFileSync(mdPath, `${markdown.join("\n")}\n`, "utf8")
fs.writeFileSync(
    dayCsvPath,
    [
        dayCsvHeaders.map(csvEscape).join(","),
        ...daySummaryRows.map((row) => row.map(csvEscape).join(",")),
    ].join("\n") + "\n",
    "utf8"
)
fs.writeFileSync(
    hourCsvPath,
    [
        hourCsvHeaders.map(csvEscape).join(","),
        ...hourSummaryRows.map((row) => row.map(csvEscape).join(",")),
    ].join("\n") + "\n",
    "utf8"
)

console.log(`Reporte Markdown: ${path.relative(repoRoot, mdPath)}`)
console.log(`CSV dias: ${path.relative(repoRoot, dayCsvPath)}`)
console.log(`CSV horarios: ${path.relative(repoRoot, hourCsvPath)}`)
console.log(`Entradas pagadas: ${totals.paidSold}`)
console.log(`Dias resumidos: ${daySummaryRows.length}`)
console.log(`Horarios resumidos: ${hourSummaryRows.length}`)
console.log(`Eventos incluidos: ${eventsResult.rows.length}`)
console.log(`Fecha de corte Lima: ${today}`)
