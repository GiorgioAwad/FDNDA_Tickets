import assert from "node:assert/strict"
import test from "node:test"

import { getScannedJsonCandidates } from "@/lib/scanner-input"

test("keeps a complete signed QR JSON payload", () => {
    const payload = '{"ticketId":"ticket-1","signature":"signature-1"}'

    assert.deepEqual(getScannedJsonCandidates(payload), [payload])
})

test("repairs an omitted opening brace on a signed QR payload", () => {
    const incomplete = '"ticketId":"ticket-1","signature":"signature-1"}'

    assert.deepEqual(getScannedJsonCandidates(incomplete), [
        incomplete,
        `{${incomplete}`,
    ])
})

test("does not invent braces for an arbitrary fragment", () => {
    const fragment = '"signature":"signature-1"}'

    assert.deepEqual(getScannedJsonCandidates(fragment), [fragment])
})
