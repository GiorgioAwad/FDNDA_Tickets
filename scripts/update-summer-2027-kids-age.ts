/**
 * Preventas verano 2027 (CDM, VIDENA, VMT): la categoría de niños pasa de
 * "5 a 17 años" a "6 a 17 años" (pedido 2026-11-26).
 *
 * - events.description de preventa-N-verano-2027-*: "Niños de 5 a 17 años" → "6 a 17".
 * - Horarios ya guardados (Ticket.membershipSchedule y OrderItem.attendeeData[].membershipSchedule)
 *   de VERANO_2027_3X/2X: categoryLabel "Niños (5 a 17 años)" → "Niños (6 a 17 años)".
 *   Solo es la etiqueta que se muestra; la validación usa category = NINOS.
 *
 * Dry run por defecto; --apply escribe y verifica que no quede "5 a 17".
 */
import fs from "node:fs"
import path from "node:path"
import pg from "pg"
import { Redis } from "@upstash/redis"

const apply = process.argv.includes("--apply")
const OLD_DESC = "Niños de 5 a 17 años"
const NEW_DESC = "Niños de 6 a 17 años"
const OLD_LABEL = "Niños (5 a 17 años)"
const NEW_LABEL = "Niños (6 a 17 años)"
const KEYS = ["VERANO_2027_3X", "VERANO_2027_2X"]

const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const envValue = (key: string) => env.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?`, "m"))?.[1]
const client = new pg.Client({ connectionString: envValue("DATABASE_URL"), connectionTimeoutMillis: 15000 })

type Json = Record<string, unknown>
const relabel = (schedule: unknown): unknown =>
    schedule && typeof schedule === "object" && (schedule as Json).categoryLabel === OLD_LABEL
        ? { ...(schedule as Json), categoryLabel: NEW_LABEL }
        : schedule

async function main() {
    let inTransaction = false
    try {
        await client.connect()
        await client.query(apply ? "BEGIN" : "BEGIN READ ONLY")
        inTransaction = true
        const events = (await client.query(`SELECT id,slug,description FROM events WHERE slug LIKE 'preventa-_-verano-2027-%' AND description LIKE $1 ${apply ? "FOR UPDATE" : ""}`, [`%${OLD_DESC}%`])).rows
        const tickets = (await client.query(`SELECT t.id FROM tickets t JOIN ticket_types tt ON tt.id=t."ticketTypeId"
            WHERE tt."membershipScheduleKey" = ANY($1) AND t."membershipSchedule"->>'categoryLabel' = $2 ${apply ? "FOR UPDATE OF t" : ""}`, [KEYS, OLD_LABEL])).rows
        const items = (await client.query(`SELECT oi.id,oi."attendeeData" FROM order_items oi JOIN ticket_types tt ON tt.id=oi."ticketTypeId"
            WHERE tt."membershipScheduleKey" = ANY($1) AND oi."attendeeData"::text LIKE $2 ${apply ? "FOR UPDATE OF oi" : ""}`, [KEYS, `%${OLD_LABEL}%`])).rows

        console.log(`${apply ? "APPLY" : "DRY RUN"}: ${events.length} descripciones de evento, ${tickets.length} carnets, ${items.length} detalles de orden`)
        for (const e of events) console.log(`  - ${e.slug}`)
        if (!apply) {
            await client.query("ROLLBACK")
            inTransaction = false
            console.log("DRY RUN: no se escribió nada. Repite con --apply.")
            return
        }

        for (const e of events) {
            await client.query(`UPDATE events SET description=$2,"updatedAt"=NOW() WHERE id=$1`, [e.id, e.description.split(OLD_DESC).join(NEW_DESC)])
        }
        await client.query(`UPDATE tickets SET "membershipSchedule"=jsonb_set("membershipSchedule",'{categoryLabel}',to_jsonb($2::text)),"updatedAt"=NOW()
            WHERE id = ANY($1)`, [tickets.map(t => t.id), NEW_LABEL])
        for (const item of items) {
            const data = Array.isArray(item.attendeeData)
                ? item.attendeeData.map((a: Json) => (a && typeof a === "object" ? { ...a, membershipSchedule: relabel(a.membershipSchedule) } : a))
                : item.attendeeData
            await client.query(`UPDATE order_items SET "attendeeData"=$2::jsonb WHERE id=$1`, [item.id, JSON.stringify(data)])
        }

        const left = (await client.query(`SELECT
            (SELECT count(*)::int FROM events WHERE slug LIKE 'preventa-_-verano-2027-%' AND description LIKE $1) AS events,
            (SELECT count(*)::int FROM tickets t JOIN ticket_types tt ON tt.id=t."ticketTypeId" WHERE tt."membershipScheduleKey" = ANY($3) AND t."membershipSchedule"->>'categoryLabel' = $2) AS tickets,
            (SELECT count(*)::int FROM order_items oi JOIN ticket_types tt ON tt.id=oi."ticketTypeId" WHERE tt."membershipScheduleKey" = ANY($3) AND oi."attendeeData"::text LIKE $4) AS items`,
            [`%${OLD_DESC}%`, OLD_LABEL, KEYS, `%${OLD_LABEL}%`])).rows[0]
        if (left.events || left.tickets || left.items) throw new Error(`Quedan textos sin cambiar: ${JSON.stringify(left)}`)
        await client.query("COMMIT")
        inTransaction = false
        console.log("OK: actualizado y verificado.")

        // Caché del listado/ficha de eventos (como el admin al guardar).
        const url = envValue("UPSTASH_REDIS_REST_URL")
        const token = envValue("UPSTASH_REDIS_REST_TOKEN")
        if (url && token && events.length) {
            const redis = new Redis({ url, token })
            const listKeys = (await redis.smembers("cache:ns:events:list")) as string[]
            await redis.del(...events.flatMap(e => [`event:${e.id}`, `event:slug:${e.slug}`]), "events:published", ...listKeys, "cache:ns:events:list")
            console.log("Caché de eventos limpiada.")
        }
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Fallo")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
