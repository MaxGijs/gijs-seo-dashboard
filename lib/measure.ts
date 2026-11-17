// Succescriteria per soort aanpassing. Panel (meetplan), nulmeting en de nachtelijke
// beoordeling (cron/experiment-eval) gebruiken dezelfde definities.

import type { ActionType } from "./types"

export type SuccessMetric = "technisch" | "indexering" | "consolidatie" | "ctr" | "position" | "geen" | "controle" | "conversie"

// Succes bij positie: een betekenisvolle stap, groter dan normale meetruis.
// Geslaagd = pagina 1 bereikt (van >10 naar ≤10) óf minstens 2 posities en 15% beter.
// Niet geslaagd = net zo'n stap achteruit. Daartussen = geen duidelijk effect.
export function positionStep(base: number) { return Math.max(2, Math.round(base * 0.15 * 10) / 10) }
export function positionVerdict(base: number, now: number): "succesvol" | "niet_succesvol" | "onduidelijk" {
  if (base > 10 && now <= 10) return "succesvol"
  const step = positionStep(base)
  if (now <= base - step) return "succesvol"
  if (now >= base + step || (base <= 10 && now > 10)) return "niet_succesvol"
  return "onduidelijk"
}
export const POSITION_RULE = "pagina 1 bereikt (top 10) of minstens 2 posities én 15% beter dan bij de nulmeting; even ver achteruit (of van pagina 1 af) is niet geslaagd, daartussen is geen duidelijk effect"

export const SUCCESS_METRIC: Record<ActionType, SuccessMetric> = {
  technisch: "technisch",
  indexering: "indexering",
  consolidatie: "consolidatie",
  snippet: "ctr",
  ranking: "position",
  merk: "geen",
  geen: "geen",
  handmatig: "geen",
  controle: "controle",
  conversie: "conversie",
}

export interface MeasurePlan {
  label: string                         // soort aanpassing in gewone taal
  timeline: { l: string; s: string }[]
  success: string                       // succescriterium
  baselineText: string                  // wat de nulmeting vastlegt
}

export function measurePlan(type: ActionType, ctx: { page?: string | null; query?: string | null; count?: number } = {}): MeasurePlan {
  const page = ctx.page || "de pagina"
  switch (type) {
    case "conversie":
      return {
        label: "Meer aanvragen (conversie)",
        timeline: [
          { l: "Nulmeting", s: "28 dagen vóór de aanpassing" },
          { l: "14 dagen", s: "eerste meting" },
          { l: "28 dagen", s: "tussenmeting" },
          { l: "56 dagen", s: "eindoordeel" },
        ],
        success: `Gemeten op energiescanaanvragen in GA4${ctx.page && ctx.page !== "/" ? ` via ${ctx.page}` : " op de hele site"}, niet op posities in Google. Geslaagd als het aandeel bezoeken met een aanvraag minstens 20% hoger is dan in dezelfde periode vóór de aanpassing én er minstens 2 aanvragen meer zijn. Bij te weinig aanvragen of een meting die nog niet klopt is het oordeel "geen duidelijk effect".`,
        baselineText: "het aantal sessies en energiescanaanvragen in de periode vóór de aanpassing (automatisch uit GA4)",
      }
    case "controle":
      return {
        label: "Controle of reparatie van een meting",
        timeline: [
          { l: "Nu", s: "probleem vastgelegd" },
          { l: "Elke nacht", s: "opnieuw gecontroleerd" },
          { l: "Opgelost", s: "taak sluit vanzelf" },
          { l: "28 dagen", s: "eindoordeel" },
        ],
        success: "Geslaagd zodra de nachtelijke controle het probleem niet meer vindt. Lukt dat niet binnen 28 dagen, dan blijft de taak open staan.",
        baselineText: "het gevonden probleem",
      }
    case "technisch":
      return {
        label: "Technische reparatie",
        timeline: [
          { l: "Nulmeting", s: `${ctx.count ? `${ctx.count} foute URL's` : "huidige status"}` },
          { l: "Elke nacht", s: "HTTP-controle" },
          { l: "14 dagen", s: "opnieuw gecrawld?" },
          { l: "28 dagen", s: "eindoordeel" },
        ],
        success: "Geslaagd zodra elke betrokken URL 200 of een bedoelde 301 geeft en geen foutieve URL meer in de sitemap staat. Daarna volgt het dashboard of Google de URL's opnieuw heeft gecrawld.",
        baselineText: "de HTTP-status en sitemapstatus van elke betrokken URL",
      }
    case "indexering":
      return {
        label: "Indexering",
        timeline: [
          { l: "Nulmeting", s: "indexeringsstatus" },
          { l: "Wekelijks", s: "URL-inspectie" },
          { l: "28 dagen", s: "geïndexeerd?" },
          { l: "56 dagen", s: "eindoordeel" },
        ],
        success: "Geslaagd als Google de pagina('s) indexeert (status ‘Geïndexeerd’) binnen 56 dagen. Pas daarna is positie een zinvolle maatstaf.",
        baselineText: "de indexeringsstatus en laatste crawldatum",
      }
    case "consolidatie":
      return {
        label: "Samenvoegen van pagina's",
        timeline: [
          { l: "Nulmeting", s: "vertoningen per pagina" },
          { l: "14 dagen", s: "doorverwijzing actief?" },
          { l: "28 dagen", s: "oude URL verdwijnt" },
          { l: "56 dagen", s: "eindoordeel" },
        ],
        success: `Geslaagd als de oude URL doorverwijst naar ${page} en ${page} na 56 dagen minstens 90% van de vertoningen van beide pagina's samen heeft.`,
        baselineText: "de vertoningen, clicks en positie van elke betrokken pagina",
      }
    case "snippet":
      return {
        label: "Zoekresultaattekst (title en description)",
        timeline: [
          { l: "Nulmeting", s: "doorklik nu" },
          { l: "14 dagen", s: "eerste meting" },
          { l: "28 dagen", s: "tussenmeting" },
          { l: "56 dagen", s: "eindoordeel" },
        ],
        success: "Geslaagd als de doorklik na 56 dagen minstens 20% hoger ligt dan bij de nulmeting, op een vergelijkbare positie.",
        baselineText: "positie, vertoningen, clicks en doorklik",
      }
    case "ranking":
      return {
        label: "Positie verbeteren (links en inhoud)",
        timeline: [
          { l: "Nulmeting", s: "bij uitvoeren" },
          { l: "14 dagen", s: "eerste meting" },
          { l: "28 dagen", s: "tussenmeting" },
          { l: "56 dagen", s: "eindoordeel" },
        ],
        success: ctx.query && ctx.page
          ? `Na 56 dagen, gemeten op ${ctx.page} voor "${ctx.query}": geslaagd bij ${POSITION_RULE}.`
          : `Na 56 dagen: geslaagd bij ${POSITION_RULE}.`,
        baselineText: ctx.query && ctx.page ? `de positie van ${ctx.page} voor "${ctx.query}" én van het zoekwoord als geheel` : "positie, vertoningen, clicks en doorklik",
      }
    case "merk":
      return {
        label: "Controle",
        timeline: [{ l: "Nu", s: "zelf zoeken" }, { l: "Klaar", s: "geen meting" }],
        success: "Geen meting: dit is een controle. Sluit de taak af na het zoeken.",
        baselineText: "niets",
      }
    case "handmatig":
      return {
        label: "Eigen taak",
        timeline: [{ l: "Nu", s: "uitvoeren" }, { l: "Klaar", s: "zelf beoordelen" }],
        success: "Geen automatische meting: er is geen zoekwoord of pagina gekoppeld. Beoordeel het resultaat zelf bij het afronden.",
        baselineText: "je beschrijving van de aanpassing",
      }
    case "geen":
      return {
        label: "Geen aanpassing",
        timeline: [{ l: "Nu", s: "controleren" }, { l: "Klaar", s: "sluiten" }],
        success: "Geen meting nodig: er hoeft niets te veranderen. Controleer en sluit.",
        baselineText: "niets",
      }
  }
}
