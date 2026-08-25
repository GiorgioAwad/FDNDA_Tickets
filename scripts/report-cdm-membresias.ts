/**
 * Reporte de membresias por sede.
 *
 * Hoja 1: resumen por plan / frecuencia / horario con cupo del plan y ocupacion
 * del horario segun tickets ACTIVE de orden PAID.
 * Hoja 2: detalle por carnet/ticket.
 *
 * SOLO LECTURA: no escribe en la BD.
 *
 * Uso (desde fdnda-tickets/):
 *   npx tsx --tsconfig tsconfig.json scripts/report-cdm-membresias.ts
 *   npx tsx --tsconfig tsconfig.json scripts/report-cdm-membresias.ts --out "../membresias-campo-de-marte.xlsx"
 *   npx tsx --tsconfig tsconfig.json scripts/report-cdm-membresias.ts --sucursal 03
 *   npx tsx --tsconfig tsconfig.json scripts/report-cdm-membresias.ts --status ALL
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { Prisma, TicketStatus } from "@prisma/client"

// Cargar .env antes de importar prisma.
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

const DASH = "-"

const SEDES: Record<string, { code: string; name: string; slug: string }> = {
    "01": { code: "01", name: "Campo de Marte", slug: "campo-de-marte" },
    cdm: { code: "01", name: "Campo de Marte", slug: "campo-de-marte" },
    "campo-de-marte": { code: "01", name: "Campo de Marte", slug: "campo-de-marte" },
    "03": { code: "03", name: "VIDENA", slug: "videna" },
    videna: { code: "03", name: "VIDENA", slug: "videna" },
}

const STATUS_VALUES = new Set(["ACTIVE", "CANCELLED", "EXPIRED"])
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_LABEL: Record<number, string> = {
    0: "Domingo",
    1: "Lunes",
    2: "Martes",
    3: "Miercoles",
    4: "Jueves",
    5: "Viernes",
    6: "Sabado",
}

function dateKey(date: Date | null | undefined): string {
    return date ? date.toISOString().slice(0, 10) : ""
}

function monthLabel(d: Date | null | undefined): string {
    if (!d) return DASH
    return new Intl.DateTimeFormat("es-PE", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    }).format(d)
}

function money(n: Prisma.Decimal | number | null | undefined): number | "" {
    if (n == null) return ""
    return Number(n)
}

function durationLabel(months: number | null | undefined): string {
    if (!months) return DASH
    if (months === 6) return "Semestral"
    if (months === 12) return "Anual"
    return `${months} meses`
}

function compactCode(code: string): string {
    return code.replace(/-/g, "").slice(-8).toUpperCase()
}

function capacityLabel(capacity: number): string {
    return capacity > 0 ? String(capacity) : "Ilimitado"
}

function availableLabel(capacity: number, sold: number): string {
    return capacity > 0 ? String(Math.max(capacity - sold, 0)) : "Ilimitado"
}

function percent(value: number, total: number): number | "" {
    if (total <= 0) return ""
    return Math.round((value / total) * 10000) / 100
}

function weekdaysLabel(weekdays: number[]): string {
    const set = new Set(weekdays)
    return WEEKDAY_ORDER.filter((w) => set.has(w)).map((w) => WEEKDAY_LABEL[w]).join(", ")
}

function slotSortKey(value: string): string {
    const match = /^(\d{2}):(\d{2})/.exec(value)
    return match ? `${match[1]}${match[2]}_${value}` : `zz_${value}`
}

function normalizeText(value: string | null | undefined): string {
    return (value ?? "").trim()
}

function resolveSedeConfig(value: string | undefined): { code: string; name: string; slug: string } {
    const key = normalizeText(value).toLowerCase()
    return SEDES[key] ?? SEDES["01"]
}

function planSortKey(plan: string): string {
    const p = plan.toUpperCase()
    const tier = p.includes("BRONCE") ? "1" : p.includes("PLATA") ? "2" : p.includes("ORO") ? "3" : "9"
    const duration = p.includes("SEMESTRAL") ? "1" : p.includes("ANUAL") ? "2" : "9"
    return `${tier}_${duration}_${p}`
}

type DetailRow = {
    Sede: string
    Evento: string
    Plan: string
    Duracion: string
    "Cupo mensual": number | ""
    Categoria: string
    Frecuencia: string
    "Horario completo": string
    "Mes de inicio": string
    "Inicio membresia": string
    "Fin estimado": string
    "Estado ticket": string
    Asistente: string
    DNI: string
    Comprador: string
    "Doc comprador": string
    Correo: string
    Telefono: string
    "Orden ID": string
    "Orden estado": string
    "Fecha pago": string
    "Fecha compra": string
    Codigo: string
    "Ticket ID": string
}

type SummaryRow = {
    Sede: string
    Evento: string
    Plan: string
    Duracion: string
    Categoria: string
    Frecuencia: string
    "Dias / grupo": string
    Horario: string
    "Cupo plan": string
    "Vendidos plan": number
    "Disponible plan": string
    "Tickets activos pagados plan": number
    "Ocupados en este horario": number
    "% ocupacion horario vs cupo plan": number | ""
    "Cupo mensual": number | ""
    "Precio S/": number | ""
    "Tipo activo": string
    Nota: string
}

type TicketTypeRecord = Prisma.TicketTypeGetPayload<{ select: typeof ticketTypeSelect }>

const ticketTypeSelect = {
    id: true,
    name: true,
    price: true,
    capacity: true,
    sold: true,
    isActive: true,
    sortOrder: true,
    monthlyClassLimit: true,
    membershipDurationMonths: true,
    membershipScheduleKey: true,
    allowMultipleDailyScans: true,
    event: {
        select: {
            id: true,
            title: true,
            slug: true,
            venue: true,
            location: true,
            startDate: true,
            endDate: true,
            membershipStartFixed: true,
            servilexSucursalCode: true,
        },
    },
} satisfies Prisma.TicketTypeSelect

const ticketSelect = {
    id: true,
    ticketCode: true,
    attendeeName: true,
    attendeeDni: true,
    membershipStartDate: true,
    membershipSchedule: true,
    status: true,
    createdAt: true,
    event: {
        select: {
            id: true,
            title: true,
            slug: true,
            startDate: true,
            membershipStartFixed: true,
            servilexSucursalCode: true,
        },
    },
    ticketType: {
        select: {
            id: true,
            name: true,
            price: true,
            capacity: true,
            sold: true,
            monthlyClassLimit: true,
            membershipDurationMonths: true,
            membershipScheduleKey: true,
            allowMultipleDailyScans: true,
        },
    },
    order: {
        select: {
            id: true,
            status: true,
            paidAt: true,
            createdAt: true,
            buyerName: true,
            buyerDocNumber: true,
            buyerEmail: true,
            buyerPhone: true,
            user: {
                select: {
                    name: true,
                    email: true,
                    phone: true,
                    dni: true,
                },
            },
        },
    },
    membershipFreeze: {
        select: {
            month: true,
            startDate: true,
            endDate: true,
        },
    },
} satisfies Prisma.TicketSelect

async function main() {
    const XLSX = await import("xlsx")
    const { prisma } = await import("@/lib/prisma")
    const {
        formatTime12h,
        getMembershipScheduleProfile,
        parseMembershipScheduleSelection,
    } = await import("@/lib/membership-schedule")
    const { getMembershipExpiry, getMembershipFreezeRanges } = await import("@/lib/scan-helpers")

    const outArg = getArg("out")
    const sede = resolveSedeConfig(getArg("sucursal") ?? getArg("sede"))
    const statusArg = (getArg("status") ?? "ACTIVE").toUpperCase()
    const ticketStatusFilter: Prisma.TicketWhereInput =
        statusArg !== "ALL" && STATUS_VALUES.has(statusArg) ? { status: statusArg as TicketStatus } : {}

    const ticketTypes = await prisma.ticketType.findMany({
        where: {
            event: {
                category: "ACADEMIA",
                servilexSucursalCode: sede.code,
            },
            OR: [
                { monthlyClassLimit: { gt: 0 } },
                { membershipDurationMonths: { gt: 0 } },
                { name: { contains: "MEMBRES", mode: "insensitive" } },
            ],
        },
        select: ticketTypeSelect,
        orderBy: [{ event: { startDate: "desc" } }, { sortOrder: "asc" }, { name: "asc" }],
    })

    if (ticketTypes.length === 0) {
        console.error(`No se encontraron tipos de membresia para ${sede.name} (sucursal ${sede.code}).`)
        process.exit(1)
    }

    const tickets = await prisma.ticket.findMany({
        where: {
            order: { status: "PAID" },
            event: {
                category: "ACADEMIA",
                servilexSucursalCode: sede.code,
            },
            ticketType: {
                OR: [
                    { monthlyClassLimit: { gt: 0 } },
                    { membershipDurationMonths: { gt: 0 } },
                    { name: { contains: "MEMBRES", mode: "insensitive" } },
                ],
            },
            ...ticketStatusFilter,
        },
        select: ticketSelect,
        orderBy: [{ ticketType: { name: "asc" } }, { attendeeName: "asc" }, { createdAt: "asc" }],
    })

    const activePaidByType = new Map<string, number>()
    const occupiedBySlot = new Map<string, number>()

    const slotKey = (
        ticketTypeId: string,
        category: string,
        frequency: string,
        groupLabel: string,
        start: string,
        end: string
    ) => [ticketTypeId, category, frequency, groupLabel, `${start}-${end}`].join("||")

    for (const ticket of tickets) {
        if (ticket.status === "ACTIVE") {
            activePaidByType.set(ticket.ticketType.id, (activePaidByType.get(ticket.ticketType.id) ?? 0) + 1)
        }
        const selection = parseMembershipScheduleSelection(ticket.membershipSchedule)
        if (!selection) {
            const key = slotKey(ticket.ticketType.id, "Sin horario fijo", "Acceso libre", "Sin horario fijo", "", "")
            occupiedBySlot.set(key, (occupiedBySlot.get(key) ?? 0) + 1)
            continue
        }

        for (const group of selection.groups) {
            const key = slotKey(
                ticket.ticketType.id,
                selection.categoryLabel || selection.category,
                selection.frequencyLabel || selection.frequency,
                group.label || weekdaysLabel(group.weekdays),
                group.start,
                group.end
            )
            occupiedBySlot.set(key, (occupiedBySlot.get(key) ?? 0) + 1)
        }
    }

    const summaryRows: SummaryRow[] = []
    const addSummaryRow = (
        tt: TicketTypeRecord,
        row: Omit<
            SummaryRow,
            | "Sede"
            | "Evento"
            | "Plan"
            | "Duracion"
            | "Cupo plan"
            | "Vendidos plan"
            | "Disponible plan"
            | "Tickets activos pagados plan"
            | "Cupo mensual"
            | "Precio S/"
            | "Tipo activo"
            | "Nota"
        > & { Nota?: string }
    ) => {
        summaryRows.push({
            Sede: sede.name,
            Evento: tt.event.title,
            Plan: normalizeText(tt.name),
            Duracion: durationLabel(tt.membershipDurationMonths),
            "Cupo plan": capacityLabel(tt.capacity),
            "Vendidos plan": tt.sold,
            "Disponible plan": availableLabel(tt.capacity, tt.sold),
            "Tickets activos pagados plan": activePaidByType.get(tt.id) ?? 0,
            "Cupo mensual": tt.monthlyClassLimit ?? "",
            "Precio S/": money(tt.price),
            "Tipo activo": tt.isActive ? "SI" : "NO",
            ...row,
            Nota:
                row.Nota ??
                (tt.capacity > 0
                    ? "El cupo es del plan/tipo de membresia; la ocupacion se calcula por horario elegido."
                    : "Plan sin cupo global configurado; la ocupacion se calcula por horario elegido."),
        })
    }

    for (const tt of ticketTypes) {
        const profile = getMembershipScheduleProfile(tt.event.servilexSucursalCode, tt.membershipScheduleKey)
        if (!profile) {
            const key = slotKey(tt.id, "Sin horario fijo", "Acceso libre", "Sin horario fijo", "", "")
            const occupied = occupiedBySlot.get(key) ?? 0
            addSummaryRow(tt, {
                Categoria: "Sin horario fijo",
                Frecuencia: tt.allowMultipleDailyScans ? "Acceso diario / multiple ingreso" : "Acceso libre",
                "Dias / grupo": "Sin horario fijo",
                Horario: "Sin horario fijo",
                "Ocupados en este horario": occupied,
                "% ocupacion horario vs cupo plan": percent(occupied, tt.capacity),
            })
            continue
        }

        for (const category of profile.categories) {
            for (const frequency of category.frequencies) {
                for (const group of frequency.dayGroups) {
                    for (const hour of group.hours) {
                        const key = slotKey(tt.id, category.label, frequency.label, group.label, hour.start, hour.end)
                        const occupied = occupiedBySlot.get(key) ?? 0
                        addSummaryRow(tt, {
                            Categoria: category.label,
                            Frecuencia: frequency.label,
                            "Dias / grupo": group.label || weekdaysLabel(group.weekdays),
                            Horario: `${formatTime12h(hour.start)} - ${formatTime12h(hour.end)}`,
                            "Ocupados en este horario": occupied,
                            "% ocupacion horario vs cupo plan": percent(occupied, tt.capacity),
                        })
                    }
                }
            }
        }

        const withoutScheduleKey = slotKey(
            tt.id,
            "Sin horario fijo",
            "Acceso libre",
            "Sin horario fijo",
            "",
            ""
        )
        const withoutSchedule = occupiedBySlot.get(withoutScheduleKey) ?? 0
        if (withoutSchedule > 0) {
            addSummaryRow(tt, {
                Categoria: "Sin seleccion registrada",
                Frecuencia: "Pendiente de regularizar",
                "Dias / grupo": DASH,
                Horario: DASH,
                "Ocupados en este horario": withoutSchedule,
                "% ocupacion horario vs cupo plan": percent(withoutSchedule, tt.capacity),
                Nota:
                    "Membresias activas y pagadas sin horario semanal guardado; deben regularizarse para asignarlas a una franja.",
            })
        }
    }

    summaryRows.sort(
        (a, b) =>
            a.Evento.localeCompare(b.Evento, "es") ||
            planSortKey(a.Plan).localeCompare(planSortKey(b.Plan), "es") ||
            a.Categoria.localeCompare(b.Categoria, "es") ||
            a.Frecuencia.localeCompare(b.Frecuencia, "es") ||
            a["Dias / grupo"].localeCompare(b["Dias / grupo"], "es") ||
            slotSortKey(a.Horario).localeCompare(slotSortKey(b.Horario))
    )

    const detailRows: DetailRow[] = tickets.map((ticket) => {
        const selection = parseMembershipScheduleSelection(ticket.membershipSchedule)
        const scheduleProfile = getMembershipScheduleProfile(
            ticket.event.servilexSucursalCode,
            ticket.ticketType.membershipScheduleKey
        )
        const startDate = ticket.membershipStartDate ?? ticket.event.membershipStartFixed ?? ticket.event.startDate
        const durationMonths = ticket.ticketType.membershipDurationMonths ?? 0
        const freezeRanges = getMembershipFreezeRanges(ticket)
        const expiry =
            startDate && durationMonths > 0 ? getMembershipExpiry(startDate, durationMonths, undefined, freezeRanges) : ""
        const scheduleText = selection
            ? selection.groups
                  .map((g) => `${g.label}: ${formatTime12h(g.start)} - ${formatTime12h(g.end)}`)
                  .join(" | ")
            : scheduleProfile
              ? "Sin seleccion registrada"
              : "Sin horario fijo"
        const order = ticket.order

        return {
            Sede: sede.name,
            Evento: ticket.event.title,
            Plan: normalizeText(ticket.ticketType.name),
            Duracion: durationLabel(ticket.ticketType.membershipDurationMonths),
            "Cupo mensual": ticket.ticketType.monthlyClassLimit ?? "",
            Categoria: selection?.categoryLabel || (scheduleProfile ? "Sin seleccion registrada" : "Sin horario fijo"),
            Frecuencia:
                selection?.frequencyLabel ||
                (scheduleProfile
                    ? "Pendiente de regularizar"
                    : ticket.ticketType.allowMultipleDailyScans
                      ? "Acceso diario / multiple ingreso"
                      : "Acceso libre"),
            "Horario completo": scheduleText,
            "Mes de inicio": monthLabel(startDate),
            "Inicio membresia": dateKey(startDate),
            "Fin estimado": expiry,
            "Estado ticket": ticket.status,
            Asistente: normalizeText(ticket.attendeeName) || order.user.name || DASH,
            DNI: normalizeText(ticket.attendeeDni) || normalizeText(order.buyerDocNumber) || order.user.dni || DASH,
            Comprador: normalizeText(order.buyerName) || order.user.name || DASH,
            "Doc comprador": normalizeText(order.buyerDocNumber) || order.user.dni || DASH,
            Correo: normalizeText(order.buyerEmail) || order.user.email || DASH,
            Telefono: normalizeText(order.buyerPhone) || order.user.phone || DASH,
            "Orden ID": order.id,
            "Orden estado": order.status,
            "Fecha pago": order.paidAt?.toISOString() ?? "",
            "Fecha compra": order.createdAt.toISOString(),
            Codigo: compactCode(ticket.ticketCode),
            "Ticket ID": ticket.id,
        }
    })

    detailRows.sort(
        (a, b) =>
            a.Evento.localeCompare(b.Evento, "es") ||
            planSortKey(a.Plan).localeCompare(planSortKey(b.Plan), "es") ||
            a.Categoria.localeCompare(b.Categoria, "es") ||
            a.Frecuencia.localeCompare(b.Frecuencia, "es") ||
            a.Asistente.localeCompare(b.Asistente, "es")
    )

    const resumenHeader = [
        "Sede",
        "Evento",
        "Plan",
        "Duracion",
        "Categoria",
        "Frecuencia",
        "Dias / grupo",
        "Horario",
        "Cupo plan",
        "Vendidos plan",
        "Disponible plan",
        "Tickets activos pagados plan",
        "Ocupados en este horario",
        "% ocupacion horario vs cupo plan",
        "Cupo mensual",
        "Precio S/",
        "Tipo activo",
        "Nota",
    ]
    const detalleHeader = [
        "Sede",
        "Evento",
        "Plan",
        "Duracion",
        "Cupo mensual",
        "Categoria",
        "Frecuencia",
        "Horario completo",
        "Mes de inicio",
        "Inicio membresia",
        "Fin estimado",
        "Estado ticket",
        "Asistente",
        "DNI",
        "Comprador",
        "Doc comprador",
        "Correo",
        "Telefono",
        "Orden ID",
        "Orden estado",
        "Fecha pago",
        "Fecha compra",
        "Codigo",
        "Ticket ID",
    ]

    const wsResumen = XLSX.utils.json_to_sheet(summaryRows, { header: resumenHeader })
    wsResumen["!cols"] = [
        { wch: 18 },
        { wch: 38 },
        { wch: 34 },
        { wch: 12 },
        { wch: 18 },
        { wch: 30 },
        { wch: 24 },
        { wch: 18 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 18 },
        { wch: 18 },
        { wch: 16 },
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
        { wch: 70 },
    ]
    if (wsResumen["!ref"]) wsResumen["!autofilter"] = { ref: wsResumen["!ref"] }

    const wsDetalle = XLSX.utils.json_to_sheet(detailRows, { header: detalleHeader })
    wsDetalle["!cols"] = [
        { wch: 18 },
        { wch: 38 },
        { wch: 34 },
        { wch: 12 },
        { wch: 12 },
        { wch: 18 },
        { wch: 30 },
        { wch: 52 },
        { wch: 16 },
        { wch: 14 },
        { wch: 14 },
        { wch: 12 },
        { wch: 32 },
        { wch: 12 },
        { wch: 32 },
        { wch: 14 },
        { wch: 32 },
        { wch: 14 },
        { wch: 26 },
        { wch: 12 },
        { wch: 22 },
        { wch: 22 },
        { wch: 12 },
        { wch: 28 },
    ]
    if (wsDetalle["!ref"]) wsDetalle["!autofilter"] = { ref: wsDetalle["!ref"] }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen horarios")
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle")

    const today = new Date().toISOString().slice(0, 10)
    const outXlsx = outArg ? resolve(process.cwd(), outArg) : resolve(process.cwd(), "..", `membresias-${sede.slug}-${today}.xlsx`)
    XLSX.writeFile(wb, outXlsx)

    const byPlan = new Map<string, number>()
    for (const row of detailRows) byPlan.set(row.Plan, (byPlan.get(row.Plan) ?? 0) + 1)

    console.log(`Reporte de membresias ${sede.name}`)
    console.log(`Tipos de membresia: ${ticketTypes.length}`)
    console.log(`Tickets ${statusArg} + orden PAID: ${detailRows.length}`)
    console.log("Por plan:")
    for (const [plan, count] of [...byPlan.entries()].sort((a, b) => planSortKey(a[0]).localeCompare(planSortKey(b[0])))) {
        console.log(`  - ${plan}: ${count}`)
    }
    console.log(`Excel: ${outXlsx}`)

    await prisma.$disconnect()
}

main().catch((error) => {
    console.error("ERROR:", error)
    process.exit(1)
})
