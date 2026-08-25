import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import crypto from "node:crypto"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const EVENT_SLUG = "piscina-libre-julio-2026-1hr-campo-de-marte-fdnda"
const SLOT_NAMES = ["19:00 - 20:00", "20:00 - 21:00"]
const DATE_FROM = "2026-07-01"
const DATE_TO = "2026-07-31"

const args = new Set(process.argv.slice(2))
const APPLY = args.has("--apply") || process.env.APPLY === "true"
const envFile = process.env.ENV_FILE || ".env.production"

function readDatabaseUrl() {
    const raw = fs.readFileSync(path.join(repoRoot, envFile), "utf8")
    const match = raw.match(/^DATABASE_URL="?([^"\n]+)"?/m)
    if (!match) throw new Error(`DATABASE_URL not found in ${envFile}`)
    return match[1]
}

function timestampForFile(value = new Date()) {
    return value.toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

function maskConnectionString(connectionString) {
    return connectionString.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@").split("?")[0]
}

function* dateRange(from, to) {
    const current = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T00:00:00Z`)
    while (current <= end) {
        yield current.toISOString().slice(0, 10)
        current.setUTCDate(current.getUTCDate() + 1)
    }
}

function csvEscape(value) {
    const text = String(value ?? "")
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
}

function writeCsv(filePath, rows) {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : []
    const lines = [
        headers.map(csvEscape).join(","),
        ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
    ]
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8")
}

function preferredName(row) {
    return row.comprador || row.usuario || row.asistente || ""
}

function preferredEmail(row) {
    return row.correo || row.correo_usuario || ""
}

function preferredPhone(row) {
    return row.telefono || row.telefono_usuario || ""
}

function preferredDoc(row) {
    return row.documento || row.documento_usuario || ""
}

function groupContacts(rows) {
    const groups = new Map()
    for (const row of rows.filter((r) => r.requiere_aviso === "SI")) {
        const email = preferredEmail(row).toLowerCase()
        const phone = preferredPhone(row)
        const doc = preferredDoc(row)
        const name = preferredName(row)
        const key = email || phone || doc || name || row.order_id
        const current = groups.get(key) || {
            comprador: name,
            correo: preferredEmail(row),
            telefono: phone,
            documento: doc,
            cantidad_afectada: 0,
            fechas_horarios: new Set(),
            pedidos: new Set(),
            codigos_o_reservas: new Set(),
        }
        current.cantidad_afectada += 1
        current.fechas_horarios.add(`${row.fecha} ${row.horario}`)
        current.pedidos.add(row.order_id)
        current.codigos_o_reservas.add(row.codigo_ticket || row.reserva_id)
        groups.set(key, current)
    }

    return Array.from(groups.values())
        .map((row) => ({
            comprador: row.comprador,
            correo: row.correo,
            telefono: row.telefono,
            documento: row.documento,
            cantidad_afectada: row.cantidad_afectada,
            fechas_horarios: Array.from(row.fechas_horarios).sort().join(" | "),
            pedidos: Array.from(row.pedidos).sort().join(" | "),
            codigos_o_reservas: Array.from(row.codigos_o_reservas).sort().join(" | "),
        }))
        .sort((a, b) => a.comprador.localeCompare(b.comprador, "es") || a.correo.localeCompare(b.correo, "es"))
}

async function fetchEventAndSlots(client) {
    const eventResult = await client.query(
        `
        SELECT id, title, slug, to_char("startDate", 'YYYY-MM-DD') AS start_date,
               to_char("endDate", 'YYYY-MM-DD') AS end_date
        FROM events
        WHERE slug = $1 AND category = 'PISCINA_LIBRE'
        `,
        [EVENT_SLUG]
    )
    if (eventResult.rows.length !== 1) {
        throw new Error(`Expected one PISCINA_LIBRE event for ${EVENT_SLUG}; found ${eventResult.rows.length}`)
    }

    const event = eventResult.rows[0]
    const slotResult = await client.query(
        `
        SELECT id, name, capacity, sold, "isActive"
        FROM ticket_types
        WHERE "eventId" = $1 AND name = ANY($2::text[])
        ORDER BY name ASC
        `,
        [event.id, SLOT_NAMES]
    )

    const foundNames = new Set(slotResult.rows.map((row) => row.name))
    const missing = SLOT_NAMES.filter((name) => !foundNames.has(name))
    if (missing.length > 0) {
        throw new Error(`Missing slot ticket types: ${missing.join(", ")}`)
    }

    return { event, slots: slotResult.rows }
}

async function fetchInventory(client, slotIds, dates) {
    const result = await client.query(
        `
        SELECT "ticketTypeId" AS ticket_type_id,
               to_char("date", 'YYYY-MM-DD') AS fecha,
               capacity,
               sold,
               "isEnabled" AS is_enabled
        FROM ticket_type_date_inventories
        WHERE "ticketTypeId" = ANY($1::text[])
          AND "date" BETWEEN $2::date AND $3::date
        ORDER BY "date" ASC
        `,
        [slotIds, dates[0], dates[dates.length - 1]]
    )
    return result.rows
}

async function fetchTodayLima(client) {
    const result = await client.query(
        `SELECT to_char((NOW() AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS today`
    )
    return result.rows[0].today
}

async function fetchAffectedRows(client, eventId, slotIds, today) {
    const directResult = await client.query(
        `
        SELECT
            'Entrada directa' AS origen,
            to_char(tde."date", 'YYYY-MM-DD') AS fecha,
            tt.name AS horario,
            tde.status::text AS estado_visita,
            CASE WHEN to_char(tde."date", 'YYYY-MM-DD') >= $5 AND tde.status::text <> 'USED' THEN 'SI' ELSE 'NO' END AS requiere_aviso,
            o.id AS order_id,
            o."providerOrderNumber" AS provider_order_number,
            o."providerTransactionId" AS provider_transaction_id,
            to_char(o."paidAt" AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI:SS') AS pagado_lima,
            COALESCE(NULLIF(o."buyerName", ''), u.name) AS comprador,
            COALESCE(NULLIF(o."buyerEmail", ''), u.email) AS correo,
            COALESCE(NULLIF(o."buyerPhone", ''), u.phone) AS telefono,
            COALESCE(NULLIF(o."buyerDocNumber", ''), u.dni) AS documento,
            u.name AS usuario,
            u.email AS correo_usuario,
            u.phone AS telefono_usuario,
            u.dni AS documento_usuario,
            COALESCE(NULLIF(t."attendeeName", ''), COALESCE(NULLIF(o."buyerName", ''), u.name)) AS asistente,
            COALESCE(NULLIF(t."attendeeDni", ''), COALESCE(NULLIF(o."buyerDocNumber", ''), u.dni)) AS dni_asistente,
            tt.name AS entrada,
            t."ticketCode" AS codigo_ticket,
            NULL::text AS reserva_id,
            t.id AS ticket_id
        FROM ticket_day_entitlements tde
        JOIN tickets t ON t.id = tde."ticketId"
        JOIN orders o ON o.id = t."orderId"
        JOIN users u ON u.id = o."userId"
        JOIN ticket_types tt ON tt.id = t."ticketTypeId"
        WHERE t."eventId" = $1
          AND t."ticketTypeId" = ANY($2::text[])
          AND tde."date" BETWEEN $3::date AND $4::date
          AND o.status = 'PAID'
          AND t.status = 'ACTIVE'
        ORDER BY tde."date" ASC, tt.name ASC, comprador ASC
        `,
        [eventId, slotIds, DATE_FROM, DATE_TO, today]
    )

    const poolTableResult = await client.query(
        `SELECT to_regclass('public.pool_visit_reservations') AS table_name`
    )
    const hasPoolReservationsTable = Boolean(poolTableResult.rows[0]?.table_name)

    const bagRows = []
    if (hasPoolReservationsTable) {
        const bagResult = await client.query(
            `
            SELECT
                'Reserva bolsa' AS origen,
                to_char(r."date", 'YYYY-MM-DD') AS fecha,
                slot.name AS horario,
                r.status::text AS estado_visita,
                CASE WHEN to_char(r."date", 'YYYY-MM-DD') >= $5 AND r.status::text <> 'USED' THEN 'SI' ELSE 'NO' END AS requiere_aviso,
                o.id AS order_id,
                o."providerOrderNumber" AS provider_order_number,
                o."providerTransactionId" AS provider_transaction_id,
                to_char(o."paidAt" AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI:SS') AS pagado_lima,
                COALESCE(NULLIF(o."buyerName", ''), u.name) AS comprador,
                COALESCE(NULLIF(o."buyerEmail", ''), u.email) AS correo,
                COALESCE(NULLIF(o."buyerPhone", ''), u.phone) AS telefono,
                COALESCE(NULLIF(o."buyerDocNumber", ''), u.dni) AS documento,
                u.name AS usuario,
                u.email AS correo_usuario,
                u.phone AS telefono_usuario,
                u.dni AS documento_usuario,
                COALESCE(NULLIF(bag."attendeeName", ''), COALESCE(NULLIF(o."buyerName", ''), u.name)) AS asistente,
                COALESCE(NULLIF(bag."attendeeDni", ''), COALESCE(NULLIF(o."buyerDocNumber", ''), u.dni)) AS dni_asistente,
                bag_tt.name AS entrada,
                bag."ticketCode" AS codigo_ticket,
                r.id AS reserva_id,
                bag.id AS ticket_id
            FROM pool_visit_reservations r
            JOIN tickets bag ON bag.id = r."ticketId"
            JOIN orders o ON o.id = bag."orderId"
            JOIN users u ON u.id = o."userId"
            JOIN ticket_types slot ON slot.id = r."sourceTicketTypeId"
            JOIN ticket_types bag_tt ON bag_tt.id = bag."ticketTypeId"
            WHERE bag."eventId" = $1
              AND r."sourceTicketTypeId" = ANY($2::text[])
              AND r."date" BETWEEN $3::date AND $4::date
              AND r.status <> 'CANCELLED'
              AND o.status = 'PAID'
              AND bag.status = 'ACTIVE'
            ORDER BY r."date" ASC, slot.name ASC, comprador ASC
            `,
            [eventId, slotIds, DATE_FROM, DATE_TO, today]
        )
        bagRows.push(...bagResult.rows)
    }

    const rows = [...directResult.rows, ...bagRows]
        .sort((a, b) =>
            a.fecha.localeCompare(b.fecha) ||
            a.horario.localeCompare(b.horario) ||
            a.comprador.localeCompare(b.comprador, "es") ||
            a.origen.localeCompare(b.origen, "es")
        )

    return { rows, hasPoolReservationsTable }
}

async function writeReports({ event, affectedRows, contacts, inventoryRows, outputStamp, today, hasPoolReservationsTable }) {
    const outDir = path.join(repoRoot, "scripts", "out")
    fs.mkdirSync(outDir, { recursive: true })

    const detailPath = path.join(outDir, `piscina-julio-19-21-afectados-${outputStamp}.csv`)
    const contactsPath = path.join(outDir, `piscina-julio-19-21-contactos-${outputStamp}.csv`)
    const xlsxPath = path.join(outDir, `piscina-julio-19-21-afectados-${outputStamp}.xlsx`)

    writeCsv(detailPath, affectedRows)
    writeCsv(contactsPath, contacts)

    const XLSX = await import("xlsx")
    const workbook = XLSX.utils.book_new()
    const resumen = [
        { metrica: "Evento", valor: event.title },
        { metrica: "Slug", valor: event.slug },
        { metrica: "Rango cerrado", valor: `${DATE_FROM} a ${DATE_TO}` },
        { metrica: "Horarios cerrados", valor: SLOT_NAMES.join(" | ") },
        { metrica: "Hoy Lima", valor: today },
        { metrica: "Filas inventario objetivo", valor: inventoryRows.length },
        { metrica: "Compras/reservas afectadas total", valor: affectedRows.length },
        { metrica: "Compras/reservas que requieren aviso", valor: affectedRows.filter((r) => r.requiere_aviso === "SI").length },
        { metrica: "Contactos unicos a avisar", valor: contacts.length },
        { metrica: "Tabla pool_visit_reservations en produccion", valor: hasPoolReservationsTable ? "SI" : "NO" },
    ]

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(resumen), "Resumen")
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contacts), "Contactos a avisar")
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(affectedRows), "Detalle")
    XLSX.writeFile(workbook, xlsxPath)

    return { detailPath, contactsPath, xlsxPath }
}

async function closeInventory(client, slots, dates) {
    await client.query("BEGIN")
    try {
        for (const slot of slots) {
            for (const date of dates) {
                await client.query(
                    `
                    INSERT INTO ticket_type_date_inventories
                        ("id", "ticketTypeId", "date", "capacity", "sold", "isEnabled", "createdAt", "updatedAt")
                    VALUES ($1, $2, $3::date, 0, 0, false, NOW(), NOW())
                    ON CONFLICT ("ticketTypeId", "date") DO UPDATE
                        SET "isEnabled" = false,
                            "updatedAt" = NOW()
                    `,
                    [crypto.randomUUID(), slot.id, date]
                )
            }
        }
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    }
}

function summarizePlan({ slots, dates, inventoryRows, affectedRows, contacts }) {
    const rowByKey = new Map(inventoryRows.map((row) => [`${row.ticket_type_id}|${row.fecha}`, row]))
    const planRows = []
    for (const slot of slots) {
        for (const date of dates) {
            const row = rowByKey.get(`${slot.id}|${date}`)
            planRows.push({
                slot: slot.name,
                date,
                existed: Boolean(row),
                isEnabled: row ? Boolean(row.is_enabled) : false,
                sold: row ? Number(row.sold) : 0,
                capacity: row ? Number(row.capacity) : 0,
            })
        }
    }

    const bySlot = new Map()
    for (const row of planRows) {
        const current = bySlot.get(row.slot) || { cells: 0, existing: 0, open: 0, sold: 0 }
        current.cells += 1
        if (row.existed) current.existing += 1
        if (row.isEnabled) current.open += 1
        current.sold += row.sold
        bySlot.set(row.slot, current)
    }

    return {
        planRows,
        slotSummary: Array.from(bySlot.entries()).map(([slot, row]) => ({ slot, ...row })),
        affectedToNotify: affectedRows.filter((row) => row.requiere_aviso === "SI").length,
        contactsToNotify: contacts.length,
    }
}

async function main() {
    const connectionString = readDatabaseUrl()
    const client = new pg.Client({ connectionString })
    await client.connect()

    try {
        const dates = Array.from(dateRange(DATE_FROM, DATE_TO))
        const today = await fetchTodayLima(client)
        const { event, slots } = await fetchEventAndSlots(client)
        const slotIds = slots.map((slot) => slot.id)
        const inventoryBefore = await fetchInventory(client, slotIds, dates)
        const affectedResult = await fetchAffectedRows(client, event.id, slotIds, today)
        const affectedRows = affectedResult.rows
        const contacts = groupContacts(affectedRows)
        const outputStamp = timestampForFile()
        const reportPaths = await writeReports({
            event,
            affectedRows,
            contacts,
            inventoryRows: inventoryBefore,
            outputStamp,
            today,
            hasPoolReservationsTable: affectedResult.hasPoolReservationsTable,
        })

        const plan = summarizePlan({ slots, dates, inventoryRows: inventoryBefore, affectedRows, contacts })

        console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`)
        console.log(`DB: ${maskConnectionString(connectionString)}`)
        console.log(`Evento: ${event.title}`)
        console.log(`Slug: ${event.slug}`)
        console.log(`Rango: ${DATE_FROM} a ${DATE_TO}`)
        console.log(`Horarios: ${SLOT_NAMES.join(", ")}`)
        console.log("")
        console.table(plan.slotSummary)
        console.log(`Celdas objetivo: ${plan.planRows.length}`)
        console.log(`Compras/reservas afectadas total: ${affectedRows.length}`)
        console.log(`Compras/reservas que requieren aviso (desde ${today}): ${plan.affectedToNotify}`)
        console.log(`Contactos unicos a avisar: ${plan.contactsToNotify}`)
        console.log(`Tabla pool_visit_reservations en produccion: ${affectedResult.hasPoolReservationsTable ? "SI" : "NO"}`)
        console.log(`Reporte XLSX: ${path.relative(repoRoot, reportPaths.xlsxPath)}`)
        console.log(`Detalle CSV: ${path.relative(repoRoot, reportPaths.detailPath)}`)
        console.log(`Contactos CSV: ${path.relative(repoRoot, reportPaths.contactsPath)}`)

        if (!APPLY) {
            console.log("\nDRY-RUN: no se escribio nada. Ejecuta con --apply para cerrar inventario.")
            return
        }

        await closeInventory(client, slots, dates)
        const inventoryAfter = await fetchInventory(client, slotIds, dates)
        const openAfter = inventoryAfter.filter((row) => row.is_enabled).length
        const totalRowsAfter = inventoryAfter.length

        console.log("")
        console.log(`APPLY OK: inventario cerrado para ${slots.length * dates.length} celdas.`)
        console.log(`Verificacion: filas objetivo en inventario=${totalRowsAfter}; filas abiertas=${openAfter}.`)
        if (totalRowsAfter !== slots.length * dates.length || openAfter !== 0) {
            throw new Error("Verification failed: expected all target inventory rows to exist and be closed")
        }
    } finally {
        await client.end()
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
