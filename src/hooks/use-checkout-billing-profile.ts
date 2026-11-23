"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import type { AccountBillingContact, BillingSnapshotInput } from "@/lib/billing"
import type { RegistrationLocation } from "@/lib/registration-location"

type CheckoutBillingProfile = {
    data: BillingSnapshotInput | null
    registrationLocation: RegistrationLocation | null
    registrationContact: AccountBillingContact
}

export function useCheckoutBillingProfile() {
    const { data: session, status } = useSession()
    const userId = session?.user?.id
    const [result, setResult] = useState<{ userId: string; profile: CheckoutBillingProfile } | null>(null)
    const [failedUserId, setFailedUserId] = useState<string | null>(null)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        if (status !== "authenticated" || !userId) return
        const controller = new AbortController()
        void fetch("/api/me/billing-profile", { cache: "no-store", signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error("No se pudieron cargar los datos de la cuenta")
                const profile: CheckoutBillingProfile = await response.json()
                if (!controller.signal.aborted) setResult({ userId, profile })
            })
            .catch(() => {
                if (!controller.signal.aborted) setFailedUserId(userId)
            })
        return () => controller.abort()
    }, [status, userId, attempt])

    const profile = status === "authenticated" && result && result.userId === userId ? result.profile : null
    const error = status === "authenticated" && failedUserId === userId
    return {
        profile: profile?.data ?? null,
        location: profile?.registrationLocation ?? null,
        contact: profile?.registrationContact ?? null,
        loading: status === "loading" || (status === "authenticated" && !profile && !error),
        error,
        retry: () => { setFailedUserId(null); setAttempt((value) => value + 1) },
    }
}
