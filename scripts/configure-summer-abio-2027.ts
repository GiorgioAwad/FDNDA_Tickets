/** Associate K14 with all 15 summer schedules. Dry run unless --apply. */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import pg from "pg"
import { SUMMER_ABIO_SCHEDULES, SUMMER_ABIO_SERVICE_CODE, SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_POOL_CODE, SUMMER_ABIO_EXTRA_CONFIG } from "../src/lib/summer-abio-config"

const apply = process.argv.includes("--apply")
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
        const event = (await client.query(`SELECT * FROM events WHERE slug='preventa-verano-2027-academia-fdnda' ${apply ? "FOR UPDATE" : ""}`)).rows[0]
        if (!event || event.isPublished || event.category !== "ACADEMIA" || event.servilexSucursalCode !== "01") throw new Error("Expected the unpublished Campo de Marte summer draft")
        const plans = (await client.query(`SELECT * FROM ticket_types WHERE "eventId"=$1 ${apply ? "FOR UPDATE" : ""}`, [event.id])).rows
        if (plans.length !== 1 || plans[0].membershipScheduleKey !== "VERANO_3X" || Number(plans[0].price) !== 640 || plans[0].sold !== 0) throw new Error("Unexpected summer plan or sales")
        const plan = plans[0]
        const usage = (await client.query(`SELECT (SELECT count(*)::int FROM order_items WHERE "ticketTypeId"=$1) AS orders,(SELECT count(*)::int FROM tickets WHERE "ticketTypeId"=$1) AS tickets`, [plan.id])).rows[0]
        if (usage.orders || usage.tickets) throw new Error("Refusing to modify a plan with purchases")
        const service = (await client.query(`SELECT * FROM abio_catalog_services WHERE "codigoEmp"='001' AND "sucursalCodigo"='01' AND "servicioCodigo"=$1 AND "isActive"`, [SUMMER_ABIO_SERVICE_CODE])).rows[0]
        if (!service || service.servicioDescripcion !== "PREVENTA 1 2027 - 3 VECES X SEMANA") throw new Error("ABIO service K14 does not match the summer presale")
        const poolEvidence = (await client.query(`SELECT DISTINCT t."servilexPoolCode" FROM ticket_types t JOIN events e ON e.id=t."eventId" WHERE e."servilexSucursalCode"='01' AND t."servilexEnabled" AND t."servilexDisciplineCode"='00' AND t."membershipScheduleKey" IS NOT NULL`)).rows
        if (poolEvidence.length !== 1 || poolEvidence[0].servilexPoolCode !== SUMMER_ABIO_POOL_CODE) throw new Error("Ambiguous Campo de Marte pool; verify before association")
        const catalog = (await client.query(`SELECT * FROM abio_catalog_schedules WHERE "codigoEmp"='001' AND "disciplinaCodigo"=$1 AND "isActive" AND "horarioCodigo"=ANY($2::text[])`, [SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_SCHEDULES.map(r => r.scheduleCode)])).rows
        for (const row of SUMMER_ABIO_SCHEDULES) {
            const match = catalog.find(c => c.horarioCodigo === row.scheduleCode)
            if (!match || match.horaInicio !== row.start || match.horaFin !== row.end || !match.lunes || !match.miercoles || !match.viernes || match.martes || match.jueves || match.sabado || match.domingo) throw new Error(`Catalogue does not match ${row.start}-${row.end}: ${row.scheduleCode}`)
        }
        if (catalog.length !== 15) throw new Error("Expected 15 verified ABIO schedules")
        const beforeBindings = (await client.query(`SELECT * FROM abio_catalog_bindings WHERE "codigoEmp"='001' AND "sucursalCodigo"='01' AND "servicioCodigo"=$1 AND "disciplinaCodigo"=$2 AND "piscinaCodigo"=$3`, [SUMMER_ABIO_SERVICE_CODE, SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_POOL_CODE])).rows
        const extraConfig = { ...(plan.servilexExtraConfig ?? {}), ...SUMMER_ABIO_EXTRA_CONFIG }
        console.log(`${apply ? "APPLY" : "DRY RUN"}: K14; sucursal 01; disciplina 00; piscina 01; starts 2027-01-01`)
        console.table(SUMMER_ABIO_SCHEDULES.map(r => ({ horario: `${r.start}-${r.end}`, codigo: r.scheduleCode, categoria: r.categoryLabel, cupos: r.capacity })))
        if (apply) {
            fs.mkdirSync(path.resolve("tmp"), { recursive: true })
            const backup = path.resolve(`tmp/summer-abio-before-${Date.now()}.json`)
            fs.writeFileSync(backup, JSON.stringify({ event, plan, beforeBindings }, null, 2), { flag: "wx" })
            for (const row of SUMMER_ABIO_SCHEDULES) {
                await client.query(`INSERT INTO abio_catalog_bindings
                  (id,"codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo","numeroCupos","isActive",source,"rawPayload","updatedAt")
                  VALUES ($1,'001','01',$2,$3,$4,$5,$6,true,'PREVENTA_VERANO_2027',$7::jsonb,NOW())
                  ON CONFLICT ("codigoEmp","sucursalCodigo","servicioCodigo","disciplinaCodigo","piscinaCodigo","horarioCodigo")
                  DO UPDATE SET "numeroCupos"=EXCLUDED."numeroCupos","isActive"=true,source=EXCLUDED.source,"rawPayload"=EXCLUDED."rawPayload","updatedAt"=NOW()`,
                  [crypto.randomUUID(), SUMMER_ABIO_SERVICE_CODE, SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_POOL_CODE, row.scheduleCode, row.capacity, JSON.stringify(row)])
            }
            await client.query(`UPDATE ticket_types SET "servilexEnabled"=true,"servilexIndicator"='AC',"servilexSucursalCode"='01',
              "servilexServiceCode"=$2,"servilexDisciplineCode"=$3,"servilexPoolCode"=$4,
              "servilexScheduleCode"=NULL,"servilexBindingId"=NULL,"servilexExtraConfig"=$5::jsonb,"updatedAt"=NOW() WHERE id=$1`,
              [plan.id, SUMMER_ABIO_SERVICE_CODE, SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_POOL_CODE, JSON.stringify(extraConfig)])
            const saved = (await client.query(`SELECT * FROM ticket_types WHERE id=$1`, [plan.id])).rows[0]
            const bindings = (await client.query(`SELECT "horarioCodigo","numeroCupos" FROM abio_catalog_bindings WHERE "codigoEmp"='001' AND "sucursalCodigo"='01' AND "servicioCodigo"=$1 AND "disciplinaCodigo"=$2 AND "piscinaCodigo"=$3 AND "isActive"`, [SUMMER_ABIO_SERVICE_CODE, SUMMER_ABIO_DISCIPLINE_CODE, SUMMER_ABIO_POOL_CODE])).rows
            const savedMapping = saved.servilexExtraConfig?.membershipSchedules
            if (!saved.servilexEnabled || saved.servilexServiceCode !== "K14" || saved.servilexDisciplineCode !== "00" || saved.servilexPoolCode !== "01" || saved.servilexScheduleCode !== null ||
                savedMapping?.profileKey !== "VERANO_3X" || savedMapping?.serviceStartDate !== "2027-01-01" || Object.keys(savedMapping?.codes ?? {}).length !== 15 || bindings.length !== 15 ||
                Object.entries(SUMMER_ABIO_EXTRA_CONFIG.membershipSchedules.codes).some(([key, code]) => savedMapping.codes[key] !== code) ||
                SUMMER_ABIO_SCHEDULES.some(r => !bindings.some(b => b.horarioCodigo === r.scheduleCode && b.numeroCupos === r.capacity))) throw new Error("Post-write verification failed")
            await client.query("COMMIT")
            console.log(`OK: 15 associations verified and committed; backup ${backup}; event remains unpublished`)
        } else await client.query("ROLLBACK")
        inTransaction = false
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Association failed")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
