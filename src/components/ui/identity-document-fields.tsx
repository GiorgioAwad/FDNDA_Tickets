"use client"

import { Input } from "@/components/ui/input"
import { IDENTITY_DOCUMENTS, IDENTITY_DOCUMENT_TYPES, sanitizeIdentityDocumentNumber, type IdentityDocumentType } from "@/lib/identity-document"

interface IdentityDocumentFieldsProps {
    idPrefix: string
    documentType: IdentityDocumentType
    number: string
    onTypeChange: (type: IdentityDocumentType) => void
    onNumberChange: (number: string) => void
    factura?: boolean
    stacked?: boolean
    error?: string
}

export function IdentityDocumentFields({ idPrefix, documentType, number, onTypeChange, onNumberChange, factura = false, stacked = false, error }: IdentityDocumentFieldsProps) {
    const rule = IDENTITY_DOCUMENTS[documentType]
    return (
        <div className="space-y-3 md:col-span-2">
            <div className={`grid grid-cols-1 gap-3 ${stacked ? "" : "sm:grid-cols-2"}`}>
                <div className="space-y-1.5">
                    <label htmlFor={`${idPrefix}-type`} className="text-sm font-medium text-foreground">Tipo de documento</label>
                    <select
                        id={`${idPrefix}-type`}
                        value={documentType}
                        onChange={(event) => onTypeChange(event.target.value as IdentityDocumentType)}
                        disabled={factura}
                        className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {(factura ? ["6" as const] : IDENTITY_DOCUMENT_TYPES).map((type) => <option key={type} value={type}>{IDENTITY_DOCUMENTS[type].label}</option>)}
                    </select>
                </div>
                <div className="space-y-1.5">
                    <label htmlFor={`${idPrefix}-number`} className="text-sm font-medium text-foreground">Número de documento</label>
                    <Input
                        id={`${idPrefix}-number`}
                        value={number}
                        onChange={(event) => onNumberChange(sanitizeIdentityDocumentNumber(documentType, event.target.value))}
                        inputMode={documentType === "7" ? "text" : "numeric"}
                        placeholder={rule.placeholder}
                        minLength={rule.minLength}
                        maxLength={rule.maxLength}
                        pattern={rule.pattern.source}
                        className="text-base"
                        required
                        aria-invalid={Boolean(error)}
                        aria-describedby={`${idPrefix}-hint`}
                    />
                </div>
            </div>
            <p id={`${idPrefix}-hint`} className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"} aria-live="polite">
                {error || (factura ? "La factura requiere RUC." : "C.E. y pasaporte son válidos solo para boleta.")}
            </p>
        </div>
    )
}
