/**
 * Exporta datos normalizados para el reporte consolidado de membresias:
 * - Campo de Marte: reportes XLS legados (junio/julio/agosto 2026).
 * - Ticketing Campo de Marte: ordenes IZIPAY pagadas.
 * - VIDENA: ordenes IZIPAY pagadas.
 *
 * La consulta a produccion es de solo lectura. La salida es un JSON intermedio
 * que luego se convierte en un XLSX presentable con openpyxl.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

for (const file of [".env.production", ".env"]) {
    try {
        const text = readFileSync(resolve(process.cwd(), file), "utf8")
        for (const line of text.split("\n")) {
            const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
            if (!match || process.env[match[1]]) continue
            let value = match[2].trim()
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1)
            }
            process.env[match[1]] = value
        }
    } catch {}
}

process.env.PRISMA_DATABASE_ADAPTER = process.env.PRISMA_DATABASE_ADAPTER || "neon"

const JULY_START = new Date("2026-07-01T05:00:00.000Z")
const AUGUST_START = new Date("2026-08-01T05:00:00.000Z")

const XLS_FILES = [
    "1640 JUNIO.XLS",
    "1640 JULIO.XLS",
    "1240 JUNIO.XLS",
    "1240 JULIO.XLS",
    "1240 AGOSTO.XLS",
    "1090 JUNIO.XLS",
    "1090 JULIO.XLS",
    "1090 AGOSTO.XLS",
    "890 JUNIO.XLS",
    "890 JULIO.XLS",
    "890 AGOSTO.XLS",
    "3090 JUNIO.XLS",
    "3090 JULIO.XLS",
    "2640 JUNIO.XLS",
    "2640 JULIO.XLS",
    "2040 JUNIO.XLS",
    "2040 JULIO.XLS",
] as const

type Period = "JUNIO_REFERENCIA" | "JULIO" | "POST_CIERRE_JULIO"

type XlsRecord = {
    id: string
    period: Period
    file: string
    row: number
    plan: string
    carnet: string
    studentId: string
    attendee: string
    schedule: string
    pool: string
    phone: string
    age: number | null
    amount: number
    exportedAt: string
    reconciliationStatus: "PRESENCIAL_LEGACY" | "TICKETING_CONCILIADO"
    matchedTicketingRecordId: string
    matchedOrderId: string
    matchedPaidAt: string
    matchedTicketCode: string
    matchedTicketingNet: number | null
    amountDifference: number | null
}

type WebTicketRecord = {
    id: string
    period: Period
    sourceGroup: "TICKETING_CAMPO_MARTE" | "VIDENA"
    sede: string
    provider: string
    event: string
    plan: string
    orderId: string
    providerOrderNumber: string
    providerTransactionId: string
    paidAt: string
    createdAt: string
    ticketId: string
    ticketCode: string
    ticketStatus: string
    attendee: string
    attendeeDni: string
    buyer: string
    buyerDocument: string
    buyerEmail: string
    buyerPhone: string
    gross: number
    discount: number
    net: number
    matchedXlsRecordId: string
    matchedXlsFile: string
    matchedXlsCarnet: string
    matchMethod: string
}

function argValue(name: string): string | undefined {
    const direct = process.argv.find((value) => value.startsWith(`--${name}=`))
    if (direct) return direct.slice(name.length + 3)
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : undefined
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100
}

function text(value: unknown): string {
    if (value == null) return ""
    return String(value).trim()
}

function periodFromFile(file: string): Period {
    if (file.includes("JUNIO")) return "JUNIO_REFERENCIA"
    if (file.includes("JULIO")) return "JULIO"
    return "POST_CIERRE_JULIO"
}

function periodFromPaidAt(date: Date): Period {
    if (date < JULY_START) return "JUNIO_REFERENCIA"
    return date < AUGUST_START ? "JULIO" : "POST_CIERRE_JULIO"
}

function normalizedTokens(value: string): string[] {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .sort()
}

function normalizedName(value: string): string {
    return normalizedTokens(value).join(" ")
}

function normalizedPlan(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/\s*-\s*CAMPO\s+(DE\s+)?MARTE.*$/, "")
        .replace(/\s*-\s*FDNDA.*$/, "")
        .replace(/\bACADEMIA\b/g, "")
        .replace(/[^A-Z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ")
}

function nameMatchScore(left: string, right: string): number {
    const leftKey = normalizedName(left)
    const rightKey = normalizedName(right)
    if (!leftKey || !rightKey) return 0
    if (leftKey === rightKey) return 100
    const leftTokens = new Set(leftKey.split(" "))
    const rightTokens = new Set(rightKey.split(" "))
    const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens
    const larger = leftTokens.size <= rightTokens.size ? rightTokens : leftTokens
    if (smaller.size >= 3 && [...smaller].every((token) => larger.has(token))) return 70
    const intersection = [...smaller].filter((token) => larger.has(token)).length
    return intersection >= 3 && intersection / Math.max(leftTokens.size, rightTokens.size) >= 0.75 ? 40 : 0
}

function digits(value: string): string {
    return value.replace(/\D/g, "")
}

function allocateCents(total: number, weights: number[]): number[] {
    if (weights.length === 0) return []
    const cents = Math.round(total * 100)
    const safeWeights = weights.map((weight) => Math.max(0, Number.isFinite(weight) ? weight : 0))
    const sum = safeWeights.reduce((acc, weight) => acc + weight, 0)
    const exact = sum > 0
        ? safeWeights.map((weight) => (cents * weight) / sum)
        : safeWeights.map(() => cents / safeWeights.length)
    const allocated = exact.map((value) => Math.floor(value))
    let remainder = cents - allocated.reduce((acc, value) => acc + value, 0)
    const order = exact
        .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
        allocated[order[index % order.length].index] += 1
    }
    return allocated
}

function extractReportPlan(rows: unknown[][]): string {
    for (const row of rows) {
        const values = row.map(text)
        if (!values.some((value) => value.toUpperCase().includes("REPORTE POR RUBRO"))) continue
        const plan = values.find((value) => value.toUpperCase().includes("MEMBRES"))
        if (plan) return plan
    }
    return ""
}

function extractExportedAt(rows: unknown[][]): string {
    let date = ""
    let time = ""
    for (const row of rows.slice(0, 10)) {
        for (const value of row.map(text)) {
            const dateMatch = /Fecha\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(value)
            const timeMatch = /Hora\s*:\s*(\d{2}:\d{2}:\d{2})/i.exec(value)
            if (dateMatch) date = dateMatch[1]
            if (timeMatch) time = timeMatch[1]
        }
    }
    return date ? `${date}${time ? ` ${time}` : ""}` : ""
}

function reportedMetric(rows: unknown[][], label: string): number | null {
    for (const row of rows) {
        if (!row.map(text).some((value) => value.toUpperCase().includes(label))) continue
        const numbers = row.filter((value) => typeof value === "number") as number[]
        if (numbers.length > 0) return Number(numbers[numbers.length - 1])
    }
    return null
}

async function main() {
    const sourceDir = resolve(argValue("source-dir") ?? "G:/GIORGIO/Descargas")
    const output = resolve(argValue("out") ?? "tmp/reporte-membresias-2026-data.json")
    const generatedAt = new Date()
    const xlsxModule = await import("xlsx")
    const XLSX = xlsxModule.default ?? xlsxModule

    const xlsRecords: XlsRecord[] = []
    const fileValidations: Array<Record<string, unknown>> = []

    for (const file of XLS_FILES) {
        const path = join(sourceDir, file)
        const workbook = XLSX.readFile(path)
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
        const plan = extractReportPlan(rows)
        const exportedAt = extractExportedAt(rows)
        const fileRecords: XlsRecord[] = []

        rows.forEach((row, index) => {
            const carnetYear = Number(row[0])
            if (!Number.isInteger(carnetYear) || carnetYear < 2000 || carnetYear > 2100 || typeof row[39] !== "number") return
            const carnet = `${text(row[0])}-${text(row[3])}-${text(row[6]).padStart(7, "0")}`
            const record: XlsRecord = {
                id: `XLS:${file}:${index + 1}`,
                period: periodFromFile(file),
                file,
                row: index + 1,
                plan,
                carnet,
                studentId: text(row[8]),
                attendee: [text(row[10]), text(row[13]), text(row[16])].filter(Boolean).join(" "),
                schedule: text(row[19]),
                pool: text(row[28]),
                phone: text(row[34]),
                age: typeof row[37] === "number" ? row[37] : null,
                amount: roundMoney(Number(row[39])),
                exportedAt,
                reconciliationStatus: "PRESENCIAL_LEGACY",
                matchedTicketingRecordId: "",
                matchedOrderId: "",
                matchedPaidAt: "",
                matchedTicketCode: "",
                matchedTicketingNet: null,
                amountDifference: null,
            }
            fileRecords.push(record)
            xlsRecords.push(record)
        })

        const calculatedCount = fileRecords.length
        const calculatedAmount = roundMoney(fileRecords.reduce((sum, record) => sum + record.amount, 0))
        const reportedCount = reportedMetric(rows, "TOTAL ALUMNOS")
        const reportedAmount = reportedMetric(rows, "MONTO TOTAL")
        fileValidations.push({
            file,
            period: periodFromFile(file),
            plan,
            exportedAt,
            calculatedCount,
            reportedCount,
            countDifference: reportedCount == null ? null : calculatedCount - reportedCount,
            calculatedAmount,
            reportedAmount,
            amountDifference: reportedAmount == null ? null : roundMoney(calculatedAmount - reportedAmount),
            status: reportedCount === calculatedCount && reportedAmount != null && Math.abs(calculatedAmount - reportedAmount) < 0.01 ? "OK" : "REVISAR",
        })
    }

    const { prisma } = await import("@/lib/prisma")
    const orders = await prisma.order.findMany({
        where: {
            status: "PAID",
            paidAt: { lte: generatedAt },
            orderItems: {
                some: { ticketType: { event: { category: "ACADEMIA" } } },
            },
        },
        select: {
            id: true,
            provider: true,
            providerOrderNumber: true,
            providerTransactionId: true,
            totalAmount: true,
            paidAt: true,
            createdAt: true,
            buyerName: true,
            buyerDocNumber: true,
            buyerEmail: true,
            buyerPhone: true,
            user: { select: { name: true, dni: true, email: true, phone: true } },
            tickets: {
                select: {
                    id: true,
                    ticketTypeId: true,
                    ticketCode: true,
                    attendeeName: true,
                    attendeeDni: true,
                    status: true,
                },
            },
            orderItems: {
                select: {
                    id: true,
                    ticketTypeId: true,
                    quantity: true,
                    unitPrice: true,
                    subtotal: true,
                    ticketType: {
                        select: {
                            id: true,
                            name: true,
                            event: {
                                select: {
                                    title: true,
                                    category: true,
                                    servilexSucursalCode: true,
                                },
                            },
                        },
                    },
                },
            },
        },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
    })

    const webTickets: WebTicketRecord[] = []
    const databaseValidations = {
        paidMembershipOrdersRead: orders.length,
        excludedNonIzipayOrders: 0,
        excludedNonIzipayAmount: 0,
        itemTicketCountMismatches: [] as Array<Record<string, unknown>>,
        cancelledTicketsInPaidOrders: 0,
    }

    for (const order of orders) {
        if (!order.paidAt) continue
        const allItemWeights = order.orderItems.map((item) => Number(item.subtotal))
        const itemNetCents = allocateCents(Number(order.totalAmount), allItemWeights)

        if (order.provider !== "IZIPAY") {
            databaseValidations.excludedNonIzipayOrders += 1
            databaseValidations.excludedNonIzipayAmount = roundMoney(databaseValidations.excludedNonIzipayAmount + Number(order.totalAmount))
            continue
        }

        order.orderItems.forEach((item, itemIndex) => {
            if (!item.ticketType || item.ticketType.event.category !== "ACADEMIA") return
            const sedeCode = item.ticketType.event.servilexSucursalCode
            if (sedeCode !== "01" && sedeCode !== "03") return

            const itemTickets = order.tickets.filter((ticket) => ticket.ticketTypeId === item.ticketTypeId)
            if (itemTickets.length !== item.quantity) {
                databaseValidations.itemTicketCountMismatches.push({
                    orderId: order.id,
                    ticketType: item.ticketType.name,
                    quantity: item.quantity,
                    tickets: itemTickets.length,
                })
            }
            const ticketCount = Math.max(item.quantity, 1)
            const ticketNetCents = allocateCents(itemNetCents[itemIndex] / 100, Array.from({ length: ticketCount }, () => 1))
            const ticketGrossCents = allocateCents(Number(item.subtotal), Array.from({ length: ticketCount }, () => 1))

            for (let index = 0; index < ticketCount; index += 1) {
                const ticket = itemTickets[index]
                if (ticket?.status === "CANCELLED") databaseValidations.cancelledTicketsInPaidOrders += 1
                const gross = roundMoney(ticketGrossCents[index] / 100)
                const net = roundMoney(ticketNetCents[index] / 100)
                webTickets.push({
                    id: `WEB:${order.id}:${item.id}:${index + 1}`,
                    period: periodFromPaidAt(order.paidAt!),
                    sourceGroup: sedeCode === "01" ? "TICKETING_CAMPO_MARTE" : "VIDENA",
                    sede: sedeCode === "01" ? "Campo de Marte" : "VIDENA",
                    provider: order.provider,
                    event: item.ticketType.event.title,
                    plan: item.ticketType.name.trim(),
                    orderId: order.id,
                    providerOrderNumber: order.providerOrderNumber ?? "",
                    providerTransactionId: order.providerTransactionId ?? "",
                    paidAt: order.paidAt!.toISOString(),
                    createdAt: order.createdAt.toISOString(),
                    ticketId: ticket?.id ?? "",
                    ticketCode: ticket?.ticketCode ?? "",
                    ticketStatus: ticket?.status ?? "SIN_TICKET",
                    attendee: ticket?.attendeeName?.trim() || order.buyerName?.trim() || order.user.name,
                    attendeeDni: ticket?.attendeeDni?.trim() || order.buyerDocNumber?.trim() || order.user.dni || "",
                    buyer: order.buyerName?.trim() || order.user.name,
                    buyerDocument: order.buyerDocNumber?.trim() || order.user.dni || "",
                    buyerEmail: order.buyerEmail?.trim() || order.user.email,
                    buyerPhone: order.buyerPhone?.trim() || order.user.phone || "",
                    gross,
                    discount: roundMoney(gross - net),
                    net,
                    matchedXlsRecordId: "",
                    matchedXlsFile: "",
                    matchedXlsCarnet: "",
                    matchMethod: "",
                })
            }
        })
    }

    const cdmTickets = webTickets.filter((record) => record.sourceGroup === "TICKETING_CAMPO_MARTE")
    const videnaTickets = webTickets.filter((record) => record.sourceGroup === "VIDENA")
    const matchedXlsIds = new Set<string>()

    for (const ticket of cdmTickets) {
        const candidates = xlsRecords
            .filter((record) =>
                record.period === ticket.period &&
                normalizedPlan(record.plan) === normalizedPlan(ticket.plan) &&
                !matchedXlsIds.has(record.id),
            )
            .map((record) => {
                let score = nameMatchScore(record.attendee, ticket.attendee)
                const recordPhone = digits(record.phone)
                const ticketPhone = digits(ticket.buyerPhone)
                if (recordPhone.length >= 7 && ticketPhone.length >= 7 && recordPhone.slice(-7) === ticketPhone.slice(-7)) score += 25
                const amountDifference = Math.abs(record.amount - ticket.net)
                if (amountDifference < 0.01) score += 20
                else if (amountDifference <= 5) score += 10
                return { record, score, amountDifference }
            })
            .filter((candidate) => candidate.score >= 60)
            .sort((a, b) => b.score - a.score || a.amountDifference - b.amountDifference || a.record.row - b.record.row)

        const match = candidates[0]
        if (!match) continue
        matchedXlsIds.add(match.record.id)
        match.record.reconciliationStatus = "TICKETING_CONCILIADO"
        match.record.matchedTicketingRecordId = ticket.id
        match.record.matchedOrderId = ticket.orderId
        match.record.matchedPaidAt = ticket.paidAt
        match.record.matchedTicketCode = ticket.ticketCode
        match.record.matchedTicketingNet = ticket.net
        match.record.amountDifference = roundMoney(match.record.amount - ticket.net)
        ticket.matchedXlsRecordId = match.record.id
        ticket.matchedXlsFile = match.record.file
        ticket.matchedXlsCarnet = match.record.carnet
        ticket.matchMethod = match.score >= 120 ? "NOMBRE+MONTO" : match.score >= 90 ? "NOMBRE" : "COINCIDENCIA_PROBABLE"
    }

    const uniqueSales: Array<Record<string, unknown>> = []
    for (const record of xlsRecords) {
        if (record.reconciliationStatus === "TICKETING_CONCILIADO") continue
        uniqueSales.push({
            id: record.id,
            period: record.period,
            sourceGroup: "CAMPO_MARTE_PRESENCIAL",
            sede: "Campo de Marte",
            channel: "Presencial / sistema legado",
            paidAt: "",
            plan: record.plan,
            quantity: 1,
            gross: record.amount,
            discount: 0,
            net: record.amount,
            attendee: record.attendee,
            document: record.studentId,
            saleCode: record.carnet,
            orderId: "",
            ticketStatus: "REGISTRO_XLS",
            sourceFile: record.file,
            note: `Fila ${record.row}; fecha exacta de venta no disponible en el XLS`,
        })
    }
    for (const record of [...cdmTickets, ...videnaTickets]) {
        uniqueSales.push({
            id: record.id,
            period: record.period,
            sourceGroup: record.sourceGroup,
            sede: record.sede,
            channel: "Ticketing / Izipay",
            paidAt: record.paidAt,
            plan: record.plan,
            quantity: 1,
            gross: record.gross,
            discount: record.discount,
            net: record.net,
            attendee: record.attendee,
            document: record.attendeeDni,
            saleCode: record.ticketCode,
            orderId: record.orderId,
            ticketStatus: record.ticketStatus,
            sourceFile: record.matchedXlsFile,
            note: record.sourceGroup === "TICKETING_CAMPO_MARTE" && record.matchedXlsRecordId
                ? `Conciliado con ${record.matchedXlsCarnet}; se cuenta una sola vez usando el monto pagado en Ticketing`
                : record.sourceGroup === "TICKETING_CAMPO_MARTE"
                    ? "Venta Ticketing no encontrada en los XLS de Campo de Marte"
                    : "Venta pagada de membresia VIDENA",
        })
    }

    uniqueSales.sort((left, right) =>
        String(left.period).localeCompare(String(right.period), "es") ||
        String(left.paidAt).localeCompare(String(right.paidAt), "es") ||
        String(left.sede).localeCompare(String(right.sede), "es") ||
        String(left.attendee).localeCompare(String(right.attendee), "es"),
    )

    const duplicateCarnets = [...new Set(xlsRecords
        .filter((record, index, array) => array.findIndex((other) => other.carnet === record.carnet) !== index)
        .map((record) => record.carnet))]
    const studentAppearances = new Map<string, Set<Period>>()
    for (const record of xlsRecords) {
        if (!record.studentId) continue
        const periods = studentAppearances.get(record.studentId) ?? new Set<Period>()
        periods.add(record.period)
        studentAppearances.set(record.studentId, periods)
    }
    const repeatedStudentsAcrossPeriods = [...studentAppearances.entries()]
        .filter(([, periods]) => periods.size > 1)
        .map(([studentId, periods]) => ({ studentId, periods: [...periods] }))

    const repeatedAttendeesSameOrder = webTickets
        .map((record) => ({ orderId: record.orderId, attendeeKey: normalizedName(record.attendee), attendee: record.attendee, plan: record.plan }))
        .filter((record, index, array) => record.attendeeKey && array.findIndex((other) =>
            other.orderId === record.orderId && other.attendeeKey === record.attendeeKey && normalizedPlan(other.plan) === normalizedPlan(record.plan),
        ) !== index)

    const outputData = {
        metadata: {
            title: "Reporte consolidado de ventas de membresias",
            generatedAt: generatedAt.toISOString(),
            timezone: "America/Lima",
            julyStart: JULY_START.toISOString(),
            augustStart: AUGUST_START.toISOString(),
            sourceDir,
            output: basename(output),
        },
        xlsRecords,
        cdmTickets,
        videnaTickets,
        uniqueSales,
        validations: {
            files: fileValidations,
            database: databaseValidations,
            duplicateCarnets,
            repeatedStudentsAcrossPeriods,
            repeatedAttendeesSameOrder,
        },
    }

    writeFileSync(output, JSON.stringify(outputData, null, 2), "utf8")
    console.log(JSON.stringify({
        output,
        generatedAt: generatedAt.toISOString(),
        xlsRecords: xlsRecords.length,
        cdmTicketingTickets: cdmTickets.length,
        cdmTicketingMatchedInXls: cdmTickets.filter((record) => record.matchedXlsRecordId).length,
        videnaTickets: videnaTickets.length,
        uniqueSales: uniqueSales.length,
    }))
    await prisma.$disconnect()
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
