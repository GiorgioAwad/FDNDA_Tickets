/**
 * Enlaza ABIO a una preventa de verano 2027 (creada con create-summer-presales-2027.ts):
 * código de servicio por plan (3x / 2x) + código de horario ABIO por franja en
 * servilexExtraConfig.membershipSchedules (como la primera preventa de CDM, K14).
 *
 *   npx tsx scripts/configure-summer-presale-2027-abio.ts --slug preventa-2-verano-2027-campo-de-marte --svc3x K14 --svc2x K15
 *   ... --apply
 *
 * ABIO recibe UN código por alumno: el del primer grupo de días de su frecuencia
 * (M-J-S: la hora de Mar/Jue; el sábado no cambia el código). Cada código se
 * verifica contra abio_catalog_schedules (hora y días exactos). Series: la
 * original (código más bajo) por franja, igual que la primera preventa.
 * Bindings: solo inserta los que faltan; no pisa los de otra preventa que comparta
 * el servicio (K14 también lo usa preventa-verano-2027-academia-fdnda).
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import pg from "pg"
import { getMembershipScheduleProfile } from "../src/lib/membership-schedule"
import { SUMMER_2027_2X_SCHEDULE_KEY, SUMMER_2027_3X_SCHEDULE_KEY } from "../src/lib/membership-config"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const valueOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const slug = valueOf("--slug")
const services: Record<string, string | undefined> = { [SUMMER_2027_3X_SCHEDULE_KEY]: valueOf("--svc3x"), [SUMMER_2027_2X_SCHEDULE_KEY]: valueOf("--svc2x") }
if (!slug?.startsWith("preventa-") || !services[SUMMER_2027_3X_SCHEDULE_KEY] || !services[SUMMER_2027_2X_SCHEDULE_KEY]) {
    console.error("Uso: --slug preventa-N-verano-2027-<sede> --svc3x <código> --svc2x <código> [--apply]")
    process.exit(1)
}

const DISCIPLINE = "00" // NATACION
const SERVICE_START_DATE = "2027-01-01" // igual que la primera preventa (periodo enero 2027)

type Days = "LMV" | "MJS" | "MJ"
/** Código ABIO por hora de inicio, por patrón de días (catálogo NATACION). */
const CODES: Record<Days, Record<string, string>> = {
    LMV: {
        "06:00": "000001", "07:00": "000002", "08:00": "000003", "09:00": "000004", "10:00": "000005",
        "11:00": "000006", "12:00": "000007", "13:00": "000008", "14:00": "000009", "15:00": "000010",
        "16:00": "000011", "17:00": "000012", "18:00": "000013", "19:00": "000077", "20:00": "000148", "21:00": "000306",
    },
    MJS: {
        "06:00": "000075", "07:00": "000014", "08:00": "000015", "09:00": "000016", "10:00": "000017",
        "11:00": "000018", "12:00": "000019", "13:00": "000020", "14:00": "000039", "15:00": "000040",
        "16:00": "000041", "17:00": "000042", "18:00": "000076", "19:00": "000370", "20:00": "000371", "21:00": "000420",
    },
    MJ: {
        "06:00": "000079", "07:00": "000025", "08:00": "000026", "09:00": "000027", "10:00": "000028",
        "11:00": "000029", "12:00": "000030", "13:00": "000031", "14:00": "000021", "15:00": "000022",
        "16:00": "000023", "17:00": "000024", "18:00": "000081", "19:00": "000078", "20:00": "000149", "21:00": "000311",
    },
}
const DAY_FLAGS: Record<Days, Record<string, boolean>> = {
    LMV: { lunes: true, martes: false, miercoles: true, jueves: false, viernes: true, sabado: false, domingo: false },
    MJS: { lunes: false, martes: true, miercoles: false, jueves: true, viernes: false, sabado: true, domingo: false },
    MJ: { lunes: false, martes: true, miercoles: false, jueves: true, viernes: false, sabado: false, domingo: false },
}

const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const connectionString = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]
if (!connectionString) throw new Error("DATABASE_URL missing")
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 })

async function main() {
    let inTransaction = false
    try {
        await client.connect()
        await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN READ ONLY")
        inTransaction = true
        const event = (await client.query(`SELECT * FROM events WHERE slug=$1 ${apply ? "FOR UPDATE" : ""}`, [slug])).rows[0]
        if (!event || event.category !== "ACADEMIA" || !/^preventa-[123]-verano-2027-/.test(event.slug)) throw new Error(`No es una preventa verano 2027: ${slug}`)
        const sucursal: string = event.servilexSucursalCode
        const plans = (await client.query(`SELECT * FROM ticket_types WHERE "eventId"=$1 ORDER BY "sortOrder" ${apply ? "FOR UPDATE" : ""}`, [event.id])).rows
        if (plans.length !== 2 || plans.some(p => !services[p.membershipScheduleKey])) throw new Error("Planes inesperados en el evento")
        const orders = (await client.query(`SELECT count(*)::int n FROM order_items WHERE "ticketTypeId" = ANY($1)`, [plans.map(p => p.id)])).rows[0].n
        if (orders) throw new Error("El evento ya tiene órdenes; no se cambia ABIO con ventas en curso")

        // Piscina de la sede: la que ya usan sus planes de academia con ABIO.
        const pools = (await client.query(`SELECT DISTINCT t."servilexPoolCode" p FROM ticket_types t JOIN events e ON e.id=t."eventId"
            WHERE e."servilexSucursalCode"=$1 AND e.category='ACADEMIA' AND t."servilexEnabled" AND t."servilexDisciplineCode"=$2 AND t."servilexPoolCode" IS NOT NULL`, [sucursal, DISCIPLINE])).rows
        if (pools.length !== 1) throw new Error(`Piscina ambigua o desconocida para la sede ${sucursal}: ${pools.map(p => p.p).join(", ")}`)
        const pool: string = pools[0].p

        const planned: Array<{ plan: typeof plans[number]; service: string; codes: Record<string, string>; rows: Array<{ key: string; code: string; start: string; end: string; capacity: number; days: Days }> }> = []
        for (const plan of plans) {
            const service = services[plan.membershipScheduleKey]!
            const svc = (await client.query(`SELECT "servicioDescripcion" d FROM abio_catalog_services WHERE "codigoEmp"='001' AND "sucursalCodigo"=$1 AND "servicioCodigo"=$2 AND "isActive"`, [sucursal, service])).rows[0]
            if (!svc) throw new Error(`Servicio ${service} no existe/activo en la sucursal ${sucursal}`)
            const profile = getMembershipScheduleProfile(sucursal, plan.membershipScheduleKey)
            if (!profile) throw new Error(`Sin perfil ${plan.membershipScheduleKey} en la sede ${sucursal}`)
            const rows = profile.categories.flatMap(category => category.frequencies.flatMap(frequency => {
                const days = frequency.id as Days
                return frequency.dayGroups[0].hours.map(hour => {
                    const code = CODES[days]?.[hour.start]
                    if (!code) throw new Error(`Sin código ABIO para ${category.id} ${frequency.id} ${hour.start}`)
                    return { key: `${category.id}:${frequency.id}:${hour.start}-${hour.end}`, code, start: hour.start, end: hour.end, capacity: hour.capacity ?? 0, days }
                })
            }))
            const catalog = (await client.query(`SELECT * FROM abio_catalog_schedules WHERE "codigoEmp"='001' AND "disciplinaCodigo"=$1 AND "isActive" AND "horarioCodigo" = ANY($2)`, [DISCIPLINE, rows.map(r => r.code)])).rows
            for (const row of rows) {
                const match = catalog.find(c => c.horarioCodigo === row.code)
                const flags = DAY_FLAGS[row.days]
                if (!match || match.horaInicio !== row.start || match.horaFin !== row.end || Object.entries(flags).some(([day, on]) => Boolean(match[day]) !== on)) {
                    throw new Error(`El catálogo no coincide para ${row.key}: ${row.code}`)
                }
            }
            console.log(`\n${plan.name} (${plan.membershipScheduleKey}) → servicio ${service} "${svc.d}", disciplina ${DISCIPLINE}, piscina ${pool}, sucursal ${sucursal}`)
            console.table(rows.map(r => ({ franja: r.key, codigo: r.code })))
            planned.push({ plan, service, codes: Object.fromEntries(rows.map(r => [r.key, r.code])), rows })
        }

        if (!apply) {
            await client.query("ROLLBACK")
            inTransaction = false
            console.log("\nDRY RUN: no se escribió nada. Repite con --apply.")
            return
        }
        fs.mkdirSync(path.resolve("tmp"), { recursive: true })
        const backup = path.resolve(`tmp/summer-presale-abio-${slug}-before-${Date.now()}.json`)
        fs.writeFileSync(backup, JSON.stringify({ event: { id: event.id, slug }, plans }, null, 2), { flag: "wx" })
        for (const { plan, service, codes, rows } of planned) {
            const extraConfig = { ...(plan.servilexExtraConfig ?? {}), membershipSchedules: { profileKey: plan.membershipScheduleKey, serviceStartDate: SERVICE_START_DATE, codes } }
            await client.query(`UPDATE ticket_types SET "servilexEnabled"=true,"servilexIndicator"='AC',"servilexSucursalCode"=$2,
                "servilexServiceCode"=$3,"servilexDisciplineCode"=$4,"servilexPoolCode"=$5,"servilexScheduleCode"=NULL,"servilexBindingId"=NULL,
                "servilexExtraConfig"=$6::jsonb,"updatedAt"=NOW() WHERE id=$1`, [plan.id, sucursal, service, DISCIPLINE, pool, JSON.stringify(extraConfig)])
            for (const row of rows) {
                await client.query(`INSERT INTO abio_catalog_bindings
                    (id,"codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo","numeroCupos","isActive",source,"rawPayload","updatedAt")
                    VALUES ($1,'001',$2,$3,$4,$5,$6,$7,true,$8,$9::jsonb,NOW())
                    ON CONFLICT ("codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo") DO NOTHING`,
                    [crypto.randomUUID(), sucursal, service, DISCIPLINE, pool, row.code, row.capacity, `PREVENTA_VERANO_2027:${slug}`, JSON.stringify(row)])
            }
            const saved = (await client.query(`SELECT * FROM ticket_types WHERE id=$1`, [plan.id])).rows[0]
            const map = saved.servilexExtraConfig?.membershipSchedules
            if (!saved.servilexEnabled || saved.servilexServiceCode !== service || saved.servilexDisciplineCode !== DISCIPLINE || saved.servilexPoolCode !== pool ||
                saved.servilexScheduleCode !== null || map?.profileKey !== plan.membershipScheduleKey || map?.serviceStartDate !== SERVICE_START_DATE ||
                Object.keys(map?.codes ?? {}).length !== rows.length || rows.some(r => map.codes[r.key] !== r.code)) {
                throw new Error(`Verificación falló en ${plan.name}`)
            }
        }
        await client.query("COMMIT")
        inTransaction = false
        console.log(`\nOK: ABIO enlazado y verificado en ${slug}. Backup ${backup}. El evento sigue ${event.isPublished ? "PUBLICADO" : "sin publicar"}.`)
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Fallo")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
