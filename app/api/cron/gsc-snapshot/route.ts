import { NextResponse } from "next/server"
import { google } from "googleapis"
import { createClient } from "@supabase/supabase-js"

const SITE_URL = "https://www.groeninjestraat.nl/"
// GSC data heeft vaak 2-3 dagen vertraging voor het compleet/stabiel is.
const SNAPSHOT_LAG_DAYS = 3

function getGscClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  })
  return google.searchconsole({ version: "v1", auth })
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: Request) {
  // Vercel Cron stuurt automatisch "Authorization: Bearer $CRON_SECRET" mee als CRON_SECRET is ingesteld.
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const date = new Date()
  date.setDate(date.getDate() - SNAPSHOT_LAG_DAYS)
  const snapshotDate = date.toISOString().split("T")[0]

  try {
    const sc = getGscClient()
    const supabase = getSupabase()

    const [overviewRes, keywordsRes, pagesRes] = await Promise.all([
      sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: { startDate: snapshotDate, endDate: snapshotDate, dimensions: ["date"], rowLimit: 1 },
      } as any),
      sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: { startDate: snapshotDate, endDate: snapshotDate, dimensions: ["query"], rowLimit: 500 },
      } as any),
      sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: { startDate: snapshotDate, endDate: snapshotDate, dimensions: ["page"], rowLimit: 500 },
      } as any),
    ])

    const overviewRow = (overviewRes.data.rows || [])[0]
    const keywordRows = keywordsRes.data.rows || []
    const pageRows = pagesRes.data.rows || []

    const results: Record<string, any> = { snapshotDate, overview: 0, keywords: 0, pages: 0 }

    if (overviewRow) {
      const { error } = await supabase.from("seo_daily_overview").upsert({
        snapshot_date: snapshotDate,
        clicks: overviewRow.clicks || 0,
        impressions: overviewRow.impressions || 0,
        ctr: overviewRow.ctr || 0,
        position: overviewRow.position || 0,
      }, { onConflict: "snapshot_date" })
      if (error) throw new Error(`overview upsert: ${error.message}`)
      results.overview = 1
    }

    if (keywordRows.length) {
      const { error } = await supabase.from("seo_daily_keywords").upsert(
        keywordRows.map(r => ({
          snapshot_date: snapshotDate,
          query: r.keys?.[0] || "",
          clicks: r.clicks || 0,
          impressions: r.impressions || 0,
          ctr: r.ctr || 0,
          position: r.position || 0,
        })),
        { onConflict: "snapshot_date,query" }
      )
      if (error) throw new Error(`keywords upsert: ${error.message}`)
      results.keywords = keywordRows.length
    }

    if (pageRows.length) {
      const { error } = await supabase.from("seo_daily_pages").upsert(
        pageRows.map(r => ({
          snapshot_date: snapshotDate,
          page: r.keys?.[0] || "",
          clicks: r.clicks || 0,
          impressions: r.impressions || 0,
          ctr: r.ctr || 0,
          position: r.position || 0,
        })),
        { onConflict: "snapshot_date,page" }
      )
      if (error) throw new Error(`pages upsert: ${error.message}`)
      results.pages = pageRows.length
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
