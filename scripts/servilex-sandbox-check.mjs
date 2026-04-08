import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

function loadEnvFile(fileName) {
    const envPath = path.join(repoRoot, fileName)
    if (!fs.existsSync(envPath)) {
        throw new Error(`No existe ${fileName}`)
    }

    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        if (!line || line.trim().startsWith("#")) continue
        const separatorIndex = line.indexOf("=")
        if (separatorIndex === -1) continue

        const key = line.slice(0, separatorIndex).trim()
        let value = line.slice(separatorIndex + 1).trim()
        value = value.replace(/^"(.*)"$/, "$1")

        if (!(key in process.env)) {
            process.env[key] = value
        }
    }
}

function getArg(name, fallback = null) {
    const index = process.argv.indexOf(name)
    if (index === -1) return fallback
    return process.argv[index + 1] || fallback
}

function hasFlag(name) {
    return process.argv.includes(name)
}

function buildAttendees(count, matriculaPrefix) {
    return Array.from({ length: count }, (_, index) => {
        const numeric = String(index + 1).padStart(3, "0")
        return {
            name: `ALUMNO PRUEBA ${numeric}`,
            dni: `70${String(index + 1).padStart(6, "0")}`,
            matricula: `${matriculaPrefix}${numeric}`,
            scheduleSelections: [
                {
                    date: "2026-04-15",
                    shift: "MANANA",
                },
            ],
        }
    })
}

function buildTicketType(indicator, amount) {
    if (indicator === "OS") {
        return {
            name: "Otros servicios prueba",
            servilexEnabled: true,
            servilexIndicator: "OS",
            servilexSucursalCode: "01",
            servilexServiceCode: "500",
            servilexDisciplineCode: null,
            servilexScheduleCode: null,
            servilexPoolCode: null,
            servilexExtraConfig: {
                cantidad: 1,
                descuento: 0,
            },
            event: {
                id: "sandbox-event",
                startDate: new Date("2026-04-15T12:00:00Z"),
            },
        }
    }

    if (indicator === "PN" || indicator === "PA") {
        return {
            name: `Piscina ${indicator} prueba`,
            servilexEnabled: true,
            servilexIndicator: indicator,
            servilexSucursalCode: "01",
            servilexServiceCode: indicator === "PN" ? "610" : "611",
            servilexDisciplineCode: null,
            servilexScheduleCode: null,
            servilexPoolCode: "01",
            servilexExtraConfig: {
                cantidad: 1,
                horaInicio: "08:00",
                horaFin: "09:00",
                duracion: 1,
            },
            event: {
                id: "sandbox-event",
                startDate: new Date("2026-04-15T12:00:00Z"),
            },
        }
    }

    return {
        name: "Academia prueba",
        servilexEnabled: true,
        servilexIndicator: "AC",
        servilexSucursalCode: "01",
        servilexServiceCode: "082",
        servilexDisciplineCode: "00",
        servilexScheduleCode: "000001",
        servilexPoolCode: "01",
        servilexExtraConfig: {},
        event: {
            id: "sandbox-event",
            startDate: new Date("2026-04-15T12:00:00Z"),
        },
    }
}

async function main() {
    loadEnvFile(getArg("--env", ".env.production"))

    const {
        buildServilexPreviewSources,
        buildServilexPayload,
        getServilexConfig,
        sendServilexInvoice,
    } = await import("../src/lib/servilex.ts")

    const indicator = String(getArg("--indicator", "AC")).toUpperCase()
    const count = Number(getArg("--count", "10"))
    const amount = Number(getArg("--amount", "50"))
    const matriculaPrefix = getArg("--matricula-prefix", "ABIO-TST-")
    const outFile = getArg("--out", path.join("tmp", `servilex-${indicator.toLowerCase()}-payloads.json`))
    const shouldSend = hasFlag("--send")

    if (!Number.isInteger(count) || count <= 0) {
        throw new Error("--count debe ser un entero mayor que 0")
    }

    const ticketType = buildTicketType(indicator, amount)
    const order = {
        id: `sandbox-${indicator.toLowerCase()}-${Date.now()}`,
        provider: "IZIPAY",
        providerRef: `sandbox-ref-${Date.now()}`,
        providerResponse: {
            transactionDetails: {
                paymentMethod: "CARD",
                cardBrand: "VISA",
            },
        },
        documentType: "BOLETA",
        buyerDocType: "1",
        buyerDocNumber: "12345678",
        buyerName: "USUARIO PRUEBA",
        buyerFirstName: "USUARIO",
        buyerSecondName: "DE",
        buyerLastNamePaternal: "PRUEBA",
        buyerLastNameMaternal: "FDNDA",
        buyerAddress: "JR. PRUEBA 123 LIMA",
        buyerUbigeo: "150101",
        buyerEmail: "qa-fdnda@example.com",
        buyerPhone: "999999999",
        currency: "PEN",
        totalAmount: Number((count * amount).toFixed(2)),
        paidAt: new Date(),
        createdAt: new Date(),
        user: {
            email: "qa-fdnda@example.com",
        },
        orderItems: [
            {
                quantity: count,
                unitPrice: amount,
                attendeeData: indicator === "AC" ? buildAttendees(count, matriculaPrefix) : [],
                ticketType,
            },
        ],
    }

    const config = getServilexConfig()
    const sources = buildServilexPreviewSources(order, `sandbox-${indicator.toLowerCase()}`)
    const payloads = sources.map((source) => buildServilexPayload(source, config))

    fs.mkdirSync(path.dirname(path.join(repoRoot, outFile)), { recursive: true })
    fs.writeFileSync(
        path.join(repoRoot, outFile),
        JSON.stringify(
            {
                endpoint: config.endpoint,
                count: payloads.length,
                indicator,
                payloads,
            },
            null,
            2
        )
    )

    console.log(`Payloads generados: ${payloads.length}`)
    console.log(`Archivo: ${path.join(repoRoot, outFile)}`)
    console.log(`Endpoint: ${config.endpoint}`)

    if (!shouldSend) {
        console.log("Modo dry-run: no se envio nada al endpoint.")
        return
    }

    const results = []

    for (const [index, payload] of payloads.entries()) {
        const response = await sendServilexInvoice(payload, config)
        results.push({
            index: index + 1,
            ok: response.ok,
            status: response.status,
            errorCode: response.errorCode || null,
            errorMessage: response.errorMessage || null,
            invoiceNumber: response.invoiceNumber || null,
            reciboHash: response.reciboHash || null,
        })
    }

    console.log(JSON.stringify({ results }, null, 2))
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
