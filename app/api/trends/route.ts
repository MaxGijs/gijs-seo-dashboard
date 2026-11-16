import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface Streak {
  query: string
  weeks: number
  direction: "stijgend" | "dalend"
  positionNow: number
  positionWeeksAgo: number
  impressions: number
}

// GET /api/trends?type=streaks — zoekwoorden die meerdere weken op rij stijgen of dalen
// GET /api/trends?type=overview&days=180 — dagelijkse overview-geschiedenis uit onze eigen opslag (langer dan GSC's eigen 16 maanden)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type") || "streaks"
  const supabase = getSupabase()

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase not configured", rows: [] }, { status: 200 })
  }

  try {
    if (type === "overview") {
      const days = parseInt(searchParams.get("days") || "180")
      const { data, error } = await supabase
        .from("seo_daily_overview")
        .select("snapshot_date, clicks, impressions, ctr, position")
        .gte("snapshot_date", new Date(Date.now() - days * 86400000).toISOString().split("T")[0])
        .order("snapshot_date", { ascending: true })
      if (error) throw error
      return NextResponse.json({ rows: data || [] })
    }

    if (type === "streaks") {
      // Haal ruwe weekcijfers op en bereken de streaks in JS — simpeler en robuuster dan een
      // ingewikkelde SQL window-functie, en de hoeveelheid data per site is klein genoeg.
      const { data, error } = await supabase
        .from("seo_daily_keywords")
        .select("query, snapshot_date, position, impressions")
        .gte("snapshot_date", new Date(Date.now() - 70 * 86400000).toISOString().split("T")[0])
      if (error) throw error

      // Groepeer per zoekwoord per ISO-week
      const weekOf = (d: string) => {
        const date = new Date(d)
        const firstJan = new Date(date.getFullYear(), 0, 1)
        const week = Math.ceil(((date.getTime() - firstJan.getTime()) / 86400000 + firstJan.getDay() + 1) / 7)
        return `${date.getFullYear()}-W${week}`
      }

      const byQuery = new Map<string, Map<string, { posSum: number; count: number; impressions: number; lastDate: string }>>()
      for (const row of data || []) {
        const w = weekOf(row.snapshot_date)
        if (!byQuery.has(row.query)) byQuery.set(row.query, new Map())
        const weeks = byQuery.get(row.query)!
        const existing = weeks.get(w) || { posSum: 0, count: 0, impressions: 0, lastDate: row.snapshot_date }
        existing.posSum += row.position
        existing.count += 1
        existing.impressions += row.impressions
        if (row.snapshot_date > existing.lastDate) existing.lastDate = row.snapshot_date
        weeks.set(w, existing)
      }

      const streaks: Streak[] = []
      for (const [query, weeks] of byQuery) {
        const sorted = [...weeks.entries()]
          .map(([w, v]) => ({ week: w, avgPosition: v.posSum / v.count, impressions: v.impressions, lastDate: v.lastDate }))
          .sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1)) // meest recent eerst
        if (sorted.length < 3) continue

        let streakLen = 1
        let direction: "stijgend" | "dalend" | null = null
        for (let i = 0; i < sorted.length - 1; i++) {
          const diff = sorted[i + 1].avgPosition - sorted[i].avgPosition // positief = deze week beter dan vorige
          if (diff > 0.5) {
            if (direction === null || direction === "stijgend") { direction = "stijgend"; streakLen++ } else break
          } else if (diff < -0.5) {
            if (direction === null || direction === "dalend") { direction = "dalend"; streakLen++ } else break
          } else break
        }

        const totalImpressions = sorted.reduce((s, w) => s + w.impressions, 0)
        if (direction && streakLen >= 3 && totalImpressions > 30) {
          streaks.push({
            query,
            weeks: streakLen,
            direction,
            positionNow: Math.round(sorted[0].avgPosition * 10) / 10,
            positionWeeksAgo: Math.round(sorted[streakLen - 1].avgPosition * 10) / 10,
            impressions: totalImpressions,
          })
        }
      }

      streaks.sort((a, b) => b.weeks * b.impressions - a.weeks * a.impressions)
      return NextResponse.json({ rows: streaks.slice(0, 10) })
    }

    return NextResponse.json({ error: "Unknown type", rows: [] }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, rows: [] }, { status: 500 })
  }
}
