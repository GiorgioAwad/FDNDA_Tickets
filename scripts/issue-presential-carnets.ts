/**
 * Emite carnets/entradas de membresia para inscritos presenciales que ya tienen
 * usuario web. Por defecto es DRY-RUN: valida la relacion y muestra el plan.
 *
 * Uso:
 *   tsx scripts/issue-presential-carnets.ts --file=presenciales.csv --batch=videna-ago-2026 --event-slug=membresias-videna-2026 --ticket-type-name="MEMBRESIA SEMESTRAL BRONCE"
 *   tsx scripts/issue-presential-carnets.ts --file=presenciales.csv --batch=videna-ago-2026 --event-slug=membresias-videna-2026 --ticket-type-name="MEMBRESIA SEMESTRAL BRONCE" --confirm
 *
 * Columnas soportadas (CSV/JSON):
 *   email                  requerido; el usuario debe existir en la web
 *   attendeeName/name      opcional; default user.name
 *   attendeeDni/dni        opcional
 *   membershipStartDate    YYYY-MM-DD; requerido si el evento no tiene inicio fijo
 *   sourceRef/ref          referencia estable para idempotencia; default DNI/email/fila
 *   amountPaid/amount      opcional; default 0
 *   eventSlug/eventId      opcional si se pasan flags globales
 *   ticketTypeName/ticketTypeId opcional si se pasan flags globales
 *   membershipSchedule     JSON normalizado o input de horario
 *   scheduleCategory       ADULTOS/NINOS, si aplica horario
 *   scheduleFrequency      LMV/MJS/LV, si aplica horario
 *   scheduleHoursJson      JSON, ej. {"main":"09:00-10:00"}
 */
import { Prisma } from "@prisma/client"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { getMembershipScheduleProfile, parseMembershipScheduleSelection, validateMembershipScheduleSelection } from "@/lib/membership-schedule"
import { isBlackoutMonth } from "@/lib/membership-config"
import { formatDateUTC } from "@/lib/qr"
import { generateTicketCode, parseDateOnly, formatPrice } from "@/lib/utils"
import { sendPurchaseEmail } from "@/lib/email"

let prisma: typeof import("@/lib/prisma").prisma | null = null

async function loadPrisma() {
    if (!prisma) {
        prisma = (await import("@/lib/prisma")).prisma
    }
    return prisma
}

function db() {
    if (!prisma) throw new Error("Prisma no fue inicializado.")
    return prisma
}

type Flags = Record<string, string | boolean>
type Row = Record<string, string>

type PlannedIssue = {
    rowNumber: number
    sourceRef: string
    providerOrderNumber: string
    user: {
        id: string
        email: string
        name: string
    }
    ticketType: {
        id: string
        name: string
        price: Prisma.Decimal
        capacity: number
        sold: number
        monthlyClassLimit: number | null
        membershipDurationMonths: number | null
        membershipScheduleKey: string | null
        eventId: string
        event: {
            id: string
            slug: string
            title: string
            servilexSucursalCode: string
            membershipStartFixed: Date | null
            membershipStartMin: Date | null
            membershipStartMax: Date | null
        }
    }
    attendeeName: string
    attendeeDni: string | null
    membershipStartDate: string
    membershipSchedule: Prisma.InputJsonValue | null
    amountPaid: number
    row: Row
}

type SkippedIssue = {
    rowNumber: number
    sourceRef: string
    reason: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseArgs(argv: string[]) {
    const flags: Flags = {}
    const positional: string[] = []
    for (const arg of argv) {
        if (arg.startsWith("--")) {
            const [rawKey, ...rest] = arg.slice(2).split("=")
            flags[rawKey] = rest.length ? rest.join("=") : true
        } else {
            positional.push(arg)
        }
    }
    return { flags, positional }
}

function flagString(flags: Flags, name: string) {
    const value = flags[name]
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function flagBool(flags: Flags, name: string) {
    return flags[name] === true || flags[name] === "true" || flags[name] === "1"
}

function usage() {
    console.log(`
Uso:
  tsx scripts/issue-presential-carnets.ts --file=presenciales.csv --batch=<lote> [--event-slug=<slug>] [--ticket-type-name=<nombre>] [--confirm]

Flags:
  --file                    CSV o JSON con la relacion
  --batch                   nombre estable del lote, requerido para idempotencia
  --event-id / --event-slug  evento global si no viene por fila
  --ticket-type-id          plan global si no viene por fila
  --ticket-type-name        nombre del plan global si no viene por fila
  --confirm                 escribe en BD; sin esto solo valida
  --no-inventory            no incrementa ticket_types.sold
  --force-capacity          permite emitir aunque capacity este lleno
  --allow-existing-active   permite otro carnet activo del mismo plan/evento para el usuario
  --allow-missing-schedule  permite emitir sin horario aunque el plan tenga perfil semanal
  --no-email                no envia el correo de confirmacion por carnet emitido
  --print-template          imprime un CSV ejemplo
`)
}

function printTemplate() {
    console.log(
        [
            "email,eventSlug,ticketTypeName,attendeeName,attendeeDni,membershipStartDate,sourceRef,amountPaid,scheduleCategory,scheduleFrequency,scheduleHoursJson",
            "usuario@correo.com,membresias-videna-2026,MEMBRESIA SEMESTRAL BRONCE,Nombre Apellido,12345678,2026-08-01,recibo-001,0,ADULTOS,LMV,\"{\"\"main\"\":\"\"09:00-10:00\"\"}\"",
        ].join("\n")
    )
}

function maskDbHost(url?: string): string {
    if (!url) return "(sin DATABASE_URL)"
    try {
        const parsed = new URL(url)
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
        return "(DATABASE_URL no parseable)"
    }
}

function normalizeHeader(value: string) {
    return value.trim().replace(/^\uFEFF/, "")
}

function parseCsvLine(line: string) {
    const result: string[] = []
    let current = ""
    let quoted = false
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i]
        const next = line[i + 1]
        if (char === "\"" && quoted && next === "\"") {
            current += "\""
            i += 1
            continue
        }
        if (char === "\"") {
            quoted = !quoted
            continue
        }
        if (char === "," && !quoted) {
            result.push(current)
            current = ""
            continue
        }
        current += char
    }
    result.push(current)
    return result.map((item) => item.trim())
}

function parseCsv(text: string): Row[] {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    if (lines.length === 0) return []

    const headers = parseCsvLine(lines[0]).map(normalizeHeader)
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line)
        const row: Row = {}
        headers.forEach((header, index) => {
            row[header] = values[index] ?? ""
        })
        return row
    })
}

async function loadRows(file: string): Promise<Row[]> {
    const text = await readFile(file, "utf8")
    if (file.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text) as unknown
        if (!Array.isArray(parsed)) throw new Error("El JSON debe ser un array de objetos.")
        return parsed.map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error("Cada fila JSON debe ser un objeto.")
            }
            const row: Row = {}
            for (const [key, value] of Object.entries(item)) {
                row[key] = value == null ? "" : String(value)
            }
            return row
        })
    }
    return parseCsv(text)
}

function getCell(row: Row, ...names: string[]) {
    for (const name of names) {
        const value = row[name]
        if (typeof value === "string" && value.trim()) return value.trim()
    }
    return ""
}

function normalizeRefPart(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
}

function buildSourceRef(batch: string, row: Row, rowNumber: number) {
    const explicit = getCell(row, "sourceRef", "ref", "referencia", "codigo", "receipt", "recibo")
    const dni = getCell(row, "attendeeDni", "dni", "documentNumber", "documento")
    const email = getCell(row, "email", "correo")
    const base = explicit || dni || email || `fila-${rowNumber}`
    return `${normalizeRefPart(batch)}:${normalizeRefPart(base)}`
}

function parseMoney(value: string, fallback = 0) {
    if (!value) return fallback
    const normalized = value.replace(/S\/?/i, "").replace(",", ".").trim()
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Monto invalido: ${value}`)
    }
    return Math.round(parsed * 100) / 100
}

function assertDateKey(value: string, label: string) {
    if (!DATE_RE.test(value)) throw new Error(`${label} debe tener formato YYYY-MM-DD.`)
    const parsed = new Date(`${value}T12:00:00Z`)
    if (Number.isNaN(parsed.getTime()) || formatDateUTC(parsed) !== value) {
        throw new Error(`${label} no es una fecha valida.`)
    }
    return value
}

function parseJsonCell(value: string, label: string) {
    if (!value) return null
    try {
        return JSON.parse(value) as unknown
    } catch {
        throw new Error(`${label} debe ser JSON valido.`)
    }
}

function scheduleInputFromRow(row: Row) {
    const scheduleJson = getCell(row, "membershipSchedule", "schedule", "horario")
    if (scheduleJson) return parseJsonCell(scheduleJson, "membershipSchedule")

    const category = getCell(row, "scheduleCategory", "category", "categoria")
    const frequency = getCell(row, "scheduleFrequency", "frequency", "frecuencia")
    const hoursJson = getCell(row, "scheduleHoursJson", "scheduleHours", "hours")
    const hours =
        (hoursJson ? parseJsonCell(hoursJson, "scheduleHoursJson") : null) ??
        Object.fromEntries(
            Object.entries(row)
                .filter(([key, value]) => key.startsWith("hour_") && value.trim())
                .map(([key, value]) => [key.slice("hour_".length), value.trim()])
        )

    if (category || frequency || (hours && typeof hours === "object" && Object.keys(hours).length > 0)) {
        return { category, frequency, hours }
    }

    return null
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue
}

async function resolveTicketType(row: Row, flags: Flags) {
    const ticketTypeId = getCell(row, "ticketTypeId") || flagString(flags, "ticket-type-id")
    const ticketTypeName = getCell(row, "ticketTypeName", "plan", "ticketType") || flagString(flags, "ticket-type-name")
    const eventId = getCell(row, "eventId") || flagString(flags, "event-id")
    const eventSlug = getCell(row, "eventSlug", "slug") || flagString(flags, "event-slug")

    const where: Prisma.TicketTypeWhereInput = ticketTypeId
        ? { id: ticketTypeId }
        : {
              ...(ticketTypeName
                  ? { name: { equals: ticketTypeName, mode: "insensitive" } }
                  : {}),
              ...(eventId || eventSlug
                  ? {
                        event: {
                            ...(eventId ? { id: eventId } : {}),
                            ...(eventSlug ? { slug: eventSlug } : {}),
                        },
                    }
                  : {}),
          }

    if (!ticketTypeId && !ticketTypeName) {
        throw new Error("Falta ticketTypeId o ticketTypeName.")
    }
    if (!ticketTypeId && !eventId && !eventSlug) {
        throw new Error("Si usas ticketTypeName, tambien indica eventSlug o eventId.")
    }

    const ticketTypes = await db().ticketType.findMany({
        where,
        include: {
            event: {
                select: {
                    id: true,
                    slug: true,
                    title: true,
                    servilexSucursalCode: true,
                    membershipStartFixed: true,
                    membershipStartMin: true,
                    membershipStartMax: true,
                },
            },
        },
        take: 2,
    })

    if (ticketTypes.length === 0) {
        throw new Error(`No se encontro ticketType para ${ticketTypeId || `${eventSlug || eventId} / ${ticketTypeName}`}.`)
    }
    if (ticketTypes.length > 1) {
        throw new Error(`Mas de un ticketType coincide con "${ticketTypeName}". Usa ticketTypeId.`)
    }
    return ticketTypes[0]
}

async function planRow(
    row: Row,
    rowNumber: number,
    flags: Flags,
    batch: string,
    seenRefs: Set<string>
): Promise<PlannedIssue | SkippedIssue> {
    const sourceRef = buildSourceRef(batch, row, rowNumber)
    if (seenRefs.has(sourceRef)) {
        throw new Error(`Fila ${rowNumber}: sourceRef duplicado en el archivo (${sourceRef}).`)
    }
    seenRefs.add(sourceRef)

    const providerOrderNumber = `PRES-${sourceRef}`
    const existingImport = await db().order.findFirst({
        where: {
            provider: "PRESENCIAL",
            providerOrderNumber,
        },
        include: {
            tickets: { select: { id: true, ticketCode: true, status: true } },
        },
    })
    if (existingImport) {
        return {
            rowNumber,
            sourceRef,
            reason: `ya existe orden ${existingImport.id.slice(-8).toUpperCase()} con ${existingImport.tickets.length} ticket(s)`,
        }
    }

    const email = getCell(row, "email", "correo").toLowerCase()
    if (!email) throw new Error(`Fila ${rowNumber}: falta email.`)

    const user = await db().user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, email: true, name: true },
    })
    if (!user) {
        throw new Error(`Fila ${rowNumber}: el usuario ${email} no existe en la web.`)
    }

    const ticketType = await resolveTicketType(row, flags)
    const isMembership = (ticketType.monthlyClassLimit ?? 0) > 0
    if (!isMembership && !flagBool(flags, "allow-non-membership")) {
        throw new Error(`Fila ${rowNumber}: "${ticketType.name}" no es una membresia (monthlyClassLimit vacio).`)
    }
    if (!ticketType.isActive) {
        throw new Error(`Fila ${rowNumber}: "${ticketType.name}" esta inactivo.`)
    }

    const existingActive = await db().ticket.findFirst({
        where: {
            userId: user.id,
            eventId: ticketType.eventId,
            ticketTypeId: ticketType.id,
            status: "ACTIVE",
            order: { status: "PAID" },
        },
        select: { id: true, ticketCode: true },
    })
    if (existingActive && !flagBool(flags, "allow-existing-active")) {
        throw new Error(
            `Fila ${rowNumber}: ${email} ya tiene carnet activo ${existingActive.ticketCode} para "${ticketType.name}".`
        )
    }

    const fixedTerm = isMembership && (ticketType.membershipDurationMonths ?? 0) > 0
    const explicitStart = getCell(row, "membershipStartDate", "startDate", "inicio")
    const membershipStartDate = ticketType.event.membershipStartFixed
        ? formatDateUTC(ticketType.event.membershipStartFixed)
        : explicitStart

    if (fixedTerm && !membershipStartDate) {
        throw new Error(`Fila ${rowNumber}: falta membershipStartDate para "${ticketType.name}".`)
    }
    if (membershipStartDate) {
        assertDateKey(membershipStartDate, `Fila ${rowNumber}: membershipStartDate`)
        const month = Number(membershipStartDate.slice(5, 7))
        if (isBlackoutMonth(month)) {
            throw new Error(`Fila ${rowNumber}: membershipStartDate no puede ser enero ni febrero.`)
        }
        const min = ticketType.event.membershipStartMin ? formatDateUTC(ticketType.event.membershipStartMin) : null
        const max = ticketType.event.membershipStartMax ? formatDateUTC(ticketType.event.membershipStartMax) : null
        if (min && membershipStartDate < min) {
            throw new Error(`Fila ${rowNumber}: inicio ${membershipStartDate} es menor al minimo ${min}.`)
        }
        if (max && membershipStartDate > max) {
            throw new Error(`Fila ${rowNumber}: inicio ${membershipStartDate} supera el maximo ${max}.`)
        }
    }

    const scheduleProfile = getMembershipScheduleProfile(
        ticketType.event.servilexSucursalCode,
        ticketType.membershipScheduleKey
    )
    const rawSchedule = scheduleInputFromRow(row)
    let membershipSchedule: Prisma.InputJsonValue | null = null
    if (scheduleProfile) {
        if (!rawSchedule && !flagBool(flags, "allow-missing-schedule")) {
            throw new Error(`Fila ${rowNumber}: "${ticketType.name}" requiere horario semanal.`)
        }
        if (rawSchedule) {
            const normalized = parseMembershipScheduleSelection(rawSchedule)
            if (normalized) {
                membershipSchedule = toJsonValue(normalized)
            } else {
                const validation = validateMembershipScheduleSelection(
                    scheduleProfile,
                    rawSchedule as Parameters<typeof validateMembershipScheduleSelection>[1],
                    ticketType.event.servilexSucursalCode
                )
                if (!validation.ok) throw new Error(`Fila ${rowNumber}: ${validation.error}`)
                membershipSchedule = toJsonValue(validation.selection)
            }
        }
    }

    const attendeeName = getCell(row, "attendeeName", "name", "nombre") || user.name
    const attendeeDni = getCell(row, "attendeeDni", "dni", "documentNumber", "documento") || null
    const amountFromFlags = flagString(flags, "amount")
    const amountPaid = parseMoney(getCell(row, "amountPaid", "amount", "monto") || amountFromFlags || "0")

    return {
        rowNumber,
        sourceRef,
        providerOrderNumber,
        user,
        ticketType,
        attendeeName,
        attendeeDni,
        membershipStartDate: membershipStartDate || "",
        membershipSchedule,
        amountPaid,
        row,
    }
}

async function createIssue(tx: Prisma.TransactionClient, issue: PlannedIssue, options: {
    reserveInventory: boolean
    forceCapacity: boolean
}) {
    if (options.reserveInventory) {
        const capacityWhere =
            issue.ticketType.capacity > 0 && !options.forceCapacity
                ? { sold: { lte: issue.ticketType.capacity - 1 } }
                : {}
        const updated = await tx.ticketType.updateMany({
            where: {
                id: issue.ticketType.id,
                isActive: true,
                ...capacityWhere,
            },
            data: {
                sold: { increment: 1 },
            },
        })
        if (updated.count !== 1) {
            throw new Error(`Sin capacidad para ${issue.ticketType.name} (${issue.ticketType.id}).`)
        }
    }

    const buyerDocNumber = getCell(issue.row, "buyerDocNumber", "buyerDni") || issue.attendeeDni
    const now = new Date()
    const order = await tx.order.create({
        data: {
            userId: issue.user.id,
            status: "PAID",
            orderType: "TICKET",
            totalAmount: issue.amountPaid,
            currency: "PEN",
            provider: "PRESENCIAL",
            providerRef: issue.sourceRef,
            providerOrderNumber: issue.providerOrderNumber,
            providerResponse: {
                source: "presential-carnet-import",
                batch: issue.sourceRef.split(":")[0],
                sourceRef: issue.sourceRef,
                rowNumber: issue.rowNumber,
                importedAt: now.toISOString(),
                originalRow: issue.row,
            },
            paidAt: now,
            documentType: getCell(issue.row, "documentType") || "BOLETA",
            buyerDocType: buyerDocNumber && buyerDocNumber.length === 11 ? "6" : "1",
            buyerDocNumber,
            buyerName: getCell(issue.row, "buyerName") || issue.user.name,
            buyerEmail: issue.user.email,
            buyerPhone: getCell(issue.row, "buyerPhone", "phone", "telefono") || null,
            orderItems: {
                create: [{
                    ticketTypeId: issue.ticketType.id,
                    quantity: 1,
                    unitPrice: issue.amountPaid,
                    subtotal: issue.amountPaid,
                    attendeeData: [{
                        name: issue.attendeeName,
                        dni: issue.attendeeDni,
                        membershipStartDate: issue.membershipStartDate || null,
                        membershipSchedule: issue.membershipSchedule,
                    }] as Prisma.InputJsonValue,
                }],
            },
        },
    })

    const ticket = await tx.ticket.create({
        data: {
            orderId: order.id,
            userId: issue.user.id,
            eventId: issue.ticketType.eventId,
            ticketTypeId: issue.ticketType.id,
            ticketCode: generateTicketCode(),
            attendeeName: issue.attendeeName,
            attendeeDni: issue.attendeeDni || undefined,
            membershipStartDate: issue.membershipStartDate ? parseDateOnly(issue.membershipStartDate) : null,
            membershipSchedule: issue.membershipSchedule ?? Prisma.JsonNull,
            status: "ACTIVE",
        },
    })

    return { orderId: order.id, ticketCode: ticket.ticketCode }
}

async function main() {
    const { flags } = parseArgs(process.argv.slice(2))
    if (flagBool(flags, "help") || flagBool(flags, "h")) {
        usage()
        return
    }
    if (flagBool(flags, "print-template")) {
        printTemplate()
        return
    }

    const file = flagString(flags, "file")
    const batch = flagString(flags, "batch")
    const confirm = flagBool(flags, "confirm")
    const reserveInventory = !flagBool(flags, "no-inventory")
    const forceCapacity = flagBool(flags, "force-capacity")
    const sendEmails = !flagBool(flags, "no-email")

    if (!file || !batch) {
        usage()
        throw new Error("Faltan --file y/o --batch.")
    }

    const absoluteFile = path.resolve(file)
    const rows = await loadRows(absoluteFile)
    if (rows.length === 0) throw new Error("El archivo no tiene filas.")

    console.log(`DB destino: ${maskDbHost(process.env.DATABASE_URL)}`)
    console.log(`Archivo: ${absoluteFile}`)
    console.log(`Lote: ${batch}`)
    console.log(`Modo: ${confirm ? "CONFIRM" : "DRY-RUN"}`)
    console.log(`Inventario: ${reserveInventory ? "incrementar sold" : "no tocar"}`)
    console.log("")

    await loadPrisma()

    const seenRefs = new Set<string>()
    const planned: PlannedIssue[] = []
    const skipped: SkippedIssue[] = []
    const errors: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
        const rowNumber = index + 2
        try {
            const result = await planRow(rows[index], rowNumber, flags, batch, seenRefs)
            if ("reason" in result) skipped.push(result)
            else planned.push(result)
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error))
        }
    }

    console.log(`Filas: ${rows.length}`)
    console.log(`A emitir: ${planned.length}`)
    console.log(`A saltar: ${skipped.length}`)
    console.log(`Errores: ${errors.length}`)
    console.log("")

    for (const issue of planned) {
        console.log(
            `OK fila ${issue.rowNumber}: ${issue.user.email} -> ${issue.ticketType.event.title} / ${issue.ticketType.name} inicio ${issue.membershipStartDate || "-"} ref=${issue.sourceRef}`
        )
    }
    for (const skip of skipped) {
        console.log(`SKIP fila ${skip.rowNumber}: ref=${skip.sourceRef} (${skip.reason})`)
    }
    for (const error of errors) {
        console.error(`ERROR ${error}`)
    }

    if (errors.length > 0) {
        throw new Error("Hay errores. No se emitio nada.")
    }

    if (!confirm) {
        console.log("")
        console.log("DRY-RUN: no se escribio nada. Repite con --confirm para emitir.")
        return
    }

    if (planned.length === 0) {
        console.log("No hay carnets nuevos para emitir.")
        return
    }

    const created = await db().$transaction(async (tx) => {
        const result: Array<{ email: string; orderId: string; ticketCode: string }> = []
        for (const issue of planned) {
            const createdIssue = await createIssue(tx, issue, { reserveInventory, forceCapacity })
            result.push({
                email: issue.user.email,
                orderId: createdIssue.orderId,
                ticketCode: createdIssue.ticketCode,
            })
        }
        return result
    }, { timeout: 60_000 })

    console.log("")
    console.log(`Emitidos ${created.length} carnet(s):`)
    for (const item of created) {
        console.log(`  - ${item.email}: ${item.ticketCode} (orden ${item.orderId.slice(-8).toUpperCase()})`)
    }

    // Notificar por correo a cada titular que su carnet fue emitido. Reusa el
    // mismo correo de confirmacion que reciben los compradores web. Best-effort:
    // el carnet ya quedo emitido, un fallo de correo no revierte nada.
    // created[i] corresponde a planned[i] (mismo orden dentro de la transaccion).
    if (!sendEmails) {
        console.log("")
        console.log("(--no-email) No se enviaron correos.")
    } else {
        let sent = 0
        let failedEmails = 0
        for (let i = 0; i < created.length; i += 1) {
            const item = created[i]
            const issue = planned[i]
            try {
                const result = await sendPurchaseEmail(
                    item.email,
                    issue.user.name,
                    item.orderId,
                    issue.ticketType.event.title || "Membresia FDNDA",
                    1,
                    formatPrice(issue.amountPaid)
                )
                if (result.success) {
                    sent += 1
                } else {
                    failedEmails += 1
                    console.error(`  correo FALLO ${item.email}: ${result.error ?? "desconocido"}`)
                }
            } catch (error) {
                failedEmails += 1
                console.error(`  correo ERROR ${item.email}: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
        console.log("")
        console.log(`Correos: ${sent} encolados/enviados, ${failedEmails} fallidos.`)
    }
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
