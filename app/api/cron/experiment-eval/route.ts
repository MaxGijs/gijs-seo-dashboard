import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { dateWindow, gscQuery, serviceSearchConsole, toUrl } from "@/lib/server/gsc"
import { logged } from "@/lib/server/synclog"
import { LAUNCH_DATES } from "@/lib/pages"
import { recomputeLessons } from "@/lib/server/learning"
import { readChecks } from "@/lib/server/checks"
import { positionVerdict } from "@/lib/measure"

export const maxDuration = 120

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0]
}

const today = () => new Date().toISOString().split("T")[0]
type Result = Record<string, any> & { measuredAt: string; summary: string }
type Verdict = "succesvol" | "niet_succesvol" | "onduidelijk"

// ── Verstorende factoren ─────────────────────────────────────────────────────
// Sitebrede groei (bv. door nieuwe provincies) en lanceringen tijdens de meetperiode.
async function context(supabase: any, exp: any) {
  const { data } = await supabase.from("seo_daily_overview").select("impressions, clicks").gte("snapshot_date", daysAgo(10))
  const perDay = data?.length ? data.reduce((a: number, r: any) => a + r.impressions, 0) / data.length : null
  const base = exp.baseline?.site?.impressionsPerDay
  const growth = perDay && base ? Math.round((perDay / base) * 100) / 100 : null
  const confounders: string[] = []
  for (const [prov, date] of Object.entries(LAUNCH_DATES)) {
    if (date > exp.changed_at && date <= today()) confounders.push(`Provincie ${prov} gelanceerd op ${date}`)
  }
  if (growth && (growth > 1.3 || growth < 0.75)) confounders.push(`Sitebrede vertoningen ${growth > 1 ? "+" : ""}${Math.round((growth - 1) * 100)}% t.o.v. de nulmeting`)
  return { site: { impressionsPerDay: perDay ? Math.round(perDay) : null, growth }, confounders }
}

// ── Metingen per soort aanpassing ───────────────────────────────────────────

// Zoekwoord, pagina of zoekwoord-paginacombinatie, live uit Search Console (laatste 7 dagen,
// zelfde vertraging als de rest van het dashboard). Valt terug op de dagelijkse snapshots.
async function measureSearch(supabase: any, query: string | null, page: string | null): Promise<Result | null> {
  const win = dateWindow(7, 0)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && (query || page)) {
    try {
      const filters: any[] = []
      if (query) filters.push({ dimension: "query", operator: "equals", expression: query })
      if (page) filters.push({ dimension: "page", operator: "equals", expression: toUrl(page) })
      const rows = await gscQuery(serviceSearchConsole(), { ...win, dimensions: query ? ["query"] : ["page"], dimensionFilterGroups: [{ filters }], rowLimit: 1 })
      const r = rows[0]
      const scope = query && page ? "zoekwoord-pagina" : query ? "zoekwoord" : "pagina"
      // 28 dagen, voor de vergelijking met de nulmeting (die ook over 28 dagen gaat)
      let clicks28: number | null = null, impressions28: number | null = null
      try {
        const r28 = await gscQuery(serviceSearchConsole(), { ...dateWindow(28, 0), dimensions: query ? ["query"] : ["page"], dimensionFilterGroups: [{ filters }], rowLimit: 1 })
        clicks28 = r28[0]?.clicks ?? 0; impressions28 = r28[0]?.impressions ?? 0
      } catch { /* alleen weekcijfers */ }
      if (!r) return { measuredAt: today(), window: win, scope, position: null, impressions: 0, clicks: 0, ctr: 0, sampleDays: 7, clicks28, impressions28, summary: "Geen vertoningen in de meetweek" }
      return {
        measuredAt: today(), window: win, scope, sampleDays: 7, clicks28, impressions28,
        position: Math.round(r.position * 10) / 10, impressions: r.impressions, clicks: r.clicks, ctr: Math.round(r.ctr * 1000) / 1000,
        summary: `positie ${r.position.toFixed(1).replace(".", ",")} · ${r.impressions} vertoningen (7 d)`,
      }
    } catch { /* terugvallen op snapshots */ }
  }
  if (!query && !page) return null
  const table = query ? "seo_daily_keywords" : "seo_daily_pages"
  const { data } = await supabase.from(table).select("position, impressions, clicks, ctr")
    .eq(query ? "query" : "page", query || toUrl(page!)).gte("snapshot_date", daysAgo(7))
  if (!data?.length) return null
  const imp = data.reduce((s: number, r: any) => s + r.impressions, 0)
  const clicks = data.reduce((s: number, r: any) => s + r.clicks, 0)
  const position = data.reduce((s: number, r: any) => s + r.position * Math.max(r.impressions, 1), 0) / data.reduce((s: number, r: any) => s + Math.max(r.impressions, 1), 0)
  return {
    measuredAt: today(), scope: query ? "zoekwoord" : "pagina", sampleDays: data.length, source: "snapshot",
    position: Math.round(position * 10) / 10, impressions: imp, clicks, ctr: imp ? Math.round((clicks / imp) * 1000) / 1000 : 0,
    summary: `positie ${position.toFixed(1).replace(".", ",")} · ${imp} vertoningen (${data.length} d)`,
  }
}

async function pageRows(supabase: any, paths: string[]) {
  const rows: any[] = []
  for (let i = 0; i < paths.length; i += 200) {
    const { data } = await supabase.from("seo_pages").select("path, in_sitemap, http_status, http_final_path, http_checked_at, index_verdict, last_crawl_time").in("path", paths.slice(i, i + 200))
    rows.push(...(data || []))
  }
  return rows
}

// Technisch: elke URL geeft 200 of een bedoelde 301 en staat niet meer als fout in de sitemap
async function measureTechnical(supabase: any, exp: any): Promise<{ result: Result; verdict: Verdict | null }> {
  const paths: string[] = exp.baseline?.paths || []
  const rows = await pageRows(supabase, paths)
  const stillBroken = rows.filter(r => r.in_sitemap && (!r.http_status || r.http_status >= 400)).length
  const recrawled = rows.filter(r => r.last_crawl_time && r.last_crawl_time.slice(0, 10) >= exp.changed_at).length
  const result: Result = {
    measuredAt: today(), scope: "inventaris", total: paths.length, stillBroken, recrawled,
    summary: `${stillBroken} van ${paths.length} nog fout · ${recrawled} opnieuw gecrawld`,
  }
  return { result, verdict: stillBroken === 0 ? "succesvol" : null }
}

// Indexering: alle betrokken pagina's geïndexeerd
async function measureIndexing(supabase: any, exp: any): Promise<{ result: Result; verdict: Verdict | null }> {
  const paths: string[] = exp.baseline?.paths || (exp.page ? [exp.page] : [])
  const rows = await pageRows(supabase, paths)
  const indexed = rows.filter(r => r.index_verdict === "PASS").length
  return {
    result: { measuredAt: today(), scope: "inventaris", total: paths.length, indexed, summary: `${indexed} van ${paths.length} geïndexeerd` },
    verdict: paths.length && indexed === paths.length ? "succesvol" : null,
  }
}

// Samenvoegen: oude URL's verwijzen door naar de hoofdpagina, en de hoofdpagina heeft
// over 28 dagen minstens 90% van de vertoningen die beide pagina's samen hadden.
async function measureConsolidation(supabase: any, exp: any): Promise<{ result: Result; final: Verdict }> {
  const main: string = exp.baseline?.mainPage || exp.page
  const before: { path: string; impressions: number }[] = exp.baseline?.pages || []
  const others = before.map(p => p.path).filter(p => p !== main)
  const rows = await pageRows(supabase, others)
  const redirected = rows.filter(r => r.http_final_path === main).length
  let mainImp: number | null = null
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && main) {
    try {
      const r = await gscQuery(serviceSearchConsole(), { ...dateWindow(28, 0), dimensions: ["page"], dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: toUrl(main) }] }], rowLimit: 1 })
      mainImp = r[0]?.impressions ?? 0
    } catch { /* geen live data */ }
  }
  const sumBefore = before.reduce((s, p) => s + (p.impressions || 0), 0)
  const result: Result = {
    measuredAt: today(), scope: "paginagroep", redirected, others: others.length, mainImpressions: mainImp, sumBefore,
    summary: `${redirected} van ${others.length} doorverwezen · hoofdpagina ${mainImp ?? "?"} van ${sumBefore} vertoningen (28 d)`,
  }
  // Gecorrigeerd voor sitebrede groei, zodat nieuwe provincies het resultaat niet opblazen
  const { site } = await context(supabase, exp)
  const adj = mainImp !== null && site.growth ? mainImp / site.growth : mainImp
  result.mainImpressionsCorrected = adj !== null ? Math.round(adj) : null
  const ok = redirected === others.length && adj !== null && adj >= sumBefore * 0.9
  const bad = redirected < others.length || (adj !== null && adj < sumBefore * 0.6)
  return { result, final: ok ? "succesvol" : bad ? "niet_succesvol" : "onduidelijk" }
}

function finalSearchVerdict(exp: any, m: Result): Verdict | null {
  const b = exp.baseline || {}
  if (b.successMetric === "ctr") {
    if (typeof b.ctr !== "number" || typeof m.ctr !== "number") return null
    const improved = m.ctr >= Math.max(b.ctr * 1.2, b.ctr + 0.002)
    return improved ? "succesvol" : m.ctr < b.ctr * 0.8 ? "niet_succesvol" : "onduidelijk"
  }
  // Positie: bij een zoekwoord met doelpagina vergelijken we de zoekwoord-paginacombinatie
  // (verscheen de doelpagina bij de nulmeting nog niet voor het zoekwoord, dan geldt positie 100 als start)
  const pair = !!(exp.query && exp.page && b.targetPage)
  const base = pair ? (typeof b.pairPosition === "number" ? b.pairPosition : 100) : (b.position ?? b.positionNow)
  if (typeof base !== "number" || typeof m.position !== "number") return null
  return positionVerdict(base, m.position)
}

// GET /api/cron/experiment-eval — dagelijks: meet experimenten na 14, 28 en 56 dagen,
// met het succescriterium dat bij de soort aanpassing hoort.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 })
  }

  const supabase = getSupabase()
  const results = { checked: 0, measured: 0, finalized: 0 }

  try {
    const { data: experiments, error } = await supabase
      .from("seo_experiments")
      .select("*")
      .is("outcome", null)
      .lte("changed_at", daysAgo(14))
    if (error) throw error

    for (const exp of experiments || []) {
      results.checked++
      const ageDays = Math.floor((Date.now() - new Date(exp.changed_at).getTime()) / 86400000)
      const metric: string = exp.baseline?.successMetric || "position"
      const milestones = ([[14, "result_14d"], [28, "result_28d"], [56, "result_56d"]] as const).filter(([d, col]) => ageDays >= d && !exp[col])
      if (!milestones.length) continue
      const update: Record<string, any> = {}
      let verdict: Verdict | null = null

      for (const [days, col] of milestones) {
        if (metric === "controle") {
          const open = await readChecks(true).catch(() => null)
          const still = open ? open.some(c => c.id === exp.baseline?.checkId) : true
          update[col] = { measuredAt: today(), scope: "controle", summary: still ? "Probleem nog aanwezig" : "Probleem niet meer gevonden" }
          if (open && !still) verdict = "succesvol"
          else if (days >= 28) verdict = "niet_succesvol"
        } else if (metric === "technisch") {
          const { result, verdict: v } = await measureTechnical(supabase, exp)
          update[col] = result
          // Technisch: geslaagd zodra alles hersteld is; eindoordeel na 28 dagen
          if (v) verdict = v
          else if (days >= 28) verdict = "niet_succesvol"
        } else if (metric === "indexering") {
          const { result, verdict: v } = await measureIndexing(supabase, exp)
          update[col] = result
          if (v) verdict = v
          else if (days >= 56) verdict = "niet_succesvol"
        } else if (metric === "consolidatie") {
          const { result, final } = await measureConsolidation(supabase, exp)
          update[col] = result
          if (days >= 56) verdict = final
        } else if (metric === "geen") {
          update[col] = { measuredAt: today(), summary: "Geen meting nodig" }
          verdict = "onduidelijk"
        } else {
          const m = await measureSearch(supabase, exp.query, exp.page)
          if (m) {
            update[col] = m
            if (days >= 56) verdict = finalSearchVerdict(exp, m)
          }
        }
        if (update[col]) {
          const ctx = await context(supabase, exp)
          update[col] = { ...update[col], ...ctx }
          // Voorspeld versus werkelijk (alleen bij zoekmetingen, gecorrigeerd voor sitebrede groei)
          const r = update[col]
          if (typeof r.clicks28 === "number" && typeof exp.baseline?.clicks === "number") {
            const corrected = ctx.site.growth ? r.clicks28 / ctx.site.growth : r.clicks28
            r.actualGain = Math.round((r.clicks28 - exp.baseline.clicks) * 10) / 10
            r.actualGainCorrected = Math.round((corrected - exp.baseline.clicks) * 10) / 10
            r.predictedGain = exp.predicted?.gain ?? exp.baseline?.predictedGain ?? null
          }
          if (days >= 56) {
            // Leerbewijs alleen bij voldoende volume (zoekmetingen) of een harde technische uitkomst
            const enough = ["technisch", "indexering"].includes(metric) || (exp.baseline?.impressions ?? 0) >= 100
            r.evidence = enough ? "telt mee" : "te weinig data"
          }
          results.measured++
        }
      }

      if (verdict) {
        update.outcome = verdict
        if (verdict !== "onduidelijk") {
          await supabase.from("seo_advice_status").update({ status: verdict, updated_at: new Date().toISOString() }).eq("advice_key", exp.advice_key)
          results.finalized++
        }
      }
      if (Object.keys(update).length) await supabase.from("seo_experiments").update(update).eq("id", exp.id)
    }

    await logged("experimenten", async () => results)
    // Daarna: lessen opnieuw berekenen uit alle afgeronde metingen en beslissingen
    let lessen: unknown = null
    try { lessen = await logged("lessen", () => recomputeLessons()) } catch (e: any) { lessen = { fout: e.message } }
    return NextResponse.json({ ok: true, ...results, lessen })
  } catch (err: any) {
    await logged("experimenten", async () => { throw err }).catch(() => {})
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
