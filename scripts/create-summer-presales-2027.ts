/**
 * Crea las preventas 1, 2 y 3 de verano 2027 en Campo de Marte, VIDENA y VMT
 * ("CUPOS x Horario 2027 LIMA.xlsx"): 9 eventos ACADEMIA (layout PLANS) con dos
 * planes cada uno — 3 veces por semana (L-M-V o M-J-S, VERANO_2027_3X) y 2 veces
 * por semana (Mar-Jue, VERANO_2027_2X). Sigue las pautas de la primera preventa de
 * Campo de Marte (preventa-verano-2027-academia-fdnda): inicio fijo de membresía,
 * 2 meses, enero y febrero 2027.
 *
 * Los eventos quedan SIN PUBLICAR y SIN ABIO (servilexEnabled=false): faltan los
 * códigos de servicio de ABIO para cada preventa/sede. Publicar con
 * set-summer-presale-2027-published.ts.
 *
 * Dry run por defecto; --apply escribe en una transacción y verifica.
 * Uso: npx tsx scripts/create-summer-presales-2027.ts [--apply]
 *
 * --update: para los 9 eventos ya creados, reescribe descripción y capacidad de
 * los planes según el catálogo actual (p. ej. tras separar la hora del sábado en
 * M-J-S, 2026-11-25). Solo si no hay órdenes y la descripción no se editó a mano
 * (debe coincidir con la versión anterior generada por este script).
 */
import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import pg from "pg"
import { formatTime12h, getMembershipScheduleProfile, type HourSlot } from "../src/lib/membership-schedule"
import { listMembershipLimitedSlots, maxMembershipStudents } from "../src/lib/membership-slot-capacity"
import { SUMMER_2027_2X_SCHEDULE_KEY, SUMMER_2027_3X_SCHEDULE_KEY } from "../src/lib/membership-config"

const apply = process.argv.includes("--apply")
const update = process.argv.includes("--update")
const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const connectionString = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]
if (!connectionString) throw new Error("DATABASE_URL missing")
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 })

const TEMPLATE_SLUG = "preventa-verano-2027-academia-fdnda"
const END_DATE = "2027-02-28 12:00:00"
const MEMBERSHIP_START_FIXED = "2027-01-04" // igual que la primera preventa de CDM

interface Sede { code: string; name: string; slugName: string; venue: string; location: string; reuseBanner: boolean }
const SEDES: Sede[] = [
    { code: "01", name: "Campo de Marte", slugName: "campo-de-marte", venue: "Campo de Marte", location: "Lima, Perú", reuseBanner: true },
    { code: "03", name: "VIDENA", slugName: "videna", venue: "Videna", location: "Lima, Perú", reuseBanner: false },
    { code: "04", name: "VMT", slugName: "vmt", venue: "VMT", location: "Complejo Deportivo Andrés Avelino Caceres, Lima, Perú", reuseBanner: false },
]
// Precios del Excel: [3 veces, 2 veces] por preventa.
const PRICES: Record<string, Array<[number, number]>> = {
    "01": [[640, 520], [680, 560], [720, 600]],
    "03": [[580, 480], [600, 500], [620, 520]],
    "04": [[440, 380], [460, 400], [480, 420]],
}
const PRESALE_STARTS = ["2026-11-26", "2026-12-03", "2026-12-10"]

const money = (n: number) => `S/ ${n}`

/** "6:00 a 8:00 a. m. y 7:00 a 9:00 p. m." a partir de franjas contiguas. */
function describeRanges(hours: HourSlot[]): string {
    const sorted = [...hours].sort((a, b) => a.start.localeCompare(b.start))
    const ranges: Array<{ start: string; end: string }> = []
    for (const h of sorted) {
        const last = ranges[ranges.length - 1]
        if (last && last.end === h.start) last.end = h.end
        else ranges.push({ start: h.start, end: h.end })
    }
    const fmt = (t: string) => formatTime12h(t).replace("a.m.", "a. m.").replace("p.m.", "p. m.")
    const parts = ranges.map(r => `de ${fmt(r.start)} a ${fmt(r.end)}`)
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}` : parts[0]
}

/** legacy = textos de la primera versión (M-J-S con la misma hora los tres días). */
function buildPresale(sede: Sede, index: number, legacy = false) {
    const n = index + 1
    const [price3, price2] = PRICES[sede.code][index]
    const p3 = getMembershipScheduleProfile(sede.code, SUMMER_2027_3X_SCHEDULE_KEY)
    const p2 = getMembershipScheduleProfile(sede.code, SUMMER_2027_2X_SCHEDULE_KEY)
    if (!p3 || !p2) throw new Error(`Sin perfil de verano 2027 para la sede ${sede.code}`)
    const hoursOf = (category: string) => p3.categories.find(c => c.id === category)!.frequencies[0].dayGroups[0].hours
    const adultText = describeRanges(hoursOf("ADULTOS"))
    const kidsText = describeRanges(hoursOf("NINOS"))
    const saturdayOf = (category: string) => p3.categories.find(c => c.id === category)!.frequencies.find(f => f.id === "MJS")!.dayGroups.find(g => g.id === "saturday")
    const adultSat = saturdayOf("ADULTOS")
    const kidsSat = saturdayOf("NINOS")
    if (!legacy && (!adultSat || !kidsSat)) throw new Error(`M-J-S sin grupo de sábado en ${sede.code}`)
    // La primera versión dejaba "p. m.." (doble punto); se conserva solo en legacy para reconocerla.
    const sentence = (text: string) => legacy || !text.endsWith(".") ? `${text}.` : text
    const mjsNote = (group: typeof adultSat) => legacy ? "" : ` En martes, jueves y sábado eliges una hora para martes y jueves y otra para el sábado (sábados ${describeRanges(group!.hours)}).`
    const capacity3 = maxMembershipStudents(listMembershipLimitedSlots(p3))
    const capacity2 = maxMembershipStudents(listMembershipLimitedSlots(p2))
    // 3x: 50 L-M-V + M-J-S limitado por el sábado (CDM 28, VIDENA/VMT 30).
    if (capacity3 !== { "01": 78, "03": 80, "04": 80 }[sede.code] || capacity2 !== 50) throw new Error(`Capacidad inesperada en ${sede.code}: ${capacity3}/${capacity2}`)

    const title = `PREVENTA ${n} VERANO 2027 - ${sede.name.toUpperCase()}`
    const slug = `preventa-${n}-verano-2027-${sede.slugName}`
    const description = [
        `<p>Preventa ${n} de verano 2027 en <strong>${sede.name}</strong>.</p>`,
        `<p>¡Haz de este verano una temporada de movimiento, aprendizaje y natación! Disfruta de una rutina de entrenamiento con horarios para niños y adultos durante <strong>enero y febrero de 2027</strong>, con un <strong>pago único</strong>:</p>`,
        `<ul>`,
        `<li><p><strong>3 veces por semana (${money(price3)}):</strong> lunes, miércoles y viernes o martes, jueves y sábado.</p></li>`,
        `<li><p><strong>2 veces por semana (${money(price2)}):</strong> martes y jueves.</p></li>`,
        `<li><p><strong>Duración:</strong> una hora por clase.</p></li>`,
        `<li><p><strong>Vigencia:</strong> enero y febrero de 2027.</p></li>`,
        legacy
            ? `<li><p><strong>Horario fijo:</strong> elige un turno disponible y mantenlo durante ambos meses. En martes, jueves y sábado la hora es la misma los tres días.</p></li>`
            : `<li><p><strong>Horario fijo:</strong> elige un turno disponible y mantenlo durante ambos meses. En martes, jueves y sábado eliges una hora para martes y jueves y otra para el sábado.</p></li>`,
        `<li><p><strong>Cupos limitados:</strong> cada horario tiene una capacidad definida.</p></li>`,
        `</ul>`,
        `<p>👧 <strong>Niños de 5 a 17 años:</strong> turnos de una hora ${sentence(kidsText)}${mjsNote(kidsSat)}</p>`,
        `<p>🧑 <strong>Adultos de 18 años a más:</strong> turnos de una hora ${sentence(adultText)}${mjsNote(adultSat)}</p>`,
        `<p>📌 <strong>Condiciones de la preventa</strong></p>`,
        `<p>La inscripción es <strong>personal e intransferible</strong> y corresponde exclusivamente al alumno registrado. La compra incluye únicamente el plan y la frecuencia elegidos, dentro de la categoría y el horario seleccionados, sujetos a disponibilidad.</p>`,
    ].join("")

    const plans = [
        {
            name: "VERANO 2027 · 3 VECES POR SEMANA",
            description: "Enero y febrero · Lun-Mié-Vie o Mar-Jue-Sáb · Una hora por clase",
            price: price3, capacity: capacity3, monthlyClassLimit: 12, key: SUMMER_2027_3X_SCHEDULE_KEY, sortOrder: 0,
            benefits: [
                { text: `Pago único de ${money(price3)} por enero y febrero de 2027` },
                { text: "3 veces por semana: lunes, miércoles y viernes o martes, jueves y sábado" },
                { text: "Vigencia: enero y febrero de 2027" },
                { text: "Elige una hora fija para ambos meses, según categoría y cupos" },
            ],
        },
        {
            name: "VERANO 2027 · 2 VECES POR SEMANA",
            description: "Enero y febrero · Martes y jueves · Una hora por clase",
            price: price2, capacity: capacity2, monthlyClassLimit: 8, key: SUMMER_2027_2X_SCHEDULE_KEY, sortOrder: 1,
            benefits: [
                { text: `Pago único de ${money(price2)} por enero y febrero de 2027` },
                { text: "2 veces por semana: martes y jueves" },
                { text: "Vigencia: enero y febrero de 2027" },
                { text: "Elige una hora fija para ambos meses, según categoría y cupos" },
            ],
        },
    ]
    return { sede, n, title, slug, description, startDate: `${PRESALE_STARTS[index]} 12:00:00`, plans }
}

let inTransaction = false

async function updateExisting(presales: ReturnType<typeof buildPresale>[]) {
    const changes: Array<Record<string, unknown>> = []
    for (const p of presales) {
        const event = (await client.query(`SELECT id,slug,description FROM events WHERE slug=$1 ${apply ? "FOR UPDATE" : ""}`, [p.slug])).rows[0]
        if (!event) throw new Error(`No existe ${p.slug}`)
        const plans = (await client.query(`SELECT * FROM ticket_types WHERE "eventId"=$1 ORDER BY "sortOrder" ${apply ? "FOR UPDATE" : ""}`, [event.id])).rows
        const orders = (await client.query(`SELECT count(*)::int n FROM order_items WHERE "ticketTypeId" = ANY($1)`, [plans.map(t => t.id)])).rows[0].n
        if (orders || plans.some(t => t.sold)) throw new Error(`${p.slug} ya tiene órdenes/ventas; no se toca`)
        if (plans.length !== 2 || p.plans.some((plan, i) => plans[i].membershipScheduleKey !== plan.key)) throw new Error(`${p.slug}: planes inesperados`)
        const legacy = buildPresale(p.sede, p.n - 1, true)
        const descriptionAction = event.description === p.description ? "sin cambio" : event.description === legacy.description ? "actualizar" : "EDITADA A MANO (no se toca)"
        changes.push({ slug: p.slug, descripcion: descriptionAction, capacidad3x: `${plans[0].capacity} -> ${p.plans[0].capacity}`, capacidad2x: `${plans[1].capacity} -> ${p.plans[1].capacity}` })
        if (apply) {
            if (descriptionAction === "actualizar") await client.query(`UPDATE events SET description=$2,"updatedAt"=NOW() WHERE id=$1`, [event.id, p.description])
            for (const [i, plan] of p.plans.entries()) {
                await client.query(`UPDATE ticket_types SET capacity=$2,"updatedAt"=NOW() WHERE id=$1`, [plans[i].id, plan.capacity])
            }
        }
    }
    console.table(changes)
    if (apply) {
        await client.query("COMMIT")
        inTransaction = false
        console.log("OK: actualizado.")
    } else {
        await client.query("ROLLBACK")
        inTransaction = false
        console.log("DRY RUN --update: no se escribió nada. Repite con --apply.")
    }
}

async function main() {
    try {
        const presales = SEDES.flatMap(sede => [0, 1, 2].map(i => buildPresale(sede, i)))
        await client.connect()
        await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN READ ONLY")
        inTransaction = true

        const template = (await client.query(`SELECT * FROM events WHERE slug=$1`, [TEMPLATE_SLUG])).rows[0]
        if (!template || template.category !== "ACADEMIA" || template.ticketLayout !== "PLANS") throw new Error("No se encontró la primera preventa de CDM como plantilla")
        const existing = (await client.query(`SELECT slug FROM events WHERE slug = ANY($1)`, [presales.map(p => p.slug)])).rows
        if (update) {
            await updateExisting(presales)
            return
        }
        if (existing.length) throw new Error(`Ya existen: ${existing.map(r => r.slug).join(", ")} (no se sobrescribe nada; usa --update)`)

        console.log(`${apply ? "APPLY" : "DRY RUN"}: ${presales.length} eventos, ${presales.length * 2} planes; plantilla ${TEMPLATE_SLUG}`)
        console.table(presales.flatMap(p => p.plans.map(plan => ({
            slug: p.slug, inicio: p.startDate.slice(0, 10), plan: plan.key, precio: plan.price, alumnos: plan.capacity, clasesMes: plan.monthlyClassLimit,
            banner: p.sede.reuseBanner ? "P1 CDM" : "—",
        }))))
        for (const sede of SEDES) {
            const p3 = getMembershipScheduleProfile(sede.code, SUMMER_2027_3X_SCHEDULE_KEY)!
            console.log(`\nCupos por franja ${sede.name} (iguales en L-M-V, M-J-S y Mar-Jue, cada frecuencia los suyos):`)
            console.table(listMembershipLimitedSlots(p3).filter(s => s.frequency === "LMV").map(s => ({ horario: `${s.start}-${s.end}`, categoria: s.categoryLabel, cupos: s.capacity })))
        }

        if (apply) {
            fs.mkdirSync(path.resolve("tmp"), { recursive: true })
            const created: Array<{ eventId: string; slug: string; planIds: string[] }> = []
            for (const p of presales) {
                const eventId = crypto.randomUUID()
                await client.query(`INSERT INTO events
                  (id,slug,title,description,location,venue,"bannerUrl","startDate","endDate",mode,"isPublished",discipline,
                   "updatedAt","createdBy",category,"advanceAmount",visibility,"accessToken","servilexSucursalCode",
                   "academiaWeeklyFrequency","ticketLayout","membershipStartFixed","membershipBlackoutExceptions")
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamp,$9::timestamp,'RANGE',false,$10,
                   NOW(),$11,'ACADEMIA',0,'PUBLIC',NULL,$12,NULL,'PLANS',$13::date,ARRAY[]::text[])`,
                  [eventId, p.slug, p.title, p.description, p.sede.location, p.sede.venue, p.sede.reuseBanner ? template.bannerUrl : null,
                   p.startDate, END_DATE, template.discipline, template.createdBy, p.sede.code, MEMBERSHIP_START_FIXED])
                const planIds: string[] = []
                for (const plan of p.plans) {
                    const id = crypto.randomUUID()
                    planIds.push(id)
                    await client.query(`INSERT INTO ticket_types
                      (id,"eventId",name,description,price,capacity,"monthlyClassLimit","membershipDurationMonths",
                       "membershipScheduleKey",benefits,"isActive","sortOrder","servilexEnabled","updatedAt")
                      VALUES ($1,$2,$3,$4,$5,$6,$7,2,$8,$9::jsonb,true,$10,false,NOW())`,
                      [id, eventId, plan.name, plan.description, plan.price, plan.capacity, plan.monthlyClassLimit, plan.key, JSON.stringify(plan.benefits), plan.sortOrder])
                }
                created.push({ eventId, slug: p.slug, planIds })
            }

            // Verificación post-escritura contra lo planeado.
            for (const p of presales) {
                const row = (await client.query(`SELECT e.*, e."startDate"::text AS s, e."membershipStartFixed"::text AS f FROM events e WHERE slug=$1`, [p.slug])).rows[0]
                const plans = (await client.query(`SELECT * FROM ticket_types WHERE "eventId"=$1 ORDER BY "sortOrder"`, [row.id])).rows
                const ok = row && !row.isPublished && row.servilexSucursalCode === p.sede.code && row.ticketLayout === "PLANS" && row.category === "ACADEMIA" &&
                    row.s === p.startDate && row.f === MEMBERSHIP_START_FIXED && plans.length === 2 &&
                    p.plans.every((plan, i) => Number(plans[i].price) === plan.price && plans[i].capacity === plan.capacity &&
                        plans[i].membershipScheduleKey === plan.key && plans[i].membershipDurationMonths === 2 &&
                        plans[i].monthlyClassLimit === plan.monthlyClassLimit && plans[i].sold === 0 && !plans[i].servilexEnabled)
                if (!ok) throw new Error(`Verificación falló para ${p.slug}`)
            }
            await client.query("COMMIT")
            inTransaction = false
            const log = path.resolve(`tmp/summer-presales-2027-created-${Date.now()}.json`)
            fs.writeFileSync(log, JSON.stringify(created, null, 2), { flag: "wx" })
            console.log(`\nOK: ${created.length} eventos creados y verificados (sin publicar, sin ABIO). Registro: ${log}`)
        } else {
            await client.query("ROLLBACK")
            inTransaction = false
            console.log("\nDRY RUN: no se escribió nada. Repite con --apply para crear.")
        }
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Creación fallida")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
