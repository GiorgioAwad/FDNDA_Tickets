"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function GlobalError({
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
        <html>
            <body>
                <div style={{ padding: "2rem", textAlign: "center", fontFamily: "sans-serif" }}>
                    <h2>Algo salio mal</h2>
                    <p>Ocurrio un error inesperado. Nuestro equipo ya fue notificado.</p>
                    <button
                        onClick={reset}
                        style={{
                            marginTop: "1rem",
                            padding: "0.5rem 1.5rem",
                            borderRadius: "0.375rem",
                            border: "1px solid #ccc",
                            cursor: "pointer",
                        }}
                    >
                        Intentar de nuevo
                    </button>
                </div>
            </body>
        </html>
    )
}
