import { Suspense } from "react"
import LoginClient from "./LoginClient"

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white" />}>
            <LoginClient />
        </Suspense>
    )
}
