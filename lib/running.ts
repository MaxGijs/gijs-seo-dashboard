// Loopt er al een meting op dezelfde pagina (of in dezelfde plaats)?
// Wie opnieuw iets aanpast terwijl de vorige aanpassing nog wordt gemeten, kan minder goed zien of die
// vorige aanpassing heeft geholpen. Daarom waarschuwen we bij plannen of uitvoeren; we blokkeren niet.
// Sterkte van de overlap: zelfde pagina, pagina genoemd in de omschrijving van de meting, andere pagina
// in dezelfde gemeente. Metingen zonder pagina vergelijken we op zoekwoord. Bijgewerkte contentpagina's
// die nog gemeten worden, tellen ook mee.

import type { Experiment, Task } from "./types"
import type { RouteTry } from "./routes"
import { nextMeasurement } from "./experiment"
import { EARLY_DAY, EXTENDED_DAY, FINAL_DAY, measureDate } from "./measureLogic"
import { normPage, pathsIn, townOf } from "./paths"
import { prettyPlace } from "./intent"

export type OverlapLevel = "kaart" | "pagina" | "genoemd" | "zoekwoord" | "plaats"

export interface RunningHit {
  experiment: Experiment
  on: string[]            // waarop de overlap zit: pagina's, plaats of zoekwoorden
  level: OverlapLevel     // kaart: deze kaart zelf · pagina: zelfde pagina · genoemd: pagina staat in de omschrijving ·
                          // zoekwoord: meting zonder pagina · plaats: andere pagina in dezelfde gemeente
  source: "seo" | "content"
  next: string | null     // volgende meetdatum
  firstAssessment: string // dag 14: eerste beoordeling
  assessed: boolean       // eerste beoordeling is er al
  end: string             // eindmeting (dag 28, of 56 bij verlenging)
  sameCard: boolean       // meting hoort bij deze kaart zelf
}

const normQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ")

function taskTargets(task: Task) {
  const all = [task, ...(task.merged || [])]
  const pages = new Set<string>(), queries = new Set<string>(), towns = new Set<string>()
  for (const t of all) {
    const s = t.signal as Task["signal"] & { targetPage?: string }
    // Ook de regiopagina die bij een plaats-zoekwoord hoort (bv. "isolatie borne" → /regio/overijssel/borne)
    for (const p of [s.page, s.targetPage, s.conversions?.page]) if (p) pages.add(normPage(p))
    if (s.query) queries.add(normQuery(s.query))
    if (s.place) towns.add(s.place)
  }
  for (const p of pages) { const w = townOf(p); if (w) towns.add(w) }
  return { keys: new Set(all.map(t => t.key)), pages, queries, towns }
}

export function experimentTargets(e: Pick<Experiment, "changed_pages" | "page" | "baseline" | "target_pages" | "query" | "target_queries" | "description">) {
  const pages = new Set<string>(), queries = new Set<string>(), towns = new Set<string>()
  const changed: string[] = e.changed_pages || []
  for (const p of changed.length ? changed : [e.page, e.baseline?.targetPage, ...(e.target_pages || [])]) if (typeof p === "string" && p) pages.add(normPage(p))
  for (const q of [e.query, ...(e.target_queries || [])]) if (typeof q === "string" && q) queries.add(normQuery(q))
  const mentioned = new Set(pathsIn(e.description || "").filter(p => !pages.has(p)))
  for (const p of [...pages, ...mentioned]) { const w = townOf(p); if (w) towns.add(w) }
  return { pages, queries, mentioned, towns }
}

// Bijgewerkte contentpagina's die nog gemeten worden, in de vorm van een meting
export function contentRuns(tries: RouteTry[] = []): Experiment[] {
  return tries.filter(t => t.route === "inhoud" && !t.outcome && t.page).map(t => ({
    id: t.key, advice_key: t.key, description: t.description, changed_at: t.date, changed_pages: [t.page!], page: t.page, query: t.query,
    target_pages: [t.page!], target_queries: t.query ? [t.query] : [], baseline: {}, kind: "meting", outcome: null,
    result_14d: null, result_28d: null, result_56d: null, created_at: t.date, content: true,
  }) as unknown as Experiment)
}
export const isContentRun = (e: Experiment) => !!(e as unknown as { content?: boolean }).content

// Contentupdate: meetpunten 7/14/28 na bijwerken; daarna is hij klaar
function contentNext(changedAt: string, today: string) {
  for (const d of [7, 14, 28]) { const date = measureDate(changedAt, d); if (date >= today) return { date } }
  return null
}

// Loopt deze meting nog? Volgende meetdatum, eerste beoordeling en eindmeting.
export function runInfo(e: Experiment, today = new Date().toISOString().slice(0, 10)) {
  if (e.kind === "validatie") return null
  const content = isContentRun(e)
  const next = content ? contentNext(e.changed_at, today) : nextMeasurement(e as any)
  if (!next) return null
  const extended = !!(e.result_28d && (e.result_28d.report?.extend || e.result_28d.extend))
  return {
    next: next.date, content,
    end: measureDate(e.changed_at, extended ? EXTENDED_DAY : FINAL_DAY),
    firstAssessment: measureDate(e.changed_at, EARLY_DAY),
    assessed: content ? today >= measureDate(e.changed_at, EARLY_DAY) : !!e.result_14d,
  }
}

// Alleen metingen die nog lopen; technische validaties tellen niet (die gaan niet over het zoekresultaat).
// De homepage alleen bij hetzelfde zoekwoord: bijna elke sitebrede aanpassing raakt "/".
export function runningMeasurements(task: Task, experiments: Experiment[], today = new Date().toISOString().slice(0, 10), content: RouteTry[] = []): RunningHit[] {
  const t = taskTargets(task)
  const hits: RunningHit[] = []
  for (const e of [...experiments, ...contentRuns(content)]) {
    const run = runInfo(e, today)
    if (!run) continue
    const x = experimentTargets(e)
    const sameCard = t.keys.has(e.advice_key)
    let level: OverlapLevel | null = null
    let on: string[] = []
    const samePage = [...x.pages].filter(p => t.pages.has(p) && p !== "/")
    const named = [...x.mentioned].filter(p => t.pages.has(p) && p !== "/")
    const town = [...x.towns].filter(w => t.towns.has(w))
    // Kaart zonder eigen pagina met een plaats-zoekwoord: de hoofdpagina van die plaats is zijn pagina
    const townPage = !t.pages.size ? [...x.pages].filter(p => { const s = p.split("/").filter(Boolean); return s[0] === "regio" && s.length === 3 && t.towns.has(s[2]) }) : []
    if (samePage.length) { level = "pagina"; on = samePage }
    else if (townPage.length) { level = "pagina"; on = townPage }
    else if (named.length) { level = "genoemd"; on = named }
    else if (!x.pages.size && [...x.queries].some(q => t.queries.has(q))) { level = "zoekwoord"; on = [...x.queries].filter(q => t.queries.has(q)).map(q => `"${q}"`) }
    else if (town.length) { level = "plaats"; on = town.map(w => prettyPlace(w)) }
    if (sameCard) level = level || "kaart"
    if (!level) continue
    hits.push({ experiment: e, on, level: sameCard ? "kaart" : level, source: run.content ? "content" : "seo", next: run.next, end: run.end, sameCard, firstAssessment: run.firstAssessment, assessed: run.assessed })
  }
  const rank: Record<OverlapLevel, number> = { kaart: 0, pagina: 1, genoemd: 2, zoekwoord: 3, plaats: 4 }
  return hits.sort((a, b) => rank[a.level] - rank[b.level] || b.end.localeCompare(a.end))
}

// Korte uitleg van een overlap (kaartlabel en waarschuwing)
export function overlapText(h: RunningHit): string {
  const what = h.source === "content" ? "Contentmeting" : "Meting"
  switch (h.level) {
    case "pagina": return `${what} loopt op deze pagina`
    case "genoemd": return `${what} raakt deze pagina`
    case "plaats": return `${what} loopt in ${h.on[0]}`
    case "zoekwoord": return `${what} loopt op dit zoekwoord`
    default: return `${what} loopt al`
  }
}

// Tot wanneer wachten: tot de eerste beoordeling (dag 14) van alle overlappende metingen;
// is die er al, dan tot de eindmeting
export const waitUntil = (hits: RunningHit[]) => hits.reduce((m, h) => { const d = h.assessed ? h.end : h.firstAssessment; return d > m ? d : m }, "")
export const waitsForFirst = (hits: RunningHit[]) => hits.some(h => !h.assessed)
