import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gijs SEO Dashboard",
  description: "SEO dashboard voor groeninjestraat.nl",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap" />
      </head>
      <body style={{ margin: 0, minHeight: "100vh" }}>{children}</body>
    </html>
  );
}
