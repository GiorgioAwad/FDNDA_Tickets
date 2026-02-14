import { Resend } from "resend"
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses"

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "resend").toLowerCase()
const FROM_EMAIL = process.env.EMAIL_FROM || "Ticketing FDNDA <ticketing@fdnda.org>"

const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null

const ses = process.env.AWS_REGION
    ? new SESClient({
        region: process.env.AWS_REGION,
        credentials:
            process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
                ? {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                }
                : undefined,
    })
    : null

export interface SendTransactionalEmailInput {
    to: string
    subject: string
    html: string
    from?: string
}

export interface SendTransactionalEmailResult {
    messageId?: string
}

function normalizeProvider(value: string): "resend" | "ses" {
    return value === "ses" ? "ses" : "resend"
}

export async function sendTransactionalEmail(
    input: SendTransactionalEmailInput
): Promise<SendTransactionalEmailResult> {
    const provider = normalizeProvider(EMAIL_PROVIDER)
    const from = input.from || FROM_EMAIL

    if (provider === "ses") {
        if (!ses) {
            throw new Error("EMAIL_PROVIDER=ses requiere AWS_REGION configurado")
        }

        const response = await ses.send(
            new SendEmailCommand({
                Source: from,
                Destination: { ToAddresses: [input.to] },
                Message: {
                    Subject: {
                        Data: input.subject,
                        Charset: "UTF-8",
                    },
                    Body: {
                        Html: {
                            Data: input.html,
                            Charset: "UTF-8",
                        },
                    },
                },
            })
        )

        return { messageId: response.MessageId }
    }

    if (!resend) {
        // Dev fallback when no provider credentials are configured.
        console.log(`Email simulado [resend]: ${input.subject} -> ${input.to}`)
        return {}
    }

    const { data, error } = await resend.emails.send({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
    })

    if (error) {
        throw new Error(error.message)
    }

    return { messageId: data?.id }
}
