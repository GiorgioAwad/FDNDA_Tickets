import assert from "node:assert/strict"
import test from "node:test"
import { Prisma } from "@prisma/client"
import { getTodayDateString } from "./qr"
import { registerMembershipGuestPass } from "./membership-guest-pass-registration"

type Store = Parameters<typeof registerMembershipGuestPass>[0]
type Pass = { ticketId: string; month: string; number: number; date: Date }

// Simulates the database unique constraint; the tests exercise allocation,
// month selection, retries and counts through the actual registration service.
function makeStore(initial: Pass[] = []) {
    const rows = [...initial]
    const store = {
        async create({ data }: { data: Pass }) {
            if (rows.some((row) => row.ticketId === data.ticketId && row.month === data.month && row.number === data.number)) {
                throw new Prisma.PrismaClientKnownRequestError("duplicate monthly slot", {
                    code: "P2002", clientVersion: "test",
                })
            }
            rows.push(data)
            return data
        },
        async count({ where }: { where: { ticketId: string; month: string } }) {
            return rows.filter((row) => row.ticketId === where.ticketId && row.month === where.month).length
        },
    } as unknown as Store
    return { store, rows }
}

const input = { ticketId: "gold-1", staffId: "staff-1", eventId: "event-1" }

for (const [lastDay, firstDay] of [
    ["2026-08-31", "2026-09-01"],
    ["2026-12-31", "2027-01-01"],
    ["2028-02-29", "2028-03-01"],
]) {
    test(`three new passes on ${firstDay}, preserving the history from ${lastDay}`, async () => {
        const { store, rows } = makeStore()
        for (let number = 1; number <= 3; number += 1) {
            const result = await registerMembershipGuestPass(store, { ...input, today: lastDay })
            assert.equal(result.registeredNumber, number)
        }
        const exhausted = await registerMembershipGuestPass(store, { ...input, today: lastDay })
        assert.equal(exhausted.registeredNumber, null)
        assert.equal(exhausted.guestPasses.remaining, 0)

        for (let number = 1; number <= 3; number += 1) {
            const result = await registerMembershipGuestPass(store, { ...input, today: firstDay })
            assert.equal(result.registeredNumber, number)
            assert.deepEqual(result.guestPasses, { limit: 3, used: number, remaining: 3 - number })
        }
        assert.equal(rows.length, 6)
        assert.equal(rows.filter((row) => row.month === lastDay.slice(0, 7)).length, 3)
    })
}

test("unused passes do not accumulate, and another membership has its own quota", async () => {
    const { store } = makeStore()
    await registerMembershipGuestPass(store, { ...input, today: "2026-07-10" })
    const result = await registerMembershipGuestPass(store, { ...input, today: "2026-09-09" })
    assert.deepEqual(result.guestPasses, { limit: 3, used: 1, remaining: 2 })
    const other = await registerMembershipGuestPass(store, { ...input, ticketId: "gold-2", today: "2026-09-09" })
    assert.deepEqual(other.guestPasses, { limit: 3, used: 1, remaining: 2 })
})

test("migrated passes with non-consecutive numbers retain the monthly limit", async () => {
    const { store, rows } = makeStore([
        { ticketId: input.ticketId, month: "2026-09", number: 3, date: new Date("2026-09-02T00:00:00Z") },
    ])
    const first = await registerMembershipGuestPass(store, { ...input, today: "2026-09-09" })
    assert.equal(first.guestPasses.remaining, 1)
    const second = await registerMembershipGuestPass(store, { ...input, today: "2026-09-09" })
    assert.equal(second.guestPasses.remaining, 0)
    const exhausted = await registerMembershipGuestPass(store, { ...input, today: "2026-09-09" })
    assert.equal(exhausted.registeredNumber, null)
    assert.equal(rows.length, 3)
})

test("concurrent registrations retry collisions without exceeding three slots", async () => {
    const { store, rows } = makeStore()
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        registerMembershipGuestPass(store, { ...input, staffId: `staff-${i}`, today: "2026-09-09" })
    ))
    assert.equal(rows.length, 3)
    assert.equal(results.filter((result) => result.registeredNumber !== null).length, 3)
    assert.deepEqual(rows.map((row) => row.number).sort(), [1, 2, 3])
})

test("the monthly reset happens at midnight in Lima, not UTC", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-01T04:59:59Z") })
    const { store } = makeStore()
    for (let i = 0; i < 3; i += 1) {
        await registerMembershipGuestPass(store, { ...input, today: getTodayDateString() })
    }
    assert.equal(getTodayDateString(), "2026-08-31")
    t.mock.timers.tick(1000)
    assert.equal(getTodayDateString(), "2026-09-01")
    const result = await registerMembershipGuestPass(store, { ...input, today: getTodayDateString() })
    assert.deepEqual(result.guestPasses, { limit: 3, used: 1, remaining: 2 })
})

test("database failures other than duplicate slots are propagated", async () => {
    const { store } = makeStore()
    const failure = new Error("database unavailable")
    store.create = (async () => { throw failure }) as unknown as Store["create"]
    await assert.rejects(registerMembershipGuestPass(store, { ...input, today: "2026-09-09" }), failure)
})
