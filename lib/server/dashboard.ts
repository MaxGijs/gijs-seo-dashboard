// Dashboard — cijfers ophalen en samenvatten (server).
// Alles leest alleen: Search Console via het service-account, GA4 via hetzelfde account,
// en de eigen opslag (Supabase) voor sitemap-status en synchronisaties.

import { BetaAnalyticsDataClient } from "@google-analytics/data"
import { getSupabase, supabaseConfigured } from "./guard"
import { readStalled, type Stalled } from "./stalled"
import { gscQuery, GSC_LAG_DAYS, serviceSearchConsole, toPath, type GscRow } from "./gsc"
import { isBrandQuery } from "@/lib/signals"
import { classifyPath, prettySlug } from "@/lib/pages"
import { SERVICE_TERMS } from "@/lib/content/model"
import {
  type Compare, type Conclusion, type DashboardData, type DashboardQuery, type DataNote, type Driver, type KeywordItem,
  type LeadEvent, type Measurement, type Metric, type PageItem, type Range, type SeriesPoint, type TrendItem, type TrendSet,
  type Warning, deltaPct, FORM_EVENT_RE, LEAD_EVENTS, TREND_MIN_IMPRESSIONS,
} from "@/lib/dashboard"

const DAY = 86400000
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00Z`)
const addDays = (s: string, n: number) => fmt(new Date(parse(s).getTime() + n * DAY))
const daysIncl = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY) + 1

// ── Periodes ────────────────────────────────────────────────────────────────

export function lastCompleteDay() {
  return fmt(new Date(Date.now() - GSC_LAG_DAYS * DAY))
}

export function resolveRanges(q: DashboardQuery): { cur: Range; cmp: Range | null } {
  const maxEnd = lastCompleteDay()
  let start: string, end: string
  if (q.period === "custom" && q.start && q.end && /^\d{4}-\d{2}-\d{2}$/.test(q.start) && /^\d{4}-\d{2}-\d{2}$/.test(q.end)) {
    end = q.end > maxEnd ? maxEnd : q.end
    start = q.start > end ? end : q.start
    if (daysIncl(start, end) > 480) start = addDays(end, -479)
  } else {
    const n = q.period === "custom" ? 28 : parseInt(q.period, 10)
    end = maxEnd
    start = addDays(end, -(n - 1))
  }
  const days = daysIncl(start, end)
  const cur = { start, end, days }
  let cmp: Range | null = null
  if (q.compare === "prev") cmp = { start: addDays(start, -days), end: addDays(start, -1), days }
  if (q.compare === "year") {
    const s = parse(start), e = parse(end)
    s.setUTCFullYear(s.getUTCFullYear() - 1); e.setUTCFullYear(e.getUTCFullYear() - 1)
    cmp = { start: fmt(s), end: fmt(e), days: daysIncl(fmt(s), fmt(e)) }
  }
  return { cur, cmp }
}

// ── Filters ─────────────────────────────────────────────────────────────────

const SLUG = /^[a-z0-9-]{2,60}$/
function cleanSlug(s?: string | null) { return s && SLUG.test(s) ? s : null }

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

function gscFilters(regio: string | null, dienst: string | null) {
  const filters: any[] = []
  if (regio) filters.push({ dimension: "page", operator: "contains", expression: `/regio/${regio}` })
  if (dienst) {
    const terms = SERVICE_TERMS[dienst] || [dienst.replace(/-/g, " ")]
    filters.push({ dimension: "query", operator: "includingRegex", expression: `(?i)(${terms.map(escapeRe).join("|")})` })
  }
  return filters.length ? [{ groupType: "and", filters }] : undefined
}

function ga4PageFilter(regio: string | null, dienst: string | null): any[] {
  const out: any[] = []
  if (regio) out.push({ filter: { fieldName: "landingPage", stringFilter: { matchType: "BEGINS_WITH", value: `/regio/${regio}` } } })
  if (dienst) out.push({ filter: { fieldName: "landingPage", stringFilter: { matchType: "CONTAINS", value: `/maatregelen/${dienst}` } } })
  return out
}
function ga4Filter(regio: string | null, dienst: string | null, leadEvents?: string[]) {
  const parts = ga4PageFilter(regio, dienst)
  if (leadEvents) parts.push({ filter: { fieldName: "eventName", inListFilter: { values: leadEvents } } })
  if (!parts.length) return undefined
  return parts.length === 1 ? parts[0] : { andGroup: { expressions: parts } }
}

// ── GA4 ─────────────────────────────────────────────────────────────────────

function ga4Client() {
  const propertyId = process.env.GA4_PROPERTY_ID
  if (!propertyId) throw new Error("GA4_PROPERTY_ID ontbreekt")
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  return { client: new BetaAnalyticsDataClient({ credentials }), property: `properties/${propertyId}` }
}

type Ga4 = ReturnType<typeof ga4Client>
async function ga4Report(g: Ga4, body: Record<string, unknown>) {
  const [res] = await g.client.runReport({ property: g.property, ...body } as any)
  return (res.rows || []).map(r => ({
    dims: (r.dimensionValues || []).map(v => v.value || ""),
    mets: (r.metricValues || []).map(v => Number(v.value || 0)),
  }))
}
const ga4Path = (raw: string) => ((raw || "/").split("?")[0].replace(/\/$/, "") || "/")
const ga4Date = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`

async function readMeasurement(g: Ga4): Promise<Measurement> {
  const rows = await ga4Report(g, {
    dateRanges: [{ startDate: "90daysAgo", endDate: "yesterday" }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "sessions" }, { name: "keyEvents" }],
    limit: 500,
  })
  const events: LeadEvent[] = rows
    .map(r => ({ name: r.dims[0], count: r.mets[0], sessions: r.mets[1], isKey: r.mets[2] > 0 }))
    .filter(e => LEAD_EVENTS.includes(e.name) || FORM_EVENT_RE.test(e.name))
    .sort((a, b) => b.count - a.count)
  const used = events.filter(e => LEAD_EVENTS.includes(e.name) && e.count > 0).map(e => e.name)
  if (!used.length) {
    return {
      status: "geen-event", used, events,
      note: events.length
        ? `GA4 bevat geen event dat duidelijk een energiescanaanvraag is. Wel gevonden: ${events.map(e => e.name).join(", ")}.`
        : "GA4 heeft de afgelopen 90 dagen geen aanvraag- of formulier-event ontvangen.",
      advice: "Controleer in GA4 (Beheer → Gebeurtenissen) of het energiescanformulier een event verstuurt na een geslaagde inzending. Maak er één vast event van, bij voorkeur energy_scan_request_submitted, en markeer het als key event. Het dashboard telt vanaf dan automatisch mee.",
    }
  }
  const multi = used.length > 1
  const dup = events.filter(e => used.includes(e.name) && e.sessions > 0 && e.count > e.sessions * 1.2)
  const typo = used.includes("energyscan_requeted")
  const notKey = events.filter(e => used.includes(e.name) && !e.isKey)
  if (!multi && !dup.length && !typo) {
    return {
      status: "ok", used, events,
      note: `Aanvragen worden geteld via het event ${used[0]}, één per sessie.${notKey.length ? " Het event is nog niet als key event gemarkeerd; dat hoeft niet voor dit dashboard, wel voor de conversierapporten in GA4 zelf." : ""}`,
      advice: "Geen actie nodig. Controleer na een wijziging aan het formulier of het event nog steeds één keer per aanvraag binnenkomt.",
    }
  }
  const issues: string[] = []
  if (multi) issues.push(`er komen ${used.length} verschillende aanvraag-events binnen (${used.join(", ")}); mogelijk vuurt één inzending er meerdere af`)
  if (dup.length) issues.push(`${dup.map(e => e.name).join(", ")} komt vaker binnen dan er sessies zijn (${dup.map(e => `${e.count}× in ${e.sessions} sessies`).join("; ")})`)
  if (typo) issues.push("het event energyscan_requeted lijkt een typefout")
  return {
    status: "controleren", used, events,
    note: `Het dashboard telt sessies met minstens één van deze events, zodat één aanvraag niet dubbel telt. Wel: ${issues.join("; ")}.`,
    advice: "Doe zelf één testaanvraag via het energiescanformulier en kijk in GA4 (Rapporten → Realtime) welke events binnenkomen. Houd daarna één event over als officiële energiescanaanvraag en laat de rest weg of hernoem ze. Meet vanaf die datum opnieuw.",
  }
}

// ── Search Console ──────────────────────────────────────────────────────────

function totals(rows: GscRow[]) {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0)
  const impressions = rows.reduce((s, r) => s + r.impressions, 0)
  const position = impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : null
  return { clicks, impressions, position, ctr: impressions ? clicks / impressions : null }
}

const round1 = (n: number) => Math.round(n * 10) / 10

function kwItem(r: GscRow, prev?: GscRow): KeywordItem {
  return { query: r.keys[0], position: round1(r.position), prevPosition: prev ? round1(prev.position) : null, impressions: r.impressions, clicks: r.clicks }
}

// ── Trends per week ─────────────────────────────────────────────────────────

const trendCache = new Map<string, { at: number; value: { keywords: TrendSet; pages: TrendSet; weekEnds: string[] } }>()

function emptySet(): TrendSet {
  return { nieuwPagina1: [], stijgend: [], stilstand: [], dalend: [], bijna: [], counts: { nieuwPagina1: 0, stijgend: 0, stilstand: 0, dalend: 0, bijna: 0 } }
}

export function classifyTrends(weeks: Map<string, (GscRow | null)[]>, exclude: (k: string) => boolean): TrendSet {
  const set = emptySet()
  for (const [key, w] of weeks) {
    if (exclude(key)) continue
    // w[0] = nieuwste week
    const recent = w.slice(0, 4)
    const imp4 = recent.reduce((s, r) => s + (r?.impressions || 0), 0)
    if (imp4 < TREND_MIN_IMPRESSIONS) continue
    const pos = w.map(r => (r ? round1(r.position) : null))
    const now = pos[0]
    const agg = imp4 ? recent.reduce((s, r) => s + (r ? r.position * r.impressions : 0), 0) / imp4 : null
    const item: TrendItem = { key, weeks: [...pos].reverse(), positionNow: now ?? round1(agg || 0), positionThen: null, impressions4w: imp4 }
    const full4 = recent.every(r => r)
    if (now !== null && now <= 10 && !pos.slice(1).some(p => p !== null && p <= 10)) {
      set.nieuwPagina1.push({ ...item, positionThen: pos.slice(1).find(p => p !== null) ?? null })
    }
    if (full4) {
      const [a, b, c, d] = pos as number[]
      if (a < b && b < c && c < d && d - a >= 1) set.stijgend.push({ ...item, positionThen: d })
      else if (a > b && b > c && c > d && a - d >= 1) set.dalend.push({ ...item, positionThen: d })
      else {
        const p4 = [a, b, c, d]
        const mean = p4.reduce((s, x) => s + x, 0) / 4
        if (mean > 3 && mean <= 20 && Math.max(...p4) - Math.min(...p4) <= 2) set.stilstand.push({ ...item, positionThen: d })
      }
    }
    if (agg !== null && agg > 10 && agg <= 20) set.bijna.push({ ...item, positionNow: round1(agg), positionThen: null })
  }
  for (const k of ["nieuwPagina1", "stijgend", "stilstand", "dalend", "bijna"] as const) {
    set[k].sort((x, y) => y.impressions4w - x.impressions4w)
    set.counts[k] = set[k].length
    set[k] = set[k].slice(0, 12)
  }
  return set
}

async function readTrends(sc: ReturnType<typeof serviceSearchConsole>, regio: string | null, dienst: string | null) {
  const end = lastCompleteDay()
  const key = `${end}|${regio}|${dienst}`
  const hit = trendCache.get(key)
  if (hit && Date.now() - hit.at < 3 * 3600e3) return hit.value
  const weekEnds = Array.from({ length: 8 }, (_, i) => addDays(end, -7 * i))
  const filter = gscFilters(regio, dienst)
  const fetchWeek = (we: string, dim: "query" | "page") =>
    gscQuery(sc, { startDate: addDays(we, -6), endDate: we, dimensions: [dim], rowLimit: 5000, dimensionFilterGroups: filter })
  const [q, p] = await Promise.all([
    Promise.all(weekEnds.map(we => fetchWeek(we, "query"))),
    Promise.all(weekEnds.map(we => fetchWeek(we, "page"))),
  ])
  const toMap = (weeksRows: GscRow[][], keyOf: (r: GscRow) => string) => {
    const m = new Map<string, (GscRow | null)[]>()
    weeksRows.forEach((rows, i) => {
      for (const r of rows) {
        const k = keyOf(r)
        if (!m.has(k)) m.set(k, Array(8).fill(null))
        m.get(k)![i] = r
      }
    })
    return m
  }
  const value = {
    keywords: classifyTrends(toMap(q, r => r.keys[0]), isBrandQuery),
    pages: classifyTrends(toMap(p, r => toPath(r.keys[0])), () => false),
    weekEnds: [...weekEnds].reverse(),
  }
  trendCache.set(key, { at: Date.now(), value })
  return value
}

// ── Samenvatting ────────────────────────────────────────────────────────────

const GROUP_LABEL: Record<string, string> = {
  lokaal: "lokale pagina's", maatregel: "maatregelpagina's", home: "de homepage", artikel: "artikelen", overig: "overige pagina's",
}
function groupOf(path: string) {
  const t = classifyPath(path).type
  if (t === "provincie" || t === "gemeente" || t === "plaats" || t === "overzicht") return "lokaal"
  if (t === "maatregel" || t === "home" || t === "artikel") return t
  return "overig"
}

function signed(n: number, digits = 0) {
  const s = Math.abs(n).toLocaleString("nl-NL", { maximumFractionDigits: digits })
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${s}`
}
function signedP(p: number | null) { return p === null ? "" : `${signed(Math.round(p))}%` }

function buildDrivers(pages: PageItem[], hasCmp: boolean): Driver[] {
  if (!hasCmp) return []
  const groups = new Map<string, { imp: number; prev: number; clicks: number; prevClicks: number }>()
  for (const p of pages) {
    const g = groupOf(p.path)
    const x = groups.get(g) || { imp: 0, prev: 0, clicks: 0, prevClicks: 0 }
    x.imp += p.impressions; x.prev += p.prevImpressions || 0; x.clicks += p.clicks; x.prevClicks += p.prevClicks || 0
    groups.set(g, x)
  }
  const out: Driver[] = []
  const totalDelta = [...groups.values()].reduce((s, g) => s + (g.imp - g.prev), 0)
  const sorted = [...groups.entries()].map(([g, v]) => ({ g, d: v.imp - v.prev, v })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
  for (const { g, d, v } of sorted.slice(0, 3)) {
    if (Math.abs(d) < 20) continue
    const share = totalDelta && Math.sign(d) === Math.sign(totalDelta) ? Math.round((d / totalDelta) * 100) : null
    out.push({
      tone: d > 0 ? "up" : "down",
      summary: `${GROUP_LABEL[g]} (${signed(d)} vertoningen)`,
      text: `Vertoningen van ${GROUP_LABEL[g]} ${signed(d)} (${signedP(v.prev ? (d / v.prev) * 100 : null) || "nieuw"})${share && share > 20 && share <= 100 ? `, ${share}% van de verandering` : ""}.`,
    })
  }
  const byClicks = pages.filter(p => p.prevClicks !== null).map(p => ({ p, d: p.clicks - (p.prevClicks || 0) })).sort((a, b) => b.d - a.d)
  const top = byClicks[0], bottom = byClicks[byClicks.length - 1]
  const nm = (p: string) => (p === "/" ? "de homepage" : p)
  if (top && top.d >= 3) out.push({ tone: "up", text: `Grootste stijger in klikken: ${nm(top.p.path)} (${signed(top.d)}).` })
  if (bottom && bottom.d <= -3) out.push({ tone: "down", text: `Grootste daler in klikken: ${nm(bottom.p.path)} (${signed(bottom.d)}).` })
  return out
}

function buildConclusion(d: Pick<DashboardData, "cards" | "warnings" | "drivers" | "measurement" | "compareRange">): Conclusion {
  const { cards } = d
  const attention = d.warnings.some(w => w.severity === "error")
  const p1 = cards.page1, imp = cards.impressions, clk = cards.clicks, req = cards.requests
  const parts: string[] = []
  if (p1.value !== null) parts.push(`${p1.value} zoekwoorden op pagina 1${p1.prev !== null ? ` (${p1.value === p1.prev ? "gelijk" : signed(p1.value - p1.prev)})` : ""}`)
  if (imp.value !== null) parts.push(`vertoningen ${d.compareRange ? signedP(deltaPct(imp)) || num(imp.value) : num(imp.value)}`)
  if (clk.value !== null) parts.push(`Google-klikken ${d.compareRange ? signedP(deltaPct(clk)) || num(clk.value) : num(clk.value)}`)
  let body = parts.length ? cap(parts.join(", ")) + "." : ""
  const totalUp = (deltaPct(imp) ?? 0) >= 0
  const mainDriver = d.drivers.find(x => x.summary && (x.tone === "up") === totalUp)
  if (mainDriver) body += ` De ${totalUp ? "groei" : "daling"} komt vooral van ${mainDriver.summary}.`
  if (req.value === null) {
    body += d.measurement.status === "geen-event" ? " Energiescanaanvragen worden nog niet gemeten." : " Energiescanaanvragen zijn niet beschikbaar."
  } else if ((req.value || 0) + (req.prev || 0) < 10) {
    body += ` ${req.value} ${req.value === 1 ? "energiescanaanvraag" : "energiescanaanvragen"}: nog te weinig voor een betrouwbare trend.`
  } else {
    body += ` ${req.value} energiescanaanvragen${req.prev !== null ? ` (${signedP(deltaPct(req))})` : ""}.`
  }
  if (attention) body += ` Daarnaast: ${d.warnings.find(w => w.severity === "error")!.what.replace(/\.$/, "")}.`

  if (!d.compareRange || imp.prev === null) {
    return { tone: "geen-vergelijking", headline: attention ? "Er is technische aandacht nodig" : "Zo staat de website ervoor", body: body.trim(), attention }
  }
  const ip = deltaPct(imp) ?? 0
  const dp1 = p1.value !== null && p1.prev !== null ? p1.value - p1.prev : 0
  const tone: Conclusion["tone"] = ip >= 5 || (dp1 > 0 && ip > -5) ? "groei" : ip <= -5 || (dp1 < 0 && ip < 5) ? "daling" : "stabiel"
  const base = tone === "groei" ? "De zichtbaarheid groeit" : tone === "daling" ? "De zichtbaarheid daalt" : "De zichtbaarheid is stabiel"
  return { tone, headline: attention ? `${base}, maar er is technische aandacht nodig` : base, body: body.trim(), attention }
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
function num(n: number) { return n.toLocaleString("nl-NL") }

// ── Hoofdfunctie ────────────────────────────────────────────────────────────

const cache = new Map<string, { at: number; value: DashboardData }>()

export async function readDashboard(q: DashboardQuery, fresh = false): Promise<DashboardData> {
  const regio = cleanSlug(q.regio), dienst = cleanSlug(q.dienst)
  const { cur, cmp } = resolveRanges(q)
  const cacheKey = JSON.stringify([cur, cmp, regio, dienst])
  const hit = cache.get(cacheKey)
  if (hit && !fresh && Date.now() - hit.at < 10 * 60e3) return hit.value

  const errors: DashboardData["errors"] = { gsc: null, ga4: null, trends: null }
  const sc = serviceSearchConsole()
  const filter = gscFilters(regio, dienst)
  const gq = (r: Range, dims: string[], rowLimit: number) =>
    gscQuery(sc, { startDate: r.start, endDate: r.end, dimensions: dims, rowLimit, dimensionFilterGroups: filter })

  // Search Console
  const gscP = Promise.all([
    gq(cur, ["date"], 500), gq(cur, ["query"], 25000), gq(cur, ["page"], 5000),
    cmp ? gq(cmp, ["date"], 500) : Promise.resolve(null),
    cmp ? gq(cmp, ["query"], 25000) : Promise.resolve(null),
    cmp ? gq(cmp, ["page"], 5000) : Promise.resolve(null),
  ]).catch(e => { errors.gsc = /permission|403/i.test(e?.message || "") ? "Het service-account heeft geen toegang tot Search Console." : e?.message || "Search Console niet bereikbaar"; return null })

  // GA4
  let ga4: Ga4 | null = null
  try { ga4 = ga4Client() } catch (e: any) { errors.ga4 = e?.message || "GA4 niet ingesteld" }
  const measurementP: Promise<Measurement> = ga4
    ? readMeasurement(ga4).catch(e => ({ status: "fout", used: [], events: [], note: `GA4 kon niet worden gelezen: ${e?.message || "onbekende fout"}.`, advice: "Kijk op Datastatus of het service-account toegang heeft tot de GA4-property." }))
    : Promise.resolve({ status: "fout", used: [], events: [], note: errors.ga4 || "GA4 niet ingesteld", advice: "Stel GA4_PROPERTY_ID en het service-account in." })

  const ga4P = (async () => {
    if (!ga4) return null
    const m = await measurementP
    const dr = (r: Range) => [{ startDate: r.start, endDate: r.end }]
    const pageF = ga4Filter(regio, dienst)
    const leadF = m.used.length ? ga4Filter(regio, dienst, m.used) : null
    const base = (r: Range, extra: Record<string, unknown>) => ga4Report(ga4!, { dateRanges: dr(r), ...extra })
    const [daily, dailyReq, tot, totPrev, reqPrev, channels, chanPrev, chanReq, landing, landingPrev, landingReq] = await Promise.all([
      base(cur, { dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "totalUsers" }], dimensionFilter: pageF, limit: 1000 }),
      leadF ? base(cur, { dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], dimensionFilter: leadF, limit: 1000 }) : null,
      base(cur, { metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "totalUsers" }], dimensionFilter: pageF }),
      cmp ? base(cmp, { metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "totalUsers" }], dimensionFilter: pageF }) : null,
      cmp && leadF ? base(cmp, { metrics: [{ name: "sessions" }], dimensionFilter: leadF }) : null,
      base(cur, { dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], dimensionFilter: pageF, limit: 20 }),
      cmp ? base(cmp, { dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], dimensionFilter: pageF, limit: 20 }) : null,
      leadF ? base(cur, { dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], dimensionFilter: leadF, limit: 20 }) : null,
      base(cur, { dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }], dimensionFilter: pageF, limit: 2000 }),
      cmp ? base(cmp, { dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }], dimensionFilter: pageF, limit: 2000 }) : null,
      leadF ? base(cur, { dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }], dimensionFilter: leadF, limit: 500 }) : null,
    ])
    return { daily, dailyReq, tot, totPrev, reqPrev, channels, chanPrev, chanReq, landing, landingPrev, landingReq, hasLead: !!leadF }
  })().catch(e => { errors.ga4 = /PERMISSION_DENIED/i.test(e?.message || "") ? "Het service-account heeft geen toegang tot GA4." : e?.message || "GA4 niet bereikbaar"; return null })

  if (fresh) trendCache.clear()
  const trendsP = readTrends(sc, regio, dienst).catch(e => { errors.trends = e?.message || "Trends niet beschikbaar"; return null })

  const storeP = (async () => {
    if (!supabaseConfigured()) return { sitemapErrors: 0, failedJobs: [] as string[] }
    const sb = getSupabase()
    const [{ count }, { data: logs }] = await Promise.all([
      sb.from("seo_pages").select("path", { count: "exact", head: true }).eq("in_sitemap", true).gte("http_status", 400),
      sb.from("seo_sync_log").select("job, ok, run_at, error").gte("run_at", new Date(Date.now() - 36 * 3600e3).toISOString()).order("run_at", { ascending: false }),
    ])
    const latest = new Map<string, { ok: boolean; error: string | null }>()
    for (const l of logs || []) if (!latest.has(l.job)) latest.set(l.job, l)
    return { sitemapErrors: count || 0, failedJobs: [...latest.entries()].filter(([, l]) => !l.ok).map(([j]) => j) }
  })().catch(() => ({ sitemapErrors: 0, failedJobs: [] as string[] }))

  // Concurrenten: laatste week van de wekelijkse webzoektaak (indicatie, niet exact Google)
  const competitorsP: Promise<DashboardData["competitors"]> = (async () => {
    if (!supabaseConfigured()) return null
    const sb = getSupabase()
    const { data: lastWeek } = await sb.from("seo_serp").select("week").order("week", { ascending: false }).limit(1).maybeSingle()
    if (!lastWeek) return null
    const { data: rows } = await sb.from("seo_serp").select("query, gijs_rank, results").eq("week", lastWeek.week)
    const dom = new Map<string, { count: number; above: number; examples: string[] }>()
    for (const r of rows || []) {
      if (regio || dienst) {
        if (dienst && !(SERVICE_TERMS[dienst] || [dienst]).some(t => r.query.toLowerCase().includes(t))) continue
      }
      for (const res of (r.results || []) as { rank: number; domain: string }[]) {
        const d = (res.domain || "").replace(/^www\./, "").toLowerCase()
        if (!d || d.includes("groeninjestraat")) continue
        const x = dom.get(d) || { count: 0, above: 0, examples: [] }
        x.count++
        if (r.gijs_rank === null || res.rank < r.gijs_rank) x.above++
        if (x.examples.length < 3) x.examples.push(r.query)
        dom.set(d, x)
      }
    }
    return {
      week: lastWeek.week, queries: (rows || []).length, gijsFound: (rows || []).filter(r => r.gijs_rank !== null).length,
      domains: [...dom.entries()].map(([domain, v]) => ({ domain, ...v })).sort((a, b) => b.above - a.above || b.count - a.count).slice(0, 8),
    }
  })().catch(() => null)
  const stalledP: Promise<Stalled[]> = supabaseConfigured() ? readStalled().catch(() => []) : Promise.resolve([])
  const [gsc, g, trends, measurement, store, stalled, competitors] = await Promise.all([gscP, ga4P, trendsP, measurementP, storeP, stalledP, competitorsP])

  // ── Kaarten ──
  const [ovCur, kwCur, pgCur, ovPrev, kwPrev, pgPrev] = gsc || [[], [], [], null, null, null]
  const tCur = totals(ovCur), tPrev = ovPrev ? totals(ovPrev) : null
  const nonBrand = kwCur.filter(r => !isBrandQuery(r.keys[0]))
  const nonBrandPrev = kwPrev ? kwPrev.filter(r => !isBrandQuery(r.keys[0])) : null
  const prevKw = new Map((kwPrev || []).map(r => [r.keys[0], r]))
  const isP1 = (r: GscRow) => r.position <= 10
  const isBijna = (r: GscRow) => r.position > 10 && r.position <= 20
  const gscOk = !!gsc
  const page1 = gscOk ? nonBrand.filter(isP1) : []
  const bijna = gscOk ? nonBrand.filter(isBijna) : []

  const ga4Tot = g?.tot[0]?.mets, ga4TotPrev = g?.totPrev?.[0]?.mets
  const reqCur = g?.hasLead ? (g.dailyReq || []).reduce((s, r) => s + r.mets[0], 0) : null
  const reqPrev = g?.hasLead && cmp ? (g.reqPrev?.[0]?.mets[0] ?? 0) : null

  const metric = (v: number | null, p: number | null | undefined): Metric => ({ value: v, prev: cmp && p !== undefined ? p : null })
  const cards: DashboardData["cards"] = {
    page1: { ...metric(gscOk ? page1.length : null, nonBrandPrev ? nonBrandPrev.filter(isP1).length : null), top3: gscOk ? nonBrand.filter(r => r.position <= 3).length : null, brandPage1: gscOk ? kwCur.filter(r => isBrandQuery(r.keys[0]) && isP1(r)).length : null },
    bijna: metric(gscOk ? bijna.length : null, nonBrandPrev ? nonBrandPrev.filter(isBijna).length : null),
    clicks: metric(gscOk ? tCur.clicks : null, tPrev ? tPrev.clicks : null),
    impressions: metric(gscOk ? tCur.impressions : null, tPrev ? tPrev.impressions : null),
    position: metric(gscOk && tCur.position !== null ? round1(tCur.position) : null, tPrev?.position != null ? round1(tPrev.position) : null),
    ctr: metric(gscOk ? tCur.ctr : null, tPrev ? tPrev.ctr : null),
    sessions: metric(ga4Tot ? ga4Tot[0] : g ? 0 : null, ga4TotPrev ? ga4TotPrev[0] : g && cmp ? 0 : null),
    pageviews: metric(ga4Tot ? ga4Tot[1] : g ? 0 : null, ga4TotPrev ? ga4TotPrev[1] : g && cmp ? 0 : null),
    users: metric(ga4Tot ? ga4Tot[2] : g ? 0 : null, ga4TotPrev ? ga4TotPrev[2] : g && cmp ? 0 : null),
    requests: metric(reqCur, reqPrev),
  }

  // ── Tijdreeks ──
  const byDate = new Map<string, SeriesPoint>()
  for (let i = 0; i < cur.days; i++) {
    const date = addDays(cur.start, i)
    byDate.set(date, { date, clicks: 0, impressions: 0, sessions: g ? 0 : null, requests: g?.hasLead ? 0 : null })
  }
  for (const r of ovCur) { const p = byDate.get(r.keys[0]); if (p) { p.clicks = r.clicks; p.impressions = r.impressions } }
  for (const r of g?.daily || []) { const p = byDate.get(ga4Date(r.dims[0])); if (p) p.sessions = r.mets[0] }
  for (const r of g?.dailyReq || []) { const p = byDate.get(ga4Date(r.dims[0])); if (p) p.requests = r.mets[0] }
  const series = [...byDate.values()]

  // ── Zoekwoorden ──
  const kwSort = (a: KeywordItem, b: KeywordItem) => b.impressions - a.impressions
  const keywords: DashboardData["keywords"] = {
    page1: page1.map(r => kwItem(r, prevKw.get(r.keys[0]))).sort(kwSort),
    bijna: bijna.map(r => kwItem(r, prevKw.get(r.keys[0]))).sort(kwSort),
    newPage1: cmp ? page1.filter(r => { const p = prevKw.get(r.keys[0]); return !p || p.position > 10 }).map(r => kwItem(r, prevKw.get(r.keys[0]))).sort(kwSort) : [],
    lostPage1: cmp && nonBrandPrev ? nonBrandPrev.filter(isP1).filter(p => { const c = kwCur.find(r => r.keys[0] === p.keys[0]); return !c || c.position > 10 })
      .map(p => { const c = kwCur.find(r => r.keys[0] === p.keys[0]); return { query: p.keys[0], position: c ? round1(c.position) : 0, prevPosition: round1(p.position), impressions: c?.impressions || 0, clicks: c?.clicks || 0 } }).sort((a, b) => b.impressions - a.impressions) : [],
    brand: kwCur.filter(r => isBrandQuery(r.keys[0])).map(r => kwItem(r, prevKw.get(r.keys[0]))).sort(kwSort).slice(0, 20),
  }

  // ── Pagina's ──
  const sess = new Map<string, number>(), sessPrev = new Map<string, number>(), reqByPage = new Map<string, number>()
  for (const r of g?.landing || []) sess.set(ga4Path(r.dims[0]), (sess.get(ga4Path(r.dims[0])) || 0) + r.mets[0])
  for (const r of g?.landingPrev || []) sessPrev.set(ga4Path(r.dims[0]), (sessPrev.get(ga4Path(r.dims[0])) || 0) + r.mets[0])
  for (const r of g?.landingReq || []) reqByPage.set(ga4Path(r.dims[0]), (reqByPage.get(ga4Path(r.dims[0])) || 0) + r.mets[0])
  const pgPrevMap = new Map((pgPrev || []).map(r => [toPath(r.keys[0]), r]))
  const pageMap = new Map<string, PageItem>()
  for (const r of pgCur) {
    const path = toPath(r.keys[0]), prev = pgPrevMap.get(path)
    pageMap.set(path, {
      path, clicks: r.clicks, impressions: r.impressions, position: round1(r.position),
      prevClicks: cmp ? prev?.clicks ?? 0 : null, prevImpressions: cmp ? prev?.impressions ?? 0 : null,
      sessions: g ? sess.get(path) ?? 0 : null, prevSessions: g && cmp ? sessPrev.get(path) ?? 0 : null,
      requests: g?.hasLead ? reqByPage.get(path) ?? 0 : null,
    })
  }
  // Pagina's die in de vorige periode wel vertoningen hadden maar nu niet (anders mis je de dalers)
  for (const [path, prev] of pgPrevMap) {
    if (!pageMap.has(path)) pageMap.set(path, { path, clicks: 0, impressions: 0, position: null, prevClicks: prev.clicks, prevImpressions: prev.impressions, sessions: g ? sess.get(path) ?? 0 : null, prevSessions: g && cmp ? sessPrev.get(path) ?? 0 : null, requests: g?.hasLead ? reqByPage.get(path) ?? 0 : null })
  }
  const pages = [...pageMap.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)

  // ── Kanalen ──
  const chanPrev = new Map((g?.chanPrev || []).map(r => [r.dims[0], r.mets[0]]))
  const chanReq = new Map((g?.chanReq || []).map(r => [r.dims[0], r.mets[0]]))
  const channels = (g?.channels || []).map(r => ({ name: r.dims[0], sessions: r.mets[0], prevSessions: cmp ? chanPrev.get(r.dims[0]) ?? 0 : null, requests: g?.hasLead ? chanReq.get(r.dims[0]) ?? 0 : null }))
    .sort((a, b) => b.sessions - a.sessions)

  // ── Lokaal: per gemeente waar de landingspagina over gaat ──
  const localMap = new Map<string, DashboardData["local"][number] & { posW: number }>()
  for (const p of pages) {
    const c = classifyPath(p.path)
    if (!c.gemeente) continue
    const key = `${c.provincie}/${c.gemeente}`
    const x = localMap.get(key) || { key, label: prettySlug(c.gemeente), provincie: c.provincie, clicks: 0, impressions: 0, prevImpressions: cmp ? 0 : null, position: null, posW: 0 }
    x.clicks += p.clicks; x.impressions += p.impressions
    if (x.prevImpressions !== null) x.prevImpressions += p.prevImpressions || 0
    x.posW += (p.position || 0) * p.impressions
    localMap.set(key, x)
  }
  const local = [...localMap.values()].map(({ posW, ...x }) => ({ ...x, position: x.impressions ? round1(posW / x.impressions) : null }))

  // ── Waarschuwingen en datakwaliteit ──
  const warnings: Warning[] = []
  if (store.sitemapErrors > 0) warnings.push({
    id: "sitemap", severity: store.sitemapErrors >= 10 ? "error" : "warning",
    what: `${store.sitemapErrors} sitemap-URL's geven een foutmelding.`,
    effect: "Google krijgt pagina's aangeboden die niet bestaan; die pagina's kunnen niet ranken en het vertrouwen in de sitemap daalt.",
    action: "Herstel de pagina's of haal ze uit de sitemap. Bekijk de lijst in de pagina-audit.",
    urgency: store.sitemapErrors >= 10 ? "Hoog: deze week oplossen" : "Middel",
    href: "/analyses?tab=audit",
  })
  if (errors.gsc) warnings.push({ id: "gsc", severity: "error", what: "Search Console kan niet worden gelezen.", effect: "Posities, klikken en vertoningen ontbreken op het dashboard.", action: errors.gsc, urgency: "Hoog", href: "/data" })
  if (errors.ga4) warnings.push({ id: "ga4", severity: "warning", what: "GA4 kan niet worden gelezen.", effect: "Sessies en energiescanaanvragen ontbreken.", action: errors.ga4, urgency: "Middel", href: "/data" })
  if (store.failedJobs.length) warnings.push({ id: "sync", severity: "warning", what: `Nachtelijke synchronisatie mislukt: ${store.failedJobs.join(", ")}.`, effect: "Een deel van de gegevens is mogelijk verouderd.", action: "Bekijk de foutmelding op Datastatus.", urgency: "Middel", href: "/data" })
  const dataUntil = ovCur.length ? ovCur[ovCur.length - 1].keys[0] : null
  if (gscOk && dataUntil && dataUntil < addDays(cur.end, -2)) warnings.push({ id: "fresh", severity: "warning", what: `Search Console-gegevens lopen achter (laatste dag: ${dataUntil}).`, effect: "De laatste dagen van de periode ontbreken, waardoor cijfers lager lijken.", action: "Meestal lost dit zichzelf op binnen een dag. Blijft het, kijk dan op Datastatus.", urgency: "Laag" })

  const notes: DataNote[] = []
  if (measurement.status !== "ok") notes.push({ id: "lead", title: measurement.status === "geen-event" ? "Energiescanaanvragen worden nog niet gemeten" : measurement.status === "fout" ? "Energiescanaanvragen konden niet worden gelezen" : "Meting van energiescanaanvragen controleren", text: measurement.note, advice: measurement.advice })
  if (gscOk && tCur.impressions < 300) notes.push({ id: "weinig", title: "Nog weinig zoekdata in deze periode", text: `${num(tCur.impressions)} vertoningen. Percentages schommelen dan sterk.`, advice: "Kies een langere periode (28 of 90 dagen) of beoordeel opnieuw zodra er meer vertoningen zijn. Meer pagina's laten indexeren en interne links naar nieuwe pagina's helpen om sneller data te verzamelen." })
  if (regio || dienst) notes.push({ id: "filter", title: "Filter actief", text: `${regio ? `Regio: ${prettySlug(regio)} (pagina's onder /regio/${regio}). ` : ""}${dienst ? `Dienst: ${prettySlug(dienst)} (zoekwoorden over deze dienst; sessies op /maatregelen/${dienst}).` : ""}`, advice: "Bij een dienstfilter telt Search Console alleen zoekwoorden die Google niet anonimiseert; totalen zijn daardoor lager dan zonder filter." })

  const drivers = buildDrivers(pages, !!cmp)
  const partial = { cards, warnings, drivers, measurement, compareRange: cmp }
  const value: DashboardData = {
    range: cur, compareRange: cmp, dataUntil, filters: { regio, dienst },
    cards, series, keywords, pages: pages.slice(0, 200), channels, local, drivers, trends, warnings, notes, measurement,
    conclusion: buildConclusion(partial), errors, stalled, competitors,
  }
  if (!errors.gsc && !errors.ga4) cache.set(cacheKey, { at: Date.now(), value })
  return value
}

export type { Compare }
