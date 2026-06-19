import test from "node:test"
import assert from "node:assert/strict"
import {
    canReassignToScanDate,
    pickQrDateForTicket,
    ticketUsesPurchasedDates,
} from "@/lib/ticket-date-policy"

test("pickQrDateForTicket uses the purchased future date by default", () => {
    const qrDate = pickQrDateForTicket({
        today: "2026-06-03",
        scheduleSelections: [{ date: "2026-06-04", shift: null }],
        entitlements: [{ date: new Date("2026-06-04T12:00:00Z"), status: "AVAILABLE" }],
        usePurchasedDates: true,
    })

    assert.equal(qrDate, "2026-06-04")
})

test("pickQrDateForTicket follows the ticket's own entitlement over an ambiguous purchased date", () => {
    // Piscina libre: el mismo horario comprado en varias fechas crea varios
    // orderItems con el mismo ticketTypeId. La re-derivación por attendeeData
    // devolvía la fecha del primer orderItem (06-23) para TODOS los tickets, pero
    // el entitlement propio de este ticket es 06-25. El QR debe seguir al entitlement.
    const qrDate = pickQrDateForTicket({
        today: "2026-06-20",
        scheduleSelections: [{ date: "2026-06-23", shift: null }],
        entitlements: [{ date: new Date("2026-06-25T12:00:00Z"), status: "AVAILABLE" }],
        usePurchasedDates: true,
    })

    assert.equal(qrDate, "2026-06-25")
})

test("pickQrDateForTicket honors an explicit requested date", () => {
    const qrDate = pickQrDateForTicket({
        dateParam: "2026-06-05",
        today: "2026-06-03",
        scheduleSelections: [{ date: "2026-06-04", shift: null }],
        entitlements: [{ date: new Date("2026-06-04T12:00:00Z"), status: "AVAILABLE" }],
        usePurchasedDates: true,
    })

    assert.equal(qrDate, "2026-06-05")
})

test("ticketUsesPurchasedDates locks piscina libre even without stored selections", () => {
    assert.equal(
        ticketUsesPurchasedDates({
            eventCategory: "PISCINA_LIBRE",
            scheduleSelections: [],
        }),
        true
    )
})

test("canReassignToScanDate keeps flexible packages reassignable", () => {
    assert.equal(
        canReassignToScanDate({
            strictDateSchedule: true,
            isPackageLike: true,
            usesPurchasedDates: false,
        }),
        true
    )
})

test("canReassignToScanDate blocks tickets tied to purchased dates", () => {
    assert.equal(
        canReassignToScanDate({
            strictDateSchedule: false,
            isPackageLike: true,
            usesPurchasedDates: true,
        }),
        false
    )
})
