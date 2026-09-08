import assert from "node:assert/strict"
import test from "node:test"

import { BarcodeWedgeBuffer, shouldAutofocusBarcodeWedge } from "@/hooks/useBarcodeWedge"

test("barcode wedge emits a complete scan when Enter arrives", () => {
    const scans: string[] = []
    const buffer = new BarcodeWedgeBuffer({ onScan: (raw) => scans.push(raw) })

    buffer.push('{"ticketId":"ticket-1"}')
    buffer.push("\r\n")

    assert.deepEqual(scans, ['{"ticketId":"ticket-1"}'])
    buffer.dispose()
})

test("barcode wedge flushes a scan after the inactivity timeout", () => {
    const scans: string[] = []
    let scheduled: (() => void) | null = null
    const fakeHandle = 1 as unknown as ReturnType<typeof setTimeout>
    const buffer = new BarcodeWedgeBuffer({
        onScan: (raw) => scans.push(raw),
        schedule: (callback) => {
            scheduled = callback
            return fakeHandle
        },
        cancel: () => {
            scheduled = null
        },
    })

    buffer.push('{"ticketId":"ticket-2"}')
    assert.deepEqual(scans, [])
    assert.ok(scheduled)
    ;(scheduled as () => void)()

    assert.deepEqual(scans, ['{"ticketId":"ticket-2"}'])
})

test("barcode wedge discards input while validation is paused", () => {
    const scans: string[] = []
    const buffer = new BarcodeWedgeBuffer({ onScan: (raw) => scans.push(raw) })

    buffer.setPaused(true)
    buffer.push('{"ticketId":"ignored"}\n')
    buffer.setPaused(false)
    buffer.push('{"ticketId":"accepted"}\n')

    assert.deepEqual(scans, ['{"ticketId":"accepted"}'])
    buffer.dispose()
})

test("barcode wedge only auto-focuses from the page body or its own input", () => {
    const body = {} as HTMLElement
    const capture = {} as HTMLTextAreaElement
    const manualInput = {} as HTMLInputElement

    assert.equal(shouldAutofocusBarcodeWedge(body, body, capture), true)
    assert.equal(shouldAutofocusBarcodeWedge(capture, body, capture), true)
    assert.equal(shouldAutofocusBarcodeWedge(manualInput, body, capture), false)
})
