"use client"

import { UbigeoSelector } from "@/components/checkout/ubigeo-selector"
import { Button } from "@/components/ui/button"
import type { RegistrationLocation } from "@/lib/registration-location"

interface BillingLocationFieldsProps {
    location: RegistrationLocation | null
    loading: boolean
    error: boolean
    onRetry: () => void
    value: string
    onChange: (ubigeo: string) => void
}

export function BillingLocationFields({ location, loading, error, onRetry, value, onChange }: BillingLocationFieldsProps) {
    if (loading) return <p role="status" className="text-sm text-muted-foreground">Cargando datos de tu cuenta…</p>
    if (error) return (
        <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">No pudimos cargar los datos de tu cuenta.</p>
            <Button type="button" variant="outline" onClick={onRetry}>Reintentar</Button>
        </div>
    )
    if (location) return (
        <div className="space-y-1 text-sm">
            <p className="font-medium">Ubicación del comprobante</p>
            <p>{location.departamento}, {location.provincia}, {location.distrito}</p>
            <p className="text-muted-foreground">Usaremos la ubicación que registraste en tu cuenta.</p>
        </div>
    )
    return (
        <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Tu cuenta aún no tiene una ubicación registrada. Selecciona región, provincia y distrito para tu comprobante.</p>
            <UbigeoSelector value={value} onChange={onChange} />
        </div>
    )
}
