import type { MetadataRoute } from "next"
import { prisma } from "@/lib/prisma"

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ticketingfdnda.pe"

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const staticRoutes: MetadataRoute.Sitemap = [
        {
            url: `${siteUrl}/`,
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 1,
        },
        {
            url: `${siteUrl}/eventos`,
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 0.9,
        },
        {
            url: `${siteUrl}/contacto`,
            lastModified: new Date(),
            changeFrequency: "yearly",
            priority: 0.4,
        },
        {
            url: `${siteUrl}/terminos`,
            lastModified: new Date(),
            changeFrequency: "yearly",
            priority: 0.3,
        },
        {
            url: `${siteUrl}/privacidad`,
            lastModified: new Date(),
            changeFrequency: "yearly",
            priority: 0.3,
        },
        {
            url: `${siteUrl}/libro-de-reclamaciones`,
            lastModified: new Date(),
            changeFrequency: "yearly",
            priority: 0.3,
        },
    ]

    let eventRoutes: MetadataRoute.Sitemap = []
    try {
        const events = await prisma.event.findMany({
            where: {
                isPublished: true,
                visibility: "PUBLIC",
                endDate: { gte: new Date() },
            },
            select: {
                slug: true,
                updatedAt: true,
                startDate: true,
            },
            orderBy: { startDate: "asc" },
        })
        eventRoutes = events.map((event) => ({
            url: `${siteUrl}/eventos/${event.slug}`,
            lastModified: event.updatedAt,
            changeFrequency: "daily",
            priority: 0.8,
        }))
    } catch (error) {
        console.error("[sitemap] failed to load events", error)
    }

    return [...staticRoutes, ...eventRoutes]
}
