import { getSupabase } from "./guard"
import { serviceSearchConsole, SITE_ORIGIN, SITE_URL, toPath } from "./gsc"
import { classifyPath, LAUNCH_DATES } from "@/lib/pages"
import { indexEvents, type PageEvent } from "@/lib/watch"
import { saveEvents } from "./watch"

// ── Sitemap → pagina-inventaris ─────────────────────────────────────────────

async function fetchText(url: string) {
  const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "GijsSEODashboard/1.0 (+inventaris, alleen lezen)" } })
  if (!res.ok) throw new Error(`${url} gaf HTTP ${res.status}`)
  return res.text()
}

export async function readSitemap(): Promise<string[]> {
  const robots = await fetchText(`${SITE_ORIGIN}/robots.txt`).catch(() => "")
  const roots = [...robots.matchAll(/Sitemap:\s*(\S+)/gi)].map(m => m[1])
  const queue = roots.length ? roots : [`${SITE_ORIGIN}/sitemap.xml`]
  const urls = new Set<string>()
  const seen = new Set<string>()
  while (queue.length && seen.size < 50) {
    const sm = queue.shift()!
    if (seen.has(sm)) continue
    seen.add(sm)
    const xml = await fetchText(sm)
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1])
    if (/<sitemapindex/i.test(xml)) queue.push(...locs)
    else locs.forEach(u => urls.add(u))
  }
  return [...urls]
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function syncInventory() {
  const supabase = getSupabase()
  const sitemapUrls = await readSitemap()
  const inSitemap = new Map(sitemapUrls.map(u => [toPath(u), u]))

  const { data: stats, error: statsErr } = await supabase.rpc("seo_page_stats")
  if (statsErr) throw new Error(`statistieken: ${statsErr.message}`)
  const statMap = new Map<string, any>((stats || []).map((s: any) => [toPath(s.page), s]))

  const paths = new Set<string>([...inSitemap.keys(), ...statMap.keys()])
  const now = new Date().toISOString()
  const rows = [...paths].map(path => {
    const c = classifyPath(path)
    const s = statMap.get(path)
    return {
      path,
      url: inSitemap.get(path) || `${SITE_ORIGIN}${path === "/" ? "/" : path}`,
      page_type: c.type,
      provincie: c.provincie,
      gemeente: c.gemeente,
      plaats: c.plaats,
      in_sitemap: inSitemap.has(path),
      launch_date: c.provincie ? LAUNCH_DATES[c.provincie] ?? null : null,
      first_seen: s?.first_seen ?? null,
      imp_28d: Number(s?.imp_28d ?? 0),
      clicks_28d: Number(s?.clicks_28d ?? 0),
      position_28d: s?.position_28d !== null && s?.position_28d !== undefined ? Math.round(Number(s.position_28d) * 10) / 10 : null,
      imp_prev_28d: Number(s?.imp_prev_28d ?? 0),
      synced_at: now,
    }
  })

  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from("seo_pages").upsert(part, { onConflict: "path" })
    if (error) throw new Error(`opslaan: ${error.message}`)
  }

  return {
    sitemap: inSitemap.size,
    totaal: rows.length,
    buitenSitemap: rows.filter(r => !r.in_sitemap).length,
    metVertoningen: rows.filter(r => r.imp_28d > 0).length,
  }
}

// ── Live HTTP-status van alle sitemap-pagina's (geen Google-quotum nodig) ───

export async function checkHttpStatus({ budgetMs = 40000, concurrency = 10 } = {}) {
  const started = Date.now()
  const supabase = getSupabase()
  const rows: { path: string; url: string }[] = []
  for (let from = 0; from < 20000; from += 1000) {
    // Sitemap-pagina's én URL's die Google nog toont (bv. oude adressen): zo zien we ook doorverwijzingen
    const { data, error } = await supabase.from("seo_pages").select("path, url").or("in_sitemap.eq.true,imp_28d.gt.0")
      .order("http_checked_at", { ascending: true, nullsFirst: true }).range(from, from + 999)
    if (error) throw new Error(`ophalen: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const queue = [...rows]
  const results: { path: string; http_status: number | null; http_final_path: string | null; http_checked_at: string }[] = []
  async function worker() {
    while (queue.length && Date.now() - started < budgetMs) {
      const page = queue.shift()!
      let status: number | null = null, finalPath: string | null = null
      for (const method of ["HEAD", "GET"]) {
        try {
          const ctrl = new AbortController()
          const t = setTimeout(() => ctrl.abort(), 8000)
          const res = await fetch(page.url, { method, redirect: "follow", cache: "no-store", signal: ctrl.signal, headers: { "User-Agent": "GijsSEODashboard/1.0 (+statuscontrole, alleen lezen)" } })
          clearTimeout(t)
          if (method === "GET") { try { await res.body?.cancel() } catch {} }
          status = res.status
          finalPath = toPath(res.url || page.url)
          if (res.status !== 405) break
        } catch { status = null }
      }
      results.push({ path: page.path, http_status: status, http_final_path: finalPath, http_checked_at: new Date().toISOString() })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  // Alleen de statusvelden bijwerken (upsert op bestaande rijen)
  for (const part of chunk(results, 500)) {
    const { error } = await supabase.rpc("seo_pages_set_http", { rows: part })
    if (error) throw new Error(`statussen opslaan: ${error.message}`)
  }
  return {
    gecontroleerd: results.length,
    fouten: results.filter(r => r.http_status === null || r.http_status >= 400).length,
    doorverwijzingen: results.filter(r => r.http_final_path && r.http_final_path !== r.path).length,
    resterend: rows.length - results.length,
  }
}

// ── Indexeringscontrole (URL Inspection API) ────────────────────────────────
// Quotum van Google: 2.000 inspecties per dag en 600 per minuut per property.

const PREV_COLS = "path, url, index_verdict, coverage_state, last_crawl_time, inspected_at"

export async function inspectBatch({ budgetMs = 45000, max = 400, concurrency = 6, staleDays = 7, watched = new Set<string>() }: { budgetMs?: number; max?: number; concurrency?: number; staleDays?: number; watched?: Set<string> } = {}) {
  const started = Date.now()
  const supabase = getSupabase()
  const staleBefore = new Date(Date.now() - staleDays * 86400000).toISOString()

  // Gevolgde pagina's elke nacht (als ze meer dan 20 uur geleden gecontroleerd zijn),
  // daarna pagina's die nog nooit gecontroleerd zijn, daarna de oudste controles.
  const dailyBefore = new Date(Date.now() - 20 * 3600000).toISOString()
  const first: any[] = []
  const watchList = [...watched]
  for (let i = 0; i < watchList.length; i += 100) {
    const { data, error } = await supabase.from("seo_pages").select(PREV_COLS).in("path", watchList.slice(i, i + 100)).or(`inspected_at.is.null,inspected_at.lt.${dailyBefore}`)
    if (error) throw new Error(`ophalen gevolgde pagina's: ${error.message}`)
    first.push(...(data || []))
  }
  const { data: todo, error } = await supabase
    .from("seo_pages")
    .select(PREV_COLS)
    .eq("in_sitemap", true)
    .or(`inspected_at.is.null,inspected_at.lt.${staleBefore}`)
    .order("inspected_at", { ascending: true, nullsFirst: true })
    .limit(max)
  if (error) throw new Error(`ophalen: ${error.message}`)

  const sc = serviceSearchConsole()
  const queue = [...first, ...(todo || []).filter(t => !first.some(f => f.path === t.path))]
  let done = 0, failed = 0, dailyDone = 0
  let quotaHit: string | null = null
  const events: PageEvent[] = []

  async function worker() {
    while (queue.length && !quotaHit && Date.now() - started < budgetMs) {
      const page = queue.shift()!
      try {
        const res: any = await sc.urlInspection.index.inspect({
          requestBody: { inspectionUrl: page.url, siteUrl: SITE_URL, languageCode: "nl-NL" },
        })
        const r = res.data?.inspectionResult?.indexStatusResult || {}
        const now = new Date().toISOString()
        events.push(...indexEvents(page.path, page, { index_verdict: r.verdict ?? null, coverage_state: r.coverageState ?? null, last_crawl_time: r.lastCrawlTime ?? null, inspected_at: now }, now, watched.has(page.path)))
        if (watched.has(page.path)) dailyDone++
        await supabase.from("seo_pages").update({
          index_verdict: r.verdict ?? null,
          coverage_state: r.coverageState ?? null,
          indexing_state: r.indexingState ?? null,
          page_fetch_state: r.pageFetchState ?? null,
          robots_state: r.robotsTxtState ?? null,
          google_canonical: r.googleCanonical ?? null,
          user_canonical: r.userCanonical ?? null,
          last_crawl_time: r.lastCrawlTime ?? null,
          inspected_at: new Date().toISOString(),
          inspect_error: null,
        }).eq("path", page.path)
        done++
      } catch (e: any) {
        const msg: string = e?.message || String(e)
        if (e?.code === 429 || /quota|rate limit/i.test(msg)) { quotaHit = msg; break }
        failed++
        await supabase.from("seo_pages").update({ inspected_at: new Date().toISOString(), inspect_error: msg.slice(0, 300) }).eq("path", page.path)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  let gebeurtenissen = 0
  try { gebeurtenissen = await saveEvents(events) } catch (e: any) { failed++; console.error(e?.message) }

  const { count } = await supabase
    .from("seo_pages")
    .select("path", { count: "exact", head: true })
    .eq("in_sitemap", true)
    .or(`inspected_at.is.null,inspected_at.lt.${staleBefore}`)

  return { gecontroleerd: done, gevolgd: watched.size, gevolgdGecontroleerd: dailyDone, gebeurtenissen, mislukt: failed, resterend: count ?? null, quotum: quotaHit, ms: Date.now() - started }
}
