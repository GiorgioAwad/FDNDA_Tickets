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

const FROM_EMAIL = process.env.EMAIL_FROM || "Ticketing FDNDA <tickets@fdnda.org.pe>"
const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000"
const RAW_APP_NAME = (process.env.NEXT_PUBLIC_APP_NAME || "Ticketing FDNDA").trim()
const APP_NAME = RAW_APP_NAME.toLowerCase() === "fdnda tickets" ? "Ticketing FDNDA" : RAW_APP_NAME
const BRAND_TAGLINE = "Federaci&oacute;n Deportiva Nacional de Deportes Acu&aacute;ticos"

// ==================== EMAIL TEMPLATES ====================

function getPurchaseConfirmationTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, orderId, eventTitle, ticketCount, totalAmount } = data
    const orderCode = String(orderId || "").slice(-8).toUpperCase()
    
    return {
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
                                        <p style="margin:0 0 12px;">Hola <strong>${userName}</strong>,</p>
                                        <p style="margin:0 0 24px;">Gracias por tu compra. Tus entradas ya est&aacute;n disponibles.</p>
                                        <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; margin-bottom:24px;">
                                            <p style="margin:0 0 10px;"><strong>Evento:</strong> ${eventTitle}</p>
                                            <p style="margin:0 0 10px;"><strong>Orden:</strong> #${orderCode}</p>
                                            <p style="margin:0 0 10px;"><strong>Entradas:</strong> ${ticketCount}</p>
                                            <p style="margin:0;"><strong>Total pagado:</strong> ${totalAmount}</p>
                                        </div>
                                        <div style="text-align:center; margin:24px 0 28px;">
                                            <a href="${BASE_URL}/mi-cuenta/entradas" style="background:#0b5fff; color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">
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
    }
}

function getWelcomeTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, verifyUrl } = data
    
    return {
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
                                        <p style="margin:0 0 12px;">Hola <strong>${userName}</strong>,</p>
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
                                            Si no creaste esta cuenta, puedes ignorar este correo.
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
    }
}

function getPasswordResetTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, resetUrl } = data
    
    return {
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
                                        <p style="margin:0 0 12px;">Hola <strong>${userName}</strong>,</p>
                                        <p style="margin:0 0 24px;">Recibimos una solicitud para restablecer tu contrase&ntilde;a. Haz clic en el bot&oacute;n para continuar:</p>
                                        <div style="text-align:center; margin:24px 0 28px;">
                                            <a href="${resetUrl}" style="background:#dc2626; color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">
                                                Restablecer contrase&ntilde;a
                                            </a>
                                        </div>
                                        <div style="margin-top:8px; padding:12px 14px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; font-size:12px; color:#991b1b;">
                                            Este enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.
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
    }
}

function getCourtesyClaimedTemplate(data: Record<string, unknown>): { subject: string; html: string } {
    const { userName, eventTitle, ticketTypeName } = data
    
    return {
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
                                        <p style="margin:0 0 12px;">Hola <strong>${userName}</strong>,</p>
                                        <p style="margin:0 0 24px;">Has reclamado exitosamente tu entrada de cortes&iacute;a:</p>
                                        <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; margin-bottom:24px;">
                                            <p style="margin:0 0 10px;"><strong>Evento:</strong> ${eventTitle}</p>
                                            <p style="margin:0;"><strong>Tipo:</strong> ${ticketTypeName}</p>
                                        </div>
                                        <div style="text-align:center; margin:24px 0 28px;">
                                            <a href="${BASE_URL}/mi-cuenta/entradas" style="background:#0b5fff; color:#ffffff; padding:14px 32px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">
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
