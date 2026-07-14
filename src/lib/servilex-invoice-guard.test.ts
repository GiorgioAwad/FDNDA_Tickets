import assert from "node:assert/strict"
import test from "node:test"
import {
    getAcMatriculaFromGroupKey,
    isCoveredByIssuedAcMatricula,
} from "./servilex-invoice-guard"

test("extracts the matricula from an AC group key", () => {
    assert.equal(getAcMatriculaFromGroupKey("AC:03:matricula:5393830"), "5393830")
    assert.equal(getAcMatriculaFromGroupKey("PN:03:pool:1"), null)
})

test("an issued AC invoice still covers the matricula after a site correction", () => {
    assert.equal(
        isCoveredByIssuedAcMatricula(
            "AC:01:matricula:5393830",
            ["AC:03:matricula:5393830"]
        ),
        true
    )
})

test("does not cover a different matricula", () => {
    assert.equal(
        isCoveredByIssuedAcMatricula(
            "AC:01:matricula:6176656",
            ["AC:03:matricula:5393830"]
        ),
        false
    )
})
