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
            <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-8">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600 sm:mb-5 sm:h-16 sm:w-16">
                    <CheckCircle2 className="h-8 w-8 sm:h-9 sm:w-9" />
                </div>

                <div className="text-center">
                    <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">Cuenta verificada</h2>
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
