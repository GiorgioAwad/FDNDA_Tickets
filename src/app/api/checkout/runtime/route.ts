import { NextRequest, NextResponse } from "next/server"
import { getIzipayScriptUrl, type IzipayMode } from "@/lib/izipay"

export const runtime = "nodejs"

const SDK_FETCH_TIMEOUT_MS = 10_000
const MAX_SDK_SIZE_BYTES = 512_000

function resolveMode(request: NextRequest): IzipayMode {
    const mode = request.nextUrl.searchParams.get("mode")

    if (mode === "embedded" || mode === "popup" || mode === "redirect") {
        return mode
    }

    return "redirect"
}

export async function GET(request: NextRequest) {
    const mode = resolveMode(request)
    const upstreamUrl = getIzipayScriptUrl(mode)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SDK_FETCH_TIMEOUT_MS)

    try {
        const response = await fetch(upstreamUrl, {
            headers: {
                Accept: "application/javascript,text/javascript,*/*;q=0.1",
            },
            next: { revalidate: 3600 },
            signal: controller.signal,
        })

        if (!response.ok) {
            console.error("[izipay/sdk-proxy] upstream error", {
                mode,
                status: response.status,
                upstreamUrl,
            })
            return new NextResponse("IZIPAY SDK unavailable", { status: 502 })
        }

        const contentLength = Number(response.headers.get("content-length") || 0)
        if (contentLength > MAX_SDK_SIZE_BYTES) {
            console.error("[izipay/sdk-proxy] SDK exceeded size limit", {
                mode,
                contentLength,
            })
            return new NextResponse("Invalid IZIPAY SDK response", { status: 502 })
        }

        const source = await response.text()
        if (
            source.length === 0 ||
            source.length > MAX_SDK_SIZE_BYTES ||
            !source.includes("Izipay")
        ) {
            console.error("[izipay/sdk-proxy] invalid SDK response", {
                mode,
                size: source.length,
            })
            return new NextResponse("Invalid IZIPAY SDK response", { status: 502 })
        }

        return new NextResponse(source, {
            status: 200,
            headers: {
                "Content-Type": "application/javascript; charset=utf-8",
                "Cache-Control":
                    "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
                "X-Content-Type-Options": "nosniff",
            },
        })
    } catch (error) {
        console.error("[izipay/sdk-proxy] request failed", {
            mode,
            error:
                error instanceof Error && error.name === "AbortError"
                    ? "timeout"
                    : (error as Error).message,
        })
        return new NextResponse("IZIPAY SDK unavailable", { status: 502 })
    } finally {
        clearTimeout(timeoutId)
    }
}
