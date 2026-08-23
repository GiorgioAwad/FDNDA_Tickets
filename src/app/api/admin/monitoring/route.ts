import * as Sentry from "@sentry/nextjs"
import { NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type SentryIssue = {
    id?: string
    shortId?: string
    title?: string
    culprit?: string
    count?: string
    userCount?: number
    level?: string
    lastSeen?: string
    firstSeen?: string
    permalink?: string
}

type SentryPoint = [number, number]

function cleanBaseUrl(value: string | undefined): string {
    return (value?.trim() || "https://sentry.io").replace(/\/$/, "")
}

export async function GET() {
    const user = await getCurrentUser()
    if (user?.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const organization = process.env.SENTRY_ORG?.trim() ?? ""
    const project = process.env.SENTRY_PROJECT?.trim() ?? ""
    const token = process.env.SENTRY_MONITORING_TOKEN?.trim() ?? ""
    const baseUrl = cleanBaseUrl(process.env.SENTRY_BASE_URL)
    const captureConfigured = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
    const missing = [
        !organization ? "SENTRY_ORG" : null,
        !project ? "SENTRY_PROJECT" : null,
        !token ? "SENTRY_MONITORING_TOKEN" : null,
    ].filter((value): value is string => Boolean(value))

    if (missing.length > 0) {
        return NextResponse.json({
            success: true,
            data: {
                captureConfigured,
                apiConfigured: false,
                missing,
                organization: organization || null,
                project: project || null,
                dashboardUrl: organization
                    ? `${baseUrl}/organizations/${encodeURIComponent(organization)}/issues/`
                    : baseUrl,
                issues: [],
                eventSeries: [],
                events24h: 0,
                warnings: [],
                refreshedAt: new Date().toISOString(),
            },
        })
    }

    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" }
    const issuesUrl = new URL(`/api/0/organizations/${encodeURIComponent(organization)}/issues/`, baseUrl)
    issuesUrl.searchParams.set("project", project)
    issuesUrl.searchParams.set("query", "is:unresolved")
    issuesUrl.searchParams.set("statsPeriod", "14d")
    issuesUrl.searchParams.set("sort", "date")
    issuesUrl.searchParams.set("limit", "12")

    const nowSeconds = Math.floor(Date.now() / 1000)
    const statsUrl = new URL(
        `/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/stats/`,
        baseUrl
    )
    statsUrl.searchParams.set("stat", "received")
    statsUrl.searchParams.set("since", String(nowSeconds - 24 * 60 * 60))
    statsUrl.searchParams.set("until", String(nowSeconds))
    statsUrl.searchParams.set("resolution", "1h")

    try {
        const [issuesResponse, statsResponse] = await Promise.all([
            fetch(issuesUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) }),
            fetch(statsUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) }),
        ])

        const warnings: string[] = []
        let issues: SentryIssue[] = []
        let points: SentryPoint[] = []

        if (issuesResponse.ok) {
            const payload: unknown = await issuesResponse.json()
            if (Array.isArray(payload)) issues = payload as SentryIssue[]
        } else {
            warnings.push(`Sentry incidencias: HTTP ${issuesResponse.status}`)
        }

        if (statsResponse.ok) {
            const payload: unknown = await statsResponse.json()
            if (Array.isArray(payload)) {
                points = payload.filter(
                    (point): point is SentryPoint =>
                        Array.isArray(point) && point.length === 2 &&
                        typeof point[0] === "number" && typeof point[1] === "number"
                )
            }
        } else {
            warnings.push(`Sentry eventos: HTTP ${statsResponse.status}`)
        }

        return NextResponse.json({
            success: true,
            data: {
                captureConfigured,
                apiConfigured: true,
                missing: [],
                organization,
                project,
                dashboardUrl: `${baseUrl}/organizations/${encodeURIComponent(organization)}/issues/?project=${encodeURIComponent(project)}`,
                issues: issues.map((issue) => ({
                    id: issue.id ?? "",
                    shortId: issue.shortId ?? "",
                    title: issue.title ?? "Incidencia sin titulo",
                    culprit: issue.culprit ?? "",
                    count: Number(issue.count ?? 0),
                    users: Number(issue.userCount ?? 0),
                    level: issue.level ?? "error",
                    lastSeen: issue.lastSeen ?? null,
                    firstSeen: issue.firstSeen ?? null,
                    url: issue.permalink ?? null,
                })),
                eventSeries: points.map(([timestamp, count]) => ({
                    timestamp: new Date(timestamp * 1000).toISOString(),
                    count,
                })),
                events24h: points.reduce((sum, [, count]) => sum + count, 0),
                warnings,
                refreshedAt: new Date().toISOString(),
            },
        })
    } catch (error) {
        Sentry.captureException(error, { tags: { area: "admin-monitoring" } })
        return NextResponse.json(
            { success: false, error: "No se pudo consultar Sentry. Revisa el token y la conectividad." },
            { status: 502 }
        )
    }
}
