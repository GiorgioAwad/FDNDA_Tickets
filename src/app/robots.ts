import type { MetadataRoute } from "next"

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ticketingfdnda.pe"

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: [
                    "/admin",
                    "/admin/",
                    "/api/",
                    "/checkout",
                    "/checkout/",
                    "/mi-cuenta",
                    "/mi-cuenta/",
                    "/canjear",
                    "/canjear/",
                    "/scanner",
                    "/scanner/",
                    "/tesoreria",
                    "/tesoreria/",
                ],
            },
        ],
        sitemap: `${siteUrl}/sitemap.xml`,
        host: siteUrl,
    }
}
