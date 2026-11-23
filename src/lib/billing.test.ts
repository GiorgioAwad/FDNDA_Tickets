import test from "node:test"
import assert from "node:assert/strict"
import { buildBillingSnapshot, getBillingValidationIssues, getCheckoutBillingContact, getCheckoutBillingLocation, type BillingSnapshotInput } from "@/lib/billing"
import { billingDataSchema } from "@/lib/validations"

const validBoleta: BillingSnapshotInput = {
    documentType: "BOLETA",
    buyerDocNumber: "48242748",
    buyerAddress: "Av. Simon Bolivar",
    buyerEmail: "cliente@example.com",
    buyerPhone: "928326712",
    buyerUbigeo: "150143",
    buyerFirstName: "Aricely",
    buyerSecondName: "",
    buyerLastNamePaternal: "Trigoso",
    buyerLastNameMaternal: "Sanchez",
}

for (const documentType of ["BOLETA", "FACTURA"] as const) {
    test(`${documentType}: usa correo y celular del registro en lugar del perfil de una compra anterior`, () => {
        const draft = {
            ...validBoleta,
            documentType,
            buyerName: documentType === "FACTURA" ? "Empresa SAC" : "Aricely Trigoso Sanchez",
            buyerDocNumber: documentType === "FACTURA" ? "20123456789" : "48242748",
            buyerEmail: "compra-anterior@example.com",
            buyerPhone: "111222333",
        }
        const billing = {
            ...draft,
            ...getCheckoutBillingContact({ email: "registro@example.com", phone: "987654321" }, draft),
        }
        assert.deepEqual(getBillingValidationIssues(billing), [])
        const snapshot = buildBillingSnapshot(billingDataSchema.parse(billing))
        assert.equal(snapshot.buyerEmail, "registro@example.com")
        assert.equal(snapshot.buyerPhone, "987654321")
    })

    test(`${documentType}: usa la ubicación de registro aunque el cliente envíe otra dirección o ubigeo`, () => {
        const draft = {
            ...validBoleta,
            documentType,
            buyerName: documentType === "FACTURA" ? "Empresa SAC" : "Aricely Trigoso Sanchez",
            buyerDocNumber: documentType === "FACTURA" ? "20123456789" : "48242748",
            buyerAddress: "Dirección antigua que no debe enviarse",
        }
        const billing = {
            ...draft,
            ...getCheckoutBillingLocation({
                departamento: "Arequipa", provincia: "Arequipa", distrito: "Arequipa",
            }, "150143"),
        }
        assert.deepEqual(getBillingValidationIssues(billing), [])
        const snapshot = buildBillingSnapshot(billingDataSchema.parse(billing))
        assert.equal(snapshot.buyerUbigeo, "040101")
        assert.equal(snapshot.buyerAddress, "Arequipa, Arequipa, Arequipa")
        assert.equal(snapshot.documentType, documentType)
        assert.equal(snapshot.buyerDocNumber, billing.buyerDocNumber)
    })
}

test("el contacto del registro no depende de recibir correo o celular del navegador", () => {
    assert.deepEqual(getCheckoutBillingContact({ email: " registro@example.com ", phone: "+51 987-654-321" }), {
        buyerEmail: "registro@example.com", buyerPhone: "51987654321",
    })
})

test("una cuenta sin celular conserva el correo de registro y permite completar solo el celular", () => {
    const contact = getCheckoutBillingContact({ email: "registro@example.com", phone: null }, validBoleta)
    assert.deepEqual(contact, { buyerEmail: "registro@example.com", buyerPhone: validBoleta.buyerPhone })
    assert.deepEqual(getBillingValidationIssues({ ...validBoleta, ...contact }), [])
})

test("si el contacto registrado no es válido permite completar los datos sin inventarlos", () => {
    assert.deepEqual(getCheckoutBillingContact({ email: "inválido", phone: "123" }), { buyerEmail: "", buyerPhone: "" })
    assert.deepEqual(getCheckoutBillingContact(null, { buyerEmail: 123, buyerPhone: {} }), { buyerEmail: "", buyerPhone: "" })
    assert.deepEqual(getCheckoutBillingContact({ email: "inválido", phone: "123" }, validBoleta), {
        buyerEmail: validBoleta.buyerEmail, buyerPhone: validBoleta.buyerPhone,
    })
    const issues = getBillingValidationIssues({ ...validBoleta, ...getCheckoutBillingContact(null) })
    assert.deepEqual(issues.map((issue) => issue.field), ["buyerEmail", "buyerPhone"])
})

test("una cuenta antigua puede comprar seleccionando solo ubicación, sin calle", () => {
    const billing = {
        ...validBoleta,
        buyerName: "Aricely Trigoso Sanchez",
        ...getCheckoutBillingLocation(null, "150143"),
    }
    assert.deepEqual(getBillingValidationIssues(billing), [])
    const snapshot = buildBillingSnapshot(billingDataSchema.parse(billing))
    assert.equal(snapshot.buyerAddress, "Villa Maria Del Triunfo, Lima, Lima")
    assert.equal(snapshot.buyerUbigeo, "150143")
})

test("rechaza ubicación ausente o inexistente en cuentas antiguas", () => {
    for (const ubigeo of [undefined, "", "999999", "1501", 150143]) {
        const billing = {
            ...validBoleta,
            buyerName: "Aricely Trigoso Sanchez",
            ...getCheckoutBillingLocation(null, ubigeo),
        }
        assert.equal(billingDataSchema.safeParse(billing).success, false)
        assert.ok(getBillingValidationIssues(billing).some((issue) => issue.field === "buyerUbigeo"))
    }
})

test("el segundo nombre es opcional para una boleta valida", () => {
    assert.deepEqual(getBillingValidationIssues(validBoleta), [])
})

test("reporta especificamente un correo sin arroba", () => {
    const issues = getBillingValidationIssues({
        ...validBoleta,
        buyerEmail: "trigososanchezgmail.com",
    })

    assert.deepEqual(issues, [
        {
            field: "buyerEmail",
            message: "Ingresa un correo v\u00e1lido, por ejemplo nombre@correo.com.",
        },
    ])
})

for (const [buyerDocType, buyerDocNumber] of [["1", "12345678"], ["6", "20123456789"], ["4", "001234567"], ["7", "ab123456"], ["7", "12345678"]]) {
    test(`boleta valida y conserva el documento SUNAT ${buyerDocType}: ${buyerDocNumber}`, () => {
        const billing = { ...validBoleta, buyerDocType, buyerDocNumber, buyerName: "Aricely Trigoso Sanchez" }
        assert.deepEqual(getBillingValidationIssues(billing), [])
        const parsed = billingDataSchema.safeParse(billing)
        assert.equal(parsed.success, true)
        if (!parsed.success) return
        const snapshot = buildBillingSnapshot(parsed.data)
        assert.equal(snapshot.buyerDocType, buyerDocType)
        assert.equal(snapshot.buyerDocNumber, buyerDocNumber.toUpperCase())
    })
}

test("factura rechaza DNI, C.E. y PAS incluso con numero de 11 digitos", () => {
    for (const buyerDocType of ["1", "4", "7"]) {
        const billing = { ...validBoleta, documentType: "FACTURA" as const, buyerDocType, buyerDocNumber: "20123456789", buyerName: "Empresa SAC" }
        assert.equal(billingDataSchema.safeParse(billing).success, false)
        assert.equal(getBillingValidationIssues(billing)[0]?.field, "buyerDocNumber")
    }
})

test("los clientes anteriores conservan DNI para boleta y RUC para factura", () => {
    for (const documentType of ["BOLETA", "FACTURA"] as const) {
        const billing = { ...validBoleta, documentType, buyerDocNumber: documentType === "BOLETA" ? "12345678" : "20123456789", buyerName: "Empresa SAC" }
        const parsed = billingDataSchema.parse(billing)
        assert.equal(parsed.buyerDocType, documentType === "BOLETA" ? "1" : "6")
        assert.equal(buildBillingSnapshot(billing).buyerDocType, parsed.buyerDocType)
    }
})

test("los documentos invalidos fallan tanto en UI como en el esquema de orden", () => {
    for (const [buyerDocType, buyerDocNumber] of [["1", "AB123456"], ["1", "123456789"], ["6", "12345678"], ["4", "AB1234567"], ["4", "12345678"], ["7", "AB-123456"], ["7", "AB 123456"], ["7", "123"], ["4", "1234567890123"], ["7", "AB1234567890123"], ["9", "12345678"]]) {
        const billing = { ...validBoleta, buyerDocType, buyerDocNumber, buyerName: "Aricely Trigoso Sanchez" }
        assert.equal(billingDataSchema.safeParse(billing).success, false, `${buyerDocType}: ${buyerDocNumber}`)
        assert.equal(getBillingValidationIssues(billing)[0]?.field, "buyerDocNumber")
    }
})
