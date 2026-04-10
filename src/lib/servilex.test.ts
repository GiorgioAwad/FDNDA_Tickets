import assert from "node:assert/strict"
import test from "node:test"
import {
    buildServilexInvoiceSnapshots,
    buildServilexPayload,
    buildServilexPreviewSources,
    formatServilexJsonForDisplay,
    getServilexConfig,
    sendServilexInvoice,
    stringifyServilexJson,
    type ServilexConfig,
    type ServilexIndicator,
    type ServilexSourceOrder,
} from "./servilex"

const TEST_CONFIG: ServilexConfig = {
    enabled: true,
    endpoint: "https://abio.example.test/invoice",
    token: "test-token",
    empresa: "FPDN",
    usuario: "tester",
    password: "secret",
    terminal: "cajaweb",
    codigoEmp: "001",
    sucursal: "01",
    serieBoleta: "B001",
    serieFactura: "F001",
    formaPago: "006",
    tarjetaTipo: "VISA",
    tarjetaProcedencia: "N",
    condicionPago: "01",
    tipoTributo: "9998",
    referencia: "-",
    tipoRegistro: "2",
    ejecutivo: "WEB",
    maxRetries: 3,
}

function buildTicketType(
    indicator: ServilexIndicator,
    overrides: Partial<ServilexSourceOrder["orderItems"][number]["ticketType"]> = {}
): ServilexSourceOrder["orderItems"][number]["ticketType"] {
    return {
        name: `${indicator} test`,
        servilexEnabled: true,
        servilexIndicator: indicator,
        servilexSucursalCode: "01",
        servilexServiceCode: indicator === "OS" ? "500" : indicator === "PN" ? "610" : indicator === "PA" ? "611" : "082",
        servilexDisciplineCode: "00",
        servilexScheduleCode: "000001",
        servilexPoolCode: "01",
        servilexExtraConfig: {},
        event: {
            id: "event-1",
            startDate: new Date("2026-04-01T12:00:00Z"),
        },
        ...overrides,
    }
}

function buildOrder(
    overrides: Partial<ServilexSourceOrder> = {}
): ServilexSourceOrder {
    return {
        id: "order-1",
        provider: "IZIPAY",
        providerRef: "pay-123",
        providerResponse: {
            transactionDetails: {
                paymentMethod: "CARD",
                cardBrand: "VISA",
            },
        },
        documentType: "BOLETA",
        buyerDocType: "1",
        buyerDocNumber: "12345678",
        buyerName: "COMPRADOR DE PRUEBA",
        buyerFirstName: "COMPRADOR",
        buyerSecondName: "DE",
        buyerLastNamePaternal: "PRUEBA",
        buyerLastNameMaternal: "TEST",
        buyerAddress: "JR PRUEBA 123",
        buyerUbigeo: "150101",
        buyerEmail: "buyer@example.com",
        buyerPhone: "999888777",
        currency: "PEN",
        totalAmount: 100,
        paidAt: new Date("2026-04-06T15:00:00Z"),
        createdAt: new Date("2026-04-06T14:00:00Z"),
        user: {
            email: "buyer@example.com",
        },
        orderItems: [],
        ...overrides,
    }
}

test("AC genera un comprobante por alumno y payload v1.2 sin campos legacy", () => {
    const order = buildOrder({
        totalAmount: 299.99,
        orderItems: [
            {
                quantity: 3,
                unitPrice: 100,
                attendeeData: [
                    { name: "Alumno Uno", dni: "12345678", matricula: "MAT-001" },
                    { name: "Alumno Dos", dni: "87654321", matricula: "MAT-002" },
                    { name: "Alumno Tres", dni: "45671234", matricula: "MAT-003" },
                ],
                ticketType: buildTicketType("AC"),
            },
        ],
    })

    const snapshots = buildServilexInvoiceSnapshots(order)
    const sources = buildServilexPreviewSources(order, "ac-preview")

    assert.equal(snapshots.length, 3)
    assert.equal(sources.length, 3)
    assert.equal(
        snapshots.reduce((sum, snapshot) => sum + snapshot.assignedTotal, 0),
        299.99
    )

    for (const source of sources) {
        const payload = buildServilexPayload(source, TEST_CONFIG)

        assert.deepEqual(Object.keys(payload).sort(), ["cabecera", "cobranza", "detalle", "meta"])
        assert.equal(Object.hasOwn(payload, "seguridad"), false)
        assert.equal(Object.hasOwn(payload.meta, "hash"), false)
        assert.equal(Object.hasOwn(payload.cabecera.comprobante, "numero"), false)
        assert.equal(payload.cabecera.indicador, "AC")
        assert.ok(payload.cabecera.alumno)
        assert.equal(payload.detalle.length, 1)
        assert.equal(payload.cabecera.total, payload.cobranza.totalPago)
    }
})

test("OS genera detalle con servicio, cantidad, descuento y precio", () => {
    const order = buildOrder({
        totalAmount: 40,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 40,
                attendeeData: [],
                ticketType: buildTicketType("OS", {
                    servilexExtraConfig: {
                        cantidad: 2,
                        descuento: 5,
                    },
                }),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "os-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)
    const detalle = payload.detalle[0] as unknown as Record<string, unknown>

    assert.equal(payload.cabecera.indicador, "OS")
    assert.deepEqual(Object.keys(detalle).sort(), ["cantidad", "descuento", "precio", "servicio"])
    assert.equal(detalle.cantidad, 2)
    assert.equal(detalle.descuento, 5)
})

test("serializa montos Servilex con dos decimales en el JSON final", () => {
    const order = buildOrder({
        totalAmount: 1,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 1,
                attendeeData: [
                    { name: "Alumno Decimal", dni: "12345678", matricula: "MAT-DEC" },
                ],
                ticketType: buildTicketType("AC"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "decimal-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)
    const rawPayload = stringifyServilexJson(payload)

    assert.match(rawPayload, /"total":1\.00/)
    assert.match(rawPayload, /"precio":1\.00/)
    assert.match(rawPayload, /"totalPago":1\.00/)
})

test("formatea payload Servilex para display con decimales visibles", () => {
    const order = buildOrder({
        totalAmount: 1,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 1,
                attendeeData: [
                    { name: "Alumno Display", dni: "12345678", matricula: "MAT-DISPLAY" },
                ],
                ticketType: buildTicketType("AC"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "display-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)
    const display = formatServilexJsonForDisplay(payload) as Record<string, unknown>
    const cabecera = display.cabecera as Record<string, unknown>
    const detalle = (display.detalle as Array<Record<string, unknown>>)[0]
    const cobranza = display.cobranza as Record<string, unknown>

    assert.equal(cabecera.total, "1.00")
    assert.equal(detalle.precio, "1.00")
    assert.equal(cobranza.totalPago, "1.00")
})

test("lee la marca real de tarjeta desde providerResponse envuelto de Izipay", () => {
    const payloadHttp = {
        response: {
            payMethod: "CARD",
            card: {
                brand: "MASTERCARD",
            },
        },
    }

    const order = buildOrder({
        totalAmount: 15,
        providerResponse: {
            source: "validate",
            receivedAt: "2026-04-08T20:00:00Z",
            data: {
                payloadHttp: JSON.stringify(payloadHttp),
            },
        },
        orderItems: [
            {
                quantity: 1,
                unitPrice: 15,
                attendeeData: [],
                ticketType: buildTicketType("OS"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "mastercard-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cobranza.tarjetaTipo, "MASTERCARD")
    assert.equal(payload.cobranza.formaPago, "006")
})

test("normaliza AE de Izipay a AMEX para ABIO", () => {
    const payloadHttp = {
        response: {
            payMethod: "CARD",
            card: {
                brand: "AE",
            },
        },
    }

    const order = buildOrder({
        totalAmount: 15,
        providerResponse: {
            source: "validate",
            receivedAt: "2026-04-08T20:00:00Z",
            data: {
                payloadHttp: JSON.stringify(payloadHttp),
            },
        },
        orderItems: [
            {
                quantity: 1,
                unitPrice: 15,
                attendeeData: [],
                ticketType: buildTicketType("OS"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "amex-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cobranza.tarjetaTipo, "AMEX")
})

test("normaliza DN de Izipay a DINERS para ABIO", () => {
    const payloadHttp = {
        response: {
            payMethod: "CARD",
            card: {
                brand: "DN",
            },
        },
    }

    const order = buildOrder({
        totalAmount: 15,
        providerResponse: {
            source: "validate",
            receivedAt: "2026-04-08T20:00:00Z",
            data: {
                payloadHttp: JSON.stringify(payloadHttp),
            },
        },
        orderItems: [
            {
                quantity: 1,
                unitPrice: 15,
                attendeeData: [],
                ticketType: buildTicketType("OS"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "diners-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cobranza.tarjetaTipo, "DINERS")
})

test("normaliza MC de Izipay a MASTERCARD para ABIO", () => {
    const payloadHttp = {
        response: {
            payMethod: "CARD",
            card: {
                brand: "MC",
            },
        },
    }

    const order = buildOrder({
        totalAmount: 15,
        providerResponse: {
            source: "validate",
            receivedAt: "2026-04-08T20:00:00Z",
            data: {
                payloadHttp: JSON.stringify(payloadHttp),
            },
        },
        orderItems: [
            {
                quantity: 1,
                unitPrice: 15,
                attendeeData: [],
                ticketType: buildTicketType("OS"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "mc-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cobranza.tarjetaTipo, "MASTERCARD")
})

test("AC usa nombres estructurados y codigoReferencia maximo de 6 caracteres", () => {
    const order = buildOrder({
        providerRef: "PAY-REF-ABC123456",
        totalAmount: 1,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 1,
                attendeeData: [
                    {
                        firstName: "Gabriel",
                        secondName: "Andres",
                        lastNamePaternal: "Muñoz",
                        lastNameMaternal: "Ramirez",
                        dni: "12345678",
                        matricula: "0000007",
                    },
                ],
                ticketType: buildTicketType("AC", {
                    servilexServiceCode: "415",
                }),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "structured-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cabecera.entidad.codigoReferencia, "123456")
    assert.equal(payload.cabecera.alumno?.codigoReferencia, "000007")
    assert.equal(payload.cabecera.alumno?.primerNombre, "Gabriel")
    assert.equal(payload.cabecera.alumno?.segundoNombre, "Andres")
    assert.equal(payload.cabecera.alumno?.apellidoPaterno, "Muñoz")
    assert.equal(payload.cabecera.alumno?.apellidoMaterno, "Ramirez")
})

test("getServilexConfig usa ejecutivo 0020 por defecto", () => {
    const previous = process.env.SERVILEX_EJECUTIVO
    delete process.env.SERVILEX_EJECUTIVO

    try {
        assert.equal(getServilexConfig().ejecutivo, "0020")
    } finally {
        if (previous === undefined) {
            delete process.env.SERVILEX_EJECUTIVO
        } else {
            process.env.SERVILEX_EJECUTIVO = previous
        }
    }
})

for (const indicator of ["PN", "PA"] as const) {
    test(`${indicator} genera detalle de piscina libre con horarios`, () => {
        const order = buildOrder({
            totalAmount: 55,
            orderItems: [
                {
                    quantity: 1,
                    unitPrice: 55,
                    attendeeData: [],
                    ticketType: buildTicketType(indicator, {
                        servilexExtraConfig: {
                            cantidad: 1,
                            horaInicio: "08:00",
                            horaFin: "09:30",
                            duracion: 1.5,
                        },
                    }),
                },
            ],
        })

        const [source] = buildServilexPreviewSources(order, `${indicator.toLowerCase()}-preview`)
        const payload = buildServilexPayload(source, TEST_CONFIG)
        const detalle = payload.detalle[0] as unknown as Record<string, unknown>

        assert.equal(payload.cabecera.indicador, indicator)
        assert.deepEqual(
            Object.keys(detalle).sort(),
            ["cantidad", "duracion", "horaFin", "horaInicio", "piscina", "precio", "servicio"]
        )
        assert.equal(detalle.horaInicio, "08:00")
        assert.equal(detalle.horaFin, "09:30")
    })
}

test("rechaza ordenes que mezclan items ABIO y no ABIO", () => {
    const order = buildOrder({
        orderItems: [
            {
                quantity: 1,
                unitPrice: 30,
                attendeeData: [],
                ticketType: buildTicketType("OS"),
            },
            {
                quantity: 1,
                unitPrice: 20,
                attendeeData: [],
                ticketType: {
                    ...buildTicketType("OS"),
                    name: "Ticket comun",
                    servilexEnabled: false,
                },
            },
        ],
    })

    assert.throws(
        () => buildServilexInvoiceSnapshots(order),
        /mezcla items con y sin Servilex/
    )
})

test("sendServilexInvoice trata DUPLICATE_TRACE como idempotente", async (t) => {
    const order = buildOrder({
        totalAmount: 25,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 25,
                attendeeData: [],
                ticketType: buildTicketType("OS"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "duplicate-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)
    const originalFetch = global.fetch

    global.fetch = async () =>
        new Response(
            JSON.stringify({
                error: {
                    codigo: "DUPLICATE_TRACE",
                    mensaje: "trace repetido",
                },
            }),
            {
                status: 409,
                headers: { "Content-Type": "application/json" },
            }
        )

    t.after(() => {
        global.fetch = originalFetch
    })

    const result = await sendServilexInvoice(payload, TEST_CONFIG)

    assert.equal(result.ok, true)
    assert.equal(result.errorCode, "DUPLICATE_TRACE")
    assert.match(result.rawPayload, /"total":25\.00/)
    assert.match(result.rawPayload, /"precio":25\.00/)
    assert.match(result.rawPayload, /"totalPago":25\.00/)
})

test("sendServilexInvoice envia JSON UTF-8 con charset explicito", async (t) => {
    const order = buildOrder({
        providerRef: "REF-UTF8-123456",
        buyerName: "Jhoansen Gabriel Muñoz Ramirez",
        buyerFirstName: "Jhoansen",
        buyerSecondName: "Gabriel",
        buyerLastNamePaternal: "Muñoz",
        buyerLastNameMaternal: "Ramirez",
        buyerAddress: "Av. Universitaria 2011, San Miguel, Lima, Perú",
        totalAmount: 1,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 1,
                attendeeData: [
                    {
                        firstName: "Gabriel",
                        secondName: "Andres",
                        lastNamePaternal: "Muñoz",
                        lastNameMaternal: "Ramirez",
                        dni: "12345678",
                        matricula: "0000007",
                    },
                ],
                ticketType: buildTicketType("AC"),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "utf8-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)
    const originalFetch = global.fetch
    let capturedInit: RequestInit | undefined

    global.fetch = async (_input, init) => {
        capturedInit = init
        return new Response(
            JSON.stringify({
                meta: { status: "success" },
                data: { mensaje: "ok" },
            }),
            {
                status: 201,
                headers: { "Content-Type": "application/json" },
            }
        )
    }

    t.after(() => {
        global.fetch = originalFetch
    })

    const result = await sendServilexInvoice(payload, TEST_CONFIG)
    const headers = capturedInit?.headers as Record<string, string>
    const body = capturedInit?.body as Buffer

    assert.equal(result.ok, true)
    assert.equal(headers["Content-Type"], "application/json; charset=utf-8")
    assert.equal(body.toString("utf8"), result.rawPayload)
    assert.match(result.rawPayload, /Muñoz/)
    assert.match(result.rawPayload, /Perú/)
    const parsedPayload = JSON.parse(result.rawPayload) as Record<string, unknown>
    const cabecera = parsedPayload.cabecera as Record<string, unknown>
    const entidad = cabecera.entidad as Record<string, unknown>
    assert.equal(entidad.apellidoPaterno, "Muñoz")
    assert.equal(entidad.direccion, "Av. Universitaria 2011, San Miguel, Lima, Perú")
})

test("stringifyServilexJson preserva fechas y evita objetos vacios para Date", () => {
    const raw = stringifyServilexJson({
        paidAt: new Date("2026-04-10T18:09:20Z"),
    })

    assert.match(raw, /"paidAt":"2026-04-10T18:09:20\.000Z"/)
})
