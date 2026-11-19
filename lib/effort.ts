// Benodigde inspanning, als vaste vuistregel (geen meting). Elk advies toont dit naast waarom,
// bewijs, verwachte impact en prioriteit (docs/DESIGN.md). Voor losse SEO-adviezen bepaalt de
// diagnose dit al (diag.effort); dit bestand dekt siteadviezen en contentkansen.

import type { SiteAdvice } from "./siteadvice"
import type { ContentIdea } from "./content/model"

export interface Effort { level: "klein" | "middel" | "groot"; label: string; why: string }

const LABEL = { klein: "Klein (minder dan een uur)", middel: "Middel (een dagdeel)", groot: "Groot (meerdere dagen)" } as const
const make = (level: Effort["level"], why: string): Effort => ({ level, label: LABEL[level], why })

export function effortForSite(a: SiteAdvice): Effort {
  if (a.kind === "route-stoppen") return make("klein", "Alleen een besluit: met deze aanpak stoppen.")
  if (a.kind === "regio" || a.kind === "indexering") return make("groot", "Raakt een hele provincie aan pagina's.")
  const n = a.taskKeys.length || a.pages.length
  if (a.kind === "conversie") return make("middel", "Aanpassingen aan formulier of knoppen, plus controle van de meting.")
  if (n <= 2) return make("klein", `${n || 1} ${n === 1 ? "pagina" : "pagina's"}.`)
  if (n <= 8) return make("middel", `${n} pagina's met dezelfde aanpak.`)
  return make("groot", `${n} pagina's met dezelfde aanpak.`)
}

export function effortForIdea(i: Pick<ContentIdea, "advice" | "format">): Effort {
  if (i.advice === "niets") return make("klein", "Geen werk nodig.")
  if (i.advice === "bijwerken") return make("middel", "Een bestaande pagina aanvullen en controleren.")
  if (/uitgebreid|kennisartikel|gids|stappenplan/i.test(i.format || "")) return make("groot", `${i.format}: schrijven, laten controleren en publiceren.`)
  return make("middel", `${i.format || "Artikel"}: schrijven, laten controleren en publiceren.`)
}
