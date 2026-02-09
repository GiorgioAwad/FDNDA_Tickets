import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Términos y Condiciones - Ticketing FDNDA",
    description: "Términos y Condiciones de uso del sitio web de la Federación Deportiva Nacional de Deportes Acuáticos.",
}

export default function TerminosPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 py-12 max-w-4xl">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Términos y Condiciones de Uso</h1>
                <p className="text-sm text-gray-500 mb-8">Última actualización: febrero 2026</p>

                <div className="bg-white rounded-xl shadow-sm border p-8 space-y-8 text-gray-700 leading-relaxed">
                    <p>
                        El presente documento establece los Términos y Condiciones que regulan el acceso y uso del sitio web de la Federación Deportiva Nacional de Deportes Acuáticos (FDNDA). Al acceder, navegar o utilizar este sitio web, el usuario acepta plenamente y sin reservas los términos aquí descritos.
                    </p>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Uso del sitio web</h2>
                        <p>
                            El usuario se compromete a utilizar este sitio web de manera responsable, lícita y conforme a la normativa vigente. Queda prohibido utilizar el sitio con fines ilícitos, fraudulentos o que puedan afectar los derechos, intereses o la imagen de la FDNDA o de terceros.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Contenidos</h2>
                        <p className="mb-3">
                            Los contenidos publicados en este sitio web (textos, imágenes, videos, documentos, logotipos, diseños, etc.) tienen fines informativos, institucionales y promocionales relacionados con las actividades deportivas, académicas y administrativas de la FDNDA.
                        </p>
                        <p>
                            La FDNDA se reserva el derecho de modificar, actualizar o eliminar contenidos sin previo aviso.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Propiedad intelectual</h2>
                        <p className="mb-3">
                            Todo el contenido del sitio web es propiedad de la FDNDA o se utiliza con autorización de sus titulares, y se encuentra protegido por la normativa de derechos de autor y propiedad intelectual.
                        </p>
                        <p>
                            Queda prohibida su reproducción, distribución o uso sin autorización expresa, salvo para fines personales y no comerciales.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Responsabilidad</h2>
                        <p className="mb-3">
                            La FDNDA no garantiza la disponibilidad continua del sitio web ni la ausencia de errores técnicos. Tampoco se responsabiliza por daños derivados del uso del sitio o de la información contenida en él.
                        </p>
                        <p>
                            El uso de la información publicada es responsabilidad exclusiva del usuario.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Enlaces externos</h2>
                        <p>
                            Este sitio puede contener enlaces a páginas web de terceros. La FDNDA no tiene control sobre dichos sitios ni asume responsabilidad por sus contenidos, políticas o prácticas.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Modificaciones</h2>
                        <p>
                            La FDNDA podrá modificar estos Términos y Condiciones en cualquier momento. Las modificaciones entrarán en vigencia desde su publicación en el sitio web.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    )
}
