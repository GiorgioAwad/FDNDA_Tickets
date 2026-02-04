import { Resend } from "resend"
import { 
    queuePurchaseConfirmation, 
    queueWelcomeEmail, 
    queuePasswordResetEmail,
    queueCourtesyClaimedEmail 
} from "./email-queue"

const resendApiKey = process.env.RESEND_API_KEY
const resend = resendApiKey ? new Resend(resendApiKey) : null

const FROM_EMAIL = process.env.EMAIL_FROM || "FDNDA Tickets <tickets@fdnda.org.pe>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "FDNDA Tickets"

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
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #003366 0%, #0066cc 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🏊 FDNDA</h1>
            <p style="color: #e0e0e0; margin: 10px 0 0 0;">Federación Deportiva Nacional de Deportes Acuáticos</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #003366; margin-top: 0;">¡Hola, ${name}!</h2>
            
            <p>Gracias por registrarte en ${APP_NAME}. Para completar tu registro y poder comprar entradas, por favor verifica tu correo electrónico.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}" style="background: linear-gradient(135deg, #0066cc 0%, #003366 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
                Verificar mi cuenta
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              Si no puedes hacer clic en el botón, copia y pega este enlace en tu navegador:<br>
              <a href="${verifyUrl}" style="color: #0066cc; word-break: break-all;">${verifyUrl}</a>
            </p>
            
            <p style="font-size: 14px; color: #666;">
              Este enlace expirará en 24 horas. Si no solicitaste esta verificación, puedes ignorar este correo.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
            <p>© ${new Date().getFullYear()} FDNDA - Todos los derechos reservados</p>
          </div>
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
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #003366 0%, #0066cc 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🏊 FDNDA</h1>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #003366; margin-top: 0;">Restablecer contraseña</h2>
            
            <p>Hola ${name},</p>
            <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón de abajo para crear una nueva.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background: linear-gradient(135deg, #0066cc 0%, #003366 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Restablecer contraseña
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              Este enlace expirará en 1 hora. Si no solicitaste el cambio, ignora este correo.
            </p>
          </div>
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
            subject: `✅ Compra confirmada - ${eventTitle}`,
            html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #003366 0%, #0066cc 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🏊 FDNDA</h1>
            <p style="color: #4ade80; font-size: 20px; margin: 10px 0 0 0;">✅ ¡Compra Confirmada!</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #003366; margin-top: 0;">¡Gracias por tu compra, ${name}!</h2>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0066cc;">
              <p style="margin: 5px 0;"><strong>Evento:</strong> ${eventTitle}</p>
              <p style="margin: 5px 0;"><strong>Orden:</strong> #${orderId.slice(-8).toUpperCase()}</p>
              <p style="margin: 5px 0;"><strong>Entradas:</strong> ${ticketCount}</p>
              <p style="margin: 5px 0;"><strong>Total pagado:</strong> ${totalAmount}</p>
            </div>
            
            <p>Tus entradas ya están disponibles. Puedes verlas y descargarlas desde tu cuenta.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${ticketsUrl}" style="background: linear-gradient(135deg, #0066cc 0%, #003366 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Ver mis entradas
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              Recuerda presentar tu QR en el ingreso al evento. El código QR se renueva diariamente para eventos de varios días.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
            <p>© ${new Date().getFullYear()} FDNDA - Todos los derechos reservados</p>
          </div>
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
            subject: `🎁 Cortesía reclamada - ${eventTitle}`,
            html: `
                <!DOCTYPE html>
                <html>
                <body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0;">¡Cortesía Reclamada!</h1>
                    </div>
                    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                        <p>Hola <strong>${name}</strong>,</p>
                        <p>Has reclamado exitosamente tu entrada de cortesía:</p>
                        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p><strong>Evento:</strong> ${eventTitle}</p>
                            <p><strong>Tipo:</strong> ${ticketTypeName}</p>
                        </div>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${ticketsUrl}" style="background: #059669; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold;">Ver mi entrada</a>
                        </div>
                    </div>
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
