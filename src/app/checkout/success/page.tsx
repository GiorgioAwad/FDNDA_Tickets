import { Suspense } from "react"
import CheckoutSuccessClient from "./CheckoutSuccessClient"

export default function CheckoutSuccessPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
            <CheckoutSuccessClient />
        </Suspense>
    )
}
