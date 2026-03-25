import { sendTransactionalEmail } from "@/lib/email-provider"
import {
    COMPLAINTS_EMAIL,
    LEGAL_COMMERCIAL_NAME,
    LEGAL_EMAIL,
    LEGAL_ENTITY_NAME,
} from "@/lib/legal"

type ComplaintBookMailInput = {
    ticketNumber: string
    customerName: string
    customerEmail: string
    type: "RECLAMO" | "QUEJA"
    subjectDescription: string
}

type ComplaintBookResolutionMailInput = {
    ticketNumber: string
    customerName: string
    customerEmail: string
    status: "RESPONDED" | "CLOSED"
    responseDetail: string
}

function buildComplaintTicketNumber() {
    const now = new Date()
    const pad = (value: number) => value.toString().padStart(2, "0")

    return `LR-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

export async function sendComplaintBookEmails(input: ComplaintBookMailInput) {
    const from = process.env.EMAIL_FROM || `${LEGAL_COMMERCIAL_NAME} <${LEGAL_EMAIL}>`
    const internalEmail = process.env.COMPLAINTS_EMAIL || COMPLAINTS_EMAIL

    await Promise.allSettled([
        sendTransactionalEmail({
            from,
            to: input.customerEmail,
            subject: `Constancia de Libro de Reclamaciones ${input.ticketNumber}`,
            html: `
                <html lang="es">
                  <body style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#1f2937;">
                    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;">
                      <p style="margin:0 0 12px;">Hola ${input.customerName},</p>
                      <p style="margin:0 0 16px;">Hemos registrado tu ${input.type.toLowerCase()} en el Libro de Reclamaciones de ${LEGAL_ENTITY_NAME}.</p>
                      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:20px 0;">
                        <p style="margin:0 0 8px;"><strong>Numero de constancia:</strong> ${input.ticketNumber}</p>
                        <p style="margin:0 0 8px;"><strong>Tipo:</strong> ${input.type}</p>
                        <p style="margin:0;"><strong>Detalle registrado:</strong> ${input.subjectDescription}</p>
                      </div>
                      <p style="margin:0 0 12px;">Tu solicitud sera atendida dentro del plazo legal aplicable. Conserva este correo como constancia.</p>
                      <p style="margin:0;">Si necesitas apoyo adicional, escribenos a ${internalEmail}.</p>
                    </div>
                  </body>
                </html>
            `,
        }),
        sendTransactionalEmail({
            from,
            to: internalEmail,
            subject: `Nuevo registro de Libro de Reclamaciones ${input.ticketNumber}`,
            html: `
                <html lang="es">
                  <body style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#1f2937;">
                    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;">
                      <p style="margin:0 0 12px;">Se registro una nueva hoja en el Libro de Reclamaciones.</p>
                      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:20px 0;">
                        <p style="margin:0 0 8px;"><strong>Numero de constancia:</strong> ${input.ticketNumber}</p>
                        <p style="margin:0 0 8px;"><strong>Consumidor:</strong> ${input.customerName}</p>
                        <p style="margin:0 0 8px;"><strong>Email:</strong> ${input.customerEmail}</p>
                        <p style="margin:0 0 8px;"><strong>Tipo:</strong> ${input.type}</p>
                        <p style="margin:0;"><strong>Descripcion:</strong> ${input.subjectDescription}</p>
                      </div>
                    </div>
                  </body>
                </html>
            `,
        }),
    ])
}

export async function sendComplaintBookResolutionEmail(
    input: ComplaintBookResolutionMailInput
) {
    const from = process.env.EMAIL_FROM || `${LEGAL_COMMERCIAL_NAME} <${LEGAL_EMAIL}>`
    const internalEmail = process.env.COMPLAINTS_EMAIL || COMPLAINTS_EMAIL

    await Promise.allSettled([
        sendTransactionalEmail({
            from,
            to: input.customerEmail,
            subject: `Respuesta a tu solicitud ${input.ticketNumber}`,
            html: `
                <html lang="es">
                  <body style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#1f2937;">
                    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;">
                      <p style="margin:0 0 12px;">Hola ${input.customerName},</p>
                      <p style="margin:0 0 16px;">Tenemos una actualizacion sobre tu registro del Libro de Reclamaciones.</p>
                      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:20px 0;">
                        <p style="margin:0 0 8px;"><strong>Numero de constancia:</strong> ${input.ticketNumber}</p>
                        <p style="margin:0 0 8px;"><strong>Estado:</strong> ${input.status === "RESPONDED" ? "Respondido" : "Cerrado"}</p>
                        <p style="margin:0;"><strong>Respuesta:</strong> ${input.responseDetail}</p>
                      </div>
                      <p style="margin:0;">Si necesitas mayor detalle, escribenos a ${internalEmail}.</p>
                    </div>
                  </body>
                </html>
            `,
        }),
        sendTransactionalEmail({
            from,
            to: internalEmail,
            subject: `Respuesta enviada para ${input.ticketNumber}`,
            html: `
                <html lang="es">
                  <body style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#1f2937;">
                    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;">
                      <p style="margin:0 0 12px;">Se envio una respuesta desde el panel interno.</p>
                      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:20px 0;">
                        <p style="margin:0 0 8px;"><strong>Numero de constancia:</strong> ${input.ticketNumber}</p>
                        <p style="margin:0 0 8px;"><strong>Consumidor:</strong> ${input.customerName}</p>
                        <p style="margin:0 0 8px;"><strong>Email:</strong> ${input.customerEmail}</p>
                        <p style="margin:0 0 8px;"><strong>Estado:</strong> ${input.status}</p>
                        <p style="margin:0;"><strong>Respuesta:</strong> ${input.responseDetail}</p>
                      </div>
                    </div>
                  </body>
                </html>
            `,
        }),
    ])
}

export { buildComplaintTicketNumber }
