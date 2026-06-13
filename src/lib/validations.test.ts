import test from "node:test"
import assert from "node:assert/strict"
import { createOrderSchema } from "@/lib/validations"

test("createOrderSchema accepts schedule-only entries for event checkout", () => {
    const parsed = createOrderSchema.safeParse({
        eventId: "event-1",
        items: [
            {
                ticketTypeId: "ticket-1",
                quantity: 1,
                attendees: [
                    {
                        scheduleSelections: [
                            { date: "2026-06-13", shift: "Tarde" },
                        ],
                    },
                ],
            },
        ],
        billing: {
            documentType: "BOLETA",
            buyerDocNumber: "12345678",
            buyerName: "Ana Perez Lopez",
            buyerFirstName: "Ana",
            buyerSecondName: "",
            buyerLastNamePaternal: "Perez",
            buyerLastNameMaternal: "Lopez",
            buyerAddress: "Av. Principal 123",
            buyerEmail: "ana@example.com",
            buyerPhone: "987654321",
            buyerUbigeo: "150101",
        },
    })

    assert.equal(parsed.success, true)
    if (!parsed.success) return
    assert.equal(parsed.data.items[0]?.attendees?.[0]?.firstName, "")
    assert.equal(parsed.data.items[0]?.attendees?.[0]?.name, "")
})
