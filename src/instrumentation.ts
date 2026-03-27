export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("../sentry.server.config")
    }

    if (process.env.NEXT_RUNTIME === "edge") {
        await import("../sentry.edge.config")
    }
}

export const onRequestError = async (
    ...args: unknown[]
) => {
    const { captureRequestError } = await import("@sentry/nextjs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(captureRequestError as any)(...args)
}
