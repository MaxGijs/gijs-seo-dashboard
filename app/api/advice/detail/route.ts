import { NextResponse } from "next/server"
import { requireUser, getSupabase, supabaseConfigured } from "@/lib/server/guard"
import { dateWindow, gscQuery, toPath, toUrl, userSearchConsole, type GscRow } from "@/lib/server/gsc"
import { auditPage, checkRedirect } from "@/lib/server/audit"

export const maxDuration = 30

interface Metric { clicks: number; impressions: number; ctr: number; position: number }
const metric = (r?: GscRow | null): Metric | null =>
  r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : null

function mondayOf(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7 // maandag = 0
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().split("T")[0]
}

async function weeklyHistory(kind: "query" | "page", value: string) {
  if (!supabaseConfigured()) return []
  const since = new Date(Date.now() - 12 * 7 * 86400000).toISOString().split("T")[0]
  const table = kind === "query" ? "seo_daily_keywords" : "seo_daily_pages"
  const { data, error } = await getSupabase()
    .from(table)
    .select("snapshot_date, clicks, impressions, position")
    .eq(kind, value)
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true })
  if (error || !data) return []

  const weeks = new Map<string, { clicks: number; impressions: number; posWeighted: number; days: number }>()
  for (const r of data) {
    const w = mondayOf(r.snapshot_date)
    const acc = weeks.get(w) || { clicks: 0, impressions: 0, posWeighted: 0, days: 0 }
    acc.clicks += r.clicks
    acc.impressions += r.impressions
    acc.posWeighted += r.position * Math.max(r.impressions, 1)
    acc.days += 1
    weeks.set(w, acc)
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, v]) => ({
      weekStart,
      clicks: v.clicks,
      impressions: v.impressions,
      position: Math.round((v.posWeighted / Math.max(v.impressions, v.days)) * 10) / 10,
      days: v.days,
    }))
}

// GET /api/advice/detail?query=...&page=/pad — feiten voor het advieszijpaneel
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const session = guard.session!
  if (!session.accessToken) return NextResponse.json({ error: "Geen Google-sessie" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("query")?.trim() || null
  const pageParam = searchParams.get("page")?.trim() || null
  const related = (searchParams.get("related") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 5)
  if (!query && !pageParam) return NextResponse.json({ error: "query of page is verplicht" }, { status: 400 })

  const cur = dateWindow(28, 0)
  const prev = dateWindow(28, 28)
  const sc = userSearchConsole(session.accessToken)
  const errors: string[] = []
  const safe = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch (e: any) { errors.push(`${label}: ${e?.message || e}`); return fallback }
  }
  const qFilter = (q: string) => [{ filters: [{ dimension: "query", operator: "equals", expression: q }] }]
  const pFilter = (p: string) => [{ filters: [{ dimension: "page", operator: "equals", expression: toUrl(p) }] }]

  const result: Record<string, unknown> = { query, page: pageParam, window: cur, prevWindow: prev }

  if (query) {
    const [totCur, totPrev, pagesCur, pagesPrev, history] = await Promise.all([
      safe("zoekwoord (huidig)", () => gscQuery(sc, { ...cur, dimensions: ["query"], dimensionFilterGroups: qFilter(query), rowLimit: 1 }), []),
      safe("zoekwoord (vorig)", () => gscQuery(sc, { ...prev, dimensions: ["query"], dimensionFilterGroups: qFilter(query), rowLimit: 1 }), []),
      safe("rankende pagina's (huidig)", () => gscQuery(sc, { ...cur, dimensions: ["page"], dimensionFilterGroups: qFilter(query), rowLimit: 10, orderBy: [{ fieldName: "impressions", sortOrder: "DESCENDING" }] }), []),
      safe("rankende pagina's (vorig)", () => gscQuery(sc, { ...prev, dimensions: ["page"], dimensionFilterGroups: qFilter(query), rowLimit: 10, orderBy: [{ fieldName: "impressions", sortOrder: "DESCENDING" }] }), []),
      safe("historie", () => weeklyHistory("query", query), []),
    ])
    result.queryTotals = { cur: metric(totCur[0]), prev: metric(totPrev[0]) }
    // Search Console sorteert gefilterde resultaten niet betrouwbaar: zelf op vertoningen sorteren
    const mapPages = (rows: GscRow[]) => rows
      .map(r => ({ path: toPath(r.keys[0]), ...metric(r)! }))
      .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    result.queryPages = { cur: mapPages(pagesCur), prev: mapPages(pagesPrev) }
    result.history = history
  }

  // Welke pagina bekijken we? De opgegeven pagina, anders de pagina die nu het meest
  // vertoond wordt voor dit zoekwoord.
  // Bij een plaats-zoekwoord ("huis isoleren zwolle") is de stadspagina de bedoelde pagina,
  // ook als Google nu vooral wijkpagina's toont.
  const qp = result.queryPages as { cur: { path: string; impressions: number }[] } | undefined
  const tokens = (query || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(t => t.length > 2)
  const intended = (qp?.cur || [])
    .filter(p => p.path.startsWith("/regio/") && tokens.includes(p.path.split("/").filter(Boolean).pop()!.toLowerCase()))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || b.impressions - a.impressions)[0]
  result.intendedPage = intended?.path ?? null
  const target = pageParam || intended?.path || qp?.cur?.[0]?.path || null
  result.auditTarget = target

  if (target) {
    const [totCur, totPrev, pageQueries, audit, pageHistory] = await Promise.all([
      safe("pagina (huidig)", () => gscQuery(sc, { ...cur, dimensions: ["page"], dimensionFilterGroups: pFilter(target), rowLimit: 1 }), []),
      safe("pagina (vorig)", () => gscQuery(sc, { ...prev, dimensions: ["page"], dimensionFilterGroups: pFilter(target), rowLimit: 1 }), []),
      safe("zoekwoorden van pagina", () => gscQuery(sc, { ...cur, dimensions: ["query"], dimensionFilterGroups: pFilter(target), rowLimit: 15, orderBy: [{ fieldName: "impressions", sortOrder: "DESCENDING" }] }), []),
      auditPage(toUrl(target)),
      pageParam && !query ? safe("historie", () => weeklyHistory("page", toUrl(target)), []) : Promise.resolve(null),
    ])
    result.pageTotals = { cur: metric(totCur[0]), prev: metric(totPrev[0]) }
    result.pageQueries = pageQueries.map(r => ({ query: r.keys[0], ...metric(r)! })).sort((a, b) => b.impressions - a.impressions)
    result.audit = audit
    // Inventaris en indexering uit de pagina-audit (als die al gedraaid heeft)
    if (supabaseConfigured()) {
      const { data: info } = await getSupabase().from("seo_pages").select("*").eq("path", target).maybeSingle()
      result.pageInfo = info ?? null
    }
    if (pageHistory) result.history = pageHistory
  }

  // Gerelateerde pagina's (bv. dubbele onderwerpen): bestaan ze nog of verwijzen ze al door?
  if (related.length) {
    result.redirects = await Promise.all(related.map(p => checkRedirect(toUrl(p), toPath)))
  }

  result.errors = errors
  return NextResponse.json(result)
}
