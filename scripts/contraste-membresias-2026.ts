/**
 * Contraste entre la hoja "Inscripciones Membresías 2026" (ventas presenciales y
 * derivadas a la web) y la base real de membresías en producción, por sede:
 * Campo de Marte (sucursal 01) y VIDENA (sucursal 03).
 *
 * Responde tres preguntas:
 *   1. ¿Quién está en el CSV y NO tiene carnet en la BD? (y por qué: sin cuenta
 *      web, marcado "Ticketing" pero nunca compró, listo para emitir, etc.)
 *   2. ¿Quién tiene carnet ACTIVE en la BD y NO figura en el CSV? (compras web
 *      que la hoja no registró)
 *   3. ¿Cuántos carnets hay por sede/plan/canal y cómo cuadra con la hoja?
 *
 * SOLO LECTURA: no escribe en la BD.
 *
 * Uso (desde fdnda-tickets/):
 *   npx tsx scripts/contraste-membresias-2026.ts
 *   npx tsx scripts/contraste-membresias-2026.ts --file=scripts/data/otro.csv
 */
import { readFile, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

// Cargar .env antes de importar prisma (nada carga dotenv solo en estos scripts).
for (const f of [".env", ".env.production"]) {
    try {
        const txt = readFileSync(resolve(process.cwd(), f), "utf8")
        for (const line of txt.split("\n")) {
            const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
            if (!m) continue
            let v = m[2].trim()
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
            if (!process.env[m[1]]) process.env[m[1]] = v
        }
    } catch { /* archivo opcional */ }
}
process.env.PRISMA_DATABASE_ADAPTER = process.env.PRISMA_DATABASE_ADAPTER || "neon"

void readFile // (evita el unused import cuando solo usamos la variante sync)

const DEFAULT_INPUT = "scripts/data/inscripciones-membresias-2026.csv"
const OUT_DIR = "scripts/out"

// Mismos índices de columna que el normalizador (encabezados multilínea).
const COL = {
    num: 0, metodoPago: 1,
    apoderadoNombre: 2, apoderadoDni: 3, apoderadoCel: 4, apoderadoCorreo: 5,
    alumnoNombre: 6, alumnoDni: 7, alumnoCel: 8, alumnoCorreo: 9,
    edad: 10, frecuenciaHorario: 11, mesInicio: 12, sede: 13,
    plan: 14, membresia: 15, precio: 16, vendedor: 17,
} as const

const SEDES: Record<string, string> = { "01": "Campo de Marte (CDM)", "03": "VIDENA" }

// ── Parseo/normalización (mismas reglas que import-membresias-inscripciones-2026) ─
function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let field = ""
    let record: string[] = []
    let quoted = false
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i]
        const next = text[i + 1]
        if (quoted) {
            if (ch === '"' && next === '"') { field += '"'; i += 1 }
            else if (ch === '"') quoted = false
            else field += ch
            continue
        }
        if (ch === '"') quoted = true
        else if (ch === ",") { record.push(field); field = "" }
        else if (ch === "\n") { record.push(field); rows.push(record); record = []; field = "" }
        else if (ch !== "\r") field += ch
    }
    if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record) }
    return rows
}

function fixMojibake(s: string): string {
    if (!s || !/[ÃÂ]/.test(s)) return s
    try {
        const repaired = Buffer.from(s, "latin1").toString("utf8")
        if (repaired.includes("�") && !s.includes("�")) return s
        return repaired
    } catch { return s }
}
const clean = (s: string | undefined) => fixMojibake((s ?? "").replace(/﻿/g, "")).trim()
const up = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
const cleanDni = (s: string) => s.replace(/[^0-9kK]/g, "").trim()
// Clave canónica: ignora ceros a la izquierda (la hoja escribe 8133606 y la
// cuenta guarda 08133606, o al revés).
const dniKey = (s: string) => cleanDni(s).replace(/^0+/, "")
const dniVariants = (s: string) => {
    const raw = cleanDni(s)
    if (!raw) return []
    return Array.from(new Set([raw, raw.replace(/^0+/, ""), raw.padStart(8, "0")].filter(Boolean)))
}
function cleanEmail(s: string): string {
    const token = s.replace(/\s+/g, " ").trim().split(" ").find((t) => t.includes("@")) ?? ""
    return token.replace(/[^\w.@+\-]/g, "").toLowerCase()
}

type Tier = "BRONCE" | "PLATA" | "ORO"
function detectTier(s: string): Tier | null {
    const t = up(s)
    if (t.includes("ORO")) return "ORO"
    if (t.includes("PLATA")) return "PLATA"
    if (t.includes("BRONCE")) return "BRONCE"
    return null
}
function detectDuration(s: string): 6 | 12 | null {
    const t = up(s)
    if (t.includes("ANUAL")) return 12
    if (t.includes("SEMESTRAL") || /\bSEM\b|SEM\./.test(t)) return 6
    return null
}
function parseAmount(precio: string): number | null {
    const m = precio.replace(/s\/?\.?/i, "").match(/(\d[\d.,]*)/)
    if (!m) return null
    const n = Number(m[1].replace(/,/g, ""))
    return Number.isFinite(n) ? n : null
}

// ── Filas del CSV ──────────────────────────────────────────────────────────────
interface CsvRow {
    fila: string
    metodo: string
    alumno: string
    dni: string
    dniK: string
    correo: string
    celular: string
    apoderado: string
    apoderadoDni: string
    apoderadoCorreo: string
    sucursalCode: string | null
    sedeTexto: string
    tier: Tier | null
    duracion: 6 | 12 | null
    planTexto: string
    monto: number | null
    mesInicio: string
    vendedor: string
}

function loadCsvRows(file: string): CsvRow[] {
    const records = parseCsv(readFileSync(file, "utf8"))
    const headerIdx = records.findIndex((r) => clean(r[COL.num]) === "#")
    const dataRows = headerIdx >= 0 ? records.slice(headerIdx + 1) : records

    const out: CsvRow[] = []
    let sinNumero = 0
    for (const rec of dataRows) {
        const numRaw = clean(rec[COL.num])
        const isNumbered = /^\d+$/.test(numRaw)
        const alumno = clean(rec[COL.alumnoNombre])
        const dni = cleanDni(clean(rec[COL.alumnoDni]))
        const apoderado = clean(rec[COL.apoderadoNombre])
        const apoderadoDni = cleanDni(clean(rec[COL.apoderadoDni]))
        if (!isNumbered && !alumno && !dni && !apoderado && !apoderadoDni) continue

        const sedeTexto = clean(rec[COL.sede])
        const sedeUp = up(sedeTexto)
        const sucursalCode = sedeUp.includes("VIDENA") ? "03"
            : sedeUp.includes("CDM") || sedeUp.includes("CAMPO") ? "01"
            : null
        const precio = clean(rec[COL.precio])
        const membresiaCol = clean(rec[COL.membresia])
        const planCol = clean(rec[COL.plan])

        out.push({
            fila: isNumbered ? numRaw : `s/n-${++sinNumero}`,
            metodo: clean(rec[COL.metodoPago]) || "(vacío)",
            alumno,
            dni,
            dniK: dniKey(dni),
            correo: cleanEmail(clean(rec[COL.alumnoCorreo])),
            celular: clean(rec[COL.alumnoCel]) || clean(rec[COL.apoderadoCel]),
            apoderado,
            apoderadoDni,
            apoderadoCorreo: cleanEmail(clean(rec[COL.apoderadoCorreo])),
            sucursalCode,
            sedeTexto,
            tier: detectTier(precio) ?? detectTier(membresiaCol),
            duracion: detectDuration(precio) ?? detectDuration(planCol),
            planTexto: [membresiaCol, planCol].filter(Boolean).join(" ") || precio || "-",
            monto: parseAmount(precio),
            mesInicio: clean(rec[COL.mesInicio]),
            vendedor: clean(rec[COL.vendedor]),
        })
    }
    return out
}

// ── Main ───────────────────────────────────────────────────────────────────────
function getFlag(name: string): string | undefined {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : undefined
}

const fmtDate = (d: Date | null | undefined) =>
    d ? new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d) : "-"

async function main() {
    const inputFile = getFlag("file") ?? DEFAULT_INPUT
    const absInput = resolve(process.cwd(), inputFile)
    const csvRows = loadCsvRows(absInput)

    const { prisma } = await import("@/lib/prisma")

    const events = await prisma.event.findMany({
        where: { category: "ACADEMIA" },
        select: {
            id: true, slug: true, title: true, servilexSucursalCode: true,
            membershipStartFixed: true, membershipStartMin: true, membershipStartMax: true,
            ticketTypes: {
                select: {
                    id: true, name: true, capacity: true, sold: true, isActive: true,
                    membershipDurationMonths: true, membershipScheduleKey: true, monthlyClassLimit: true,
                },
            },
        },
    })
    const eventsBySucursal = new Map<string, typeof events>()
    for (const e of events) {
        const list = eventsBySucursal.get(e.servilexSucursalCode) ?? []
        list.push(e)
        eventsBySucursal.set(e.servilexSucursalCode, list)
    }

    const tickets = await prisma.ticket.findMany({
        where: { status: "ACTIVE", event: { category: "ACADEMIA" } },
        select: {
            id: true, ticketCode: true, attendeeName: true, attendeeDni: true,
            membershipStartDate: true, createdAt: true,
            event: { select: { slug: true, title: true, servilexSucursalCode: true } },
            ticketType: { select: { name: true, membershipDurationMonths: true } },
            user: { select: { email: true, name: true, dni: true } },
            order: { select: { provider: true, status: true, totalAmount: true, createdAt: true } },
        },
        orderBy: { createdAt: "asc" },
    })

    // Índice de carnets por DNI canónico del asistente (y fallback por nombre).
    type Carnet = (typeof tickets)[number]
    const carnetsByDni = new Map<string, Carnet[]>()
    const carnetsByName = new Map<string, Carnet[]>()
    for (const t of tickets) {
        const k = dniKey(t.attendeeDni ?? "")
        if (k) {
            const list = carnetsByDni.get(k) ?? []
            list.push(t)
            carnetsByDni.set(k, list)
        }
        const n = up(t.attendeeName ?? "")
        if (n.length >= 6) {
            const list = carnetsByName.get(n) ?? []
            list.push(t)
            carnetsByName.set(n, list)
        }
    }

    // Cuentas web existentes para los DNIs/correos del CSV (para explicar el "por qué no").
    const allDniVariants = Array.from(new Set(csvRows.flatMap((r) => [
        ...dniVariants(r.dni), ...dniVariants(r.apoderadoDni),
    ])))
    const allEmails = Array.from(new Set(csvRows.flatMap((r) => [r.correo, r.apoderadoCorreo]).filter(Boolean)))
    const users = await prisma.user.findMany({
        where: { OR: [{ dni: { in: allDniVariants } }, { email: { in: allEmails, mode: "insensitive" } }] },
        select: { email: true, dni: true, name: true },
    })
    const userByDni = new Map<string, (typeof users)[number]>()
    const userByEmail = new Map<string, (typeof users)[number]>()
    for (const u of users) {
        if (u.dni) userByDni.set(dniKey(u.dni), u)
        userByEmail.set(u.email.toLowerCase(), u)
    }
    const tieneCuenta = (r: CsvRow) => {
        const hasApoderado = Boolean(r.apoderadoDni || r.apoderadoCorreo || r.apoderado)
        const dni = hasApoderado ? r.apoderadoDni : r.dni
        const email = hasApoderado ? r.apoderadoCorreo : r.correo
        return Boolean((dni && userByDni.get(dniKey(dni))) || (email && userByEmail.get(email)))
    }

    // ── Cruce fila por fila ────────────────────────────────────────────────────
    type Estado = "CON CARNET" | "CARNET EN OTRA SEDE" | "SIN CARNET"
    interface Cruce {
        row: CsvRow
        estado: Estado
        carnet: Carnet | null
        matchPor: "DNI" | "NOMBRE" | ""
        motivo: string
    }

    const cruces: Cruce[] = []
    const carnetsUsados = new Set<string>()

    for (const row of csvRows) {
        const candidatos = (row.dniK ? carnetsByDni.get(row.dniK) : undefined)
            ?? (row.alumno ? carnetsByName.get(up(row.alumno)) : undefined)
            ?? []
        const matchPor: "DNI" | "NOMBRE" | "" = candidatos.length === 0 ? ""
            : (row.dniK && carnetsByDni.has(row.dniK)) ? "DNI" : "NOMBRE"

        const enSede = row.sucursalCode
            ? candidatos.find((c) => c.event.servilexSucursalCode === row.sucursalCode)
            : candidatos[0]

        if (enSede) {
            carnetsUsados.add(enSede.id)
            cruces.push({ row, estado: "CON CARNET", carnet: enSede, matchPor, motivo: "" })
            continue
        }
        if (candidatos.length > 0) {
            const otro = candidatos[0]
            carnetsUsados.add(otro.id)
            cruces.push({
                row, estado: "CARNET EN OTRA SEDE", carnet: otro, matchPor,
                motivo: `la hoja dice ${row.sedeTexto || "(sin sede)"} pero el carnet está en ${otro.event.title}`,
            })
            continue
        }

        // Sin carnet: explicar por qué.
        let motivo: string
        if (!row.sucursalCode) motivo = `sede no reconocida ("${row.sedeTexto || "vacía"}")`
        else if (up(row.metodo) === "TICKETING") {
            motivo = tieneCuenta(row)
                ? "marcado TICKETING (compra por la web) pero NO hay carnet: la compra nunca se completó"
                : "marcado TICKETING pero no tiene ni cuenta web ni carnet"
        } else if (!tieneCuenta(row)) motivo = "no tiene cuenta web (no se le puede emitir carnet hasta que se registre)"
        else motivo = "tiene cuenta web y no tiene carnet: pendiente de emitir"
        cruces.push({ row, estado: "SIN CARNET", carnet: null, matchPor: "", motivo })
    }

    // Carnets en BD que ninguna fila del CSV reclamó.
    const huerfanos = tickets.filter((t) => !carnetsUsados.has(t.id))

    // ── Reporte ────────────────────────────────────────────────────────────────
    const L: string[] = []
    const hoy = new Date().toISOString().slice(0, 10)
    L.push("# Contraste hoja de inscripciones ↔ base de membresías 2026\n")
    L.push(`Generado: ${new Date().toISOString()}`)
    L.push(`Hoja: \`${inputFile}\` · ${csvRows.length} filas con datos`)
    L.push(`Base: ${tickets.length} carnets ACTIVE en eventos ACADEMIA\n`)

    // 1. Eventos y su configuración
    L.push("## 1. Eventos de membresías en la base\n")
    L.push("| Sede | Evento | Inicio fijo | Rango permitido | Carnets ACTIVE |")
    L.push("| --- | --- | --- | --- | ---: |")
    for (const e of events.sort((a, b) => a.servilexSucursalCode.localeCompare(b.servilexSucursalCode))) {
        const n = tickets.filter((t) => t.event.slug === e.slug).length
        const rango = e.membershipStartMin || e.membershipStartMax
            ? `${fmtDate(e.membershipStartMin)} → ${fmtDate(e.membershipStartMax)}`
            : "-"
        L.push(`| ${SEDES[e.servilexSucursalCode] ?? e.servilexSucursalCode} | ${e.title} | ${fmtDate(e.membershipStartFixed)} | ${rango} | ${n} |`)
    }
    L.push("")

    // 2. Resumen por sede
    L.push("## 2. Resumen por sede\n")
    L.push("| Sede | Filas en la hoja | Con carnet | Sin carnet | Carnet en otra sede | Carnets en BD sin fila en la hoja |")
    L.push("| --- | ---: | ---: | ---: | ---: | ---: |")
    for (const code of ["01", "03"]) {
        const filas = cruces.filter((c) => c.row.sucursalCode === code)
        const huerf = huerfanos.filter((t) => t.event.servilexSucursalCode === code)
        L.push(`| ${SEDES[code]} | ${filas.length} | ${filas.filter((c) => c.estado === "CON CARNET").length} | ${filas.filter((c) => c.estado === "SIN CARNET").length} | ${filas.filter((c) => c.estado === "CARNET EN OTRA SEDE").length} | ${huerf.length} |`)
    }
    const sinSede = cruces.filter((c) => !c.row.sucursalCode)
    if (sinSede.length) L.push(`| (sede no reconocida) | ${sinSede.length} | ${sinSede.filter((c) => c.estado === "CON CARNET").length} | ${sinSede.filter((c) => c.estado === "SIN CARNET").length} | ${sinSede.filter((c) => c.estado === "CARNET EN OTRA SEDE").length} | - |`)
    L.push("")

    // 3. Carnets por plan y canal
    L.push("## 3. Carnets ACTIVE por plan y canal de venta\n")
    L.push("| Sede | Tipo de entrada | Presencial | Web (Izipay/otros) | Total | Cupo |")
    L.push("| --- | --- | ---: | ---: | ---: | ---: |")
    for (const e of events.sort((a, b) => a.servilexSucursalCode.localeCompare(b.servilexSucursalCode))) {
        const delEvento = tickets.filter((t) => t.event.slug === e.slug)
        for (const tt of e.ticketTypes.sort((a, b) => a.name.localeCompare(b.name))) {
            const delTipo = delEvento.filter((t) => t.ticketType.name === tt.name)
            if (delTipo.length === 0 && !tt.isActive) continue
            const pres = delTipo.filter((t) => t.order.provider === "PRESENCIAL").length
            L.push(`| ${SEDES[e.servilexSucursalCode] ?? e.servilexSucursalCode} | ${tt.name.trim()} | ${pres} | ${delTipo.length - pres} | ${delTipo.length} | ${tt.capacity} |`)
        }
    }
    L.push("")

    // 4. Sin carnet, agrupado por motivo
    const sinCarnet = cruces.filter((c) => c.estado === "SIN CARNET")
    L.push(`## 4. En la hoja pero SIN carnet (${sinCarnet.length})\n`)
    const porMotivo = new Map<string, Cruce[]>()
    for (const c of sinCarnet) {
        const key = c.motivo
        porMotivo.set(key, [...(porMotivo.get(key) ?? []), c])
    }
    for (const [motivo, list] of [...porMotivo.entries()].sort((a, b) => b[1].length - a[1].length)) {
        L.push(`### ${motivo} (${list.length})\n`)
        L.push("| Fila | Alumno | DNI | Método | Sede | Plan | Contacto | Vendedor |")
        L.push("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for (const c of list) {
            const contacto = [c.row.correo || c.row.apoderadoCorreo, c.row.celular].filter(Boolean).join(" / ") || "-"
            L.push(`| ${c.row.fila} | ${c.row.alumno || c.row.apoderado || "(sin nombre)"} | ${c.row.dni || "-"} | ${c.row.metodo} | ${c.row.sedeTexto || "-"} | ${c.row.planTexto} | ${contacto} | ${c.row.vendedor || "-"} |`)
        }
        L.push("")
    }

    // 5. Carnet en otra sede
    const otraSede = cruces.filter((c) => c.estado === "CARNET EN OTRA SEDE")
    if (otraSede.length) {
        L.push(`## 5. Discrepancia de sede (${otraSede.length})\n`)
        L.push("| Fila | Alumno | DNI | Sede en la hoja | Evento del carnet |")
        L.push("| --- | --- | --- | --- | --- |")
        for (const c of otraSede) {
            L.push(`| ${c.row.fila} | ${c.row.alumno} | ${c.row.dni || "-"} | ${c.row.sedeTexto || "-"} | ${c.carnet?.event.title ?? "-"} |`)
        }
        L.push("")
    }

    // 6. Huérfanos
    L.push(`## 6. Con carnet en la base pero SIN fila en la hoja (${huerfanos.length})\n`)
    L.push("_Compras hechas por la web que la hoja de inscripciones no registró._\n")
    L.push("| Sede | Asistente | DNI | Tipo de entrada | Canal | Emitido | Correo cuenta |")
    L.push("| --- | --- | --- | --- | --- | --- | --- |")
    for (const t of huerfanos.sort((a, b) => a.event.servilexSucursalCode.localeCompare(b.event.servilexSucursalCode) || (a.attendeeName ?? "").localeCompare(b.attendeeName ?? ""))) {
        L.push(`| ${SEDES[t.event.servilexSucursalCode] ?? t.event.servilexSucursalCode} | ${t.attendeeName ?? "-"} | ${t.attendeeDni ?? "-"} | ${t.ticketType.name.trim()} | ${t.order.provider} | ${fmtDate(t.createdAt)} | ${t.user.email} |`)
    }
    L.push("")

    // 7. Conciliados (referencia)
    const conCarnet = cruces.filter((c) => c.estado === "CON CARNET")
    L.push(`## 7. Conciliados (${conCarnet.length})\n`)
    L.push("| Fila | Alumno | DNI | Sede | Plan en la hoja | Tipo de entrada emitido | Canal | Inicio |")
    L.push("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for (const c of conCarnet) {
        L.push(`| ${c.row.fila} | ${c.row.alumno} | ${c.row.dni || "-"} | ${c.row.sedeTexto} | ${c.row.planTexto} | ${c.carnet?.ticketType.name.trim()} | ${c.carnet?.order.provider} | ${fmtDate(c.carnet?.membershipStartDate)} |`)
    }
    L.push("")

    // ── Salidas ────────────────────────────────────────────────────────────────
    mkdirSync(resolve(process.cwd(), OUT_DIR), { recursive: true })
    const mdPath = resolve(process.cwd(), OUT_DIR, `contraste-membresias-2026-${hoy}.md`)
    writeFileSync(mdPath, L.join("\n"), "utf8")

    const XLSX = await import("xlsx")
    const wb = XLSX.utils.book_new()

    const resumenRows = ["01", "03"].map((code) => {
        const filas = cruces.filter((c) => c.row.sucursalCode === code)
        return {
            Sede: SEDES[code],
            "Filas en la hoja": filas.length,
            "Con carnet": filas.filter((c) => c.estado === "CON CARNET").length,
            "Sin carnet": filas.filter((c) => c.estado === "SIN CARNET").length,
            "Carnet en otra sede": filas.filter((c) => c.estado === "CARNET EN OTRA SEDE").length,
            "Carnets ACTIVE en BD": tickets.filter((t) => t.event.servilexSucursalCode === code).length,
            "Carnets sin fila en la hoja": huerfanos.filter((t) => t.event.servilexSucursalCode === code).length,
        }
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenRows), "Resumen")

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sinCarnet.map((c) => ({
        Fila: c.row.fila, Alumno: c.row.alumno || c.row.apoderado, DNI: c.row.dni,
        Metodo: c.row.metodo, Sede: c.row.sedeTexto, Plan: c.row.planTexto,
        Correo: c.row.correo || c.row.apoderadoCorreo, Celular: c.row.celular,
        Apoderado: c.row.apoderado, "DNI apoderado": c.row.apoderadoDni,
        "Mes inicio": c.row.mesInicio, Vendedor: c.row.vendedor, Monto: c.row.monto ?? "",
        Motivo: c.motivo,
    }))), "Sin carnet")

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(huerfanos.map((t) => ({
        Sede: SEDES[t.event.servilexSucursalCode] ?? t.event.servilexSucursalCode,
        Evento: t.event.title, Asistente: t.attendeeName ?? "", DNI: t.attendeeDni ?? "",
        "Tipo de entrada": t.ticketType.name.trim(), Canal: t.order.provider,
        "Estado orden": t.order.status, Monto: Number(t.order.totalAmount),
        Emitido: fmtDate(t.createdAt), "Inicio membresia": fmtDate(t.membershipStartDate),
        Codigo: t.ticketCode, "Correo cuenta": t.user.email,
    }))), "BD sin hoja")

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conCarnet.map((c) => ({
        Fila: c.row.fila, Alumno: c.row.alumno, DNI: c.row.dni, Sede: c.row.sedeTexto,
        "Plan en la hoja": c.row.planTexto, "Tipo emitido": c.carnet?.ticketType.name.trim() ?? "",
        Canal: c.carnet?.order.provider ?? "", "Match por": c.matchPor,
        "Inicio membresia": fmtDate(c.carnet?.membershipStartDate),
        "Mes en la hoja": c.row.mesInicio, Codigo: c.carnet?.ticketCode ?? "",
    }))), "Conciliados")

    if (otraSede.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(otraSede.map((c) => ({
            Fila: c.row.fila, Alumno: c.row.alumno, DNI: c.row.dni,
            "Sede en la hoja": c.row.sedeTexto, "Evento del carnet": c.carnet?.event.title ?? "",
            Codigo: c.carnet?.ticketCode ?? "",
        }))), "Discrepancia sede")
    }

    const xlsxPath = resolve(process.cwd(), "..", `contraste-membresias-2026-${hoy}.xlsx`)
    XLSX.writeFile(wb, xlsxPath)

    console.log(`Hoja: ${absInput} (${csvRows.length} filas)`)
    console.log(`Carnets ACTIVE en BD: ${tickets.length}`)
    console.log("")
    for (const code of ["01", "03"]) {
        const filas = cruces.filter((c) => c.row.sucursalCode === code)
        console.log(`${SEDES[code]}:`)
        console.log(`  Filas en la hoja:           ${filas.length}`)
        console.log(`  Con carnet:                 ${filas.filter((c) => c.estado === "CON CARNET").length}`)
        console.log(`  Sin carnet:                 ${filas.filter((c) => c.estado === "SIN CARNET").length}`)
        console.log(`  Carnets ACTIVE en BD:       ${tickets.filter((t) => t.event.servilexSucursalCode === code).length}`)
        console.log(`  Carnets sin fila en la hoja:${huerfanos.filter((t) => t.event.servilexSucursalCode === code).length}`)
    }
    console.log("")
    console.log(`Reporte: ${mdPath}`)
    console.log(`Excel:   ${xlsxPath}`)

    await prisma.$disconnect()
}

main().catch((e) => {
    console.error("Error fatal:", e instanceof Error ? e.message : e)
    process.exitCode = 1
})
