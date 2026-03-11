import Link from "next/link"
import { ArrowLeft, CreditCard, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function CheckoutCancelPage() {
    return (
        <div className="min-h-[80vh] flex items-center justify-center bg-gradient-to-b from-gray-50 to-white px-4 py-12">
            <Card className="w-full max-w-2xl shadow-xl border-0">
                <CardHeader className="text-center space-y-3">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                        <CreditCard className="h-7 w-7" />
                    </div>
                    <CardTitle className="text-3xl">Pago cancelado</CardTitle>
                    <CardDescription className="text-base">
                        Tu proceso de pago fue interrumpido. Si tu carrito sigue guardado, puedes retomarlo sin volver a seleccionar tus entradas.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                        No se confirmó ningún cobro. Puedes regresar al checkout para intentar nuevamente o volver a revisar los eventos disponibles.
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Link href="/checkout" className="flex-1">
                            <Button className="w-full" size="lg">
                                <ShoppingCart className="mr-2 h-4 w-4" />
                                Volver al checkout
                            </Button>
                        </Link>
                        <Link href="/eventos" className="flex-1">
                            <Button variant="outline" className="w-full" size="lg">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Ver eventos
                            </Button>
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
