import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEO Control Center – groeninjestraat.nl",
  description: "SEO dashboard voor groeninjestraat.nl",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
