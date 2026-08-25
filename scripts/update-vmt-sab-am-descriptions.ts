/**
 * Agrega la nota "Coordinar en mesa de control el horario sabatino" a la
 * descripción de las entradas de Academia VMT cuya frecuencia es Mar-Jue-Sáb
 * con sábado por la mañana sin hora fija (las que se llaman ".../ SÁB AM").
 *
 * Dry-run por defecto; usar --confirm para aplicar. Idempotente: si la nota ya
 * está presente, el horario se reporta como conforme y no se toca.
 *
 *   node --env-file=.env.production .\node_modules\tsx\dist\cli.mjs \
 *     --tsconfig tsconfig.json scripts/update-vmt-sab-am-descriptions.ts
 *   node --env-file=.env.production .\node_modules\tsx\dist\cli.mjs \
 *     --tsconfig tsconfig.json scripts/update-vmt-sab-am-descriptions.ts --confirm
 */

import pg from "pg"

const EVENT_ID = "cmsqihgwf04sy01p8tjw289a9"
const EXPECTED_TITLE = "ACADEMIA DE NATACIÓN (VMT/FDNDA) - DEL 1 AL 30 DE SEPTIEMBRE"
const EXPECTED_SUCURSAL = "04"

const NOTE = "Coordinar en mesa de control el horario sabatino"

// Códigos de horario Servilex (Mar-Jue + sábado AM, 5 a 17 años). El sábado no
// tiene hora fija en el nombre: por eso se coordina en mesa de control.
const TARGET_SCHEDULE_CODES = ["000040", "000041", "000042", "000076"] as const

/** Marca que identifica a estos horarios en el nombre; se valida antes de escribir. */
const NAME_MARKER = "SÁB AM"

async function main() {
    const confirm = process.argv.includes("--confirm")
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error("Falta DATABASE_URL")
    const client = new pg.Client({ connectionString })

    try {
        await client.connect()
        console.log(`[vmt-sab-am] ${confirm ? "WRITE" : "DRY RUN"}: consultando evento...`)

        const eventResult = await client.query<{
            id: string
            title: string
            category: string
            servilex_sucursal_code: string | null
        }>(`
            SELECT id, title, category::text AS category,
                   "servilexSucursalCode" AS servilex_sucursal_code
            FROM events
            WHERE id = $1
        `, [EVENT_ID])
        const event = eventResult.rows[0]

        if (!event) throw new Error(`No existe el evento ${EVENT_ID}`)
        if (event.title !== EXPECTED_TITLE) throw new Error(`Título inesperado: ${event.title}`)
        if (event.category !== "ACADEMIA") throw new Error(`Categoría inesperada: ${event.category}`)
        if (event.servilex_sucursal_code !== EXPECTED_SUCURSAL) {
            throw new Error(`Sede inesperada: ${event.servilex_sucursal_code ?? "-"}`)
        }

        const ticketResult = await client.query<{
            id: string
            name: string
            description: string | null
            servilex_schedule_code: string
        }>(`
            SELECT id, name, description, "servilexScheduleCode" AS servilex_schedule_code
            FROM ticket_types
            WHERE "eventId" = $1 AND "servilexScheduleCode" = ANY($2::text[])
            ORDER BY "sortOrder", name
        `, [EVENT_ID, [...TARGET_SCHEDULE_CODES]])
        const ticketTypes = ticketResult.rows

        if (ticketTypes.length !== TARGET_SCHEDULE_CODES.length) {
            const found = new Set(ticketTypes.map((ticket) => ticket.servilex_schedule_code))
            const missing = TARGET_SCHEDULE_CODES.filter((code) => !found.has(code))
            throw new Error(`Faltan horarios en el evento: ${missing.join(", ")}`)
        }

        const wrongName = ticketTypes.filter((ticket) => !ticket.name.toUpperCase().includes(NAME_MARKER))
        if (wrongName.length > 0) {
            throw new Error(
                `Estos horarios ya no dicen "${NAME_MARKER}": ${wrongName.map((t) => `${t.servilex_schedule_code} ${t.name}`).join(" | ")}`,
            )
        }

        const plan = ticketTypes.map((ticket) => {
            const current = ticket.description
            const alreadyHasNote = (current ?? "").includes(NOTE)
            // description está vacía en estos horarios: la nota pasa a ser la
            // descripción. Si alguien escribió algo desde el admin, se conserva
            // y la nota se agrega en una línea nueva.
            const base = (current ?? "").trim()
            const desired = alreadyHasNote ? current : base ? `${base}\n${NOTE}` : NOTE
            return { ...ticket, current, desired, changes: desired !== current }
        })

        console.table(
            plan.map((ticket) => ({
                codigo: ticket.servilex_schedule_code,
                horario: ticket.name,
                antes: ticket.current ?? "(vacío)",
                despues: ticket.desired ?? "(vacío)",
                cambia: ticket.changes ? "SÍ" : "no",
            })),
        )

        const changes = plan.filter((ticket) => ticket.changes)
        console.log(`\n${changes.length} de ${plan.length} horarios requieren cambio.`)

        if (!confirm) {
            console.log("DRY RUN: no se modificó la base de datos. Usa --confirm para aplicar.")
            return
        }
        if (changes.length === 0) {
            console.log("Nada que aplicar: todos los horarios ya tienen la nota.")
            return
        }

        await client.query("BEGIN")
        try {
            for (const ticket of changes) {
                const result = await client.query(`
                    UPDATE ticket_types
                    SET description = $1, "updatedAt" = NOW()
                    WHERE id = $2 AND "eventId" = $3
                      AND "servilexScheduleCode" = $4
                      AND description IS NOT DISTINCT FROM $5
                `, [ticket.desired, ticket.id, EVENT_ID, ticket.servilex_schedule_code, ticket.current])
                if (result.rowCount !== 1) {
                    throw new Error(`El horario ${ticket.servilex_schedule_code} cambió durante la operación; se revierte todo.`)
                }
            }
            await client.query("COMMIT")
        } catch (error) {
            await client.query("ROLLBACK")
            throw error
        }

        const verificationResult = await client.query<{
            servilex_schedule_code: string
            description: string | null
        }>(`
            SELECT "servilexScheduleCode" AS servilex_schedule_code, description
            FROM ticket_types
            WHERE "eventId" = $1 AND "servilexScheduleCode" = ANY($2::text[])
        `, [EVENT_ID, [...TARGET_SCHEDULE_CODES]])
        const mismatches = verificationResult.rows.filter((ticket) => !(ticket.description ?? "").includes(NOTE))
        if (verificationResult.rows.length !== TARGET_SCHEDULE_CODES.length || mismatches.length > 0) {
            throw new Error("La verificación posterior no encontró la nota en los 4 horarios esperados.")
        }

        console.log(`APLICADO Y VERIFICADO: ${changes.length} descripciones actualizadas; ${plan.length} horarios conformes.`)
    } finally {
        await client.end().catch(() => undefined)
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
