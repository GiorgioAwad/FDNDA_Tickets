"use client"

import { useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CheckCircle2 } from "lucide-react"

interface HomeVerificationPopupProps {
    open: boolean
}

export default function HomeVerificationPopup({ open }: HomeVerificationPopupProps) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const [visible, setVisible] = useState(open)

    const nextUrl = useMemo(() => {
        const params = new URLSearchParams(searchParams.toString())
        params.delete("verified")
        const query = params.toString()
        return query ? `${pathname}?${query}` : pathname
    }, [pathname, searchParams])

    const handleClose = () => {
        setVisible(false)
        router.replace(nextUrl, { scroll: false })
    }

    if (!visible) return null

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
            <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                    <CheckCircle2 className="h-9 w-9" />
                </div>

                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-900">Cuenta verificada</h2>
                    <p className="mt-3 text-sm text-gray-600">
                        Tu cuenta fue verificada correctamente. Ya puedes iniciar sesi&oacute;n y comprar tus entradas.
                    </p>
                </div>

                <Button onClick={handleClose} className="mt-6 w-full" size="lg">
                    Cerrar
                </Button>
            </div>
        </div>
    )
}
