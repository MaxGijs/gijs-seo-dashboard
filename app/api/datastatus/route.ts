import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"

export const maxDuration = 30

const JOBS = ["gsc-snapshot", "inventaris", "http-controle", "indexering", "experimenten"] as const

// GET /api/datastatus — laatste synchronisaties, dekking en fouten, voor het datastatusscherm
export async function GET() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const sb = getSupabase()
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const staleInspect = new Date(Date.now() - 7 * 86400000).toISOString()

  const count = async (table: string, f?: (q: any) => any) => {
    let q = sb.from(table).select("*", { count: "exact", head: true })
    if (f) q = f(q)
    const { count: c } = await q
    return c ?? 0
  }

  try {
    const jobs = await Promise.all(JOBS.map(async job => {
      const [{ data: last }, { data: lastOk }, failures] = await Promise.all([
        sb.from("seo_sync_log").select("run_at, ok, duration_ms, details, error").eq("job", job).order("run_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("seo_sync_log").select("run_at").eq("job", job).eq("ok", true).order("run_at", { ascending: false }).limit(1).maybeSingle(),
        count("seo_sync_log", q => q.eq("job", job).eq("ok", false).gte("run_at", weekAgo)),
      ])
      return { job, last: last ?? null, lastOk: lastOk?.run_at ?? null, failures7d: failures }
    }))

    const snapshot = async (table: string) => {
      const { data } = await sb.from(table).select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1).maybeSingle()
      const latest = data?.snapshot_date ?? null
      const rows = latest ? await count(table, q => q.eq("snapshot_date", latest)) : 0
      const { data: first } = await sb.from(table).select("snapshot_date").order("snapshot_date", { ascending: true }).limit(1).maybeSingle()
      return { latest, rowsLatest: rows, since: first?.snapshot_date ?? null }
    }
    const [overview, keywords, pages] = await Promise.all([snapshot("seo_daily_overview"), snapshot("seo_daily_keywords"), snapshot("seo_daily_pages")])
    const { data: days } = await sb.from("seo_daily_overview").select("snapshot_date").gte("snapshot_date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))

    const [total, inSitemap, httpChecked, httpErrors, inspectedFresh, neverInspected, inspectErrors, indexed] = await Promise.all([
      count("seo_pages"),
      count("seo_pages", q => q.eq("in_sitemap", true)),
      count("seo_pages", q => q.not("http_checked_at", "is", null)),
      count("seo_pages", q => q.eq("in_sitemap", true).gte("http_status", 400)),
      count("seo_pages", q => q.eq("in_sitemap", true).gte("inspected_at", staleInspect)),
      count("seo_pages", q => q.eq("in_sitemap", true).is("inspected_at", null)),
      count("seo_pages", q => q.not("inspect_error", "is", null)),
      count("seo_pages", q => q.eq("in_sitemap", true).eq("index_verdict", "PASS")),
    ])
    const [{ data: lastSync }, { data: lastInspect }] = await Promise.all([
      sb.from("seo_pages").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("seo_pages").select("inspected_at").not("inspected_at", "is", null).order("inspected_at", { ascending: false }).limit(1).maybeSingle(),
    ])
    const [expTotal, expOpen] = await Promise.all([count("seo_experiments"), count("seo_experiments", q => q.is("outcome", null))])
    const { data: recentErrors } = await sb.from("seo_sync_log").select("run_at, job, error").eq("ok", false).order("run_at", { ascending: false }).limit(8)

    return NextResponse.json({
      jobs,
      snapshots: { overview, keywords, pages, daysLast90: days?.length ?? 0 },
      inventory: { total, inSitemap, httpChecked, httpErrors, inspectedFresh, neverInspected, inspectErrors, indexed, lastSync: lastSync?.synced_at ?? null, lastInspect: lastInspect?.inspected_at ?? null },
      experiments: { total: expTotal, open: expOpen },
      recentErrors: recentErrors ?? [],
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
