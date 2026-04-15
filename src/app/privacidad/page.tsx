import type { Metadata } from "next"
import {
    LEGAL_COMMERCIAL_NAME,
    LEGAL_EMAIL,
    LEGAL_ENTITY_NAME,
    PERSONAL_DATA_BANK_CODE,
    PERSONAL_DATA_BANK_NAME,
    PRIVACY_EMAIL,
    formatPublishedDate,
} from "@/lib/legal"

const LAST_UPDATED = "2026-03-23"

export const metadata: Metadata = {
    title: "Politica de Privacidad - Ticketing FDNDA",
    description:
        "Politica de Privacidad de Ticketing FDNDA para el tratamiento de datos personales conforme a la normativa peruana.",
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

export default function PrivacidadPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-12">
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Politica de Privacidad</h1>
                <p className="mt-2 text-sm text-gray-500">
                    Ultima actualizacion: {formatPublishedDate(LAST_UPDATED)}
                </p>

                <div className="mt-6 rounded-xl border bg-white p-4 shadow-sm sm:mt-8 sm:p-8">
                    <Section title="1. Responsable del tratamiento">
                        <p>
                            {LEGAL_ENTITY_NAME}, a traves de {LEGAL_COMMERCIAL_NAME}, es responsable del tratamiento de los datos personales que se recopilan mediante este sitio web, formularios, procesos de registro, compra de entradas, atencion al usuario y Libro de Reclamaciones.
                        </p>
                        <p>
                            Esta politica se emite de conformidad con la Ley N.&deg; 29733, Ley de Proteccion de Datos Personales, y su reglamento vigente en el Peru.
                        </p>
                    </Section>

                    <Section title="2. Datos personales que recopilamos">
                        <ul className="list-disc space-y-2 pl-5">
                            <li>Datos de identificacion: nombres, apellidos, tipo y numero de documento.</li>
                            <li>Datos de contacto: correo electronico, telefono y direccion.</li>
                            <li>Datos de cuenta: credenciales de acceso y verificacion.</li>
                            <li>Datos de compra: ordenes, tickets, facturacion, pagos y eventos asociados.</li>
                            <li>Datos de navegacion y soporte: registros tecnicos, incidentes, formularios de contacto y reclamaciones.</li>
                        </ul>
                    </Section>

                    <Section title="3. Finalidades del tratamiento">
                        <ul className="list-disc space-y-2 pl-5">
                            <li>Gestionar el registro de usuarios y la autenticacion.</li>
                            <li>Procesar compras, emitir entradas, validar accesos y atender devoluciones o incidencias.</li>
                            <li>Cumplir obligaciones contables, tributarias, de consumo y de seguridad.</li>
                            <li>Atender consultas, solicitudes, quejas, reclamos y requerimientos de autoridades competentes.</li>
                            <li>Prevenir fraude, accesos indebidos y usos abusivos de la plataforma.</li>
                            <li>Enviar comunicaciones operativas vinculadas a la cuenta o a una compra realizada.</li>
                        </ul>
                    </Section>

                    <Section title="4. Base de legitimacion">
                        <p>
                            El tratamiento se realiza, segun corresponda, con base en el consentimiento del titular, la ejecucion de la relacion contractual derivada del uso de la plataforma o la compra de entradas, y el cumplimiento de obligaciones legales aplicables a {LEGAL_ENTITY_NAME}.
                        </p>
                    </Section>

                    <Section title="5. Destinatarios y encargados de tratamiento">
                        <p>
                            Para operar la plataforma podemos compartir datos con proveedores que actuan por cuenta de {LEGAL_ENTITY_NAME}, tales como pasarelas de pago, servicios de correo transaccional, infraestructura cloud, almacenamiento, observabilidad, analitica y soporte tecnologico, siempre dentro de las finalidades descritas y bajo medidas de seguridad razonables.
                        </p>
                        <p>
                            En la operacion actual del sitio, ello puede incluir proveedores de pago, servicios de email, hosting, almacenamiento y herramientas de analitica o monitoreo.
                        </p>
                    </Section>

                    <Section title="6. Conservacion de datos">
                        <p>
                            Conservaremos los datos personales solo durante el tiempo necesario para cumplir las finalidades indicadas, atender obligaciones legales, contractuales y de auditoria, o resolver controversias. Determinados datos de compra y facturacion pueden mantenerse por los plazos exigidos por la normativa aplicable.
                        </p>
                    </Section>

                    <Section title="7. Derechos del titular">
                        <p>
                            El titular puede ejercer sus derechos de acceso, rectificacion, cancelacion, oposicion y demas derechos reconocidos por la normativa peruana de proteccion de datos personales. Para ello puede escribir a {PRIVACY_EMAIL} desde el correo asociado a su solicitud, indicando claramente el derecho que desea ejercer y adjuntando la informacion necesaria para validar su identidad.
                        </p>
                    </Section>

                    <Section title="8. Seguridad de la informacion">
                        <p>
                            Aplicamos medidas tecnicas, organizativas y de control orientadas a proteger los datos personales contra perdida, uso indebido, acceso no autorizado, alteracion o divulgacion. Sin embargo, ninguna medida es absolutamente infalible y el usuario tambien debe proteger sus credenciales y dispositivos.
                        </p>
                    </Section>

                    <Section title="9. Cookies, analitica y tecnologias similares">
                        <p>
                            El sitio puede utilizar cookies o tecnologias similares para recordar sesiones, mejorar la experiencia, medir rendimiento, detectar incidentes y analizar el uso de la plataforma. Algunas de estas herramientas pueden provenir de terceros.
                        </p>
                    </Section>

                    <Section title="10. Banco de datos personales">
                        <p>
                            El tratamiento de datos personales se realiza conforme a la normativa aplicable y, cuando corresponda, respecto de bancos de datos personales debidamente gestionados por {LEGAL_ENTITY_NAME}.
                        </p>
                        {PERSONAL_DATA_BANK_NAME && (
                            <p>
                                Banco de datos declarado: {PERSONAL_DATA_BANK_NAME}
                                {PERSONAL_DATA_BANK_CODE ? ` (codigo de registro: ${PERSONAL_DATA_BANK_CODE})` : ""}.
                            </p>
                        )}
                    </Section>

                    <Section title="11. Menores de edad">
                        <p>
                            Cuando el tratamiento involucre datos de menores de edad, este debera realizarse con la intervencion o autorizacion del padre, madre o representante legal, conforme a la normativa vigente y a la naturaleza del servicio contratado.
                        </p>
                    </Section>

                    <Section title="12. Cambios a esta politica">
                        <p>
                            Podemos actualizar esta Politica de Privacidad por cambios normativos, operativos o tecnologicos. La version vigente sera la publicada en este sitio.
                        </p>
                        <p>
                            Si tienes dudas sobre el tratamiento de tus datos personales, puedes escribir a {LEGAL_EMAIL}.
                        </p>
                    </Section>
                </div>
            </div>
        </div>
    )
}
