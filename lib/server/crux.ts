// CrUX History API: echte laadsnelheid van Chrome-bezoekers per week (gratis, max. 150 opvragen per
// minuut). Werkt met een Google Cloud-sleutel waarop de "Chrome UX Report API" aan staat:
// CRUX_API_KEY, of anders de sleutel van PageSpeed. Google ververst de data wekelijks, dus wij ook.
import { getSupabase } from "./guard"
import { SITE_ORIGIN } from "./gsc"
import { CRUX_METRICS, parseCruxHistory, type CruxPoint } from "@/lib/crux"

const API = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord"
const key = () => process.env.CRUX_API_KEY || process.env.PAGESPEED_API_KEY || ""
export const cruxConfigured = () => !!key()

async function query(target: { origin: string } | { url: string }, formFactor: "PHONE" | "DESKTOP") {
  const res = await fetch(`${API}?key=${encodeURIComponent(key())}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, formFactor, metrics: CRUX_METRICS, collectionPeriodCount: 40 }),
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status === 404) return null // te weinig Chrome-bezoekers voor deze pagina of dit apparaat
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(res.status === 403 ? `Geen toegang tot de CrUX API: zet de "Chrome UX Report API" aan voor deze sleutel (${j?.error?.message || "403"})` : j?.error?.message || `HTTP ${res.status}`)
  return j
}

// Site (origin) op mobiel en desktop, plus de belangrijkste pagina's op mobiel als daar genoeg data voor is
export async function syncCrux(paths: string[], force = false) {
  if (!cruxConfigured()) return { overgeslagen: "Geen API-sleutel (CRUX_API_KEY of PAGESPEED_API_KEY)" }
  const sb = getSupabase()
  if (!force) {
    const { data: last } = await sb.from("seo_crux_history").select("fetched_at").eq("scope", "origin").order("fetched_at", { ascending: false }).limit(1).maybeSingle()
    if (last && Date.now() - new Date(last.fetched_at).getTime() < 6 * 86400e3) return { overgeslagen: "Deze week al opgehaald (Google ververst wekelijks)" }
  }
  const points: CruxPoint[] = []
  for (const ff of ["PHONE", "DESKTOP"] as const) {
    const j = await query({ origin: SITE_ORIGIN }, ff)
    if (j) points.push(...parseCruxHistory(j, "origin", ff))
  }
  let metData = 0
  for (const p of [...new Set(paths)].slice(0, 15)) {
    const j = await query({ url: `${SITE_ORIGIN}${p}` }, "PHONE").catch(() => null)
    if (j) { metData++; points.push(...parseCruxHistory(j, p, "PHONE")) }
  }
  const now = new Date().toISOString()
  for (let i = 0; i < points.length; i += 500) {
    const { error } = await sb.from("seo_crux_history").upsert(points.slice(i, i + 500).map(p => ({ ...p, fetched_at: now })))
    if (error) throw new Error(error.message)
  }
  return { perioden: points.filter(p => p.scope === "origin" && p.form_factor === "PHONE").length, paginasMetData: metData, paginasGeprobeerd: Math.min(paths.length, 15) }
}

export async function cruxSeries(scope = "origin"): Promise<CruxPoint[]> {
  const { data, error } = await getSupabase().from("seo_crux_history").select("scope, form_factor, period_start, period_end, lcp_ms, inp_ms, cls, fcp_ms, ttfb_ms").eq("scope", scope).order("period_end")
  if (error) throw new Error(error.message)
  return (data || []).map((r: any) => ({ ...r, lcp_ms: r.lcp_ms === null ? null : Number(r.lcp_ms), inp_ms: r.inp_ms === null ? null : Number(r.inp_ms), cls: r.cls === null ? null : Number(r.cls), fcp_ms: r.fcp_ms === null ? null : Number(r.fcp_ms), ttfb_ms: r.ttfb_ms === null ? null : Number(r.ttfb_ms) }))
}
