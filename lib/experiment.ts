// Experimentmethode (pure functies, getest).
//
// Drie soorten:
// - Experiment: een aanpassing waarvan het resultaat onzeker is, met genoeg data om het te meten.
// - Validatie: controleren of een technische oplossing werkt (foutpagina's, indexering, meting).
// - Meting ("volgen"): veranderingen volgen zonder dat een zuiver experiment mogelijk is
//   (te weinig data, te jonge pagina, overlappende wijzigingen). Geeft nooit "geslaagd" of "niet geslaagd".
//
// Een experiment start pas als experiment na een geschiktheidscontrole. Verwante aanpassingen
// (zelfde beschrijving, zelfde dagen) vormen één experimentfamilie en tellen als één conclusie.

import { MAX_SPREAD, MIN_IMPRESSIONS, nextCheckpoint } from "./measureLogic"
export { MAX_SPREAD, MIN_IMPRESSIONS }

export type ExpKind = "experiment" | "validatie" | "meting"
export type Outcome = "succesvol" | "niet_succesvol" | "onduidelijk" | "onvoldoende_data" | "ongeldig" | "beinvloed" | "gevolgd"
export type Tone = "good" | "problem" | "info" | "attention"

export const KIND_META: Record<ExpKind, { label: string; plural: string; text: string }> = {
  experiment: { label: "Experiment", plural: "Experimenten", text: "Een aanpassing waarvan het resultaat onzeker is, met genoeg data om het effect te meten." },
  validatie: { label: "Validatie", plural: "Validaties", text: "Controleren of een technische oplossing werkt. Geen onzeker idee, dus geen experiment." },
  meting: { label: "Meting", plural: "Metingen", text: "Volgen wat er gebeurt, zonder oordeel: er is te weinig data of iets anders maakt een zuivere meting onmogelijk." },
}

export const OUTCOME_META: Record<Outcome, { label: string; tone: Tone; decisive: boolean; text: string }> = {
  succesvol: { label: "Geslaagd", tone: "good", decisive: true, text: "Het succescriterium is gehaald." },
  niet_succesvol: { label: "Niet geslaagd", tone: "problem", decisive: true, text: "Het resultaat is even ver of verder achteruitgegaan." },
  onduidelijk: { label: "Geen duidelijk effect", tone: "info", decisive: false, text: "Genoeg data, maar de verandering valt binnen de normale schommeling." },
  onvoldoende_data: { label: "Onvoldoende data", tone: "info", decisive: false, text: "Ook na verlengd meten (56 dagen) te weinig gegevens voor een betrouwbare conclusie. Dit betekent niet dat de wijziging niet werkte." },
  ongeldig: { label: "Meting ongeldig", tone: "attention", decisive: false, text: "De doelpagina geeft een fout of verwijst door; wat gemeten is, zegt niets over de aanpassing." },
  beinvloed: { label: "Beïnvloed", tone: "attention", decisive: false, text: "Tijdens de meting veranderde er nog iets aan dezelfde pagina of hetzelfde zoekwoord." },
  gevolgd: { label: "Gevolgd", tone: "info", decisive: false, text: "Meting zonder oordeel: dit was geen zuiver experiment." },
}

// Wat is het doel en welke ene meetwaarde beslist? Ligt vast bij de start (successMetric in de nulmeting).
export const GOALS: Record<string, { goal: string; metric: string }> = {
  position: { goal: "Hoger in Google", metric: "Gemiddelde positie op het zoekwoord" },
  ctr: { goal: "Meer klikken uit dezelfde vertoningen", metric: "Klikratio (CTR)" },
  conversie: { goal: "Meer aanvragen", metric: "Aanvragen per sessie (GA4)" },
  consolidatie: { goal: "Eén sterke pagina", metric: "Vertoningen van de hoofdpagina" },
  technisch: { goal: "Geen foutpagina's", metric: "URL's die nog een fout geven" },
  indexering: { goal: "In Google", metric: "Geïndexeerde pagina's" },
  controle: { goal: "Meting of instelling klopt", metric: "Probleem nog aanwezig" },
  geen: { goal: "Vastleggen", metric: "Geen" },
}
export const goalOf = (metric: string | undefined | null) => GOALS[metric || "position"] || GOALS.position

export const VALIDATION_METRICS = new Set(["technisch", "indexering", "controle"])
const SEARCH_METRICS = new Set(["position", "ctr", "consolidatie"])

export const MIN_PAGE_AGE = 56            // opbouwfase van een nieuwe pagina (lib/pages.ts)
export const FINAL_DAYS = 28                // eindmeting
export const EXTEND_DAYS = 56               // alleen bij verlenging (te weinig data, late verwerking, schommeling)

export type CheckState = "ok" | "fout" | "onbekend"
export interface Check { key: "data" | "leeftijd" | "doel" | "stabiel" | "een-wijziging" | "meetbaar"; label: string; state: CheckState; detail: string }
export interface Suitability { ok: boolean; checks: Check[]; summary: string }

export interface SuitabilityInput {
  metric: string
  query: string | null
  page: string | null
  impressions: number | null          // vertoningen in de 28 dagen vóór de aanpassing (van wat gemeten wordt)
  weeklyPositions: number[]           // gemiddelde positie per week van de nulmeting
  pageAgeDays: number | null
  pageHttp: number | null             // HTTP-status van de doelpagina
  pageRedirectsTo: string | null
  queryOnPage: boolean | null         // verscheen de doelpagina bij de nulmeting voor het zoekwoord?
  overlapping: string[]               // andere lopende aanpassingen op dezelfde pagina of hetzelfde zoekwoord
  conversionMeasured?: boolean | null // GA4-aanvraagmeting werkt
}

const nl = (n: number) => n.toLocaleString("nl-NL")
const FAILED: Record<Check["key"], string> = { data: "te weinig data", leeftijd: "pagina te jong", doel: "doelpagina klopt niet", stabiel: "onrustige nulmeting", "een-wijziging": "overlappende wijziging", meetbaar: "niet meetbaar" }

export function suitabilityOf(i: SuitabilityInput): Suitability {
  if (VALIDATION_METRICS.has(i.metric)) return { ok: true, checks: [], summary: "Validatie: geen geschiktheidscontrole nodig." }
  if (i.metric === "geen") return { ok: false, checks: [], summary: "Niets te meten." }
  const checks: Check[] = []
  const search = SEARCH_METRICS.has(i.metric)
  if (search) {
    const imp = i.impressions
    checks.push(imp === null
      ? { key: "data", label: "Genoeg data", state: "onbekend", detail: "Aantal vertoningen vóór de aanpassing onbekend." }
      : imp >= MIN_IMPRESSIONS
        ? { key: "data", label: "Genoeg data", state: "ok", detail: `${nl(imp)} vertoningen in de 28 dagen ervoor.` }
        : { key: "data", label: "Genoeg data", state: "fout", detail: `${nl(imp)} ${imp === 1 ? "vertoning" : "vertoningen"} in 28 dagen; minimaal ${MIN_IMPRESSIONS} nodig. Bij zo weinig vertoningen is een gemiddelde positie toeval.` })
  }
  if (i.page) {
    checks.push(i.pageAgeDays === null
      ? { key: "leeftijd", label: "Pagina oud genoeg", state: "fout", detail: "Google heeft de pagina nog nooit getoond; hij zit nog in de opbouwfase." }
      : i.pageAgeDays >= MIN_PAGE_AGE
        ? { key: "leeftijd", label: "Pagina oud genoeg", state: "ok", detail: `${i.pageAgeDays} dagen live.` }
        : { key: "leeftijd", label: "Pagina oud genoeg", state: "fout", detail: `Pas ${i.pageAgeDays} dagen live; een nieuwe pagina beweegt de eerste ${MIN_PAGE_AGE} dagen vanzelf.` })
    const broken = i.pageHttp !== null && i.pageHttp >= 400
    const moved = !!i.pageRedirectsTo && i.pageRedirectsTo !== i.page
    const wrongPage = search && i.query && i.queryOnPage === false
    checks.push(broken || moved
      ? { key: "doel", label: "Zoekwoord en doelpagina kloppen", state: "fout", detail: broken ? `De doelpagina geeft een ${i.pageHttp}.` : `De doelpagina verwijst door naar ${i.pageRedirectsTo}.` }
      : wrongPage
        ? { key: "doel", label: "Zoekwoord en doelpagina kloppen", state: "fout", detail: `De doelpagina verscheen bij de nulmeting niet voor "${i.query}"; een andere pagina rankt erop.` }
        : { key: "doel", label: "Zoekwoord en doelpagina kloppen", state: i.queryOnPage === null && search && i.query ? "onbekend" : "ok", detail: i.queryOnPage === null && search && i.query ? "Niet vastgesteld of de doelpagina voor dit zoekwoord verscheen." : "Doelpagina bestaat en hoort bij wat gemeten wordt." })
  }
  if (search) {
    const w = i.weeklyPositions.filter(x => Number.isFinite(x) && x > 0)
    const spread = w.length >= 2 ? Math.max(...w) - Math.min(...w) : null
    checks.push(spread === null
      ? { key: "stabiel", label: "Stabiele nulmeting", state: "onbekend", detail: "Te weinig weken met data om de schommeling te bepalen." }
      : spread <= MAX_SPREAD
        ? { key: "stabiel", label: "Stabiele nulmeting", state: "ok", detail: `Positie schommelde ${nl(Math.round(spread * 10) / 10)} plaatsen tussen de weken.` }
        : { key: "stabiel", label: "Stabiele nulmeting", state: "fout", detail: `Positie schommelde ${nl(Math.round(spread * 10) / 10)} plaatsen tussen de weken; een effect valt daar niet uit te halen.` })
  }
  checks.push(i.overlapping.length
    ? { key: "een-wijziging", label: "Eén herkenbare verandering", state: "fout", detail: `Er loopt al een andere aanpassing op dezelfde pagina of hetzelfde zoekwoord: ${i.overlapping.slice(0, 2).join("; ")}.` }
    : { key: "een-wijziging", label: "Eén herkenbare verandering", state: "ok", detail: "Geen andere lopende aanpassing op deze pagina of dit zoekwoord." })
  const measurable = search ? !!(i.query || i.page) : i.metric === "conversie" ? i.conversionMeasured !== false && !!i.page : true
  checks.push(measurable
    ? { key: "meetbaar", label: "Resultaat is meetbaar", state: i.metric === "conversie" && i.conversionMeasured == null ? "onbekend" : "ok", detail: i.metric === "conversie" ? (i.conversionMeasured == null ? "Niet vastgesteld of de aanvraagmeting in GA4 werkt." : "Aanvragen worden gemeten in GA4.") : "Zoekwoord of pagina is te volgen in Search Console." }
    : { key: "meetbaar", label: "Resultaat is meetbaar", state: "fout", detail: i.metric === "conversie" ? "De aanvraagmeting in GA4 werkt niet of er is geen pagina." : "Geen zoekwoord of pagina om te meten." })
  const failed = checks.filter(c => c.state === "fout")
  return {
    ok: failed.length === 0,
    checks,
    summary: failed.length ? `Geen zuiver experiment (${failed.map(c => FAILED[c.key]).join("; ")}). Wordt gevolgd zonder oordeel.` : "Geschikt als experiment.",
  }
}

export function kindOf(metric: string | null | undefined, s: Suitability | null): ExpKind {
  const m = metric || "position"
  if (VALIDATION_METRICS.has(m)) return "validatie"
  if (m === "geen") return "meting"
  return s && !s.ok ? "meting" : "experiment"
}

// ── Families ────────────────────────────────────────────────────────────────

export const normDesc = (d: string) => d.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()

// Hoort een nieuw experiment bij een bestaande familie? Zelfde (genormaliseerde) beschrijving van
// minstens 20 tekens, binnen 3 dagen gestart.
export function familyFor<T extends { id: string; description: string; changed_at: string; family_id?: string | null }>(desc: string, changedAt: string, existing: T[]): T | null {
  const n = normDesc(desc)
  if (n.length < 20) return null
  const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`).getTime()
  return existing.find(e => normDesc(e.description) === n && Math.abs(day(e.changed_at) - day(changedAt)) <= 3 * 86400000) || null
}

// Titel van een familie: het gedeelde begin van de taaktitels ("… – Hardenberg", "… – Nijkerk"),
// anders de beschrijving van de aanpassing
export function familyTitle(titles: string[], description: string): string {
  const heads = titles.map(t => t.split(" — ")[0].split(/\s[–-]\s/)[0].trim()).filter(Boolean)
  if (heads.length >= 2 && heads.every(h => h === heads[0])) return heads[0].replace(/^seo\s*\|\s*/i, "")
  return description.trim().split("\n")[0].slice(0, 120)
}

// Eén conclusie voor een familie: de uitkomst die het vaakst voorkomt onder de meetpunten met een
// echt oordeel; zonder oordeel de meest voorkomende overige uitkomst
export function familyOutcome(outcomes: (Outcome | null)[]): Outcome | null {
  const done = outcomes.filter((o): o is Outcome => !!o)
  if (!done.length || done.length < outcomes.length) return null
  const count = (list: Outcome[]) => [...list.reduce((m, o) => m.set(o, (m.get(o) || 0) + 1), new Map<Outcome, number>()).entries()].sort((a, b) => b[1] - a[1])
  const decisive = done.filter(o => o === "succesvol" || o === "niet_succesvol" || o === "onduidelijk")
  return (decisive.length ? count(decisive) : count(done))[0][0]
}

// ── Eindoordeel ─────────────────────────────────────────────────────────────

export interface FinalInput {
  kind: ExpKind
  day: number                     // bereikt meetmoment: 14, 28 of 56
  verdict: "succesvol" | "niet_succesvol" | "onduidelijk" | null   // volgens het succescriterium
  enoughData: boolean
  invalid: boolean
  influenced: boolean
  extend: boolean                 // op dag 28 verlengd tot 56
}
// null = nog geen oordeel (verder meten). Conclusie op dag 28; dag 56 alleen na verlenging.
export function finalOutcome(i: FinalInput): Outcome | null {
  if (i.kind === "validatie") return i.verdict
  if (i.kind === "meting") return i.day >= FINAL_DAYS ? "gevolgd" : null
  if (i.day < FINAL_DAYS) return null
  if (i.invalid) return "ongeldig"
  if (i.day < EXTEND_DAYS && i.extend) return null
  if (i.influenced) return "beinvloed"
  if (!i.enoughData) return "onvoldoende_data"
  return i.verdict
}

// Status van de taak na een eindoordeel
export function adviceStatusFor(o: Outcome): "succesvol" | "niet_succesvol" | "onvoldoende_bewijs" | null {
  if (o === "succesvol" || o === "niet_succesvol") return o
  if (o === "onduidelijk") return null
  return "onvoldoende_bewijs"
}

// Wanneer is de volgende meting? 7 (crawlcontrole), 14 (vroege indicatie), 28 (eindmeting), 56 alleen bij verlenging.
// Datum = de dag waarop gemeten wordt (Search Console loopt een paar dagen achter).
export function nextMeasurement(e: { changed_at: string; outcome: string | null; kind?: string | null; result_7d?: unknown; result_14d?: unknown; result_28d?: unknown; result_56d?: unknown; result_84d?: unknown }, today?: string): { days: number; date: string; label: string } | null {
  const n = nextCheckpoint(e as any, today)
  return n ? { days: n.day, date: n.date, label: n.label } : null
}

// ── Type wijziging (vastgelegd bij uitvoeren) ───────────────────────────────

export type ChangeType = "kenniskaart" | "tekst" | "interne-link" | "metadata" | "technisch"
export const CHANGE_TYPES: Record<ChangeType, string> = {
  kenniskaart: "Kenniskaart",
  tekst: "Tekst",
  "interne-link": "Interne link",
  metadata: "Metadata (title, description)",
  technisch: "Technische SEO",
}
// Voorstel uit de beschrijving; de gebruiker kan het aanpassen
export function inferChangeType(description: string, actionType?: string | null): ChangeType {
  const d = description.toLowerCase()
  if (/\bkaart(en)?\b|kenniskaart|blok met (een )?verwijzing/.test(d)) return "kenniskaart"
  if (/interne? link|linkt? naar|gelinkt|verwijzing|doorlink/.test(d)) return "interne-link"
  if (/\btitle\b|meta ?description|metadata|\bh1\b|snippet/.test(d) || actionType === "snippet") return "metadata"
  if (/redirect|doorverwijz|404|sitemap|canonical|noindex|index|schema|laadtijd|techni/.test(d) || actionType === "technisch" || actionType === "indexering" || actionType === "consolidatie") return "technisch"
  return "tekst"
}

// ── Opzet corrigeren ───────────────────────────────────────────────────────

// Kan alleen vóór het eerste meetpunt: daarna klopt de vergelijking met de nulmeting niet meer
export function canCorrect(e: { outcome?: unknown; result_7d?: unknown; result_14d?: unknown; result_28d?: unknown; result_56d?: unknown; result_84d?: unknown }) {
  return !e.outcome && !e.result_7d && !e.result_14d && !e.result_28d && !e.result_56d && !e.result_84d
}

// "Live op 20-11-2026" (of 20-11-26, 20/11/2026, 2026-11-20) in de omschrijving → ISO-datum
export function liveDateIn(text: string): string | null {
  const iso = text.match(/live (?:op|sinds|vanaf)\s+(\d{4})-(\d{2})-(\d{2})/i)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = text.match(/live (?:op|sinds|vanaf)\s+(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/i)
  if (!m) return null
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  const d = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  return isNaN(Date.parse(d)) ? null : d
}

export interface Correction { at: string; by?: string; from: { changed_at: string; description: string; changed_pages?: string[] | null; changeType?: string | null } }
export const correctionsOf = (e: { baseline?: Record<string, any> | null }): Correction[] => (Array.isArray(e.baseline?.correction) ? e.baseline!.correction : [])
