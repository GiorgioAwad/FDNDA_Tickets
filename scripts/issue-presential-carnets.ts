/**
 * Emite carnets/entradas de membresia para inscritos presenciales que ya tienen
 * usuario web. Por defecto es DRY-RUN: valida la relacion y muestra el plan.
 *
 * Este script es un adaptador delgado sobre `src/lib/carnet-issuance.ts`: no
 * repite validaciones ni escritura propias, solo traduce cada fila del CSV a
 * un `CarnetIssuanceInput` y llama a `planCarnetIssuance`/`issueCarnet`. Es el
 * mismo modulo que usa el panel admin, para que ambos caminos nunca diverjan.
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
 *   membershipSchedule     JSON normalizado (con `sessions`, tal como se guarda
 *                          en Ticket.membershipSchedule) o input crudo
 *                          (categoria/frecuencia/horas)
 *   scheduleCategory       ADULTOS/NINOS, si aplica horario
 *   scheduleFrequency      LMV/MJS/LV, si aplica horario
 *   scheduleHoursJson      JSON, ej. {"main":"09:00-10:00"}
 *
 * Nota: si el ticketType usa cupo por fecha (piscina libre, o EVENTO con
 * capacityByDate) o es un paquete de varios dias, el modulo compartido exige
 * fechas (`scheduleSelections`) que este script no completa desde el CSV: esas
 * filas fallaran con un error claro en vez de emitir un carnet que no consume
 * cupo por fecha. Es el comportamiento correcto; este script se usa hoy solo
 * para membresias, que no pasan por esa rama.
 */
import { Prisma } from "@prisma/client"
import { readFile } from "node:fs/promises"
import path from "node:path"

import {
    parseMembershipScheduleSelection,
    scheduleSelectionToInput,
    type MembershipScheduleInput,
} from "@/lib/membership-schedule"
import { planCarnetIssuance, issueCarnet } from "@/lib/carnet-issuance"
import type { CarnetIssuanceInput, CarnetPlan } from "@/lib/carnet-issuance-rules"

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

type PlannedIssue = { rowNumber: number; plan: CarnetPlan }
type SkippedIssue = { rowNumber: number; sourceRef: string; reason: string }

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
  --no-inventory            RETIRADO: el modulo compartido siempre actualiza el cupo al emitir; el script aborta si se pasa este flag
  --force-capacity          permite emitir aunque el cupo (global o por fecha) este lleno
  --allow-existing-active   permite otro carnet activo del mismo plan/evento para el usuario
  --allow-missing-schedule  RETIRADO: el modulo compartido siempre exige horario si el plan tiene perfil semanal; la fila fallara con error si falta
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

/**
 * `scheduleInputFromRow` puede devolver dos formas distintas: el input crudo
 * (categoria/frecuencia/horas, igual al checkout) o una seleccion ya
 * normalizada (con `sessions`, tal como queda guardada en
 * Ticket.membershipSchedule) si alguien copio ese JSON directo al CSV.
 * `CarnetIssuanceInput.membershipSchedule` solo acepta la forma cruda
 * (`validateCarnetRequest` valida contra el perfil, no re-hidrata una
 * seleccion ya resuelta), asi que si se detecta la forma normalizada se
 * convierte de vuelta con `scheduleSelectionToInput` antes de entregarla.
 */
function toMembershipScheduleInput(row: Row): MembershipScheduleInput | null {
    const raw = scheduleInputFromRow(row)
    const normalized = parseMembershipScheduleSelection(raw)
    if (normalized) return scheduleSelectionToInput(normalized)
    return raw as MembershipScheduleInput | null
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
                    category: true,
                    startDate: true,
                    endDate: true,
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

/** Traduce una fila del CSV a la entrada que espera el modulo compartido. */
async function inputFromRow(
    row: Row,
    rowNumber: number,
    flags: Flags,
    batch: string,
    seenRefs: Set<string>
): Promise<CarnetIssuanceInput> {
    const email = getCell(row, "email", "correo").toLowerCase()
    if (!email) throw new Error(`Fila ${rowNumber}: falta email.`)

    const user = await db().user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
    })
    if (!user) throw new Error(`Fila ${rowNumber}: el usuario ${email} no existe en la web.`)

    const ticketType = await resolveTicketType(row, flags)

    const sourceRef = buildSourceRef(batch, row, rowNumber)
    if (seenRefs.has(sourceRef)) {
        throw new Error(`Fila ${rowNumber}: sourceRef duplicado en el archivo (${sourceRef}).`)
    }
    seenRefs.add(sourceRef)

    return {
        userId: user.id,
        ticketTypeId: ticketType.id,
        attendeeName: getCell(row, "attendeeName", "name", "nombre") || undefined,
        attendeeDni: getCell(row, "attendeeDni", "dni", "documentNumber", "documento") || null,
        amountPaid: parseMoney(
            getCell(row, "amountPaid", "amount", "monto") || flagString(flags, "amount") || "0"
        ),
        membershipStartDate: getCell(row, "membershipStartDate", "startDate", "inicio") || null,
        membershipSchedule: toMembershipScheduleInput(row),
        sourceRef,
        reason: `Import presencial lote ${batch} (fila ${rowNumber})`,
        forceCapacity: flagBool(flags, "force-capacity"),
        allowExistingActive: flagBool(flags, "allow-existing-active"),
        sendEmail: !flagBool(flags, "no-email"),
    }
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

    if (flagBool(flags, "no-inventory")) {
        // El modulo compartido (issueCarnet) siempre incrementa ticket_types.sold
        // al escribir: no hay forma de pedirle que no lo haga sin tocar esa
        // funcion, que este script no puede modificar. Abortar en vez de aceptar
        // el flag y actualizar el cupo de todos modos en silencio.
        throw new Error(
            "--no-inventory ya no esta soportado: el modulo compartido siempre actualiza el cupo al emitir. Quita el flag."
        )
    }

    const file = flagString(flags, "file")
    const batch = flagString(flags, "batch")
    const confirm = flagBool(flags, "confirm")
    const sendEmailsRequested = !flagBool(flags, "no-email")

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
    console.log("")

    await loadPrisma()

    const seenRefs = new Set<string>()
    const planned: PlannedIssue[] = []
    const skipped: SkippedIssue[] = []
    const errors: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
        const rowNumber = index + 2
        try {
            const input = await inputFromRow(rows[index], rowNumber, flags, batch, seenRefs)
            const result = await planCarnetIssuance(input)
            if (result.ok) {
                planned.push({ rowNumber, plan: result.plan })
            } else if (result.errors.some((e) => /ya se emiti/i.test(e))) {
                skipped.push({ rowNumber, sourceRef: input.sourceRef, reason: result.errors[0] })
            } else {
                errors.push(`Fila ${rowNumber}: ${result.errors.join(" | ")}`)
            }
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
        const p = issue.plan
        console.log(
            `OK fila ${issue.rowNumber}: ${p.userEmail} -> ${p.eventTitle} / ${p.ticketTypeName} | ${p.attendeeName} (${p.attendeeDni ?? "sin DNI"}) | S/${p.amountPaid} | inicio ${p.membershipStartDate || "-"} | dias ${p.entitlementDates.length} | ref=${p.sourceRef}`
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

    // Cada fila se emite en su propia transaccion (issueCarnet), no todas en una
    // sola como antes. Si una fila falla a mitad de camino, las anteriores ya
    // quedaron confirmadas en BD y NO se revierten: por eso se imprime cada
    // carnet emitido apenas se confirma (no al final) y, si el lote se corta, se
    // puede volver a correr el mismo archivo — los sourceRef ya usados se saltan
    // solos en la siguiente pasada (ver planCarnetIssuance/issueCarnet).
    console.log("")
    console.log("Emitiendo:")
    const created: Array<{ email: string; orderId: string; ticketCode: string; emailError: string | null }> = []
    try {
        for (const item of planned) {
            const result = await issueCarnet(item.plan, { id: "script", email: `cli:${batch}` })
            created.push({
                email: item.plan.userEmail,
                orderId: result.orderId,
                ticketCode: result.ticketCode,
                emailError: result.emailError,
            })
            console.log(`  - ${item.plan.userEmail}: ${result.ticketCode} (orden ${result.orderId.slice(-8).toUpperCase()})`)
        }
    } catch (error) {
        const failedRow = planned[created.length]
        console.log("")
        console.error(
            `ERROR al emitir fila ${failedRow ? failedRow.rowNumber : "?"}: ${error instanceof Error ? error.message : String(error)}`
        )
        if (created.length > 0) {
            console.error(
                `Los ${created.length} carnet(s) anteriores ya quedaron emitidos (no se revierten). Vuelve a correr el mismo archivo: los sourceRef ya usados se saltan solos.`
            )
        }
        throw error
    }

    console.log("")
    console.log(`Emitidos ${created.length} carnet(s).`)

    if (!sendEmailsRequested) {
        console.log("(--no-email) No se enviaron correos.")
    } else {
        for (const item of created) {
            if (item.emailError) console.error(`  correo FALLO ${item.email}: ${item.emailError}`)
        }
        const failedEmails = created.filter((item) => item.emailError).length
        console.log(`Correos: ${created.length - failedEmails} enviados, ${failedEmails} fallidos.`)
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
