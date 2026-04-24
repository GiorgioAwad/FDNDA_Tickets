import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"
import { CartProvider } from "@/hooks/cart-context"
import { MainLayoutWrapper } from "@/components/layout/MainLayoutWrapper"

const inter = Inter({ subsets: ["latin"] })

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ticketingfdnda.pe"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Ticketing FDNDA - Federación Deportiva Nacional de Deportes Acuáticos",
    template: "%s | Ticketing FDNDA",
  },
  description: "Compra tus entradas oficiales para eventos de deportes acuáticos en Perú: natación, waterpolo, clavados, nado artístico y piscina libre. Plataforma oficial de la Federación Deportiva Nacional de Deportes Acuáticos.",
  keywords: ["deportes acuáticos", "natación Perú", "waterpolo Perú", "clavados", "nado artístico", "piscina libre", "tickets", "entradas", "FDNDA", "Federación Deportiva Nacional de Deportes Acuáticos", "eventos deportivos Perú"],
  authors: [{ name: "FDNDA", url: siteUrl }],
  creator: "FDNDA",
  publisher: "FDNDA",
  applicationName: "Ticketing FDNDA",
  category: "sports",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "Ticketing FDNDA - Entradas oficiales de deportes acuáticos",
    description: "Entradas oficiales para eventos de deportes acuáticos en Perú: natación, waterpolo, clavados y más.",
    url: siteUrl,
    siteName: "Ticketing FDNDA",
    type: "website",
    locale: "es_PE",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "Ticketing FDNDA",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ticketing FDNDA",
    description: "Entradas oficiales para eventos de deportes acuáticos en Perú.",
    images: ["/logo.png"],
  },
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
  formatDetection: {
    telephone: false,
  },
}

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SportsOrganization",
  name: "Federación Deportiva Nacional de Deportes Acuáticos",
  alternateName: "FDNDA",
  url: siteUrl,
  logo: `${siteUrl}/logo.png`,
  sport: ["Natación", "Waterpolo", "Clavados", "Nado Artístico"],
  areaServed: { "@type": "Country", name: "Perú" },
}

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Ticketing FDNDA",
  url: siteUrl,
  inLanguage: "es-PE",
  potentialAction: {
    "@type": "SearchAction",
    target: `${siteUrl}/eventos?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className={`${inter.className} antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <Providers>
          <CartProvider>
            <MainLayoutWrapper>
              {children}
            </MainLayoutWrapper>
          </CartProvider>
        </Providers>
      </body>
    </html>
  )
}
