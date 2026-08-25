import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import XLSX from "xlsx"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const envFile = process.env.ENV_FILE || ".env.production"
const dates = (process.env.DATES || "2026-08-15,2026-08-16")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

if (dates.length === 0) throw new Error("DATES must contain at least one YYYY-MM-DD date")

const rawEnv = fs.readFileSync(path.join(repoRoot, envFile), "utf8")
const databaseUrl = rawEnv.match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1]
if (!databaseUrl) throw new Error(`DATABASE_URL not found in ${envFile}`)

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
await client.query("BEGIN TRANSACTION READ ONLY")

try {
    const eventResult = await client.query(
        `SELECT DISTINCT e.id, e.title, e.slug
         FROM events e
         JOIN ticket_types tt ON tt."eventId" = e.id
         JOIN ticket_type_date_inventories inv ON inv."ticketTypeId" = tt.id
         WHERE e.category = 'PISCINA_LIBRE'
           AND inv.date = ANY($1::date[])
         ORDER BY e.title`,
        [dates]
    )

    if (eventResult.rows.length === 0) {
        throw new Error(`No PISCINA_LIBRE event has inventory for ${dates.join(", ")}`)
    }

    const eventIds = eventResult.rows.map((row) => row.id)

    const inventoryResult = await client.query(
        `SELECT e.id AS event_id, e.title AS evento,
                to_char(inv.date, 'YYYY-MM-DD') AS fecha,
                tt.id AS ticket_type_id, tt.name AS horario,
                inv.capacity AS cupo, inv.sold AS vendidos, inv."isEnabled" AS abierto
         FROM ticket_type_date_inventories inv
         JOIN ticket_types tt ON tt.id = inv."ticketTypeId"
         JOIN events e ON e.id = tt."eventId"
         WHERE e.id = ANY($1::text[])
           AND inv.date = ANY($2::date[])
           AND tt."isPackage" = false
         ORDER BY e.title, inv.date, tt."sortOrder", tt.name`,
        [eventIds, dates]
    )

    const directResult = await client.query(
        `SELECT e.id AS event_id, e.title AS evento,
                to_char(tde.date, 'YYYY-MM-DD') AS fecha,
                tt.name AS horario, 'Entrada directa'::text AS origen,
                t.id AS codigo_o_reserva, o.id AS order_id,
                to_char(COALESCE(o."paidAt", o."createdAt") AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI:SS') AS fecha_pago,
                COALESCE(NULLIF(o."buyerName", ''), u.name) AS comprador,
                COALESCE(NULLIF(o."buyerDocNumber", ''), u.dni) AS documento,
                COALESCE(NULLIF(o."buyerEmail", ''), u.email) AS correo,
                COALESCE(NULLIF(o."buyerPhone", ''), u.phone) AS telefono,
                t."attendeeName" AS asistente,
                t."attendeeDni" AS dni_asistente
         FROM ticket_day_entitlements tde
         JOIN tickets t ON t.id = tde."ticketId"
         JOIN orders o ON o.id = t."orderId"
         JOIN users u ON u.id = o."userId"
         JOIN ticket_types tt ON tt.id = t."ticketTypeId"
         JOIN events e ON e.id = t."eventId"
         WHERE e.id = ANY($1::text[])
           AND tde.date = ANY($2::date[])
           AND tt."isPackage" = false
           AND o.status = 'PAID'
           AND t.status = 'ACTIVE'`,
        [eventIds, dates]
    )

    const tableCheck = await client.query("SELECT to_regclass('public.pool_visit_reservations') AS name")
    let bagRows = []
    if (tableCheck.rows[0]?.name) {
        const bagResult = await client.query(
            `SELECT e.id AS event_id, e.title AS evento,
                    to_char(r.date, 'YYYY-MM-DD') AS fecha,
                    slot.name AS horario, ('Bolsa: ' || bag_tt.name)::text AS origen,
                    r.id AS codigo_o_reserva, o.id AS order_id,
                    to_char(COALESCE(o."paidAt", o."createdAt") AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI:SS') AS fecha_pago,
                    COALESCE(NULLIF(o."buyerName", ''), u.name) AS comprador,
                    COALESCE(NULLIF(o."buyerDocNumber", ''), u.dni) AS documento,
                    COALESCE(NULLIF(o."buyerEmail", ''), u.email) AS correo,
                    COALESCE(NULLIF(o."buyerPhone", ''), u.phone) AS telefono,
                    bag."attendeeName" AS asistente,
                    bag."attendeeDni" AS dni_asistente
             FROM pool_visit_reservations r
             JOIN tickets bag ON bag.id = r."ticketId"
             JOIN orders o ON o.id = bag."orderId"
             JOIN users u ON u.id = o."userId"
             JOIN ticket_types bag_tt ON bag_tt.id = bag."ticketTypeId"
             JOIN ticket_types slot ON slot.id = r."sourceTicketTypeId"
             JOIN events e ON e.id = bag."eventId"
             WHERE e.id = ANY($1::text[])
               AND r.date = ANY($2::date[])
               AND r.status IN ('RESERVED', 'USED')
               AND o.status = 'PAID'
               AND bag.status = 'ACTIVE'`,
            [eventIds, dates]
        )
        bagRows = bagResult.rows
    }

    const rawRows = [...directResult.rows, ...bagRows]
        .sort((a, b) => a.evento.localeCompare(b.evento, "es") || a.fecha.localeCompare(b.fecha) || a.horario.localeCompare(b.horario) || a.comprador.localeCompare(b.comprador, "es"))

    const rows = rawRows.map((row) => ({
            Evento: row.evento,
            Fecha: row.fecha,
            Horario: row.horario,
            Comprador: row.comprador || "",
            Documento: row.documento || "",
            Correo: row.correo || "",
            Telefono: row.telefono || "",
            Asistente: row.asistente || "",
            "DNI asistente": row.dni_asistente || "",
            Origen: row.origen,
            "Fecha de pago": row.fecha_pago || "",
            "Orden ID": row.order_id,
            "Codigo/reserva": row.codigo_o_reserva,
        }))

    const inventory = inventoryResult.rows.map((row) => {
        const found = rawRows.filter((visit) => visit.event_id === row.event_id && visit.fecha === row.fecha && visit.horario === row.horario).length
        return {
            Evento: row.evento,
            Fecha: row.fecha,
            Horario: row.horario,
            Cupo: Number(row.cupo),
            "Vendidos (inventario)": Number(row.vendidos),
            "Filas encontradas": found,
            Coincide: Number(row.vendidos) === found ? "SI" : "NO",
            Estado: row.abierto ? "Abierto" : "Cerrado",
        }
    })

    const outDir = path.join(repoRoot, "scripts", "out")
    fs.mkdirSync(outDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const base = `compradores-piscina-${dates.join("_")}-${stamp}`
    const xlsxPath = path.join(outDir, `${base}.xlsx`)
    const csvPath = path.join(outDir, `${base}.csv`)

    const consolidatedMap = new Map()
    for (const row of rawRows) {
        const key = row.documento || row.correo || row.telefono || row.comprador || row.order_id
        const current = consolidatedMap.get(key) || {
            Comprador: row.comprador || "",
            Documento: row.documento || "",
            Correo: row.correo || "",
            Telefono: row.telefono || "",
            visits: [],
            orders: new Set(),
            origins: new Set(),
        }
        current.visits.push(`${row.fecha} | ${row.horario}`)
        current.orders.add(row.order_id)
        current.origins.add(row.origen)
        consolidatedMap.set(key, current)
    }
    const consolidated = Array.from(consolidatedMap.values())
        .map((row) => ({
            Comprador: row.Comprador,
            Documento: row.Documento,
            Correo: row.Correo,
            Telefono: row.Telefono,
            "Cupos comprados/reservados": row.visits.length,
            "Fechas y horarios": row.visits.join(" | "),
            Origen: Array.from(row.origins).sort().join(" | "),
            "Ordenes ID": Array.from(row.orders).sort().join(" | "),
        }))
        .sort((a, b) => a.Comprador.localeCompare(b.Comprador, "es"))

    const workbook = XLSX.utils.book_new()
    const consolidatedSheet = XLSX.utils.json_to_sheet(consolidated)
    consolidatedSheet["!cols"] = [32, 14, 32, 15, 24, 60, 28, 55].map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(workbook, consolidatedSheet, "Compradores")
    const detailSheet = XLSX.utils.json_to_sheet(rows)
    detailSheet["!cols"] = [24, 12, 15, 32, 14, 32, 15, 28, 14, 24, 20, 28, 30].map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle por cupo")
    const validationSheet = XLSX.utils.json_to_sheet(inventory)
    validationSheet["!cols"] = [24, 12, 15, 10, 20, 18, 10, 12].map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(workbook, validationSheet, "Validacion")
    XLSX.writeFile(workbook, xlsxPath)

    const csv = XLSX.utils.sheet_to_csv(consolidatedSheet)
    fs.writeFileSync(csvPath, `\uFEFF${csv}`, "utf8")

    const summary = eventResult.rows.map((event) => ({
        event: event.title,
        slug: event.slug,
        visits: rawRows.filter((row) => row.event_id === event.id).length,
        buyers: consolidated.length,
        sold: inventoryResult.rows.filter((row) => row.event_id === event.id).reduce((sum, row) => sum + Number(row.vendidos), 0),
    }))

    console.log(JSON.stringify({ dates, summary, mismatches: inventory.filter((row) => row.Coincide === "NO" && (row["Vendidos (inventario)"] > 0 || row["Filas encontradas"] > 0)), xlsxPath, csvPath }, null, 2))
    await client.query("ROLLBACK")
} catch (error) {
    await client.query("ROLLBACK")
    throw error
} finally {
    await client.end()
}
