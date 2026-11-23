import test from "node:test"
import assert from "node:assert/strict"
import { parseRegistrationLocation, resolveRegistrationLocation } from "@/lib/registration-location"

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

test("recupera el ubigeo registrado tolerando tildes, mayúsculas y espacios", () => {
    assert.equal(resolveRegistrationLocation({
        departamento: " LIMA ", provincia: "Lima", distrito: " Villa María   del Triunfo ",
    })?.ubigeo, "150143")
    assert.equal(resolveRegistrationLocation({
        departamento: "Arequipa", provincia: "Arequipa", distrito: "Arequipa",
    })?.ubigeo, "040101")
})

test("no confunde distritos del mismo nombre en diferentes provincias", () => {
    assert.equal(resolveRegistrationLocation({
        departamento: "Lima", provincia: "Lima", distrito: "Santa Rosa",
    })?.ubigeo, "150139")
    assert.equal(resolveRegistrationLocation({
        departamento: "Puno", provincia: "El Collao", distrito: "Santa Rosa",
    })?.ubigeo, "210504")
    assert.equal(resolveRegistrationLocation({
        departamento: "Puno", provincia: "Melgar", distrito: "Santa Rosa",
    })?.ubigeo, "210808")
})

test("las cuentas antiguas sin ubicación completa no reciben un ubigeo inventado", () => {
    for (const account of [null, {}, { departamento: "Lima" }, {
        departamento: "Lima", provincia: "Arequipa", distrito: "Arequipa",
    }]) assert.equal(resolveRegistrationLocation(account), null)
})
