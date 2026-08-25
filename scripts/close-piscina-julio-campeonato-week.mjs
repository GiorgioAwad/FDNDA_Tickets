import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import crypto from "node:crypto"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const EVENT_SLUG = "piscina-libre-julio-2026-1hr-campo-de-marte-fdnda"
const APPLY = process.argv.includes("--apply") || process.env.APPLY === "true"
const envFile = process.env.ENV_FILE || ".env.production"

const TARGETS = [
    // Viernes 4pm a 10pm
    ...["16:00 - 17:00", "17:00 - 18:00", "18:00 - 19:00", "19:00 - 20:00", "20:00 - 21:00", "21:00 - 22:00"].map((slot) => ({
        date: "2026-07-10",
        weekday: "viernes",
        slot,
    })),
    // Sabado 7am a 1pm
    ...["07:00 - 08:00", "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "12:00 - 13:00"].map((slot) => ({
        date: "2026-07-11",
        weekday: "sabado",
        slot,
    })),
    // Sabado 3pm a 10pm
    ...["15:00 - 16:00", "16:00 - 17:00", "17:00 - 18:00", "18:00 - 19:00", "19:00 - 20:00", "20:00 - 21:00", "21:00 - 22:00"].map((slot) => ({
        date: "2026-07-11",
        weekday: "sabado",
        slot,
    })),
    // Domingo 7am a 1pm
    ...["07:00 - 08:00", "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "12:00 - 13:00"].map((slot) => ({
        date: "2026-07-12",
        weekday: "domingo",
        slot,
    })),
]

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
    for (const row of rows) {
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
    const targetSlotNames = Array.from(new Set(TARGETS.map((target) => target.slot))).sort()
    const slotResult = await client.query(
        `
        SELECT id, name, capacity, sold, "isActive"
        FROM ticket_types
        WHERE "eventId" = $1 AND name = ANY($2::text[])
        ORDER BY name ASC
        `,
        [event.id, targetSlotNames]
    )

    const foundNames = new Set(slotResult.rows.map((row) => row.name))
    const missing = targetSlotNames.filter((name) => !foundNames.has(name))
    return { event, slots: slotResult.rows, missing }
}

async function fetchInventory(client, targetsWithIds) {
    const slotIds = Array.from(new Set(targetsWithIds.map((target) => target.ticket_type_id)))
    const dates = Array.from(new Set(targetsWithIds.map((target) => target.date)))
    const result = await client.query(
        `
        SELECT "ticketTypeId" AS ticket_type_id,
               to_char("date", 'YYYY-MM-DD') AS fecha,
               capacity,
               sold,
               "isEnabled" AS is_enabled
        FROM ticket_type_date_inventories
        WHERE "ticketTypeId" = ANY($1::text[])
          AND to_char("date", 'YYYY-MM-DD') = ANY($2::text[])
        ORDER BY "date" ASC
        `,
        [slotIds, dates]
    )
    return result.rows
}

async function fetchAffectedRows(client, eventId, targetsWithIds) {
    const targetDates = Array.from(new Set(targetsWithIds.map((target) => target.date)))
    const slotIds = Array.from(new Set(targetsWithIds.map((target) => target.ticket_type_id)))

    const directResult = await client.query(
        `
        SELECT
            'Entrada directa' AS origen,
            to_char(tde."date", 'YYYY-MM-DD') AS fecha,
            tt.name AS horario,
            tde.status::text AS estado_visita,
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
          AND to_char(tde."date", 'YYYY-MM-DD') = ANY($3::text[])
          AND o.status = 'PAID'
          AND t.status = 'ACTIVE'
          AND tde.status::text <> 'USED'
        ORDER BY tde."date" ASC, tt.name ASC, comprador ASC
        `,
        [eventId, slotIds, targetDates]
    )

    const targetKeySet = new Set(targetsWithIds.map((target) => `${target.date}|${target.slot}`))
    const directRows = directResult.rows.filter((row) => targetKeySet.has(`${row.fecha}|${row.horario}`))

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
              AND to_char(r."date", 'YYYY-MM-DD') = ANY($3::text[])
              AND r.status = 'RESERVED'
              AND o.status = 'PAID'
              AND bag.status = 'ACTIVE'
            ORDER BY r."date" ASC, slot.name ASC, comprador ASC
            `,
            [eventId, slotIds, targetDates]
        )
        bagRows.push(...bagResult.rows.filter((row) => targetKeySet.has(`${row.fecha}|${row.horario}`)))
    }

    return {
        rows: [...directRows, ...bagRows].sort((a, b) =>
            a.fecha.localeCompare(b.fecha) ||
            a.horario.localeCompare(b.horario) ||
            a.comprador.localeCompare(b.comprador, "es") ||
            a.origen.localeCompare(b.origen, "es")
        ),
        hasPoolReservationsTable,
    }
}

async function closeInventory(client, targetsWithIds) {
    await client.query("BEGIN")
    try {
        for (const target of targetsWithIds) {
            await client.query(
                `
                INSERT INTO ticket_type_date_inventories
                    ("id", "ticketTypeId", "date", "capacity", "sold", "isEnabled", "createdAt", "updatedAt")
                VALUES ($1, $2, $3::date, 0, 0, false, NOW(), NOW())
                ON CONFLICT ("ticketTypeId", "date") DO UPDATE
                    SET "isEnabled" = false,
                        "updatedAt" = NOW()
                `,
                [crypto.randomUUID(), target.ticket_type_id, target.date]
            )
        }
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    }
}

function summarizePlan({ targetsWithIds, inventoryRows, affectedRows }) {
    const rowByKey = new Map(inventoryRows.map((row) => [`${row.ticket_type_id}|${row.fecha}`, row]))
    const rows = targetsWithIds.map((target) => {
        const row = rowByKey.get(`${target.ticket_type_id}|${target.date}`)
        return {
            fecha: target.date,
            dia: target.weekday,
            horario: target.slot,
            activo: target.is_active ? "SI" : "NO",
            existia_inventario: row ? "SI" : "NO",
            estaba_abierto: row?.is_enabled ? "SI" : "NO",
            capacidad: row ? Number(row.capacity) : 0,
            vendidos_inventario: row ? Number(row.sold) : 0,
            afectados: affectedRows.filter((affected) => affected.fecha === target.date && affected.horario === target.slot).length,
        }
    })

    const byDate = new Map()
    for (const row of rows) {
        const current = byDate.get(row.fecha) || { fecha: row.fecha, celdas: 0, abiertas: 0, vendidos_inventario: 0, afectados: 0 }
        current.celdas += 1
        if (row.estaba_abierto === "SI") current.abiertas += 1
        current.vendidos_inventario += row.vendidos_inventario
        current.afectados += row.afectados
        byDate.set(row.fecha, current)
    }

    return { rows, byDate: Array.from(byDate.values()) }
}

async function writeReports({ event, affectedRows, contacts, planRows, outputStamp, missing, hasPoolReservationsTable }) {
    const outDir = path.join(repoRoot, "scripts", "out")
    fs.mkdirSync(outDir, { recursive: true })

    const detailPath = path.join(outDir, `piscina-julio-campeonato-afectados-${outputStamp}.csv`)
    const contactsPath = path.join(outDir, `piscina-julio-campeonato-contactos-${outputStamp}.csv`)
    const planPath = path.join(outDir, `piscina-julio-campeonato-cierre-${outputStamp}.csv`)
    const xlsxPath = path.join(outDir, `piscina-julio-campeonato-afectados-${outputStamp}.xlsx`)

    writeCsv(detailPath, affectedRows)
    writeCsv(contactsPath, contacts)
    writeCsv(planPath, planRows)

    const XLSX = await import("xlsx")
    const workbook = XLSX.utils.book_new()
    const resumen = [
        { metrica: "Evento", valor: event.title },
        { metrica: "Slug", valor: event.slug },
        { metrica: "Semana cerrada", valor: "2026-07-10 a 2026-07-12" },
        { metrica: "Celdas objetivo", valor: planRows.length },
        { metrica: "Entradas/reservas afectadas", valor: affectedRows.length },
        { metrica: "Contactos unicos", valor: contacts.length },
        { metrica: "Horarios objetivo sin TicketType", valor: missing.length ? missing.join(" | ") : "Ninguno" },
        { metrica: "Tabla pool_visit_reservations en produccion", valor: hasPoolReservationsTable ? "SI" : "NO" },
    ]

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(resumen), "Resumen")
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contacts), "Contactos a avisar")
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(affectedRows), "Detalle afectados")
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(planRows), "Cierre aplicado")
    XLSX.writeFile(workbook, xlsxPath)

    return { detailPath, contactsPath, planPath, xlsxPath }
}

async function main() {
    const connectionString = readDatabaseUrl()
    const client = new pg.Client({ connectionString })
    await client.connect()

    try {
        const { event, slots, missing } = await fetchEventAndSlots(client)
        const slotByName = new Map(slots.map((slot) => [slot.name, slot]))
        const targetsWithIds = TARGETS
            .map((target) => {
                const slot = slotByName.get(target.slot)
                if (!slot) return null
                return {
                    ...target,
                    ticket_type_id: slot.id,
                    is_active: Boolean(slot.isActive),
                    base_capacity: Number(slot.capacity),
                }
            })
            .filter(Boolean)

        const inventoryBefore = await fetchInventory(client, targetsWithIds)
        const affectedResult = await fetchAffectedRows(client, event.id, targetsWithIds)
        const contacts = groupContacts(affectedResult.rows)
        const plan = summarizePlan({ targetsWithIds, inventoryRows: inventoryBefore, affectedRows: affectedResult.rows })
        const outputStamp = timestampForFile()
        const reportPaths = await writeReports({
            event,
            affectedRows: affectedResult.rows,
            contacts,
            planRows: plan.rows,
            outputStamp,
            missing,
            hasPoolReservationsTable: affectedResult.hasPoolReservationsTable,
        })

        console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`)
        console.log(`DB: ${maskConnectionString(connectionString)}`)
        console.log(`Evento: ${event.title}`)
        console.log("Semana: 2026-07-10 a 2026-07-12")
        if (missing.length) console.log(`Horarios objetivo sin TicketType: ${missing.join(", ")}`)
        console.log("")
        console.table(plan.byDate)
        console.log(`Celdas objetivo encontradas: ${targetsWithIds.length}`)
        console.log(`Celdas abiertas antes: ${plan.rows.filter((row) => row.estaba_abierto === "SI").length}`)
        console.log(`Entradas/reservas afectadas: ${affectedResult.rows.length}`)
        console.log(`Contactos unicos a avisar: ${contacts.length}`)
        console.log(`Tabla pool_visit_reservations en produccion: ${affectedResult.hasPoolReservationsTable ? "SI" : "NO"}`)
        console.log(`Reporte XLSX: ${path.relative(repoRoot, reportPaths.xlsxPath)}`)
        console.log(`Contactos CSV: ${path.relative(repoRoot, reportPaths.contactsPath)}`)
        console.log(`Detalle CSV: ${path.relative(repoRoot, reportPaths.detailPath)}`)
        console.log(`Plan CSV: ${path.relative(repoRoot, reportPaths.planPath)}`)

        if (!APPLY) {
            console.log("\nDRY-RUN: no se escribio nada. Ejecuta con --apply para cerrar inventario.")
            return
        }

        await closeInventory(client, targetsWithIds)
        const inventoryAfter = await fetchInventory(client, targetsWithIds)
        const closedKeySet = new Set(inventoryAfter.filter((row) => !row.is_enabled).map((row) => `${row.ticket_type_id}|${row.fecha}`))
        const missingClosed = targetsWithIds.filter((target) => !closedKeySet.has(`${target.ticket_type_id}|${target.date}`))

        console.log("")
        console.log(`APPLY OK: inventario cerrado para ${targetsWithIds.length} celdas.`)
        console.log(`Verificacion: faltan cerrar=${missingClosed.length}.`)
        if (missingClosed.length > 0) {
            throw new Error("Verification failed: target inventory rows remain open or missing")
        }
    } finally {
        await client.end()
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
