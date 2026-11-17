// Core Web Vitals meten via de gratis PageSpeed Insights API (mobiel). Per run een paar pagina's,
// steeds de langst niet gemeten eerst, zodat alle belangrijke pagina's binnen enkele dagen rondkomen.
import { getSupabase } from "./guard"
import { SITE_ORIGIN } from "./gsc"
import { fieldStatus, labStatus, type CwvRow } from "@/lib/cwv"

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

export async function measurePage(path: string, strategy: "mobile" | "desktop" = "mobile") {
  const u = new URL(PSI)
  u.searchParams.set("url", `${SITE_ORIGIN}${path}`)
  u.searchParams.set("strategy", strategy)
  u.searchParams.set("category", "performance")
  if (process.env.PAGESPEED_API_KEY) u.searchParams.set("key", process.env.PAGESPEED_API_KEY)
  const res = await fetch(u, { signal: AbortSignal.timeout(55_000) })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`
    throw new Error(res.status === 429 ? `Limiet van PageSpeed Insights bereikt${process.env.PAGESPEED_API_KEY ? "" : " (er is nog geen API-sleutel ingesteld)"}: ${msg}` : msg)
  }
  const a = j.lighthouseResult?.audits || {}
  const num = (k: string) => (typeof a[k]?.numericValue === "number" ? a[k].numericValue : null)
  const le = j.loadingExperience?.metrics ? j.loadingExperience : null
  const m = le?.metrics || {}
  const field = le && le.overall_category ? {
    lcp_ms: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile, inp_ms: m.INTERACTION_TO_NEXT_PAINT?.percentile,
    cls: typeof m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile === "number" ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : undefined,
    category: le.overall_category, origin: !!le.origin_fallback,
  } : null
  const lcp = num("largest-contentful-paint"), cls = num("cumulative-layout-shift"), tbt = num("total-blocking-time")
  const row: Omit<CwvRow, "measured_at"> = {
    path, strategy,
    score: typeof j.lighthouseResult?.categories?.performance?.score === "number" ? Math.round(j.lighthouseResult.categories.performance.score * 100) : null,
    lcp_ms: lcp !== null ? Math.round(lcp) : null, cls: cls !== null ? Math.round(cls * 1000) / 1000 : null,
    tbt_ms: tbt !== null ? Math.round(tbt) : null, fcp_ms: num("first-contentful-paint") !== null ? Math.round(num("first-contentful-paint")!) : null,
    field,
    // Echte gebruikersdata van deze pagina gaat voor; anders de labmeting
    status: (field && !field.origin ? fieldStatus(field.category) : null) || labStatus(lcp, cls, tbt),
    error: null,
  }
  return row
}

export async function refreshCwv(paths: string[], perRun = 4) {
  const sb = getSupabase()
  const { data: existing } = await sb.from("seo_cwv").select("path, measured_at, error").eq("strategy", "mobile")
  const last = new Map((existing || []).map(r => [r.path, r.measured_at as string]))
  const due = [...new Set(paths)].sort((a, b) => (last.get(a) || "").localeCompare(last.get(b) || "")).slice(0, perRun)
  const out: { path: string; ok: boolean; error?: string }[] = []
  for (let i = 0; i < due.length; i += 2) {
    await Promise.all(due.slice(i, i + 2).map(async path => {
      try {
        const row = await measurePage(path)
        await sb.from("seo_cwv").upsert({ ...row, measured_at: new Date().toISOString() })
        out.push({ path, ok: true })
      } catch (e: any) {
        await sb.from("seo_cwv").upsert({ path, strategy: "mobile", measured_at: new Date().toISOString(), error: String(e?.message || e).slice(0, 500) })
        out.push({ path, ok: false, error: e?.message })
      }
    }))
  }
  return out
}

export async function readCwv(): Promise<CwvRow[]> {
  const { data } = await getSupabase().from("seo_cwv").select("*").eq("strategy", "mobile").order("path")
  return (data || []) as CwvRow[]
}
