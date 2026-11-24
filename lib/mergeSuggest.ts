// Samenvoegen voorstellen (pure functies, getest).
//
// Open kaarten over zoekwoorden die op dezelfde pagina uitkomen (bv. "dakisolatie almelo" en
// "isolatieglas almelo" → /regio/overijssel/almelo) zijn in de praktijk één opdracht: je past één
// pagina aan. Het bord stelt voor ze samen te voegen; jij beslist.

import type { Task } from "./types"
import { columnOf, isVisible } from "./workflow"
import { prettyPlace } from "./intent"
import { topicOf, topicLabel } from "./nearPage1"

export interface MergeSuggestion {
  id: string          // vaste sleutel van precies deze combinatie (voor "niet samen")
  title: string       // voorstel voor de groepsnaam
  why: string         // waarom samen, in één zin
  tasks: Task[]       // hoofdkaart eerst (die het verst is, dan de grootste)
}

const OPEN = new Set(["beoordelen", "gepland", "uitvoering"])
const STEP: Record<string, number> = { beoordelen: 0, gepland: 1, uitvoering: 2 }
export const pageOfTask = (t: Task) => t.signal.page || t.signal.conversions?.page || null

// Kaarten die mee kunnen doen: open, geen herinnering of techniek, zelf niet samengevoegd
export function mergeable(t: Task) {
  return isVisible(t) && OPEN.has(columnOf(t.status)) && t.status !== "samengevoegd" && !t.signal.reminder && t.signal.kind !== "techniek" && !!t.signal.query
}

const cityOf = (page: string) => prettyPlace(page.split("/").filter(Boolean).pop() || page)

export function mergeSuggestions(tasks: Task[], dismissed: Set<string> = new Set()): MergeSuggestion[] {
  const by = new Map<string, Task[]>()
  for (const t of tasks.filter(mergeable)) {
    const page = pageOfTask(t)
    const topic = topicOf(t.signal.query || "")
    // Zelfde pagina; zonder pagina: zelfde plaats én onderwerp
    const key = page ? `page:${page}` : t.signal.place && topic ? `pt:${t.signal.place}|${topic}` : null
    if (key) by.set(key, [...(by.get(key) || []), t])
  }
  const out: MergeSuggestion[] = []
  for (const [key, list] of by) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => STEP[columnOf(b.status)] - STEP[columnOf(a.status)] || (b.signal.metrics.impressions || 0) - (a.signal.metrics.impressions || 0))
    const id = `merge:${sorted.map(t => t.key).sort().join("+")}`
    if (dismissed.has(id)) continue
    const topics = [...new Set(sorted.map(t => topicOf(t.signal.query || "")))]
    const existing = sorted.find(t => t.signal.groupTitle)?.signal.groupTitle
    let title: string, why: string
    if (key.startsWith("page:")) {
      const page = key.slice(5)
      const city = page.startsWith("/regio/") ? cityOf(page) : page
      title = existing || (topics.length === 1 && topics[0] ? `${topicLabel(topics[0])} ${city}` : `Pagina ${city}`)
      why = topics.length === 1
        ? `Zelfde pagina (${page}) en zelfde onderwerp: één aanpassing helpt alle zoekwoorden.`
        : `Zelfde pagina (${page}): je past één pagina aan voor ${sorted.length} zoekwoorden.`
    } else {
      const [place, topic] = key.slice(3).split("|")
      title = existing || `${topicLabel(topic)} ${prettyPlace(place)}`
      why = `Zelfde plaats (${prettyPlace(place)}) en zelfde onderwerp: één pagina kan ze allemaal beantwoorden.`
    }
    out.push({ id, title, why, tasks: sorted })
  }
  // Grootste kans eerst
  return out.sort((a, b) => b.tasks.reduce((s, t) => s + (t.signal.gain || 0), 0) - a.tasks.reduce((s, t) => s + (t.signal.gain || 0), 0))
}
