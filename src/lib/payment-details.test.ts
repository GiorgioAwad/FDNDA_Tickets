import assert from "node:assert/strict"
import test from "node:test"
import { extractOrderPaymentDetails, extractIzipayOperationNumber } from "./payment-details"

test("extrae numero de operacion desde transactions[0].uuid", () => {
    const order = {
        provider: "IZIPAY",
        providerRef: "PAY-REF-LARGO-1234567890",
        providerTransactionId: "1773947481718mmxuizeq0004e0si1ld4oq8j",
        providerResponse: {
            data: {
                transactions: [
                    {
                        uuid: "hmAIEZr49o",
                        paymentMethodType: "YAPE",
                    },
                ],
            },
        },
    }

    const details = extractOrderPaymentDetails(order)

    assert.equal(details.operationNumber, "hmAIEZr49o")
    assert.equal(details.methodCode, "YAPE")
    assert.equal(details.methodLabel, "Yape")
})

test("prefiere referenceNumber corto sobre providerTransactionId largo", () => {
    const longTransactionId = "1773947481718mmxuizeq0004e0si1ld4oq8j"
    const payloadHttp = {
        response: {
            payMethod: "PLIN",
            order: [
                {
                    referenceNumber: "hmAIEZr49o",
                },
            ],
        },
    }

    const operationNumber = extractIzipayOperationNumber({
        providerRef: longTransactionId,
        providerTransactionId: longTransactionId,
        providerResponse: {
            data: {
                payloadHttp: JSON.stringify(payloadHttp),
            },
        },
    })

    assert.equal(operationNumber, "hmAIEZr49o")
})
