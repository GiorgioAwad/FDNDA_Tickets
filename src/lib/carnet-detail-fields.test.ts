import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CarnetDetailFields, type CarnetTicketTypeOption } from "../components/admin/carnets/CarnetDetailFields"

const membership: CarnetTicketTypeOption = {
    id: "membership", name: "Membresía anual bronce", price: 0, capacity: 100, sold: 0,
    monthlyClassLimit: 12, membershipDurationMonths: 12, membershipScheduleKey: "BRONCE",
    isPackage: true, packageDaysCount: 12, capacityByDate: false, usesDateCapacity: false,
    scheduleProfile: null,
}
function render(ticketType = membership, membershipStartFixed: string | null = "2026-11-02") {
    return renderToStaticMarkup(createElement(CarnetDetailFields, {
        ticketType, eventCategory: "ACADEMIA", membershipStartFixed,
        startDate: "2026-08-03", setStartDate() {}, schedule: {}, setSchedule() {},
        dateInventory: [], selectedDates: [], setSelectedDates() {},
    }))
}

test("la emisión administrativa permite elegir inicio aunque el evento tenga una fecha fija", () => {
    const html = render()
    assert.match(html, /id="carnet-membership-start"/)
    assert.match(html, /type="date"/)
    assert.match(html, /value="2026-08-03"/)
    assert.match(html, /Puedes elegir otra fecha/)
    assert.doesNotMatch(html, /Fija por el evento|Fechas del paquete/)
})

test("las membresías sin fecha fija también permiten elegir inicio", () => {
    const html = render(membership, null)
    assert.match(html, /type="date"/)
    assert.doesNotMatch(html, /Fecha predeterminada del evento/)
})

test("el formulario conserva la fecha fija de los planes de verano", () => {
    const html = render({ ...membership, membershipScheduleKey: "VERANO_3X" }, "2027-01-04")
    assert.match(html, /Fija por el evento: 2027-01-04/)
    assert.doesNotMatch(html, /type="date"/)
})
