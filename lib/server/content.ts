// Content Intelligence — kansenscanner (server).
//
// Leest betrouwbare nieuwsbronnen, eigen zoekdata en een seizoenskalender en maakt daar
// onderbouwde contentvoorstellen van. Leest alleen; publiceert nooit.

import { addDaysIso, articleGa4 } from "./conversion"
import { getSupabase } from "./guard"
import { type Item, parseMilieuCentraal, parseRss } from "@/lib/content/parse"
import { gscQuery, serviceSearchConsole, SITE_ORIGIN, toPath } from "./gsc"
import { describe, overlaps, type Campaign } from "@/lib/campaigns"
import { LAUNCH_DATES } from "@/lib/pages"
import { learnFromFeedback, onlyApplicable } from "@/lib/content/feedback"
import { coverageFor, coverageText, coverDocs } from "@/lib/content/coverage"
import { baselineWindow, compare, isPageUpdate, judgeUpdate, pointWindow, UPDATE_MILESTONES, updateQueries, type SearchTotals, type UpdateMeasure, type UpdateSnapshot } from "@/lib/content/update"
import {
  type CapacityMode, type ContentIdea, type Impact, type KeywordRef, type Reliability, type SourceRef,
  impactOf, isForHouseholds, jaccard, relevanceOf, regionsIn, reliabilityOf, SCAN_SERVICE, servicesIn, tokens,
} from "@/lib/content/model"
import { ageOf, buildIdea, type Ctx, dayMs, keywordOverlap, newsDraft, type Place, searchDrafts, seasonDrafts } from "@/lib/content/build"
import { prettySlug } from "@/lib/pages"
import { CONTENT_MODEL_VERSION } from "@/lib/content/model"
import { freshnessDrafts, type NewsRef } from "@/lib/content/freshness"
import { readPageFacts, refreshPageFacts } from "./freshness"
import { decayDrafts, mayExpire, type DecayPage } from "@/lib/content/refresh"
export { buildIdea } from "@/lib/content/build"

// ── Bronnen ─────────────────────────────────────────────────────────────────

interface Source { id: string; name: string; publisher: string; kind: "rss" | "milieucentraal"; url: string; reliability: Reliability; region?: string }

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
  // Nieuwsmedia: landelijk en in de werkgebieden. Alleen berichten over woningen én een dienst van Gijs worden een kans.
  { id: "nos-binnenland", name: "NOS · Binnenland", publisher: "NOS", kind: "rss", url: "https://feeds.nos.nl/nosnieuwsbinnenland", reliability: "nieuws" },
  { id: "nos-economie", name: "NOS · Economie", publisher: "NOS", kind: "rss", url: "https://feeds.nos.nl/nosnieuwseconomie", reliability: "nieuws" },
  { id: "oost", name: "Oost (RTV Oost)", publisher: "Oost", kind: "rss", url: "https://www.rtvoost.nl/rss/index.xml", reliability: "nieuws", region: "overijssel" },
  { id: "tubantia", name: "Tubantia", publisher: "Tubantia", kind: "rss", url: "https://www.tubantia.nl/home/rss.xml", reliability: "nieuws", region: "overijssel" },
  { id: "stentor", name: "De Stentor", publisher: "De Stentor", kind: "rss", url: "https://www.destentor.nl/home/rss.xml", reliability: "nieuws" },
  { id: "gld", name: "Omroep Gelderland", publisher: "Omroep Gelderland", kind: "rss", url: "https://www.gld.nl/rss/index.xml", reliability: "nieuws", region: "gelderland" },
  { id: "rtvutrecht", name: "RTV Utrecht", publisher: "RTV Utrecht", kind: "rss", url: "https://www.rtvutrecht.nl/rss/index.xml", reliability: "nieuws", region: "utrecht" },
]

// Bronnen die we níet elke nacht automatisch lezen: geen bruikbare feed. Die zoekt de wekelijkse
// webzoektaak (maandag) gericht af.
export const WEB_ONLY: { name: string; publisher: string; why: string }[] = [
  { name: "Omroep Flevoland", publisher: "Omroep Flevoland", why: "Geen RSS-feed beschikbaar" },
  { name: "De Gelderlander", publisher: "De Gelderlander", why: "Geen bruikbare RSS-feed" },
  { name: "Utrechts Nieuwsblad", publisher: "Utrechts Nieuwsblad", why: "Geen bruikbare RSS-feed" },
  { name: "Flevopost", publisher: "Flevopost", why: "Geen RSS-feed beschikbaar" },
  { name: "RTL Nieuws, NU.nl, AD, Volkskrant, NRC, Trouw", publisher: "landelijke media", why: "Gezocht via webonderzoek" },
  { name: "RVO, Warmtefonds, netbeheerders, CBS, provincies en gemeenten", publisher: "primaire bronnen", why: "Gezocht via webonderzoek" },
]

export interface SourceOverview {
  id: string; name: string; publisher: string; region: string | null
  status: "actief" | "storing" | "geblokkeerd" | "web"
  lastOk: string | null; lastError: string | null; failedRuns: number
  itemsLastRun: number | null; new24h: number; relevant30d: number
  why?: string
}

// Per bron: werkt hij, wanneer voor het laatst gelukt, en hoeveel nieuws levert hij op.
// "Storing" = laatste keer mislukt; "geblokkeerd" = de laatste 3 keer of vaker mislukt.
export async function sourceOverview(): Promise<SourceOverview[]> {
  const sb = getSupabase()
  const [{ data: runs }, { data: news }] = await Promise.all([
    sb.from("seo_sync_log").select("run_at, details").eq("job", "actualiteiten").order("run_at", { ascending: false }).limit(30),
    sb.from("content_news").select("source_id, fetched_at, relevant").gte("fetched_at", new Date(Date.now() - 30 * dayMs).toISOString()),
  ])
  const dayAgo = Date.now() - dayMs
  const out: SourceOverview[] = SOURCES.map(src => {
    let lastOk: string | null = null, lastError: string | null = null, failedRuns = 0, itemsLastRun: number | null = null, seen = false, streak = true
    for (const r of runs || []) {
      const st = (r.details?.bronStatus || []).find((b: any) => b.id === src.id)
      if (!st) continue
      if (!seen) { itemsLastRun = st.ok ? st.items : 0; lastError = st.ok ? null : st.error || "mislukt"; seen = true }
      if (st.ok) { if (!lastOk) lastOk = r.run_at; streak = false } else if (streak) failedRuns++
    }
    const mine = (news || []).filter(n => n.source_id === src.id)
    const status: SourceOverview["status"] = !seen ? "actief" : failedRuns >= 3 ? "geblokkeerd" : failedRuns >= 1 ? "storing" : "actief"
    return {
      id: src.id, name: src.name, publisher: src.publisher, region: src.region || null, status, lastOk, lastError, failedRuns, itemsLastRun,
      new24h: mine.filter(n => new Date(n.fetched_at).getTime() > dayAgo).length,
      relevant30d: mine.filter(n => n.relevant).length,
    }
  })
  const web = (news || []).filter(n => n.source_id === "claude-web")
  for (const w of WEB_ONLY) out.push({ id: `web:${w.name}`, name: w.name, publisher: w.publisher, region: null, status: "web", lastOk: null, lastError: null, failedRuns: 0, itemsLastRun: null, new24h: 0, relevant30d: 0, why: w.why })
  out.push({ id: "claude-web", name: "Wekelijkse webzoektaak (maandag)", publisher: "Claude", region: null, status: "web", lastOk: web.length ? web.map(n => n.fetched_at).sort().pop()! : null, lastError: null, failedRuns: 0, itemsLastRun: null, new24h: web.filter(n => new Date(n.fetched_at).getTime() > dayAgo).length, relevant30d: web.filter(n => n.relevant).length, why: "Zoekt het hele web af, inclusief bovenstaande bronnen" })
  return out
}

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

  // Plaatsen met een eigen pagina (voor "bestaande pagina eerst" en correcte spelling van plaatsnamen)
  const places = new Map<string, Place>()
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await sb.from("seo_pages").select("path, page_type, gemeente, plaats, http_status").in("page_type", ["gemeente", "plaats"]).eq("in_sitemap", true).range(from, from + 999)
    for (const r of data || []) {
      if (r.http_status && r.http_status >= 400) continue
      const slug = r.page_type === "gemeente" ? r.gemeente : r.plaats
      if (!slug) continue
      const key = slug.replace(/-/g, " ")
      // Een gemeentepagina gaat voor een plaatspagina met dezelfde naam
      if (!places.has(key) || r.page_type === "gemeente") places.set(key, { name: prettySlug(slug), path: r.path })
    }
    if (!data || data.length < 1000) break
  }

  const { data: existing } = await sb.from("content_ideas").select("id, fingerprint, origin, status, service, sources, created_at, title, summary, why_now, feedback, impact, decision_note, regions, published_url, published_at, target_page, advice")
  const { data: reverted } = await sb.from("seo_lessons").select("key, source").in("source", ["content", "feedback"]).eq("status", "teruggedraaid")
  // Bevestigde voorstellen (uit één afwijzing) worden wel toegepast
  const { data: confirmedRows } = await sb.from("seo_lessons").select("key").not("confirmed_at", "is", null).eq("status", "actief")
  const confirmed = new Set((confirmedRows || []).map(r => r.key))
  const ignoreRejections = new Set((reverted || []).filter(r => r.source === "content").map(r => r.key.replace(/^content\|/, "")))
  // Geleerd uit eigen toelichtingen; teruggedraaide feedbacklessen tellen niet mee
  const ignoreFeedback = new Set((reverted || []).filter(r => r.source === "feedback").map(r => r.key.replace(/^feedback\|/, "")))
  // Alleen toepassen wat vaker dan één keer voorkwam of bevestigd is
  const learned = onlyApplicable(learnFromFeedback((existing || []) as any[], ignoreFeedback), confirmed)
  const confirmedRejections = new Set([...confirmed].filter(k => k.startsWith("content|")).map(k => k.replace(/^content\|/, "")))
  return { services, hasArticles, queries, capacity, places, existing: (existing || []) as Ctx["existing"], ignoreRejections, confirmedRejections, learned }
}

// ── Scan ────────────────────────────────────────────────────────────────────

export async function scanContent() {
  const sb = getSupabase()
  const [{ items, status }, ctx] = await Promise.all([readSources(), siteContext()])

  // 1. Nieuws opslaan (bestaande berichten behouden hun koppeling)
  const recent = items.filter(i => (ageOf(i.published) ?? 0) <= MAX_AGE_DAYS)
  const classified = recent.map(i => {
    const text = `${i.title} ${i.summary}`
    const rel = relevanceOf(i.title, i.summary, ctx.services)
    const src = SOURCES.find(x => x.id === i.sourceId)
    const regions = [...new Set([...regionsIn(text), ...(src?.region ? [src.region] : [])])]
    return { ...i, services: rel.services, impact: impactOf(text), regions, relevant: rel.relevant, relevanceNote: rel.reason }
  })
  if (classified.length) {
    const { error } = await sb.from("content_news").upsert(classified.map(i => ({
      source_id: i.sourceId, url: i.url, title: i.title.slice(0, 400), summary: i.summary.slice(0, 1500),
      published_at: i.published || new Date().toISOString(), date_is_first_seen: i.firstSeen,
      services: i.services, impact: i.impact, regions: i.regions, relevant: i.relevant, relevance_note: i.relevanceNote,
    })), { onConflict: "url", ignoreDuplicates: true })
    if (error) throw new Error(`nieuws opslaan: ${error.message}`)
  }

  // 1b. Vondsten van de wekelijkse webzoektaak beoordelen (die zet ze ongeclassificeerd in content_news)
  const { data: inbox } = await sb.from("content_news").select("id, title, summary, reason").eq("source_kind", "web").is("impact", null)
  let webChecked = 0
  for (const n of inbox || []) {
    const text = `${n.title} ${n.summary || ""} ${n.reason || ""}`
    const rel = relevanceOf(n.title, n.summary || "", ctx.services)
    await sb.from("content_news").update({
      services: rel.services.length ? rel.services : [SCAN_SERVICE], impact: impactOf(text), regions: regionsIn(text), relevant: rel.relevant, relevance_note: rel.reason,
    }).eq("id", n.id)
    webChecked++
  }

  // 1b'. Herbeoordeling: alle bewaarde berichten opnieuw door de (strengere) relevantiecontrole.
  //      Onaangeroerde kansen die alleen op nu-irrelevante berichten steunen, worden gearchiveerd.
  const { data: stored } = await sb.from("content_news").select("id, title, summary, relevant, idea_id").gte("published_at", new Date(Date.now() - MAX_AGE_DAYS * dayMs).toISOString())
  const flips: { id: string; relevant: boolean; note: string }[] = []
  for (const n of stored || []) {
    const rel = relevanceOf(n.title, n.summary || "", ctx.services)
    if (rel.relevant !== n.relevant) flips.push({ id: n.id, relevant: rel.relevant, note: rel.reason })
  }
  for (const f of flips) await sb.from("content_news").update({ relevant: f.relevant, relevance_note: f.note }).eq("id", f.id)
  const nowIrrelevant = new Set(flips.filter(f => !f.relevant).map(f => f.id))
  let gearchiveerd = 0
  if (nowIrrelevant.size) {
    const ideaIds = [...new Set((stored || []).filter(n => nowIrrelevant.has(n.id) && n.idea_id).map(n => n.idea_id as string))]
    for (const id of ideaIds) {
      const still = (stored || []).some(n => n.idea_id === id && !nowIrrelevant.has(n.id) && n.relevant)
      if (still) continue
      const { data: idea } = await sb.from("content_ideas").select("id, status, briefing, feedback, owner, score_override").eq("id", id).maybeSingle()
      if (!idea || idea.status !== "nieuw" || idea.briefing || (idea.feedback || []).length || idea.owner || idea.score_override !== null) continue
      await sb.from("content_ideas").update({ status: "verlopen", decision_note: `Automatisch gearchiveerd: ${flips.find(f => (stored || []).some(n => n.id === f.id && n.idea_id === id))?.note || "niet relevant genoeg"}` }).eq("id", id)
      ctx.existing = ctx.existing.map(e => (e.id === id ? { ...e, status: "verlopen" } : e))
      gearchiveerd++
    }
  }

  // 1c. Voorstellen van een oudere rekenregel die nog niemand heeft aangeraakt: opnieuw opbouwen
  const { data: stale } = await sb.from("content_ideas").select("id, original, title, feedback, score_override, briefing")
    .eq("status", "nieuw").is("score_override", null).is("briefing", null)
  const outdated = (stale || []).filter(i => (i.original?.version ?? 1) !== CONTENT_MODEL_VERSION && i.title === i.original?.title && !(i.feedback || []).length).map(i => i.id)
  if (outdated.length) {
    await sb.from("content_news").update({ idea_id: null }).in("idea_id", outdated)
    const { error: delErr } = await sb.from("content_ideas").delete().in("id", outdated)
    if (delErr) throw new Error(`oude voorstellen opruimen: ${delErr.message}`)
    ctx.existing = ctx.existing.filter(e => !outdated.includes(e.id))
  }
  const rejectedChecks: string[] = []

  // Wat staat er al op de site? Gepubliceerde artikelen, gelezen pagina's en "staat al op de site"-afwijzingen
  const docs = coverDocs(ctx.existing as any[], await readPageFacts().catch(() => []))
  const alOpSite: string[] = []

  // 2. Relevante berichten zonder voorstel → voorstel (of als extra bron bij een vergelijkbaar voorstel)
  const since = new Date(Date.now() - MAX_AGE_DAYS * dayMs).toISOString()
  const { data: open } = await sb.from("content_news").select("*").eq("relevant", true).is("idea_id", null).gte("published_at", since).order("published_at", { ascending: true })
  let created = 0, merged = 0
  for (const n of open || []) {
    const item = { sourceId: n.source_id, url: n.url, title: n.title, summary: n.summary || "", published: n.published_at, firstSeen: n.date_is_first_seen, services: n.services, impact: n.impact as Impact, regions: n.regions, reason: n.reason }
    const web = n.source_kind === "web"
    const src = web ? { publisher: n.publisher || new URL(n.url).hostname.replace(/^www\./, ""), reliability: reliabilityOf(n.url) }
      : SOURCES.find(s => s.id === n.source_id) || { publisher: n.source_id, reliability: "overheid" as const }
    const draft = newsDraft(item, src, ctx, web ? "trend" : "actualiteit")
    // Hetzelfde nieuws staat al op de site (of is daarom afgewezen): geen nieuwe kans, de bron gaat bij die kans
    const cov = coverageFor({ subject: n.title, summary: n.summary, service: draft.service, date: n.published_at }, docs)
    if (cov?.strength === "zelfde-nieuws") {
      const host = ctx.existing.find(e => e.id === cov.id)
      if (host) {
        const sources = [...(host.sources || []), draft.sources[0]]
        await sb.from("content_ideas").update({ sources }).eq("id", host.id)
        host.sources = sources
        await sb.from("content_news").update({ idea_id: host.id }).eq("id", n.id)
        alOpSite.push(`${n.title} → ${cov.path || cov.title}`)
        continue
      }
    }
    if (cov?.strength === "onderwerp") draft.coveredBy = cov
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
    const built = buildIdea(draft, ctx)
    if ("issues" in built) { rejectedChecks.push(`${draft.subject}: ${(built as any).issues.join(" ")}`); continue }
    const row = built
    const { data: ins, error } = await sb.from("content_ideas").upsert(row, { onConflict: "fingerprint", ignoreDuplicates: true }).select("id, fingerprint, origin, status, service, sources, created_at, title").maybeSingle()
    if (error) throw new Error(`voorstel opslaan: ${error.message}`)
    if (ins) {
      ctx.existing.push(ins as any)
      await sb.from("content_news").update({ idea_id: ins.id }).eq("id", n.id)
      created++
    }
  }

  // 2b. Openstaande nieuwskansen die nog niemand heeft aangeraakt: staat hetzelfde nieuws inmiddels op de site?
  //     Dan archiveren (met uitleg). Staat alleen het onderwerp er al: markeren, zodat het in de kans zichtbaar is.
  const { data: openIdeas } = await sb.from("content_ideas").select("id, title, summary, why_now, sources, service, created_at, briefing, feedback, owner, score_override, covered_by")
    .eq("status", "nieuw").in("origin", ["actualiteit", "trend"])
  let gedekt = 0
  for (const i of openIdeas || []) {
    const dates = (i.sources || []).map((s: SourceRef) => s.date).filter(Boolean).sort()
    const cov = coverageFor({ id: i.id, subject: i.title, summary: i.summary, whyNow: i.why_now, sourceTitles: (i.sources || []).map((s: SourceRef) => s.title), service: i.service, date: dates.slice(-1)[0] || i.created_at }, docs)
    if (!cov) continue
    const untouched = !i.briefing && !(i.feedback || []).length && !i.owner && i.score_override === null
    if (cov.strength === "zelfde-nieuws" && untouched) {
      await sb.from("content_ideas").update({ status: "verlopen", covered_by: cov, decision_note: `Automatisch gearchiveerd: ${coverageText(cov)}` }).eq("id", i.id)
      ctx.existing = ctx.existing.map(e => (e.id === i.id ? { ...e, status: "verlopen" } : e))
      alOpSite.push(`${i.title} → ${cov.path || cov.title} (gearchiveerd)`)
      gedekt++
    } else if (JSON.stringify(i.covered_by) !== JSON.stringify(cov)) {
      await sb.from("content_ideas").update({ covered_by: cov }).eq("id", i.id)
    }
  }

  // 3. Zoekdata en seizoen (één voorstel per dienst per maand / per seizoen per jaar)
  const known = new Set(ctx.existing.map(e => e.fingerprint))
  // Zoekdata-voorstellen die vooral dezelfde zoekwoorden gebruiken als een seizoensvoorstel, vallen af (geen eigen concurrentie)
  const seasons = seasonDrafts(ctx)
  const searches = searchDrafts(ctx).filter(d => !seasons.some(sd => keywordOverlap(d.keywords, sd.keywords) >= 0.5))
  const extra = [...searches, ...seasons].filter(d => !known.has(d.fingerprint)).map(d => buildIdea(d, ctx))
    .filter(b => { if ("issues" in b) { rejectedChecks.push(`${b.title}: ${(b as any).issues.join(" ")}`); return false } return true })
  if (extra.length) {
    const { error } = await sb.from("content_ideas").upsert(extra, { onConflict: "fingerprint", ignoreDuplicates: true })
    if (error) throw new Error(`voorstellen opslaan: ${error.message}`)
  }

  // 3b. Actualiteitscontrole: noemt de eigen site regels of bedragen waar recent nieuws over is?
  let actueel: Record<string, unknown> = {}
  try {
    actueel = await refreshPageFacts()
    const facts = await readPageFacts()
    const { data: upd } = await sb.from("content_news").select("url, title, summary, published_at, impact, source_id, publisher, source_kind").eq("relevant", true).gte("published_at", since)
    const news: NewsRef[] = (upd || []).map(n => ({ ...n, reliability: n.source_kind === "web" ? reliabilityOf(n.url) : (SOURCES.find(x => x.id === n.source_id)?.reliability || "nieuws") }))
    const known2 = new Set(ctx.existing.map(e => e.fingerprint))
    const fresh = freshnessDrafts(facts, news, ctx).filter(d => !known2.has(d.fingerprint)).map(d => buildIdea(d, ctx))
      .filter(b => { if ("issues" in b) { rejectedChecks.push(`${b.title}: ${(b as any).issues.join(" ")}`); return false } return true })
    if (fresh.length) {
      const { error } = await sb.from("content_ideas").upsert(fresh, { onConflict: "fingerprint", ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
    actueel = { ...actueel, controleKansen: fresh.length, paginasMetZinnen: facts.filter(f => f.facts.length).length }
  } catch (e: any) { actueel = { fout: e?.message || "actualiteitscontrole mislukt" } }

  // 3c. Refresh nodig: pagina's die duidelijk minder vertoningen krijgen dan de rest van de site.
  // Niet voor pagina's waar al een bijwerkkans openstaat of die de laatste 56 dagen zijn aangepast
  // (dan loopt er een meting en hoort een daling daarbij).
  let refresh: Record<string, unknown> = {}
  try {
    const recent = new Date(Date.now() - 56 * dayMs).toISOString().slice(0, 10)
    const [{ data: pg }, { data: exps }, facts] = await Promise.all([
      sb.from("seo_pages").select("path, page_type, in_sitemap, http_status, http_final_path, imp_28d, imp_prev_28d, clicks_28d, position_28d").eq("in_sitemap", true),
      sb.from("seo_experiments").select("page, baseline").gte("changed_at", recent),
      readPageFacts().catch(() => []),
    ])
    const skip = new Set<string>()
    for (const e of ctx.existing) {
      const open = !["afgewezen", "verlopen", "samengevoegd"].includes(e.status) && !(e.status === "gepubliceerd" && (e.published_at || "") < recent)
      if (open && e.target_page) skip.add(e.target_page)
    }
    for (const x of exps || []) for (const p of [x.page, ...((x.baseline?.paths as string[]) || [])]) if (p) skip.add(toPath(p))
    const titles = new Map(facts.filter(f => f.title).map(f => [f.path, f.title!.split("|")[0].trim()]))
    const known3 = new Set(ctx.existing.map(e => e.fingerprint))
    const drafts = decayDrafts((pg || []) as DecayPage[], { skip, titles }).filter(d => !known3.has(d.fingerprint)).map(d => buildIdea(d, ctx))
      .filter(b => { if ("issues" in b) { rejectedChecks.push(`${b.title}: ${(b as any).issues.join(" ")}`); return false } return true })
    if (drafts.length) {
      const { error } = await sb.from("content_ideas").upsert(drafts, { onConflict: "fingerprint", ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
    refresh = { nieuweRefreshKansen: drafts.length }
  } catch (e: any) { refresh = { fout: e?.message || "refresh-controle mislukt" } }

  // 4. Onbehandelde actualiteiten die te oud zijn → verlopen
  // Verouderde zinnen en dalende pagina's verlopen niet: die blijven staan tot iemand ze behandelt
  const old = ctx.existing.filter(e => e.status === "nieuw" && (e.origin === "actualiteit" || e.origin === "trend") && mayExpire(e)
    && Math.max(...(e.sources || []).map((s: SourceRef) => (s.date ? new Date(s.date).getTime() : 0))) < Date.now() - MAX_AGE_DAYS * dayMs)
  if (old.length) await sb.from("content_ideas").update({ status: "verlopen", decision_note: `Automatisch gearchiveerd: het nieuws is ouder dan ${MAX_AGE_DAYS} dagen en de kans is niet opgepakt.` }).in("id", old.map(o => o.id))

  const failed = status.filter(s => !s.ok)
  return {
    bronnen: status.length, bronnenMislukt: failed.length, berichten: items.length, recent: recent.length,
    relevant: classified.filter(c => c.relevant).length, herbeoordeeld: flips.length, gearchiveerd, webVondsten: webChecked, herbouwd: outdated.length, geblokkeerdDoorControle: rejectedChecks, alOpSite, alOpSiteGearchiveerd: gedekt, nieuweKansen: created + extra.length, samengevoegd: merged, verlopen: old.length,
    ...(failed.length === status.length ? { fout: `Geen enkele bron bereikbaar (${failed[0]?.error})` } : {}),
    bronStatus: status, actualiteitscontrole: actueel, refreshControle: refresh,
  }
}

// ── Metingen na publicatie (7, 30 en 90 dagen) ─────────────────────────────

const WINDOWS = [["d7", 7], ["d30", 30], ["d90", 90]] as const

export async function evaluatePublished() {
  const sb = getSupabase()
  const { data } = await sb.from("content_ideas").select("id, published_url, published_at, evals, advice, keywords, target_page").eq("status", "gepubliceerd").not("published_at", "is", null)
  const sc = serviceSearchConsole()
  const lastComplete = new Date(Date.now() - 3 * dayMs)
  let measured = 0, updates = 0
  let campaigns: Campaign[] | null = null
  for (const idea of data || []) {
    // Bijgewerkte bestaande pagina: voor/na-experiment op dezelfde pagina (14, 28, 56 dagen)
    if (isPageUpdate(idea)) {
      if (!idea.published_url && !idea.target_page) continue
      if (campaigns === null) { const { data: c } = await sb.from("seo_campaigns").select("*"); campaigns = (c || []) as Campaign[] }
      const next = await measureUpdate(sc, idea, lastComplete.toISOString().slice(0, 10), campaigns)
      if (next) { await sb.from("content_ideas").update({ evals: { ...(idea.evals || {}), update: next } }).eq("id", idea.id); updates++ }
      continue
    }
    if (!idea.published_url) continue
    const evals = { ...(idea.evals || {}) }
    const start = new Date(idea.published_at + "T00:00:00Z")
    let changed = false
    for (const [key, days] of WINDOWS) {
      const end = new Date(start.getTime() + (days - 1) * dayMs)
      if (end > lastComplete) continue
      const path = toPath(idea.published_url)
      const s0 = start.toISOString().slice(0, 10), e0 = end.toISOString().slice(0, 10)
      // GA4 (bekeken, tijd op de pagina, aanvragen); ook achteraf aanvullen voor oudere metingen
      if (evals[key] && evals[key].ga4 === undefined) {
        try {
          evals[key] = { ...evals[key], ga4: await articleGa4(path, s0, e0), ...(key === "d30" ? { ga4Before: await articleGa4(path, addDaysIso(s0, -days), addDaysIso(s0, -1)) } : {}) }
        } catch (e: any) { evals[key] = { ...evals[key], ga4: null, ga4Error: String(e?.message || e).slice(0, 200) } }
        changed = true
      }
      if (evals[key]) continue
      const rows = await gscQuery(sc, {
        startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10),
        dimensions: ["page"], dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: path }] }], rowLimit: 50,
      })
      const own = rows.filter(r => toPath(r.keys[0]).replace(/\/$/, "") === path.replace(/\/$/, ""))
      const imp = own.reduce((s, r) => s + r.impressions, 0), clicks = own.reduce((s, r) => s + r.clicks, 0)
      const pos = imp ? own.reduce((s, r) => s + r.position * r.impressions, 0) / imp : null
      let ga4: any = null, ga4Before: any = undefined, ga4Error: string | undefined
      try {
        ga4 = await articleGa4(path, s0, e0)
        if (key === "d30") ga4Before = await articleGa4(path, addDaysIso(s0, -days), addDaysIso(s0, -1))
      } catch (e: any) { ga4Error = String(e?.message || e).slice(0, 200) }
      evals[key] = { impressions: imp, clicks, ctr: imp ? clicks / imp : 0, position: pos !== null ? Math.round(pos * 10) / 10 : null, measured_at: new Date().toISOString(), window: `${s0} – ${e0}`, ga4, ...(ga4Before !== undefined ? { ga4Before } : {}), ...(ga4Error ? { ga4Error } : {}) }
      changed = true; measured++
    }
    if (changed) await sb.from("content_ideas").update({ evals }).eq("id", idea.id)
  }
  return { gepubliceerd: data?.length ?? 0, metingen: measured, paginaUpdates: updates }
}

// ── Bijgewerkte pagina's: voor/na-meting ──────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

async function searchSnapshot(sc: ReturnType<typeof serviceSearchConsole>, path: string, queries: string[], w: { start: string; end: string; days: number }): Promise<Omit<UpdateSnapshot, "ga4" | "ga4Error">> {
  // Met en zonder slash aan het eind; nooit andere pagina's die met hetzelfde pad beginnen
  const pageF = { dimension: "page", operator: "includingRegex", expression: `^${escapeRe(SITE_ORIGIN + (path.replace(/\/$/, "") || ""))}/?$` }
  const range = { startDate: w.start, endDate: w.end }
  const [pageRows, qRows, siteRows] = await Promise.all([
    gscQuery(sc, { ...range, dimensions: ["page"], dimensionFilterGroups: [{ filters: [pageF] }], rowLimit: 10 }),
    queries.length ? gscQuery(sc, { ...range, dimensions: ["query"], dimensionFilterGroups: [{ filters: [pageF] }], rowLimit: 5000 }) : Promise.resolve([]),
    gscQuery(sc, { ...range, dimensions: ["date"], rowLimit: 100 }),
  ])
  const total = (rows: { impressions: number; clicks: number; position: number }[]): SearchTotals => {
    const impressions = rows.reduce((s, r) => s + r.impressions, 0), clicks = rows.reduce((s, r) => s + r.clicks, 0)
    return { impressions, clicks, position: impressions ? Math.round((rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions) * 10) / 10 : null }
  }
  const wanted = new Set(queries)
  const siteImp = siteRows.reduce((s, r) => s + r.impressions, 0)
  return {
    window: w,
    page: total(pageRows),
    queries: total(qRows.filter(r => wanted.has(String(r.keys[0]).toLowerCase().trim()))),
    siteImpressionsPerDay: siteRows.length ? Math.round(siteImp / siteRows.length) : null,
  }
}

async function withGa4<T extends object>(path: string, w: { start: string; end: string }, snap: T): Promise<T & { ga4?: any; ga4Error?: string }> {
  try { return { ...snap, ga4: await articleGa4(path, w.start, w.end) } }
  catch (e: any) { return { ...snap, ga4: null, ga4Error: String(e?.message || e).slice(0, 200) } }
}

// Meet wat er nog te meten valt; geeft de bijgewerkte meting terug (of null als er niets veranderde)
export async function measureUpdate(sc: ReturnType<typeof serviceSearchConsole>, idea: any, lastComplete: string, campaigns: Campaign[]): Promise<UpdateMeasure | null> {
  const changedAt = String(idea.published_at).slice(0, 10)
  const path = toPath(idea.published_url || idea.target_page)
  const prev: UpdateMeasure | undefined = idea.evals?.update || undefined
  const m: UpdateMeasure = prev && prev.page === path && prev.changed_at === changedAt
    ? { ...prev, points: { ...prev.points } }
    : { page: path, queries: updateQueries(idea.keywords), changed_at: changedAt, baseline: null, points: {}, outcome: null }
  if (m.outcome) return null
  // Nieuwe meting (of de pagina/datum is gewijzigd en we beginnen opnieuw)
  let changed = !prev || prev.page !== path || prev.changed_at !== changedAt
  if (!m.baseline) {
    const w = baselineWindow(changedAt)
    m.baseline = await withGa4(path, w, await searchSnapshot(sc, path, m.queries, w))
    changed = true
  }
  for (const days of UPDATE_MILESTONES) {
    const key = `d${days}` as const
    if (m.points[key]) continue
    const w = pointWindow(changedAt, days)
    if (w.end > lastComplete) break
    const snap = await withGa4(path, w, await searchSnapshot(sc, path, m.queries, w))
    const b = m.baseline!.siteImpressionsPerDay
    const growth = b && snap.siteImpressionsPerDay ? Math.round((snap.siteImpressionsPerDay / b) * 100) / 100 : null
    const confounders: string[] = []
    for (const [prov, date] of Object.entries(LAUNCH_DATES)) if (date >= m.baseline!.window.start && date <= w.end) confounders.push(`Provincie ${prov} gelanceerd op ${date}`)
    for (const c of campaigns) if (overlaps(c, m.baseline!.window.start, w.end)) confounders.push(describe(c))
    m.points[key] = { ...snap, days, measured_at: new Date().toISOString(), growth, confounders }
    m.measured_at = new Date().toISOString()
    changed = true
  }
  const j = judgeUpdate(m)
  if (j.final && j.outcome) {
    m.outcome = j.outcome
    m.evidence = compare(m.baseline!, m.points.d56!).enough ? "telt mee" : "te weinig data"
    changed = true
  }
  return changed ? m : null
}
