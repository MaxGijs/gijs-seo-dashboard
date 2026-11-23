// Loopt er al een meting op dezelfde pagina of hetzelfde zoekwoord?
// Wie opnieuw iets aanpast terwijl de vorige aanpassing nog wordt gemeten, kan niet meer zien
// of die vorige aanpassing heeft geholpen. Daarom waarschuwen we bij plannen of uitvoeren.

import type { Experiment, Task } from "./types"
import { EXTEND_DAYS, nextMeasurement } from "./experiment"

export interface RunningHit {
  experiment: Experiment
  on: string[]            // waarop de overlap zit: pagina's en/of zoekwoorden
  next: string | null     // volgende meetdatum
  end: string             // datum van het eindoordeel (56 dagen, of 84 bij verlengd)
  sameCard: boolean       // meting hoort bij deze kaart zelf
}

const normPage = (p: string) => {
  let x = p.trim().toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "")
  if (x.length > 1) x = x.replace(/\/+$/, "")
  return x || "/"
}
const normQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ")

const addDays = (date: string, d: number) => { const x = new Date(`${date.slice(0, 10)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }

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
  for (const p of [e.page, e.baseline?.targetPage, ...(e.target_pages || [])]) if (typeof p === "string" && p) pages.add(normPage(p))
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
    const end = addDays(e.changed_at, e.result_56d ? EXTEND_DAYS : 56)
    if (end < today) continue
    const x = experimentTargets(e)
    const sameCard = t.keys.has(e.advice_key)
    const on = [
      ...[...x.pages].filter(p => t.pages.has(p) && p !== "/"),
      ...[...x.queries].filter(q => t.queries.has(q)).map(q => `"${q}"`),
    ]
    if (!sameCard && !on.length) continue
    hits.push({ experiment: e, on, next: next.date, end, sameCard })
  }
  return hits.sort((a, b) => b.end.localeCompare(a.end))
}

// Tot wanneer wachten: het laatste eindoordeel van de overlappende metingen
export const waitUntil = (hits: RunningHit[]) => hits.reduce((m, h) => (h.end > m ? h.end : m), "")
