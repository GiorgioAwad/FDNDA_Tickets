import test from "node:test"
import assert from "node:assert/strict"
import { parseRegistrationLocation } from "@/lib/registration-location"

test("resuelve departamento, provincia y distrito desde un ubigeo de Lima", () => {
    assert.deepEqual(parseRegistrationLocation("150143"), {
        ubigeo: "150143",
        departamento: "Lima",
        provincia: "Lima",
        distrito: "Villa Maria Del Triunfo",
    })
})

test("acepta ubicaciones fuera de Lima y limpia espacios del ubigeo", () => {
    assert.deepEqual(parseRegistrationLocation(" 040101 "), {
        ubigeo: "040101",
        departamento: "Arequipa",
        provincia: "Arequipa",
        distrito: "Arequipa",
    })
})

test("rechaza ubigeos incompletos, inexistentes o que no sean texto", () => {
    assert.equal(parseRegistrationLocation("1501"), null)
    assert.equal(parseRegistrationLocation("999999"), null)
    assert.equal(parseRegistrationLocation(150143), null)
})
