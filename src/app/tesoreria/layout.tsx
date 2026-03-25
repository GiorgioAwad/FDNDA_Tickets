import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { TreasuryLayoutClient } from "@/components/treasury/TreasuryLayoutClient"

export default async function TreasuryLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const user = await getCurrentUser()

    if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
        redirect("/")
    }

    return <TreasuryLayoutClient>{children}</TreasuryLayoutClient>
}
