// Meting voor één experiment, alleen over wat de wijziging raakt: de doelpagina's en de relevante
// zoekopdrachten (niet de hele website). Vaste vensters: de N dagen na de wijziging tegen de 28 dagen ervoor.

import { gscQuery, serviceSearchConsole, toUrl } from "@/lib/server/gsc"
import { windowsFor, type PagePoint, type Ranking, type Scoped, type Totals, type QueryPoint, type Window } from "@/lib/measureLogic"

const MAX_PAGES = 8
const TOP_QUERIES = 5

type Agg = { impressions: number; clicks: number; posSum: number; posW: number }
const empty = (): Agg => ({ impressions: 0, clicks: 0, posSum: 0, posW: 0 })
const add = (a: Agg, r: { impressions: number; clicks: number; position: number }) => { a.impressions += r.impressions; a.clicks += r.clicks; a.posSum += r.position * Math.max(r.impressions, 1); a.posW += Math.max(r.impressions, 1) }
const pos = (a: Agg) => (a.posW ? Math.round((a.posSum / a.posW) * 10) / 10 : null)
const totals = (a: Agg, queries: number): Totals => ({ impressions: a.impressions, clicks: a.clicks, ctr: a.impressions ? Math.round((a.clicks / a.impressions) * 10000) / 10000 : 0, position: a.impressions ? pos(a) : null, queries })

export const normPath = (p: string) => { let x = p.trim().replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, ""); if (x.length > 1) x = x.replace(/\/+$/, ""); return x || "/" }

export function targetsOf(exp: any): { pages: string[]; queries: string[] } {
  const b = exp.baseline || {}
  const pages = [...new Set([b.targetPage, exp.page, ...(exp.target_pages || [])].filter((p: unknown): p is string => typeof p === "string" && !!p).map(normPath))].slice(0, MAX_PAGES)
  const queries = [...new Set([exp.query, ...(exp.target_queries || [])].filter((q: unknown): q is string => typeof q === "string" && !!q).map((q: string) => q.trim().toLowerCase()))]
  return { pages, queries }
}

async function rows(body: Record<string, unknown>) {
  return gscQuery(serviceSearchConsole(), { rowLimit: 1000, ...body })
}
const pageFilter = (p: string) => ({ dimension: "page", operator: "equals", expression: toUrl(p) })
const queryFilter = (q: string) => ({ dimension: "query", operator: "equals", expression: q })

// Per venster: totalen, per zoekopdracht en (na) per week
async function windowData(w: Window, pages: string[], queries: string[], weekly: boolean) {
  const total = empty()
  const perPage = new Map<string, { agg: Agg; queries: number }>()
  const perQuery = new Map<string, Agg>()
  const daily = new Map<string, Agg>()
  const range = { startDate: w.start, endDate: w.end }
  if (pages.length) {
    for (const p of pages) {
      const [t] = await rows({ ...range, dimensions: ["page"], dimensionFilterGroups: [{ filters: [pageFilter(p)] }], rowLimit: 1 })
      const own = empty()
      if (t) { add(total, t); add(own, t) }
      const qs = await rows({ ...range, dimensions: ["query"], dimensionFilterGroups: [{ filters: [pageFilter(p)] }] })
      for (const r of qs) {
        const q = r.keys[0].toLowerCase(); const a = perQuery.get(q) || empty(); add(a, r); perQuery.set(q, a)
      }
      perPage.set(p, { agg: own, queries: qs.filter(r => r.impressions > 0).length })
      if (weekly) for (const r of await rows({ ...range, dimensions: ["date"], dimensionFilterGroups: [{ filters: [pageFilter(p)] }] })) {
        const a = daily.get(r.keys[0]) || empty(); add(a, r); daily.set(r.keys[0], a)
      }
    }
  } else {
    for (const q of queries) {
      const [t] = await rows({ ...range, dimensions: ["query"], dimensionFilterGroups: [{ filters: [queryFilter(q)] }], rowLimit: 1 })
      if (t) { add(total, t); const a = perQuery.get(q) || empty(); add(a, t); perQuery.set(q, a) }
      if (weekly) for (const r of await rows({ ...range, dimensions: ["date"], dimensionFilterGroups: [{ filters: [queryFilter(q)] }] })) {
        const a = daily.get(r.keys[0]) || empty(); add(a, r); daily.set(r.keys[0], a)
      }
    }
  }
  // Weken van 7 dagen vanaf het begin van het venster
  const weeks: number[] = []
  if (weekly) {
    const buckets = new Map<number, Agg>()
    const start = new Date(`${w.start}T12:00:00Z`).getTime()
    for (const [d, a] of daily) { const k = Math.floor((new Date(`${d}T12:00:00Z`).getTime() - start) / (7 * 86400000)); const b = buckets.get(k) || empty(); b.impressions += a.impressions; b.clicks += a.clicks; b.posSum += a.posSum; b.posW += a.posW; buckets.set(k, b) }
    for (const k of [...buckets.keys()].sort((a, b) => a - b)) { const b = buckets.get(k)!; if (b.impressions >= 5) weeks.push(pos(b)!) }
  }
  return { total, perPage, perQuery, weeks }
}

// Welke URL toont Google voor het zoekwoord? Los van de aangepaste pagina: een andere URL is een
// diagnostisch signaal, geen fout in het experiment.
async function rankingFor(w: Window, query: string, pages: string[]): Promise<Ranking | null> {
  const r = await rows({ startDate: w.start, endDate: w.end, dimensions: ["page"], dimensionFilterGroups: [{ filters: [queryFilter(query)] }], rowLimit: 10 })
  if (!r.length) return null
  const shown = r.sort((a, b) => b.impressions - a.impressions).slice(0, 3).map(x => ({ page: normPath(x.keys[0]), impressions: x.impressions, position: Math.round(x.position * 10) / 10 }))
  return { query, shown, intendedShown: pages.length ? pages.includes(shown[0].page) : null }
}

// Positie van de doelpagina(s) op één zoekwoord (zoekwoord-paginacombinatie)
async function pairPosition(w: Window, pages: string[], query: string) {
  const a = empty()
  for (const p of pages) {
    const [r] = await rows({ startDate: w.start, endDate: w.end, dimensions: ["query"], dimensionFilterGroups: [{ filters: [pageFilter(p), queryFilter(query)] }], rowLimit: 1 })
    if (r) add(a, r)
  }
  return a.impressions ? pos(a) : null
}

export async function measureScoped(exp: any, day: number, metric: "position" | "ctr"): Promise<Scoped | null> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null
  const { pages, queries } = targetsOf(exp)
  if (!pages.length && !queries.length) return null
  const { before: bw, after: aw } = windowsFor(exp.changed_at, day)
  try {
    const [b, a] = [await windowData(bw, pages, queries, false), await windowData(aw, pages, queries, true)]
    const visible = (m: Map<string, Agg>) => [...m.values()].filter(x => x.impressions > 0).length
    // Te volgen zoekopdrachten: die van de aanpassing plus de grootste van de doelpagina vóór de wijziging
    const top = [...b.perQuery.entries()].filter(([, x]) => x.impressions >= 10).sort((x, y) => y[1].impressions - x[1].impressions).slice(0, TOP_QUERIES).map(([q]) => q)
    const follow = [...new Set([...queries, ...top])]
    const point = (m: Map<string, Agg>, q: string) => { const x = m.get(q) || empty(); return { impressions: x.impressions, clicks: x.clicks, position: x.impressions ? pos(x) : null } }
    const perQuery: QueryPoint[] = follow.map(q => ({ query: q, tracked: queries.includes(q), before: point(b.perQuery, q), after: point(a.perQuery, q) }))
    const scope: Scoped["scope"] = pages.length && queries.length ? "zoekwoord-pagina" : pages.length ? "pagina" : "zoekwoord"
    // Beslissende positie: de doelpagina op het hoofdzoekwoord, anders de pagina(s) als geheel
    const mainQuery = (exp.query || queries[0] || "").toLowerCase()
    const main = scope === "zoekwoord-pagina" && mainQuery
      ? { label: `Positie op "${mainQuery}"`, before: await pairPosition(bw, pages, mainQuery), after: await pairPosition(aw, pages, mainQuery) }
      : { label: scope === "pagina" ? "Gemiddelde positie van de doelpagina" : "Gemiddelde positie op het zoekwoord", before: pos(b.total), after: pos(a.total) }
    if (metric === "ctr") main.label = "CTR"
    const ranking = mainQuery ? await rankingFor(aw, mainQuery, pages).catch(() => null) : null
    // Meetpunten per aangepaste pagina (alleen als het er meer dan één zijn)
    const points: PagePoint[] | undefined = pages.length > 1 ? pages.map(p => ({
      page: p,
      before: totals(b.perPage.get(p)?.agg || empty(), b.perPage.get(p)?.queries || 0),
      after: totals(a.perPage.get(p)?.agg || empty(), a.perPage.get(p)?.queries || 0),
      ranking: null,
    })) : undefined
    return {
      scope, pages, queries, beforeWindow: bw, afterWindow: aw,
      before: totals(b.total, pages.length ? visible(b.perQuery) : queries.length),
      after: totals(a.total, pages.length ? visible(a.perQuery) : queries.length),
      main, perQuery, weeklyAfter: a.weeks, points, ranking,
    }
  } catch {
    return null
  }
}
