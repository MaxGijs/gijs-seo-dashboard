// Werkt dit artikel? Oordeel uit GA4 (bekeken, leestijd, aanvragen) en Search Console,
// vergeleken met de andere gepubliceerde artikelen van Gijs. Vaste regels, uitlegbaar.
import type { ContentIdea, Eval } from "./model"

export type ArticleVerdict = { label: "Werkt" | "Werkt matig" | "Werkt (nog) niet" | "Nog te vroeg"; tone: "success" | "warning" | "error" | "neutral"; window: string | null; reasons: string[] }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }

export function articleVerdict(idea: Pick<ContentIdea, "id" | "evals">, all: (Pick<ContentIdea, "id" | "status" | "evals"> & { advice?: ContentIdea["advice"] })[]): ArticleVerdict {
  const key = idea.evals?.d56?.ga4 ? "d56" : idea.evals?.d28?.ga4 ? "d28" : null
  if (!key) return { label: "Nog te vroeg", tone: "neutral", window: null, reasons: ["Het eerste oordeel volgt na 28 dagen: dan is er genoeg bezoek om iets te zeggen."] }
  const e = idea.evals[key] as Eval, g = e.ga4!
  const days = key.slice(1)
  const reasons: string[] = []
  const leadsOk = g.measurement === "ok"
  const leads = (leadsOk ? g.requests || 0 : 0) + (g.contacts || 0)
  // Vergelijk met andere artikelen in dezelfde meetperiode
  // Alleen nieuwe artikelen: een bijgewerkte pagina had al bezoek en zou het gemiddelde scheeftrekken
  const others = all.filter(o => o.id !== idea.id && o.status === "gepubliceerd" && o.advice !== "bijwerken" && o.evals?.[key]?.ga4).map(o => o.evals[key]!.ga4!.views)
  const med = others.length >= 3 ? median(others) : null
  let score = 0
  if (leads > 0) { score += 2; reasons.push(`${leads} ${leads === 1 ? "aanvraag" : "aanvragen"} van mensen die via dit artikel binnenkwamen (${g.requests ?? 0} energiescan, ${g.contacts ?? 0} contact) in ${days} dagen.`) }
  else reasons.push(`Nog geen aanvragen via dit artikel in ${days} dagen.${!leadsOk ? " (De meting van energiescanaanvragen klopt nog niet helemaal.)" : ""}`)
  if (med !== null) {
    if (g.views >= med * 1.3) { score += 1; reasons.push(`${g.views}× bekeken: meer dan jullie gemiddelde artikel (${Math.round(med)}).`) }
    else if (g.views <= med * 0.5) { score -= 1; reasons.push(`${g.views}× bekeken: duidelijk minder dan jullie gemiddelde artikel (${Math.round(med)}).`) }
    else reasons.push(`${g.views}× bekeken, vergelijkbaar met jullie andere artikelen (${Math.round(med)}).`)
  } else {
    reasons.push(`${g.views}× bekeken. Vergelijken met andere artikelen kan vanaf 3 gemeten artikelen.`)
    if (g.views >= 100) score += 1
    else if (g.views < 20) score -= 1
  }
  if (g.engagementSec !== null) {
    if (g.engagementSec >= 60) { score += 1; reasons.push(`Gemiddeld ${Math.round(g.engagementSec)} seconden actief: het artikel wordt gelezen.`) }
    else if (g.engagementSec < 20) { score -= 1; reasons.push(`Gemiddeld maar ${Math.round(g.engagementSec)} seconden actief: bezoekers haken snel af. Komt de inleiding snel genoeg ter zake?`) }
  }
  if (g.ctaClicks) reasons.push(`${g.ctaClicks} klikken op de knop naar de energiescan.`)
  if (e.position !== null && e.position <= 10) reasons.push(`Staat in Google gemiddeld op positie ${String(e.position).replace(".", ",")}.`)
  const label = score >= 2 ? "Werkt" : score >= 0 && (key === "d28" || score >= 1) ? "Werkt matig" : "Werkt (nog) niet"
  return { label, tone: label === "Werkt" ? "success" : label === "Werkt matig" ? "warning" : "error", window: `na ${days} dagen`, reasons }
}
