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
          { l: "14 dagen", s: "eerste beoordeling" },
          { l: "28 dagen", s: "eindoordeel" },
          { l: "56 dagen", s: "alleen bij te weinig aanvragen" },
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
          { l: "28 dagen", s: "eindoordeel" },
          { l: "56 dagen", s: "alleen als nog niet geïndexeerd" },
        ],
        success: "Geslaagd zodra Google de pagina('s) indexeert (status ‘Geïndexeerd’). Nog niet na 28 dagen, dan wordt verlengd tot 56 dagen. Pas daarna is positie een zinvolle maatstaf.",
        baselineText: "de indexeringsstatus en laatste crawldatum",
      }
    case "consolidatie":
      return {
        label: "Samenvoegen van pagina's",
        timeline: [
          { l: "Nulmeting", s: "vertoningen per pagina" },
          { l: "14 dagen", s: "doorverwijzing actief?" },
          { l: "28 dagen", s: "eindoordeel" },
          { l: "56 dagen", s: "alleen bij te weinig data" },
        ],
        success: `Geslaagd als de oude URL doorverwijst naar ${page} en ${page} na 28 dagen minstens 90% van de vertoningen van beide pagina's samen heeft.`,
        baselineText: "de vertoningen, clicks en positie van elke betrokken pagina",
      }
    case "snippet":
      return {
        label: "Zoekresultaattekst (title en description)",
        timeline: [
          { l: "Nulmeting", s: "28 dagen vóór de aanpassing" },
          { l: "7 dagen", s: "signalering: opnieuw gecrawld?" },
          { l: "14 dagen", s: "eerste beoordeling en advies" },
          { l: "28 dagen", s: "eindmeting (56 bij te weinig data)" },
        ],
        success: "Gemeten op de aangepaste pagina's en hun zoekopdrachten. Positief als de doorklik (CTR) minstens 20% hoger ligt dan in even lange periode vóór de aanpassing; vertoningen, klikken en positie wegen mee. Na 14 dagen een voorlopige beoordeling met advies, na 28 dagen de conclusie.",
        baselineText: "positie, vertoningen, clicks en doorklik",
      }
    case "ranking":
      return {
        label: "Positie verbeteren (links en inhoud)",
        timeline: [
          { l: "Nulmeting", s: "28 dagen vóór de aanpassing" },
          { l: "7 dagen", s: "signalering: opnieuw gecrawld?" },
          { l: "14 dagen", s: "eerste beoordeling en advies" },
          { l: "28 dagen", s: "eindmeting (56 bij te weinig data)" },
        ],
        success: ctx.query && ctx.page
          ? `Gemeten op ${ctx.page} en de relevante zoekopdrachten (vertoningen, positie, klikken, CTR, aantal zoekopdrachten). Positief bij ${POSITION_RULE} voor "${ctx.query}", in combinatie met de andere zoekopdrachten. Na 14 dagen een voorlopige beoordeling met advies, na 28 dagen de conclusie.`
          : `Gemeten op de aangepaste pagina's en de relevante zoekopdrachten. Positief bij ${POSITION_RULE}, in combinatie met de andere zoekopdrachten. Na 14 dagen een voorlopige beoordeling met advies, na 28 dagen de conclusie.`,
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
