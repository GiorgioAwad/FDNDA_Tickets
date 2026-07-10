import assert from "node:assert/strict"
import test from "node:test"
import {
    GOLD_MEMBERSHIP_GUEST_PASS_LIMIT,
    buildMembershipGuestPassSummary,
    isGoldMembershipDisplay,
} from "./membership-guest-pass"

test("membresía ORO con acceso libre recibe el beneficio de pases", () => {
    assert.equal(isGoldMembershipDisplay({ planLabel: "ORO", freeAccess: true }), true)
    assert.equal(isGoldMembershipDisplay({ planLabel: "ORO", freeAccess: false }), false)
    assert.equal(isGoldMembershipDisplay({ planLabel: "PLATA", freeAccess: true }), false)
})

test("el resumen limita los pases gratuitos a tres", () => {
    assert.equal(GOLD_MEMBERSHIP_GUEST_PASS_LIMIT, 3)
    assert.deepEqual(buildMembershipGuestPassSummary(2), {
        limit: 3,
        used: 2,
        remaining: 1,
    })
    assert.deepEqual(buildMembershipGuestPassSummary(4), {
        limit: 3,
        used: 3,
        remaining: 0,
    })
})
