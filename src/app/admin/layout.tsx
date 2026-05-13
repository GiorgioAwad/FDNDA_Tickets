import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { AdminLayoutClient } from "@/components/admin/AdminLayoutClient"

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const user = await getCurrentUser()

    if (!user || user.role !== "ADMIN") {
        redirect("/")
    }

    return (
        <AdminLayoutClient>
            <main className="flex-1 p-4 lg:p-6">
                {children}
            </main>
        </AdminLayoutClient>
    )
}
