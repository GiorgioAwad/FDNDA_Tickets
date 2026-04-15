import { NextRequest } from "next/server"

function trimTrailingSlash(value: string) {
    return value.replace(/\/$/, "")
}

function firstHeaderValue(value: string | null) {
    return value?.split(",")[0]?.trim() || ""
}

export function getPublicAppUrl(request: NextRequest) {
    const configuredUrl = (
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXTAUTH_URL ||
        ""
    ).trim()

    if (configuredUrl) {
        return trimTrailingSlash(configuredUrl)
    }

    const forwardedHost =
        firstHeaderValue(request.headers.get("x-forwarded-host")) ||
        firstHeaderValue(request.headers.get("host"))
    const forwardedProto =
        firstHeaderValue(request.headers.get("x-forwarded-proto")) || "https"

    if (forwardedHost) {
        return `${forwardedProto}://${forwardedHost}`
    }

    return trimTrailingSlash(request.nextUrl.origin)
}
