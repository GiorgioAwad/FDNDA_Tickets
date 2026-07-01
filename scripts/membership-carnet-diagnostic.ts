/**
 * Diagnóstico de carnets de membresía.
 *
 * Reproduce EXACTAMENTE lo que ve cada alumno en su carnet (mi-cuenta/entradas):
 * decide entre QR activo / "aún no inicia" / "congelada" / "QR no disponible"
 * con la misma lógica que /api/tickets/[id] + la página del carnet, y genera el
 * QR real (mismo QR_SECRET) para los que aplican.
 *
 * Uso (desde fdnda-tickets/):
 *   npx tsx --tsconfig tsconfig.json scripts/membership-carnet-diagnostic.ts
 *   npx tsx ... scripts/membership-carnet-diagnostic.ts --event "MEMBRESÍAS VIDENA"
 *   npx tsx ... scripts/membership-carnet-diagnostic.ts --date 2026-08-01   # previsualiza el día de arranque
 *   npx tsx ... scripts/membership-carnet-diagnostic.ts --status ALL --out C:/ruta/reporte.html
 *
 * Lee .env / .env.production para apuntar a la BD y usar el QR_SECRET reales.
 * Es de SOLO LECTURA: no escribe nada en la base de datos.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

// --- cargar .env antes de importar prisma/qr ---
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
    } catch {}
}
process.env.PRISMA_DATABASE_ADAPTER = process.env.PRISMA_DATABASE_ADAPTER || "neon"

// --- args ---
function getArg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}
const eventFilter = getArg("event") ?? ""
const statusFilter = (getArg("status") ?? "ACTIVE").toUpperCase()
const outArg = getArg("out")

const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

type View = {
    code: string
    eventTitle: string
    plan: string
    attendee: string
    state: string
    stateLabel: string
    detail: string
    qr: string | null
    cupo: string
    vigencia: string
}

async function main() {
    const { prisma } = await import("@/lib/prisma")
    const {
        isFixedTermMembership,
        getMembershipAnchor,
        getMembershipPeriod,
        getMembershipAccessStatus,
        getMembershipExpiry,
        getMembershipFreezeRanges,
        buildMembershipMonthlySummary,
    } = await import("@/lib/scan-helpers")
    const { getTodayDateString, formatDateUTC, createQRPayload, generateQRDataURL } = await import("@/lib/qr")
    const { parseDateOnly } = await import("@/lib/utils")

    const today = getArg("date") ?? getTodayDateString()
    if (!process.env.QR_SECRET) {
        console.warn("⚠️  QR_SECRET no está en el entorno: los QR generados NO serán válidos para escanear (pero el estado sí es fiel).")
    }

    const fmt = (d: string) => {
        const [y, m, dd] = d.split("-")
        const meses = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"]
        return `${dd} ${meses[Number(m)]} ${y}`
    }

    const tickets = await prisma.ticket.findMany({
        where: {
            ...(statusFilter !== "ALL" ? { status: statusFilter as "ACTIVE" | "CANCELLED" | "EXPIRED" } : {}),
            ticketType: { monthlyClassLimit: { gt: 0 } },
            ...(eventFilter ? { event: { title: { contains: eventFilter, mode: "insensitive" } } } : {}),
        },
        include: { event: true, ticketType: true, entitlements: true, membershipFreeze: true, monthlySchedules: true },
        orderBy: [{ event: { title: "asc" } }, { attendeeName: "asc" }],
    })

    const views: View[] = []
    const counts: Record<string, number> = {}

    for (const t of tickets) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const st = t as any
        const isMembership = (t.ticketType.monthlyClassLimit ?? 0) > 0
        const isFixed = isFixedTermMembership(st)
        const anchor = getMembershipAnchor(st)
        const period = isMembership && anchor ? getMembershipPeriod(today, anchor) : null
        const access = isFixed ? getMembershipAccessStatus(st, today) : { status: "NOT_APPLICABLE" as const }
        const summary = buildMembershipMonthlySummary(st, today)
        const startShown = isFixed && anchor ? formatDateUTC(anchor) : t.event.startDate ? formatDateUTC(t.event.startDate) : "-"
        const freezes = getMembershipFreezeRanges(st)
        const expiry =
            isFixed && anchor && t.ticketType.membershipDurationMonths
                ? getMembershipExpiry(anchor, t.ticketType.membershipDurationMonths, undefined, freezes)
                : null
        const hasCupo = summary.used < summary.total
        const accessOk = !isFixed || access.status === "OK"

        let state = "QR_ACTIVO"
        let stateLabel = "QR activo"
        let detail = ""
        let qr: string | null = null

        if (t.status !== "ACTIVE") {
            state = "INACTIVO"
            stateLabel = `Ticket ${t.status}`
            detail = "No se muestra QR."
        } else if (isMembership && period == null) {
            state = "NO_INICIA"
            stateLabel = "Aún no inicia"
            detail = `Tu membresía aún no inicia · Válido a partir del <b>${fmt(startShown)}</b>`
        } else if (access.status === "FROZEN") {
            const fr = freezes.find((f) => today >= f.startStr && today < f.endStr)
            state = "CONGELADA"
            stateLabel = "Congelada"
            detail = fr ? `Membresía congelada · del <b>${fmt(fr.startStr)}</b> al <b>${fmt(fr.endStr)}</b>` : "Membresía congelada"
        } else if (access.status === "BLACKOUT") {
            state = "BLACKOUT"
            stateLabel = "Blackout ene/feb"
            detail = "QR no disponible: enero/febrero no aplica (vigencia se extiende)."
        } else if (access.status === "EXPIRED") {
            state = "EXPIRADA"
            stateLabel = "Vencida"
            detail = `QR no disponible: membresía vencida desde ${expiry ? fmt(expiry) : "-"}.`
        } else if (!hasCupo) {
            state = "CUPO_AGOTADO"
            stateLabel = "Cupo agotado"
            detail = `QR no disponible: usó ${summary.used}/${summary.total} clases este mes.`
        } else if (accessOk) {
            state = "QR_ACTIVO"
            stateLabel = "QR activo"
            detail = `Válido para: <b>${fmt(today)}</b> · El código QR se actualiza diariamente`
            const payload = createQRPayload(t.id, t.eventId, t.userId, t.ticketCode, parseDateOnly(today), null)
            qr = await generateQRDataURL(payload)
        } else {
            state = "SIN_QR"
            stateLabel = "Sin QR"
            detail = `Estado de acceso: ${access.status}`
        }

        counts[state] = (counts[state] ?? 0) + 1
        views.push({
            code: t.ticketCode,
            eventTitle: t.event.title,
            plan: t.ticketType.name,
            attendee: t.attendeeName ?? "-",
            state,
            stateLabel,
            detail,
            qr,
            cupo: `${summary.used}/${summary.total} este mes`,
            vigencia: expiry ? `${fmt(startShown)} → ${fmt(expiry)}` : startShown !== "-" ? `desde ${fmt(startShown)}` : "-",
        })
    }

    // --- HTML ---
    const badgeColor: Record<string, string> = {
        QR_ACTIVO: "#16a34a",
        NO_INICIA: "#2563eb",
        CONGELADA: "#0284c7",
        BLACKOUT: "#d97706",
        EXPIRADA: "#dc2626",
        CUPO_AGOTADO: "#b45309",
        INACTIVO: "#6b7280",
        SIN_QR: "#6b7280",
    }
    const cards = views
        .map(
            (v) => `
    <div class="card">
      <div class="hd"><div class="title">${esc(v.eventTitle)}</div><div class="plan">${esc(v.plan)}</div></div>
      <div class="badge" style="background:${badgeColor[v.state] ?? "#6b7280"}">${esc(v.stateLabel)}</div>
      <div class="qrbox">${v.qr ? `<img src="${v.qr}" width="200" height="200" alt="QR"/>` : `<div class="noqr">${v.detail}</div>`}</div>
      ${v.qr ? `<div class="detail">${v.detail}</div>` : ""}
      <div class="who"><b>${esc(v.attendee)}</b><br/><span class="mono">${esc(v.code)}</span></div>
      <div class="meta">Cupo: ${esc(v.cupo)}<br/>Vigencia: ${esc(v.vigencia)}</div>
    </div>`
        )
        .join("\n")

    const summaryRow = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `<span class="chip" style="background:${badgeColor[k] ?? "#6b7280"}">${k}: ${n}</span>`)
        .join(" ")

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<title>Diagnóstico carnets — ${esc(today)}</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#6b7280;margin:0 0 16px}
  .chips{margin-bottom:20px} .chip{display:inline-block;color:#fff;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;margin:2px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
  .card{background:#fff;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.1);padding:14px;display:flex;flex-direction:column;align-items:center;text-align:center}
  .hd{width:100%} .title{font-size:12px;color:#374151;font-weight:600;line-height:1.2} .plan{font-size:11px;color:#6b7280;margin-top:2px}
  .badge{color:#fff;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;margin:8px 0}
  .qrbox{min-height:200px;display:flex;align-items:center;justify-content:center;width:100%}
  .noqr{background:#eff6ff;border-radius:10px;padding:16px;font-size:12px;color:#1e3a8a;line-height:1.4}
  .detail{font-size:12px;color:#374151;margin-top:6px}
  .who{margin-top:8px;font-size:13px} .mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#6b7280}
  .meta{margin-top:8px;font-size:11px;color:#6b7280;line-height:1.4}
</style></head><body>
  <h1>Diagnóstico de carnets de membresía</h1>
  <p class="sub">Día simulado: <b>${esc(today)}</b> · ${views.length} membresía(s) · ${esc(statusFilter)}${eventFilter ? ` · filtro evento: "${esc(eventFilter)}"` : ""}</p>
  <div class="chips">${summaryRow}</div>
  <div class="grid">${cards}</div>
</body></html>`

    const outPath = outArg
        ? resolve(process.cwd(), outArg)
        : resolve(process.cwd(), "..", `carnet-diagnostico-${today}.html`)
    writeFileSync(outPath, html, "utf8")

    console.log(`\nDía simulado: ${today}`)
    console.log(`Membresías: ${views.length}`)
    console.log("Estados:", counts)
    console.log(`\nReporte HTML escrito en:\n  ${outPath}\n(ábrelo en el navegador)`)

    await prisma.$disconnect()
}

main().catch((e) => {
    console.error("ERROR:", e)
    process.exit(1)
})
