import type { Metadata, Viewport } from "next"
import "./globals.css"
// De nieuwe bouwstenen (shadcn/ui + Tailwind) lezen dezelfde tokens; zie docs/DESIGN.md
import "./ui-v2.css"

export const metadata: Metadata = {
  title: "Gijs Intelligence · SEO-werkruimte",
  description: "Dagelijkse SEO-werkruimte voor groeninjestraat.nl",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#133e35",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  )
}
