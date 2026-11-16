import { NextResponse } from "next/server"
import { BetaAnalyticsDataClient } from "@google-analytics/data"
import { requireUser } from "@/lib/server/guard"

// GET /api/ga4?days=28&offset=0 — sessies en key events (conversies) per dag.
// offset schuift het venster terug in de tijd, zodat de vorige periode even lang is als de huidige.
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error

  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "28"), 1), 480)
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0)

  const propertyId = process.env.GA4_PROPERTY_ID
  if (!propertyId) {
    return NextResponse.json({ error: "GA4_PROPERTY_ID ontbreekt", code: "config" }, { status: 500 })
  }

  let credentials
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  } catch {
    return NextResponse.json({ error: "Serviceaccount-gegevens ongeldig", code: "config" }, { status: 500 })
  }

  const client = new BetaAnalyticsDataClient({ credentials })
  const startDate = `${days + offset - 1}daysAgo`
  const endDate = offset === 0 ? "today" : `${offset}daysAgo`

  try {
    // Per landingspagina: sessies en key events (aanvragen, energiescans) — voor de prioriteit per pagina
    if (searchParams.get("type") === "pages") {
      const [response] = await client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: "sessions" }, { name: "keyEvents" }],
        dimensions: [{ name: "landingPage" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 2000,
      })
      const rows = (response.rows || []).map(r => {
        const raw = r.dimensionValues?.[0]?.value || "/"
        const path = (raw.split("?")[0] || "/").replace(/\/$/, "") || "/"
        return { path, sessions: Number(r.metricValues?.[0]?.value || 0), keyEvents: Number(r.metricValues?.[1]?.value || 0) }
      })
      // Dezelfde pagina kan met verschillende querystrings voorkomen: optellen
      const merged = new Map<string, { path: string; sessions: number; keyEvents: number }>()
      for (const r of rows) {
        const m = merged.get(r.path) || { path: r.path, sessions: 0, keyEvents: 0 }
        m.sessions += r.sessions; m.keyEvents += r.keyEvents
        merged.set(r.path, m)
      }
      return NextResponse.json({ rows: [...merged.values()], startDate, endDate })
    }
    const [response] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      dimensions: [{ name: "date" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    })
    return NextResponse.json(response)
  } catch (err: any) {
    const message: string = err?.message || "Onbekende fout"
    const code = /PERMISSION_DENIED/i.test(message) ? "permission" : "error"
    return NextResponse.json({ error: message, code, serviceAccount: credentials?.client_email || null }, { status: 500 })
  }
}
