/**
 * Cupos por horario de membresias (natacion) por sede.
 *
 * Responde "cuanta gente hay en cada franja" usando el horario EFECTIVO del mes
 * en curso (aplica los cambios mensuales de horario, no solo el de checkout).
 *
 * Hojas:
 *   1. "Cupos por horario"  - catalogo completo (categoria x plan x frecuencia x
 *      dia x hora) con inscritos vigentes y columna vacia para fijar el cupo.
 *   2. "Carga por dia y hora" - matriz dia de semana x franja con el total de
 *      alumnos que entran a la piscina en esa franja (todos los planes).
 *   3. "Cupo por plan" - cupo global del TicketType (vendidos / disponible).
 *
 * SOLO LECTURA: no escribe en la BD.
 *
 * Uso (desde fdnda-tickets/):
 *   npx tsx --tsconfig tsconfig.json scripts/report-cupos-horarios-membresias.ts
 *   npx tsx --tsconfig tsconfig.json scripts/report-cupos-horarios-membresias.ts --sucursal 03
 *   npx tsx --tsconfig tsconfig.json scripts/report-cupos-horarios-membresias.ts --out "../cupos.xlsx"
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { Prisma } from "@prisma/client"

// Cargar .env antes de importar prisma (mismo patron que report-cdm-membresias).
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

function getArg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

const SEDES: Record<string, { code: string; name: string; slug: string }> = {
    "01": { code: "01", name: "Campo de Marte", slug: "campo-de-marte" },
    cdm: { code: "01", name: "Campo de Marte", slug: "campo-de-marte" },
    "campo-de-marte": { code: "01", name: "Campo de Marte", slug: "campo-de-marte" },
    "03": { code: "03", name: "VIDENA", slug: "videna" },
    videna: { code: "03", name: "VIDENA", slug: "videna" },
}

const WEEKDAY_COLS = [1, 2, 3, 4, 5, 6] as const
const WEEKDAY_LABEL: Record<number, string> = {
    0: "Domingo",
    1: "Lunes",
    2: "Martes",
    3: "Miercoles",
    4: "Jueves",
    5: "Viernes",
    6: "Sabado",
}

const PLAN_FAMILY_LABEL: Record<string, string> = {
    BRONCE: "BRONCE (interdiario 3x)",
    BRONCE_2X: "BRONCE (2x semana)",
    PLATA: "PLATA (Lun a Vie)",
}

function durationLabel(months: number | null | undefined): string {
    if (!months) return "Sin duracion fija"
    if (months === 6) return "Semestral"
    if (months === 12) return "Anual"
    return `${months} meses`
}

const ticketSelect = {
    id: true,
    ticketCode: true,
    attendeeName: true,
    membershipStartDate: true,
    membershipSchedule: true,
    status: true,
    event: {
        select: { startDate: true, membershipStartFixed: true, servilexSucursalCode: true },
    },
    ticketType: {
        select: {
            id: true,
            name: true,
            membershipDurationMonths: true,
            membershipScheduleKey: true,
        },
    },
    monthlySchedules: { select: { monthIndex: true, selection: true } },
    membershipFreeze: { select: { month: true, startDate: true, endDate: true } },
} satisfies Prisma.TicketSelect

async function main() {
    const XLSX = await import("xlsx")
    const { prisma } = await import("@/lib/prisma")
    const {
        formatTime12h,
        getEffectiveMembershipSchedule,
        getMembershipScheduleProfile,
        parseMembershipScheduleSelection,
        MEMBERSHIP_SCHEDULE_KEYS,
    } = await import("@/lib/membership-schedule")
    const { getMembershipExpiry, getMembershipFreezeRanges, getMembershipPeriod } = await import("@/lib/scan-helpers")
    const { getTodayDateString } = await import("@/lib/qr")

    const sede = SEDES[(getArg("sucursal") ?? getArg("sede") ?? "01").toLowerCase()] ?? SEDES["01"]
    const today = getTodayDateString()

    const membershipFilter = {
        OR: [
            { monthlyClassLimit: { gt: 0 } },
            { membershipDurationMonths: { gt: 0 } },
            { name: { contains: "MEMBRES", mode: "insensitive" as const } },
        ],
    }

    const ticketTypes = await prisma.ticketType.findMany({
        where: { event: { category: "ACADEMIA", servilexSucursalCode: sede.code }, ...membershipFilter },
        select: {
            id: true,
            name: true,
            price: true,
            capacity: true,
            sold: true,
            isActive: true,
            monthlyClassLimit: true,
            membershipDurationMonths: true,
            membershipScheduleKey: true,
            event: { select: { title: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    })

    const tickets = await prisma.ticket.findMany({
        where: {
            status: "ACTIVE",
            order: { status: "PAID" },
            event: { category: "ACADEMIA", servilexSucursalCode: sede.code },
            ticketType: membershipFilter,
        },
        select: ticketSelect,
    })

    // ── Conteo de inscritos por franja (horario efectivo del mes en curso) ──────
    // slotKey = plan familia | categoria | frecuencia | grupo dias | hora
    const bySlot = new Map<string, { vigentes: number; porDuracion: Map<string, number> }>()
    // Carga real de piscina: dia de semana + hora -> alumnos.
    const byDayHour = new Map<string, number>()
    // Vigentes cuyo plan exige horario semanal pero no tienen seleccion guardada.
    const sinHorarioRows: { Plan: string; Asistente: string; Codigo: string; Motivo: string }[] = []
    let sinHorario = 0
    let vencidos = 0

    const bump = (key: string, duracion: string) => {
        const entry = bySlot.get(key) ?? { vigentes: 0, porDuracion: new Map<string, number>() }
        entry.vigentes += 1
        entry.porDuracion.set(duracion, (entry.porDuracion.get(duracion) ?? 0) + 1)
        bySlot.set(key, entry)
    }

    for (const ticket of tickets) {
        const anchor = ticket.membershipStartDate ?? ticket.event.membershipStartFixed ?? ticket.event.startDate
        const duration = ticket.ticketType.membershipDurationMonths ?? 0
        const freezes = getMembershipFreezeRanges(ticket)
        if (anchor && duration > 0) {
            const expiry = getMembershipExpiry(anchor, duration, undefined, freezes)
            if (expiry <= today) {
                vencidos += 1
                continue
            }
        }

        const monthIndex = anchor ? getMembershipPeriod(today, anchor)?.index ?? 0 : 0
        const selection = getEffectiveMembershipSchedule(
            parseMembershipScheduleSelection(ticket.membershipSchedule),
            ticket.monthlySchedules.map((m) => ({
                monthIndex: m.monthIndex,
                selection: parseMembershipScheduleSelection(m.selection),
            })),
            monthIndex
        )

        if (!selection) {
            sinHorario += 1
            sinHorarioRows.push({
                Plan: ticket.ticketType.name.trim(),
                Asistente: ticket.attendeeName?.trim() || "-",
                Codigo: ticket.ticketCode.replace(/-/g, "").slice(-8).toUpperCase(),
                Motivo: ticket.ticketType.membershipScheduleKey
                    ? "Plan con horario semanal pero SIN seleccion guardada: regularizar"
                    : "Plan sin horario semanal (acceso libre)",
            })
            continue
        }

        const family = ticket.ticketType.membershipScheduleKey || selection.profileKey || "SIN_CLAVE"
        const duracion = durationLabel(ticket.ticketType.membershipDurationMonths)

        for (const group of selection.groups) {
            const key = [
                family,
                selection.category,
                selection.frequency,
                group.label,
                `${group.start}-${group.end}`,
            ].join("||")
            bump(key, duracion)
        }
        for (const session of selection.sessions) {
            const k = `${session.weekday}||${session.start}-${session.end}`
            byDayHour.set(k, (byDayHour.get(k) ?? 0) + 1)
        }
    }

    // ── Hoja 1: catalogo de horarios + inscritos ────────────────────────────────
    type SlotRow = {
        Sede: string
        Categoria: string
        Plan: string
        Frecuencia: string
        Dias: string
        Horario: string
        "Inscritos vigentes": number
        Semestral: number
        Anual: number
        "Cupo por horario": string
        Disponible: string
    }

    const slotRows: SlotRow[] = []
    for (const key of MEMBERSHIP_SCHEDULE_KEYS) {
        const profile = getMembershipScheduleProfile(sede.code, key)
        if (!profile) continue
        for (const category of profile.categories) {
            for (const frequency of category.frequencies) {
                for (const group of frequency.dayGroups) {
                    for (const hour of group.hours) {
                        const entry = bySlot.get(
                            [key, category.id, frequency.id, group.label, `${hour.start}-${hour.end}`].join("||")
                        )
                        slotRows.push({
                            Sede: sede.name,
                            Categoria: category.label,
                            Plan: PLAN_FAMILY_LABEL[key] ?? key,
                            Frecuencia: frequency.label,
                            Dias: group.label,
                            Horario: `${formatTime12h(hour.start)} - ${formatTime12h(hour.end)}`,
                            "Inscritos vigentes": entry?.vigentes ?? 0,
                            Semestral: entry?.porDuracion.get("Semestral") ?? 0,
                            Anual: entry?.porDuracion.get("Anual") ?? 0,
                            "Cupo por horario": "",
                            Disponible: "",
                        })
                    }
                }
            }
        }
    }

    // ── Hoja 2: matriz dia x hora (carga real de piscina) ───────────────────────
    const allHours = new Set<string>()
    for (const key of MEMBERSHIP_SCHEDULE_KEYS) {
        const profile = getMembershipScheduleProfile(sede.code, key)
        if (!profile) continue
        for (const category of profile.categories) {
            for (const frequency of category.frequencies) {
                for (const group of frequency.dayGroups) {
                    for (const hour of group.hours) allHours.add(`${hour.start}-${hour.end}`)
                }
            }
        }
    }

    type MatrixRow = Record<string, string | number>
    const matrixRows: MatrixRow[] = [...allHours]
        .sort()
        .map((slot) => {
            const [start, end] = slot.split("-")
            const row: MatrixRow = { Horario: `${formatTime12h(start)} - ${formatTime12h(end)}` }
            let total = 0
            for (const weekday of WEEKDAY_COLS) {
                const count = byDayHour.get(`${weekday}||${slot}`) ?? 0
                row[WEEKDAY_LABEL[weekday]] = count
                total += count
            }
            row["Total semana"] = total
            return row
        })

    const matrixTotals: MatrixRow = { Horario: "TOTAL" }
    let grandTotal = 0
    for (const weekday of WEEKDAY_COLS) {
        const sum = matrixRows.reduce((acc, r) => acc + Number(r[WEEKDAY_LABEL[weekday]] ?? 0), 0)
        matrixTotals[WEEKDAY_LABEL[weekday]] = sum
        grandTotal += sum
    }
    matrixTotals["Total semana"] = grandTotal
    matrixRows.push(matrixTotals)

    // ── Hoja 3: cupo global por plan ────────────────────────────────────────────
    const planRows = ticketTypes.map((tt) => ({
        Sede: sede.name,
        Evento: tt.event.title,
        Plan: tt.name,
        Duracion: durationLabel(tt.membershipDurationMonths),
        Frecuencia: PLAN_FAMILY_LABEL[tt.membershipScheduleKey ?? ""] ?? "Sin horario semanal (acceso libre)",
        "Cupo global del plan": tt.capacity > 0 ? tt.capacity : "Ilimitado",
        Vendidos: tt.sold,
        "Disponible": tt.capacity > 0 ? Math.max(tt.capacity - tt.sold, 0) : "Ilimitado",
        "Clases por mes": tt.monthlyClassLimit ?? "",
        "Precio S/": Number(tt.price),
        Activo: tt.isActive ? "SI" : "NO",
    }))

    // ── Escritura ───────────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()

    const wsSlots = XLSX.utils.json_to_sheet(slotRows)
    wsSlots["!cols"] = [
        { wch: 16 },
        { wch: 20 },
        { wch: 24 },
        { wch: 28 },
        { wch: 26 },
        { wch: 24 },
        { wch: 18 },
        { wch: 11 },
        { wch: 9 },
        { wch: 18 },
        { wch: 12 },
    ]
    if (wsSlots["!ref"]) wsSlots["!autofilter"] = { ref: wsSlots["!ref"] }
    XLSX.utils.book_append_sheet(wb, wsSlots, "Cupos por horario")

    const matrixHeader = ["Horario", ...WEEKDAY_COLS.map((w) => WEEKDAY_LABEL[w]), "Total semana"]
    const wsMatrix = XLSX.utils.json_to_sheet(matrixRows, { header: matrixHeader })
    wsMatrix["!cols"] = [{ wch: 24 }, ...WEEKDAY_COLS.map(() => ({ wch: 12 })), { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, wsMatrix, "Carga por dia y hora")

    const wsPlans = XLSX.utils.json_to_sheet(planRows)
    wsPlans["!cols"] = [
        { wch: 16 },
        { wch: 38 },
        { wch: 42 },
        { wch: 14 },
        { wch: 26 },
        { wch: 20 },
        { wch: 10 },
        { wch: 12 },
        { wch: 14 },
        { wch: 11 },
        { wch: 8 },
    ]
    if (wsPlans["!ref"]) wsPlans["!autofilter"] = { ref: wsPlans["!ref"] }
    XLSX.utils.book_append_sheet(wb, wsPlans, "Cupo por plan")

    sinHorarioRows.sort((a, b) => a.Motivo.localeCompare(b.Motivo, "es") || a.Plan.localeCompare(b.Plan, "es"))
    const wsSinHorario = XLSX.utils.json_to_sheet(
        sinHorarioRows.length > 0 ? sinHorarioRows : [{ Plan: "", Asistente: "Ninguno", Codigo: "", Motivo: "" }]
    )
    wsSinHorario["!cols"] = [{ wch: 42 }, { wch: 36 }, { wch: 12 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, wsSinHorario, "Sin horario")

    const pendientes = sinHorarioRows.filter((r) => r.Motivo.startsWith("Plan con horario")).length

    const notes = [
        ["Reporte", `Cupos por horario de membresias - ${sede.name} (sucursal ${sede.code})`],
        ["Generado", `${today} (hora Lima)`],
        ["Fuente", "Tickets ACTIVE con orden PAGADA, horario efectivo del mes en curso"],
        ["Membresias vigentes contadas", String(tickets.length - vencidos - sinHorario)],
        ["Membresias vencidas (excluidas)", String(vencidos)],
        ["Vigentes sin horario semanal (ver hoja 'Sin horario')", String(sinHorario)],
        ["  de esos, pendientes de regularizar", String(pendientes)],
        [],
        [
            "IMPORTANTE",
            "El sistema NO tiene cupo configurado por franja horaria: el cupo es global por plan (hoja 'Cupo por plan').",
        ],
        [
            "",
            "La columna 'Cupo por horario' esta vacia a proposito para que se defina el aforo por franja; 'Inscritos vigentes' es la ocupacion real de hoy.",
        ],
        [
            "Nota",
            "En BRONCE M-J-S el alumno elige una hora para Mar/Jue y otra para Sabado: aparece en dos filas (dos franjas distintas).",
        ],
    ]
    const wsNotes = XLSX.utils.aoa_to_sheet(notes)
    wsNotes["!cols"] = [{ wch: 46 }, { wch: 110 }]
    XLSX.utils.book_append_sheet(wb, wsNotes, "Leyenda")

    const outArg = getArg("out")
    const outXlsx = outArg
        ? resolve(process.cwd(), outArg)
        : resolve(process.cwd(), "..", `cupos-horarios-membresias-${sede.slug}-${today}.xlsx`)
    XLSX.writeFile(wb, outXlsx)

    console.log(`Sede: ${sede.name} (${sede.code}) - hoy ${today}`)
    console.log(`Tickets ACTIVE + PAID: ${tickets.length}`)
    console.log(`  vencidos (excluidos): ${vencidos}`)
    console.log(`  vigentes sin horario semanal: ${sinHorario}`)
    console.log(`  vigentes con horario: ${tickets.length - vencidos - sinHorario}`)
    console.log(`Franjas del catalogo: ${slotRows.length} (con inscritos: ${slotRows.filter((r) => r["Inscritos vigentes"] > 0).length})`)
    console.log(`Excel: ${outXlsx}`)

    await prisma.$disconnect()
}

main().catch((error) => {
    console.error("ERROR:", error)
    process.exit(1)
})
