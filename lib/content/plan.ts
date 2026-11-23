// Doel, succesgrens en vergelijking per artikel (pure functies, getest).
//
// Absolute cijfers zeggen niet of een artikel geslaagd is. Daarom leggen we bij publicatie vast:
// het primaire doel, de ene meetwaarde die daarbij hoort, de verwachting en de minimale succesgrens.
// Het oordeel vergelijkt de meting met die grens en met vergelijkbare artikelen.
// En "nog niet" wordt gesplitst: meetdatum niet bereikt, nog niet binnen, niet gemeten, nul, te weinig data.

import type { ContentIdea, Eval } from "./model"

export type ContentGoal = "bereik" | "autoriteit" | "seo-groei" | "aanvragen"
export type Window = "d28" | "d56"

// Meetmomenten van een nieuw artikel: 7 signalering, 14 eerste beoordeling, 28 eindoordeel (bereik,
// aanvragen), 56 voor SEO-groei en zichtbaarheid (een nieuw artikel heeft 6 à 8 weken nodig om zijn plek
// in Google te vinden) of als er na 28 dagen te weinig data is.
export const ARTICLE_POINTS = [7, 14, 28, 56] as const
export type ArticleKey = "d7" | "d14" | "d28" | "d56"
export const POINT_LABEL: Record<number, string> = { 7: "signalering", 14: "eerste beoordeling", 28: "eindoordeel", 56: "verlengde meting" }

export const CONTENT_GOALS: Record<ContentGoal, { label: string; metric: string; unit: string; window: Window; text: string; fallback: number }> = {
  bereik: { label: "Bereik", metric: "Keer bekeken", unit: "keer bekeken", window: "d28", text: "Zoveel mogelijk mensen lezen het, ook als ze nu niets aanvragen (informatief nieuws).", fallback: 50 },
  autoriteit: { label: "Zichtbaarheid in Google", metric: "Vertoningen in Google", unit: "vertoningen", window: "d56", text: "Gijs wordt vaker getoond op het onderwerp; bouwt vertrouwen en posities op.", fallback: 200 },
  "seo-groei": { label: "SEO-groei", metric: "Klikken uit Google", unit: "klikken", window: "d56", text: "Bezoekers via Google op zoekwoorden waar al vraag naar is.", fallback: 6 },
  aanvragen: { label: "Aanvragen", metric: "Aanvragen via het artikel", unit: "aanvragen", window: "d28", text: "Lezers vragen een energiescan of contact aan (commercieel artikel).", fallback: 1 },
}

export interface SuccessPlan {
  // window: d28 (bereik, aanvragen) of d56 (SEO-groei, zichtbaarheid). Plannen met een ander venster vallen terug op het standaardvenster van het doel.
  goal: ContentGoal
  window: Window
  prediction: number | null
  threshold: number | null     // optioneel: zonder grens wordt het artikel gevolgd, zonder geslaagd/niet geslaagd
  comparables: string[]        // ids van vergelijkbare artikelen bij het vastleggen
  setAt: string
  setBy?: string | null
  afterwards?: boolean         // achteraf vastgelegd (na publicatie)
}

// Een redelijk standaarddoel per herkomst
export function suggestGoal(i: Pick<ContentIdea, "origin">): ContentGoal {
  return i.origin === "actualiteit" || i.origin === "trend" ? "bereik" : i.origin === "zoekdata" || i.origin === "seizoen" ? "seo-groei" : "aanvragen"
}

export function metricValue(e: Eval | undefined | null, goal: ContentGoal): number | null {
  if (!e) return null
  if (goal === "autoriteit") return e.impressions
  if (goal === "seo-groei") return e.clicks
  if (!e.ga4) return null
  if (goal === "bereik") return e.ga4.views
  return (e.ga4.measurement === "ok" ? e.ga4.requests || 0 : 0) + (e.ga4.contacts || 0)
}

type IdeaLite = Pick<ContentIdea, "id" | "status" | "evals" | "service" | "origin" | "published_at"> & { advice?: ContentIdea["advice"] }

// Vergelijkbare artikelen: nieuw (geen bijgewerkte pagina), gepubliceerd, zelfde dienst of zelfde herkomst
export function comparablesFor(idea: IdeaLite, all: IdeaLite[]): IdeaLite[] {
  return all.filter(o => o.id !== idea.id && o.status === "gepubliceerd" && o.advice !== "bijwerken" && (o.service === idea.service || o.origin === idea.origin))
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }

// Voorstel voor de succesgrens: driekwart van wat vergelijkbare artikelen haalden (vanaf 2), anders een vaste ondergrens
export function suggestThreshold(goal: ContentGoal, comparables: IdeaLite[]): { threshold: number; basis: string } {
  const g = CONTENT_GOALS[goal]
  const vals = comparables.map(c => metricValue(c.evals?.[g.window], goal)).filter((v): v is number => v !== null)
  const m = vals.length >= 2 ? median(vals) : null
  if (m !== null && m > 0) return { threshold: Math.max(1, Math.round(m * 0.75)), basis: `driekwart van wat ${vals.length} vergelijkbare artikelen haalden (mediaan ${Math.round(m)})` }
  return { threshold: g.fallback, basis: vals.length ? "te weinig vergelijkbare artikelen; vaste ondergrens" : "nog geen vergelijkbare artikelen; vaste ondergrens" }
}

// ── Meetstatus per cel: wat betekent een lege of nul-waarde? ─────────────────

export type CellState = "ok" | "nul" | "nog-niet" | "niet-binnen" | "niet-gemeten" | "te-weinig"
export const CELL_TEXT: Record<Exclude<CellState, "ok" | "nul">, string> = {
  "nog-niet": "meetdatum nog niet bereikt",
  "niet-binnen": "nog niet binnen",
  "niet-gemeten": "niet gemeten",
  "te-weinig": "te weinig data",
}

const DAYS: Record<ArticleKey, number> = { d7: 7, d14: 14, d28: 28, d56: 56 }
export function dueDate(publishedAt: string, key: ArticleKey) {
  const d = new Date(`${publishedAt.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + DAYS[key] - 1 + 3)   // + 3 dagen vertraging van Search Console
  return d.toISOString().slice(0, 10)
}

// field: "gsc" (klikken, vertoningen), "position", "ga4" (bekeken, tijd, aanvragen), "ga4-extra" (scrollen, knop: aparte meting)
export function cellState(idea: Pick<ContentIdea, "published_at" | "evals">, key: ArticleKey, field: "gsc" | "position" | "ga4" | "ga4-extra" | "requests", value: number | null | undefined, today = new Date().toISOString().slice(0, 10)): CellState {
  const e = idea.evals?.[key]
  if (!e) return idea.published_at && dueDate(idea.published_at, key) > today ? "nog-niet" : "niet-binnen"
  if (field === "position") return e.impressions < 10 ? "te-weinig" : value === null || value === undefined ? "te-weinig" : "ok"
  if (field === "ga4" || field === "ga4-extra" || field === "requests") {
    if (!e.ga4) return "niet-gemeten"
    if (field === "requests" && e.ga4.measurement !== "ok") return "niet-gemeten"
    if (value === null || value === undefined) return "niet-gemeten"
  }
  return value === 0 ? "nul" : "ok"
}

// ── Schema van een artikel ──────────────────────────────────────────────────

type Sched = Pick<ContentIdea, "published_at" | "evals" | "origin"> & { success_plan?: SuccessPlan | null }
// Te weinig data na 28 dagen: minder dan 100 vertoningen én minder dan 50 keer bekeken
export const thin = (e: Eval | undefined | null) => !!e && e.impressions < 100 && (e.ga4?.views ?? 0) < 50
export const planWindowOf = (i: Sched): Window => {
  const p = i.success_plan
  if (p?.window === "d56" || p?.window === "d28") return p.window
  return CONTENT_GOALS[p?.goal && p.goal in CONTENT_GOALS ? p.goal : suggestGoal(i)].window
}
export const needs56 = (i: Sched) => planWindowOf(i) === "d56" || thin(i.evals?.d28)
// Klaar: dag 56 gemeten, of dag 28 als 56 niet nodig is
export const articleDone = (i: Sched) => !!i.evals?.d56 || (!!i.evals?.d28 && !needs56(i))
export function nextArticlePoint(i: Sched): { days: number; date: string; label: string } | null {
  if (!i.published_at || articleDone(i)) return null
  // Eerstvolgende meetpunt ná de laatste meting
  const last = Math.max(0, ...ARTICLE_POINTS.filter(n => i.evals?.[`d${n}` as ArticleKey]))
  const d = ARTICLE_POINTS.find(n => n > last && (n !== 56 || needs56(i)))
  return d ? { days: d, date: dueDate(i.published_at, `d${d}` as ArticleKey), label: POINT_LABEL[d] } : null
}
export const latestArticleKey = (i: Pick<ContentIdea, "evals">): ArticleKey | null => (["d56", "d28", "d14", "d7"] as ArticleKey[]).find(k => i.evals?.[k]) || null

// ── Oordeel volgens het plan ─────────────────────────────────────────────────

export interface PlanVerdict { label: "Geslaagd" | "Niet geslaagd" | "Nog te vroeg" | "Meetmethode ontbreekt" | "Gevolgd"; tone: "success" | "error" | "neutral" | "warning"; reasons: string[] }

export function planVerdict(idea: IdeaLite & Pick<ContentIdea, "success_plan">, all: IdeaLite[], today = new Date().toISOString().slice(0, 10)): PlanVerdict | null {
  const p = idea.success_plan
  if (!p) return null
  const g = CONTENT_GOALS[p.goal]
  // Na 28 dagen te weinig data: het oordeel schuift door naar 56 dagen
  const win = planWindowOf(idea as Sched)
  const extended = win === "d28" && thin(idea.evals?.d28)
  const key: Window = extended ? "d56" : win
  const e = idea.evals?.[key]
  const free = p.threshold === null || p.threshold === undefined
  const reasons: string[] = [free
    ? `Doel: ${g.label.toLowerCase()}, gemeten als ${g.metric.toLowerCase()} na ${key.slice(1)} dagen. Bewust zonder succesgrens: het artikel wordt gevolgd${p.prediction !== null ? ` (verwacht: ${p.prediction})` : ""}.`
    : `Doel: ${g.label.toLowerCase()}. Geslaagd bij minstens ${p.threshold} ${g.unit} na ${key.slice(1)} dagen${p.prediction !== null ? ` (verwacht: ${p.prediction})` : ""}.${p.afterwards ? " Achteraf vastgelegd." : ""}`]
  const comps = comparablesFor(idea, all).map(c => metricValue(c.evals?.[key], p.goal)).filter((v): v is number => v !== null)
  const med = comps.length ? median(comps) : null
  if (!e) {
    const due = idea.published_at ? dueDate(idea.published_at, key) : null
    return { label: "Nog te vroeg", tone: "neutral", reasons: [...reasons, ...(extended ? ["Na 28 dagen waren er te weinig vertoningen en bezoekers voor een betrouwbaar oordeel; de meting loopt door tot 56 dagen."] : []), due && due > today ? `Het oordeel volgt rond ${due}.` : "De meting is nog niet binnen; die komt met de nachtelijke meting."] }
  }
  const v = metricValue(e, p.goal)
  if (v === null || (p.goal === "aanvragen" && e.ga4?.measurement !== "ok" && !(e.ga4?.contacts))) {
    return { label: "Meetmethode ontbreekt", tone: "warning", reasons: [...reasons, p.goal === "aanvragen" ? "De meting van aanvragen in GA4 werkt nog niet goed; een nul zou hier niets zeggen." : "GA4 kon voor deze periode niet worden gelezen."] }
  }
  reasons.push(`Gemeten: ${v} ${g.unit}.`)
  if (med !== null) reasons.push(`Vergelijkbare artikelen (${comps.length}): mediaan ${Math.round(med)} ${g.unit}${free ? ` (dit artikel zit ${v > med * 1.2 ? "erboven" : v < med * 0.8 ? "eronder" : "rond het midden"})` : ""}.`)
  else reasons.push("Nog geen vergelijkbare artikelen met een meting.")
  if (free) {
    reasons.push("Zonder succesgrens geen geslaagd of niet geslaagd. Leg een grens vast zodra er genoeg verkeer is om te weten wat goed is.")
    return { label: "Gevolgd", tone: "neutral", reasons }
  }
  const ok = v >= p.threshold!
  return { label: ok ? "Geslaagd" : "Niet geslaagd", tone: ok ? "success" : "error", reasons }
}
