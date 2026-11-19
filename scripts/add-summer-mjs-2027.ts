/**
 * Preventa verano 2027: habilita la frecuencia Martes-Jueves-Sábado en el plan
 * VERANO_3X que ya está a la venta (L-M-V). Dry run salvo --apply.
 *
 * Qué hace (una transacción, con backup en tmp/):
 *  1. Códigos ABIO M-J-S: toma los de SUMMER_ABIO_MJS_SCHEDULES (summer-abio-config)
 *     y RE-VERIFICA cada uno en abio_catalog_schedules: natación activo, martes+
 *     jueves+sábado (sin lunes/miércoles/viernes/domingo) y la misma hora. Si no
 *     cuadra, aborta y lista candidatos; --code HH:MM=000123 (repetible) lo pisa.
 *  2. Agrega esas claves "<CAT>:MJS:<inicio>-<fin>" a servilexExtraConfig.
 *     membershipSchedules.codes SIN tocar las de L-M-V, y crea sus bindings.
 *  3. Sube ticket_types.capacity a los alumnos que caben con los cupos por franja
 *     (L-M-V + M-J-S; un niño M-J-S ocupa franja Mar/Jue + sábado).
 *  4. Con --texts además actualiza los textos con reemplazos PUNTUALES sobre lo que
 *     ya está en BD (conserva el resto, p.ej. "SOLO 50 CUPOS DISPONIBLES" y el texto
 *     de marketing del evento). Si un fragmento esperado del evento no aparece
 *     exactamente una vez, aborta. Muestra antes/después.
 *  5. Tras el COMMIT limpia el caché Redis del evento (como update-summer-ticket-description).
 *
 * Puede correrse ANTES de desplegar el código: el código viejo ignora las claves
 * MJS y los cupos por franja de L-M-V siguen limitando a 106.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/add-summer-mjs-2027.ts [--texts] [--code 15:00=000123] [--apply]
 */
import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import pg from "pg"
import { Redis } from "@upstash/redis"
import { getMembershipScheduleProfile } from "../src/lib/membership-schedule"
import { SUMMER_MEMBERSHIP_SCHEDULE_KEY } from "../src/lib/membership-config"
import { listMembershipLimitedSlots, maxMembershipStudents } from "../src/lib/membership-slot-capacity"
import {
    SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_MJS_SCHEDULES, SUMMER_ABIO_POOL_CODE, SUMMER_ABIO_SCHEDULES,
    SUMMER_ABIO_SERVICE_CODE, summerAbioMappingKey,
} from "../src/lib/summer-abio-config"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const texts = args.includes("--texts")
const forcedCodes = new Map<string, string>()
args.forEach((arg, i) => {
    if (arg !== "--code") return
    const match = /^(\d{2}:\d{2})=(\d{6})$/.exec(args[i + 1] ?? "")
    if (!match) throw new Error(`--code espera HH:MM=000123, recibió "${args[i + 1]}"`)
    forcedCodes.set(match[1], match[2])
})

const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const connectionString = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]
if (!connectionString) throw new Error("DATABASE_URL missing")
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 })
const slug = "preventa-verano-2027-academia-fdnda"
const profile = getMembershipScheduleProfile("01", SUMMER_MEMBERSHIP_SCHEDULE_KEY)!

// Los flags de día del catálogo ABIO pueden venir como boolean o texto (S/N/1/0).
const on = (v: unknown) => v === true || (typeof v === "string" && !["", "0", "N", "NO", "FALSE"].includes(v.trim().toUpperCase())) || v === 1
const isMjsOnly = (s: Record<string, unknown>) =>
    on(s.martes) && on(s.jueves) && on(s.sabado) && !on(s.lunes) && !on(s.miercoles) && !on(s.viernes) && !on(s.domingo)

// Solo se reemplaza el fragmento de días; el resto del texto (ediciones del admin) se conserva.
const OLD_DAYS = /Lunes, miércoles y viernes/i
const NEW_DAYS_SHORT = "Lun-Mié-Vie o Mar-Jue-Sáb"
const NEW_DAYS_LONG = "3 veces por semana: lunes, miércoles y viernes o martes, jueves y sábado"
const nextTypeDescription = (current: string | null) => (current ?? "").replace(OLD_DAYS, NEW_DAYS_SHORT)
const nextBenefits = (current: unknown) =>
    (Array.isArray(current) ? current : []).map((b: { text?: string }) =>
        typeof b?.text === "string" && OLD_DAYS.test(b.text) && !/sábado/i.test(b.text) ? { ...b, text: NEW_DAYS_LONG } : b)

// Reemplazos sobre la descripción del evento tal como está en prod (dry-run 2026-11-19).
const EVENT_REPLACEMENTS: Array<[string, string]> = [
    [
        "<p><strong>3 veces por semana: lunes, miércoles y viernes. Precio total:",
        "<p><strong>3 veces por semana: lunes, miércoles y viernes o martes, jueves y sábado. Precio total:",
    ],
    [
        "<li><p><strong>Frecuencia:</strong> lunes, miércoles y viernes.</p></li>",
        "<li><p><strong>Frecuencia:</strong> lunes, miércoles y viernes o martes, jueves y sábado.</p></li>",
    ],
    [
        "<p>👧 <strong>Niños de 6 a 17 años:</strong> turnos de una hora desde las 8:00 a. m. hasta el último turno de 6:00 a 7:00 p. m.</p>" +
        "<p>🧑 <strong>Adultos de 18 años a más:</strong> turnos de 6:00 a 7:00 a. m., 7:00 a 8:00 a. m., 7:00 a 8:00 p. m. y 8:00 a 9:00 p. m.</p>",
        "<p>👧 <strong>Niños de 6 a 17 años:</strong></p><ul>" +
        "<li><p><strong>Lunes, miércoles y viernes:</strong> turnos de una hora desde las 8:00 a. m. hasta el último turno de 6:00 a 7:00 p. m.</p></li>" +
        "<li><p><strong>Martes, jueves y sábado:</strong> martes y jueves desde las 8:00 a. m. hasta el último turno de 6:00 a 7:00 p. m.; sábado desde las 8:00 a. m. hasta el último turno de 1:00 a 2:00 p. m. Se elige una hora para martes y jueves y otra para el sábado.</p></li>" +
        "</ul><p>🧑 <strong>Adultos de 18 años a más:</strong></p><ul>" +
        "<li><p><strong>Lunes, miércoles y viernes:</strong> turnos de 6:00 a 7:00 a. m., 7:00 a 8:00 a. m., 7:00 a 8:00 p. m. y 8:00 a 9:00 p. m.</p></li>" +
        "<li><p><strong>Martes, jueves y sábado:</strong> turnos de 6:00 a 7:00 a. m. o de 7:00 a 8:00 a. m., a la misma hora los tres días.</p></li></ul>",
    ],
    [
        "La compra incluye únicamente la frecuencia de <strong>lunes, miércoles y viernes</strong>, dentro de",
        "La compra incluye únicamente la frecuencia elegida (<strong>lunes, miércoles y viernes</strong> o <strong>martes, jueves y sábado</strong>), dentro de",
    ],
]

function nextEventDescription(current: string): string {
    let next = current
    for (const [from, to] of EVENT_REPLACEMENTS) {
        const count = next.split(from).length - 1
        if (count !== 1) throw new Error(`--texts: el fragmento del evento aparece ${count} veces (se esperaba 1): "${from.slice(0, 70)}…". Edita la descripción desde el admin.`)
        next = next.replace(from, to)
    }
    return next
}

async function main() {
    let inTransaction = false
    try {
        await client.connect()
        await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN READ ONLY")
        inTransaction = true
        const event = (await client.query(`SELECT * FROM events WHERE slug=$1 ${apply ? "FOR UPDATE" : ""}`, [slug])).rows[0]
        if (!event || event.category !== "ACADEMIA" || event.servilexSucursalCode !== "01") throw new Error("Expected the Campo de Marte summer academy event")
        const plans = (await client.query(`SELECT * FROM ticket_types WHERE "eventId"=$1 AND "membershipScheduleKey"=$2 ${apply ? "FOR UPDATE" : ""}`, [event.id, SUMMER_MEMBERSHIP_SCHEDULE_KEY])).rows
        if (plans.length !== 1 || Number(plans[0].price) !== 640) throw new Error(`Expected exactly one VERANO_3X plan at S/ 640, found ${plans.length}`)
        const plan = plans[0]
        const mapping = plan.servilexExtraConfig?.membershipSchedules
        if (plan.servilexServiceCode !== SUMMER_ABIO_SERVICE_CODE || mapping?.profileKey !== SUMMER_MEMBERSHIP_SCHEDULE_KEY || !mapping?.codes) {
            throw new Error("The plan does not carry the K14 per-schedule ABIO mapping; run configure-summer-abio-2027.ts first")
        }
        for (const row of SUMMER_ABIO_SCHEDULES) {
            if (mapping.codes[summerAbioMappingKey(row)] !== row.scheduleCode) throw new Error(`L-M-V mapping drifted at ${row.start}; refusing`)
        }

        // 1. Códigos ABIO M-J-S.
        const lmvCodes = new Set(Object.values(mapping.codes as Record<string, string>))
        const catalog = (await client.query(`SELECT * FROM abio_catalog_schedules WHERE "codigoEmp"='001' AND "disciplinaCodigo"=$1 AND "isActive"`, [SUMMER_ABIO_DISCIPLINE_CODE])).rows
        const problems: string[] = []
        const mjsRows = SUMMER_ABIO_MJS_SCHEDULES.map(row => {
            const code: string | undefined = forcedCodes.get(row.start) ?? row.scheduleCode
            const match = code ? catalog.find(c => c.horarioCodigo === code) : undefined
            if (!match || !isMjsOnly(match) || match.horaInicio !== row.start || match.horaFin !== row.end) {
                const candidates = catalog.filter(c => c.horaInicio === row.start && c.horaFin === row.end && on(c.martes) && on(c.jueves))
                problems.push(`${row.start}-${row.end} (${row.categoryLabel}): ${code ?? "sin código"} no es natación activo "Mar Jue Sab" a esa hora; ` +
                    `candidatos con Mar/Jue: ${candidates.map(c => `${c.horarioCodigo} "${c.diaDescripcion ?? ""}" L${+on(c.lunes)}M${+on(c.martes)}X${+on(c.miercoles)}J${+on(c.jueves)}V${+on(c.viernes)}S${+on(c.sabado)}`).join("; ") || "ninguno"}`)
                return { ...row, scheduleCode: undefined }
            }
            if (lmvCodes.has(code!)) problems.push(`${row.start}: el código ${code} ya es de L-M-V; no se reutiliza`)
            return { ...row, scheduleCode: code, catalogo: match.diaDescripcion ?? "" }
        })
        const duplicated = mjsRows.map(r => r.scheduleCode).filter((c, i, all) => c && all.indexOf(c) !== i)
        if (duplicated.length > 0) problems.push(`códigos repetidos entre franjas M-J-S: ${duplicated.join(", ")}`)

        // 3. Capacidad del plan en alumnos.
        const hasOverridesColumn = (await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='ticket_types' AND column_name='membershipSlotCapacities'`)).rowCount
        const overrides = hasOverridesColumn ? plan.membershipSlotCapacities : null
        const newCapacity = maxMembershipStudents(listMembershipLimitedSlots(profile, overrides))
        const lmvOnlyCapacity = maxMembershipStudents(listMembershipLimitedSlots(profile, overrides).filter(s => s.frequency === "LMV"))

        console.log(`${apply ? "APPLY" : "DRY RUN"} · plan ${plan.id} "${plan.name}" · vendidos ${plan.sold} · publicado ${event.isPublished}`)
        console.log(`Capacidad del plan: ${plan.capacity} -> ${newCapacity} (L-M-V ${lmvOnlyCapacity} + M-J-S ${newCapacity - lmvOnlyCapacity})${overrides ? " · con cupos editados del admin" : ""}`)
        console.table(mjsRows.map(r => ({ franja: `${r.start}-${r.end}`, categoria: r.categoryLabel, grupo: r.groupLabel, cupos: r.capacity, codigoABIO: r.scheduleCode ?? "?", catalogo: "catalogo" in r ? r.catalogo : "" })))
        const newEventDescription = texts ? nextEventDescription(event.description ?? "") : null
        if (texts) {
            console.log("Textos del plan DESPUÉS:", JSON.stringify({ benefits: nextBenefits(plan.benefits), typeDescription: nextTypeDescription(plan.description) }, null, 2))
            console.log("Descripción del evento DESPUÉS:\n" + newEventDescription)
        }
        if (problems.length > 0) throw new Error(`Faltan códigos ABIO M-J-S:\n - ${problems.join("\n - ")}`)
        if (newCapacity < plan.sold) throw new Error(`New capacity ${newCapacity} below sold ${plan.sold}`)

        if (apply) {
            fs.mkdirSync(path.resolve("tmp"), { recursive: true })
            const backup = path.resolve(`tmp/summer-mjs-before-${Date.now()}.json`)
            fs.writeFileSync(backup, JSON.stringify({ event, plan }, null, 2), { flag: "wx" })
            const codes = { ...mapping.codes, ...Object.fromEntries(mjsRows.map(r => [summerAbioMappingKey(r), r.scheduleCode!])) }
            const extraConfig = { ...plan.servilexExtraConfig, membershipSchedules: { ...mapping, codes } }
            for (const row of mjsRows) {
                await client.query(`INSERT INTO abio_catalog_bindings
                  (id,"codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo","numeroCupos","isActive",source,"rawPayload","updatedAt")
                  VALUES ($1,'001','01',$2,$3,$4,$5,$6,true,'PREVENTA_VERANO_2027_MJS',$7::jsonb,NOW())
                  ON CONFLICT ("codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo")
                  DO UPDATE SET "numeroCupos"=EXCLUDED."numeroCupos","isActive"=true,source=EXCLUDED.source,"rawPayload"=EXCLUDED."rawPayload","updatedAt"=NOW()`,
                  [crypto.randomUUID(), SUMMER_ABIO_SERVICE_CODE, SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_POOL_CODE, row.scheduleCode, row.capacity, JSON.stringify(row)])
            }
            await client.query(`UPDATE ticket_types SET "servilexExtraConfig"=$2::jsonb, capacity=$3, "updatedAt"=NOW() WHERE id=$1`,
                [plan.id, JSON.stringify(extraConfig), newCapacity])
            if (texts) {
                await client.query(`UPDATE ticket_types SET benefits=$2::jsonb, description=$3, "updatedAt"=NOW() WHERE id=$1`, [plan.id, JSON.stringify(nextBenefits(plan.benefits)), nextTypeDescription(plan.description)])
                await client.query(`UPDATE events SET description=$2, "updatedAt"=NOW() WHERE id=$1`, [event.id, newEventDescription])
            }
            const saved = (await client.query(`SELECT * FROM ticket_types WHERE id=$1`, [plan.id])).rows[0]
            const savedCodes = saved.servilexExtraConfig?.membershipSchedules?.codes ?? {}
            if (saved.capacity !== newCapacity ||
                SUMMER_ABIO_SCHEDULES.some(r => savedCodes[summerAbioMappingKey(r)] !== r.scheduleCode) ||
                mjsRows.some(r => savedCodes[summerAbioMappingKey(r)] !== r.scheduleCode)) throw new Error("Post-write verification failed")
            await client.query("COMMIT")
            console.log(`OK: M-J-S habilitado en BD (códigos ABIO + capacidad ${newCapacity}${texts ? " + textos" : ""}); backup ${backup}`)
            const redisUrl = env.match(/^UPSTASH_REDIS_REST_URL=["']?([^"'\r\n]+)/m)?.[1]
            const redisToken = env.match(/^UPSTASH_REDIS_REST_TOKEN=["']?([^"'\r\n]+)/m)?.[1]
            if (redisUrl && redisToken) {
                await new Redis({ url: redisUrl, token: redisToken }).del(`ticket-types:${event.id}`, `event:${event.id}`, `event:slug:${event.slug}`)
                console.log("Caché del evento limpiado")
            } else console.log("Sin credenciales Redis: el caché vence solo")
        } else await client.query("ROLLBACK")
        inTransaction = false
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Failed")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
