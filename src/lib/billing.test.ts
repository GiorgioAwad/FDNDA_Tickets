import test from "node:test"
import assert from "node:assert/strict"
import { buildBillingSnapshot, getBillingValidationIssues, type BillingSnapshotInput } from "@/lib/billing"
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
