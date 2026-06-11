import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Telemetria de diagnostico del checkout Izipay en el NAVEGADOR del comprador.
// El SDK de Izipay en modo redirect falla en silencio (sin callback ni error),
// asi que el unico lugar donde se puede observar el fallo es el cliente. Este
// endpoint solo escribe en los logs del contenedor (docker logs app).
export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as Record<string, unknown>

        const orderId = typeof body.orderId === "string" ? body.orderId.slice(0, 40) : ""
        const stage = typeof body.stage === "string" ? body.stage.slice(0, 60) : "unknown"
        const message = typeof body.message === "string" ? body.message.slice(0, 500) : ""
        const probes = body.probes && typeof body.probes === "object" ? body.probes : undefined
        const mode = typeof body.mode === "string" ? body.mode.slice(0, 20) : ""

        console.error("[izipay/client-log]", {
            orderId,
            stage,
            mode,
            message,
            probes,
            userAgent: request.headers.get("user-agent")?.slice(0, 200),
            // Detras de Cloudflare la IP real del comprador viene en este header.
            clientIp:
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-forwarded-for")?.split(",")[0] ||
                null,
            country: request.headers.get("cf-ipcountry") || null,
        })

        return NextResponse.json({ ok: true })
    } catch {
        return NextResponse.json({ ok: false }, { status: 400 })
    }
}
