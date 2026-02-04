import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"
import { CartProvider } from "@/hooks/cart-context"
import { MainLayoutWrapper } from "@/components/layout/MainLayoutWrapper"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "FDNDA Tickets - Federación Deportiva Nacional de Deportes Acuáticos",
  description: "Compra tus entradas para los mejores eventos de deportes acuáticos en Perú. Natación, Waterpolo, Clavados y más.",
  keywords: ["deportes acuáticos", "natación", "waterpolo", "clavados", "tickets", "entradas", "FDNDA", "Perú"],
  authors: [{ name: "FDNDA" }],
  openGraph: {
    title: "FDNDA Tickets",
    description: "Entradas oficiales para eventos de deportes acuáticos",
    type: "website",
    locale: "es_PE",
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
