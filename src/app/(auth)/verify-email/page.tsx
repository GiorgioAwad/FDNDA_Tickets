import { Suspense } from "react"
import VerifyEmailClient from "./VerifyEmailClient"

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={<div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white" />}>
            <VerifyEmailClient />
        </Suspense>
    )
}
