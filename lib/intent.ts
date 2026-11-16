import type { Estimate, Intent, Signal } from "./types"
import type { CtrModel } from "./ctr"
import { capitalize, normalize } from "./format"

// ── Zoekintentie ─────────────────────────────────────────────────────────────
// Regelgebaseerd en uitlegbaar. Gijs werkt regionaal, dus een zoekwoord met een
// plaatsnaam is meestal iemand die een aanbieder in de buurt zoekt.

const INFO_WORDS = /\b(hoe|wat|waarom|wanneer|hoeveel|welke|scheelt|verschil|voordelen|nadelen|werkt|werking|info|uitleg|betekenis|zelf|tips|ervaringen|rendement|terugverdientijd|besparing|graden)\b/
const COMMERCIAL_WORDS = /(bedrijf|bedrijven|installateur|offerte|kosten|prijs|prijzen|laten|plaatsen|aanleggen|kopen|aanvragen|specialist|vakman|subsidie|aanbieder)/
const TOPIC_WORDS = /(isol|spouw|dakisol|vloerisol|glas|zonnepan|warmtepomp|vloerverwarm|energielabel|fundering|kozijn|schoorsteen|ventilatie|thuisbatterij|laadpaal|verduurzam)/
const PROVINCES = ["overijssel", "gelderland", "utrecht", "drenthe", "friesland", "groningen", "flevoland", "twente", "achterhoek", "veluwe", "salland"]

export const INTENT_META: Record<Intent, { label: string; weight: number; explain: string }> = {
  lokaal: { label: "Lokaal", weight: 1.3, explain: "zoekt een aanbieder in een plaats of regio: de groep die het vaakst klant wordt" },
  commercieel: { label: "Commercieel", weight: 1.15, explain: "wil een maatregel laten uitvoeren of vergelijkt aanbieders" },
  informatief: { label: "Informatief", weight: 0.7, explain: "zoekt uitleg; waardevol voor bereik, minder vaak direct een aanvraag" },
  merk: { label: "Merk", weight: 0.3, explain: "zoekt Gijs zelf; vindbaarheid op je naam is belangrijk, maar zelden een SEO-actie" },
}

export function regionSegments(pagePaths: string[]) {
  const set = new Set<string>(PROVINCES)
  for (const p of pagePaths) {
    if (!p.startsWith("/regio/")) continue
    for (const seg of p.split("/").filter(Boolean).slice(1)) {
      set.add(seg)
      for (const part of seg.split("-")) if (part.length > 3) set.add(part)
    }
  }
  return set
}

export function placeIn(query: string, regions: Set<string>) {
  const toks = normalize(query).split(" ")
  // langste match eerst (bv. "hof van twente" → "hof-van-twente")
  const joined = toks.join("-")
  for (const r of [...regions].sort((a, b) => b.length - a.length)) {
    if (r.includes("-") && joined.includes(r)) return r
  }
  return toks.find(t => regions.has(t)) || null
}

export function classifyQuery(query: string, regions: Set<string>, isBrand: boolean): Intent {
  if (isBrand) return "merk"
  const n = normalize(query)
  if (INFO_WORDS.test(n)) return "informatief"
  if (placeIn(query, regions)) return "lokaal"
  if (COMMERCIAL_WORDS.test(n)) return "commercieel"
  if (TOPIC_WORDS.test(n)) return n.split(" ").length <= 2 ? "commercieel" : "informatief"
  return "informatief"
}

export function classifyPage(path: string): Intent {
  if (path.startsWith("/regio/")) return "lokaal"
  if (/over-gijs|contact|team/.test(path)) return "merk"
  if (/blog|kennis|vraag|uitleg|nieuws/.test(path)) return "informatief"
  return "commercieel"
}

export function prettyPlace(seg: string) {
  return seg.split("-").map((p, i) => (["van", "de", "den", "aan", "op"].includes(p) && i > 0 ? p : capitalize(p))).join(" ")
}

// ── Controleerbare schatting ────────────────────────────────────────────────

export function estimateFor(s: Pick<Signal, "kind" | "metrics">, model: CtrModel): Estimate | undefined {
  const m = s.metrics
  const imp = m.impressions ?? 0
  const p = m.position
  if (!imp || !p) return undefined
  const src = (x: number) => model.sourceAt(x)

  if (s.kind === "ctr" || s.kind === "pagina") {
    const ctrTo = model.at(p)
    const ctrFrom = m.ctr ?? 0
    const gain = Math.max(0, imp * ctrTo - (m.clicks ?? imp * ctrFrom))
    return finish({ basis: "doorklik", impressions: imp, fromPosition: p, toPosition: p, ctrFrom, ctrTo, gain, source: src(p) })
  }
  let to: number
  let scenario: string
  switch (s.kind) {
    case "daler":
    case "trend-dalend":
      to = m.prevPosition ?? p; scenario = `terug naar de eerdere positie ${fmt(to)}`; break
    case "kans":
      to = p <= 10.5 ? 5 : 8; scenario = `van positie ${fmt(p)} naar ${to}`; break
    case "dubbel":
      to = Math.max(1, p - 5); scenario = `de hoofdpagina stijgt ±5 posities`; break
    default:
      to = Math.max(1, p - 3); scenario = `±3 posities verder stijgen`
  }
  const ctrFrom = model.at(p), ctrTo = model.at(to)
  const gain = Math.max(0, imp * (ctrTo - ctrFrom))
  return finish({ basis: "positie", impressions: imp, fromPosition: p, toPosition: to, ctrFrom, ctrTo, gain, source: src(to) === src(p) ? src(p) : "gemengd", scenario })
}

function fmt(n: number) { return n.toLocaleString("nl-NL", { maximumFractionDigits: 1 }) }

function finish(e: Omit<Estimate, "low" | "high" | "expectedClicks" | "noise">): Estimate {
  const expectedClicks = e.impressions * e.ctrTo
  const noise = Math.sqrt(Math.max(expectedClicks, 0.0001))
  return {
    ...e,
    low: e.gain >= 1 ? Math.max(1, Math.floor(e.gain * 0.6)) : 0,
    high: e.gain >= 1 ? Math.max(Math.floor(e.gain * 0.6) + 1, Math.ceil(e.gain * 1.3)) : Math.ceil(e.gain * 1.3 * 10) / 10,
    expectedClicks,
    noise,
  }
}

// ── Concrete taak in één zin ────────────────────────────────────────────────

export function actionFor(s: Pick<Signal, "kind" | "query" | "page" | "relatedPages">, intent: Intent, place: string | null): string {
  const q = s.query ? `"${s.query}"` : s.page || ""
  const P = place ? prettyPlace(place) : null
  if (intent === "merk" && s.query) return `Zoek zelf op ${q} en kijk wie er boven Gijs staat; meestal is er geen actie nodig`
  switch (s.kind) {
    case "kans":
      return P
        ? `Breng ${q} naar pagina 1: controleer of Google de pagina over ${P} toont en versterk die met interne links`
        : `Breng ${q} naar pagina 1: versterk de rankende pagina met een scherpere title en interne links`
    case "stijger":
    case "trend-stijgend":
      return P
        ? `Bouw verder op de stijging van ${q}: link vanaf verwante pagina's naar de pagina over ${P}`
        : `Bouw verder op de stijging van ${q}: controleer de rankende pagina en voeg interne links toe`
    case "daler":
    case "trend-dalend":
      return `Zoek uit waarom ${q} daalt: controleer welke pagina rankt en wat daar recent is veranderd`
    case "ctr":
      return `Herschrijf title en meta description voor ${q}, zodat meer zoekers doorklikken`
    case "pagina":
      return `Maak het zoekresultaat van ${s.page} aantrekkelijker: title en meta description sluiten niet aan`
    case "dubbel":
      return `Controleer of ${(s.relatedPages || []).join(" en ")} al naar één pagina verwijzen`
    case "analyse":
      return `Bekijk de diagnose van ${q} en beslis of er een taak van moet komen`
    case "techniek":
      return `Los de technische blokkade op${s.page ? ` op ${s.page}` : ""}`
  }
}
