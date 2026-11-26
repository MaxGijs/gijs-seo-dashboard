// Microsoft Clarity Data Export API (gratis): gedrag per pagina. Max. 10 opvragen per project per dag
// en alleen de laatste 1–3 dagen, dus we halen elke ochtend de afgelopen 24 uur op en bewaren die.
// Token: Clarity › Settings › Data Export › Generate new API token → CLARITY_API_TOKEN in Vercel.
import { getSupabase } from "./guard"
import { parseClarity, summarizeBehavior, type Behavior } from "@/lib/clarity"

const API = "https://www.clarity.ms/export-data/api/v1/project-live-insights"
export const clarityConfigured = () => !!process.env.CLARITY_API_TOKEN

export async function syncClarity(force = false) {
  if (!clarityConfigured()) return { overgeslagen: "Geen CLARITY_API_TOKEN ingesteld" }
  const sb = getSupabase()
  // De laatste 24 uur horen grotendeels bij gisteren (de taak draait 's ochtends)
  const day = new Date(Date.now() - 86400e3).toISOString().slice(0, 10)
  if (!force) {
    const { count } = await sb.from("seo_clarity_daily").select("path", { count: "exact", head: true }).eq("day", day)
    if (count) return { overgeslagen: `${day} is al opgehaald`, dag: day }
  }
  const res = await fetch(`${API}?numOfDays=1&dimension1=URL`, {
    headers: { Authorization: `Bearer ${process.env.CLARITY_API_TOKEN}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => "")
    throw new Error(res.status === 401 || res.status === 403 ? "Clarity weigert het token: maak in Clarity een nieuw API-token en zet het in CLARITY_API_TOKEN" : res.status === 429 ? "Daglimiet van Clarity bereikt (10 opvragen per dag); morgen opnieuw" : `Clarity: HTTP ${res.status} ${t.slice(0, 200)}`)
  }
  const rows = parseClarity(await res.json(), day)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("seo_clarity_daily").upsert(rows.slice(i, i + 500).map(r => ({ ...r, fetched_at: new Date().toISOString() })))
    if (error) throw new Error(error.message)
  }
  return { dag: day, paginas: rows.length, sessies: rows.reduce((a, r) => a + (r.sessions || 0), 0) }
}

const COLS = "day, path, sessions, users, scroll_depth, active_time, dead_click_pct, rage_click_pct, quickback_pct, excessive_scroll_pct"
export async function behaviorFor(path: string, days = 28): Promise<Behavior> {
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10)
  const { data, error } = await getSupabase().from("seo_clarity_daily").select(COLS).eq("path", path).gte("day", since)
  if (error) throw new Error(error.message)
  return summarizeBehavior(path, (data || []) as any)
}
export async function behaviorTop(days = 28, limit = 25): Promise<Behavior[]> {
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10)
  const { data, error } = await getSupabase().from("seo_clarity_daily").select(COLS).gte("day", since).limit(20000)
  if (error) throw new Error(error.message)
  const by = new Map<string, any[]>()
  for (const r of data || []) by.set(r.path, [...(by.get(r.path) || []), r])
  return [...by.entries()].map(([p, rs]) => summarizeBehavior(p, rs)).sort((a, b) => b.sessions - a.sessions).slice(0, limit)
}
