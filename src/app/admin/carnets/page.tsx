import { redirect } from "next/navigation"

import { CarnetIssueForm } from "@/components/admin/carnets/CarnetIssueForm"
import { getCurrentUser, hasRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function CarnetsPage() {
    const user = await getCurrentUser()
    if (!user || !hasRole(user.role, "ADMIN")) redirect("/admin")

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-2xl font-semibold text-gray-900">Emitir carnet</h1>
                <p className="text-sm text-gray-600">
                    Emite un carnet a un usuario ya registrado. No genera comprobante: la boleta se
                    emite fuera de la web.
                </p>
            </header>
            <CarnetIssueForm />
        </div>
    )
}
