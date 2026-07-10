import type { MembershipDisplay } from "@/lib/scan-helpers"

export const GOLD_MEMBERSHIP_GUEST_PASS_LIMIT = 3

export interface MembershipGuestPassSummary {
    limit: number
    used: number
    remaining: number
}

export function isGoldMembershipDisplay(
    display: Pick<MembershipDisplay, "planLabel" | "freeAccess"> | null | undefined
): boolean {
    return display?.planLabel === "ORO" && display.freeAccess === true
}

export function buildMembershipGuestPassSummary(used: number): MembershipGuestPassSummary {
    const normalizedUsed = Math.min(
        GOLD_MEMBERSHIP_GUEST_PASS_LIMIT,
        Math.max(0, Math.floor(used))
    )

    return {
        limit: GOLD_MEMBERSHIP_GUEST_PASS_LIMIT,
        used: normalizedUsed,
        remaining: Math.max(GOLD_MEMBERSHIP_GUEST_PASS_LIMIT - normalizedUsed, 0),
    }
}
