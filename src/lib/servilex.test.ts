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
    overrides: Partial<NonNullable<ServilexSourceOrder["orderItems"][number]["ticketType"]>> = {}
): NonNullable<ServilexSourceOrder["orderItems"][number]["ticketType"]> {
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
            category: indicator === "AC"
                ? "ACADEMIA"
                : indicator === "PN" || indicator === "PA"
                  ? "PISCINA_LIBRE"
                  : "EVENTO",
            servilexSucursalCode: "01",
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
        assert.equal(payload.cabecera.tipoTributo, "9998")
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
    assert.equal(payload.cabecera.tipoTributo, "1000")
    assert.deepEqual(Object.keys(detalle).sort(), ["cantidad", "descuento", "precio", "servicio"])
    // ABIO calcula total de linea = cantidad x precio (precio = valor unitario).
    // `precio` ya es el monto completo asignado, asi que cantidad debe ser 1
    // para que ABIO totalice 1 x 40 = 40 (no 2 x 40 = 80).
    assert.equal(detalle.cantidad, 1)
    assert.equal(detalle.precio, 40)
    assert.equal(detalle.descuento, 5)
    assert.equal(payload.cabecera.total, 40)
    assert.equal(payload.cobranza.totalPago, 40)
})

test("OS genera un comprobante separado por cada item del mismo servicio", () => {
    const order = buildOrder({
        totalAmount: 23,
        orderItems: [
            {
                id: "item-1",
                quantity: 1,
                unitPrice: 6,
                attendeeData: [],
                ticketType: buildTicketType("OS", {
                    servilexServiceCode: "B06",
                }),
            },
            {
                id: "item-2",
                quantity: 1,
                unitPrice: 5,
                attendeeData: [],
                ticketType: buildTicketType("OS", {
                    servilexServiceCode: "B06",
                }),
            },
            {
                id: "item-3",
                quantity: 1,
                unitPrice: 12,
                attendeeData: [],
                ticketType: buildTicketType("OS", {
                    servilexServiceCode: "B06",
                }),
            },
        ],
    })

    const sources = buildServilexPreviewSources(order, "os-split-preview")
    const payloads = sources.map((source) => buildServilexPayload(source, TEST_CONFIG))

    assert.equal(sources.length, 3)
    assert.deepEqual(
        sources.map((source) => source.servilexGroupKey),
        [
            "OS:01:item:item-1:1",
            "OS:01:item:item-2:1",
            "OS:01:item:item-3:1",
        ]
    )
    assert.deepEqual(payloads.map((payload) => payload.detalle.length), [1, 1, 1])
    assert.deepEqual(payloads.map((payload) => payload.cabecera.total), [6, 5, 12])
    assert.deepEqual(payloads.map((payload) => payload.cobranza.totalPago), [6, 5, 12])
    assert.equal(
        payloads.reduce((sum, payload) => sum + payload.cabecera.total, 0),
        23
    )
})

test("rechaza snapshot persistido con multiples detalles", () => {
    const order = buildOrder({
        totalAmount: 23,
        orderItems: [
            {
                quantity: 3,
                unitPrice: 23 / 3,
                attendeeData: [],
                ticketType: buildTicketType("OS", {
                    servilexServiceCode: "B06",
                }),
            },
        ],
    })

    const staleSnapshot = {
        indicator: "OS",
        sucursal: "01",
        eventCategory: "EVENTO",
        groupType: "INDICATOR",
        groupKey: "OS:01",
        groupLabel: "OS-01",
        assignedTotal: 23,
        alumno: null,
        detalle: [
            { servicio: "B06", cantidad: 1, descuento: 0, precio: 6 },
            { servicio: "B06", cantidad: 1, descuento: 0, precio: 5 },
            { servicio: "B06", cantidad: 1, descuento: 0, precio: 12 },
        ],
    }

    const source = {
        id: "stale-1",
        orderId: order.id ?? "order-1",
        traceId: null,
        invoiceNumber: null,
        servilexIndicator: "OS",
        servilexGroupKey: "OS:01",
        servilexGroupLabel: "OS-01",
        servilexAssignedTotal: 23,
        servilexSucursalCode: "01",
        alumnoSnapshot: null,
        servilexPayloadSnapshot: staleSnapshot,
        order,
    }

    assert.throws(
        () => buildServilexPayload(source, TEST_CONFIG),
        /ABIO requiere un comprobante por item/
    )
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

    assert.match(rawPayload, /"nroOperacion":"pay-123"/)
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

test("incluye nroOperacion desde transactions[0].uuid de Izipay", () => {
    const order = buildOrder({
        totalAmount: 15,
        providerRef: "PAY-REF-LARGO-1234567890",
        providerTransactionId: "1773947481718mmxuizeq0004e0si1ld4oq8j",
        providerResponse: {
            source: "query",
            receivedAt: "2026-04-28T20:00:00Z",
            data: {
                transactions: [
                    {
                        uuid: "hmAIEZr49o",
                        paymentMethodType: "CARD",
                        brand: "VISA",
                    },
                ],
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

    const [source] = buildServilexPreviewSources(order, "operation-uuid-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cobranza.nroOperacion, "hmAIEZr49o")
})

test("prefiere referenceNumber real sobre providerTransactionId largo", () => {
    const longTransactionId = "1773947481718mmxuizeq0004e0si1ld4oq8j"
    const payloadHttp = {
        response: {
            payMethod: "CARD",
            order: [
                {
                    referenceNumber: "hmAIEZr49o",
                },
            ],
            card: {
                brand: "VISA",
            },
        },
    }

    const order = buildOrder({
        totalAmount: 15,
        providerRef: longTransactionId,
        providerTransactionId: longTransactionId,
        providerResponse: {
            source: "validate",
            receivedAt: "2026-04-28T20:00:00Z",
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

    const [source] = buildServilexPreviewSources(order, "operation-reference-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cobranza.nroOperacion, "hmAIEZr49o")
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

test("usa la sucursal ABIO del evento antes que la del tipo de entrada", () => {
    const order = buildOrder({
        totalAmount: 25,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 25,
                attendeeData: [],
                ticketType: buildTicketType("OS", {
                    servilexSucursalCode: "01",
                    event: {
                        id: "event-trujillo",
                        startDate: new Date("2026-04-01T12:00:00Z"),
                        servilexSucursalCode: "02",
                    },
                }),
            },
        ],
    })

    const [snapshot] = buildServilexInvoiceSnapshots(order)
    const [source] = buildServilexPreviewSources(order, "event-sucursal-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(snapshot.sucursal, "02")
    assert.equal(snapshot.groupKey, "OS:02")
    assert.equal(payload.cabecera.sucursal, "02")
})

test("usa serie BW para boletas de academia con la sucursal", () => {
    const order = buildOrder({
        totalAmount: 25,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 25,
                attendeeData: [
                    { name: "Alumno BW", dni: "12345678", matricula: "MAT-BW" },
                ],
                ticketType: buildTicketType("AC", {
                    event: {
                        id: "academia-sucursal-2",
                        startDate: new Date("2026-04-01T12:00:00Z"),
                        category: "ACADEMIA",
                        servilexSucursalCode: "02",
                    },
                }),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "academia-bw-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cabecera.comprobante.serie, "BW02")
})

test("usa serie FW para facturas de academia con la sucursal", () => {
    const order = buildOrder({
        documentType: "FACTURA",
        buyerDocType: "6",
        buyerDocNumber: "20123456789",
        totalAmount: 25,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 25,
                attendeeData: [
                    { name: "Alumno FW", dni: "12345678", matricula: "MAT-FW" },
                ],
                ticketType: buildTicketType("AC", {
                    event: {
                        id: "academia-sucursal-3",
                        startDate: new Date("2026-04-01T12:00:00Z"),
                        category: "ACADEMIA",
                        servilexSucursalCode: "03",
                    },
                }),
            },
        ],
    })

    const [source] = buildServilexPreviewSources(order, "academia-fw-preview")
    const payload = buildServilexPayload(source, TEST_CONFIG)

    assert.equal(payload.cabecera.comprobante.serie, "FW03")
})

test("usa series BW y FW para piscina libre con la sucursal", () => {
    const ticketType = buildTicketType("PN", {
        event: {
            id: "piscina-sucursal-4",
            startDate: new Date("2026-04-01T12:00:00Z"),
            category: "PISCINA_LIBRE",
            servilexSucursalCode: "04",
        },
        servilexExtraConfig: {
            cantidad: 1,
            horaInicio: "08:00",
            horaFin: "09:00",
            duracion: 1,
        },
    })
    const baseOrder = {
        totalAmount: 30,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 30,
                attendeeData: [],
                ticketType,
            },
        ],
    }

    const [boletaSource] = buildServilexPreviewSources(buildOrder(baseOrder), "piscina-bw-preview")
    const [facturaSource] = buildServilexPreviewSources(
        buildOrder({
            ...baseOrder,
            documentType: "FACTURA",
            buyerDocType: "6",
            buyerDocNumber: "20123456789",
        }),
        "piscina-fw-preview"
    )

    assert.equal(buildServilexPayload(boletaSource, TEST_CONFIG).cabecera.comprobante.serie, "BW04")
    assert.equal(buildServilexPayload(facturaSource, TEST_CONFIG).cabecera.comprobante.serie, "FW04")
})

test("usa series BA y FA para eventos con la sucursal", () => {
    const ticketType = buildTicketType("OS", {
        event: {
            id: "evento-sucursal-5",
            startDate: new Date("2026-04-01T12:00:00Z"),
            category: "EVENTO",
            servilexSucursalCode: "05",
        },
    })
    const baseOrder = {
        totalAmount: 40,
        orderItems: [
            {
                quantity: 1,
                unitPrice: 40,
                attendeeData: [],
                ticketType,
            },
        ],
    }

    const [boletaSource] = buildServilexPreviewSources(buildOrder(baseOrder), "evento-ba-preview")
    const [facturaSource] = buildServilexPreviewSources(
        buildOrder({
            ...baseOrder,
            documentType: "FACTURA",
            buyerDocType: "6",
            buyerDocNumber: "20123456789",
        }),
        "evento-factura-preview"
    )

    assert.equal(buildServilexPayload(boletaSource, TEST_CONFIG).cabecera.comprobante.serie, "BA05")
    assert.equal(buildServilexPayload(facturaSource, TEST_CONFIG).cabecera.comprobante.serie, "FA05")
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
        assert.equal(payload.cabecera.tipoTributo, "9998")
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

function buildMerchVariant(overrides: {
    codigo: string
    indicador?: string
    sede?: string | null
    size?: string | null
    productName?: string
}): NonNullable<NonNullable<ServilexSourceOrder["orderItems"][number]>["merchVariant"]> {
    return {
        id: `var-${overrides.codigo}-${overrides.size ?? "uni"}`,
        size: overrides.size ?? null,
        product: {
            id: `prod-${overrides.codigo}`,
            name: overrides.productName ?? `Polera ${overrides.codigo}`,
            servilexService: {
                id: `svc-${overrides.codigo}`,
                codigo: overrides.codigo,
                indicador: overrides.indicador ?? "OS",
                sede: overrides.sede ?? "LIMA",
            },
        },
    }
}

test("merch: emite un comprobante OS por cada unidad y excluye el envio del apportionment", () => {
    const order = buildOrder({
        // Total real = 2 poleras × 80 + 1 gorra × 50 + envio 10 = 220 (con envío)
        totalAmount: 220,
        orderItems: [
            {
                id: "merch-item-1",
                quantity: 2,
                unitPrice: 80,
                attendeeData: [],
                ticketType: null,
                merchVariant: buildMerchVariant({ codigo: "TPOL08", size: "M" }),
            },
            {
                id: "merch-item-2",
                quantity: 1,
                unitPrice: 50,
                attendeeData: [],
                ticketType: null,
                merchVariant: buildMerchVariant({ codigo: "TGOR01", size: null, productName: "Gorra" }),
            },
        ],
    })

    const sources = buildServilexPreviewSources(order, "merch-preview")
    const payloads = sources.map((source) => buildServilexPayload(source, TEST_CONFIG))

    // 3 unidades (2 + 1) => 3 comprobantes
    assert.equal(sources.length, 3)
    assert.equal(payloads.length, 3)

    // Cada payload tiene exactamente 1 detalle (ABIO requiere 1 detalle por comprobante)
    assert.deepEqual(payloads.map((p) => p.detalle.length), [1, 1, 1])

    // Indicador OS y tipoTributo 1000 para todos
    assert.deepEqual(payloads.map((p) => p.cabecera.indicador), ["OS", "OS", "OS"])
    assert.deepEqual(payloads.map((p) => p.cabecera.tipoTributo), ["1000", "1000", "1000"])

    // Totales por comprobante = precio unitario (envio NO entra)
    assert.deepEqual(payloads.map((p) => p.cabecera.total), [80, 80, 50])
    assert.deepEqual(payloads.map((p) => p.cobranza.totalPago), [80, 80, 50])

    // Suma total Servilex = subtotal de items merch elegibles (sin envío)
    assert.equal(
        payloads.reduce((sum, p) => sum + p.cabecera.total, 0),
        210
    )

    // Detalle usa el codigo del ServilexService como "servicio"
    const detalles = payloads.map((p) => p.detalle[0] as unknown as Record<string, unknown>)
    assert.deepEqual(detalles.map((d) => d.servicio), ["TPOL08", "TPOL08", "TGOR01"])
    assert.deepEqual(detalles.map((d) => d.cantidad), [1, 1, 1])
    assert.deepEqual(detalles.map((d) => d.descuento), [0, 0, 0])
})

test("merch: rechaza ordenes que mezclan productos con y sin servilexService", () => {
    const order = buildOrder({
        totalAmount: 130,
        orderItems: [
            {
                id: "merch-with",
                quantity: 1,
                unitPrice: 80,
                attendeeData: [],
                ticketType: null,
                merchVariant: buildMerchVariant({ codigo: "TPOL08" }),
            },
            {
                id: "merch-without",
                quantity: 1,
                unitPrice: 50,
                attendeeData: [],
                ticketType: null,
                merchVariant: {
                    id: "var-no-srv",
                    size: null,
                    product: {
                        id: "prod-no-srv",
                        name: "Pin sin Servilex",
                        servilexService: null,
                    },
                },
            },
        ],
    })

    assert.throws(
        () => buildServilexInvoiceSnapshots(order),
        /merch mezcla productos con y sin Servilex/
    )
})

test("merch: rechaza ordenes que mezclan tickets y merch en Servilex", () => {
    const order = buildOrder({
        totalAmount: 150,
        orderItems: [
            {
                id: "ticket-item",
                quantity: 1,
                unitPrice: 70,
                attendeeData: [],
                ticketType: buildTicketType("OS"),
            },
            {
                id: "merch-item",
                quantity: 1,
                unitPrice: 80,
                attendeeData: [],
                ticketType: null,
                merchVariant: buildMerchVariant({ codigo: "TPOL08" }),
            },
        ],
    })

    assert.throws(
        () => buildServilexInvoiceSnapshots(order),
        /mezcla tickets y merch/
    )
})

test("merch: rechaza servicio Servilex con indicador distinto de OS", () => {
    const order = buildOrder({
        totalAmount: 80,
        orderItems: [
            {
                id: "merch-bad-indicator",
                quantity: 1,
                unitPrice: 80,
                attendeeData: [],
                ticketType: null,
                merchVariant: buildMerchVariant({ codigo: "ACSVC", indicador: "AC" }),
            },
        ],
    })

    assert.throws(
        () => buildServilexInvoiceSnapshots(order),
        /se esperaba OS/
    )
})
