/**
 * Campo de Marte, preventas verano 2027 (VERANO_2027_3X/2X, sede 01): la franja de
 * 6-7 p. m. pasa de niños a adultos (pedido 2026-11-27). La preventa vieja (VERANO_3X)
 * NO cambia.
 *
 * Dos fases para que ningún horario quede inválido en ningún momento (un horario
 * inválido bloquea todas las ventas y cambios de su plan):
 *
 *   --phase pre   (ANTES del deploy; válido con el código viejo y el nuevo)
 *     1. Pasa a los niños inscritos a las 6 p. m. a las 5 p. m. (mismos días; en M-J-S
 *        el sábado no cambia), en Ticket + attendeeData + historial.
 *     2. Cierra la franja de niños de 6 p. m. con cupo 0 (override), para que nadie la
 *        compre entre ahora y el deploy.
 *     3. Agrega al mapa ABIO los códigos de adultos a las 6 p. m. (los de niños se quedan
 *        hasta el post, por si una orden en curso los necesita).
 *
 *   --phase post  (DESPUÉS del deploy)
 *     1. Quita los overrides y códigos ABIO de niños a las 6 p. m. (ya no existen).
 *     2. Actualiza las descripciones de los eventos.
 *     3. Verifica que todos los horarios reservados validen y quepan.
 *
 * Dry run por defecto; --apply escribe.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import pg from "pg"
import { Redis } from "@upstash/redis"
import { getMembershipScheduleProfile, parseMembershipScheduleSelection, validateMembershipScheduleSelection } from "../src/lib/membership-schedule"
import { assertMembershipSlotCapacity, countMembershipSlotReservations } from "../src/lib/membership-slot-capacity"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const phase = args[args.indexOf("--phase") + 1]
if (!["pre", "post"].includes(phase)) {
    console.error("Uso: --phase pre|post [--apply]")
    process.exit(1)
}

const SLUG_PREFIX = "preventa-%-verano-2027-campo-de-marte"
const REASON = "Campo de Marte: la franja de 6-7 p. m. pasa a adultos; niño reubicado a 5-6 p. m. (mismos días)"
const KID_SLOT_KEYS = ["NINOS:LMV:main:18:00:19:00", "NINOS:MJS:weekday:18:00:19:00", "NINOS:MJ:main:18:00:19:00"]
const ABIO_ADULT_18: Record<string, string> = {
    "ADULTOS:LMV:18:00-19:00": "000013",
    "ADULTOS:MJS:18:00-19:00": "000076",
    "ADULTOS:MJ:18:00-19:00": "000081",
}
const ABIO_KID_18 = ["NINOS:LMV:18:00-19:00", "NINOS:MJS:18:00-19:00", "NINOS:MJ:18:00-19:00"]
const DESC_REPLACEMENTS: Array<[string, string]> = [
    ["turnos de una hora de 8:00 a. m. a 7:00 p. m.", "turnos de una hora de 8:00 a. m. a 6:00 p. m."],
    ["de 6:00 a. m. a 8:00 a. m. y de 7:00 p. m. a 9:00 p. m.", "de 6:00 a. m. a 8:00 a. m. y de 6:00 p. m. a 9:00 p. m."],
]

const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const envValue = (key: string) => env.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?`, "m"))?.[1]
const client = new pg.Client({ connectionString: envValue("DATABASE_URL"), connectionTimeoutMillis: 15000 })

type Json = Record<string, unknown>

async function reservedSchedules(ticketTypeId: string) {
    const pending = (await client.query(`SELECT a->'membershipSchedule' AS s FROM order_items oi JOIN orders o ON o.id=oi."orderId"
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(oi."attendeeData")='array' THEN oi."attendeeData" ELSE '[null]'::jsonb END) x(a)
        WHERE oi."ticketTypeId"=$1 AND o.status='PENDING'`, [ticketTypeId])).rows.map(r => r.s)
    const paid = (await client.query(`SELECT t.id,t."orderId",t."attendeeName",t."attendeeDni",t."membershipSchedule" AS s FROM tickets t JOIN orders o ON o.id=t."orderId"
        WHERE t."ticketTypeId"=$1 AND t.status='ACTIVE' AND o.status='PAID' ${apply ? "FOR UPDATE OF t" : ""}`, [ticketTypeId])).rows
    return { pending, paid }
}

async function main() {
    let inTransaction = false
    try {
        await client.connect()
        await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN READ ONLY")
        inTransaction = true
        const plans = (await client.query(`SELECT tt.*, e.slug, e.id AS event_id, e."createdBy" AS event_owner FROM ticket_types tt JOIN events e ON e.id=tt."eventId"
            WHERE e.slug LIKE $1 AND e."servilexSucursalCode"='01' AND tt."membershipScheduleKey" IN ('VERANO_2027_3X','VERANO_2027_2X')
            ORDER BY e.slug, tt."sortOrder" ${apply ? "FOR UPDATE OF tt" : ""}`, [SLUG_PREFIX])).rows
        if (plans.length !== 6) throw new Error(`Se esperaban 6 planes en CDM, hay ${plans.length}`)
        console.log(`${apply ? "APPLY" : "DRY RUN"} fase ${phase}`)

        if (phase === "pre") {
            for (const plan of plans) {
                const profile = getMembershipScheduleProfile("01", plan.membershipScheduleKey)!
                const { pending, paid } = await reservedSchedules(plan.id)
                if (pending.some(s => s?.category === "NINOS" && (s.groups ?? []).some((g: Json) => g.id !== "saturday" && g.start === "18:00"))) {
                    throw new Error(`${plan.slug}: hay una orden PENDIENTE de niño a las 6 p. m.; esperar a que se resuelva`)
                }
                const moves = paid.filter(t => t.s?.category === "NINOS" && (t.s.groups ?? []).some((g: Json) => g.id !== "saturday" && g.start === "18:00"))
                for (const t of moves) {
                    const hours: Record<string, string> = {}
                    for (const g of t.s.groups as Json[]) hours[g.id as string] = g.id === "saturday" ? `${g.start}-${g.end}` : "17:00-18:00"
                    const result = validateMembershipScheduleSelection(profile, { category: "NINOS", frequency: t.s.frequency, hours }, "01")
                    if (!result.ok) throw new Error(`${t.attendeeName}: ${result.error}`)
                    const items = (await client.query(`SELECT id,"attendeeData" FROM order_items WHERE "orderId"=$1 AND "ticketTypeId"=$2`, [t.orderId, plan.id])).rows
                    const matches = items.flatMap(item => (Array.isArray(item.attendeeData) ? item.attendeeData : []).map((a: Json, index: number) => ({ item, index, a })))
                        .filter(m => JSON.stringify(m.a?.membershipSchedule) === JSON.stringify(t.s) && (!t.attendeeDni || String(m.a?.dni ?? "") === t.attendeeDni))
                    if (matches.length !== 1) throw new Error(`${t.attendeeName}: ${matches.length} entradas de attendeeData coinciden`)
                    console.log(`  ${plan.slug} ${plan.membershipScheduleKey}: ${t.attendeeName} ${t.s.frequency} 18:00 → 17:00`)
                    if (apply) {
                        const { item, index } = matches[0]
                        await client.query(`UPDATE tickets SET "membershipSchedule"=$2::jsonb,"updatedAt"=NOW() WHERE id=$1`, [t.id, JSON.stringify(result.selection)])
                        const data = item.attendeeData.map((a: Json, i: number) => (i === index ? { ...a, membershipSchedule: result.selection } : a))
                        await client.query(`UPDATE order_items SET "attendeeData"=$2::jsonb WHERE id=$1`, [item.id, JSON.stringify(data)])
                        await client.query(`INSERT INTO membership_admin_changes (id,"ticketId","actorId",kind,reason,before,after,"createdAt") VALUES ($1,$2,$3,'SCHEDULE',$4,$5::jsonb,$6::jsonb,NOW())`,
                            [crypto.randomUUID(), t.id, plan.event_owner, REASON,
                             JSON.stringify({ ticketTypeName: plan.name, sucursalCode: "01", scheduleSummary: `Niños · ${t.s.frequencyLabel} · 18:00-19:00` }),
                             JSON.stringify({ ticketTypeName: plan.name, sucursalCode: "01", scheduleSummary: `Niños · ${t.s.frequencyLabel} · 17:00-18:00` })])
                    }
                }
                // Cupo 0 para niños a las 6 p. m. (solo lo lee el código viejo; con el nuevo la franja no existe).
                const overrides = { ...(plan.membershipSlotCapacities ?? {}) } as Record<string, number>
                const kidKeys = plan.membershipScheduleKey === "VERANO_2027_2X" ? KID_SLOT_KEYS.filter(k => k.includes(":MJ:")) : KID_SLOT_KEYS.filter(k => !k.includes(":MJ:"))
                for (const k of kidKeys) overrides[k] = 0
                const codes = plan.servilexExtraConfig?.membershipSchedules?.codes
                const addCodes = codes ? Object.fromEntries(Object.entries(ABIO_ADULT_18).filter(([k]) => profile.categories.some(c => c.frequencies.some(f => k.startsWith(`ADULTOS:${f.id}:`))))) : {}
                console.log(`  ${plan.slug} ${plan.membershipScheduleKey}: cierra ${kidKeys.join(", ")}; ABIO + ${Object.keys(addCodes).join(", ") || "(sin ABIO)"}`)
                if (apply) {
                    await client.query(`UPDATE ticket_types SET "membershipSlotCapacities"=$2::jsonb,"updatedAt"=NOW() WHERE id=$1`, [plan.id, JSON.stringify(overrides)])
                    if (codes) {
                        const extra = { ...plan.servilexExtraConfig, membershipSchedules: { ...plan.servilexExtraConfig.membershipSchedules, codes: { ...codes, ...addCodes } } }
                        await client.query(`UPDATE ticket_types SET "servilexExtraConfig"=$2::jsonb WHERE id=$1`, [plan.id, JSON.stringify(extra)])
                    }
                }
                // Con los cambios, todo lo reservado debe validar contra el perfil nuevo y caber.
                const after = paid.map(t => {
                    const m = moves.find(x => x.id === t.id)
                    if (!m) return t.s
                    const hours: Record<string, string> = {}
                    for (const g of t.s.groups as Json[]) hours[g.id as string] = g.id === "saturday" ? `${g.start}-${g.end}` : "17:00-18:00"
                    const r = validateMembershipScheduleSelection(profile, { category: "NINOS", frequency: t.s.frequency, hours }, "01")
                    return r.ok ? r.selection : t.s
                })
                const all = [...after, ...pending].map(s => parseMembershipScheduleSelection(s) ?? s)
                const { invalid } = countMembershipSlotReservations(profile, all)
                if (invalid) throw new Error(`${plan.slug}: ${invalid} horario(s) no validarían con el perfil nuevo`)
                assertMembershipSlotCapacity(profile, all)
            }
        } else {
            for (const plan of plans) {
                const profile = getMembershipScheduleProfile("01", plan.membershipScheduleKey)!
                const adultEvening = profile.categories.find(c => c.id === "ADULTOS")!.frequencies[0].dayGroups[0].hours.map(h => h.start)
                if (!adultEvening.includes("18:00")) throw new Error("El código local no tiene 6 p. m. como franja de adultos en CDM")
                const overrides = { ...(plan.membershipSlotCapacities ?? {}) } as Record<string, number>
                for (const k of KID_SLOT_KEYS) delete overrides[k]
                const codes = { ...(plan.servilexExtraConfig?.membershipSchedules?.codes ?? {}) }
                for (const k of ABIO_KID_18) delete codes[k]
                const { pending, paid } = await reservedSchedules(plan.id)
                const all = [...paid.map(t => t.s), ...pending].map(s => parseMembershipScheduleSelection(s) ?? s)
                const { invalid } = countMembershipSlotReservations(profile, all)
                if (invalid) throw new Error(`${plan.slug} ${plan.membershipScheduleKey}: ${invalid} horario(s) no validan con el perfil nuevo; revisar antes de seguir`)
                assertMembershipSlotCapacity(profile, all)
                console.log(`  ${plan.slug} ${plan.membershipScheduleKey}: ${paid.length} pagados + ${pending.length} pendientes validan; limpia overrides/códigos de niños 6 p. m.`)
                if (apply) {
                    await client.query(`UPDATE ticket_types SET "membershipSlotCapacities"=$2::jsonb,"updatedAt"=NOW() WHERE id=$1`,
                        [plan.id, Object.keys(overrides).length ? JSON.stringify(overrides) : null])
                    if (plan.servilexExtraConfig?.membershipSchedules) {
                        const extra = { ...plan.servilexExtraConfig, membershipSchedules: { ...plan.servilexExtraConfig.membershipSchedules, codes } }
                        await client.query(`UPDATE ticket_types SET "servilexExtraConfig"=$2::jsonb WHERE id=$1`, [plan.id, JSON.stringify(extra)])
                    }
                }
            }
            const events = (await client.query(`SELECT id,slug,description FROM events WHERE slug LIKE $1 ${apply ? "FOR UPDATE" : ""}`, [SLUG_PREFIX])).rows
            for (const e of events) {
                let desc = e.description as string
                const hits = DESC_REPLACEMENTS.filter(([from]) => desc.includes(from)).length
                for (const [from, to] of DESC_REPLACEMENTS) desc = desc.split(from).join(to)
                console.log(`  ${e.slug}: descripción ${hits}/${DESC_REPLACEMENTS.length} frases a actualizar`)
                if (apply && hits) await client.query(`UPDATE events SET description=$2,"updatedAt"=NOW() WHERE id=$1`, [e.id, desc])
            }
            if (apply) {
                const url = envValue("UPSTASH_REDIS_REST_URL"), token = envValue("UPSTASH_REDIS_REST_TOKEN")
                if (url && token) {
                    const redis = new Redis({ url, token })
                    const listKeys = (await redis.smembers("cache:ns:events:list")) as string[]
                    await redis.del(...events.flatMap(e => [`event:${e.id}`, `event:slug:${e.slug}`]), "events:published", ...listKeys, "cache:ns:events:list")
                }
            }
        }

        if (apply) {
            await client.query("COMMIT")
            inTransaction = false
            console.log(`OK: fase ${phase} aplicada.`)
        } else {
            await client.query("ROLLBACK")
            inTransaction = false
            console.log("DRY RUN: no se escribió nada. Repite con --apply.")
        }
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Fallo")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
