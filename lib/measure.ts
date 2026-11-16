// Succescriteria per soort aanpassing. Panel (meetplan), nulmeting en de nachtelijke
// beoordeling (cron/experiment-eval) gebruiken dezelfde definities.

import type { ActionType } from "./types"

export type SuccessMetric = "technisch" | "indexering" | "consolidatie" | "ctr" | "position" | "geen"

export const SUCCESS_METRIC: Record<ActionType, SuccessMetric> = {
  technisch: "technisch",
  indexering: "indexering",
  consolidatie: "consolidatie",
  snippet: "ctr",
  ranking: "position",
  merk: "geen",
  geen: "geen",
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
          ? `Geslaagd als ${ctx.page} voor "${ctx.query}" na 56 dagen minstens 0,5 positie beter staat dan bij de nulmeting (gemeten op deze zoekwoord-paginacombinatie).`
          : "Geslaagd als de gemiddelde positie na 56 dagen minstens 0,5 beter is dan bij de nulmeting.",
        baselineText: ctx.query && ctx.page ? `de positie van ${ctx.page} voor "${ctx.query}" én van het zoekwoord als geheel` : "positie, vertoningen, clicks en doorklik",
      }
    case "merk":
      return {
        label: "Controle",
        timeline: [{ l: "Nu", s: "zelf zoeken" }, { l: "Klaar", s: "geen meting" }],
        success: "Geen meting: dit is een controle. Sluit de taak af na het zoeken.",
        baselineText: "niets",
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
