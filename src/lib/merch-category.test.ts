import assert from "node:assert/strict"
import test from "node:test"
import { merchCategoryHasBackImage, merchCategoryLabel, normalizeMerchCategory } from "./merch-category"

test("admite tipos personalizados y normaliza entradas equivalentes", () => {
    for (const input of [" Bolsa deportiva ", "bolsa-deportiva", "BOLSA_DEPORTIVA", "bolsa  deportiva"]) {
        assert.equal(normalizeMerchCategory(input), "BOLSA_DEPORTIVA")
    }
    assert.equal(normalizeMerchCategory("Muñeco"), "MUÑECO")
    for (const input of [null, 42, "", "   ", "ALL", "a".repeat(41), "<script>", "__proto__"]) {
        assert.equal(normalizeMerchCategory(input), null)
    }
})

test("muestra tipos nuevos sin perder las etiquetas de los tipos existentes", () => {
    assert.equal(merchCategoryLabel("BOLSA_DEPORTIVA"), "Bolsa deportiva")
    assert.equal(merchCategoryLabel("PIN", true), "Pines")
    assert.equal(merchCategoryLabel("POLO"), "Polo")
    assert.equal(merchCategoryLabel("LLAVERO", true), "Llaveros")
    assert.equal(merchCategoryHasBackImage("POLO"), true)
    assert.equal(merchCategoryHasBackImage("POLERA"), true)
    assert.equal(merchCategoryHasBackImage("LLAVERO"), false)
})
