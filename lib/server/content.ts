// Content Intelligence — kansenscanner (server).
//
// Leest betrouwbare nieuwsbronnen, eigen zoekdata en een seizoenskalender en maakt daar
// onderbouwde contentvoorstellen van. Leest alleen; publiceert nooit.

import { getSupabase } from "./guard"
import { type Item, parseMilieuCentraal, parseRss } from "@/lib/content/parse"
import { gscQuery, serviceSearchConsole, toPath } from "./gsc"
import {
  type CapacityMode, type ContentIdea, type Impact, type KeywordRef, type Reliability, type SourceRef,
  impactOf, isForHouseholds, jaccard, regionsIn, reliabilityOf, SCAN_SERVICE, servicesIn, tokens,
} from "@/lib/content/model"
import { ageOf, buildIdea, type Ctx, dayMs, newsDraft, searchDrafts, seasonDrafts } from "@/lib/content/build"
export { buildIdea } from "@/lib/content/build"

// ── Bronnen ─────────────────────────────────────────────────────────────────

interface Source { id: string; name: string; publisher: string; kind: "rss" | "milieucentraal"; url: string; reliability: Reliability }

function rijksoverheid(filter: { topic?: string; term?: string }): string {
  const filters: any[] = [{ field: "content_type", values: ["pro:newsDocument"], type: "all" }]
  if (filter.topic) filters.push({ field: "topic", values: [filter.topic], type: "all" })
  return "https://www.rijksoverheid.nl/api/rss?query=" + encodeURIComponent(JSON.stringify({ filters, resultSearchTerm: filter.term || "", pageTitle: "Nieuws" }))
}

export const SOURCES: Source[] = [
  { id: "ro-energie-thuis", name: "Rijksoverheid · Energie thuis", publisher: "Rijksoverheid", kind: "rss", url: rijksoverheid({ topic: "Energie thuis" }), reliability: "overheid" },
  { id: "ro-energielabel", name: "Rijksoverheid · Energielabel woningen", publisher: "Rijksoverheid", kind: "rss", url: rijksoverheid({ topic: "Energielabel woningen en gebouwen" }), reliability: "overheid" },
  ...["warmtepomp", "isolatie", "ISDE", "zonnepanelen", "salderingsregeling", "Warmtefonds", "energiebelasting", "thuisbatterij", "stroomnet"].map(term => ({
    id: `ro-${term.toLowerCase()}`, name: `Rijksoverheid · zoekterm "${term}"`, publisher: "Rijksoverheid", kind: "rss" as const, url: rijksoverheid({ term }), reliability: "overheid" as const,
  })),
  { id: "milieucentraal", name: "Milieu Centraal · Nieuwsberichten", publisher: "Milieu Centraal", kind: "milieucentraal", url: "https://www.milieucentraal.nl/nieuwsberichten/", reliability: "voorlichting" },
]

const MAX_AGE_DAYS = 120
const UA = "GijsIntelligence/1.0 (+contentkansen, alleen lezen)"

async function fetchText(url: string) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/html;q=0.9" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally { clearTimeout(t) }
}

async function readSources() {
  const status: { id: string; ok: boolean; items: number; error?: string }[] = []
  const items: Item[] = []
  await Promise.all(SOURCES.map(async s => {
    try {
      const body = await fetchText(s.url)
      const got = s.kind === "rss" ? parseRss(body, s.id) : parseMilieuCentraal(body)
      items.push(...got)
      status.push({ id: s.id, ok: true, items: got.length })
    } catch (e: any) {
      status.push({ id: s.id, ok: false, items: 0, error: e?.name === "AbortError" ? "time-out" : e?.message || String(e) })
    }
  }))
  const byUrl = new Map<string, Item>()
  for (const i of items) if (!byUrl.has(i.url)) byUrl.set(i.url, i)
  return { items: [...byUrl.values()], status }
}

// ── Hulpgegevens ────────────────────────────────────────────────────────────

export async function siteContext(): Promise<Ctx> {
  const sb = getSupabase()
  const { data: pages } = await sb.from("seo_pages").select("path, page_type, in_sitemap").in("page_type", ["maatregel", "artikel"])
  const services = (pages || []).filter(p => p.page_type === "maatregel" && p.in_sitemap && p.path.split("/").filter(Boolean).length === 2).map(p => p.path.split("/")[2])
  const hasArticles = (pages || []).some(p => p.page_type === "artikel" && p.in_sitemap)

  // Zoekvraag: 28 dagen uit de dagelijkse snapshots
  const since = new Date(Date.now() - 31 * dayMs).toISOString().slice(0, 10)
  const agg = new Map<string, { impressions: number; clicks: number; posW: number }>()
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await sb.from("seo_daily_keywords").select("query, impressions, clicks, position").gte("snapshot_date", since).range(from, from + 999)
    if (error) throw new Error(`zoekwoorden: ${error.message}`)
    for (const r of data || []) {
      const a = agg.get(r.query) || { impressions: 0, clicks: 0, posW: 0 }
      a.impressions += r.impressions; a.clicks += r.clicks; a.posW += r.position * r.impressions
      agg.set(r.query, a)
    }
    if (!data || data.length < 1000) break
  }
  const queries: KeywordRef[] = [...agg.entries()].map(([query, a]) => ({ query, impressions: a.impressions, clicks: a.clicks, position: a.impressions ? Math.round((a.posW / a.impressions) * 10) / 10 : null }))

  const { data: cap } = await sb.from("content_capacity").select("service, mode")
  const capacity = new Map<string, CapacityMode>((cap || []).map(c => [c.service, c.mode as CapacityMode]))

  const { data: existing } = await sb.from("content_ideas").select("id, fingerprint, origin, status, service, sources, created_at, title")
  return { services, hasArticles, queries, capacity, existing: (existing || []) as Pick<ContentIdea, "id" | "fingerprint" | "origin" | "status" | "service" | "sources" | "created_at" | "title">[] }
}

// ── Scan ────────────────────────────────────────────────────────────────────

export async function scanContent() {
  const sb = getSupabase()
  const [{ items, status }, ctx] = await Promise.all([readSources(), siteContext()])

  // 1. Nieuws opslaan (bestaande berichten behouden hun koppeling)
  const recent = items.filter(i => (ageOf(i.published) ?? 0) <= MAX_AGE_DAYS)
  const classified = recent.map(i => {
    const text = `${i.title} ${i.summary}`
    const services = servicesIn(text, ctx.services)
    return { ...i, services, impact: impactOf(text), regions: regionsIn(text), relevant: services.length > 0 && isForHouseholds(text) }
  })
  if (classified.length) {
    const { error } = await sb.from("content_news").upsert(classified.map(i => ({
      source_id: i.sourceId, url: i.url, title: i.title.slice(0, 400), summary: i.summary.slice(0, 1500),
      published_at: i.published || new Date().toISOString(), date_is_first_seen: i.firstSeen,
      services: i.services, impact: i.impact, regions: i.regions, relevant: i.relevant,
    })), { onConflict: "url", ignoreDuplicates: true })
    if (error) throw new Error(`nieuws opslaan: ${error.message}`)
  }

  // 1b. Vondsten van de wekelijkse webzoektaak beoordelen (die zet ze ongeclassificeerd in content_news)
  const { data: inbox } = await sb.from("content_news").select("id, title, summary, reason").eq("source_kind", "web").is("impact", null)
  let webChecked = 0
  for (const n of inbox || []) {
    const text = `${n.title} ${n.summary || ""} ${n.reason || ""}`
    const services = servicesIn(text, ctx.services)
    await sb.from("content_news").update({
      services: services.length ? services : [SCAN_SERVICE], impact: impactOf(text), regions: regionsIn(text), relevant: isForHouseholds(text),
    }).eq("id", n.id)
    webChecked++
  }

  // 2. Relevante berichten zonder voorstel → voorstel (of als extra bron bij een vergelijkbaar voorstel)
  const since = new Date(Date.now() - MAX_AGE_DAYS * dayMs).toISOString()
  const { data: open } = await sb.from("content_news").select("*").eq("relevant", true).is("idea_id", null).gte("published_at", since).order("published_at", { ascending: true })
  let created = 0, merged = 0
  for (const n of open || []) {
    const item = { sourceId: n.source_id, url: n.url, title: n.title, summary: n.summary || "", published: n.published_at, firstSeen: n.date_is_first_seen, services: n.services, impact: n.impact as Impact, regions: n.regions, reason: n.reason }
    const web = n.source_kind === "web"
    const src = web ? { publisher: n.publisher || new URL(n.url).hostname.replace(/^www\./, ""), reliability: reliabilityOf(n.url) }
      : SOURCES.find(s => s.id === n.source_id) || { publisher: n.source_id, reliability: "overheid" as const }
    const draft = newsDraft(item, src, web ? "trend" : "actualiteit")
    // Samenvoegen met een recent voorstel over hetzelfde
    const tk = tokens(n.title)
    const similar = ctx.existing.find(e => (e.origin === "actualiteit" || e.origin === "trend") && e.service === draft.service
      && Math.abs(new Date(e.created_at).getTime() - new Date(n.published_at).getTime()) < 21 * dayMs
      && (e.sources || []).some((s: SourceRef) => jaccard(tokens(s.title), tk) >= 0.3))
    if (similar) {
      const sources = [...(similar.sources || []), draft.sources[0]]
      await sb.from("content_ideas").update({ sources }).eq("id", similar.id)
      similar.sources = sources
      await sb.from("content_news").update({ idea_id: similar.id }).eq("id", n.id)
      merged++
      continue
    }
    const row = buildIdea(draft, ctx)
    const { data: ins, error } = await sb.from("content_ideas").upsert(row, { onConflict: "fingerprint", ignoreDuplicates: true }).select("id, fingerprint, origin, status, service, sources, created_at, title").maybeSingle()
    if (error) throw new Error(`voorstel opslaan: ${error.message}`)
    if (ins) {
      ctx.existing.push(ins as any)
      await sb.from("content_news").update({ idea_id: ins.id }).eq("id", n.id)
      created++
    }
  }

  // 3. Zoekdata en seizoen (één voorstel per dienst per maand / per seizoen per jaar)
  const known = new Set(ctx.existing.map(e => e.fingerprint))
  const extra = [...searchDrafts(ctx), ...seasonDrafts(ctx)].filter(d => !known.has(d.fingerprint)).map(d => buildIdea(d, ctx))
  if (extra.length) {
    const { error } = await sb.from("content_ideas").upsert(extra, { onConflict: "fingerprint", ignoreDuplicates: true })
    if (error) throw new Error(`voorstellen opslaan: ${error.message}`)
  }

  // 4. Onbehandelde actualiteiten die te oud zijn → verlopen
  const old = ctx.existing.filter(e => e.status === "nieuw" && (e.origin === "actualiteit" || e.origin === "trend")
    && Math.max(...(e.sources || []).map((s: SourceRef) => (s.date ? new Date(s.date).getTime() : 0))) < Date.now() - MAX_AGE_DAYS * dayMs)
  if (old.length) await sb.from("content_ideas").update({ status: "verlopen" }).in("id", old.map(o => o.id))

  const failed = status.filter(s => !s.ok)
  return {
    bronnen: status.length, bronnenMislukt: failed.length, berichten: items.length, recent: recent.length,
    relevant: classified.filter(c => c.relevant).length, webVondsten: webChecked, nieuweKansen: created + extra.length, samengevoegd: merged, verlopen: old.length,
    ...(failed.length === status.length ? { fout: `Geen enkele bron bereikbaar (${failed[0]?.error})` } : {}),
    bronStatus: status,
  }
}

// ── Metingen na publicatie (7, 30 en 90 dagen) ─────────────────────────────

const WINDOWS = [["d7", 7], ["d30", 30], ["d90", 90]] as const

export async function evaluatePublished() {
  const sb = getSupabase()
  const { data } = await sb.from("content_ideas").select("id, published_url, published_at, evals").eq("status", "gepubliceerd").not("published_url", "is", null).not("published_at", "is", null)
  const sc = serviceSearchConsole()
  const lastComplete = new Date(Date.now() - 3 * dayMs)
  let measured = 0
  for (const idea of data || []) {
    const evals = { ...(idea.evals || {}) }
    const start = new Date(idea.published_at + "T00:00:00Z")
    let changed = false
    for (const [key, days] of WINDOWS) {
      if (evals[key]) continue
      const end = new Date(start.getTime() + (days - 1) * dayMs)
      if (end > lastComplete) continue
      const path = toPath(idea.published_url)
      const rows = await gscQuery(sc, {
        startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10),
        dimensions: ["page"], dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: path }] }], rowLimit: 50,
      })
      const own = rows.filter(r => toPath(r.keys[0]).replace(/\/$/, "") === path.replace(/\/$/, ""))
      const imp = own.reduce((s, r) => s + r.impressions, 0), clicks = own.reduce((s, r) => s + r.clicks, 0)
      const pos = imp ? own.reduce((s, r) => s + r.position * r.impressions, 0) / imp : null
      evals[key] = { impressions: imp, clicks, ctr: imp ? clicks / imp : 0, position: pos !== null ? Math.round(pos * 10) / 10 : null, measured_at: new Date().toISOString(), window: `${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)}` }
      changed = true; measured++
    }
    if (changed) await sb.from("content_ideas").update({ evals }).eq("id", idea.id)
  }
  return { gepubliceerd: data?.length ?? 0, metingen: measured }
}
