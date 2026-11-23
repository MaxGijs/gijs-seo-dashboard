import { describe, overlaps, type Campaign } from "@/lib/campaigns"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { dateWindow, gscQuery, serviceSearchConsole, toUrl } from "@/lib/server/gsc"
import { logged } from "@/lib/server/synclog"
import { LAUNCH_DATES } from "@/lib/pages"
import { recomputeLessons } from "@/lib/server/learning"
import { readChecks } from "@/lib/server/checks"
import { measureScoped, targetsOf } from "@/lib/server/scopedMeasure"
import { CRAWL_DAY, crawlState, EARLY_DAY, evaluate, EXTENDED_DAY, FINAL_DAY, LAG, NOT_ENOUGH, outcomeFromReport } from "@/lib/measureLogic"
import { addDaysIso, conversionVerdict, conversionWindows } from "@/lib/server/conversion"
import { adviceStatusFor, finalOutcome, MIN_IMPRESSIONS, type ExpKind, type Outcome } from "@/lib/experiment"

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
  // Offline campagnes (brieven, flyers) in de meetperiode verklaren extra bezoek en aanvragen
  const { data: camps } = await supabase.from("seo_campaigns").select("*")
  for (const c of (camps || []) as Campaign[]) if (overlaps(c, exp.changed_at, today())) confounders.push(describe(c))
  if (growth && (growth > 1.3 || growth < 0.75)) confounders.push(`Sitebrede vertoningen ${growth > 1 ? "+" : ""}${Math.round((growth - 1) * 100)}% t.o.v. de nulmeting`)
  return { site: { impressionsPerDay: perDay ? Math.round(perDay) : null, growth }, confounders }
}

// ── Metingen per soort aanpassing ───────────────────────────────────────────

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

// ── Eén experiment: welke meetmomenten zijn aan de beurt? ─────────────────────

const V = 2   // meetlogica 7/14/28(/56); resultaten zonder v zijn van de oude 14/28/56/84-logica
const isNew = (r: any) => !!r && (r.v === V || !!r.report)

// Andere aanpassingen aan dezelfde pagina in de meetperiode (buiten de eigen familie). Een wijziging op een
// andere pagina telt niet, ook niet bij hetzelfde zoekwoord; zonder pagina vergelijken we op zoekwoord.
async function otherChangesFor(supabase: any, exp: any, until: string) {
  const { pages, queries } = targetsOf(exp)
  const { data } = await supabase.from("seo_experiments").select("id, description, query, page, target_pages, target_queries, baseline, family_id, changed_at, kind").gt("changed_at", exp.changed_at).lte("changed_at", until).neq("id", exp.id)
  const fam = exp.family_id || exp.id
  return ((data || []) as any[]).filter(o => (o.family_id || o.id) !== fam && o.kind !== "validatie").filter(o => {
    const t = targetsOf(o)
    return pages.length ? t.pages.some(p => pages.includes(p) && p !== "/") : !t.pages.length && t.queries.some(q => queries.includes(q))
  }).map(o => `${String(o.description || "").split("\n")[0].slice(0, 90)} (${o.changed_at})`)
}

async function crawlFor(supabase: any, exp: any) {
  const { pages } = targetsOf(exp)
  const rows = pages.length ? await pageRows(supabase, pages) : []
  const byPath = new Map(rows.map((r: any) => [r.path, r]))
  return crawlState(exp.changed_at, pages.map(p => ({ path: p, lastCrawl: (byPath.get(p) as any)?.last_crawl_time ?? null })))
}

async function evaluateOne(supabase: any, exp: any): Promise<{ measured: number; finalized: number }> {
  // Hele kalenderdagen sinds de wijziging (de nachtelijke run telt de dag van vandaag mee)
  const ageDays = Math.round((new Date(`${today()}T12:00:00Z`).getTime() - new Date(`${exp.changed_at.slice(0, 10)}T12:00:00Z`).getTime()) / 86400000)
  const metric: string = exp.baseline?.successMetric || "position"
  const kind: ExpKind = exp.kind || "experiment"
  const search = metric === "position" || metric === "ctr"
  const due = (d: number) => ageDays >= (d === CRAWL_DAY ? d : d + LAG)
  const update: Record<string, any> = {}
  let measured = 0

  // Dag 7: heeft Google de gewijzigde pagina's opnieuw gecrawld? Nog geen oordeel.
  if (!exp.result_7d && !exp.result_14d && due(CRAWL_DAY) && ageDays < EARLY_DAY + LAG) {
    const crawl = await crawlFor(supabase, exp)
    update.result_7d = { v: V, measuredAt: today(), crawl, summary: crawl.state === "onbekend" ? "Crawlstatus nog onbekend" : `${crawl.crawled} van ${crawl.total} pagina's opnieuw gecrawld` }
    measured++
  }

  // Meetmomenten 14, 28 en (bij verlenging) 56
  const plan: number[] = []
  if (due(EARLY_DAY) && !exp.result_14d) plan.push(EARLY_DAY)
  if (due(FINAL_DAY) && !isNew(exp.result_28d)) plan.push(FINAL_DAY)
  let decided: { day: number; verdict: Verdict | null; enough: boolean; extend: boolean; influenced: boolean } | null = null

  const step = async (day: number) => {
    const col = `result_${day}d`
    const legacy = exp[col] && !isNew(exp[col]) ? { legacy: exp[col] } : {}
    const ctx = await context(supabase, exp)
    let r: Record<string, any>
    let verdict: Verdict | null = null, enough = true, extend = false, influenced = false
    if (search) {
      const [scoped, crawl, otherChanges] = [await measureScoped(exp, day, metric as "position" | "ctr"), await crawlFor(supabase, exp), await otherChangesFor(supabase, exp, addDaysIso(exp.changed_at, day))]
      const env = ctx.confounders.filter(c => !c.startsWith("Sitebrede"))
      const report = evaluate({ day, metric: metric as "position" | "ctr", changedAt: exp.changed_at, scoped, crawl, otherChanges, context: env, kind })
      const a = scoped?.after
      const clicks28 = scoped ? Math.round((scoped.after.clicks * 28) / scoped.afterWindow.days * 10) / 10 : null
      r = {
        v: V, measuredAt: today(), report, scoped, crawl, ...ctx, ...legacy,
        scope: scoped?.scope ?? null, sampleDays: day,
        position: scoped?.main.after ?? a?.position ?? null, impressions: a?.impressions ?? 0, clicks: a?.clicks ?? 0, ctr: a?.ctr ?? 0,
        clicks28, impressions28: scoped ? Math.round((scoped.after.impressions * 28) / scoped.afterWindow.days) : null,
        summary: report.headline,
      }
      // Voorspeld versus werkelijk (klikken per 28 dagen, gecorrigeerd voor sitebrede groei)
      if (typeof clicks28 === "number" && typeof exp.baseline?.clicks === "number") {
        const corrected = ctx.site.growth ? clicks28 / ctx.site.growth : clicks28
        r.actualGain = Math.round((clicks28 - exp.baseline.clicks) * 10) / 10
        r.actualGainCorrected = Math.round((corrected - exp.baseline.clicks) * 10) / 10
        r.predictedGain = exp.predicted?.gain ?? exp.baseline?.predictedGain ?? null
      }
      verdict = outcomeFromReport(report)
      enough = report.effect !== "onvoldoende"
      extend = report.extend
      influenced = otherChanges.length > 0
      if (report.final) r.evidence = enough && !influenced ? "telt mee" : "te weinig data"
    } else if (metric === "conversie") {
      // Even lange periode vóór en na de aanpassing (niet over de dag van de aanpassing zelf)
      try {
        const before = { start: addDaysIso(exp.changed_at, -day), end: addDaysIso(exp.changed_at, -1) }
        const after = { start: addDaysIso(exp.changed_at, 1), end: addDaysIso(exp.changed_at, day) }
        const { measurement, windows } = await conversionWindows([before, after], exp.page)
        const [b, a] = windows
        let v = conversionVerdict(b, a, measurement)
        const { data: camps } = await supabase.from("seo_campaigns").select("*")
        const hit = ((camps || []) as Campaign[]).filter(c => overlaps(c, before.start, after.end))
        if (hit.length) { influenced = true; v = { verdict: v.verdict, reason: `Beïnvloed: in de meetperiode liep ${hit.map(describe).join("; ")}.` } }
        const thin = /Te weinig aanvragen|Geen aanvraaggegevens|klopt nog niet/.test(v.reason)
        enough = !thin
        extend = day === FINAL_DAY && thin
        r = { v: V, measuredAt: today(), scope: "conversie", before: b, after: a, measurement: measurement.status, extend, ...ctx, ...legacy, summary: `${a.requests ?? "—"} aanvragen in ${a.sessions} sessies (was ${b.requests ?? "—"} in ${b.sessions}) · ${extend ? NOT_ENOUGH : v.reason}` }
        if (day >= FINAL_DAY) verdict = v.verdict
      } catch (e: any) {
        enough = false; extend = day === FINAL_DAY
        r = { v: V, measuredAt: today(), scope: "conversie", extend, ...legacy, summary: `Meting mislukt: ${e?.message || "GA4 niet bereikbaar"}` }
      }
    } else if (metric === "controle") {
      const open = await readChecks(true).catch(() => null)
      const still = open ? open.some(c => c.id === exp.baseline?.checkId) : true
      r = { v: V, measuredAt: today(), scope: "controle", ...legacy, summary: still ? "Probleem nog aanwezig" : "Probleem niet meer gevonden" }
      if (open && !still) verdict = "succesvol"
      else if (day >= FINAL_DAY) verdict = "niet_succesvol"
    } else if (metric === "technisch") {
      const t = await measureTechnical(supabase, exp)
      r = { v: V, ...t.result, ...legacy }
      if (t.verdict) verdict = t.verdict
      else if (day >= FINAL_DAY) verdict = "niet_succesvol"
    } else if (metric === "indexering") {
      const t = await measureIndexing(supabase, exp)
      extend = !t.verdict && day === FINAL_DAY
      r = { v: V, ...t.result, extend, ...legacy, summary: `${t.result.summary}${extend ? " · nog niet alles geïndexeerd; meting verlengd tot 56 dagen" : ""}` }
      if (t.verdict) verdict = t.verdict
      else if (day >= EXTENDED_DAY) verdict = "niet_succesvol"
    } else if (metric === "consolidatie") {
      const t = await measureConsolidation(supabase, exp)
      const thin = t.result.mainImpressions === null || (t.result.sumBefore ?? 0) < MIN_IMPRESSIONS
      enough = !thin
      extend = day === FINAL_DAY && thin
      r = { v: V, ...t.result, extend, ...ctx, ...legacy }
      if (day >= FINAL_DAY && !extend) verdict = t.final
    } else {
      r = { v: V, measuredAt: today(), ...legacy, summary: "Geen meting nodig" }
    }
    update[col] = r
    measured++
    // Validaties mogen eerder klaar zijn (bv. alles hersteld na 14 dagen)
    if (day >= FINAL_DAY || kind === "validatie") decided = { day, verdict, enough, extend, influenced }
    return r
  }

  for (const d of plan) await step(d)
  // Verlengd (nu of eerder) en de 56 dagen zijn om
  const r28 = update.result_28d || exp.result_28d
  const extended = !!(r28 && isNew(r28) && (r28.report?.extend || r28.extend))
  if (extended && due(EXTENDED_DAY) && !isNew(exp.result_56d)) await step(EXTENDED_DAY)

  // Eindoordeel volgens de soort (validaties op hun controle, metingen zonder oordeel)
  let finalized = 0
  const d = decided as { day: number; verdict: Verdict | null; enough: boolean; extend: boolean; influenced: boolean } | null
  if (d) {
    let invalid = false
    if (kind === "experiment" && !(d.day === FINAL_DAY && d.extend)) {
      const target = exp.baseline?.targetPage || exp.page
      if (target) {
        const [row] = await pageRows(supabase, [target])
        invalid = !!row && ((row.http_status ?? 0) >= 400 || (!!row.http_final_path && row.http_final_path !== target))
      }
    }
    const outcome: Outcome | null = finalOutcome({ kind, day: d.day, verdict: d.verdict, enoughData: d.enough, invalid, influenced: d.influenced, extend: d.extend })
    if (outcome) {
      update.outcome = outcome
      const status = adviceStatusFor(outcome)
      if (status) {
        await supabase.from("seo_advice_status").update({ status, updated_at: new Date().toISOString() }).eq("advice_key", exp.advice_key)
        finalized++
      }
    }
  }
  if (Object.keys(update).length) {
    const { error } = await supabase.from("seo_experiments").update(update).eq("id", exp.id)
    if (error) throw error
  }
  return { measured, finalized }
}

// GET /api/cron/experiment-eval — dagelijks: crawlcontrole na 7 dagen, vroege indicatie na 14,
// eindmeting na 28 en alleen bij verlenging na 56 dagen (zie lib/measureLogic.ts).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 })
  }

  const supabase = getSupabase()
  const results: { checked: number; measured: number; finalized: number; errors?: string[] } = { checked: 0, measured: 0, finalized: 0 }

  try {
    const { data: experiments, error } = await supabase
      .from("seo_experiments")
      .select("*")
      .is("outcome", null)
      .lte("changed_at", daysAgo(CRAWL_DAY))
    if (error) throw error

    for (const exp of experiments || []) {
      results.checked++
      try {
        const done = await evaluateOne(supabase, exp)
        results.measured += done.measured
        results.finalized += done.finalized
      } catch (e: any) {
        // Eén mislukte meting mag de rest niet tegenhouden; volgende nacht opnieuw
        results.errors = [...(results.errors || []), `${exp.id}: ${e?.message || "onbekende fout"}`].slice(0, 10)
      }
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
