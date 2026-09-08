import assert from "node:assert/strict"
import test from "node:test"

import { BarcodeWedgeBuffer } from "@/hooks/useBarcodeWedge"

test("default barcode timers retain the browser global receiver", () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const fakeHandle = 1 as unknown as ReturnType<typeof setTimeout>
    const scans: string[] = []
    let scheduled: (() => void) | null = null
    let cancelCalls = 0

    const browserLikeSetTimeout = function (
        this: typeof globalThis,
        callback: () => void
    ) {
        assert.equal(this, globalThis)
        scheduled = callback
        return fakeHandle
    }
    const browserLikeClearTimeout = function (this: typeof globalThis) {
        assert.equal(this, globalThis)
        cancelCalls += 1
        scheduled = null
    }

    try {
        globalThis.setTimeout = browserLikeSetTimeout as typeof setTimeout
        globalThis.clearTimeout = browserLikeClearTimeout as typeof clearTimeout

        const buffer = new BarcodeWedgeBuffer({ onScan: (raw) => scans.push(raw) })
        buffer.push("ticket-")
        buffer.push("browser")

        assert.equal(cancelCalls, 1)
        assert.ok(scheduled)
        ;(scheduled as () => void)()
        assert.deepEqual(scans, ["ticket-browser"])
        buffer.dispose()
    } finally {
        globalThis.setTimeout = originalSetTimeout
        globalThis.clearTimeout = originalClearTimeout
    }
})
