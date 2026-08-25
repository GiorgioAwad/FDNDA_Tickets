import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const envFile = process.env.ENV_FILE || process.argv[2] || ".env.production"
const TARGET_OCCUPANCY = 0.15

const weekdayNames = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"]
const weekdayOrder = new Map(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].map((day, index) => [day, index]))

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

function filenameTimestamp(value = new Date()) {
    return value.toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

function number(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function round(value, decimals = 2) {
    const factor = 10 ** decimals
    return Math.round((number(value) + Number.EPSILON) * factor) / factor
}

function ratio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : 0
}

function pct(value, decimals = 1) {
    return `${(number(value) * 100).toFixed(decimals)}%`
}

function money(value) {
    return `S/ ${number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function weekday(dateKey) {
    return weekdayNames[new Date(`${dateKey}T12:00:00-05:00`).getUTCDay()]
}

function dayOfMonth(dateKey) {
    return Number(String(dateKey).slice(8, 10))
}

function median(values) {
    const sorted = values.map(number).sort((a, b) => a - b)
    if (sorted.length === 0) return 0
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function csvEscape(value) {
    const text = String(value ?? "")
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
}

function markdownEscape(value) {
    return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function markdownTable(headers, rows) {
    if (rows.length === 0) return "_Sin datos._\n"
    return [
        `| ${headers.map(markdownEscape).join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.map(markdownEscape).join(" | ")} |`),
    ].join("\n") + "\n"
}

function sortHour(a, b) {
    const aHour = String(a.horario || a).match(/\d{2}:\d{2}/)?.[0] || String(a.horario || a)
    const bHour = String(b.horario || b).match(/\d{2}:\d{2}/)?.[0] || String(b.horario || b)
    return aHour.localeCompare(bHour) || String(a.horario || a).localeCompare(String(b.horario || b), "es")
}

function rating(occupancy) {
    if (occupancy < 0.05) return "CRITICO"
    if (occupancy < 0.15) return "DEBIL"
    if (occupancy < 0.4) return "SALUDABLE"
    return "FUERTE"
}

function aggregateRows(rows) {
    const dates = new Set()
    const buyers = new Set()
    const result = rows.reduce(
        (acc, row) => {
            acc.capacity += row.capacity
            acc.inventorySold += row.inventorySold
            acc.directVisits += row.directVisits
            acc.bagVisits += row.bagVisits
            acc.occupied += row.occupied
            acc.attended += row.attended
            acc.courtesyVisits += row.courtesyVisits
            acc.attributedRevenue += row.attributedRevenue
            acc.openSlots += 1
            acc.zeroSlots += row.occupied === 0 ? 1 : 0
            if (row.date) dates.add(row.date)
            for (const buyerId of row.buyerIds || []) buyers.add(buyerId)
            return acc
        },
        {
            capacity: 0,
            inventorySold: 0,
            directVisits: 0,
            bagVisits: 0,
            occupied: 0,
            attended: 0,
            courtesyVisits: 0,
            attributedRevenue: 0,
            openSlots: 0,
            zeroSlots: 0,
        }
    )
    result.days = dates.size
    result.buyers = buyers.size
    result.occupancy = ratio(result.occupied, result.capacity)
    result.scanRate = ratio(result.attended, result.occupied)
    result.avgVisitsPerDay = ratio(result.occupied, result.days)
    result.avgVisitsPerSlot = ratio(result.occupied, result.openSlots)
    result.zeroRate = ratio(result.zeroSlots, result.openSlots)
    result.revenuePerVisit = ratio(result.attributedRevenue, result.occupied)
    return result
}

function groupRows(rows, keyFn, decorateFn = () => ({})) {
    const grouped = new Map()
    for (const row of rows) {
        const key = keyFn(row)
        const current = grouped.get(key) || []
        current.push(row)
        grouped.set(key, current)
    }
    return Array.from(grouped.entries()).map(([key, values]) => ({
        key,
        ...decorateFn(values[0], key),
        ...aggregateRows(values),
        rows: values,
    }))
}

function relativePath(filePath) {
    return path.relative(repoRoot, filePath)
}

function writeCsv(filePath, rows) {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : []
    fs.writeFileSync(
        filePath,
        [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n",
        "utf8"
    )
}

const client = new pg.Client({ connectionString: readDatabaseUrl() })
await client.connect()
await client.query("BEGIN TRANSACTION READ ONLY")

let dbNow
let events
let inventoryRows
let directVisitRows
let bagVisitRows
let productRows

try {
    const nowResult = await client.query("SELECT NOW() AS now")
    dbNow = nowResult.rows[0].now

    const eventResult = await client.query(`
        SELECT e.id, e.title, e.slug,
               to_char(e."startDate", 'YYYY-MM-DD') AS start_date,
               to_char(e."endDate", 'YYYY-MM-DD') AS end_date,
               e."isPublished" AS is_published
        FROM events e
        WHERE e.category = 'PISCINA_LIBRE'
        ORDER BY e."startDate" ASC, e.title ASC
    `)
    events = eventResult.rows

    const inventoryResult = await client.query(`
        SELECT e.id AS event_id, e.title AS event_title, e.slug AS event_slug,
               tt.id AS ticket_type_id, tt.name AS horario, tt.price AS list_price,
               tt."isActive" AS ticket_active,
               to_char(inv.date, 'YYYY-MM-DD') AS date_key,
               inv.capacity, inv.sold AS inventory_sold, inv."isEnabled" AS is_enabled
        FROM ticket_type_date_inventories inv
        JOIN ticket_types tt ON tt.id = inv."ticketTypeId"
        JOIN events e ON e.id = tt."eventId"
        WHERE e.category = 'PISCINA_LIBRE'
          AND tt."isPackage" = false
        ORDER BY e."startDate" ASC, inv.date ASC, tt."sortOrder" ASC, tt.name ASC
    `)
    inventoryRows = inventoryResult.rows

    const directResult = await client.query(`
        WITH order_base AS (
            SELECT oi."orderId" AS order_id, SUM(oi.subtotal)::numeric AS order_subtotal
            FROM order_items oi
            GROUP BY oi."orderId"
        ), item_by_type AS (
            SELECT oi."orderId" AS order_id, oi."ticketTypeId" AS ticket_type_id,
                   SUM(oi.quantity)::int AS quantity, SUM(oi.subtotal)::numeric AS item_subtotal
            FROM order_items oi
            WHERE oi."ticketTypeId" IS NOT NULL
            GROUP BY oi."orderId", oi."ticketTypeId"
        )
        SELECT e.id AS event_id, tt.id AS ticket_type_id, tt.name AS horario,
               to_char(tde.date, 'YYYY-MM-DD') AS date_key,
               tde.status::text AS entitlement_status,
               t.id AS ticket_id, o."userId" AS buyer_id, o.id AS order_id,
               o.provider, (ct.id IS NOT NULL) AS is_courtesy,
               CASE WHEN ob.order_subtotal > 0 AND ibt.quantity > 0
                    THEN (o."totalAmount" * ibt.item_subtotal / ob.order_subtotal) / ibt.quantity
                    ELSE 0 END AS net_revenue,
               CASE WHEN ibt.quantity > 0 THEN ibt.item_subtotal / ibt.quantity ELSE 0 END AS gross_revenue,
               (tde.date - ((COALESCE(o."paidAt", o."createdAt") AT TIME ZONE 'America/Lima')::date))::int AS lead_days
        FROM ticket_day_entitlements tde
        JOIN tickets t ON t.id = tde."ticketId"
        JOIN orders o ON o.id = t."orderId"
        JOIN ticket_types tt ON tt.id = t."ticketTypeId"
        JOIN events e ON e.id = t."eventId"
        LEFT JOIN item_by_type ibt ON ibt.order_id = o.id AND ibt.ticket_type_id = tt.id
        LEFT JOIN order_base ob ON ob.order_id = o.id
        LEFT JOIN courtesy_tickets ct ON ct."ticketId" = t.id
        WHERE e.category = 'PISCINA_LIBRE'
          AND tt."isPackage" = false
          AND o.status = 'PAID'
          AND t.status = 'ACTIVE'
        ORDER BY tde.date ASC, tt.name ASC
    `)
    directVisitRows = directResult.rows

    const bagResult = await client.query(`
        WITH order_base AS (
            SELECT oi."orderId" AS order_id, SUM(oi.subtotal)::numeric AS order_subtotal
            FROM order_items oi
            GROUP BY oi."orderId"
        ), item_by_type AS (
            SELECT oi."orderId" AS order_id, oi."ticketTypeId" AS ticket_type_id,
                   SUM(oi.quantity)::int AS quantity, SUM(oi.subtotal)::numeric AS item_subtotal
            FROM order_items oi
            WHERE oi."ticketTypeId" IS NOT NULL
            GROUP BY oi."orderId", oi."ticketTypeId"
        )
        SELECT e.id AS event_id, slot.id AS ticket_type_id, slot.name AS horario,
               to_char(r.date, 'YYYY-MM-DD') AS date_key, r.status::text AS reservation_status,
               r.id AS reservation_id, r."createdAt" AS reservation_created_at,
               bag.id AS ticket_id, o."userId" AS buyer_id, o.id AS order_id,
               bag_tt.id AS package_type_id, bag_tt.name AS package_name,
               bag_tt."packageDaysCount" AS package_credits,
               (ct.id IS NOT NULL) AS is_courtesy,
               CASE WHEN ob.order_subtotal > 0 AND ibt.quantity > 0 AND bag_tt."packageDaysCount" > 0
                    THEN ((o."totalAmount" * ibt.item_subtotal / ob.order_subtotal) / ibt.quantity) / bag_tt."packageDaysCount"
                    ELSE 0 END AS credit_revenue,
               (r.date - ((r."createdAt" AT TIME ZONE 'America/Lima')::date))::int AS lead_days
        FROM pool_visit_reservations r
        JOIN tickets bag ON bag.id = r."ticketId"
        JOIN orders o ON o.id = bag."orderId"
        JOIN ticket_types bag_tt ON bag_tt.id = bag."ticketTypeId"
        JOIN ticket_types slot ON slot.id = r."sourceTicketTypeId"
        JOIN events e ON e.id = bag."eventId"
        LEFT JOIN item_by_type ibt ON ibt.order_id = o.id AND ibt.ticket_type_id = bag_tt.id
        LEFT JOIN order_base ob ON ob.order_id = o.id
        LEFT JOIN courtesy_tickets ct ON ct."ticketId" = bag.id
        WHERE e.category = 'PISCINA_LIBRE'
          AND bag_tt."isPackage" = true
          AND r.status IN ('RESERVED', 'USED')
          AND o.status = 'PAID'
          AND bag.status = 'ACTIVE'
        ORDER BY r.date ASC, slot.name ASC
    `)
    bagVisitRows = bagResult.rows

    const productResult = await client.query(`
        WITH order_base AS (
            SELECT oi."orderId" AS order_id, SUM(oi.subtotal)::numeric AS order_subtotal
            FROM order_items oi
            GROUP BY oi."orderId"
        ), item_by_type AS (
            SELECT oi."orderId" AS order_id, oi."ticketTypeId" AS ticket_type_id,
                   SUM(oi.quantity)::int AS quantity, SUM(oi.subtotal)::numeric AS item_subtotal
            FROM order_items oi
            WHERE oi."ticketTypeId" IS NOT NULL
            GROUP BY oi."orderId", oi."ticketTypeId"
        )
        SELECT e.id AS event_id, e.title AS event_title, e.slug AS event_slug,
               tt.id AS ticket_type_id, tt.name AS product_name, tt."isPackage" AS is_package,
               tt."packageDaysCount" AS package_credits, tt.price AS list_price,
               o.id AS order_id, o."userId" AS buyer_id, o.provider,
               to_char(COALESCE(o."paidAt", o."createdAt") AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS paid_date,
               ibt.quantity, ibt.item_subtotal AS gross_revenue,
               CASE WHEN ob.order_subtotal > 0
                    THEN o."totalAmount" * ibt.item_subtotal / ob.order_subtotal
                    ELSE 0 END AS net_revenue
        FROM item_by_type ibt
        JOIN orders o ON o.id = ibt.order_id
        JOIN order_base ob ON ob.order_id = o.id
        JOIN ticket_types tt ON tt.id = ibt.ticket_type_id
        JOIN events e ON e.id = tt."eventId"
        WHERE e.category = 'PISCINA_LIBRE'
          AND o.status = 'PAID'
        ORDER BY COALESCE(o."paidAt", o."createdAt") ASC, e."startDate" ASC, tt."sortOrder" ASC
    `)
    productRows = productResult.rows

    await client.query("ROLLBACK")
} catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
} finally {
    await client.end()
}

if (events.length === 0) throw new Error("No PISCINA_LIBRE events found")

const asOf = limaDateTime(dbNow)
const today = asOf.slice(0, 10)
const eventById = new Map(events.map((event) => [event.id, event]))

const directByKey = new Map()
for (const raw of directVisitRows) {
    const key = `${raw.event_id}|${raw.ticket_type_id}|${raw.date_key}`
    const bucket = directByKey.get(key) || []
    bucket.push({
        status: raw.entitlement_status,
        buyerId: raw.buyer_id,
        isCourtesy: Boolean(raw.is_courtesy) || number(raw.net_revenue) === 0,
        revenue: number(raw.net_revenue),
        grossRevenue: number(raw.gross_revenue),
        leadDays: number(raw.lead_days),
    })
    directByKey.set(key, bucket)
}

const bagByKey = new Map()
for (const raw of bagVisitRows) {
    const key = `${raw.event_id}|${raw.ticket_type_id}|${raw.date_key}`
    const bucket = bagByKey.get(key) || []
    bucket.push({
        status: raw.reservation_status,
        buyerId: raw.buyer_id,
        isCourtesy: Boolean(raw.is_courtesy) || number(raw.credit_revenue) === 0,
        revenue: number(raw.credit_revenue),
        leadDays: number(raw.lead_days),
        packageName: raw.package_name,
    })
    bagByKey.set(key, bucket)
}

const allRows = inventoryRows.map((raw) => {
    const key = `${raw.event_id}|${raw.ticket_type_id}|${raw.date_key}`
    const direct = directByKey.get(key) || []
    const bag = bagByKey.get(key) || []
    const buyerIds = new Set([...direct.map((visit) => visit.buyerId), ...bag.map((visit) => visit.buyerId)])
    const directVisits = direct.length
    const bagVisits = bag.length
    const occupied = directVisits + bagVisits
    const attended = direct.filter((visit) => visit.status === "USED").length + bag.filter((visit) => visit.status === "USED").length
    const courtesyVisits = direct.filter((visit) => visit.isCourtesy).length + bag.filter((visit) => visit.isCourtesy).length
    const leadDays = [...direct.map((visit) => visit.leadDays), ...bag.map((visit) => visit.leadDays)].filter((days) => days >= 0)
    return {
        eventId: raw.event_id,
        eventTitle: raw.event_title,
        eventSlug: raw.event_slug,
        ticketTypeId: raw.ticket_type_id,
        horario: raw.horario,
        date: raw.date_key,
        weekday: weekday(raw.date_key),
        capacity: number(raw.capacity),
        inventorySold: number(raw.inventory_sold),
        isEnabled: Boolean(raw.is_enabled),
        ticketActive: Boolean(raw.ticket_active),
        listPrice: number(raw.list_price),
        directVisits,
        bagVisits,
        occupied,
        attended,
        courtesyVisits,
        paidVisits: occupied - courtesyVisits,
        attributedRevenue: [...direct, ...bag].reduce((sum, visit) => sum + visit.revenue, 0),
        buyerIds,
        medianLeadDays: median(leadDays),
        inventoryDifference: number(raw.inventory_sold) - occupied,
    }
})

const completedOfferedRows = allRows.filter((row) => row.date < today && row.isEnabled && row.capacity > 0)
const futureOfferedRows = allRows.filter((row) => row.date >= today && row.isEnabled && row.capacity > 0)
const excludedClosedRows = allRows.filter((row) => row.date < today && !row.isEnabled && row.capacity > 0)
const excludedDemand = excludedClosedRows.reduce((sum, row) => sum + row.occupied, 0)

const historicalTotals = aggregateRows(completedOfferedRows)
const futureTotals = aggregateRows(futureOfferedRows)

const byHour = groupRows(completedOfferedRows, (row) => row.horario, (row) => ({ horario: row.horario }))
    .sort((a, b) => a.occupancy - b.occupancy || a.avgVisitsPerDay - b.avgVisitsPerDay || sortHour(a, b))

const byWeekday = groupRows(completedOfferedRows, (row) => row.weekday, (row) => ({ dia: row.weekday }))
    .sort((a, b) => a.occupancy - b.occupancy || (weekdayOrder.get(a.dia) ?? 99) - (weekdayOrder.get(b.dia) ?? 99))

const byDayHour = groupRows(
    completedOfferedRows,
    (row) => `${row.weekday}|${row.horario}`,
    (row) => ({ dia: row.weekday, horario: row.horario })
).sort((a, b) => a.occupancy - b.occupancy || a.avgVisitsPerSlot - b.avgVisitsPerSlot || sortHour(a, b))

const byDate = groupRows(
    completedOfferedRows,
    (row) => `${row.eventId}|${row.date}`,
    (row) => ({ eventId: row.eventId, evento: row.eventTitle, fecha: row.date, dia: row.weekday })
).sort((a, b) => a.occupancy - b.occupancy || a.occupied - b.occupied || a.fecha.localeCompare(b.fecha))

const byEventHour = groupRows(
    completedOfferedRows,
    (row) => `${row.eventId}|${row.horario}`,
    (row) => ({ eventId: row.eventId, evento: row.eventTitle, horario: row.horario })
).sort((a, b) => a.evento.localeCompare(b.evento, "es") || a.occupancy - b.occupancy || sortHour(a, b))

const byEventWeekday = groupRows(
    completedOfferedRows,
    (row) => `${row.eventId}|${row.weekday}`,
    (row) => ({ eventId: row.eventId, evento: row.eventTitle, dia: row.weekday })
).sort((a, b) => a.evento.localeCompare(b.evento, "es") || (weekdayOrder.get(a.dia) ?? 99) - (weekdayOrder.get(b.dia) ?? 99))

const productGroups = new Map()
for (const raw of productRows) {
    const key = `${raw.event_id}|${raw.ticket_type_id}`
    const current = productGroups.get(key) || {
        eventId: raw.event_id,
        evento: raw.event_title,
        producto: raw.product_name,
        isPackage: Boolean(raw.is_package),
        packageCredits: number(raw.package_credits),
        listPrice: number(raw.list_price),
        quantity: 0,
        grossRevenue: 0,
        netRevenue: 0,
        orders: new Set(),
        buyers: new Set(),
    }
    current.quantity += number(raw.quantity)
    current.grossRevenue += number(raw.gross_revenue)
    current.netRevenue += number(raw.net_revenue)
    current.orders.add(raw.order_id)
    current.buyers.add(raw.buyer_id)
    productGroups.set(key, current)
}

const productSummary = Array.from(productGroups.values()).map((row) => ({
    ...row,
    ordersCount: row.orders.size,
    buyersCount: row.buyers.size,
    discount: row.grossRevenue - row.netRevenue,
    averageNetPrice: ratio(row.netRevenue, row.quantity),
})).sort((a, b) => a.evento.localeCompare(b.evento, "es") || Number(a.isPackage) - Number(b.isPackage) || b.netRevenue - a.netRevenue)

const eventSales = events.map((event) => {
    const products = productSummary.filter((row) => row.eventId === event.id)
    const orderIds = new Set()
    const buyerIds = new Set()
    for (const raw of productRows.filter((row) => row.event_id === event.id)) {
        orderIds.add(raw.order_id)
        buyerIds.add(raw.buyer_id)
    }
    const quantity = products.reduce((sum, row) => sum + row.quantity, 0)
    const packageQuantity = products.filter((row) => row.isPackage).reduce((sum, row) => sum + row.quantity, 0)
    const grossRevenue = products.reduce((sum, row) => sum + row.grossRevenue, 0)
    const netRevenue = products.reduce((sum, row) => sum + row.netRevenue, 0)
    const packageRevenue = products.filter((row) => row.isPackage).reduce((sum, row) => sum + row.netRevenue, 0)
    const visitRows = completedOfferedRows.filter((row) => row.eventId === event.id)
    return {
        eventId: event.id,
        evento: event.title,
        periodo: `${event.start_date} a ${event.end_date}`,
        products: quantity,
        packageQuantity,
        orders: orderIds.size,
        buyers: buyerIds.size,
        grossRevenue,
        netRevenue,
        discount: grossRevenue - netRevenue,
        packageRevenue,
        averageOrder: ratio(netRevenue, orderIds.size),
        ...aggregateRows(visitRows),
    }
})

const allOrderIds = new Set(productRows.map((row) => row.order_id))
const buyerOrders = new Map()
for (const raw of productRows) {
    const orders = buyerOrders.get(raw.buyer_id) || new Set()
    orders.add(raw.order_id)
    buyerOrders.set(raw.buyer_id, orders)
}
const uniqueBuyers = buyerOrders.size
const repeatBuyers = Array.from(buyerOrders.values()).filter((orders) => orders.size >= 2).length
const totalGrossRevenue = productSummary.reduce((sum, row) => sum + row.grossRevenue, 0)
const totalNetRevenue = productSummary.reduce((sum, row) => sum + row.netRevenue, 0)
const totalPackageRevenue = productSummary.filter((row) => row.isPackage).reduce((sum, row) => sum + row.netRevenue, 0)

const paidPackageCreditsSold = productSummary
    .filter((row) => row.isPackage && row.netRevenue > 0)
    .reduce((sum, row) => sum + row.quantity * row.packageCredits, 0)
const freePackageCreditsIssued = productSummary
    .filter((row) => row.isPackage && row.netRevenue === 0)
    .reduce((sum, row) => sum + row.quantity * row.packageCredits, 0)
const paidBagReservations = bagVisitRows.filter((row) => number(row.credit_revenue) > 0).length
const freeBagReservations = bagVisitRows.length - paidBagReservations
const unusedPaidPackageCredits = Math.max(0, paidPackageCreditsSold - paidBagReservations)

const directLeadDays = directVisitRows.map((row) => number(row.lead_days)).filter((days) => days >= 0)
const bagLeadDays = bagVisitRows.map((row) => number(row.lead_days)).filter((days) => days >= 0)

const matchedPeriod = eventSales.map((eventSale) => {
    const event = eventById.get(eventSale.eventId)
    const rows = completedOfferedRows.filter((row) => row.eventId === event.id && dayOfMonth(row.date) <= 16)
    return { evento: event.title, ...aggregateRows(rows) }
})

const benchmarkByDayHour = new Map(byDayHour.map((row) => [row.key, row]))
const opportunityRows = futureOfferedRows.filter((row) => row.date > today).map((row) => {
    const benchmark = benchmarkByDayHour.get(`${row.weekday}|${row.horario}`)
    const currentRate = ratio(row.occupied, row.capacity)
    const historicalRate = benchmark?.occupancy || 0
    const isHistoricallyWeak = !benchmark || benchmark.occupancy < TARGET_OCCUPANCY
    const targetVisits = Math.ceil(row.capacity * TARGET_OCCUPANCY)
    const incrementalVisits = isHistoricallyWeak ? Math.max(0, targetVisits - row.occupied) : 0
    return {
        ...row,
        currentRate,
        historicalRate,
        historicalDays: benchmark?.days || 0,
        incrementalVisits,
        potentialRevenue: incrementalVisits * row.listPrice,
    }
}).filter((row) => row.incrementalVisits > 0)

const opportunityByDayHour = groupRows(
    opportunityRows,
    (row) => `${row.weekday}|${row.horario}`,
    (row) => ({ dia: row.weekday, horario: row.horario, listPrice: row.listPrice, historicalRate: row.historicalRate })
).map((group) => ({
    ...group,
    futureDates: group.rows.length,
    currentBookings: group.occupied,
    incrementalVisits: group.rows.reduce((sum, row) => sum + row.incrementalVisits, 0),
    potentialRevenue: group.rows.reduce((sum, row) => sum + row.potentialRevenue, 0),
})).sort((a, b) => b.potentialRevenue - a.potentialRevenue || a.historicalRate - b.historicalRate)

const totalOpportunityVisits = opportunityRows.reduce((sum, row) => sum + row.incrementalVisits, 0)
const totalOpportunityRevenue = opportunityRows.reduce((sum, row) => sum + row.potentialRevenue, 0)
const promotionalOpportunityRevenue = totalOpportunityRevenue * 0.85

const strongestHours = [...byHour].filter((row) => row.days >= 3).sort((a, b) => b.occupancy - a.occupancy || b.avgVisitsPerDay - a.avgVisitsPerDay).slice(0, 5)
const weakestHours = byHour.filter((row) => row.days >= 3).slice(0, 8)
const weakestDays = byWeekday.slice(0, 4)
const weakDayHours = byDayHour.filter((row) => row.days >= 2 && row.occupancy < TARGET_OCCUPANCY).slice(0, 15)

const detailedRows = allRows.map((row) => ({
    evento: row.eventTitle,
    fecha: row.date,
    dia: row.weekday,
    horario: row.horario,
    capacidad: row.capacity,
    habilitado: row.isEnabled ? "SI" : "NO",
    vendidos_inventario: row.inventorySold,
    entradas_directas: row.directVisits,
    reservas_bolsa: row.bagVisits,
    visitas_ocupadas: row.occupied,
    visitas_asistidas: row.attended,
    cortesias_o_valor_cero: row.courtesyVisits,
    ocupacion_pct: round(ratio(row.occupied, row.capacity) * 100, 1),
    ingreso_atribuido: round(row.attributedRevenue),
    tarifa_lista: row.listPrice,
    anticipacion_mediana_dias: row.medianLeadDays,
    diferencia_inventario_vs_demanda: row.inventoryDifference,
})).sort((a, b) => a.evento.localeCompare(b.evento, "es") || a.fecha.localeCompare(b.fecha) || sortHour(a, b))

const hourExport = byHour.map((row) => ({
    horario: row.horario,
    clasificacion: rating(row.occupancy),
    dias_ofrecidos: row.days,
    capacidad: row.capacity,
    visitas_ocupadas: row.occupied,
    directas: row.directVisits,
    bolsa: row.bagVisits,
    visitas_por_dia: round(row.avgVisitsPerDay, 1),
    ocupacion_pct: round(row.occupancy * 100, 1),
    asistencia_registrada_pct: round(row.scanRate * 100, 1),
    turnos_en_cero_pct: round(row.zeroRate * 100, 1),
    ingreso_atribuido: round(row.attributedRevenue),
    ingreso_por_visita: round(row.revenuePerVisit),
}))

const weekdayExport = byWeekday.map((row) => ({
    dia: row.dia,
    clasificacion: rating(row.occupancy),
    fechas: row.days,
    turnos_ofrecidos: row.openSlots,
    capacidad: row.capacity,
    visitas_ocupadas: row.occupied,
    visitas_por_fecha: round(row.avgVisitsPerDay, 1),
    ocupacion_pct: round(row.occupancy * 100, 1),
    asistencia_registrada_pct: round(row.scanRate * 100, 1),
    ingreso_atribuido: round(row.attributedRevenue),
}))

const dayHourExport = byDayHour.map((row) => ({
    dia: row.dia,
    horario: row.horario,
    clasificacion: rating(row.occupancy),
    ocurrencias: row.openSlots,
    capacidad: row.capacity,
    visitas_ocupadas: row.occupied,
    promedio_por_turno: round(row.avgVisitsPerSlot, 1),
    ocupacion_pct: round(row.occupancy * 100, 1),
    turnos_en_cero_pct: round(row.zeroRate * 100, 1),
    ingreso_atribuido: round(row.attributedRevenue),
})).sort((a, b) => (weekdayOrder.get(a.dia) ?? 99) - (weekdayOrder.get(b.dia) ?? 99) || sortHour(a, b))

const dateExport = byDate.map((row) => ({
    evento: row.evento,
    fecha: row.fecha,
    dia: row.dia,
    turnos_ofrecidos: row.openSlots,
    capacidad: row.capacity,
    visitas_ocupadas: row.occupied,
    directas: row.directVisits,
    bolsa: row.bagVisits,
    ocupacion_pct: round(row.occupancy * 100, 1),
    asistencia_registrada_pct: round(row.scanRate * 100, 1),
    ingreso_atribuido: round(row.attributedRevenue),
})).sort((a, b) => a.fecha.localeCompare(b.fecha))

const productExport = productSummary.map((row) => ({
    evento: row.evento,
    producto: row.producto,
    tipo: row.isPackage ? `Bolsa ${row.packageCredits} visitas` : "Entrada directa",
    unidades: row.quantity,
    pedidos: row.ordersCount,
    compradores: row.buyersCount,
    tarifa_lista: row.listPrice,
    ingreso_bruto_lista: round(row.grossRevenue),
    descuentos: round(row.discount),
    ingreso_efectivo: round(row.netRevenue),
    precio_medio_efectivo: round(row.averageNetPrice),
}))

const opportunityExport = opportunityByDayHour.map((row) => ({
    dia: row.dia,
    horario: row.horario,
    fechas_futuras_abiertas: row.futureDates,
    capacidad_futura: row.capacity,
    reservas_actuales: row.currentBookings,
    ocupacion_historica_pct: round(row.historicalRate * 100, 1),
    objetivo_pct: TARGET_OCCUPANCY * 100,
    visitas_incrementales_objetivo: row.incrementalVisits,
    tarifa_lista: row.listPrice,
    ingreso_incremental_potencial: round(row.potentialRevenue),
}))

const validationRows = [
    { control: "Eventos incluidos", valor: events.length, interpretacion: "Todos los eventos PISCINA_LIBRE de produccion" },
    { control: "Filas fecha-horario en inventario", valor: allRows.length, interpretacion: "Universo disponible" },
    { control: "Filas cerradas excluidas", valor: excludedClosedRows.length, interpretacion: "No se usan para medir debilidad comercial" },
    { control: "Demanda en filas cerradas excluidas", valor: excludedDemand, interpretacion: "Revisar si corresponde a reprogramaciones" },
    { control: "Diferencia absoluta inventario vs demanda", valor: allRows.reduce((sum, row) => sum + Math.abs(row.inventoryDifference), 0), interpretacion: "Debe ser baja; incluye efectos operativos/cancelaciones" },
    { control: "Mediana anticipacion entrada directa (dias)", valor: median(directLeadDays), interpretacion: "Pago a fecha de visita" },
    { control: "Mediana anticipacion reserva de bolsa (dias)", valor: median(bagLeadDays), interpretacion: "Reserva a fecha de visita" },
]

const outDir = path.join(repoRoot, "scripts", "out")
fs.mkdirSync(outDir, { recursive: true })
const stamp = filenameTimestamp(dbNow)
const base = `reporte-comercial-piscina-libre-${stamp}`
const markdownPath = path.join(outDir, `${base}.md`)
const xlsxPath = path.join(outDir, `${base}.xlsx`)
const detailCsvPath = path.join(outDir, `${base}-detalle.csv`)

const markdown = []
markdown.push("# Reporte comercial detallado - Piscina Libre")
markdown.push("")
markdown.push(`Corte: ${asOf} (America/Lima)`)
markdown.push(`Fuente: base de datos de produccion (${envFile}).`)
markdown.push("")
markdown.push("## Resumen ejecutivo")
markdown.push("")
markdown.push(markdownTable(
    ["Indicador", "Resultado"],
    [
        ["Ingreso efectivo acumulado", money(totalNetRevenue)],
        ["Ingreso a tarifa de lista", money(totalGrossRevenue)],
        ["Descuentos aplicados", money(totalGrossRevenue - totalNetRevenue)],
        ["Pedidos pagados", allOrderIds.size],
        ["Compradores unicos", uniqueBuyers],
        ["Compradores con 2+ pedidos", `${repeatBuyers} (${pct(ratio(repeatBuyers, uniqueBuyers))})`],
        ["Visitas en horarios ofrecidos y ya cerrados", historicalTotals.occupied],
        ["Ocupacion historica", pct(historicalTotals.occupancy)],
        ["Asistencia registrada sobre visitas", pct(historicalTotals.scanRate)],
        ["Ingreso por bolsas", `${money(totalPackageRevenue)} (${pct(ratio(totalPackageRevenue, totalNetRevenue))})`],
        ["Creditos de bolsa pagados / aun no reservados", `${paidPackageCreditsSold} / ${unusedPaidPackageCredits}`],
        ["Pases gratuitos emitidos / reservados", `${freePackageCreditsIssued} / ${freeBagReservations}`],
        ["Oportunidad minima desde manana al 15%", `${totalOpportunityVisits} visitas; ${money(promotionalOpportunityRevenue)}-${money(totalOpportunityRevenue)}`],
    ]
))

markdown.push("### Lectura principal")
markdown.push("")
markdown.push(`La ocupacion historica de los horarios efectivamente ofrecidos es ${pct(historicalTotals.occupancy)}. El problema comercial no es uniforme: los horarios mas debiles concentran turnos en cero y baja ocupacion, mientras que los horarios fuertes demuestran demanda que puede redirigirse.`)
markdown.push(`El objetivo cuantificado de corto plazo usa un umbral conservador de ${pct(TARGET_OCCUPANCY, 0)}: llevar solo las combinaciones historicamente debiles desde manana a ese nivel representaria hasta ${totalOpportunityVisits} visitas adicionales y entre ${money(promotionalOpportunityRevenue)} con 15% de descuento y ${money(totalOpportunityRevenue)} a tarifa actual. Es una meta de capacidad, no un pronostico garantizado.`)
markdown.push("")

markdown.push("## Ingresos y clientes por evento")
markdown.push("")
markdown.push(markdownTable(
    ["Evento", "Periodo", "Unidades", "Pedidos", "Compradores", "Ingreso efectivo", "Descuentos", "Ticket medio"],
    eventSales.map((row) => [row.evento, row.periodo, row.products, row.orders, row.buyers, money(row.netRevenue), money(row.discount), money(row.averageOrder)])
))

markdown.push("## Comparacion operativa: dias 1 al 16")
markdown.push("")
markdown.push("Se compara el mismo tramo calendario para no enfrentar junio completo contra julio parcial. Solo se incluyen horarios habilitados con capacidad.")
markdown.push("")
markdown.push(markdownTable(
    ["Evento", "Fechas", "Visitas", "Capacidad", "Ocupacion", "Visitas/fecha", "Ingreso atribuido"],
    matchedPeriod.map((row) => [row.evento, row.days, row.occupied, row.capacity, pct(row.occupancy), row.avgVisitsPerDay.toFixed(1), money(row.attributedRevenue)])
))
if (matchedPeriod.length >= 2 && matchedPeriod[0].occupied > 0) {
    const visitChange = ratio(matchedPeriod[1].occupied - matchedPeriod[0].occupied, matchedPeriod[0].occupied)
    const revenueChange = ratio(matchedPeriod[1].attributedRevenue - matchedPeriod[0].attributedRevenue, matchedPeriod[0].attributedRevenue)
    markdown.push(`En el tramo comparable, julio mejora ${pct(visitChange)} en visitas y ${pct(revenueChange)} en ingreso atribuido frente a junio; la ocupacion sube ${((matchedPeriod[1].occupancy - matchedPeriod[0].occupancy) * 100).toFixed(1)} puntos porcentuales.`)
    markdown.push("")
}

markdown.push("## Horarios mas debiles")
markdown.push("")
markdown.push(markdownTable(
    ["Horario", "Nivel", "Dias", "Visitas", "Prom./dia", "Ocupacion", "Turnos en cero", "Ingreso/visita"],
    weakestHours.map((row) => [row.horario, rating(row.occupancy), row.days, row.occupied, row.avgVisitsPerDay.toFixed(1), pct(row.occupancy), pct(row.zeroRate), money(row.revenuePerVisit)])
))

markdown.push("### Horarios fuertes que pueden alimentar los debiles")
markdown.push("")
markdown.push(markdownTable(
    ["Horario", "Dias", "Visitas", "Prom./dia", "Ocupacion"],
    strongestHours.map((row) => [row.horario, row.days, row.occupied, row.avgVisitsPerDay.toFixed(1), pct(row.occupancy)])
))

markdown.push("## Dias de la semana mas debiles")
markdown.push("")
markdown.push(markdownTable(
    ["Dia", "Nivel", "Fechas", "Visitas", "Visitas/fecha", "Ocupacion", "Ingreso atribuido"],
    weakestDays.map((row) => [row.dia, rating(row.occupancy), row.days, row.occupied, row.avgVisitsPerDay.toFixed(1), pct(row.occupancy), money(row.attributedRevenue)])
))

markdown.push("## Combinaciones dia + horario de prioridad comercial")
markdown.push("")
markdown.push(markdownTable(
    ["Dia", "Horario", "Nivel", "Ocurrencias", "Visitas", "Prom./turno", "Ocupacion", "Turnos en cero"],
    weakDayHours.map((row) => [row.dia, row.horario, rating(row.occupancy), row.openSlots, row.occupied, row.avgVisitsPerSlot.toFixed(1), pct(row.occupancy), pct(row.zeroRate)])
))

markdown.push("## Fechas cerradas mas debiles (ajustadas por capacidad)")
markdown.push("")
markdown.push("Se excluyen horarios deshabilitados/cierres operativos. El ranking usa ocupacion, no solo cantidad absoluta.")
markdown.push("")
markdown.push(markdownTable(
    ["Fecha", "Dia", "Evento", "Turnos", "Visitas", "Capacidad", "Ocupacion", "Ingreso atribuido"],
    byDate.slice(0, 12).map((row) => [row.fecha, row.dia, row.evento, row.openSlots, row.occupied, row.capacity, pct(row.occupancy), money(row.attributedRevenue)])
))

markdown.push("## Oportunidad inmediata en fechas abiertas")
markdown.push("")
markdown.push(`Solo muestra combinaciones con desempeno historico menor a ${pct(TARGET_OCCUPANCY, 0)} y faltante para alcanzar ese minimo en las fechas actualmente abiertas.`)
markdown.push("")
markdown.push(markdownTable(
    ["Dia", "Horario", "Fechas", "Ocupacion historica", "Reservas actuales", "Visitas meta adicionales", "Ingreso potencial"],
    opportunityByDayHour.slice(0, 15).map((row) => [row.dia, row.horario, row.futureDates, pct(row.historicalRate), row.currentBookings, row.incrementalVisits, money(row.potentialRevenue)])
))

markdown.push("## Acciones comerciales recomendadas")
markdown.push("")
markdown.push("1. **Lanzar una tarifa Hora Valle, limitada y medible.** Aplicarla solo a las combinaciones CRITICO/DEBIL, con 10%-15% de descuento o un paquete de 3 visitas. No descontar horarios FUERTE. Medir ingreso incremental y no solo entradas.")
markdown.push("2. **Redirigir demanda desde horarios fuertes.** Cuando un turno fuerte alcance 70% de su capacidad, mostrar primero la alternativa debil mas cercana con un beneficio pequeno (por ejemplo, invitado o credito), protegiendo el precio del horario pico.")
markdown.push("3. **Campana segmentada por rutina.** Ofrecer manana media a trabajadores remotos, adultos mayores y vecinos; y mediodia a oficinas/instituciones cercanas. La creatividad debe vender rapidez, carril disponible y menor congestion, no solo descuento.")
markdown.push("4. **Bolsa exclusiva para horas valle.** Crear una bolsa con vigencia corta y reserva solo en horarios debiles. Cobra por adelantado y evita canibalizar horas fuertes. Controlar que el ingreso por visita no quede por debajo del costo variable.")
markdown.push(`5. **Activar los ${unusedPaidPackageCredits} creditos pagados pero no reservados.** Recordatorios por WhatsApp/email pueden llenar horas valle, aunque esto mejora uso y retencion mas que caja inmediata. Usar enlace directo a la reserva del horario recomendado.`)
markdown.push(`6. **Automatizar recuperacion de turnos vacios.** La mediana de compra directa es ${median(directLeadDays)} dias: enviar una campana 24-48 horas antes y una oferta de ultimo minuto el mismo dia solo si la ocupacion proyectada sigue debajo del 15%.`)
markdown.push("7. **Ejecutar un experimento de 4 semanas.** Semana 1 control; semanas 2-3 dos ofertas distintas; semana 4 repetir la ganadora. KPI primario: ingreso neto por capacidad disponible. KPI secundarios: visitas incrementales, conversion, recompra y asistencia.")
markdown.push("")

markdown.push("## Plan de ejecucion 30 dias")
markdown.push("")
markdown.push(markdownTable(
    ["Plazo", "Accion", "KPI", "Regla de decision"],
    [
        ["0-3 dias", "Configurar tablero por dia-horario y lista de horas valle", "Linea base de ingreso y ocupacion", "No lanzar promociones sin grupo control"],
        ["4-10 dias", "Hora Valle + remarketing de compradores", "Ingreso neto incremental", "Continuar si supera control por 10%"],
        ["11-20 dias", "Bolsa valle y redireccion desde picos", "Venta anticipada y uso por franja", "Detener si canibaliza horas fuertes"],
        ["21-30 dias", "Escalar oferta ganadora y alianzas cercanas", "Recompra y ticket medio", "Escalar solo segmentos rentables"],
    ]
))

markdown.push("## Metodologia y limites")
markdown.push("")
markdown.push("- Demanda por horario = entradas directas ACTIVE de ordenes PAID + reservas de bolsa RESERVED/USED.")
markdown.push("- Ingreso efectivo = total pagado asignado proporcionalmente a cada producto, despues de descuentos. El ingreso por visita de bolsa se distribuye por cantidad de creditos del paquete.")
markdown.push("- Los cierres operativos (inventario deshabilitado) se excluyen del ranking de debilidad, aunque se conservan en el detalle y la validacion.")
markdown.push("- Asistencia significa uso registrado en el sistema; si hubo ingresos sin escaneo, la tasa observada subestima la asistencia real.")
markdown.push("- El potencial al 15% es una brecha de capacidad a tarifa vigente, no una proyeccion causal. Debe validarse con experimento y margen.")
markdown.push("")

fs.writeFileSync(markdownPath, `${markdown.join("\n")}\n`, "utf8")
writeCsv(detailCsvPath, detailedRows)

const XLSX = await import("xlsx")
const workbook = XLSX.utils.book_new()

function appendSheet(name, rows, widths = {}) {
    const sheet = rows.length > 0 ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["Sin datos"]])
    const headers = rows.length > 0 ? Object.keys(rows[0]) : ["Sin datos"]
    sheet["!cols"] = headers.map((header) => ({ wch: widths[header] || Math.min(42, Math.max(12, header.length + 2)) }))
    if (rows.length > 0) sheet["!autofilter"] = { ref: sheet["!ref"] }
    XLSX.utils.book_append_sheet(workbook, sheet, name)
}

appendSheet("Resumen", [
    { indicador: "Corte Lima", valor: asOf },
    { indicador: "Ingreso efectivo acumulado", valor: round(totalNetRevenue) },
    { indicador: "Ingreso tarifa lista", valor: round(totalGrossRevenue) },
    { indicador: "Descuentos", valor: round(totalGrossRevenue - totalNetRevenue) },
    { indicador: "Pedidos pagados", valor: allOrderIds.size },
    { indicador: "Compradores unicos", valor: uniqueBuyers },
    { indicador: "Compradores con recompra", valor: repeatBuyers },
    { indicador: "Visitas historicas ofrecidas", valor: historicalTotals.occupied },
    { indicador: "Ocupacion historica %", valor: round(historicalTotals.occupancy * 100, 1) },
    { indicador: "Asistencia registrada %", valor: round(historicalTotals.scanRate * 100, 1) },
    { indicador: "Creditos de bolsa pagados", valor: paidPackageCreditsSold },
    { indicador: "Creditos pagados no reservados", valor: unusedPaidPackageCredits },
    { indicador: "Pases gratuitos emitidos", valor: freePackageCreditsIssued },
    { indicador: "Pases gratuitos reservados", valor: freeBagReservations },
    { indicador: "Visitas potenciales al 15%", valor: totalOpportunityVisits },
    { indicador: "Ingreso potencial al 15%", valor: round(totalOpportunityRevenue) },
    { indicador: "Ingreso potencial con 15% dscto", valor: round(promotionalOpportunityRevenue) },
], { indicador: 42, valor: 22 })
appendSheet("Por horario", hourExport, { horario: 18, clasificacion: 14 })
appendSheet("Por dia", weekdayExport, { dia: 14, clasificacion: 14 })
appendSheet("Dia-horario", dayHourExport, { dia: 14, horario: 18, clasificacion: 14 })
appendSheet("Por evento-horario", byEventHour.map((row) => ({
    evento: row.evento,
    horario: row.horario,
    dias: row.days,
    capacidad: row.capacity,
    visitas: row.occupied,
    promedio_dia: round(row.avgVisitsPerDay, 1),
    ocupacion_pct: round(row.occupancy * 100, 1),
    ingreso_atribuido: round(row.attributedRevenue),
})), { evento: 52, horario: 18 })
appendSheet("Por evento-dia", byEventWeekday.map((row) => ({
    evento: row.evento,
    dia: row.dia,
    fechas: row.days,
    capacidad: row.capacity,
    visitas: row.occupied,
    promedio_fecha: round(row.avgVisitsPerDay, 1),
    ocupacion_pct: round(row.occupancy * 100, 1),
    ingreso_atribuido: round(row.attributedRevenue),
})), { evento: 52, dia: 14 })
appendSheet("Por fecha", dateExport, { evento: 52, fecha: 14, dia: 14 })
appendSheet("Ventas producto", productExport, { evento: 52, producto: 30, tipo: 20 })
appendSheet("Oportunidad futura", opportunityExport, { dia: 14, horario: 18 })
appendSheet("Detalle", detailedRows, { evento: 52, fecha: 14, dia: 14, horario: 18 })
appendSheet("Validacion", validationRows, { control: 46, valor: 18, interpretacion: 58 })
appendSheet("Metodologia", [
    { tema: "Demanda", definicion: "Entradas directas ACTIVE/PAID + reservas de bolsa RESERVED/USED" },
    { tema: "Horario ofrecido", definicion: "Inventario habilitado y capacidad mayor que cero" },
    { tema: "Ingreso efectivo", definicion: "Monto pagado despues de descuentos, asignado proporcionalmente al producto" },
    { tema: "Ingreso por visita de bolsa", definicion: "Precio efectivo de la bolsa dividido entre sus creditos" },
    { tema: "Asistencia", definicion: "Entitlement o reserva con estado USED" },
    { tema: "Debil", definicion: "Ocupacion historica menor a 15%" },
    { tema: "Potencial", definicion: "Brecha a 15% por tarifa de lista; no es pronostico garantizado" },
], { tema: 28, definicion: 90 })

XLSX.writeFile(workbook, xlsxPath)

console.log(`Reporte Markdown: ${relativePath(markdownPath)}`)
console.log(`Reporte Excel: ${relativePath(xlsxPath)}`)
console.log(`Detalle CSV: ${relativePath(detailCsvPath)}`)
console.log(`Corte Lima: ${asOf}`)
console.log(`Eventos: ${events.length}`)
console.log(`Ingreso efectivo: ${money(totalNetRevenue)}`)
console.log(`Visitas historicas ofrecidas: ${historicalTotals.occupied}`)
console.log(`Ocupacion historica: ${pct(historicalTotals.occupancy)}`)
console.log(`Oportunidad al 15%: ${totalOpportunityVisits} visitas / ${money(totalOpportunityRevenue)}`)
