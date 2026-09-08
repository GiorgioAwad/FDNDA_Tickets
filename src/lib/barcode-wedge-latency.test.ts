import assert from "node:assert/strict"
import test from "node:test"

import { BarcodeWedgeBuffer } from "@/hooks/useBarcodeWedge"

test("barcode wedge falls back quickly when the scanner suffix is absent", () => {
    const fakeHandle = 1 as unknown as ReturnType<typeof setTimeout>
    let scheduledDelay: number | null = null
    const buffer = new BarcodeWedgeBuffer({
        onScan: () => {},
        schedule: (_callback, delayMs) => {
            scheduledDelay = delayMs
            return fakeHandle
        },
        cancel: () => {},
    })

    buffer.push("scanner-input")

    assert.equal(scheduledDelay, 180)
    buffer.dispose()
})
