import type { Metadata } from "next"
import ComplaintBookForm from "./ComplaintBookForm"
import {
    COMPLAINTS_EMAIL,
    LEGAL_ADDRESS,
    LEGAL_COMMERCIAL_NAME,
    LEGAL_EMAIL,
    LEGAL_ENTITY_NAME,
    LEGAL_PHONE,
    LEGAL_RUC,
} from "@/lib/legal"

export const metadata: Metadata = {
    title: "Libro de Reclamaciones - Ticketing FDNDA",
    description:
        "Registra quejas o reclamos de consumo relacionados con compras o servicios de Ticketing FDNDA.",
}

export default function ComplaintBookPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto max-w-5xl px-4 py-12">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Libro de Reclamaciones</h1>
                    <p className="mt-3 max-w-3xl text-gray-600">
                        Registra aqui tu queja o reclamo de consumo conforme al Codigo de Proteccion y Defensa del Consumidor. Tu solicitud sera atendida dentro del plazo legal aplicable.
                    </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.2fr_2fr]">
                    <aside className="space-y-6">
                        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                            <h2 className="text-lg font-semibold text-gray-900">Proveedor</h2>
                            <dl className="mt-4 space-y-3 text-sm text-gray-700">
                                <div>
                                    <dt className="font-medium text-gray-900">Razon social</dt>
                                    <dd>{LEGAL_ENTITY_NAME}</dd>
                                </div>
                                {LEGAL_RUC && (
                                    <div>
                                        <dt className="font-medium text-gray-900">RUC</dt>
                                        <dd>{LEGAL_RUC}</dd>
                                    </div>
                                )}
                                <div>
                                    <dt className="font-medium text-gray-900">Nombre comercial</dt>
                                    <dd>{LEGAL_COMMERCIAL_NAME}</dd>
                                </div>
                                <div>
                                    <dt className="font-medium text-gray-900">Direccion</dt>
                                    <dd>{LEGAL_ADDRESS}</dd>
                                </div>
                                <div>
                                    <dt className="font-medium text-gray-900">Telefono</dt>
                                    <dd>{LEGAL_PHONE}</dd>
                                </div>
                                <div>
                                    <dt className="font-medium text-gray-900">Correo de contacto</dt>
                                    <dd>{COMPLAINTS_EMAIL}</dd>
                                </div>
                            </dl>
                        </div>

                        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-sm text-blue-900">
                            <p className="font-semibold">Importante</p>
                            <ul className="mt-3 list-disc space-y-2 pl-5">
                                <li>Reclamo: disconformidad relacionada con los productos o servicios.</li>
                                <li>Queja: malestar o descontento respecto de la atencion al publico.</li>
                                <li>La formulacion de esta hoja no impide acudir a otras vias de solucion de controversias ni constituye una denuncia ante Indecopi.</li>
                                <li>Conserva la constancia que recibiras por correo electronico.</li>
                            </ul>
                        </div>
                    </aside>

                    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                        <ComplaintBookForm />
                        <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
                            Al enviar esta hoja aceptas que {LEGAL_ENTITY_NAME} trate tus datos para gestionar tu solicitud, responderte y conservar evidencia del reclamo o queja. Si tienes dudas adicionales puedes escribir a {LEGAL_EMAIL}.
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
