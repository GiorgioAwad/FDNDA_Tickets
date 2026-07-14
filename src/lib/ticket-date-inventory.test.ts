import assert from "node:assert/strict"
import test from "node:test"
import type { Prisma } from "@prisma/client"

import {
    assertDateCapacityNotBelowSold,
    releaseTicketTypeDateInventory,
    reserveTicketTypeDateInventory,
} from "./ticket-date-inventory"

const reservation = new Map([["2026-08-01", 1]])

test("daily capacity cannot be reduced below already sold units", () => {
    assert.throws(
        () => assertDateCapacityNotBelowSold("2026-08-01", 2, 3),
        /no puede ser menor/
    )
    assert.doesNotThrow(() => assertDateCapacityNotBelowSold("2026-08-01", 3, 3))
    assert.doesNotThrow(() => assertDateCapacityNotBelowSold("2026-08-01", 0, 3))
})

test("a configured daily ticket fails when the date is missing, closed or sold out", async () => {
    let queryCalls = 0
    const tx = {
        $queryRaw: async () => {
            queryCalls += 1
            return []
        },
    } as unknown as Prisma.TransactionClient

    await assert.rejects(
        reserveTicketTypeDateInventory(tx, {
            ticketTypeId: "daily",
            templateCapacity: 0,
            reservations: reservation,
            ticketLabel: "Entrada diaria",
            requireConfigured: true,
        }),
        /No hay cupos disponibles/
    )
    assert.equal(queryCalls, 1, "must not silently create an unlimited row")
})

test("only one concurrent buyer can receive the last configured spot", async () => {
    let available = 1
    const tx = {
        $queryRaw: async () => {
            if (available === 0) return []
            available -= 1
            return [{ id: "inventory" }]
        },
    } as unknown as Prisma.TransactionClient

    await reserveTicketTypeDateInventory(tx, {
        ticketTypeId: "daily",
        templateCapacity: 1,
        reservations: reservation,
        ticketLabel: "Último cupo",
        requireConfigured: true,
    })
    await assert.rejects(
        reserveTicketTypeDateInventory(tx, {
            ticketTypeId: "daily",
            templateCapacity: 1,
            reservations: reservation,
            ticketLabel: "Último cupo",
            requireConfigured: true,
        }),
        /No hay cupos disponibles/
    )
})

test("legacy pool inventory may still create a missing date row", async () => {
    const responses = [[], [{ id: "created" }]]
    const tx = {
        $queryRaw: async () => responses.shift() ?? [],
    } as unknown as Prisma.TransactionClient

    await reserveTicketTypeDateInventory(tx, {
        ticketTypeId: "pool",
        templateCapacity: 10,
        reservations: reservation,
        ticketLabel: "Piscina libre",
    })
    assert.equal(responses.length, 0)
})

test("expiration or cancellation releases the selected date", async () => {
    let executeCalls = 0
    const tx = {
        $executeRaw: async () => {
            executeCalls += 1
            return 1
        },
    } as unknown as Prisma.TransactionClient

    await releaseTicketTypeDateInventory(tx, {
        ticketTypeId: "daily",
        reservations: reservation,
    })
    assert.equal(executeCalls, 1)
})
