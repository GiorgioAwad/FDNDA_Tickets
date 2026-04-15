import Link from "next/link"
import { Mail, MapPin, Phone } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LEGAL_ADDRESS, LEGAL_EMAIL, LEGAL_PHONE } from "@/lib/legal"

const CONTACT_INFO = {
    address: LEGAL_ADDRESS,
    phone: LEGAL_PHONE,
    email: LEGAL_EMAIL,
}

export default function ContactoPage() {
    return (
        <div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white px-4 py-8 sm:py-12">
            <div className="container mx-auto max-w-4xl">
                <div className="mb-8 text-center sm:mb-10">
                    <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">Contacto</h1>
                    <p className="mt-3 text-gray-600">
                        Si necesitas ayuda con tu cuenta, compras o accesos, contactanos por cualquiera de estos canales.
                    </p>
                </div>

                <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
                    <Card className="border-0 shadow-lg">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <MapPin className="h-5 w-5 text-[hsl(210,100%,40%)]" />
                                Direccion
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <CardDescription className="text-sm leading-6 text-gray-700">
                                {CONTACT_INFO.address}
                            </CardDescription>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-lg">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Phone className="h-5 w-5 text-[hsl(210,100%,40%)]" />
                                Telefono
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <a href={`tel:${CONTACT_INFO.phone.replace(/\s+/g, "")}`} className="text-sm text-gray-700 hover:underline">
                                {CONTACT_INFO.phone}
                            </a>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-lg">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Mail className="h-5 w-5 text-[hsl(210,100%,40%)]" />
                                Correo
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <a href={`mailto:${CONTACT_INFO.email}`} className="text-sm text-gray-700 hover:underline">
                                {CONTACT_INFO.email}
                            </a>
                        </CardContent>
                    </Card>
                </div>

                <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-sm sm:mt-8 sm:p-6">
                    <p className="text-sm text-gray-600">
                        Tambien puedes registrar un{" "}
                        <Link href="/libro-de-reclamaciones" className="text-[hsl(210,100%,40%)] hover:underline">
                            Libro de Reclamaciones
                        </Link>
                        , revisar nuestros{" "}
                        <Link href="/terminos" className="text-[hsl(210,100%,40%)] hover:underline">
                            Terminos y Condiciones
                        </Link>{" "}
                        y la{" "}
                        <Link href="/privacidad" className="text-[hsl(210,100%,40%)] hover:underline">
                            Politica de Privacidad
                        </Link>
                        .
                    </p>
                </div>
            </div>
        </div>
    )
}
