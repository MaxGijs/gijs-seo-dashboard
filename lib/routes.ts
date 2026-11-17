// Er zijn meerdere wegen naar Borne. Per pagina en zoekwoord onthouden we welke route al is
// geprobeerd (interne links, inhoud, title) en wat dat opleverde. Lukt een route niet, dan schuift
// het advies door naar de volgende route in plaats van hetzelfde nog eens voor te stellen.

import { actionOf } from "./learning"
import type { Experiment } from "./types"

export type Route = "interne-links" | "inhoud" | "titel-meta"
export const ROUTE_ORDER: Route[] = ["interne-links", "inhoud", "titel-meta"]
export const ROUTE_LABEL: Record<string, string> = {
  "interne-links": "Interne links", inhoud: "Inhoud uitbreiden", "titel-meta": "Title en H1 aanpassen", techniek: "Technische reparatie", overig: "Overige aanpassing",
}

export interface RouteTry {
  key: string                 // advice_key van het experiment
  route: string
  page: string | null
  query: string | null
  date: string
  outcome: Experiment["outcome"]
  summary: string | null
  confounders: string[]
  description: string
}

export function routeOf(e: Pick<Experiment, "description" | "hypothesis">) {
  return actionOf(`${e.description || ""} ${e.hypothesis || ""}`) || "overig"
}

export function toTries(exps: Experiment[]): RouteTry[] {
  return exps.map(e => {
    const last = e.result_56d || e.result_28d || e.result_14d
    const page = (e.baseline?.targetPage as string | undefined) || e.page || e.target_pages?.[0] || null
    return {
      key: e.advice_key, route: routeOf(e), page, query: e.query, date: e.changed_at, outcome: e.outcome,
      summary: (last?.summary as string | undefined) || null,
      confounders: (last?.confounders as string[] | undefined) || [],
      description: e.description,
    }
  })
}

// Pogingen die over dezelfde pagina óf hetzelfde zoekwoord gaan
export function triesFor(tries: RouteTry[], subject: { page?: string | null; query?: string | null }) {
  return tries.filter(t => (subject.page && t.page === subject.page) || (subject.query && t.query === subject.query))
    .sort((a, b) => b.date.localeCompare(a.date))
}

const failed = (t: RouteTry) => t.outcome === "niet_succesvol" || t.outcome === "onduidelijk"
const running = (t: RouteTry) => !t.outcome

export function routeAction(route: Route | null, page: string, q: string | null) {
  const subject = q ? `"${q}"` : page
  switch (route) {
    case "interne-links": return `Versterk ${page} met interne links vanaf verwante pagina's, zodat ${subject} stijgt`
    case "inhoud": return `Breid ${page} uit met lokale informatie en antwoorden op de vragen achter ${subject}`
    case "titel-meta": return `Pas de title en H1 van ${page} aan zodat ${q ? subject : "het onderwerp"} er natuurlijk in staat`
    default: return `Alle gangbare routes zijn al geprobeerd voor ${page}: laat de pagina en de concurrenten in Google handmatig bekijken`
  }
}

// Volgt het huidige advies een route die hier al mislukte (of nog loopt)? Dan de volgende route.
export function nextRouteFor(currentAction: string | undefined, tries: RouteTry[]) {
  const current = actionOf(currentAction) as Route | "techniek" | "overig" | undefined
  if (!current || !ROUTE_ORDER.includes(current as Route) || !tries.length) return null
  const blocked = new Set(tries.filter(t => failed(t) || running(t)).map(t => t.route))
  if (!blocked.has(current)) return null
  const next = ROUTE_ORDER.find(r => !blocked.has(r)) || null
  const why = tries.filter(t => t.route === current)[0]
  return {
    route: next,
    reason: why && running(why)
      ? `${ROUTE_LABEL[current]} loopt hier al sinds ${why.date}; tegelijk nog eens hetzelfde doen maakt de meting onbruikbaar.`
      : `${ROUTE_LABEL[current]} is hier al geprobeerd (${why?.date || "eerder"}) zonder ${why?.outcome === "onduidelijk" ? "duidelijk " : ""}effect${why?.summary ? `: ${why.summary}` : ""}.`,
  }
}
