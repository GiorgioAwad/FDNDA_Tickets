"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Waves } from "lucide-react"

export default function EventosError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        Sentry.captureException(error)
    }, [error])

    return (
        <div className="min-h-[60vh] flex items-center justify-center px-4">
            <div className="text-center max-w-md">
                <Waves className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                <h2 className="text-xl font-semibold text-gray-700 mb-2">
                    Ocurrio un error
                </h2>
                <p className="text-gray-500 mb-6">
                    No pudimos cargar la informacion del evento. Intenta de nuevo o vuelve al inicio.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button onClick={reset} variant="outline">
                        Intentar de nuevo
                    </Button>
                    <Button asChild>
                        <Link href="/eventos">Volver a eventos</Link>
                    </Button>
                </div>
            </div>
        </div>
    )
}
