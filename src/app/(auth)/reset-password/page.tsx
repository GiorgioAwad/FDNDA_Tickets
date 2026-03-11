import { Suspense } from "react"
import ResetPasswordClient from "./ResetPasswordClient"

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white" />}>
            <ResetPasswordClient />
        </Suspense>
    )
}
