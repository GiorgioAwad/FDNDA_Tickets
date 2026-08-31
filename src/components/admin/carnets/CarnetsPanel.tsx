"use client"

import { useState } from "react"

import { CarnetHistory } from "./CarnetHistory"
import { CarnetIssueForm } from "./CarnetIssueForm"

/**
 * Une el formulario de emision y el historial. Existe solo para sostener el
 * contador que los comunica: la pagina (`src/app/admin/carnets/page.tsx`) es
 * un Server Component y no puede pasarle un callback a un componente cliente,
 * asi que sin este envoltorio los dos quedaban como hermanos incomunicados y
 * la tabla se quedaba con la foto de su carga inicial -- pese a que su estado
 * vacio promete que lo emitido "va a aparecer aqui".
 */
export function CarnetsPanel() {
    const [issuedCount, setIssuedCount] = useState(0)

    return (
        <>
            <CarnetIssueForm onIssued={() => setIssuedCount((count) => count + 1)} />
            <CarnetHistory refreshKey={issuedCount} />
        </>
    )
}
