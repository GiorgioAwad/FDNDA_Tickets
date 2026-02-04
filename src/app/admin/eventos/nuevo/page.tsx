import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { EventForm } from "@/components/admin/EventForm"

export default async function NewEventPage() {
    const user = await getCurrentUser()

    if (!user || user.role !== "ADMIN") {
        redirect("/")
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <EventForm />
        </div>
    )
}
