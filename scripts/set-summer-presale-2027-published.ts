/**
 * Publica / despublica una preventa de verano 2027 (creadas con
 * create-summer-presales-2027.ts) en las 3 sedes o en una.
 *
 *   npx tsx scripts/set-summer-presale-2027-published.ts --preventa 2 --publish            (dry run)
 *   npx tsx scripts/set-summer-presale-2027-published.ts --preventa 1 --unpublish --apply
 *   ... --sede videna   (campo-de-marte | videna | vmt; por defecto las 3)
 *
 * Cambio de preventa (03/12, 10/12): despublicar la anterior y publicar la siguiente.
 * Tras --apply limpia la caché Redis del evento y del listado (sin esto el listado
 * público sigue mostrando el estado anterior; lo mismo que hace el admin al guardar).
 * Bloquea publicar un plan sin ABIO (servilexEnabled=false: se vendería sin boleta)
 * salvo --sin-abio explícito.
 */
import fs from "node:fs"
import path from "node:path"
import pg from "pg"
import { Redis } from "@upstash/redis"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const publish = args.includes("--publish")
const unpublish = args.includes("--unpublish")
const allowNoAbio = args.includes("--sin-abio")
const valueOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const preventa = valueOf("--preventa")
const sede = valueOf("--sede")
if (publish === unpublish || !["1", "2", "3"].includes(preventa ?? "") || (sede && !["campo-de-marte", "videna", "vmt"].includes(sede))) {
    console.error("Uso: --preventa 1|2|3 (--publish | --unpublish) [--sede campo-de-marte|videna|vmt] [--sin-abio] [--apply]")
    process.exit(1)
}

const env = fs.readFileSync(path.resolve(".env.production"), "utf8")
const connectionString = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]
if (!connectionString) throw new Error("DATABASE_URL missing")
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 })
const envValue = (key: string) => env.match(new RegExp(`^${key}="?([^"\r\n]+)"?`, "m"))?.[1]

/** Mismas claves que invalidateEventCache (src/lib/cache.ts). */
async function invalidateCache(events: Array<{ id: string; slug: string }>) {
    const url = envValue("UPSTASH_REDIS_REST_URL")
    const token = envValue("UPSTASH_REDIS_REST_TOKEN")
    if (!url || !token) {
        console.warn("Aviso: sin credenciales Upstash; la caché del listado se limpiará sola (o guarda el evento en el admin).")
        return
    }
    const redis = new Redis({ url, token })
    const listKeys = (await redis.smembers("cache:ns:events:list")) as string[]
    const keys = [
        ...events.flatMap(e => [`event:${e.id}`, `ticket-types:${e.id}`, `event:stats:${e.id}`, `event:slug:${e.slug}`]),
        "events:published", ...listKeys, "cache:ns:events:list",
    ]
    await redis.del(...keys)
    console.log(`Caché limpiada (${keys.length} claves).`)
}

async function main() {
    let inTransaction = false
    try {
        const slugs = (sede ? [sede] : ["campo-de-marte", "videna", "vmt"]).map(s => `preventa-${preventa}-verano-2027-${s}`)
        await client.connect()
        await client.query(apply ? "BEGIN" : "BEGIN READ ONLY")
        inTransaction = true
        const events = (await client.query(`SELECT id,slug,"isPublished","bannerUrl" FROM events WHERE slug = ANY($1) ${apply ? "FOR UPDATE" : ""}`, [slugs])).rows
        const missing = slugs.filter(s => !events.some(e => e.slug === s))
        if (missing.length) throw new Error(`No existen: ${missing.join(", ")}`)
        const plans = (await client.query(`SELECT "eventId",name,"servilexEnabled","servilexServiceCode",sold FROM ticket_types WHERE "eventId" = ANY($1)`, [events.map(e => e.id)])).rows

        console.table(events.map(e => {
            const own = plans.filter(p => p.eventId === e.id)
            return {
                slug: e.slug, publicado: e.isPublished, banner: Boolean(e.bannerUrl), vendidos: own.reduce((s, p) => s + p.sold, 0),
                abio: own.map(p => p.servilexEnabled ? p.servilexServiceCode : "SIN ABIO").join(" / "),
            }
        }))
        if (publish) {
            const noAbio = events.filter(e => plans.some(p => p.eventId === e.id && !p.servilexEnabled))
            if (noAbio.length && !allowNoAbio) throw new Error(`Planes sin ABIO en ${noAbio.map(e => e.slug).join(", ")}: se venderían sin boleta. Configura ABIO o usa --sin-abio.`)
            const noBanner = events.filter(e => !e.bannerUrl)
            if (noBanner.length) console.warn(`Aviso: sin banner en ${noBanner.map(e => e.slug).join(", ")}`)
        }
        if (apply) {
            await client.query(`UPDATE events SET "isPublished"=$2,"updatedAt"=NOW() WHERE id = ANY($1)`, [events.map(e => e.id), publish])
            await client.query("COMMIT")
            inTransaction = false
            console.log(`OK: preventa ${preventa} ${publish ? "PUBLICADA" : "DESPUBLICADA"} en ${events.length} sede(s).`)
            await invalidateCache(events)
        } else {
            await client.query("ROLLBACK")
            inTransaction = false
            console.log(`DRY RUN: se ${publish ? "publicaría" : "despublicaría"}. Repite con --apply.`)
        }
    } catch (error) {
        if (inTransaction) await client.query("ROLLBACK").catch(() => {})
        console.error(error instanceof Error ? error.message : "Fallo")
        process.exitCode = 1
    } finally { await client.end() }
}
void main()
