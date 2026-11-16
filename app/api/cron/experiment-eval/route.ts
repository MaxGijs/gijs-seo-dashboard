import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0]
}

// Gemiddelde cijfers over de laatste 7 dagen rond het meetmoment — stabieler dan één losse dag.
async function measure(supabase: any, query: string | null, page: string | null) {
  if (query) {
    const { data, error } = await supabase
      .from("seo_daily_keywords")
      .select("position, impressions, clicks, ctr")
      .eq("query", query)
      .gte("snapshot_date", daysAgo(7))
    if (error || !data || data.length === 0) return null
    const n = data.length
    return {
      position: Math.round((data.reduce((s: number, r: any) => s + r.position, 0) / n) * 10) / 10,
      impressions: data.reduce((s: number, r: any) => s + r.impressions, 0),
      clicks: data.reduce((s: number, r: any) => s + r.clicks, 0),
      ctr: Math.round((data.reduce((s: number, r: any) => s + r.ctr, 0) / n) * 1000) / 1000,
      measuredAt: new Date().toISOString().split("T")[0],
      sampleDays: n,
    }
  }
  if (page) {
    const fullUrl = `https://www.groeninjestraat.nl${page === "/" ? "/" : page}`
    const { data, error } = await supabase
      .from("seo_daily_pages")
      .select("position, impressions, clicks, ctr")
      .eq("page", fullUrl)
      .gte("snapshot_date", daysAgo(7))
    if (error || !data || data.length === 0) return null
    const n = data.length
    return {
      position: Math.round((data.reduce((s: number, r: any) => s + r.position, 0) / n) * 10) / 10,
      impressions: data.reduce((s: number, r: any) => s + r.impressions, 0),
      clicks: data.reduce((s: number, r: any) => s + r.clicks, 0),
      ctr: Math.round((data.reduce((s: number, r: any) => s + r.ctr, 0) / n) * 1000) / 1000,
      measuredAt: new Date().toISOString().split("T")[0],
      sampleDays: n,
    }
  }
  return null
}

// GET /api/cron/experiment-eval — dagelijks: vult result_14d/28d/56d in voor experimenten
// waarvan die termijn verstreken is, en beoordeelt bij de 56-dagen-meting of het advies
// succesvol was (positie verbeterd t.o.v. de nulmeting).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 })
  }

  const supabase = getSupabase()
  const results = { checked: 0, measured14: 0, measured28: 0, measured56: 0, finalized: 0 }

  try {
    const { data: experiments, error } = await supabase
      .from("seo_experiments")
      .select("*")
      .or(`result_14d.is.null,result_28d.is.null,result_56d.is.null`)
      .lte("changed_at", daysAgo(14))
    if (error) throw error

    for (const exp of experiments || []) {
      results.checked++
      const changedAt = exp.changed_at
      const ageDays = Math.floor((Date.now() - new Date(changedAt).getTime()) / 86400000)
      const update: Record<string, any> = {}

      if (!exp.result_14d && ageDays >= 14) {
        const m = await measure(supabase, exp.query, exp.page)
        if (m) { update.result_14d = m; results.measured14++ }
      }
      if (!exp.result_28d && ageDays >= 28) {
        const m = await measure(supabase, exp.query, exp.page)
        if (m) { update.result_28d = m; results.measured28++ }
      }
      if (!exp.result_56d && ageDays >= 56) {
        const m = await measure(supabase, exp.query, exp.page)
        if (m) {
          update.result_56d = m
          results.measured56++
          // Eindbeoordeling volgens het meetplan uit het advies:
          // - positie: minstens 0,5 beter dan de nulmeting (lager getal = betere positie)
          // - doorklik (CTR): minstens 20% hoger dan de nulmeting
          const useCtr = exp.baseline?.successMetric === "ctr"
          const baselinePos = exp.baseline?.position ?? exp.baseline?.positionNow
          const baselineCtr = exp.baseline?.ctr
          let verdict: string | null = null
          if (useCtr && typeof baselineCtr === "number" && typeof m.ctr === "number") {
            const improved = m.ctr >= Math.max(baselineCtr * 1.2, baselineCtr + 0.002)
            const worsened = m.ctr < baselineCtr * 0.8
            verdict = improved ? "succesvol" : worsened ? "niet_succesvol" : "onduidelijk"
          } else if (typeof baselinePos === "number" && typeof m.position === "number") {
            const improved = m.position < baselinePos - 0.5
            const worsened = m.position > baselinePos + 0.5
            verdict = improved ? "succesvol" : worsened ? "niet_succesvol" : "onduidelijk"
          }
          if (verdict) {
            update.outcome = verdict

            if (update.outcome !== "onduidelijk") {
              await supabase.from("seo_advice_status").update({
                status: update.outcome,
                updated_at: new Date().toISOString(),
              }).eq("advice_key", exp.advice_key)
              results.finalized++
            }
          }
        }
      }

      if (Object.keys(update).length > 0) {
        await supabase.from("seo_experiments").update(update).eq("id", exp.id)
      }
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
