import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { MerchProductForm } from "@/components/admin/MerchProductForm"

export const dynamic = "force-dynamic"

export default function NuevoMerchPage() {
    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div>
                <Link
                    href="/admin/merch"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver
                </Link>
                <h1 className="font-display text-3xl font-bold text-foreground">Nuevo producto de merch</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Sube la imagen del producto y configura precio, zona y tallas.
                </p>
            </div>

            <MerchProductForm />
        </div>
    )
}
