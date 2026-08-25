import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const SOURCE_SLUG = "piscina-libre-julio-2026-1hr-campo-de-marte-fdnda"
const TARGET_SLUG = "piscina-libre-agosto-2026-1hr-campo-de-marte-fdnda"
const APPLY = process.argv.includes("--apply") || process.env.APPLY === "true"
const envFile = process.env.ENV_FILE || ".env.production"

// Fechas regulares representativas de julio. Se omiten cierres por campeonato,
// feriados y otras excepciones puntuales del mes.
const SOURCE_REFERENCE_BY_DOW = new Map([
    [0, "2026-07-26"], // domingo
    [1, "2026-07-27"], // lunes
    [2, "2026-07-21"], // martes (28/07 fue feriado)
    [3, "2026-07-22"], // miércoles (29/07 fue feriado)
    [4, "2026-07-30"], // jueves
    [5, "2026-07-31"], // viernes
    [6, "2026-07-25"], // sábado
])

function readDatabaseUrl() {
    const raw = fs.readFileSync(path.join(repoRoot, envFile), "utf8")
    const match = raw.match(/^DATABASE_URL="?([^"\n]+)"?/m)
    if (!match) throw new Error(`DATABASE_URL not found in ${envFile}`)
    return match[1]
}

function maskConnectionString(connectionString) {
    return connectionString.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@").split("?")[0]
}

function dowOfDateKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
}

function listDateKeys(from, to) {
    const dates = []
    const current = new Date(`${from}T12:00:00Z`)
    const end = new Date(`${to}T12:00:00Z`)
    while (current <= end) {
        dates.push(current.toISOString().slice(0, 10))
        current.setUTCDate(current.getUTCDate() + 1)
    }
    return dates
}

async function fetchEvent(client, slug) {
    const result = await client.query(`
        SELECT
            id,
            title,
            slug,
            category::text AS category,
            "isPublished" AS is_published,
            to_char("startDate", 'YYYY-MM-DD') AS start_date,
            to_char("endDate", 'YYYY-MM-DD') AS end_date
        FROM events
        WHERE slug = $1
    `, [slug])
    if (result.rows.length !== 1) {
        throw new Error(`Expected exactly one event for ${slug}; found ${result.rows.length}`)
    }
    const event = result.rows[0]
    if (event.category !== "PISCINA_LIBRE") {
        throw new Error(`${slug} is not a PISCINA_LIBRE event`)
    }
    return event
}

async function fetchActiveSlots(client, eventId) {
    const result = await client.query(`
        SELECT
            id,
            name,
            capacity,
            sold,
            "sortOrder" AS sort_order,
            "servilexScheduleCode" AS servilex_schedule_code
        FROM ticket_types
        WHERE "eventId" = $1 AND "isActive" = true
        ORDER BY "sortOrder", name
    `, [eventId])
    return result.rows
}

async function fetchSourceReferenceInventory(client, eventId, slotIds) {
    const referenceDates = Array.from(SOURCE_REFERENCE_BY_DOW.values())
    const result = await client.query(`
        SELECT
            tt.name AS slot,
            to_char(inv.date, 'YYYY-MM-DD') AS date,
            inv.capacity,
            inv.sold,
            inv."isEnabled" AS is_enabled
        FROM ticket_type_date_inventories inv
        JOIN ticket_types tt ON tt.id = inv."ticketTypeId"
        WHERE tt."eventId" = $1
          AND tt.id = ANY($2::text[])
          AND to_char(inv.date, 'YYYY-MM-DD') = ANY($3::text[])
        ORDER BY inv.date, tt."sortOrder", tt.name
    `, [eventId, slotIds, referenceDates])
    return result.rows
}

async function fetchTargetInventory(client, eventId) {
    const result = await client.query(`
        SELECT
            inv.id,
            inv."ticketTypeId" AS ticket_type_id,
            tt.name AS slot,
            to_char(inv.date, 'YYYY-MM-DD') AS date,
            inv.capacity,
            inv.sold,
            inv."isEnabled" AS is_enabled
        FROM ticket_type_date_inventories inv
        JOIN ticket_types tt ON tt.id = inv."ticketTypeId"
        WHERE tt."eventId" = $1
        ORDER BY inv.date, tt."sortOrder", tt.name
    `, [eventId])
    return result.rows
}

async function fetchTargetUsage(client, eventId) {
    const result = await client.query(`
        SELECT
            (SELECT COUNT(*)::int FROM tickets WHERE "eventId" = $1) AS tickets,
            (SELECT COALESCE(SUM(sold), 0)::int FROM ticket_types WHERE "eventId" = $1) AS base_sold,
            (
                SELECT COUNT(*)::int
                FROM pool_visit_reservations r
                JOIN tickets t ON t.id = r."ticketId"
                WHERE t."eventId" = $1 AND r.status <> 'CANCELLED'
            ) AS pool_reservations
    `, [eventId])
    return result.rows[0]
}

function validateMatchingSlots(sourceSlots, targetSlots) {
    const sourceByName = new Map(sourceSlots.map((slot) => [slot.name, slot]))
    const targetByName = new Map(targetSlots.map((slot) => [slot.name, slot]))
    const missingInTarget = sourceSlots.filter((slot) => !targetByName.has(slot.name)).map((slot) => slot.name)
    const extraInTarget = targetSlots.filter((slot) => !sourceByName.has(slot.name)).map((slot) => slot.name)
    if (missingInTarget.length || extraInTarget.length) {
        throw new Error(
            `Active slot mismatch. Missing in target: ${missingInTarget.join(", ") || "none"}; ` +
            `extra in target: ${extraInTarget.join(", ") || "none"}`
        )
    }
    for (const source of sourceSlots) {
        const target = targetByName.get(source.name)
        if (source.servilex_schedule_code !== target.servilex_schedule_code) {
            throw new Error(`Servilex schedule mismatch for ${source.name}`)
        }
    }
}

function buildPlan({ sourceRows, targetSlots, targetEvent, existingRows }) {
    const sourceByDateSlot = new Map(
        sourceRows.map((row) => [`${row.date}|${row.slot}`, row])
    )
    const targetByName = new Map(targetSlots.map((slot) => [slot.name, slot]))
    const existingByKey = new Map(
        existingRows.map((row) => [`${row.ticket_type_id}|${row.date}`, row])
    )
    const targetDates = listDateKeys(targetEvent.start_date, targetEvent.end_date)
    const rows = []

    for (const targetDate of targetDates) {
        const referenceDate = SOURCE_REFERENCE_BY_DOW.get(dowOfDateKey(targetDate))
        if (!referenceDate) throw new Error(`No source reference for ${targetDate}`)
        for (const targetSlot of targetSlots) {
            const source = sourceByDateSlot.get(`${referenceDate}|${targetSlot.name}`)
            if (!source) {
                throw new Error(`Missing source inventory for ${targetSlot.name} on ${referenceDate}`)
            }
            const existing = existingByKey.get(`${targetSlot.id}|${targetDate}`)
            const desiredCapacity = Number(source.capacity)
            const desiredEnabled = Boolean(source.is_enabled)
            const sold = Number(existing?.sold ?? 0)
            if (sold > 0 && (!desiredEnabled || (desiredCapacity > 0 && desiredCapacity < sold))) {
                throw new Error(
                    `Unsafe target change for ${targetSlot.name} on ${targetDate}: sold=${sold}, ` +
                    `desired capacity=${desiredCapacity}, enabled=${desiredEnabled}`
                )
            }
            const action = !existing
                ? "INSERT"
                : Number(existing.capacity) === desiredCapacity && Boolean(existing.is_enabled) === desiredEnabled
                  ? "NOOP"
                  : "UPDATE"
            rows.push({
                targetDate,
                referenceDate,
                ticketTypeId: targetByName.get(targetSlot.name).id,
                slot: targetSlot.name,
                capacity: desiredCapacity,
                isEnabled: desiredEnabled,
                sold,
                action,
            })
        }
    }
    return rows
}

function summarizePlan(rows) {
    const byDow = new Map()
    for (const row of rows) {
        const dow = dowOfDateKey(row.targetDate)
        const key = `${dow}|${row.targetDate}`
        let day = byDow.get(key)
        if (!day) {
            day = { dow, date: row.targetDate, openSlots: 0, closedSlots: 0, capacity: 0 }
            byDow.set(key, day)
        }
        if (row.isEnabled) {
            day.openSlots += 1
            day.capacity += row.capacity
        } else {
            day.closedSlots += 1
        }
    }

    const names = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
    const grouped = new Map()
    for (const day of byDow.values()) {
        const signature = `${day.dow}|${day.openSlots}|${day.closedSlots}|${day.capacity}`
        const current = grouped.get(signature) ?? {
            dia: names[day.dow],
            fechas: 0,
            horarios_abiertos: day.openSlots,
            horarios_cerrados: day.closedSlots,
            cupo_por_dia: day.capacity,
        }
        current.fechas += 1
        grouped.set(signature, current)
    }
    return Array.from(grouped.values()).sort((a, b) => names.indexOf(a.dia) - names.indexOf(b.dia))
}

async function applyPlan(client, rows) {
    const writeRows = rows.filter((row) => row.action !== "NOOP")
    if (writeRows.length === 0) return

    const payload = writeRows.map((row) => ({
        id: crypto.randomUUID(),
        ticket_type_id: row.ticketTypeId,
        date: row.targetDate,
        capacity: row.capacity,
        is_enabled: row.isEnabled,
    }))

    await client.query("BEGIN")
    try {
        await client.query(`
            WITH input AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS x(
                    id text,
                    ticket_type_id text,
                    date date,
                    capacity integer,
                    is_enabled boolean
                )
            )
                INSERT INTO ticket_type_date_inventories
                    (id, "ticketTypeId", date, capacity, sold, "isEnabled", "createdAt", "updatedAt")
                SELECT id, ticket_type_id, date, capacity, 0, is_enabled, NOW(), NOW()
                FROM input
                ON CONFLICT ("ticketTypeId", date) DO UPDATE
                    SET capacity = EXCLUDED.capacity,
                        "isEnabled" = EXCLUDED."isEnabled",
                        "updatedAt" = NOW()
        `, [JSON.stringify(payload)])
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    }
}

async function verifyPlan(client, targetEvent, expectedRows) {
    const actualRows = await fetchTargetInventory(client, targetEvent.id)
    const actualByKey = new Map(actualRows.map((row) => [`${row.ticket_type_id}|${row.date}`, row]))
    const mismatches = expectedRows.filter((expected) => {
        const actual = actualByKey.get(`${expected.ticketTypeId}|${expected.targetDate}`)
        return !actual || Number(actual.capacity) !== expected.capacity || Boolean(actual.is_enabled) !== expected.isEnabled
    })
    const rowsInRange = actualRows.filter(
        (row) => row.date >= targetEvent.start_date && row.date <= targetEvent.end_date
    )
    return { actualRows, rowsInRange, mismatches }
}

const connectionString = readDatabaseUrl()
const client = new pg.Client({ connectionString })

try {
    await client.connect()

    const sourceEvent = await fetchEvent(client, SOURCE_SLUG)
    const targetEvent = await fetchEvent(client, TARGET_SLUG)
    const [sourceSlots, targetSlots, targetExisting, targetUsage] = await Promise.all([
        fetchActiveSlots(client, sourceEvent.id),
        fetchActiveSlots(client, targetEvent.id),
        fetchTargetInventory(client, targetEvent.id),
        fetchTargetUsage(client, targetEvent.id),
    ])

    validateMatchingSlots(sourceSlots, targetSlots)
    for (const [dow, referenceDate] of SOURCE_REFERENCE_BY_DOW) {
        if (dowOfDateKey(referenceDate) !== dow) {
            throw new Error(`Reference date ${referenceDate} has the wrong weekday`)
        }
    }

    if (targetUsage.tickets !== 0 || targetUsage.base_sold !== 0 || targetUsage.pool_reservations !== 0) {
        throw new Error(
            `Target event already has usage: tickets=${targetUsage.tickets}, ` +
            `base sold=${targetUsage.base_sold}, pool reservations=${targetUsage.pool_reservations}`
        )
    }

    const sourceRows = await fetchSourceReferenceInventory(
        client,
        sourceEvent.id,
        sourceSlots.map((slot) => slot.id)
    )
    const expectedSourceRows = SOURCE_REFERENCE_BY_DOW.size * sourceSlots.length
    if (sourceRows.length !== expectedSourceRows) {
        throw new Error(`Expected ${expectedSourceRows} source reference rows; found ${sourceRows.length}`)
    }

    const plan = buildPlan({
        sourceRows,
        targetSlots,
        targetEvent,
        existingRows: targetExisting,
    })
    const actionCounts = plan.reduce((acc, row) => {
        acc[row.action] = (acc[row.action] ?? 0) + 1
        return acc
    }, {})

    console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`)
    console.log(`DB: ${maskConnectionString(connectionString)}`)
    console.log(`Origen: ${sourceEvent.title}`)
    console.log(`Destino: ${targetEvent.title}`)
    console.log(`Destino publicado: ${targetEvent.is_published ? "SI" : "NO"}`)
    console.log(`Horarios activos: ${targetSlots.length}`)
    console.log(`Fechas destino: ${targetEvent.start_date} a ${targetEvent.end_date}`)
    console.log("Fechas de referencia de julio:")
    console.table(Array.from(SOURCE_REFERENCE_BY_DOW.entries()).map(([dow, date]) => ({ dow, date })))
    console.log("Configuración resultante por día de semana:")
    console.table(summarizePlan(plan))
    console.log(`Celdas objetivo: ${plan.length}`)
    console.log(`Acciones: INSERT=${actionCounts.INSERT ?? 0}, UPDATE=${actionCounts.UPDATE ?? 0}, NOOP=${actionCounts.NOOP ?? 0}`)
    console.log(`Uso actual del destino: tickets=${targetUsage.tickets}, vendidos=${targetUsage.base_sold}, reservas bolsa=${targetUsage.pool_reservations}`)

    if (!APPLY) {
        console.log("\nDRY-RUN OK: no se escribió nada. Usa --apply para guardar.")
    } else {
        await applyPlan(client, plan)
        const verification = await verifyPlan(client, targetEvent, plan)
        console.log("\nAPPLY OK")
        console.log(`Filas del destino dentro de agosto: ${verification.rowsInRange.length}`)
        console.log(`Diferencias contra el plan: ${verification.mismatches.length}`)
        if (verification.rowsInRange.length !== plan.length || verification.mismatches.length !== 0) {
            throw new Error("Verification failed after applying the August pool inventory")
        }
    }
} finally {
    await client.end().catch(() => undefined)
}
