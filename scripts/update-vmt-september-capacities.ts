/**
 * Actualiza los cupos de Academia VMT para septiembre de 2026.
 *
 * Fuente: "VMT CUPOS SETIEMBRE.xlsx", hoja "Cuadro resumen".
 * Dry-run por defecto; usar --confirm para aplicar.
 *
 *   node --env-file=.env.production .\node_modules\tsx\dist\cli.mjs \
 *     --tsconfig tsconfig.json scripts/update-vmt-september-capacities.ts
 *   node --env-file=.env.production .\node_modules\tsx\dist\cli.mjs \
 *     --tsconfig tsconfig.json scripts/update-vmt-september-capacities.ts --confirm
 */

import pg from "pg"

const EVENT_ID = "cmsqihgwf04sy01p8tjw289a9"
const EXPECTED_TITLE = "ACADEMIA DE NATACIÓN (VMT/FDNDA) - DEL 1 AL 30 DE SEPTIEMBRE"
const EXPECTED_SUCURSAL = "04"
const EXPECTED_START = "2026-09-01"
const EXPECTED_END = "2026-09-30"

// Código de horario Servilex -> cupo indicado en el Excel.
const CAPACITY_BY_SCHEDULE_CODE: Record<string, number> = {
    // Lunes, miércoles y viernes
    "000001": 30,
    "000002": 25,
    "000003": 20,
    "000004": 20,
    "000005": 20,
    "000008": 20,
    "000009": 20,
    "000010": 40,
    "000011": 55,
    "000012": 55,
    "000013": 55,
    "000077": 55,
    "000148": 55,

    // Martes, jueves y sábado
    "000075": 20,
    "000014": 20,
    "000040": 25,
    "000041": 25,
    "000042": 25,
    "000076": 25,

    // Martes y jueves
    "000079": 15,
    "000025": 15,
    "000026": 15,
    "000027": 15,
    "000028": 15,
    "000031": 15,
    "000021": 15,
    "000022": 25,
    "000023": 40,
    "000024": 40,
    "000081": 25,
    "000078": 25,
    "000149": 25,

    // Sábado
    "000080": 50,
    "000032": 50,
    "000033": 45,
    "000034": 45,
    "000035": 45,
    "000036": 45,
    "000037": 45,
    "000038": 45,
}

async function main() {
    const confirm = process.argv.includes("--confirm")
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error("Falta DATABASE_URL")
    const client = new pg.Client({ connectionString })

    try {
        await client.connect()
        console.log(`[vmt-cupos] ${confirm ? "WRITE" : "DRY RUN"}: consultando evento...`)
        const eventResult = await client.query<{
            id: string
            title: string
            category: string
            servilex_sucursal_code: string | null
            start_date: string
            end_date: string
        }>(`
            SELECT id, title, category::text AS category,
                   "servilexSucursalCode" AS servilex_sucursal_code,
                   to_char("startDate", 'YYYY-MM-DD') AS start_date,
                   to_char("endDate", 'YYYY-MM-DD') AS end_date
            FROM events
            WHERE id = $1
        `, [EVENT_ID])
        const event = eventResult.rows[0]
        console.log("[vmt-cupos] Evento cargado; validando matriz de cupos...")

        if (!event) throw new Error(`No existe el evento ${EVENT_ID}`)
        if (event.title !== EXPECTED_TITLE) throw new Error(`Título inesperado: ${event.title}`)
        if (event.category !== "ACADEMIA") throw new Error(`Categoría inesperada: ${event.category}`)
        if (event.servilex_sucursal_code !== EXPECTED_SUCURSAL) {
            throw new Error(`Sede inesperada: ${event.servilex_sucursal_code ?? "-"}`)
        }
        if (event.start_date !== EXPECTED_START || event.end_date !== EXPECTED_END) {
            throw new Error(`Rango inesperado: ${event.start_date} a ${event.end_date}`)
        }

        const ticketResult = await client.query<{
            id: string
            name: string
            capacity: number
            sold: number
            is_active: boolean
            servilex_schedule_code: string | null
        }>(`
            SELECT id, name, capacity, sold, "isActive" AS is_active,
                   "servilexScheduleCode" AS servilex_schedule_code
            FROM ticket_types
            WHERE "eventId" = $1
            ORDER BY "sortOrder", name
        `, [EVENT_ID])
        const ticketTypes = ticketResult.rows

        const expectedCodes = new Set(Object.keys(CAPACITY_BY_SCHEDULE_CODE))
        const actualCodes = new Set(ticketTypes.map((ticket) => ticket.servilex_schedule_code ?? ""))
        const missing = [...expectedCodes].filter((code) => !actualCodes.has(code))
        const extra = ticketTypes.filter(
            (ticket) => !ticket.servilex_schedule_code || !expectedCodes.has(ticket.servilex_schedule_code),
        )
        if (missing.length > 0) throw new Error(`Faltan códigos en el evento: ${missing.join(", ")}`)
        if (extra.length > 0) {
            throw new Error(`Hay horarios no contemplados: ${extra.map((ticket) => ticket.name).join(" | ")}`)
        }
        if (ticketTypes.length !== expectedCodes.size) {
            throw new Error(`Se esperaban ${expectedCodes.size} horarios y se encontraron ${ticketTypes.length}`)
        }

        const duplicateCodes = ticketTypes
            .map((ticket) => ticket.servilex_schedule_code ?? "")
            .filter((code, index, all) => all.indexOf(code) !== index)
        if (duplicateCodes.length > 0) {
            throw new Error(`Códigos duplicados: ${[...new Set(duplicateCodes)].join(", ")}`)
        }

        const plan = ticketTypes.map((ticket) => {
            const code = ticket.servilex_schedule_code as string
            const desiredCapacity = CAPACITY_BY_SCHEDULE_CODE[code]
            if (ticket.sold > desiredCapacity) {
                throw new Error(`${ticket.name}: vendidos=${ticket.sold}, nuevo cupo=${desiredCapacity}`)
            }
            return { ...ticket, code, desiredCapacity }
        })

        console.table(
            plan.map((ticket) => ({
                codigo: ticket.code,
                horario: ticket.name,
                anterior: ticket.capacity,
                nuevo: ticket.desiredCapacity,
                vendidos: ticket.sold,
                cambia: ticket.capacity !== ticket.desiredCapacity ? "SÍ" : "no",
            })),
        )

        const changes = plan.filter((ticket) => ticket.capacity !== ticket.desiredCapacity)
        console.log(`\n${changes.length} de ${plan.length} horarios requieren cambio.`)

        if (!confirm) {
            console.log("DRY RUN: no se modificó la base de datos. Usa --confirm para aplicar.")
            return
        }

        await client.query("BEGIN")
        try {
            for (const ticket of changes) {
                const result = await client.query(`
                    UPDATE ticket_types
                    SET capacity = $1, "updatedAt" = NOW()
                    WHERE id = $2 AND "eventId" = $3 AND capacity = $4 AND sold = $5
                      AND "servilexScheduleCode" = $6
                `, [ticket.desiredCapacity, ticket.id, EVENT_ID, ticket.capacity, ticket.sold, ticket.code])
                if (result.rowCount !== 1) {
                    throw new Error(`El horario ${ticket.code} cambió durante la operación; se revierte todo.`)
                }
            }
            await client.query("COMMIT")
        } catch (error) {
            await client.query("ROLLBACK")
            throw error
        }

        const verificationResult = await client.query<{
            servilex_schedule_code: string | null
            capacity: number
        }>(`
            SELECT "servilexScheduleCode" AS servilex_schedule_code, capacity
            FROM ticket_types WHERE "eventId" = $1
        `, [EVENT_ID])
        const mismatches = verificationResult.rows.filter(
            (ticket) =>
                !ticket.servilex_schedule_code ||
                CAPACITY_BY_SCHEDULE_CODE[ticket.servilex_schedule_code] !== ticket.capacity,
        )
        if (verificationResult.rows.length !== expectedCodes.size || mismatches.length > 0) {
            throw new Error("La verificación posterior no coincide con los 40 cupos esperados.")
        }

        console.log(`APLICADO Y VERIFICADO: ${changes.length} cupos actualizados; ${plan.length} horarios conformes.`)
    } finally {
        await client.end().catch(() => undefined)
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
