/**
 * Configura PISCINA LIBRE SETIEMBRE 2026 (1HR) - VMT FDNDA.
 *
 * Dry-run por defecto. Usa --confirm para crear los cinco horarios y su
 * inventario diario. El evento queda sin publicar para que la publicacion siga
 * siendo una decision administrativa separada.
 */

import crypto from "node:crypto"
import pg from "pg"

const EVENT_ID = "cmt7jkqf2001j01qjowo49t57"
const EVENT_SLUG = "piscina-libre-setiembre-2026-1hr-vmt-fdnda"
const EXPECTED_TITLE = "PISCINA LIBRE SETIEMBRE 2026 (1HR) - VMT FDNDA"
const EXPECTED_START = "2026-09-01"
const EXPECTED_END = "2026-09-30"
const SUCURSAL_CODE = "04"
const SERVICE_CODE = "I88"
const DISCIPLINE_CODE = "00"
const POOL_CODE = "01"
const PRICE = 20
const CAPACITY = 15
const CONFIRM = process.argv.includes("--confirm")

type Slot = {
    name: string
    startTime: string
    endTime: string
    scheduleCode: string
}

// Codigos ABIO cuyo catalogo indica exactamente lunes a viernes y una hora.
const SLOTS: Slot[] = [
    { name: "08:00 - 09:00", startTime: "08:00", endTime: "09:00", scheduleCode: "000356" },
    { name: "09:00 - 10:00", startTime: "09:00", endTime: "10:00", scheduleCode: "000357" },
    { name: "10:00 - 11:00", startTime: "10:00", endTime: "11:00", scheduleCode: "000358" },
    { name: "13:00 - 14:00", startTime: "13:00", endTime: "14:00", scheduleCode: "000303" },
    { name: "14:00 - 15:00", startTime: "14:00", endTime: "15:00", scheduleCode: "000214" },
]

type EventRow = {
    id: string
    slug: string
    title: string
    category: string
    sucursal: string
    start_date: string
    end_date: string
    is_published: boolean
}

type TicketRow = {
    id: string
    name: string
    price: string
    capacity: number
    sold: number
    is_active: boolean
    sort_order: number
    enabled: boolean
    indicator: string | null
    sucursal: string | null
    service: string | null
    discipline: string | null
    schedule: string | null
    pool: string | null
    extra: unknown
}

type InventoryRow = {
    ticket_type_id: string
    date: string
    capacity: number
    sold: number
    is_enabled: boolean
}

function listDateKeys(from: string, to: string): string[] {
    const dates: string[] = []
    const current = new Date(`${from}T12:00:00Z`)
    const end = new Date(`${to}T12:00:00Z`)
    while (current <= end) {
        dates.push(current.toISOString().slice(0, 10))
        current.setUTCDate(current.getUTCDate() + 1)
    }
    return dates
}

function isWeekday(dateKey: string): boolean {
    const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay()
    return day >= 1 && day <= 5
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function assertEvent(event: EventRow | undefined): asserts event is EventRow {
    if (!event) throw new Error(`No existe el evento ${EVENT_ID}`)
    if (event.slug !== EVENT_SLUG) throw new Error(`Slug inesperado: ${event.slug}`)
    if (event.title !== EXPECTED_TITLE) throw new Error(`Titulo inesperado: ${event.title}`)
    if (event.category !== "PISCINA_LIBRE") throw new Error(`Categoria inesperada: ${event.category}`)
    if (event.sucursal !== SUCURSAL_CODE) throw new Error(`Sucursal inesperada: ${event.sucursal}`)
    if (event.start_date !== EXPECTED_START || event.end_date !== EXPECTED_END) {
        throw new Error(`Rango inesperado: ${event.start_date} a ${event.end_date}`)
    }
}

async function fetchTargetState(client: pg.Client) {
    const tickets = await client.query<TicketRow>(`
        SELECT id, name, price::text AS price, capacity, sold,
               "isActive" AS is_active, "sortOrder" AS sort_order,
               "servilexEnabled" AS enabled,
               "servilexIndicator" AS indicator,
               "servilexSucursalCode" AS sucursal,
               "servilexServiceCode" AS service,
               "servilexDisciplineCode" AS discipline,
               "servilexScheduleCode" AS schedule,
               "servilexPoolCode" AS pool,
               "servilexExtraConfig" AS extra
        FROM ticket_types
        WHERE "eventId" = $1
        ORDER BY "sortOrder", name
    `, [EVENT_ID])

    const inventories = await client.query<InventoryRow>(`
        SELECT inv."ticketTypeId" AS ticket_type_id,
               to_char(inv.date, 'YYYY-MM-DD') AS date,
               inv.capacity, inv.sold, inv."isEnabled" AS is_enabled
        FROM ticket_type_date_inventories inv
        JOIN ticket_types tt ON tt.id = inv."ticketTypeId"
        WHERE tt."eventId" = $1
        ORDER BY inv.date, tt."sortOrder"
    `, [EVENT_ID])

    return { tickets: tickets.rows, inventories: inventories.rows }
}

function stateMismatches(state: Awaited<ReturnType<typeof fetchTargetState>>): string[] {
    const mismatches: string[] = []
    const dates = listDateKeys(EXPECTED_START, EXPECTED_END)
    const ticketBySchedule = new Map(state.tickets.map((ticket) => [ticket.schedule, ticket]))

    if (state.tickets.length !== SLOTS.length) {
        mismatches.push(`tipos encontrados=${state.tickets.length}; esperados=${SLOTS.length}`)
    }

    for (const [index, slot] of SLOTS.entries()) {
        const ticket = ticketBySchedule.get(slot.scheduleCode)
        if (!ticket) {
            mismatches.push(`${slot.scheduleCode}: falta el tipo de entrada`)
            continue
        }
        const extra = asRecord(ticket.extra)
        const fieldsMatch =
            ticket.name === slot.name &&
            Number(ticket.price) === PRICE &&
            ticket.capacity === CAPACITY &&
            ticket.sold === 0 &&
            ticket.is_active &&
            ticket.sort_order === index + 1 &&
            ticket.enabled &&
            ticket.indicator === "PN" &&
            ticket.sucursal === SUCURSAL_CODE &&
            ticket.service === SERVICE_CODE &&
            ticket.discipline === DISCIPLINE_CODE &&
            ticket.pool === POOL_CODE &&
            extra.horaInicio === slot.startTime &&
            extra.horaFin === slot.endTime &&
            Number(extra.cantidad) === 1 &&
            Number(extra.duracion) === 1
        if (!fieldsMatch) mismatches.push(`${slot.scheduleCode}: configuracion distinta`)

        const inventoryByDate = new Map(
            state.inventories
                .filter((row) => row.ticket_type_id === ticket.id)
                .map((row) => [row.date, row]),
        )
        if (inventoryByDate.size !== dates.length) {
            mismatches.push(`${slot.scheduleCode}: inventarios=${inventoryByDate.size}; esperados=${dates.length}`)
        }
        for (const date of dates) {
            const row = inventoryByDate.get(date)
            if (
                !row ||
                row.capacity !== CAPACITY ||
                row.sold !== 0 ||
                row.is_enabled !== isWeekday(date)
            ) {
                mismatches.push(`${slot.scheduleCode}: inventario incorrecto en ${date}`)
            }
        }
    }
    return mismatches
}

async function main() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error("Falta DATABASE_URL")
    const client = new pg.Client({ connectionString })

    try {
        await client.connect()

        const eventResult = await client.query<EventRow>(`
            SELECT id, slug, title, category::text AS category,
                   "servilexSucursalCode" AS sucursal,
                   to_char("startDate", 'YYYY-MM-DD') AS start_date,
                   to_char("endDate", 'YYYY-MM-DD') AS end_date,
                   "isPublished" AS is_published
            FROM events WHERE id = $1
        `, [EVENT_ID])
        const event = eventResult.rows[0]
        assertEvent(event)

        const serviceResult = await client.query(`
            SELECT id FROM abio_catalog_services
            WHERE "sucursalCodigo" = $1
              AND "servicioCodigo" = $2
              AND "servicioDescripcion" ILIKE '%PISCINA LIBRE%'
              AND "isActive" = true
        `, [SUCURSAL_CODE, SERVICE_CODE])
        if (serviceResult.rowCount !== 1) {
            throw new Error(`El servicio ABIO ${SERVICE_CODE} no esta activo para VMT`)
        }

        const scheduleResult = await client.query<{
            schedule: string
            start_time: string | null
            end_time: string | null
            duration: string | null
            lunes: string | null
            martes: string | null
            miercoles: string | null
            jueves: string | null
            viernes: string | null
            sabado: string | null
            domingo: string | null
        }>(`
            SELECT "horarioCodigo" AS schedule,
                   "horaInicio" AS start_time, "horaFin" AS end_time,
                   "duracionHoras"::text AS duration,
                   lunes, martes, miercoles, jueves, viernes, sabado, domingo
            FROM abio_catalog_schedules
            WHERE "disciplinaCodigo" = $1
              AND "horarioCodigo" = ANY($2::text[])
              AND "isActive" = true
        `, [DISCIPLINE_CODE, SLOTS.map((slot) => slot.scheduleCode)])

        if (scheduleResult.rows.length !== SLOTS.length) {
            throw new Error(`Catalogo ABIO incompleto: ${scheduleResult.rows.length} de ${SLOTS.length} horarios`)
        }
        const catalogByCode = new Map(scheduleResult.rows.map((row) => [row.schedule, row]))
        for (const slot of SLOTS) {
            const catalog = catalogByCode.get(slot.scheduleCode)
            const weekdaysMatch =
                Boolean(catalog?.lunes) && Boolean(catalog?.martes) &&
                Boolean(catalog?.miercoles) && Boolean(catalog?.jueves) &&
                Boolean(catalog?.viernes) && !catalog?.sabado && !catalog?.domingo
            if (
                !catalog || catalog.start_time !== slot.startTime ||
                catalog.end_time !== slot.endTime || Number(catalog.duration) !== 1 ||
                !weekdaysMatch
            ) {
                throw new Error(`El horario ${slot.scheduleCode} ya no coincide con ${slot.name}, lunes a viernes`)
            }
        }

        const state = await fetchTargetState(client)
        if (state.tickets.length > 0) {
            const mismatches = stateMismatches(state)
            if (mismatches.length > 0) {
                throw new Error(`El evento ya tiene una configuracion distinta:\n- ${mismatches.slice(0, 10).join("\n- ")}`)
            }
            console.log("NOOP: los cinco horarios y sus inventarios ya estan configurados correctamente.")
            return
        }
        if (state.inventories.length > 0) throw new Error("Hay inventarios huerfanos inesperados")

        const dates = listDateKeys(EXPECTED_START, EXPECTED_END)
        const ticketPayload = SLOTS.map((slot, index) => ({
            id: crypto.randomUUID(),
            name: slot.name,
            sort_order: index + 1,
            schedule: slot.scheduleCode,
            extra: {
                cantidad: 1,
                horaInicio: slot.startTime,
                horaFin: slot.endTime,
                duracion: 1,
            },
        }))
        const inventoryPayload = ticketPayload.flatMap((ticket) =>
            dates.map((date) => ({
                id: crypto.randomUUID(),
                ticket_type_id: ticket.id,
                date,
                capacity: CAPACITY,
                is_enabled: isWeekday(date),
            })),
        )

        console.log(CONFIRM ? "WRITE" : "DRY RUN")
        console.log(`${event.title} (${event.slug})`)
        console.log(`Publicado: ${event.is_published ? "SI" : "NO"} (no se cambiara)`)
        console.table(SLOTS.map((slot) => ({
            horario: slot.name,
            codigo_horario: slot.scheduleCode,
            servicio_piscina_libre: SERVICE_CODE,
            piscina: POOL_CODE,
            precio: PRICE,
            cupo_diario: CAPACITY,
        })))
        console.log(`Fechas: ${dates.length}; dias L-V abiertos: ${dates.filter(isWeekday).length}; fin de semana cerrados: ${dates.filter((date) => !isWeekday(date)).length}`)
        console.log(`Inventarios: ${inventoryPayload.length} (${inventoryPayload.filter((row) => row.is_enabled).length} abiertos, ${inventoryPayload.filter((row) => !row.is_enabled).length} cerrados)`)

        if (!CONFIRM) {
            console.log("DRY RUN OK: no se escribio nada. Usa --confirm para aplicar.")
            return
        }

        await client.query("BEGIN")
        try {
            await client.query(`
                WITH input AS (
                    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                        id text, name text, sort_order integer,
                        schedule text, extra jsonb
                    )
                )
                INSERT INTO ticket_types (
                    id, "eventId", name, price, currency, capacity, sold,
                    "capacityByDate", "isPackage", "validDays", "isActive", "sortOrder",
                    "servilexEnabled", "servilexIndicator", "servilexSucursalCode",
                    "servilexServiceCode", "servilexDisciplineCode",
                    "servilexScheduleCode", "servilexPoolCode", "servilexExtraConfig",
                    "createdAt", "updatedAt"
                )
                SELECT id, $2, name, $3, 'PEN', $4, 0,
                       false, false, '[]'::jsonb, true, sort_order,
                       true, 'PN', $5, $6, $7, schedule, $8, extra, NOW(), NOW()
                FROM input
            `, [
                JSON.stringify(ticketPayload), EVENT_ID, PRICE, CAPACITY,
                SUCURSAL_CODE, SERVICE_CODE, DISCIPLINE_CODE, POOL_CODE,
            ])

            await client.query(`
                WITH input AS (
                    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                        id text, ticket_type_id text, date date,
                        capacity integer, is_enabled boolean
                    )
                )
                INSERT INTO ticket_type_date_inventories (
                    id, "ticketTypeId", date, capacity, sold, "isEnabled",
                    "createdAt", "updatedAt"
                )
                SELECT id, ticket_type_id, date, capacity, 0, is_enabled, NOW(), NOW()
                FROM input
            `, [JSON.stringify(inventoryPayload)])

            await client.query("COMMIT")
        } catch (error) {
            await client.query("ROLLBACK")
            throw error
        }

        const verification = await fetchTargetState(client)
        const mismatches = stateMismatches(verification)
        if (mismatches.length > 0) {
            throw new Error(`Verificacion posterior fallida:\n- ${mismatches.slice(0, 10).join("\n- ")}`)
        }
        console.log(`APLICADO Y VERIFICADO: ${verification.tickets.length} horarios y ${verification.inventories.length} inventarios diarios.`)
    } finally {
        await client.end().catch(() => undefined)
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
