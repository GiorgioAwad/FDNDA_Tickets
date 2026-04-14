"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function AdminError({
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
        <div className="flex items-center justify-center py-20 px-4">
            <div className="text-center max-w-md">
                <h2 className="text-xl font-semibold text-gray-700 mb-2">
                    Error en el panel de administracion
                </h2>
                <p className="text-gray-500 mb-6">
                    Ocurrio un error al cargar esta seccion. Si el problema persiste, contacta al equipo tecnico.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button onClick={reset} variant="outline">
                        Intentar de nuevo
                    </Button>
                    <Button asChild>
                        <Link href="/admin">Volver al panel</Link>
                    </Button>
                </div>
            </div>
        </div>
    )
}
