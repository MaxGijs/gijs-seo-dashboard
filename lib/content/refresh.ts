// Wanneer heeft een bestaande pagina een refresh nodig? (pure functies, getest)
//
// Drie redenen, alle drie uitlegbaar en met bewijs:
// 1. Verouderde tekst: een zin noemt een jaartal of termijn die voorbij is (actualiteitscontrole).
// 2. Nieuws over een regeling die de pagina noemt (actualiteitscontrole).
// 3. Minder vertoningen: de pagina krijgt over 28 dagen duidelijk minder vertoningen dan de 28 dagen
//    ervoor (minstens 30%), ook als de rest van de site krimpt. Dat wijst vaak op inhoud die minder goed aansluit.
// Het resultaat is altijd een "bijwerken"-kans met voor/na-meting; er wordt nooit iets aan de site veranderd.

import type { ContentIdea } from "./model"
import type { Draft } from "./build"

export interface DecayPage {
  path: string; page_type: string | null; in_sitemap: boolean; http_status: number | null; http_final_path?: string | null
  imp_28d: number; imp_prev_28d: number; clicks_28d: number; position_28d: number | null
}

export const DECAY = { minPrev: 150, maxRatio: 0.7, minLost: 60, perNight: 3 } as const

export interface Decay { path: string; prev: number; now: number; expected: number; lost: number; ratio: number; siteFactor: number }

// Correctie voor de rest van de site: alleen pagina's die in beide perioden al vertoningen hadden
// (nieuwe pagina's tellen niet mee). Krimpt de site, dan corrigeren we daarvoor; groeit hij, dan niet:
// een pagina hoeft niet mee te groeien om "in orde" te zijn, maar moet echt minder krijgen.
export function siteFactorOf(pages: Pick<DecayPage, "in_sitemap" | "imp_28d" | "imp_prev_28d">[]): number {
  const peers = pages.filter(p => p.in_sitemap && p.imp_prev_28d >= 20)
  const prev = peers.reduce((s, p) => s + p.imp_prev_28d, 0), cur = peers.reduce((s, p) => s + p.imp_28d, 0)
  return prev > 0 ? Math.min(1, cur / prev) : 1
}

// siteFactor: uit siteFactorOf (≤ 1)
export function decayOf(p: DecayPage, siteFactor: number): Decay | null {
  if (!p.in_sitemap || (p.http_status && p.http_status >= 400) || (p.http_final_path && p.http_final_path !== p.path)) return null
  if (p.imp_prev_28d < DECAY.minPrev) return null
  const expected = p.imp_prev_28d * siteFactor
  const ratio = expected > 0 ? p.imp_28d / expected : 1
  const lost = Math.round(expected - p.imp_28d)
  if (ratio > DECAY.maxRatio || lost < DECAY.minLost) return null
  return { path: p.path, prev: p.imp_prev_28d, now: p.imp_28d, expected: Math.round(expected), lost, ratio: Math.round(ratio * 100) / 100, siteFactor: Math.round(siteFactor * 100) / 100 }
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`
const nl = (n: number) => n.toLocaleString("nl-NL")

export function decayDrafts(pages: DecayPage[], opts: { skip: Set<string>; titles?: Map<string, string>; now?: Date }): Draft[] {
  const now = opts.now || new Date()
  const siteFactor = siteFactorOf(pages)
  const found = pages.map(p => decayOf(p, siteFactor)).filter((d): d is Decay => !!d && !opts.skip.has(d.path))
    .sort((a, b) => b.lost - a.lost).slice(0, DECAY.perNight)
  return found.map(d => {
    const name = opts.titles?.get(d.path) || d.path
    const drop = 1 - d.now / d.prev
    const site = d.siteFactor >= 0.98 ? "De rest van de site daalde niet, dus dit ligt aan de pagina zelf." : `De rest van de site kreeg ${pct(1 - d.siteFactor)} minder vertoningen; ook daarvoor gecorrigeerd had de pagina er ongeveer ${nl(d.expected)} moeten krijgen.`
    const why = `${d.path} kreeg de laatste 28 dagen ${nl(d.now)} vertoningen, tegen ${nl(d.prev)} de 28 dagen ervoor (${pct(drop)} minder). ${site} Er gaan zo'n ${nl(d.lost)} vertoningen per 28 dagen verloren.`
    return {
      fingerprint: `refresh:${d.path}:${now.toISOString().slice(0, 7)}`,
      origin: "prestatie" as const,
      subject: `Refresh ${name}: minder vertoningen in Google`,
      summary: why,
      whyNow: "Een pagina die duidelijk minder vaak wordt getoond dan de rest van de site, sluit vaak minder goed aan op wat mensen nu zoeken of is ingehaald door concurrenten. Bekijk welke zoekwoorden terugliepen, actualiseer de tekst en voeg toe wat ontbreekt. Seizoen kan meespelen; controleer dat eerst.",
      service: null, impact: "advies" as const, regions: [],
      sources: [{ title: `Search Console: ${d.path}`, url: `https://www.groeninjestraat.nl${d.path}`, publisher: "Search Console", date: now.toISOString(), reliability: "eigen-data" as const }],
      ageDays: 0, reliability: "eigen-data" as const, keywords: [],
      advice: "bijwerken" as const, targetPage: d.path,
      adviceReason: why,
      format: "Bestaande pagina bijwerken",
      titleOverride: [{ angle: "neutraal" as const, title: `Refresh ${name}: minder vertoningen in Google`.slice(0, 80) }],
      urgency: d.lost >= 300 ? "hoog" as const : "middel" as const,
    }
  })
}

// ── Voor de weergave: welke kansen zijn een refresh, en waarom ──────────────

export type RefreshKind = "verouderd" | "nieuws" | "minder-vertoningen" | "bijwerken"
export const REFRESH_META: Record<RefreshKind, { label: string }> = {
  verouderd: { label: "Verouderde tekst" },
  nieuws: { label: "Nieuws over een regeling" },
  "minder-vertoningen": { label: "Minder vertoningen" },
  bijwerken: { label: "Kan beter bijgewerkt" },
}
const OPEN = new Set(["nieuw", "geaccepteerd", "briefing", "concept", "review", "goedgekeurd", "later"])

export function refreshKind(i: Pick<ContentIdea, "origin" | "fingerprint" | "advice">): RefreshKind | null {
  if (i.advice !== "bijwerken") return null
  if (i.origin === "prestatie") return "minder-vertoningen"
  if (i.origin === "actualiteit" && i.fingerprint?.startsWith("actueel:")) return i.fingerprint.startsWith("actueel:jaar:") ? "verouderd" : "nieuws"
  return "bijwerken"
}

export interface RefreshItem { id: string; title: string; page: string | null; kind: RefreshKind; status: string; created_at: string; urgent: boolean }

// Openstaande refresh-kansen, de urgentste eerst. "Kan beter bijgewerkt" (een nieuwe kans die beter
// op een bestaande pagina past) telt niet als refresh-melding: dat is een contentkans, geen onderhoud.
export function openRefreshes(ideas: Pick<ContentIdea, "id" | "title" | "status" | "origin" | "fingerprint" | "advice" | "target_page" | "created_at" | "score">[]): RefreshItem[] {
  const order: Record<RefreshKind, number> = { verouderd: 0, nieuws: 1, "minder-vertoningen": 2, bijwerken: 3 }
  return ideas
    .map(i => ({ i, kind: refreshKind(i) }))
    .filter((x): x is { i: typeof x.i; kind: RefreshKind } => !!x.kind && x.kind !== "bijwerken" && OPEN.has(x.i.status))
    .map(({ i, kind }) => ({ id: i.id, title: i.title, page: i.target_page, kind, status: i.status, created_at: i.created_at, urgent: kind !== "minder-vertoningen" || (i.score ?? 0) >= 60 }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.created_at.localeCompare(b.created_at))
}

// Mag een kans die niemand oppakt vanzelf verlopen? Nieuws veroudert; een verouderde zin of een
// dalende pagina niet. Die blijven staan tot iemand ze behandelt.
export function mayExpire(i: Pick<ContentIdea, "origin" | "fingerprint">): boolean {
  if (i.origin === "prestatie") return false
  if (i.fingerprint?.startsWith("actueel:jaar:")) return false
  return true
}
