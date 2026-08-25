/** Ajusta a 15 los cupos de todos los horarios de piscina libre VMT setiembre. */

import pg from "pg"

const EVENT_ID = "cmt7jkqf2001j01qjowo49t57"
const EXPECTED_TITLE = "PISCINA LIBRE SETIEMBRE 2026 (1HR) - VMT FDNDA"
const EXPECTED_SCHEDULES = ["000356", "000357", "000358", "000303", "000214"]
const CAPACITY = 15
const CONFIRM = process.argv.includes("--confirm")

async function main() {
    if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL")
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

    try {
        await client.connect()
        const eventResult = await client.query<{
            title: string
            category: string
            sucursal: string
        }>(`
            SELECT title, category::text AS category,
                   "servilexSucursalCode" AS sucursal
            FROM events WHERE id = $1
        `, [EVENT_ID])
        const event = eventResult.rows[0]
        if (!event) throw new Error(`No existe el evento ${EVENT_ID}`)
        if (event.title !== EXPECTED_TITLE || event.category !== "PISCINA_LIBRE" || event.sucursal !== "04") {
            throw new Error("El evento destino no coincide con Piscina Libre VMT setiembre")
        }

        const tickets = await client.query<{
            id: string
            name: string
            schedule: string | null
            capacity: number
            sold: number
        }>(`
            SELECT id, name, "servilexScheduleCode" AS schedule, capacity, sold
            FROM ticket_types
            WHERE "eventId" = $1
            ORDER BY "sortOrder", name
        `, [EVENT_ID])
        if (tickets.rows.length !== EXPECTED_SCHEDULES.length) {
            throw new Error(`Se esperaban ${EXPECTED_SCHEDULES.length} horarios; existen ${tickets.rows.length}`)
        }
        const actualSchedules = new Set(tickets.rows.map((ticket) => ticket.schedule ?? ""))
        const missing = EXPECTED_SCHEDULES.filter((code) => !actualSchedules.has(code))
        if (missing.length > 0) throw new Error(`Faltan horarios ABIO: ${missing.join(", ")}`)
        const unsafeTickets = tickets.rows.filter((ticket) => ticket.sold > CAPACITY)
        if (unsafeTickets.length > 0) {
            throw new Error(`Hay horarios con mas de ${CAPACITY} vendidos: ${unsafeTickets.map((ticket) => ticket.name).join(", ")}`)
        }

        const inventory = await client.query<{
            rows_count: number
            max_sold: number
            above_capacity: number
        }>(`
            SELECT COUNT(*)::int AS rows_count,
                   COALESCE(MAX(inv.sold), 0)::int AS max_sold,
                   COUNT(*) FILTER (WHERE inv.sold > $2)::int AS above_capacity
            FROM ticket_type_date_inventories inv
            JOIN ticket_types tt ON tt.id = inv."ticketTypeId"
            WHERE tt."eventId" = $1
        `, [EVENT_ID, CAPACITY])
        const inventoryState = inventory.rows[0]
        if (inventoryState.rows_count !== 150) {
            throw new Error(`Se esperaban 150 inventarios; existen ${inventoryState.rows_count}`)
        }
        if (inventoryState.above_capacity > 0) {
            throw new Error(`${inventoryState.above_capacity} inventarios tienen mas de ${CAPACITY} vendidos`)
        }

        console.log(CONFIRM ? "WRITE" : "DRY RUN")
        console.table(tickets.rows.map((ticket) => ({
            horario: ticket.name,
            codigo: ticket.schedule,
            cupo_actual: ticket.capacity,
            cupo_nuevo: CAPACITY,
            vendidos: ticket.sold,
        })))
        console.log(`Inventarios: ${inventoryState.rows_count}; maximo vendido por fecha: ${inventoryState.max_sold}`)

        if (!CONFIRM) {
            console.log("DRY RUN OK: no se escribio nada. Usa --confirm para aplicar.")
            return
        }

        await client.query("BEGIN")
        try {
            const ticketUpdate = await client.query(`
                UPDATE ticket_types
                SET capacity = $2, "updatedAt" = NOW()
                WHERE "eventId" = $1 AND sold <= $2
            `, [EVENT_ID, CAPACITY])
            if (ticketUpdate.rowCount !== EXPECTED_SCHEDULES.length) {
                throw new Error(`Solo se actualizaron ${ticketUpdate.rowCount} tipos de entrada`)
            }

            const inventoryUpdate = await client.query(`
                UPDATE ticket_type_date_inventories inv
                SET capacity = $2, "updatedAt" = NOW()
                FROM ticket_types tt
                WHERE tt.id = inv."ticketTypeId"
                  AND tt."eventId" = $1
                  AND inv.sold <= $2
            `, [EVENT_ID, CAPACITY])
            if (inventoryUpdate.rowCount !== inventoryState.rows_count) {
                throw new Error(`Solo se actualizaron ${inventoryUpdate.rowCount} inventarios`)
            }
            await client.query("COMMIT")
        } catch (error) {
            await client.query("ROLLBACK")
            throw error
        }

        const verification = await client.query<{
            ticket_mismatches: number
            inventory_mismatches: number
        }>(`
            SELECT
                (SELECT COUNT(*)::int FROM ticket_types
                 WHERE "eventId" = $1 AND capacity <> $2) AS ticket_mismatches,
                (SELECT COUNT(*)::int
                 FROM ticket_type_date_inventories inv
                 JOIN ticket_types tt ON tt.id = inv."ticketTypeId"
                 WHERE tt."eventId" = $1 AND inv.capacity <> $2) AS inventory_mismatches
        `, [EVENT_ID, CAPACITY])
        const result = verification.rows[0]
        if (result.ticket_mismatches !== 0 || result.inventory_mismatches !== 0) {
            throw new Error("La verificacion posterior encontro cupos distintos de 15")
        }
        console.log("APLICADO Y VERIFICADO: 5 horarios y 150 inventarios con cupo 15.")
    } finally {
        await client.end().catch(() => undefined)
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
