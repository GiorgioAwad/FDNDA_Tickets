import test from "node:test"
import assert from "node:assert/strict"
import { getBillingValidationIssues, type BillingSnapshotInput } from "@/lib/billing"

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
