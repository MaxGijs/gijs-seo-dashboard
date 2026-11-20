// Doel, succesgrens en vergelijking per artikel (pure functies, getest).
//
// Absolute cijfers zeggen niet of een artikel geslaagd is. Daarom leggen we bij publicatie vast:
// het primaire doel, de ene meetwaarde die daarbij hoort, de verwachting en de minimale succesgrens.
// Het oordeel vergelijkt de meting met die grens en met vergelijkbare artikelen.
// En "nog niet" wordt gesplitst: meetdatum niet bereikt, nog niet binnen, niet gemeten, nul, te weinig data.

import type { ContentIdea, Eval } from "./model"

export type ContentGoal = "bereik" | "autoriteit" | "seo-groei" | "aanvragen"
export type Window = "d30" | "d90"

export const CONTENT_GOALS: Record<ContentGoal, { label: string; metric: string; unit: string; window: Window; text: string; fallback: number }> = {
  bereik: { label: "Bereik", metric: "Keer bekeken", unit: "keer bekeken", window: "d30", text: "Zoveel mogelijk mensen lezen het, ook als ze nu niets aanvragen (informatief nieuws).", fallback: 50 },
  autoriteit: { label: "Zichtbaarheid in Google", metric: "Vertoningen in Google", unit: "vertoningen", window: "d90", text: "Gijs wordt vaker getoond op het onderwerp; bouwt vertrouwen en posities op.", fallback: 300 },
  "seo-groei": { label: "SEO-groei", metric: "Klikken uit Google", unit: "klikken", window: "d90", text: "Bezoekers via Google op zoekwoorden waar al vraag naar is.", fallback: 10 },
  aanvragen: { label: "Aanvragen", metric: "Aanvragen via het artikel", unit: "aanvragen", window: "d90", text: "Lezers vragen een energiescan of contact aan (commercieel artikel).", fallback: 1 },
}

export interface SuccessPlan {
  goal: ContentGoal
  window: Window
  prediction: number | null
  threshold: number
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

const DAYS: Record<"d7" | "d30" | "d90", number> = { d7: 7, d30: 30, d90: 90 }
export function dueDate(publishedAt: string, key: "d7" | "d30" | "d90") {
  const d = new Date(`${publishedAt.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + DAYS[key] - 1 + 3)   // + 3 dagen vertraging van Search Console
  return d.toISOString().slice(0, 10)
}

// field: "gsc" (klikken, vertoningen), "position", "ga4" (bekeken, tijd, aanvragen), "ga4-extra" (scrollen, knop: aparte meting)
export function cellState(idea: Pick<ContentIdea, "published_at" | "evals">, key: "d7" | "d30" | "d90", field: "gsc" | "position" | "ga4" | "ga4-extra" | "requests", value: number | null | undefined, today = new Date().toISOString().slice(0, 10)): CellState {
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

// ── Oordeel volgens het plan ─────────────────────────────────────────────────

export interface PlanVerdict { label: "Geslaagd" | "Niet geslaagd" | "Nog te vroeg" | "Meetmethode ontbreekt"; tone: "success" | "error" | "neutral" | "warning"; reasons: string[] }

export function planVerdict(idea: IdeaLite & Pick<ContentIdea, "success_plan">, all: IdeaLite[], today = new Date().toISOString().slice(0, 10)): PlanVerdict | null {
  const p = idea.success_plan
  if (!p) return null
  const g = CONTENT_GOALS[p.goal]
  const e = idea.evals?.[p.window]
  const reasons: string[] = [`Doel: ${g.label.toLowerCase()}. Geslaagd bij minstens ${p.threshold} ${g.unit} na ${p.window.slice(1)} dagen${p.prediction !== null ? ` (verwacht: ${p.prediction})` : ""}.${p.afterwards ? " Achteraf vastgelegd." : ""}`]
  const comps = comparablesFor(idea, all).map(c => metricValue(c.evals?.[p.window], p.goal)).filter((v): v is number => v !== null)
  const med = comps.length ? median(comps) : null
  if (!e) {
    const due = idea.published_at ? dueDate(idea.published_at, p.window) : null
    return { label: "Nog te vroeg", tone: "neutral", reasons: [...reasons, due && due > today ? `Het oordeel volgt rond ${due}.` : "De meting is nog niet binnen; die komt met de nachtelijke meting."] }
  }
  const v = metricValue(e, p.goal)
  if (v === null || (p.goal === "aanvragen" && e.ga4?.measurement !== "ok" && !(e.ga4?.contacts))) {
    return { label: "Meetmethode ontbreekt", tone: "warning", reasons: [...reasons, p.goal === "aanvragen" ? "De meting van aanvragen in GA4 werkt nog niet goed; een nul zou hier niets zeggen." : "GA4 kon voor deze periode niet worden gelezen."] }
  }
  const ok = v >= p.threshold
  reasons.push(`Gemeten: ${v} ${g.unit}.`)
  if (med !== null) reasons.push(`Vergelijkbare artikelen (${comps.length}): mediaan ${Math.round(med)} ${g.unit}.`)
  else reasons.push("Nog geen vergelijkbare artikelen met een meting.")
  return { label: ok ? "Geslaagd" : "Niet geslaagd", tone: ok ? "success" : "error", reasons }
}
