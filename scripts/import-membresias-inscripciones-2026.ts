/**
 * Normalizador de la base "Inscripciones Membresías 2026" (ventas presenciales).
 *
 * Cruza cada fila del CSV sucio contra las cuentas web y produce:
 *   - scripts/out/membresias-2026-ready.csv  → en el esquema EXACTO que consume
 *     scripts/issue-presential-carnets.ts (email, eventSlug, ticketTypeName, ...).
 *   - scripts/out/membresias-2026-review.md  → reporte por fila con su bucket
 *     (READY / EXCLUIDO-TICKETING / SIN-CUENTA / REVISION) y el motivo.
 *
 * Es READ-ONLY: solo consulta usuarios y tipos de entrada; NO escribe en BD ni
 * emite carnets. La emisión la hace issue-presential-carnets.ts con el CSV ready.
 *
 * Uso:
 *   tsx scripts/import-membresias-inscripciones-2026.ts
 *   tsx scripts/import-membresias-inscripciones-2026.ts --file=scripts/data/otro.csv
 *
 * Después:
 *   tsx scripts/issue-presential-carnets.ts --file=scripts/out/membresias-2026-ready.csv \
 *       --batch=membresias-2026 --allow-existing-active           # dry-run
 *   ... --confirm                                                  # emite + correo
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"

import {
    getMembershipScheduleProfile,
    validateMembershipScheduleSelection,
    formatSlotLabel,
    type MembershipScheduleInput,
    type MembershipScheduleSelection,
    type ScheduleCategoryId,
    type ScheduleFrequencyId,
} from "@/lib/membership-schedule"
import { isBlackoutMonth } from "@/lib/membership-config"

let prisma: typeof import("@/lib/prisma").prisma | null = null
async function loadPrisma() {
    if (!prisma) prisma = (await import("@/lib/prisma")).prisma
    return prisma
}
function db() {
    if (!prisma) throw new Error("Prisma no fue inicializado.")
    return prisma
}

const DEFAULT_INPUT = "scripts/data/inscripciones-membresias-2026.csv"
const OUT_DIR = "scripts/out"
const OUT_READY = "membresias-2026-ready.csv"
const OUT_REVIEW = "membresias-2026-review.md"
const OUT_PREVIEW = "membresias-2026-preview.html"
const OUT_PENDIENTES = "membresias-2026-pendientes.csv"
const DEFAULT_YEAR = 2026

// ── Índices de columna (encabezados duplicados/multilínea → mapeo por posición) ─
const COL = {
    num: 0,
    metodoPago: 1,
    apoderadoNombre: 2,
    apoderadoDni: 3,
    apoderadoCel: 4,
    apoderadoCorreo: 5,
    alumnoNombre: 6,
    alumnoDni: 7,
    alumnoCel: 8,
    alumnoCorreo: 9,
    edad: 10,
    frecuenciaHorario: 11,
    mesInicio: 12,
    sede: 13,
    plan: 14,
    membresia: 15,
    precio: 16,
    vendedor: 17,
} as const

type Bucket = "READY" | "EXCLUIDO-TICKETING" | "SIN-CUENTA" | "REVISION"

interface RowReport {
    rowNumber: number
    rowLabel: string
    alumno: string
    dni: string
    correo: string
    celular: string
    apoderado: string
    metodo: string
    sede: string
    planTexto: string
    bucket: Bucket
    motivo: string
}

interface ReadyRow {
    email: string
    eventSlug: string
    // ticketTypeId es la clave EXACTA para issue-presential (la prioriza sobre
    // nombre/slug): evita fallos por nombres con espacios finales o el .trim()
    // que hace el parser del downstream. eventSlug/ticketTypeName quedan solo
    // como referencia legible.
    ticketTypeId: string
    ticketTypeName: string
    attendeeName: string
    attendeeDni: string
    membershipStartDate: string
    sourceRef: string
    amountPaid: string
    scheduleCategory: string
    scheduleFrequency: string
    scheduleHoursJson: string
}

// Datos para el preview visual del carnet (mismo contenido que verá el socio).
interface PreviewCard {
    rowNumber: number
    eventTitle: string
    ticketTypeName: string
    attendeeName: string
    attendeeDni: string
    startDate: string
    sede: string
    monthlyClassLimit: number | null
    selection: MembershipScheduleSelection | null
}

// ── Parser CSV quote-aware (respeta comillas y saltos de línea dentro de campo) ─
function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let field = ""
    let record: string[] = []
    let quoted = false
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i]
        const next = text[i + 1]
        if (quoted) {
            if (ch === '"' && next === '"') {
                field += '"'
                i += 1
            } else if (ch === '"') {
                quoted = false
            } else {
                field += ch
            }
            continue
        }
        if (ch === '"') {
            quoted = true
        } else if (ch === ",") {
            record.push(field)
            field = ""
        } else if (ch === "\n") {
            record.push(field)
            rows.push(record)
            record = []
            field = ""
        } else if (ch === "\r") {
            // ignorar; el \n cierra el registro
        } else {
            field += ch
        }
    }
    // último campo/registro si el archivo no termina en salto de línea
    if (field.length > 0 || record.length > 0) {
        record.push(field)
        rows.push(record)
    }
    return rows
}

// Repara doble-encoding latin1→utf8 (mojibake típico: "MÃ©todo" → "Método").
function fixMojibake(s: string): string {
    if (!s || !/[ÃÂ]/.test(s)) return s
    try {
        const repaired = Buffer.from(s, "latin1").toString("utf8")
        if (repaired.includes("�") && !s.includes("�")) return s
        return repaired
    } catch {
        return s
    }
}

function clean(s: string | undefined): string {
    return fixMojibake((s ?? "").replace(/﻿/g, "")).trim()
}

// Normaliza a MAYÚSCULAS sin acentos, colapsa espacios (para clasificar texto).
function up(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim()
}

function cleanDni(s: string): string {
    return s.replace(/[^0-9kK]/g, "").trim()
}

function cleanEmail(s: string): string {
    // quita caracteres basura/espacios y toma el token con "@"
    const token = s.replace(/\s+/g, " ").trim().split(" ").find((t) => t.includes("@")) ?? ""
    return token.replace(/[^\w.@+\-]/g, "").toLowerCase()
}

// ── Plan / tier / duración / variante desde el string de Precio (+ columnas) ────
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
function detect2x(precio: string, amount: number | null): boolean {
    const t = up(precio)
    return /SEMESTRAL\s*2|SEM\.?\s*2|BRONCE\s*2/.test(t) || amount === 890
}

function parseAmount(precio: string): number | null {
    const m = precio.replace(/s\/?\.?/i, "").match(/(\d[\d.,]*)/)
    if (!m) return null
    const n = Number(m[1].replace(/,/g, ""))
    return Number.isFinite(n) ? n : null
}

// ── Mes de inicio → "YYYY-MM-DD" (día 1; año explícito si aparece, si no 2026) ──
const MESES: Record<string, number> = {
    ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
    JULIO: 7, AGOSTO: 8, SETIEMBRE: 9, SEPTIEMBRE: 9, OCTUBRE: 10,
    NOVIEMBRE: 11, DICIEMBRE: 12,
}
function parseStartDate(mesTexto: string): { date: string } | { error: string } {
    const t = up(mesTexto)
    if (!t) return { error: "falta mes de inicio" }
    const monthKey = Object.keys(MESES).find((m) => t.includes(m))
    if (!monthKey) return { error: `mes de inicio no reconocido ("${mesTexto}")` }
    const month = MESES[monthKey]
    const yearMatch = t.match(/\b(20\d{2})\b/)
    const year = yearMatch ? Number(yearMatch[1]) : DEFAULT_YEAR
    if (isBlackoutMonth(month)) return { error: `mes de inicio ${monthKey} cae en blackout (ene/feb)` }
    return { date: `${year}-${String(month).padStart(2, "0")}-01` }
}

// ── Horario: extrae rangos "HH:MM-HH:MM" del texto libre ───────────────────────
interface HourRange { start: string; end: string }

function to24(hour: number, minute: number, ampm: string | null): string | null {
    let h = hour
    if (ampm === "pm" && h < 12) h += 12
    if (ampm === "am" && h === 12) h = 0
    if (h < 0 || h > 23 || minute < 0 || minute > 59) return null
    return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function parseHourRanges(raw: string): HourRange[] {
    let t = raw.toLowerCase()
    t = t.replace(/a\.?\s*m\.?/g, "am").replace(/p\.?\s*m\.?/g, "pm")
    t = t.replace(/\bhrs?\b|\bhoras?\b/g, " ")
    const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:a|-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g
    const ranges: HourRange[] = []
    let match: RegExpExecArray | null
    while ((match = re.exec(t)) !== null) {
        const sH = Number(match[1])
        const sM = match[2] ? Number(match[2]) : 0
        let sA = match[3] || null
        const eH = Number(match[4])
        const eM = match[5] ? Number(match[5]) : 0
        let eA = match[6] || null
        // heredar AM/PM del extremo que sí lo tenga
        if (!sA && eA) sA = eA
        if (!eA && sA) eA = sA
        if (!sA || !eA) continue // sin AM/PM no podemos resolver con certeza
        const start = to24(sH, sM, sA)
        const end = to24(eH, eM, eA)
        if (!start || !end) continue
        ranges.push({ start, end })
    }
    return ranges
}

const HHMM = (r: HourRange) => `${r.start}-${r.end}`

// ── Tipos de entrada ACADEMIA precargados ──────────────────────────────────────
interface AcademiaTicketType {
    id: string
    name: string
    membershipDurationMonths: number | null
    membershipScheduleKey: string | null
    monthlyClassLimit: number | null
    isActive: boolean
    eventSlug: string
    eventTitle: string
    sucursalCode: string
}

async function loadAcademiaTicketTypes(): Promise<AcademiaTicketType[]> {
    const tts = await db().ticketType.findMany({
        where: { event: { category: "ACADEMIA" } },
        select: {
            id: true,
            name: true,
            membershipDurationMonths: true,
            membershipScheduleKey: true,
            monthlyClassLimit: true,
            isActive: true,
            event: { select: { slug: true, title: true, servilexSucursalCode: true } },
        },
    })
    return tts.map((tt) => ({
        id: tt.id,
        name: tt.name,
        membershipDurationMonths: tt.membershipDurationMonths,
        membershipScheduleKey: tt.membershipScheduleKey,
        monthlyClassLimit: tt.monthlyClassLimit,
        isActive: tt.isActive,
        eventSlug: tt.event.slug,
        eventTitle: tt.event.title,
        sucursalCode: tt.event.servilexSucursalCode,
    }))
}

// Tipo de entrada sintético para el modo --offline (sin BD): permite ejercitar
// el parseo/validación de horario/fecha sin resolver contra la BD real.
function makeOfflineTicketType(
    sucursalCode: string,
    duration: 6 | 12,
    scheduleKey: string | null,
    tier: Tier,
    is2x: boolean
): AcademiaTicketType {
    const dur = duration === 12 ? "ANUAL" : "SEMESTRAL"
    const suffix = is2x ? " 2X" : ""
    // Cupo mensual APROXIMADO por frecuencia (clases/semana × 4). El valor real
    // vive en TicketType.monthlyClassLimit y se toma en el modo online.
    const monthlyClassLimit =
        scheduleKey === "BRONCE" ? 12 :
        scheduleKey === "BRONCE_2X" ? 8 :
        scheduleKey === "PLATA" ? 20 :
        null // ORO: acceso diario, sin cupo mensual fijo
    return {
        id: "offline",
        name: `MEMBRESIA ${dur} ${tier}${suffix}`,
        membershipDurationMonths: duration,
        membershipScheduleKey: scheduleKey,
        monthlyClassLimit,
        isActive: true,
        eventSlug: `academia-${sucursalCode}`,
        eventTitle: `Membresías ${sucursalCode === "03" ? "VIDENA" : "CDM"} (offline)`,
        sucursalCode,
    }
}

function resolveTicketType(
    all: AcademiaTicketType[],
    sucursalCode: string,
    duration: 6 | 12,
    scheduleKey: string | null,
    tier: Tier
): { ok: true; tt: AcademiaTicketType } | { ok: false; error: string } {
    const candidates = all.filter((tt) => {
        if (!tt.isActive) return false
        if (tt.sucursalCode !== sucursalCode) return false
        if ((tt.monthlyClassLimit ?? 0) <= 0) return false
        if (tt.membershipDurationMonths !== duration) return false
        if (scheduleKey) return tt.membershipScheduleKey === scheduleKey
        // ORO: sin scheduleKey y nombre contiene "ORO"
        return tt.membershipScheduleKey == null && up(tt.name).includes("ORO")
    })
    const dur = duration === 12 ? "anual" : "semestral"
    const key = scheduleKey ?? `${tier} (sin scheduleKey)`
    if (candidates.length === 0) {
        return { ok: false, error: `no existe ticketType ACADEMIA para sede ${sucursalCode} / ${dur} / ${key}` }
    }
    if (candidates.length > 1) {
        return {
            ok: false,
            error: `${candidates.length} ticketTypes coinciden (sede ${sucursalCode} / ${dur} / ${key}): ${candidates.map((c) => c.name).join(" | ")}`,
        }
    }
    return { ok: true, tt: candidates[0] }
}

// ── Cruce de cuenta web ────────────────────────────────────────────────────────
async function findUser(dni: string, email: string) {
    if (dni) {
        const byDni = await db().user.findFirst({
            where: { dni },
            select: { id: true, email: true, name: true },
        })
        if (byDni) return byDni
    }
    if (email) {
        const byEmail = await db().user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
            select: { id: true, email: true, name: true },
        })
        if (byEmail) return byEmail
    }
    return null
}

// ── Resolución de horario para una fila ────────────────────────────────────────
function resolveScheduleInput(
    scheduleKey: string,
    freqText: string
):
    | { ok: true; frequency: ScheduleFrequencyId; hours: Record<string, string> }
    | { ok: false; error: string } {
    const T = up(freqText)
    if (!T || T === "-") return { ok: false, error: "horario vacío/indefinido" }
    if (/NO DEFINIDO|POR DEFINIR|PENDIENTE/.test(T)) return { ok: false, error: "horario sin definir" }

    let frequency: ScheduleFrequencyId
    if (scheduleKey === "PLATA") frequency = "LV"
    else if (scheduleKey === "BRONCE_2X") frequency = "MJ"
    else {
        // BRONCE interdiario: sábado/MJS ⇒ MJS ; viernes/LMV ⇒ LMV.
        // (up() normaliza acentos/mojibake, p.ej. "SÃB" → "SAB".)
        if (/\bMJS\b/.test(T) || /\bSAB/.test(T)) frequency = "MJS"
        else if (/\bLMV\b/.test(T) || /\bVIE|\bVIER|\bV\b/.test(T)) frequency = "LMV"
        else return { ok: false, error: `no se pudo determinar frecuencia BRONCE de "${freqText}"` }
    }

    if (frequency === "MJS") {
        // Convención del CSV: la hora de Mar/Jue va primero y la de Sábado
        // después (multilínea o inline). Tomamos el primer rango como Mar/Jue y
        // el último como Sábado; si solo hay uno, se comparte. Enfoque posicional
        // (no depende de ubicar el texto "SÁB", que a veces viene con mojibake).
        const ranges = parseHourRanges(freqText)
        if (ranges.length === 0) {
            return { ok: false, error: `sin hora reconocible en "${freqText}"` }
        }
        const wRange = ranges[0]
        const sRange = ranges.length > 1 ? ranges[ranges.length - 1] : ranges[0]
        return { ok: true, frequency, hours: { weekday: HHMM(wRange), saturday: HHMM(sRange) } }
    }

    const range = parseHourRanges(freqText)[0]
    if (!range) return { ok: false, error: `sin hora reconocible en "${freqText}"` }
    return { ok: true, frequency, hours: { main: HHMM(range) } }
}

// ── CSV out ────────────────────────────────────────────────────────────────────
function csvEscape(value: string): string {
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
}
const READY_HEADERS: (keyof ReadyRow)[] = [
    "email", "eventSlug", "ticketTypeId", "ticketTypeName", "attendeeName", "attendeeDni",
    "membershipStartDate", "sourceRef", "amountPaid", "scheduleCategory",
    "scheduleFrequency", "scheduleHoursJson",
]
function readyToCsv(rows: ReadyRow[]): string {
    const lines = [READY_HEADERS.join(",")]
    for (const r of rows) {
        lines.push(READY_HEADERS.map((h) => csvEscape(r[h] ?? "")).join(","))
    }
    return lines.join("\n") + "\n"
}

function buildReview(reports: RowReport[]): string {
    const counts: Record<Bucket, number> = {
        READY: 0, "EXCLUIDO-TICKETING": 0, "SIN-CUENTA": 0, REVISION: 0,
    }
    for (const r of reports) counts[r.bucket] += 1

    const order: Bucket[] = ["READY", "REVISION", "SIN-CUENTA", "EXCLUIDO-TICKETING"]
    const lines: string[] = []
    lines.push("# Inscripciones Membresías 2026 — cruce y emisión de carnets\n")
    lines.push(`Generado: ${new Date().toISOString()}\n`)
    lines.push("## Resumen")
    lines.push("")
    lines.push("| Bucket | Filas |")
    lines.push("| --- | ---: |")
    lines.push(`| READY (a emitir) | ${counts.READY} |`)
    lines.push(`| REVISION (corregir a mano) | ${counts.REVISION} |`)
    lines.push(`| SIN-CUENTA (no tiene cuenta web) | ${counts["SIN-CUENTA"]} |`)
    lines.push(`| EXCLUIDO-TICKETING (ya compró web) | ${counts["EXCLUIDO-TICKETING"]} |`)
    lines.push(`| **Total** | **${reports.length}** |`)
    lines.push("")

    for (const bucket of order) {
        const rows = reports.filter((r) => r.bucket === bucket)
        if (rows.length === 0) continue
        lines.push(`## ${bucket} (${rows.length})`)
        lines.push("")
        lines.push("| # | Alumno | DNI | Método | Sede | Plan | Detalle |")
        lines.push("| ---: | --- | --- | --- | --- | --- | --- |")
        for (const r of rows) {
            const cells = [
                String(r.rowNumber), r.alumno, r.dni, r.metodo, r.sede, r.planTexto,
                r.motivo,
            ].map((c) => c.replace(/\|/g, "\\|").replace(/\n/g, " "))
            lines.push(`| ${cells.join(" | ")} |`)
        }
        lines.push("")
    }
    return lines.join("\n")
}

// ── CSV de pendientes (sin cuenta + revisión, con contacto y motivo) ───────────
function buildPendientesCsv(reports: RowReport[]): string {
    const headers = [
        "fila", "bucket", "motivo", "alumno", "dniAlumno", "correo", "celular",
        "apoderado", "metodo", "sede", "plan",
    ]
    const rows = reports
        .filter((r) => r.bucket === "SIN-CUENTA" || r.bucket === "REVISION")
        .sort((a, b) => (a.bucket === b.bucket ? a.rowNumber - b.rowNumber : a.bucket === "SIN-CUENTA" ? 1 : -1))
    const lines = [headers.join(",")]
    for (const r of rows) {
        lines.push([
            String(r.rowNumber), r.bucket, r.motivo, r.alumno, r.dni, r.correo,
            r.celular, r.apoderado, r.metodo, r.sede, r.planTexto,
        ].map((v) => csvEscape(v ?? "")).join(","))
    }
    return lines.join("\n") + "\n"
}

// ── Preview HTML del carnet (mismo contenido que verá el socio) ────────────────
function escHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

function formatDateEs(yyyyMmDd: string): string {
    const [y, m, d] = yyyyMmDd.split("-").map(Number)
    if (!y || !m || !d) return yyyyMmDd
    const date = new Date(Date.UTC(y, m - 1, d, 12))
    return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", year: "numeric" }).format(date)
}

function previewCardHtml(card: PreviewCard, offline: boolean): string {
    const horario = card.selection
        ? `
        <div class="row">
          <div class="ico">🕒</div>
          <div>
            <div class="lbl">Tu horario (fijo durante la membresía)</div>
            <div class="val">${escHtml(card.selection.categoryLabel ? `${card.selection.categoryLabel} · ` : "")}${escHtml(card.selection.frequencyLabel)}</div>
            <ul class="hours">
              ${card.selection.groups.map((g) => `<li>${escHtml(g.label)}: ${escHtml(formatSlotLabel({ start: g.start, end: g.end }))}</li>`).join("")}
            </ul>
          </div>
        </div>`
        : `
        <div class="row">
          <div class="ico">🕒</div>
          <div><div class="lbl">Horario</div><div class="val">Acceso diario (sin horario fijo)</div></div>
        </div>`

    const cupo = card.monthlyClassLimit && card.monthlyClassLimit > 0
        ? `
        <div class="carnet">
          <div class="carnet-h">Carnet de asistencia · ${card.monthlyClassLimit} clases/mes${offline ? " (aprox.)" : ""}</div>
          <div class="grid">
            ${Array.from({ length: card.monthlyClassLimit }, (_, i) => `<div class="cell"><span>Asistencia</span><b>${i + 1}</b></div>`).join("")}
          </div>
        </div>`
        : `
        <div class="carnet">
          <div class="carnet-h">Acceso diario (sin cupo mensual fijo)</div>
        </div>`

    return `
    <div class="carnet-card">
      <div class="hdr">
        <div class="evt">${escHtml(card.eventTitle)}</div>
        <div class="tt">${escHtml(card.ticketTypeName)}</div>
      </div>
      <div class="qr">
        <div class="qr-box">Código QR<br/><small>se genera al emitir</small></div>
        <div class="qr-note">El código QR se actualiza diariamente</div>
      </div>
      <div class="body">
        <div class="row"><div class="ico">👤</div><div><div class="lbl">Asistente</div><div class="val">${escHtml(card.attendeeName)}</div>${card.attendeeDni ? `<div class="sub">DNI: ${escHtml(card.attendeeDni)}</div>` : ""}</div></div>
        <div class="row"><div class="ico">📅</div><div><div class="lbl">Inicio de membresía</div><div class="val">${escHtml(formatDateEs(card.startDate))}</div></div></div>
        <div class="row"><div class="ico">📍</div><div><div class="lbl">Ubicación</div><div class="val">${escHtml(card.sede)}</div></div></div>
        ${horario}
        <div class="code"><span>Código:</span><b>—— (se genera al emitir)</b></div>
      </div>
      ${cupo}
      <div class="fila">Fila #${card.rowNumber} del CSV</div>
    </div>`
}

function buildPreviewHtml(previews: PreviewCard[], offline: boolean): string {
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Preview de carnets · Membresías 2026</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef2f7; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111827; }
  .page { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 13px; margin: 0 0 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
  .carnet-card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 24px rgba(15,23,42,.08); }
  .hdr { background: linear-gradient(135deg, #1d4ed8, #0ea5e9); color: #fff; padding: 16px; text-align: center; }
  .hdr .evt { font-weight: 700; font-size: 16px; }
  .hdr .tt { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,.2); font-size: 12px; }
  .qr { padding: 18px; text-align: center; border-bottom: 1px dashed #d1d5db; }
  .qr-box { width: 150px; height: 150px; margin: 0 auto 8px; border-radius: 12px; background: #f3f4f6; color: #9ca3af; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; }
  .qr-note { display: inline-block; font-size: 11px; color: #b45309; background: #fffbeb; padding: 3px 10px; border-radius: 999px; }
  .body { padding: 16px; }
  .row { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; }
  .ico { width: 20px; text-align: center; }
  .lbl { font-size: 11px; color: #6b7280; }
  .val { font-weight: 600; font-size: 14px; }
  .sub { font-size: 12px; color: #6b7280; }
  .hours { margin: 4px 0 0; padding-left: 16px; font-size: 13px; color: #4b5563; }
  .code { display: flex; justify-content: space-between; border-top: 1px solid #e5e7eb; margin-top: 8px; padding-top: 12px; font-size: 13px; color: #6b7280; }
  .code b { font-family: ui-monospace, monospace; color: #374151; }
  .carnet { padding: 16px; border-top: 1px solid #e5e7eb; }
  .carnet-h { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .cell { border: 1px solid #e5e7eb; background: #f9fafb; border-radius: 8px; text-align: center; padding: 6px 2px; }
  .cell span { display: block; font-size: 9px; text-transform: uppercase; color: #9ca3af; }
  .cell b { font-size: 13px; color: #374151; }
  .fila { padding: 8px 16px 14px; font-size: 11px; color: #9ca3af; text-align: right; }
</style></head>
<body><div class="page">
  <h1>Preview de carnets · Membresías 2026</h1>
  <p class="muted">${previews.length} carnet(s) listos para emitir (bucket READY). Vista aproximada de lo que verá cada socio en su cuenta. El QR y el código se generan al emitir.${offline ? " <b>Modo offline</b>: el título del evento y el cupo mensual son aproximados; al correr online se toman los valores reales del TicketType." : ""}</p>
  <div class="cards">
    ${previews.map((card) => previewCardHtml(card, offline)).join("\n")}
  </div>
</div></body></html>`
}

// ── Main ────────────────────────────────────────────────────────────────────────
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

async function main() {
    const flags = parseArgs(process.argv.slice(2))
    const inputFile = typeof flags.file === "string" ? flags.file : DEFAULT_INPUT
    const absInput = path.resolve(inputFile)
    // --offline: no toca la BD; stubea cuenta web y tipo de entrada para validar
    // solo el parseo/normalización del CSV (horarios, fechas, planes).
    const offline = flags.offline === true

    const raw = await readFile(absInput, "utf8")
    const records = parseCsv(raw)

    // localizar la fila de encabezado (primera celda === "#")
    const headerIdx = records.findIndex((r) => clean(r[COL.num]) === "#")
    const dataRows = headerIdx >= 0 ? records.slice(headerIdx + 1) : records

    if (!offline) await loadPrisma()
    const academiaTts = offline ? [] : await loadAcademiaTicketTypes()

    const reports: RowReport[] = []
    const ready: ReadyRow[] = []
    const previews: PreviewCard[] = []
    const seenSourceRefs = new Set<string>()

    for (const rec of dataRows) {
        const numRaw = clean(rec[COL.num])
        if (!numRaw || !/^\d+$/.test(numRaw)) continue // filas vacías/no numeradas

        const rowNumber = Number(numRaw)
        const metodo = clean(rec[COL.metodoPago])
        const apoderadoNombre = clean(rec[COL.apoderadoNombre])
        const apoderadoDni = cleanDni(clean(rec[COL.apoderadoDni]))
        const apoderadoCorreo = cleanEmail(clean(rec[COL.apoderadoCorreo]))
        const apoderadoCel = clean(rec[COL.apoderadoCel])
        const alumnoNombre = clean(rec[COL.alumnoNombre])
        const alumnoDni = cleanDni(clean(rec[COL.alumnoDni]))
        const alumnoCorreo = cleanEmail(clean(rec[COL.alumnoCorreo]))
        const alumnoCel = clean(rec[COL.alumnoCel])
        const edadRaw = clean(rec[COL.edad])
        const edad = /^\d{1,3}$/.test(edadRaw) ? Number(edadRaw) : null
        const freqText = clean(rec[COL.frecuenciaHorario])
        const mesTexto = clean(rec[COL.mesInicio])
        const sedeTexto = clean(rec[COL.sede])
        const planCol = clean(rec[COL.plan])
        const membresiaCol = clean(rec[COL.membresia])
        const precio = clean(rec[COL.precio])

        const hasApoderado = Boolean(apoderadoDni || apoderadoCorreo || apoderadoNombre)
        const apoderadoInfo = apoderadoNombre || apoderadoDni || apoderadoCorreo || apoderadoCel
            ? [apoderadoNombre, apoderadoDni, apoderadoCorreo, apoderadoCel].filter(Boolean).join(" / ")
            : ""
        const report: RowReport = {
            rowNumber,
            rowLabel: `fila ${rowNumber}`,
            alumno: alumnoNombre || apoderadoNombre || "(sin nombre)",
            dni: alumnoDni || "-",
            correo: alumnoCorreo || apoderadoCorreo || "",
            celular: alumnoCel || apoderadoCel || "",
            apoderado: apoderadoInfo,
            metodo: metodo || "(vacío)",
            sede: sedeTexto || "-",
            planTexto: [membresiaCol, planCol].filter(Boolean).join(" ") || precio || "-",
            bucket: "REVISION",
            motivo: "",
        }
        const skip = (bucket: Bucket, motivo: string) => {
            report.bucket = bucket
            report.motivo = motivo
            reports.push(report)
        }

        // 1) Excluir Ticketing (ya compró por la web)
        if (up(metodo) === "TICKETING") {
            skip("EXCLUIDO-TICKETING", "método de pago = Ticketing")
            continue
        }

        // 2) Cruce de cuenta: titular = apoderado si existe, si no el alumno
        const titularDni = hasApoderado ? apoderadoDni : alumnoDni
        const titularEmail = hasApoderado ? apoderadoCorreo : alumnoCorreo
        if (!titularDni && !titularEmail) {
            skip("SIN-CUENTA", "sin DNI ni correo del titular para cruzar")
            continue
        }
        const user = offline
            ? { id: "offline", email: titularEmail || `${titularDni || `fila-${rowNumber}`}@offline.test`, name: alumnoNombre || apoderadoNombre }
            : await findUser(titularDni, titularEmail)
        if (!user) {
            skip("SIN-CUENTA", `no existe cuenta web (DNI ${titularDni || "-"} / correo ${titularEmail || "-"})`)
            continue
        }

        // 3) Sede
        const sedeUp = up(sedeTexto)
        const sucursalCode = sedeUp.includes("VIDENA") ? "03" : sedeUp.includes("CDM") || sedeUp.includes("CAMPO") ? "01" : null
        if (!sucursalCode) {
            skip("REVISION", `sede no reconocida ("${sedeTexto}")`)
            continue
        }

        // 4) Plan / tier / duración desde Precio (cruzado con columnas)
        const amount = parseAmount(precio)
        const tierPrecio = detectTier(precio)
        const tierCol = detectTier(membresiaCol)
        const durPrecio = detectDuration(precio)
        const durCol = detectDuration(planCol)
        const tier = tierPrecio ?? tierCol
        const duration = durPrecio ?? durCol
        if (!tier) { skip("REVISION", `no se pudo determinar el tier (precio "${precio}")`); continue }
        if (!duration) { skip("REVISION", `no se pudo determinar semestral/anual (precio "${precio}", plan "${planCol}")`); continue }
        if (tierPrecio && tierCol && tierPrecio !== tierCol) {
            skip("REVISION", `conflicto de tier: columna dice ${tierCol} pero precio dice ${tierPrecio} ("${precio}")`)
            continue
        }

        const is2x = tier === "BRONCE" && detect2x(precio, amount)
        const scheduleKey = tier === "ORO" ? null : tier === "PLATA" ? "PLATA" : is2x ? "BRONCE_2X" : "BRONCE"

        // 5) Resolver tipo de entrada contra lo existente
        const ttRes = offline
            ? { ok: true as const, tt: makeOfflineTicketType(sucursalCode, duration, scheduleKey, tier, is2x) }
            : resolveTicketType(academiaTts, sucursalCode, duration, scheduleKey, tier)
        if (!ttRes.ok) { skip("REVISION", ttRes.error); continue }
        const tt = ttRes.tt

        // 6) Fecha de inicio
        const startRes = parseStartDate(mesTexto)
        if ("error" in startRes) { skip("REVISION", startRes.error); continue }

        // 7) Horario (si el plan lo requiere)
        const category: ScheduleCategoryId = hasApoderado || (edad != null && edad < 18) ? "NINOS" : "ADULTOS"
        let scheduleCategory = ""
        let scheduleFrequency = ""
        let scheduleHoursJson = ""
        let selection: MembershipScheduleSelection | null = null
        const profile = getMembershipScheduleProfile(sucursalCode, tt.membershipScheduleKey)
        if (profile) {
            const sched = resolveScheduleInput(tt.membershipScheduleKey ?? "", freqText)
            if (!sched.ok) { skip("REVISION", sched.error); continue }
            // Validar contra la matriz (misma validación que usa el checkout/escáner)
            const input: MembershipScheduleInput = {
                category,
                frequency: sched.frequency,
                hours: sched.hours,
            }
            const validation = validateMembershipScheduleSelection(profile, input, sucursalCode)
            if (!validation.ok) {
                skip("REVISION", `${validation.error} [cat=${category} freq=${sched.frequency} horas=${JSON.stringify(sched.hours)}]`)
                continue
            }
            scheduleCategory = category
            scheduleFrequency = sched.frequency
            scheduleHoursJson = JSON.stringify(sched.hours)
            selection = validation.selection
        }

        // 8) sourceRef único (DNI alumno preferente)
        const refBase = alumnoDni || titularDni || cleanEmail(user.email) || `fila-${rowNumber}`
        let sourceRef = refBase
        if (seenSourceRefs.has(sourceRef)) sourceRef = `${refBase}-${rowNumber}`
        seenSourceRefs.add(sourceRef)

        ready.push({
            email: user.email,
            eventSlug: tt.eventSlug,
            ticketTypeId: tt.id,
            ticketTypeName: tt.name,
            attendeeName: alumnoNombre || user.name,
            attendeeDni: alumnoDni,
            membershipStartDate: startRes.date,
            sourceRef,
            amountPaid: amount != null ? String(amount) : "0",
            scheduleCategory,
            scheduleFrequency,
            scheduleHoursJson,
        })
        report.bucket = "READY"
        report.motivo = `${tt.eventTitle} / ${tt.name} · inicio ${startRes.date}` +
            (scheduleFrequency ? ` · ${category} ${scheduleFrequency} ${scheduleHoursJson}` : "")
        reports.push(report)

        previews.push({
            rowNumber,
            eventTitle: tt.eventTitle,
            ticketTypeName: tt.name,
            attendeeName: alumnoNombre || user.name,
            attendeeDni: alumnoDni,
            startDate: startRes.date,
            sede: sucursalCode === "03" ? "VIDENA" : "Campo de Marte (CDM)",
            monthlyClassLimit: tt.monthlyClassLimit,
            selection,
        })
    }

    // ── Escribir salidas ──
    const outDir = path.resolve(OUT_DIR)
    await mkdir(outDir, { recursive: true })
    const readyPath = path.join(outDir, OUT_READY)
    const reviewPath = path.join(outDir, OUT_REVIEW)
    const previewPath = path.join(outDir, OUT_PREVIEW)
    const pendientesPath = path.join(outDir, OUT_PENDIENTES)
    await writeFile(readyPath, readyToCsv(ready), "utf8")
    await writeFile(reviewPath, buildReview(reports), "utf8")
    await writeFile(previewPath, buildPreviewHtml(previews, offline), "utf8")
    await writeFile(pendientesPath, buildPendientesCsv(reports), "utf8")

    const counts = reports.reduce<Record<string, number>>((acc, r) => {
        acc[r.bucket] = (acc[r.bucket] ?? 0) + 1
        return acc
    }, {})

    console.log(`Archivo: ${absInput}`)
    console.log(`Filas procesadas: ${reports.length}`)
    console.log(`  READY (a emitir):      ${counts.READY ?? 0}`)
    console.log(`  REVISION:              ${counts.REVISION ?? 0}`)
    console.log(`  SIN-CUENTA:            ${counts["SIN-CUENTA"] ?? 0}`)
    console.log(`  EXCLUIDO-TICKETING:    ${counts["EXCLUIDO-TICKETING"] ?? 0}`)
    console.log("")
    console.log(`CSV listo para emitir:  ${readyPath}`)
    console.log(`Reporte de revisión:    ${reviewPath}`)
    console.log(`Preview de carnets:     ${previewPath}`)
    console.log(`Pendientes (sin cuenta + revisión): ${pendientesPath}`)
    console.log("")
    console.log("Siguiente paso (dry-run):")
    console.log(`  tsx scripts/issue-presential-carnets.ts --file=${OUT_DIR}/${OUT_READY} --batch=membresias-2026 --allow-existing-active`)
}

main()
    .catch((error) => {
        console.error("Error fatal:", error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(async () => {
        if (prisma) await prisma.$disconnect()
        process.exit(process.exitCode ?? 0)
    })
