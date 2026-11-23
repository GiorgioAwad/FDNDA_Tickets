"use client"

import { Input } from "@/components/ui/input"
import { getCheckoutBillingContact, type AccountBillingContact } from "@/lib/billing"

interface BillingContactFieldsProps {
    account: AccountBillingContact | null
    pending: boolean
    buyerEmail: string
    buyerPhone: string
    onChange: (field: "buyerEmail" | "buyerPhone", value: string) => void
    errors?: { buyerEmail?: string; buyerPhone?: string }
}

export function BillingContactFields({ account, pending, buyerEmail, buyerPhone, onChange, errors }: BillingContactFieldsProps) {
    if (pending) return null
    const registered = getCheckoutBillingContact(account)
    return (
        <div className="space-y-3">
            {(registered.buyerEmail || registered.buyerPhone) && (
                <div className="space-y-1 text-sm">
                    <p className="font-medium">Contacto del comprobante</p>
                    {registered.buyerEmail && <p className="break-words">{registered.buyerEmail}</p>}
                    {registered.buyerPhone && <p>{registered.buyerPhone}</p>}
                </div>
            )}
            {!registered.buyerEmail && (
                <div className="space-y-1.5">
                    <label htmlFor="billing-contact-email" className="text-sm font-medium">Correo para el comprobante</label>
                    <Input id="billing-contact-email" type="email" autoComplete="email" value={buyerEmail}
                        onChange={(event) => onChange("buyerEmail", event.target.value)} placeholder="cliente@correo.com"
                        aria-invalid={Boolean(buyerEmail && errors?.buyerEmail)}
                        aria-describedby={buyerEmail && errors?.buyerEmail ? "billing-contact-email-error" : undefined} />
                    {buyerEmail && errors?.buyerEmail && <p id="billing-contact-email-error" className="text-sm text-destructive">{errors.buyerEmail}</p>}
                </div>
            )}
            {!registered.buyerPhone && (
                <div className="space-y-1.5">
                    <label htmlFor="billing-contact-phone" className="text-sm font-medium">Celular para el comprobante</label>
                    <Input id="billing-contact-phone" type="tel" inputMode="numeric" autoComplete="tel" value={buyerPhone}
                        onChange={(event) => onChange("buyerPhone", event.target.value.replace(/\D/g, "").slice(0, 15))}
                        placeholder="999888777" aria-invalid={Boolean(buyerPhone && errors?.buyerPhone)}
                        aria-describedby={buyerPhone && errors?.buyerPhone ? "billing-contact-phone-error" : "billing-contact-phone-hint"} />
                    <p id="billing-contact-phone-hint" className="text-sm text-muted-foreground">Tu cuenta aún no tiene un celular válido. Complétalo para continuar.</p>
                    {buyerPhone && errors?.buyerPhone && <p id="billing-contact-phone-error" className="text-sm text-destructive">{errors.buyerPhone}</p>}
                </div>
            )}
        </div>
    )
}
