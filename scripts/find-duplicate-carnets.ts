/**
 * Detecta carnets DUPLICADOS de membresía (ACADEMIA): la misma persona (por DNI
 * del alumno, o por nombre si no hay DNI) con 2+ tickets ACTIVE. Marca cuáles
 * provienen del lote presencial `PRES-<batch>:` para distinguir el que yo emití
 * del que el socio ya tenía (web / otro).
 *
 * READ-ONLY. No cancela nada; solo reporta. Uso:
 *   tsx --env-file=.env scripts/find-duplicate-carnets.ts
 *   tsx --env-file=.env scripts/find-duplicate-carnets.ts --batch=membresias-2026
 */
import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"

function parseArgs(argv: string[]) {
    const flags: Record<string, string | boolean> = {}
    for (const arg of argv) {
        if (arg.startsWith("--")) {
            const [k, ...rest] = arg.slice(2).split("=")
            flags[k] = rest.length ? rest.join("=") : true
        }
    }
    return flags
}

const cleanDni = (s: string | null) => (s ?? "").replace(/[^0-9kK]/g, "").trim()
const normName = (s: string | null) =>
    (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
const csvEscape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

async function main() {
    const flags = parseArgs(process.argv.slice(2))
    const batch = typeof flags.batch === "string" && flags.batch.trim() ? flags.batch.trim() : "membresias-2026"
    const batchPrefix = `PRES-${batch}:`

    const tickets = await prisma.ticket.findMany({
        where: { status: "ACTIVE", event: { category: "ACADEMIA" } },
        select: {
            id: true,
            ticketCode: true,
            attendeeName: true,
            attendeeDni: true,
            userId: true,
            createdAt: true,
            event: { select: { title: true } },
            ticketType: { select: { name: true } },
            user: { select: { email: true, name: true } },
            order: {
                select: {
                    id: true,
                    provider: true,
                    providerOrderNumber: true,
                    status: true,
                    totalAmount: true,
                    createdAt: true,
                },
            },
        },
        orderBy: { createdAt: "asc" },
    })

    type T = (typeof tickets)[number]
    const groups = new Map<string, T[]>()
    for (const t of tickets) {
        const dni = cleanDni(t.attendeeDni)
        const key = dni ? `dni:${dni}` : normName(t.attendeeName) ? `name:${normName(t.attendeeName)}` : `user:${t.userId}`
        const arr = groups.get(key)
        if (arr) arr.push(t)
        else groups.set(key, [t])
    }

    const dups = [...groups.entries()].filter(([, ts]) => ts.length >= 2)
    // Orden: primero los que involucran mi lote.
    const involvesBatch = (ts: T[]) => ts.some((t) => t.order?.providerOrderNumber?.startsWith(batchPrefix))
    dups.sort((a, b) => Number(involvesBatch(b[1])) - Number(involvesBatch(a[1])))

    const batchDups = dups.filter(([, ts]) => involvesBatch(ts))

    console.log(`Carnets ACTIVE de ACADEMIA: ${tickets.length}`)
    console.log(`Personas con 2+ carnets (duplicados): ${dups.length}`)
    console.log(`  de esos, que involucran mi lote "${batch}": ${batchDups.length}`)
    console.log("")

    const rows: string[] = [
        "grupo,dniAlumno,alumno,cuentaEmail,ticketCode,evento,ticketType,provider,providerOrderNumber,ordenStatus,ordenMonto,ordenCreada,esDeMiLote",
    ]
    let g = 0
    for (const [key, ts] of dups) {
        g += 1
        const dni = key.startsWith("dni:") ? key.slice(4) : ""
        console.log(`#${g} ${ts[0].attendeeName ?? "(sin nombre)"} — DNI ${dni || "(sin dni)"} — ${ts.length} carnets:`)
        for (const t of ts) {
            const isBatch = t.order?.providerOrderNumber?.startsWith(batchPrefix) ?? false
            console.log(
                `    ${isBatch ? "▶ LOTE" : "      "}  ${t.ticketCode}  ${t.ticketType.name.trim()}  prov=${t.order?.provider ?? "-"}  ` +
                `${t.order?.providerOrderNumber ?? "-"}  ${t.order?.status ?? "-"}  S/${Number(t.order?.totalAmount ?? 0).toFixed(2)}  ` +
                `${t.order?.createdAt ? new Date(t.order.createdAt).toISOString().slice(0, 16) : "-"}`
            )
            rows.push([
                String(g), dni, t.attendeeName ?? "", t.user?.email ?? "", t.ticketCode,
                t.event.title, t.ticketType.name.trim(), t.order?.provider ?? "",
                t.order?.providerOrderNumber ?? "", t.order?.status ?? "",
                Number(t.order?.totalAmount ?? 0).toFixed(2),
                t.order?.createdAt ? new Date(t.order.createdAt).toISOString() : "",
                isBatch ? "SI" : "NO",
            ].map((v) => csvEscape(String(v))).join(","))
        }
        console.log("")
    }

    const outDir = path.resolve("scripts/out")
    await mkdir(outDir, { recursive: true })
    const outPath = path.join(outDir, "carnets-duplicados.csv")
    await writeFile(outPath, rows.join("\n") + "\n", "utf8")
    console.log(`CSV: ${outPath}`)
}

main()
    .catch((e) => {
        console.error("Error fatal:", e instanceof Error ? e.message : e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
        process.exit(process.exitCode ?? 0)
    })
