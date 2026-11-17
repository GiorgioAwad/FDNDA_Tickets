/** Configure the existing summer draft. Dry run unless --apply; never publishes it. */
import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import pg from "pg"
import { getMembershipScheduleProfile } from "../src/lib/membership-schedule"
import { SUMMER_MEMBERSHIP_SCHEDULE_KEY } from "../src/lib/membership-config"

const apply = process.argv.includes("--apply")
const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const connectionString = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]
if (!connectionString) throw new Error("DATABASE_URL missing")
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 })
const slug = "preventa-verano-2027-academia-fdnda"
const profile = getMembershipScheduleProfile("01", SUMMER_MEMBERSHIP_SCHEDULE_KEY)!
const hours = profile.categories.flatMap(category => category.frequencies[0].dayGroups[0].hours.map(hour => ({ ...hour, category: category.label })))
const capacity = hours.reduce((sum, h) => sum + h.capacity!, 0)
const name = "VERANO 2027 · 3 VECES POR SEMANA"
const benefits = [
    { text: "Pago único de S/ 640 por enero y febrero de 2027" },
    { text: "Lunes, miércoles y viernes" },
    { text: "Vigencia del 1 de enero al 28 de febrero de 2027" },
    { text: "Elige una hora fija para ambos meses, según categoría y cupos" },
]
const description = `<p>Preventa de verano 2027 en Campo de Marte.</p><p><strong>3 veces por semana: lunes, miércoles y viernes. Precio total: S/ 640 por enero y febrero de 2027.</strong></p><p>Vigencia del 1 de enero al 28 de febrero de 2027. Las clases duran una hora. El horario elegido se mantiene durante ambos meses.</p><p>Adultos de 18 años a más: 6:00–7:00 a. m., 7:00–8:00 a. m., 7:00–8:00 p. m. y 8:00–9:00 p. m. Niños de 6 a 17 años: horarios de 8:00 a. m. a 7:00 p. m.</p><table><thead><tr><th>Horario</th><th>Categoría</th><th>Cupos</th></tr></thead><tbody>${hours.sort((a,b) => a.start.localeCompare(b.start)).map(h => `<tr><td>${h.start}–${h.end}</td><td>${h.category}</td><td>${h.capacity}</td></tr>`).join("")}</tbody></table>`
let inTransaction = false
async function main() {
try {
    await client.connect()
    await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN READ ONLY")
    inTransaction = true
    const event = (await client.query(`SELECT * FROM events WHERE slug=$1 ${apply ? "FOR UPDATE" : ""}`, [slug])).rows[0]
    if (!event || event.category !== "ACADEMIA" || event.servilexSucursalCode !== "01" || event.isPublished) {
        throw new Error("Expected the unpublished Campo de Marte summer academy draft")
    }
    const plans = (await client.query(`SELECT * FROM ticket_types WHERE "eventId"=$1`, [event.id])).rows
    if (plans.length > 1 || plans.some(p => p.membershipScheduleKey !== SUMMER_MEMBERSHIP_SCHEDULE_KEY || p.sold !== 0)) {
        throw new Error("Unexpected existing plans or sales; refusing to overwrite")
    }
    const usage = (await client.query(`SELECT
      (SELECT count(*)::int FROM tickets WHERE "eventId"=$1) AS tickets,
      (SELECT count(*)::int FROM order_items oi JOIN ticket_types t ON t.id=oi."ticketTypeId" WHERE t."eventId"=$1) AS order_items`, [event.id])).rows[0]
    if (usage.tickets || usage.order_items) throw new Error("The draft already has purchases; refusing to overwrite")
    console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY RUN", eventId: event.id, name, price: 640, capacity, start: "2027-01-01", end: "2027-02-28", months: 2, frequency: "LMV", published: false, hours }, null, 2))
    if (apply) {
        fs.mkdirSync(path.resolve("tmp"), { recursive: true })
        const backup = path.resolve(`tmp/summer-presale-before-${Date.now()}.json`)
        fs.writeFileSync(backup, JSON.stringify({ event, plans }, null, 2), { flag: "wx" })
        await client.query(`UPDATE events SET description=$2,"ticketLayout"='PLANS',
          "membershipStartFixed"='2027-01-01',"membershipStartMin"=NULL,"membershipStartMax"=NULL,"updatedAt"=NOW()
          WHERE id=$1`, [event.id, description])
        const id = plans[0]?.id ?? crypto.randomUUID()
        await client.query(`INSERT INTO ticket_types
          (id,"eventId",name,description,price,capacity,"monthlyClassLimit","membershipDurationMonths",
           "membershipScheduleKey",benefits,"isActive","sortOrder","updatedAt")
          VALUES ($1,$2,$3,$4,640,$5,13,2,$6,$7::jsonb,true,0,NOW())
          ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
          price=EXCLUDED.price,capacity=EXCLUDED.capacity,"monthlyClassLimit"=EXCLUDED."monthlyClassLimit",
          "membershipDurationMonths"=EXCLUDED."membershipDurationMonths","membershipScheduleKey"=EXCLUDED."membershipScheduleKey",
          benefits=EXCLUDED.benefits,"isActive"=true,"updatedAt"=NOW()`,
          [id, event.id, name, "Enero y febrero · Lunes, miércoles y viernes · Una hora por clase", capacity, SUMMER_MEMBERSHIP_SCHEDULE_KEY, JSON.stringify(benefits)])
        const actual = (await client.query(`SELECT t.*,e."isPublished",e."membershipStartFixed",e."ticketLayout"
          FROM ticket_types t JOIN events e ON e.id=t."eventId" WHERE t.id=$1`, [id])).rows[0]
        if (Number(actual.price) !== 640 || actual.capacity !== 100 || actual.membershipDurationMonths !== 2 ||
            actual.membershipScheduleKey !== SUMMER_MEMBERSHIP_SCHEDULE_KEY || actual.isPublished || actual.ticketLayout !== "PLANS" ||
            actual.membershipStartFixed.toISOString().slice(0,10) !== "2027-01-01") throw new Error("Post-write verification failed")
        await client.query("COMMIT")
        console.log(`OK: one plan configured and verified; draft preserved; backup ${backup}`)
    } else await client.query("ROLLBACK")
    inTransaction = false
} catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {})
    console.error(error instanceof Error ? error.message : "Configuration failed")
    process.exitCode = 1
} finally { await client.end() }
}
void main()
