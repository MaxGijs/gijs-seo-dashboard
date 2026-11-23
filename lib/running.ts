// Loopt er al een meting op dezelfde pagina?
// Wie opnieuw iets aanpast terwijl de vorige aanpassing nog wordt gemeten, kan minder goed zien of die
// vorige aanpassing heeft geholpen. Daarom waarschuwen we bij plannen of uitvoeren; we blokkeren niet.
// Een taak op een andere pagina gaat gewoon door, ook bij hetzelfde zoekwoord. Alleen metingen zonder
// pagina vergelijken we op zoekwoord.

import type { Experiment, Task } from "./types"
import { nextMeasurement } from "./experiment"
import { EARLY_DAY, EXTENDED_DAY, FINAL_DAY, measureDate } from "./measureLogic"

export interface RunningHit {
  experiment: Experiment
  on: string[]            // waarop de overlap zit: pagina's en/of zoekwoorden
  next: string | null     // volgende meetdatum
  firstAssessment: string // dag 14: eerste beoordeling
  assessed: boolean       // eerste beoordeling is er al
  end: string             // eindmeting (dag 28, of 56 bij verlenging)
  sameCard: boolean       // meting hoort bij deze kaart zelf
}

const normPage = (p: string) => {
  let x = p.trim().toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "")
  if (x.length > 1) x = x.replace(/\/+$/, "")
  return x || "/"
}
const normQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ")


function taskTargets(task: Task) {
  const all = [task, ...(task.merged || [])]
  const pages = new Set<string>(), queries = new Set<string>()
  for (const t of all) {
    const s = t.signal as Task["signal"] & { targetPage?: string }
    for (const p of [s.page, s.targetPage]) if (p) pages.add(normPage(p))
    if (s.query) queries.add(normQuery(s.query))
  }
  return { keys: new Set(all.map(t => t.key)), pages, queries }
}

function experimentTargets(e: Experiment) {
  const pages = new Set<string>(), queries = new Set<string>()
  const changed: string[] = e.changed_pages || []
  for (const p of changed.length ? changed : [e.page, e.baseline?.targetPage, ...(e.target_pages || [])]) if (typeof p === "string" && p) pages.add(normPage(p))
  for (const q of [e.query, ...(e.target_queries || [])]) if (typeof q === "string" && q) queries.add(normQuery(q))
  return { pages, queries }
}

// Alleen metingen die nog lopen; technische validaties tellen niet (die gaan niet over het zoekresultaat).
// De homepage alleen bij hetzelfde zoekwoord: bijna elke sitebrede aanpassing raakt "/".
export function runningMeasurements(task: Task, experiments: Experiment[], today = new Date().toISOString().slice(0, 10)): RunningHit[] {
  const t = taskTargets(task)
  const hits: RunningHit[] = []
  for (const e of experiments) {
    if (e.kind === "validatie") continue
    const next = nextMeasurement(e as any)
    if (!next) continue
    const extended = !!(e.result_28d && (e.result_28d.report?.extend || e.result_28d.extend))
    const end = measureDate(e.changed_at, extended ? EXTENDED_DAY : FINAL_DAY)
    const x = experimentTargets(e)
    const sameCard = t.keys.has(e.advice_key)
    const on = x.pages.size
      ? [...x.pages].filter(p => t.pages.has(p) && p !== "/")
      : [...x.queries].filter(q => t.queries.has(q)).map(q => `"${q}"`)
    if (!sameCard && !on.length) continue
    hits.push({ experiment: e, on, next: next.date, end, sameCard, firstAssessment: measureDate(e.changed_at, EARLY_DAY), assessed: !!e.result_14d })
  }
  return hits.sort((a, b) => b.end.localeCompare(a.end))
}

// Tot wanneer wachten: tot de eerste beoordeling (dag 14) van alle overlappende metingen;
// is die er al, dan tot de eindmeting
export const waitUntil = (hits: RunningHit[]) => hits.reduce((m, h) => { const d = h.assessed ? h.end : h.firstAssessment; return d > m ? d : m }, "")
export const waitsForFirst = (hits: RunningHit[]) => hits.some(h => !h.assessed)
