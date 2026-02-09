import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Política de Privacidad - Ticketing FDNDA",
    description: "Política de Privacidad de la Federación Deportiva Nacional de Deportes Acuáticos.",
}

export default function PrivacidadPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 py-12 max-w-4xl">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Política de Privacidad</h1>
                <p className="text-sm text-gray-500 mb-8">Última actualización: febrero 2026</p>

                <div className="bg-white rounded-xl shadow-sm border p-8 space-y-8 text-gray-700 leading-relaxed">
                    <p>
                        La Federación Deportiva Nacional de Deportes Acuáticos (FDNDA) respeta y protege la privacidad de los usuarios que interactúan con su sitio web, conforme a la Ley N.° 29733 – Ley de Protección de Datos Personales.
                    </p>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Datos personales recopilados</h2>
                        <p className="mb-3">
                            La FDNDA podrá recopilar datos personales a través de formularios, inscripciones, compras, solicitudes o registros, tales como:
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                            <li>Nombres y apellidos</li>
                            <li>Documento de identidad</li>
                            <li>Correo electrónico</li>
                            <li>Teléfono</li>
                            <li>Información deportiva o institucional relevante</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Finalidad del uso de los datos</h2>
                        <p className="mb-3">
                            Los datos personales serán utilizados exclusivamente para:
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                            <li>Inscripciones a talleres, eventos y programas deportivos</li>
                            <li>Gestión administrativa y deportiva</li>
                            <li>Comunicación institucional y promocional</li>
                            <li>Cumplimiento de obligaciones legales y reglamentarias</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Seguridad y confidencialidad</h2>
                        <p>
                            La FDNDA adopta las medidas necesarias para proteger los datos personales y evitar accesos no autorizados, pérdidas o usos indebidos.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Cesión de datos</h2>
                        <p>
                            La FDNDA no vende ni comercializa datos personales. Estos solo podrán ser compartidos cuando sea necesario para cumplir obligaciones legales o con autorización expresa del titular.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Derechos del titular</h2>
                        <p>
                            El usuario puede ejercer sus derechos de acceso, rectificación, cancelación y oposición (ARCO) mediante solicitud dirigida a los canales oficiales de la FDNDA.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Conservación de datos</h2>
                        <p>
                            Los datos personales serán conservados únicamente durante el tiempo necesario para cumplir las finalidades descritas o según lo exija la normativa vigente.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Actualizaciones</h2>
                        <p>
                            La FDNDA podrá modificar esta Política de Privacidad en cualquier momento. Las actualizaciones serán publicadas en este sitio web.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    )
}
