import { Resend } from "resend"
import { 
    dequeueEmail, 
    completeJob, 
    failJob, 
    getQueueStats,
    type EmailJob 
} from "./email-queue"

// ==================== EMAIL CLIENT ====================

const resend = process.env.RESEND_API_KEY 
    ? new Resend(process.env.RESEND_API_KEY)
    : null

const FROM_EMAIL = process.env.EMAIL_FROM || "FDNDA Tickets <tickets@fdnda.org.pe>"
const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000"

// ==================== EMAIL TEMPLATES ====================

function getPurchaseConfirmationTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, orderId, eventTitle, ticketCount, totalAmount } = data
    
    return {
        subject: `✅ Compra confirmada - ${eventTitle}`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 32px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">¡Compra Exitosa!</h1>
                    </div>
                    <div style="padding: 32px;">
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Hola <strong>${userName}</strong>,
                        </p>
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Tu compra ha sido procesada correctamente. Aquí están los detalles:
                        </p>
                        <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                            <p style="margin: 0 0 12px 0;"><strong>Evento:</strong> ${eventTitle}</p>
                            <p style="margin: 0 0 12px 0;"><strong>Entradas:</strong> ${ticketCount}</p>
                            <p style="margin: 0 0 12px 0;"><strong>Total:</strong> ${totalAmount}</p>
                            <p style="margin: 0; color: #6b7280; font-size: 14px;"><strong>Orden:</strong> ${orderId}</p>
                        </div>
                        <div style="text-align: center; margin-bottom: 24px;">
                            <a href="${BASE_URL}/mi-cuenta/entradas" style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                Ver mis entradas
                            </a>
                        </div>
                        <p style="color: #6b7280; font-size: 14px; text-align: center;">
                            Presenta el código QR de tu entrada en el evento.
                        </p>
                    </div>
                    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="color: #6b7280; font-size: 12px; margin: 0;">
                            © ${new Date().getFullYear()} FDNDA. Todos los derechos reservados.
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `,
    }
}

function getWelcomeTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, verifyUrl } = data
    
    return {
        subject: "🎉 Bienvenido a FDNDA Tickets",
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 32px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">¡Bienvenido a FDNDA!</h1>
                    </div>
                    <div style="padding: 32px;">
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Hola <strong>${userName}</strong>,
                        </p>
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Gracias por registrarte. Para completar tu registro, verifica tu correo electrónico:
                        </p>
                        <div style="text-align: center; margin-bottom: 24px;">
                            <a href="${verifyUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                Verificar mi correo
                            </a>
                        </div>
                        <p style="color: #6b7280; font-size: 14px; text-align: center;">
                            Si no creaste esta cuenta, puedes ignorar este correo.
                        </p>
                    </div>
                    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="color: #6b7280; font-size: 12px; margin: 0;">
                            © ${new Date().getFullYear()} FDNDA. Todos los derechos reservados.
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `,
    }
}

function getPasswordResetTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, resetUrl } = data
    
    return {
        subject: "🔐 Restablecer contraseña - FDNDA",
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 32px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">Restablecer Contraseña</h1>
                    </div>
                    <div style="padding: 32px;">
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Hola <strong>${userName}</strong>,
                        </p>
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para continuar:
                        </p>
                        <div style="text-align: center; margin-bottom: 24px;">
                            <a href="${resetUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                Restablecer contraseña
                            </a>
                        </div>
                        <p style="color: #6b7280; font-size: 14px; text-align: center;">
                            Este enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.
                        </p>
                    </div>
                    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="color: #6b7280; font-size: 12px; margin: 0;">
                            © ${new Date().getFullYear()} FDNDA. Todos los derechos reservados.
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `,
    }
}

function getCourtesyClaimedTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, eventTitle, ticketTypeName } = data
    
    return {
        subject: `🎁 Cortesía reclamada - ${eventTitle}`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 32px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">¡Cortesía Reclamada!</h1>
                    </div>
                    <div style="padding: 32px;">
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Hola <strong>${userName}</strong>,
                        </p>
                        <p style="color: #374151; font-size: 16px; margin-bottom: 24px;">
                            Has reclamado exitosamente tu entrada de cortesía:
                        </p>
                        <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                            <p style="margin: 0 0 12px 0;"><strong>Evento:</strong> ${eventTitle}</p>
                            <p style="margin: 0;"><strong>Tipo:</strong> ${ticketTypeName}</p>
                        </div>
                        <div style="text-align: center; margin-bottom: 24px;">
                            <a href="${BASE_URL}/mi-cuenta/entradas" style="display: inline-block; background: #059669; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                                Ver mi entrada
                            </a>
                        </div>
                    </div>
                    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="color: #6b7280; font-size: 12px; margin: 0;">
                            © ${new Date().getFullYear()} FDNDA. Todos los derechos reservados.
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `,
    }
}

// ==================== SEND EMAIL ====================

async function sendEmail(job: EmailJob): Promise<void> {
    if (!resend) {
        console.log(`📧 [DEV] Email simulado: ${job.type} -> ${job.to}`)
        return
    }

    let template: { subject: string; html: string }

    switch (job.type) {
        case "purchase_confirmation":
            template = getPurchaseConfirmationTemplate(job.data)
            break
        case "welcome":
            template = getWelcomeTemplate(job.data)
            break
        case "password_reset":
            template = getPasswordResetTemplate(job.data)
            break
        case "courtesy_claimed":
            template = getCourtesyClaimedTemplate(job.data)
            break
        default:
            throw new Error(`Unknown email type: ${job.type}`)
    }

    const { error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: job.to,
        subject: template.subject,
        html: template.html,
    })

    if (error) {
        throw new Error(error.message)
    }
}

// ==================== PROCESS QUEUE ====================

let isProcessing = false

/**
 * Procesar la cola de emails (llamar desde cron o API route)
 */
export async function processEmailQueue(maxJobs: number = 10): Promise<{
    processed: number
    failed: number
}> {
    if (isProcessing) {
        console.log("⏳ Queue ya está siendo procesada")
        return { processed: 0, failed: 0 }
    }

    isProcessing = true
    let processed = 0
    let failed = 0

    try {
        for (let i = 0; i < maxJobs; i++) {
            const job = await dequeueEmail()
            
            if (!job) {
                break // No más jobs en la cola
            }

            try {
                await sendEmail(job)
                await completeJob(job.id)
                processed++
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error"
                await failJob(job, errorMessage)
                failed++
            }
        }

        const stats = await getQueueStats()
        console.log(`📊 Queue stats - Pending: ${stats.pending}, Processing: ${stats.processing}, Failed: ${stats.failed}`)

    } finally {
        isProcessing = false
    }

    return { processed, failed }
}

/**
 * Procesar un email inmediatamente (bypass queue)
 */
export async function sendEmailNow(
    type: EmailJob["type"],
    to: string,
    data: Record<string, unknown>
): Promise<boolean> {
    const job: EmailJob = {
        id: `immediate_${Date.now()}`,
        type,
        to,
        data,
        attempts: 0,
        maxAttempts: 1,
        createdAt: new Date().toISOString(),
    }

    try {
        await sendEmail(job)
        return true
    } catch (error) {
        console.error("Error sending immediate email:", error)
        return false
    }
}
