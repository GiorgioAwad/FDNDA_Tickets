import assert from "node:assert/strict"
import test from "node:test"
import { getIdentityDocumentError, isIdentityDocumentType, resolveBuyerDocType, sanitizeIdentityDocumentNumber } from "./identity-document"
import { resolveIzipayDocument } from "./izipay-config"

test("el registro acepta los cuatro documentos y rechaza tipos desconocidos", () => {
    for (const [type, number] of [["1", "00123456"], ["6", "20123456789"], ["4", "001234567"], ["7", "AB123456"]]) {
        assert.equal(getIdentityDocumentError(type, number), null)
    }
    assert.ok(getIdentityDocumentError("7", "AB-123456"))
    assert.ok(getIdentityDocumentError("4", "AB1234567"))
    for (const type of ["constructor", "toString", "__proto__", "9", 4, null]) {
        assert.equal(isIdentityDocumentType(type), false)
        assert.ok(getIdentityDocumentError(type, "12345678"))
    }
})

test("normaliza pasaporte sin perder letras ni ceros iniciales de otros documentos", () => {
    assert.equal(sanitizeIdentityDocumentNumber("7", "ab123456"), "AB123456")
    assert.equal(sanitizeIdentityDocumentNumber("4", "001234567"), "001234567")
    assert.equal(resolveBuyerDocType("FACTURA", "7"), "6")
    assert.equal(resolveBuyerDocType("BOLETA", "7"), "7")
    assert.equal(resolveBuyerDocType("BOLETA"), "1")
})

test("Izipay conserva PAS aunque sea numerico y CE aunque tenga 11 digitos", () => {
    assert.deepEqual(resolveIzipayDocument("7", "12345678"), { documentType: "PASAPORTE", document: "12345678" })
    assert.deepEqual(resolveIzipayDocument("7", "00123456789"), { documentType: "PASAPORTE", document: "00123456789" })
    assert.deepEqual(resolveIzipayDocument("4", "00123456789"), { documentType: "CE", document: "00123456789" })
    assert.deepEqual(resolveIzipayDocument("6", "20123456789"), { documentType: "RUC", document: "20123456789" })
    assert.deepEqual(resolveIzipayDocument("1", "00123456"), { documentType: "DNI", document: "00123456" })
})
