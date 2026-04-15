import type { Metadata } from "next"
import Link from "next/link"
import {
    COMPLAINTS_EMAIL,
    LEGAL_ADDRESS,
    LEGAL_COMMERCIAL_NAME,
    LEGAL_EMAIL,
    LEGAL_ENTITY_NAME,
    LEGAL_PHONE,
    LEGAL_RUC,
    formatPublishedDate,
} from "@/lib/legal"

const LAST_UPDATED = "2026-03-23"

export const metadata: Metadata = {
    title: "Terminos y Condiciones - Ticketing FDNDA",
    description:
        "Condiciones de uso y compra de entradas de Ticketing FDNDA para eventos de la Federacion Deportiva Nacional de Deportes Acuaticos del Peru.",
}

function Section({
    title,
    children,
}: {
    title: string
    children: React.ReactNode
}) {
    return (
        <section>
            <h2 className="mb-3 text-xl font-semibold text-gray-900">{title}</h2>
            <div className="space-y-3 text-gray-700">{children}</div>
        </section>
    )
}

export default function TerminosPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-12">
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Terminos y Condiciones</h1>
                <p className="mt-2 text-sm text-gray-500">
                    Ultima actualizacion: {formatPublishedDate(LAST_UPDATED)}
                </p>

                <div className="mt-6 rounded-xl border bg-white p-4 shadow-sm sm:mt-8 sm:p-8">
                    <Section title="1. Identificacion del proveedor">
                        <p>
                            Estos Terminos y Condiciones regulan el acceso y uso del sitio web y la plataforma de ticketing de {LEGAL_ENTITY_NAME}, identificada comercialmente como {LEGAL_COMMERCIAL_NAME}, con domicilio en {LEGAL_ADDRESS}.
                        </p>
                        {LEGAL_RUC && (
                            <p>
                                RUC: {LEGAL_RUC}.
                            </p>
                        )}
                        <p>
                            Para consultas sobre compras, entradas o atencion al consumidor puedes escribir a {LEGAL_EMAIL} o comunicarte al {LEGAL_PHONE}.
                        </p>
                    </Section>

                    <Section title="2. Aceptacion y alcance">
                        <p>
                            Al navegar, registrarte, comprar entradas o utilizar cualquiera de las funcionalidades del sitio aceptas estos Terminos y Condiciones, asi como la <Link href="/privacidad" className="text-[hsl(210,100%,40%)] hover:underline">Politica de Privacidad</Link>.
                        </p>
                        <p>
                            Si no estas de acuerdo con estos terminos, debes abstenerte de utilizar la plataforma.
                        </p>
                    </Section>

                    <Section title="3. Cuenta de usuario y seguridad">
                        <p>
                            Para acceder a determinadas funcionalidades podras crear una cuenta proporcionando informacion veraz, completa y actualizada. Eres responsable de custodiar tus credenciales y de todas las actividades realizadas desde tu cuenta.
                        </p>
                        <p>
                            Debes notificar inmediatamente cualquier uso no autorizado de tu cuenta. {LEGAL_COMMERCIAL_NAME} puede suspender o bloquear cuentas cuando detecte actividad fraudulenta, incumplimiento de estos terminos o riesgos de seguridad.
                        </p>
                    </Section>

                    <Section title="4. Informacion de eventos, disponibilidad y precios">
                        <p>
                            La informacion sobre eventos, fechas, sedes, aforos, tipos de entrada, beneficios y restricciones se publica de acuerdo con la informacion proporcionada por la organizacion del evento o la propia federacion.
                        </p>
                        <p>
                            Los precios, comisiones, descuentos, promociones y disponibilidad pueden variar hasta antes de la confirmacion del pago. La reserva de stock solo se considera confirmada cuando el pago ha sido aprobado y la orden ha pasado a estado pagado.
                        </p>
                    </Section>

                    <Section title="5. Compra de entradas y medios de pago">
                        <p>
                            Las compras realizadas en la plataforma estan sujetas a validacion de datos, disponibilidad y aprobacion del medio de pago. La plataforma utiliza pasarelas y proveedores externos de pago para procesar transacciones, por lo que determinadas validaciones o rechazos pueden depender de terceros.
                        </p>
                        <p>
                            El usuario es responsable de verificar que los datos de facturacion, identidad y contacto sean correctos antes de confirmar la compra.
                        </p>
                    </Section>

                    <Section title="6. Emision y uso de entradas">
                        <p>
                            Una vez aprobado el pago, las entradas digitales se ponen a disposicion del usuario en su cuenta y/o se remiten a los canales definidos por la plataforma. Cada entrada es personal o nominativa cuando asi se indique y puede incorporar controles de seguridad y validacion.
                        </p>
                        <p>
                            El titular debe conservar su codigo QR o medio de acceso y presentarlo en el ingreso cuando corresponda. La reventa, duplicacion, alteracion o uso no autorizado de entradas puede ocasionar su anulacion sin derecho a reembolso.
                        </p>
                    </Section>

                    <Section title="7. Cambios, cancelaciones y devoluciones">
                        <p>
                            La reprogramacion, suspension, cancelacion o modificacion de un evento puede depender de la organizacion del evento, de la autoridad competente o de causas de fuerza mayor. En esos casos, la plataforma aplicara las instrucciones del organizador y la normativa de proteccion al consumidor que resulte aplicable.
                        </p>
                        <p>
                            Los reembolsos, cambios o anulaciones no procederan cuando el evento haya sido correctamente ejecutado y el impedimento sea imputable al usuario, salvo disposicion legal distinta o politica expresa del evento.
                        </p>
                    </Section>

                    <Section title="8. Conductas prohibidas">
                        <ul className="list-disc space-y-2 pl-5">
                            <li>Usar la plataforma con fines fraudulentos, ilicitos o contrarios a la buena fe.</li>
                            <li>Suplantar identidad, manipular promociones o interferir con la disponibilidad del sitio.</li>
                            <li>Intentar vulnerar medidas de seguridad, extraer informacion de forma automatizada o alterar el funcionamiento del servicio.</li>
                        </ul>
                    </Section>

                    <Section title="9. Propiedad intelectual">
                        <p>
                            Los signos distintivos, disenos, textos, imagenes, software, bases de datos y demas contenidos del sitio son de titularidad de {LEGAL_ENTITY_NAME} o de terceros autorizados. Su uso no autorizado esta prohibido.
                        </p>
                    </Section>

                    <Section title="10. Responsabilidad">
                        <p>
                            {LEGAL_COMMERCIAL_NAME} adopta medidas razonables para la continuidad y seguridad del sitio, pero no garantiza la ausencia absoluta de interrupciones, errores, ataques o eventos ajenos a su control. Tampoco sera responsable por incumplimientos atribuibles a terceros, fallas del usuario, entidades financieras, pasarelas de pago, proveedores de telecomunicaciones o casos fortuitos y de fuerza mayor.
                        </p>
                    </Section>

                    <Section title="11. Proteccion de datos personales">
                        <p>
                            El tratamiento de datos personales se realiza conforme a la Ley N.&deg; 29733, su reglamento vigente y las demas normas peruanas aplicables. Para mas informacion revisa la <Link href="/privacidad" className="text-[hsl(210,100%,40%)] hover:underline">Politica de Privacidad</Link>.
                        </p>
                    </Section>

                    <Section title="12. Libro de Reclamaciones y atencion al consumidor">
                        <p>
                            El usuario puede registrar quejas o reclamos a traves del <Link href="/libro-de-reclamaciones" className="text-[hsl(210,100%,40%)] hover:underline">Libro de Reclamaciones</Link> disponible en este sitio o escribir a {COMPLAINTS_EMAIL}. La formulacion del reclamo no impide acudir a otras vias de solucion de controversias ni constituye una denuncia ante Indecopi.
                        </p>
                    </Section>

                    <Section title="13. Modificaciones y ley aplicable">
                        <p>
                            {LEGAL_ENTITY_NAME} puede actualizar estos Terminos y Condiciones para adecuarlos a cambios operativos, contractuales o regulatorios. La version vigente sera la publicada en el sitio.
                        </p>
                        <p>
                            Estos terminos se interpretan conforme a las leyes de la Republica del Peru.
                        </p>
                    </Section>
                </div>
            </div>
        </div>
    )
}
