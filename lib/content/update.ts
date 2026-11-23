// Een bijgewerkte bestaande pagina meten we als experiment, niet als nieuw artikel:
// dezelfde pagina vóór en na de aanpassing, op de zoekwoorden waar de kans over ging,
// gecorrigeerd voor groei of krimp van de hele site (seizoen, nieuwe provincies).
// Meetmomenten 7 (signalering), 14 (eerste beoordeling) en 28 dagen (eindoordeel), zoals bij de
// SEO-experimenten; 56 dagen alleen als er na 28 dagen te weinig data is.
// Pure functies: gebruikt door de nachtelijke meting (server), het contentpaneel en de lessen.

import { positionVerdict, POSITION_RULE } from "@/lib/measure"
import type { Ga4Eval } from "./model"
import type { RouteTry } from "@/lib/routes"

export const UPDATE_MILESTONES = [7, 14, 28, 56] as const
export type UpdateMilestone = (typeof UPDATE_MILESTONES)[number]
export const BASELINE_DAYS = 28
// Minder vertoningen dan dit (per 28 dagen, vóór én na) is te weinig om iets te concluderen
export const UPDATE_MIN_IMPRESSIONS = 100

export interface SearchTotals { impressions: number; clicks: number; position: number | null }
export interface UpdateSnapshot {
  window: { start: string; end: string; days: number }
  page: SearchTotals                  // de hele pagina in Google
  queries: SearchTotals               // alleen de zoekwoorden van de kans, op deze pagina
  siteImpressionsPerDay: number | null
  ga4?: Ga4Eval | null
  ga4Error?: string
}
export interface UpdatePoint extends UpdateSnapshot { days: UpdateMilestone; measured_at: string; growth: number | null; confounders: string[] }
export type UpdateOutcome = "succesvol" | "niet_succesvol" | "onduidelijk"
export interface UpdateMeasure {
  page: string
  queries: string[]
  changed_at: string                  // dag dat de bijgewerkte pagina live ging
  baseline: UpdateSnapshot | null
  points: Partial<Record<`d${UpdateMilestone}`, UpdatePoint>>
  outcome: UpdateOutcome | null
  evidence?: "telt mee" | "te weinig data"
  measured_at?: string                // laatste meting (voor het weekrapport)
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Nulmeting: de 28 dagen vóór de aanpassing (niet de dag zelf)
export function baselineWindow(changedAt: string) {
  return { start: addDays(changedAt, -BASELINE_DAYS), end: addDays(changedAt, -1), days: BASELINE_DAYS }
}
// Meting na N dagen: de laatste (hooguit) 28 dagen tot en met dag N na de aanpassing
export function pointWindow(changedAt: string, days: UpdateMilestone) {
  const len = Math.min(days, BASELINE_DAYS)
  return { start: addDays(changedAt, days - len + 1), end: addDays(changedAt, days), days: len }
}

// Kerncijfers van een meting, omgerekend naar 28 dagen en gecorrigeerd voor de hele site
export function compare(base: UpdateSnapshot, p: UpdatePoint) {
  const scale = BASELINE_DAYS / p.window.days
  const g = p.growth && p.growth > 0 ? p.growth : 1
  const clicksAfter = (p.page.clicks * scale) / g
  const impAfter = (p.page.impressions * scale) / g
  const qImpAfter = (p.queries.impressions * scale) / g
  return {
    clicksBefore: base.page.clicks, clicksAfter: Math.round(clicksAfter * 10) / 10,
    impBefore: base.page.impressions, impAfter: Math.round(impAfter),
    qImpBefore: base.queries.impressions, qImpAfter: Math.round(qImpAfter),
    // Stond de pagina vóór de aanpassing niet in Google voor deze zoekwoorden, dan geldt positie 100 als start
    qPosBefore: base.queries.impressions > 0 ? base.queries.position : 100,
    qPosAfter: p.queries.impressions > 0 ? p.queries.position : 100,
    growth: p.growth,
    enough: base.page.impressions >= UPDATE_MIN_IMPRESSIONS || p.page.impressions * scale >= UPDATE_MIN_IMPRESSIONS,
  }
}

const nl1 = (n: number | null) => (n === null ? "—" : String(Math.round(n * 10) / 10).replace(".", ","))
const pctNl = (r: number) => `${r > 0 ? "+" : ""}${Math.round(r * 100)}%`

// Oordeel volgens vaste regels. Na 7 en 14 dagen voorlopig; na 28 dagen definitief, of na 56 dagen
// als er na 28 dagen te weinig data was.
export function judgeUpdate(m: Pick<UpdateMeasure, "baseline" | "points" | "queries">): { outcome: UpdateOutcome | null; final: boolean; at: UpdateMilestone | null; reasons: string[] } {
  const latestKey = ([56, 28, 14, 7] as const).find(d => m.points[`d${d}`])
  if (!m.baseline || !latestKey) return { outcome: null, final: false, at: null, reasons: [] }
  const p = m.points[`d${latestKey}`]!
  const c = compare(m.baseline, p)
  const reasons: string[] = []
  const hasQueries = m.queries.length > 0 && (c.qImpBefore > 0 || p.queries.impressions > 0)
  const posV = hasQueries && c.qPosBefore !== null && c.qPosAfter !== null ? positionVerdict(c.qPosBefore, c.qPosAfter) : null
  if (hasQueries) {
    reasons.push(c.qImpBefore > 0
      ? `Positie op de zoekwoorden van deze kans: ${nl1(c.qPosBefore)} → ${nl1(p.queries.impressions > 0 ? c.qPosAfter : null)}${posV === "succesvol" ? " (duidelijk beter)" : posV === "niet_succesvol" ? " (duidelijk slechter)" : ""}.`
      : `De pagina verscheen vóór de aanpassing niet in Google voor deze zoekwoorden; nu op positie ${nl1(c.qPosAfter)}.`)
  } else if (m.queries.length) reasons.push("De pagina verschijnt (nog) niet in Google voor de zoekwoorden van deze kans.")

  const clickDiff = c.clicksAfter - c.clicksBefore
  const up = c.clicksAfter >= c.clicksBefore * 1.2 && clickDiff >= 3
  const down = c.clicksAfter <= c.clicksBefore * 0.8 && -clickDiff >= 3
  const growthNote = c.growth && Math.abs(c.growth - 1) >= 0.05 ? `, gecorrigeerd voor de hele site (${pctNl(c.growth - 1)})` : ""
  reasons.push(`Klikken uit Google op de pagina: ${nl1(c.clicksBefore)} → ${nl1(c.clicksAfter)} per 28 dagen${growthNote}${c.clicksBefore > 0 ? ` (${pctNl(clickDiff / c.clicksBefore)})` : ""}.`)
  reasons.push(`Vertoningen: ${c.impBefore} → ${c.impAfter} per 28 dagen.`)

  const gb = m.baseline.ga4, ga = p.ga4
  if (gb && ga) {
    const leads = (g: Ga4Eval) => (g.measurement === "ok" ? g.requests || 0 : 0) + (g.contacts || 0)
    reasons.push(`Bezoek (GA4): ${gb.views} → ${ga.views}× bekeken; aanvragen via de pagina: ${leads(gb)} → ${leads(ga)}. Ter informatie: aanvragen zijn per pagina te schaars om op te beoordelen.`)
  }
  if (p.confounders.length) reasons.push(`Mogelijk ook van invloed: ${p.confounders.join("; ")}.`)

  let outcome: UpdateOutcome
  if (!c.enough) { outcome = "onduidelijk"; reasons.unshift(`Te weinig data: minder dan ${UPDATE_MIN_IMPRESSIONS} vertoningen per 28 dagen, dus geen betrouwbaar oordeel.`) }
  else if (posV === "succesvol" && !down) outcome = "succesvol"
  else if (up && posV !== "niet_succesvol") outcome = "succesvol"
  else if (posV === "niet_succesvol" && !up) outcome = "niet_succesvol"
  else if (down && posV !== "succesvol") outcome = "niet_succesvol"
  else outcome = "onduidelijk"
  return { outcome, final: latestKey === 56 || (latestKey === 28 && c.enough), at: latestKey, reasons }
}

export const UPDATE_RULE = `Geslaagd als de pagina op de zoekwoorden van deze kans duidelijk stijgt (${POSITION_RULE}) zonder minder klikken, of als de klikken uit Google minstens 20% (en minimaal 3) hoger liggen zonder dat de positie duidelijk zakt. Andersom is niet geslaagd; daartussen is geen duidelijk effect. Klikken worden gecorrigeerd voor groei of krimp van de hele site.`

export const OUTCOME_META: Record<UpdateOutcome, { label: string; tone: "success" | "error" | "neutral" }> = {
  succesvol: { label: "Geslaagd", tone: "success" },
  niet_succesvol: { label: "Niet geslaagd", tone: "error" },
  onduidelijk: { label: "Geen duidelijk effect", tone: "neutral" },
}

// Volgende meetmoment (voor de kaart op het bord)
// Verlengd tot 56 dagen: na 28 dagen te weinig data
export function updateNeeds56(m: Pick<UpdateMeasure, "points" | "baseline">) {
  const p = m.points.d28
  return !!p && !!m.baseline && !compare(m.baseline, p).enough
}
export function nextMilestone(m: Pick<UpdateMeasure, "points"> & { baseline?: UpdateMeasure["baseline"] }, changedAt: string) {
  if (m.points.d28 && !updateNeeds56({ points: m.points, baseline: m.baseline ?? null })) return null
  // Eerstvolgende meetpunt ná de laatste meting (een gemist tussenpunt wordt niet alsnog verwacht)
  const last = Math.max(0, ...UPDATE_MILESTONES.filter(x => m.points[`d${x}`]))
  const d = UPDATE_MILESTONES.find(x => x > last && !m.points[`d${x}`])
  return d ? { days: d, date: addDays(changedAt, d) } : null
}

export const isPageUpdate = (i: { advice?: string | null }) => i.advice === "bijwerken"

// De zoekwoorden waarop we meten: die van de kans, meest gezocht eerst (hooguit 10)
export function updateQueries(keywords: { query: string; impressions: number }[] | null | undefined) {
  return [...(keywords || [])].sort((a, b) => (b.impressions || 0) - (a.impressions || 0)).slice(0, 10).map(k => k.query.toLowerCase().trim()).filter(Boolean)
}

// Voor het route-geheugen per pagina (lib/routes.ts): een bijgewerkte pagina is een poging met de route "inhoud"
export function updateTry(i: { id: string; title: string; advice?: string | null; status: string; published_at?: string | null; evals?: { update?: UpdateMeasure | null } | null }): RouteTry | null {
  const u = i.evals?.update
  if (!isPageUpdate(i) || i.status !== "gepubliceerd" || !u) return null
  const j = judgeUpdate(u)
  const last = u.points.d56 || u.points.d28 || u.points.d14 || u.points.d7
  return {
    key: `content:${i.id}`, route: "inhoud", page: u.page, query: u.queries[0] || null, date: u.changed_at, outcome: u.outcome,
    summary: last && j.reasons.length ? j.reasons.find(r => r.startsWith("Positie") || r.startsWith("Klikken")) || null : null,
    confounders: last?.confounders || [],
    description: `Pagina bijgewerkt via contentkans "${i.title}"`,
  }
}
