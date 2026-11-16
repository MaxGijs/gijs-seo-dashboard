import { NextResponse } from "next/server"
import { google } from "googleapis"
import { createClient } from "@supabase/supabase-js"

const SITE_URL = "https://www.groeninjestraat.nl/"
// GSC laat doorgaans data tot 3 dagen terug nog instabiel/onvolledig zien.
const LAG_DAYS = 3
const BACKFILL_DAYS = 90

function getGscClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  })
  return google.searchconsole({ version: "v1", auth })
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const fmt = (d: Date) => d.toISOString().split("T")[0]

// GET /api/cron/gsc-backfill — eenmalig (of handmatig opnieuw) de laatste ~90 dagen ophalen
// in één stel API-calls (dimensions date+query / date+page / date), zodat de Advisor niet
// weken hoeft te wachten op de dagelijkse cron voordat er meerweken-trends zichtbaar zijn.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get("days") || String(BACKFILL_DAYS))

  const endDate = new Date()
  endDate.setDate(endDate.getDate() - LAG_DAYS)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days)

  try {
    const sc = getGscClient()
    const supabase = getSupabase()

    const [overviewRes, keywordsRes, pagesRes] = await Promise.all([
      sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: { startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["date"], rowLimit: days + 5 },
      } as any),
      sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: { startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["date", "query"], rowLimit: 25000 },
      } as any),
      sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: { startDate: fmt(startDate), endDate: fmt(endDate), dimensions: ["date", "page"], rowLimit: 25000 },
      } as any),
    ])

    const overviewRows = overviewRes.data.rows || []
    const keywordRows = keywordsRes.data.rows || []
    const pageRows = pagesRes.data.rows || []

    const results: Record<string, any> = {
      range: { start: fmt(startDate), end: fmt(endDate) },
      overview: 0, keywords: 0, pages: 0,
    }

    // Supabase upsert in batches (voorkom te grote single requests)
    const chunk = <T,>(arr: T[], size: number) =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size))

    if (overviewRows.length) {
      const rows = overviewRows.map(r => ({
        snapshot_date: r.keys?.[0],
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: r.ctr || 0,
        position: r.position || 0,
      }))
      for (const batch of chunk(rows, 500)) {
        const { error } = await supabase.from("seo_daily_overview").upsert(batch, { onConflict: "snapshot_date" })
        if (error) throw new Error(`overview upsert: ${error.message}`)
      }
      results.overview = rows.length
    }

    if (keywordRows.length) {
      const rows = keywordRows.map(r => ({
        snapshot_date: r.keys?.[0],
        query: r.keys?.[1] || "",
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: r.ctr || 0,
        position: r.position || 0,
      }))
      for (const batch of chunk(rows, 500)) {
        const { error } = await supabase.from("seo_daily_keywords").upsert(batch, { onConflict: "snapshot_date,query" })
        if (error) throw new Error(`keywords upsert: ${error.message}`)
      }
      results.keywords = rows.length
    }

    if (pageRows.length) {
      const rows = pageRows.map(r => ({
        snapshot_date: r.keys?.[0],
        page: r.keys?.[1] || "",
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: r.ctr || 0,
        position: r.position || 0,
      }))
      for (const batch of chunk(rows, 500)) {
        const { error } = await supabase.from("seo_daily_pages").upsert(batch, { onConflict: "snapshot_date,page" })
        if (error) throw new Error(`pages upsert: ${error.message}`)
      }
      results.pages = rows.length
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
