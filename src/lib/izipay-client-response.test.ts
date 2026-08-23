import test from "node:test"
import assert from "node:assert/strict"
import { isIzipayUserCancellationMessage } from "@/lib/izipay-client-response"

test("detecta el cierre del formulario reportado por Izipay", () => {
    assert.equal(
        isIzipayUserCancellationMessage(
            "El formulario de compra fue cerrado. la transacción ha sido cancelada"
        ),
        true
    )
})

test("tolera mayúsculas, tildes y espacios en el mensaje de cierre", () => {
    assert.equal(
        isIzipayUserCancellationMessage("  EL FORMULARIO DE PAGO fue CERRADO  "),
        true
    )
})

test("detecta una cancelación atribuida explícitamente al usuario", () => {
    assert.equal(isIzipayUserCancellationMessage("Pago cancelado por el usuario"), true)
    assert.equal(isIzipayUserCancellationMessage("Payment cancelled by the user"), true)
})

test("no oculta cancelaciones o rechazos atribuibles al emisor", () => {
    assert.equal(
        isIzipayUserCancellationMessage("La transacción fue cancelada por el emisor"),
        false
    )
    assert.equal(isIzipayUserCancellationMessage("Pago rechazado por la entidad bancaria"), false)
})

test("no clasifica mensajes vacíos o errores técnicos como cierre voluntario", () => {
    assert.equal(isIzipayUserCancellationMessage(""), false)
    assert.equal(isIzipayUserCancellationMessage("Timeout conectando con Izipay"), false)
})
