/**
 * Preventa vieja de CDM (VERANO_3X, preventa-verano-2027-academia-fdnda): los adultos
 * M-J-S pasaron de UN grupo "main" (Mar/Jue/Sáb a la misma hora) a dos grupos
 * (Mar/Jue + Sábado), como las preventas 2027. Este script migra los carnets
 * vendidos con el formato anterior conservando la hora: weekday = saturday = hora
 * original (las sesiones Mar/Jue/Sáb no cambian; solo la forma del horario).
 *
 * También agrega al mapa ABIO del plan (K14) los códigos M-J-S de 7-9 p. m.
 * (000370/000371), ahora elegibles para adultos en Mar/Jue.
 *
 * Escribe Ticket.membershipSchedule + la entrada de OrderItem.attendeeData + rastro en
 * membership_admin_changes, y verifica que TODOS los horarios reservados del plan
 * validen contra el perfil nuevo y quepan en sus cupos (si no, aborta: un horario
 * inválido bloquearía todas las ventas/fulfillments del plan).
 *
 * Correr DESPUÉS del deploy del perfil nuevo (con el código viejo en prod, los
 * carnets migrados no validarían). Dry run por defecto; --apply escribe.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import pg from "pg"
import { getMembershipScheduleProfile, parseMembershipScheduleSelection, validateMembershipScheduleSelection } from "../src/lib/membership-schedule"
import { assertMembershipSlotCapacity, countMembershipSlotReservations } from "../src/lib/membership-slot-capacity"
import { SUMMER_MEMBERSHIP_SCHEDULE_KEY } from "../src/lib/membership-config"

const apply = process.argv.includes("--apply")
const SLUG = "preventa-verano-2027-academia-fdnda"
const REASON = "Migración de formato: adultos M-J-S separan Mar/Jue y Sábado (misma hora conservada)"
const NEW_ABIO_CODES: Record<string, string> = { "ADULTOS:MJS:19:00-20:00": "000370", "ADULTOS:MJS:20:00-21:00": "000371" }

const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const connectionString = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]
if (!connectionString) throw new Error("DATABASE_URL missing")
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 })

const sameSelection = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function main() {
    let inTransaction = false
    try {
        const profile = getMembershipScheduleProfile("01", SUMMER_MEMBERSHIP_SCHEDULE_KEY)
        const adultMjs = profile?.categories.find(c => c.id === "ADULTOS")?.frequencies.find(f => f.id === "MJS")
        if (!profile || adultMjs?.dayGroups.map(g => g.id).join(",") !== "weekday,saturday") throw new Error("El código local no tiene el perfil nuevo (adultos M-J-S con weekday+saturday)")

        await client.connect()
        await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN READ ONLY")
        inTransaction = true
        const event = (await client.query(`SELECT id,"createdBy" FROM events WHERE slug=$1`, [SLUG])).rows[0]
        const plan = (await client.query(`SELECT * FROM ticket_types WHERE "eventId"=$1 AND "membershipScheduleKey"=$2 ${apply ? "FOR UPDATE" : ""}`, [event?.id, SUMMER_MEMBERSHIP_SCHEDULE_KEY])).rows[0]
        if (!plan) throw new Error("No se encontró el plan VERANO_3X")

        const tickets = (await client.query(`SELECT t.id,t."orderId",t."attendeeName",t."attendeeDni",t."membershipSchedule",t.status,o.status AS order_status
            FROM tickets t JOIN orders o ON o.id=t."orderId" WHERE t."ticketTypeId"=$1 ${apply ? "FOR UPDATE OF t" : ""}`, [plan.id])).rows
        const legacy = tickets.filter(t => {
            const s = t.membershipSchedule
            return s?.category === "ADULTOS" && s?.frequency === "MJS" && Array.isArray(s.groups) && s.groups.length === 1 && s.groups[0].id === "main"
        })

        const changes: Array<{ ticketId: string; orderItemId: string; attendees: unknown[]; index: number; before: unknown; after: unknown; label: string }> = []
        for (const t of legacy) {
            const hour = `${t.membershipSchedule.groups[0].start}-${t.membershipSchedule.groups[0].end}`
            const result = validateMembershipScheduleSelection(profile, { category: "ADULTOS", frequency: "MJS", hours: { weekday: hour, saturday: hour } }, "01")
            if (!result.ok) throw new Error(`${t.attendeeName}: ${result.error}`)
            const sessionKey = (list: Array<{ weekday: number; start: string; end: string }>) => list.map(x => `${x.weekday}|${x.start}|${x.end}`).sort().join(",")
            const oldSessions = sessionKey(t.membershipSchedule.sessions)
            const newSessions = sessionKey(result.selection.sessions)
            if (oldSessions !== newSessions) throw new Error(`${t.attendeeName}: las sesiones cambiarían (${oldSessions} → ${newSessions})`)
            const items = (await client.query(`SELECT id,"attendeeData" FROM order_items WHERE "orderId"=$1 AND "ticketTypeId"=$2`, [t.orderId, plan.id])).rows
            const matches = items.flatMap(item => (Array.isArray(item.attendeeData) ? item.attendeeData : []).map((a: Record<string, unknown>, index: number) => ({ item, index, a })))
                .filter(m => sameSelection(m.a?.membershipSchedule, t.membershipSchedule) && (!t.attendeeDni || String(m.a?.dni ?? "") === t.attendeeDni))
            if (matches.length !== 1) throw new Error(`${t.attendeeName}: ${matches.length} entradas de attendeeData coinciden (se esperaba 1)`)
            const { item, index } = matches[0]
            changes.push({ ticketId: t.id, orderItemId: item.id, attendees: item.attendeeData, index, before: t.membershipSchedule, after: result.selection, label: `${t.attendeeName} (${t.status}/${t.order_status}) ${hour}` })
        }

        const codes = plan.servilexExtraConfig?.membershipSchedules?.codes ?? {}
        const missingCodes = Object.entries(NEW_ABIO_CODES).filter(([k, v]) => codes[k] !== v)
        const catalog = (await client.query(`SELECT "horarioCodigo","horaInicio","horaFin",martes,jueves,sabado,lunes,miercoles,viernes,domingo FROM abio_catalog_schedules
            WHERE "codigoEmp"='001' AND "disciplinaCodigo"='00' AND "isActive" AND "horarioCodigo" = ANY($1)`, [Object.values(NEW_ABIO_CODES)])).rows
        for (const [key, code] of Object.entries(NEW_ABIO_CODES)) {
            const c = catalog.find(r => r.horarioCodigo === code)
            const [start, end] = key.split(":MJS:")[1].split("-")
            if (!c || c.horaInicio !== start || c.horaFin !== end || !c.martes || !c.jueves || !c.sabado || c.lunes || c.miercoles || c.viernes || c.domingo) throw new Error(`Código ABIO ${code} no coincide con ${key}`)
        }

        console.log(`${apply ? "APPLY" : "DRY RUN"}: ${changes.length} carnet(s) a migrar; códigos ABIO a agregar: ${missingCodes.map(([k, v]) => `${k}=${v}`).join(", ") || "ninguno"}`)
        for (const c of changes) console.log(`  - ${c.label}`)

        // Verificación global con los cambios aplicados en memoria.
        const pending = (await client.query(`SELECT attendee->'membershipSchedule' AS schedule FROM order_items oi JOIN orders o ON o.id=oi."orderId"
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(oi."attendeeData")='array' THEN oi."attendeeData" ELSE '[null]'::jsonb END) AS a(attendee)
            WHERE oi."ticketTypeId"=$1 AND o.status='PENDING'`, [plan.id])).rows.map(r => r.schedule)
        const paid = tickets.filter(t => t.status === "ACTIVE" && t.order_status === "PAID").map(t => changes.find(c => c.ticketId === t.id)?.after ?? t.membershipSchedule)
        const { invalid } = countMembershipSlotReservations(profile, [...paid, ...pending].map(s => parseMembershipScheduleSelection(s) ?? s))
        if (invalid > 0) throw new Error(`${invalid} horario(s) del plan no validan contra el perfil nuevo; no se escribe nada`)
        assertMembershipSlotCapacity(profile, [...paid, ...pending])
        console.log(`Verificación: ${paid.length} pagados + ${pending.length} pendientes validan y caben en sus cupos.`)

        if (!apply) {
            await client.query("ROLLBACK")
            inTransaction = false
            console.log("DRY RUN: no se escribió nada. Repite con --apply (después del deploy).")
            return
        }
        fs.mkdirSync(path.resolve("tmp"), { recursive: true })
        const backup = path.resolve(`tmp/summer-3x-adult-mjs-before-${Date.now()}.json`)
        fs.writeFileSync(backup, JSON.stringify({ plan: { id: plan.id, servilexExtraConfig: plan.servilexExtraConfig }, changes }, null, 2), { flag: "wx" })
        for (const c of changes) {
            await client.query(`UPDATE tickets SET "membershipSchedule"=$2::jsonb,"updatedAt"=NOW() WHERE id=$1`, [c.ticketId, JSON.stringify(c.after)])
            const attendees = c.attendees.map((a, i) => i === c.index ? { ...(a as Record<string, unknown>), membershipSchedule: c.after } : a)
            await client.query(`UPDATE order_items SET "attendeeData"=$2::jsonb WHERE id=$1`, [c.orderItemId, JSON.stringify(attendees)])
            await client.query(`INSERT INTO membership_admin_changes (id,"ticketId","actorId",kind,reason,before,after,"createdAt")
                VALUES ($1,$2,$3,'SCHEDULE',$4,$5::jsonb,$6::jsonb,NOW())`, [crypto.randomUUID(), c.ticketId, event.createdBy, REASON, JSON.stringify(c.before), JSON.stringify(c.after)])
        }
        if (missingCodes.length) {
            const extra = { ...plan.servilexExtraConfig, membershipSchedules: { ...plan.servilexExtraConfig.membershipSchedules, codes: { ...codes, ...NEW_ABIO_CODES } } }
            await client.query(`UPDATE ticket_types SET "servilexExtraConfig"=$2::jsonb,"updatedAt"=NOW() WHERE id=$1`, [plan.id, JSON.stringify(extra)])
            for (const code of Object.values(NEW_ABIO_CODES)) {
                await client.query(`INSERT INTO abio_catalog_bindings (id,"codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo","numeroCupos","isActive",source,"rawPayload","updatedAt")
                    VALUES ($1,'001','01',$2,'00',$3,$4,6,true,'PREVENTA_VERANO_2027_MJS','{}'::jsonb,NOW())
                    ON CONFLICT ("codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo") DO NOTHING`,
                    [crypto.randomUUID(), plan.servilexServiceCode, plan.servilexPoolCode, code])
            }
        }
        const left = (await client.query(`SELECT count(*)::int n FROM tickets WHERE "ticketTypeId"=$1 AND "membershipSchedule"->>'category'='ADULTOS'
            AND "membershipSchedule"->>'frequency'='MJS' AND jsonb_array_length("membershipSchedule"->'groups')=1`, [plan.id])).rows[0].n
        if (left !== 0) throw new Error(`Quedan ${left} carnets con el formato anterior`)
        await client.query("COMMIT")
        inTransaction = false
        console.log(`OK: ${changes.length} carnet(s) migrados y verificados. Backup ${backup}`)
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Fallo")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
