import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
    MerchPickupLocationsManager,
    type AdminMerchPickupLocation,
} from "@/components/admin/MerchPickupLocationsManager"

export const dynamic = "force-dynamic"

export default async function AdminMerchPickupLocationsPage() {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        redirect("/login")
    }

    const locations = await prisma.merchPickupLocation.findMany({
        orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { orders: true, products: true } } },
    })

    const initialLocations: AdminMerchPickupLocation[] = locations.map((location) => ({
        ...location,
        createdAt: location.createdAt.toISOString(),
        updatedAt: location.updatedAt.toISOString(),
    }))

    return <MerchPickupLocationsManager initialLocations={initialLocations} />
}
