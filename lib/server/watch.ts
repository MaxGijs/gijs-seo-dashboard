// Pagina's volgen: welke pagina's dagelijks gecontroleerd worden, gebeurtenissen opslaan en
// de zoekmijlpalen (eerste vertoning, klik, pagina 1) uit Search Console vastleggen.
// Alleen lezen bij Google en de site; schrijft uitsluitend naar de eigen database.

import { getSupabase } from "./guard"
import { gscQuery, serviceSearchConsole, SITE_ORIGIN, toPath } from "./gsc"
import { searchMilestones, watchReasons, type DayRow, type PageEvent, type PageEventType, type WatchReason } from "@/lib/watch"

const dayMs = 86400000

export async function readWatch(now = new Date()): Promise<Map<string, WatchReason[]>> {
  const sb = getSupabase()
  const iso = (d: number) => new Date(now.getTime() - d * dayMs).toISOString()
  const [advice, experiments, ideas, pages] = await Promise.all([
    sb.from("seo_advice_status").select("advice_key, advice_title, status, updated_at, snapshot").in("status", ["goedgekeurd", "in_uitvoering", "uitgevoerd", "in_evaluatie"]),
    sb.from("seo_experiments").select("advice_key, page, changed_at, baseline").gte("changed_at", iso(56).slice(0, 10)),
    sb.from("content_ideas").select("id, title, status, published_at, published_url, target_page, advice").eq("status", "gepubliceerd").gte("published_at", iso(90).slice(0, 10)),
    sb.from("seo_pages").select("path, page_type, in_sitemap, index_verdict, http_status").eq("in_sitemap", true).in("page_type", ["home", "maatregel", "artikel", "overig"]),
  ])
  for (const r of [advice, experiments, ideas, pages]) if (r.error) throw new Error(r.error.message)
  return watchReasons({ advice: advice.data || [], experiments: experiments.data || [], ideas: ideas.data || [], pages: (pages.data || []) as any }, now.toISOString())
}

export async function saveEvents(events: PageEvent[]) {
  if (!events.length) return 0
  const rows = events.map(e => ({ path: e.path, event: e.event, at: e.at, detail: e.detail ?? null }))
  const { error } = await getSupabase().from("seo_page_events").upsert(rows, { onConflict: "path,event,at", ignoreDuplicates: true })
  if (error) throw new Error(`gebeurtenissen opslaan: ${error.message}`)
  return rows.length
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Eerste vertoning, klik en dag op pagina 1 voor gevolgde pagina's die nieuw zijn in Google
// (nooit eerder gezien, of pas in de laatste 90 dagen). Bij bestaande pagina's zegt "eerste" niets.
export async function recordSearchMilestones(watched: Map<string, WatchReason[]>, now = new Date()) {
  const sb = getSupabase()
  const paths = [...watched.keys()]
  if (!paths.length) return { paginas: 0, mijlpalen: 0 }
  const { data: rows } = await sb.from("seo_pages").select("path, first_seen").in("path", paths)
  const since = new Date(now.getTime() - 90 * dayMs).toISOString().slice(0, 10)
  const fresh = (rows || []).filter(r => !r.first_seen || r.first_seen >= since).map(r => r.path)
  if (!fresh.length) return { paginas: 0, mijlpalen: 0 }
  const { data: have } = await sb.from("seo_page_events").select("path, event").in("path", fresh).in("event", ["eerste-vertoning", "eerste-klik", "pagina-1"])
  const haveBy = new Map<string, Set<PageEventType>>()
  for (const h of have || []) { const s = haveBy.get(h.path) || new Set(); s.add(h.event as PageEventType); haveBy.set(h.path, s) }
  const todo = fresh.filter(p => (haveBy.get(p)?.size || 0) < 3)
  const sc = serviceSearchConsole()
  const end = new Date(now.getTime() - 2 * dayMs).toISOString().slice(0, 10)
  const byPage = new Map<string, DayRow[]>()
  for (let i = 0; i < todo.length; i += 25) {
    const chunk = todo.slice(i, i + 25)
    const expression = `^${escapeRe(SITE_ORIGIN)}(${chunk.map(p => escapeRe(p === "/" ? "" : p)).join("|")})/?$`
    const res = await gscQuery(sc, { startDate: since, endDate: end, dimensions: ["page", "date"], dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "includingRegex", expression }] }], rowLimit: 25000 })
    for (const r of res) {
      const path = toPath(r.keys[0]).replace(/(.)\/$/, "$1")
      const list = byPage.get(path) || []
      list.push({ date: r.keys[1], impressions: r.impressions, clicks: r.clicks, position: r.position })
      byPage.set(path, list)
    }
  }
  const events = todo.flatMap(p => searchMilestones(p, byPage.get(p) || [], haveBy.get(p) || new Set()))
  await saveEvents(events)
  return { paginas: todo.length, mijlpalen: events.length }
}

export async function readEvents(opts: { paths?: string[]; sinceDays?: number } = {}) {
  let q = getSupabase().from("seo_page_events").select("path, event, at, detail, created_at").order("at", { ascending: false }).limit(500)
  if (opts.paths?.length) q = q.in("path", opts.paths)
  if (opts.sinceDays) q = q.gte("created_at", new Date(Date.now() - opts.sinceDays * dayMs).toISOString())
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []) as PageEvent[]
}
