import { Resend } from "resend"
import { 
    queuePurchaseConfirmation, 
    queueWelcomeEmail, 
    queuePasswordResetEmail,
    queueCourtesyClaimedEmail 
} from "./email-queue"

const resendApiKey = process.env.RESEND_API_KEY
const resend = resendApiKey ? new Resend(resendApiKey) : null

const FROM_EMAIL = process.env.EMAIL_FROM || "Ticketing FDNDA <tickets@fdnda.org.pe>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Ticketing FDNDA"
const BRAND_TAGLINE = "Federaci&oacute;n Deportiva Nacional de Deportes Acu&aacute;ticos"

// Flag para usar cola o envío directo
const USE_EMAIL_QUEUE = process.env.USE_EMAIL_QUEUE === "true"

export interface EmailResult {
    success: boolean
    messageId?: string
    error?: string
}

function getResendClient(): Resend {
    if (!resend) {
        throw new Error("RESEND_API_KEY is not set")
    }
    return resend
}

/**
 * Send email verification link
 */
export async function sendVerificationEmail(
    email: string,
    name: string,
    token: string
): Promise<EmailResult> {
    const verifyUrl = `${APP_URL}/verify-email?token=${token}`

    try {
        const { data, error } = await getResendClient().emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: `Verifica tu cuenta en ${APP_NAME}`,
            html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verifica tu cuenta</title>
        </head>
        <body style="margin:0; padding:0; background-color:#eef2f7;">
          <span style="display:none; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">
            Verifica tu correo para activar tu cuenta en ${APP_NAME}.
          </span>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eef2f7; padding:24px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 24px rgba(15,23,42,0.08);">
                  <tr>
                    <td style="padding:28px 32px; background:linear-gradient(135deg, #0b3d91 0%, #0b6bd3 100%); color:#ffffff;">
                      <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:600;">${APP_NAME}</div>
                      <div style="font-size:26px; font-weight:700; margin-top:6px;">Verifica tu cuenta</div>
                      <div style="font-size:12px; opacity:0.85; margin-top:6px;">${BRAND_TAGLINE}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px; color:#1f2937; font-size:16px; line-height:1.6;">
                      <p style="margin:0 0 12px;">Hola ${name},</p>
                      <p style="margin:0 0 24px;">Gracias por registrarte en ${APP_NAME}. Para completar tu registro y poder comprar entradas, verifica tu correo electr&oacute;nico.</p>
                      <div style="text-align:center; margin:24px 0 28px;">
                        <a href="${verifyUrl}" style="background:#0b5fff; color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">
                          Verificar mi cuenta
                        </a>
                      </div>
                      <p style="margin:0 0 8px; font-size:13px; color:#6b7280;">Si el bot&oacute;n no funciona, copia y pega este enlace en tu navegador:</p>
                      <p style="margin:0; font-size:12px;">
                        <a href="${verifyUrl}" style="color:#0b5fff; word-break:break-all;">${verifyUrl}</a>
                      </p>
                      <div style="margin-top:24px; padding:12px 14px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; font-size:12px; color:#6b7280;">
                        Este enlace expira en 24 horas. Si no solicitaste esta verificaci&oacute;n, puedes ignorar este correo.
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 32px 24px; background:#f8fafc; font-size:12px; color:#94a3b8; text-align:center;">
                      &copy; ${new Date().getFullYear()} ${APP_NAME}. Todos los derechos reservados.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
        })

        if (error) {
            console.error("Resend verification email error:", error)
            return { success: false, error: error.message }
        }

        if (data?.id) {
            console.info("Resend verification email sent:", data.id)
        }
        return { success: true, messageId: data?.id }
    } catch (err) {
        console.error("Resend verification email exception:", err)
        return { success: false, error: (err as Error).message }
    }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
    email: string,
    name: string,
    token: string
): Promise<EmailResult> {
    const resetUrl = `${APP_URL}/reset-password?token=${token}`

    try {
        const { data, error } = await getResendClient().emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: `Restablecer contraseña - ${APP_NAME}`,
            html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Restablecer contrase&ntilde;a</title>
        </head>
        <body style="margin:0; padding:0; background-color:#eef2f7;">
          <span style="display:none; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">
            Restablece tu contrase&ntilde;a de forma segura en ${APP_NAME}.
          </span>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eef2f7; padding:24px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 24px rgba(15,23,42,0.08);">
                  <tr>
                    <td style="padding:28px 32px; background:linear-gradient(135deg, #0b3d91 0%, #0b6bd3 100%); color:#ffffff;">
                      <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:600;">${APP_NAME}</div>
                      <div style="font-size:26px; font-weight:700; margin-top:6px;">Restablecer contrase&ntilde;a</div>
                      <div style="font-size:12px; opacity:0.85; margin-top:6px;">${BRAND_TAGLINE}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px; color:#1f2937; font-size:16px; line-height:1.6;">
                      <p style="margin:0 0 12px;">Hola ${name},</p>
                      <p style="margin:0 0 24px;">Recibimos una solicitud para restablecer tu contrase&ntilde;a. Haz clic en el bot&oacute;n de abajo para crear una nueva.</p>
                      <div style="text-align:center; margin:24px 0 28px;">
                        <a href="${resetUrl}" style="background:#dc2626; color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">
                          Restablecer contrase&ntilde;a
                        </a>
                      </div>
                      <div style="margin-top:8px; padding:12px 14px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; font-size:12px; color:#991b1b;">
                        Este enlace expira en 1 hora. Si no solicitaste el cambio, ignora este correo.
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 32px 24px; background:#f8fafc; font-size:12px; color:#94a3b8; text-align:center;">
                      &copy; ${new Date().getFullYear()} ${APP_NAME}. Todos los derechos reservados.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
        })

        if (error) {
            console.error("Resend password reset email error:", error)
            return { success: false, error: error.message }
        }

        if (data?.id) {
            console.info("Resend password reset email sent:", data.id)
        }
        return { success: true, messageId: data?.id }
    } catch (err) {
        console.error("Resend password reset email exception:", err)
        return { success: false, error: (err as Error).message }
    }
}

/**
 * Send purchase confirmation email with tickets
 */
export async function sendPurchaseConfirmationEmail(
    email: string,
    name: string,
    orderId: string,
    eventTitle: string,
    ticketCount: number,
    totalAmount: string
): Promise<EmailResult> {
    const ticketsUrl = `${APP_URL}/mi-cuenta/entradas`

    try {
        const { data, error } = await getResendClient().emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: `Compra confirmada - ${eventTitle}`,
            html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Compra confirmada</title>
        </head>
        <body style="margin:0; padding:0; background-color:#eef2f7;">
          <span style="display:none; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">
            Tu compra fue confirmada y tus entradas ya estan disponibles.
          </span>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eef2f7; padding:24px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 24px rgba(15,23,42,0.08);">
                  <tr>
                    <td style="padding:28px 32px; background:linear-gradient(135deg, #0b3d91 0%, #0b6bd3 100%); color:#ffffff;">
                      <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:600;">${APP_NAME}</div>
                      <div style="font-size:26px; font-weight:700; margin-top:6px;">Compra confirmada</div>
                      <div style="font-size:12px; opacity:0.85; margin-top:6px;">${BRAND_TAGLINE}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px; color:#1f2937; font-size:16px; line-height:1.6;">
                      <p style="margin:0 0 12px;">Hola ${name},</p>
                      <p style="margin:0 0 24px;">Gracias por tu compra. Tus entradas ya est&aacute;n disponibles.</p>
                      <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; margin-bottom:24px;">
                        <p style="margin:0 0 10px;"><strong>Evento:</strong> ${eventTitle}</p>
                        <p style="margin:0 0 10px;"><strong>Orden:</strong> #${orderId.slice(-8).toUpperCase()}</p>
                        <p style="margin:0 0 10px;"><strong>Entradas:</strong> ${ticketCount}</p>
                        <p style="margin:0;"><strong>Total pagado:</strong> ${totalAmount}</p>
                      </div>
                      <div style="text-align:center; margin:24px 0 28px;">
                        <a href="${ticketsUrl}" style="background:#0b5fff; color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">
                          Ver mis entradas
                        </a>
                      </div>
                      <div style="margin-top:8px; padding:12px 14px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; font-size:12px; color:#065f46;">
                        Recuerda presentar tu c&oacute;digo QR en el ingreso. El QR se renueva diariamente para eventos de varios d&iacute;as.
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 32px 24px; background:#f8fafc; font-size:12px; color:#94a3b8; text-align:center;">
                      &copy; ${new Date().getFullYear()} ${APP_NAME}. Todos los derechos reservados.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
        })

        if (error) {
            console.error("Resend purchase email error:", error)
            return { success: false, error: error.message }
        }

        if (data?.id) {
            console.info("Resend purchase email sent:", data.id)
        }
        return { success: true, messageId: data?.id }
    } catch (err) {
        console.error("Resend purchase email exception:", err)
        return { success: false, error: (err as Error).message }
    }
}

// ==================== QUEUED EMAIL FUNCTIONS ====================

/**
 * Send purchase confirmation (queued or direct based on config)
 */
export async function sendPurchaseEmail(
    email: string,
    name: string,
    orderId: string,
    eventTitle: string,
    ticketCount: number,
    totalAmount: string
): Promise<EmailResult> {
    if (USE_EMAIL_QUEUE) {
        try {
            const jobId = await queuePurchaseConfirmation(email, name, orderId, eventTitle, ticketCount, totalAmount)
            return { success: true, messageId: jobId }
        } catch (err) {
            console.error("Failed to queue purchase email:", err)
            // Fallback to direct send
            return sendPurchaseConfirmationEmail(email, name, orderId, eventTitle, ticketCount, totalAmount)
        }
    }
    return sendPurchaseConfirmationEmail(email, name, orderId, eventTitle, ticketCount, totalAmount)
}

/**
 * Send verification email (queued or direct)
 */
export async function sendVerificationEmailQueued(
    email: string,
    name: string,
    token: string
): Promise<EmailResult> {
    const verifyUrl = `${APP_URL}/verify-email?token=${token}`
    
    if (USE_EMAIL_QUEUE) {
        try {
            const jobId = await queueWelcomeEmail(email, name, verifyUrl)
            return { success: true, messageId: jobId }
        } catch (err) {
            console.error("Failed to queue verification email:", err)
            return sendVerificationEmail(email, name, token)
        }
    }
    return sendVerificationEmail(email, name, token)
}

/**
 * Send password reset email (queued or direct)
 */
export async function sendPasswordResetEmailQueued(
    email: string,
    name: string,
    token: string
): Promise<EmailResult> {
    const resetUrl = `${APP_URL}/reset-password?token=${token}`
    
    if (USE_EMAIL_QUEUE) {
        try {
            const jobId = await queuePasswordResetEmail(email, name, resetUrl)
            return { success: true, messageId: jobId }
        } catch (err) {
            console.error("Failed to queue password reset email:", err)
            return sendPasswordResetEmail(email, name, token)
        }
    }
    return sendPasswordResetEmail(email, name, token)
}

/**
 * Send courtesy claimed email (queued)
 */
export async function sendCourtesyClaimedEmail(
    email: string,
    name: string,
    eventTitle: string,
    ticketTypeName: string
): Promise<EmailResult> {
    if (USE_EMAIL_QUEUE) {
        try {
            const jobId = await queueCourtesyClaimedEmail(email, name, eventTitle, ticketTypeName)
            return { success: true, messageId: jobId }
        } catch (err) {
            console.error("Failed to queue courtesy email:", err)
            return { success: false, error: (err as Error).message }
        }
    }
    
    // Direct send fallback
    try {
        const ticketsUrl = `${APP_URL}/mi-cuenta/entradas`
        const { data, error } = await getResendClient().emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: `Cortesía reclamada - ${eventTitle}`,
            html: `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Cortes&iacute;a reclamada</title>
                </head>
                <body style="margin:0; padding:0; background-color:#eef2f7;">
                  <span style="display:none; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">
                    Tu cortes&iacute;a ha sido registrada en ${APP_NAME}.
                  </span>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eef2f7; padding:24px 12px;">
                    <tr>
                      <td align="center">
                        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 24px rgba(15,23,42,0.08);">
                          <tr>
                            <td style="padding:28px 32px; background:linear-gradient(135deg, #0b3d91 0%, #0b6bd3 100%); color:#ffffff;">
                              <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:600;">${APP_NAME}</div>
                              <div style="font-size:26px; font-weight:700; margin-top:6px;">Cortes&iacute;a reclamada</div>
                              <div style="font-size:12px; opacity:0.85; margin-top:6px;">${BRAND_TAGLINE}</div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:32px; color:#1f2937; font-size:16px; line-height:1.6;">
                              <p style="margin:0 0 12px;">Hola <strong>${name}</strong>,</p>
                              <p style="margin:0 0 24px;">Has reclamado exitosamente tu entrada de cortes&iacute;a:</p>
                              <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; margin-bottom:24px;">
                                <p style="margin:0 0 10px;"><strong>Evento:</strong> ${eventTitle}</p>
                                <p style="margin:0;"><strong>Tipo:</strong> ${ticketTypeName}</p>
                              </div>
                              <div style="text-align:center; margin:24px 0 28px;">
                                <a href="${ticketsUrl}" style="background:#0b5fff; color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">
                                  Ver mi entrada
                                </a>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:16px 32px 24px; background:#f8fafc; font-size:12px; color:#94a3b8; text-align:center;">
                              &copy; ${new Date().getFullYear()} ${APP_NAME}. Todos los derechos reservados.
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </body>
                </html>
            `,
        })
        if (error) return { success: false, error: error.message }
        return { success: true, messageId: data?.id }
    } catch (err) {
        return { success: false, error: (err as Error).message }
    }
}
