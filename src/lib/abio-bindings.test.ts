import test from "node:test"
import assert from "node:assert/strict"
import { buildAbioBindingCompositeKey, parseAbioBindingRows } from "@/lib/abio-bindings"

test("parseAbioBindingRows normaliza y rellena codigos de tabla de amarre", () => {
    const rows = parseAbioBindingRows({
        codigoEmp: "001",
        rows: [
            {
                sucursal: "1",
                servicio: "82",
                disciplina: "0",
                piscina: "1",
                horario: "2",
                numero_cupos: "50",
            },
        ],
    })

    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0], {
        codigoEmp: "001",
        sucursalCodigo: "01",
        servicioCodigo: "082",
        disciplinaCodigo: "00",
        piscinaCodigo: "01",
        horarioCodigo: "000002",
        numeroCupos: 50,
        raw: {
            sucursal: "1",
            servicio: "82",
            disciplina: "0",
            piscina: "1",
            horario: "2",
            numero_cupos: "50",
        },
    })
})

test("parseAbioBindingRows omite filas incompletas", () => {
    const rows = parseAbioBindingRows({
        codigoEmp: "001",
        rows: [
            {
                sucursal: "1",
                servicio: "82",
                disciplina: "0",
                piscina: "",
                horario: "2",
                numero_cupos: "50",
            },
        ],
    })

    assert.equal(rows.length, 0)
})

test("buildAbioBindingCompositeKey une la combinacion operativa completa", () => {
    assert.equal(
        buildAbioBindingCompositeKey({
            codigoEmp: "001",
            sucursalCodigo: "01",
            servicioCodigo: "082",
            disciplinaCodigo: "00",
            piscinaCodigo: "01",
            horarioCodigo: "000002",
        }),
        "001|01|082|00|01|000002"
    )
})
