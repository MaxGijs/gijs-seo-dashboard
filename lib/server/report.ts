// Vrijdagrapport (server): elke vrijdag vastgelegd, ook als er weinig verandert,
// zodat er een tijdlijn ontstaat. En de bewaking van werk dat blijft liggen.

import { getSupabase } from "./guard"
import { readDashboard } from "./dashboard"
import { readStalled } from "./stalled"

const DAY = 86400000
const iso = (d: Date) => d.toISOString().slice(0, 10)

export async function buildReport(by = "systeem") {
  const sb = getSupabase()
  const now = new Date()
  // Een rapport hoort bij een week die op vrijdag eindigt. Halverwege de week "nu maken" geeft een
  // tussenstand die vrijdag wordt overschreven door het definitieve rapport.
  const toFriday = (5 - now.getUTCDay() + 7) % 7
  const weekEnd = iso(new Date(now.getTime() + toFriday * DAY))
  const weekStart = iso(new Date(now.getTime() + (toFriday - 6) * DAY))
  const since = new Date(now.getTime() - 7 * DAY).toISOString()

  const [dash, stalled, { data: statuses }, { data: exps }, { data: ideas }, { data: log }] = await Promise.all([
    readDashboard({ period: "7", compare: "prev" }, true),
    readStalled(),
    sb.from("seo_advice_status").select("advice_key, advice_title, status, updated_at, note").gte("updated_at", since),
    sb.from("seo_experiments").select("advice_key, description, created_at, outcome, result_14d, result_28d, result_56d, query, page"),
    sb.from("content_ideas").select("id, title, status, score, published_at, published_url, updated_at, evals"),
    sb.from("seo_lesson_log").select("action, detail, at").gte("at", since).order("at", { ascending: false }),
  ])

  const taskStatuses = (statuses || []).filter(s => !s.advice_key.startsWith("site:"))   // siteadvies-beslissingen zijn geen taken
  const done = taskStatuses.filter(s => ["in_uitvoering", "uitgevoerd", "in_evaluatie"].includes(s.status)).map(s => s.advice_title)
  const rejected = taskStatuses.filter(s => ["afgewezen", "onvoldoende_bewijs"].includes(s.status)).length
  const started = (exps || []).filter(e => e.created_at >= since).map(e => `${e.query ? `"${e.query}"` : e.page || e.advice_key}: ${e.description}`)
  const results: string[] = []
  for (const e of exps || []) {
    for (const [d, r] of [[14, e.result_14d], [28, e.result_28d], [56, e.result_56d]] as const) {
      if (r && (r as any).measuredAt && (r as any).measuredAt >= weekStart) results.push(`${e.query ? `"${e.query}"` : e.page || e.advice_key} na ${d} dagen: ${(r as any).summary || "gemeten"}${d === 56 && e.outcome ? ` (${e.outcome.replace("_", " ")})` : ""}`)
    }
  }
  const published = (ideas || []).filter(i => i.published_at && i.published_at >= weekStart).map(i => i.title)
  const measuredContent = (ideas || []).filter(i => Object.values(i.evals || {}).some((v: any) => v?.measured_at >= weekStart)).map(i => i.title)
  const newIdeas = (ideas || []).filter(i => i.status === "nieuw").sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map(i => i.title)
  const bijna = (dash.trends?.keywords.bijna || []).slice(0, 3).map(t => `"${t.key}" (positie ${String(t.positionNow).replace(".", ",")})`)
  const c = dash.cards
  const metric = (label: string, m: { value: number | null; prev: number | null }) => ({ label, value: m.value, prev: m.prev })

  const quiet = !done.length && !started.length && !results.length && !published.length && Math.abs((c.impressions.value || 0) - (c.impressions.prev || 0)) < 0.1 * (c.impressions.prev || 1)
  const summary = {
    by,
    range: dash.range, compareRange: dash.compareRange,
    headline: quiet ? `Geen grote veranderingen deze week. ${bijna.length ? `${bijna.length} zoekwoorden staan net buiten pagina 1 en verdienen volgende week aandacht.` : ""}`.trim() : dash.conclusion.headline,
    conclusion: dash.conclusion.body,
    metrics: [metric("Zoekwoorden op pagina 1", c.page1), metric("Bijna op pagina 1", c.bijna), metric("Google-klikken", c.clicks), metric("Google-vertoningen", c.impressions), metric("Sessies", c.sessions), metric("Energiescanaanvragen", c.requests)],
    changes: [
      ...(dash.campaigns || []).filter(c => c.inCurrent).map(c => `Offline campagne: ${c.name} (${c.kind}${c.amount ? `, ${c.amount.toLocaleString("nl-NL")} stuks` : ""}${c.regions.length ? `, ${c.regions.join(", ")}` : ""}). Extra bezoek en aanvragen kunnen hieruit komen.`),
      ...dash.drivers.map(d => d.text),
      ...(dash.trends?.keywords.nieuwPagina1.slice(0, 5).map(t => `Nieuw op pagina 1: "${t.key}" (positie ${String(t.positionNow).replace(".", ",")})`) || []),
      ...(dash.trends?.keywords.dalend.slice(0, 3).map(t => `Dalend: "${t.key}" (${String(t.positionThen).replace(".", ",")} → ${String(t.positionNow).replace(".", ",")})`) || []),
    ],
    done: [...done.map(t => `SEO: ${t}`), ...published.map(t => `Gepubliceerd: ${t}`), ...(rejected ? [`${rejected} ${rejected === 1 ? "advies" : "adviezen"} afgewezen`] : [])],
    started,
    results: [...results, ...measuredContent.map(t => `Contentmeting: ${t}`)],
    stalled: stalled.map(s => s.text),
    next: [...bijna.map(b => `Bijna op pagina 1: ${b}`), ...newIdeas.map(t => `Contentkans: ${t}`)],
    learned: (log || []).map(l => `${l.action === "nieuw" ? "Geleerd" : l.action === "teruggedraaid" ? "Teruggedraaid" : l.action === "vervallen" ? "Vervallen" : "Bijgewerkt"}: ${l.detail}`),
    warnings: dash.warnings.map(w => w.what),
    measurement: dash.measurement.status,
  }
  const { error } = await sb.from("seo_reports").upsert({ week_end: weekEnd, week_start: weekStart, created_at: now.toISOString(), summary })
  if (error) throw new Error(error.message)
  return { week_end: weekEnd, headline: summary.headline }
}

export async function listReports() {
  const { data, error } = await getSupabase().from("seo_reports").select("*").order("week_end", { ascending: false }).limit(52)
  if (error) throw new Error(error.message)
  return data || []
}
