// Controle van de eigen tekst (uit de ingeleverde PDF of Word), zonder AI: vaste, uitlegbare regels.
// Het resultaat helpt bij de beoordeling en de kenmerken (lengte, leesbaarheid, zoekwoorden) worden na
// publicatie naast de resultaten gelegd, zodat het dashboard leert welke teksten goed werken.

import type { ContentIdea } from "./model"
import { staleYear } from "./freshness"

export interface TextStats {
  words: number; sentences: number; avgSentence: number; longWordPct: number
  headings: number; paragraphs: number; years: number[]; amounts: number
}
export interface TextCheck { key: string; ok: boolean | null; label: string; detail: string }
export interface TextFeatures { words: number; lengthBucket: "kort" | "middel" | "lang"; readable: boolean; kwIntro: boolean | null; kwCoverage: number | null; cta: boolean }
export interface TextAnalysis { stats: TextStats; checks: TextCheck[]; features: TextFeatures; firstLine: string; readable: boolean }

const STOP = new Set(["de", "het", "een", "en", "van", "voor", "in", "op", "met", "je", "jouw", "uw", "bij", "of", "te", "aan", "is", "wat", "hoe", "kosten", "prijs", "per", "naar", "om", "die", "dat", "ik", "mijn", "welke", "beste"])
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
const tokens = (q: string) => norm(q).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t))
const has = (text: string, term: string) => {
  const t = norm(term)
  // "warmtepomp" telt ook in "warmtepompen", "hybride" ook in "hybride-warmtepomp"
  return text.includes(t) || (t.length > 6 && text.includes(t.slice(0, -1)))
}

export const lengthBucket = (w: number): TextFeatures["lengthBucket"] => (w < 600 ? "kort" : w <= 1200 ? "middel" : "lang")

export function analyzeText(raw: string, idea: Pick<ContentIdea, "advice" | "regions" | "keywords" | "impact" | "title">, now = new Date()): TextAnalysis {
  const text = raw.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim()
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
  const flat = text.replace(/\s+/g, " ")
  const words = flat.split(" ").filter(w => /[a-zA-ZÀ-ÿ0-9]/.test(w))
  const sentences = flat.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"'“])/).filter(s => s.split(" ").length >= 3)
  const avgSentence = sentences.length ? Math.round((words.length / sentences.length) * 10) / 10 : 0
  const longWordPct = words.length ? Math.round((words.filter(w => w.replace(/[^a-zA-ZÀ-ÿ]/g, "").length >= 13).length / words.length) * 1000) / 10 : 0
  // Tussenkop: korte regel zonder slotpunt, met een hoofdletter, gevolgd door meer tekst
  const headings = lines.filter((l, i) => i > 0 && l.length >= 4 && l.length <= 80 && !/[.,;:]$/.test(l) && /^[A-ZÀ-Ý0-9]/.test(l) && l.split(" ").length <= 12).length
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().split(/\s+/).length >= 15).length || lines.filter(l => l.split(" ").length >= 15).length
  const years = [...new Set((flat.match(/\b20\d\d\b/g) || []).map(Number))].sort()
  const amounts = (flat.match(/€\s?\d[\d.,]*|\d[\d.,]*\s?euro\b/gi) || []).length
  const stats: TextStats = { words: words.length, sentences: sentences.length, avgSentence, longWordPct, headings, paragraphs, years, amounts }

  const low = norm(flat)
  const intro = norm(words.slice(0, 120).join(" "))
  const checks: TextCheck[] = []
  if (words.length < 120) {
    checks.push({ key: "leesbaar", ok: false, label: "Tekst gelezen", detail: "Er kon (bijna) geen tekst uit het bestand worden gehaald. Is het een gescande PDF of een afbeelding? Exporteer de tekst dan als PDF vanuit Word of Google Docs." })
    return { stats, checks, features: { words: words.length, lengthBucket: lengthBucket(words.length), readable: false, kwIntro: null, kwCoverage: null, cta: false }, firstLine: lines[0] || "", readable: false }
  }

  // Lengte
  const isUpdate = idea.advice === "bijwerken"
  const [lo, hi] = isUpdate ? [250, 1200] : [700, 1800]
  checks.push({ key: "lengte", ok: words.length >= lo && words.length <= hi, label: "Lengte",
    detail: `${words.length} woorden. Richtlijn voor ${isUpdate ? "een aanvulling op een bestaande pagina" : "een nieuw artikel"}: ${lo}–${hi}.${words.length < lo ? " Te kort om de vraag volledig te beantwoorden." : words.length > hi ? " Lang: overweeg in te korten of op te splitsen." : ""}` })

  // Leesbaarheid (B1): korte zinnen, weinig lange woorden
  const readable = avgSentence <= 18 && longWordPct <= 8
  checks.push({ key: "leesbaar-b1", ok: readable, label: "Leesbaarheid (B1)",
    detail: `Gemiddeld ${String(avgSentence).replace(".", ",")} woorden per zin (doel ≤ 18), ${String(longWordPct).replace(".", ",")}% lange woorden (doel ≤ 8%).${!readable ? " Maak lange zinnen korter en vervang vaktaal waar het kan." : ""}` })

  // Zoekwoorden: het belangrijkste vroeg in de tekst, en de rest gedekt
  const kws = [...(idea.keywords || [])].sort((a, b) => b.impressions - a.impressions)
  let kwIntro: boolean | null = null, kwCoverage: number | null = null
  if (kws.length) {
    const main = kws[0].query
    const mt = tokens(main)
    kwIntro = mt.length > 0 && mt.every(t => has(intro, t))
    checks.push({ key: "zoekwoord-intro", ok: kwIntro, label: "Hoofdzoekwoord in de inleiding",
      detail: kwIntro ? `"${main}" komt terug in de eerste alinea's.` : `"${main}" (${kws[0].impressions} vertoningen) staat niet in de eerste 120 woorden. Noem het onderwerp vroeg en in gewone woorden.` })
    const covered = kws.filter(k => { const t = tokens(k.query); return t.length > 0 && t.every(x => has(low, x)) })
    kwCoverage = Math.round((covered.length / kws.length) * 100)
    const missing = kws.filter(k => !covered.includes(k)).slice(0, 4).map(k => `"${k.query}"`)
    checks.push({ key: "zoekwoorden", ok: kwCoverage >= 60, label: "Zoekvragen beantwoord",
      detail: `${covered.length} van ${kws.length} zoekwoorden uit Search Console komen in de tekst voor (${kwCoverage}%).${missing.length ? ` Mist nog: ${missing.join(", ")}.` : ""}` })
  }

  // Structuur
  if (!isUpdate) checks.push({ key: "tussenkoppen", ok: headings >= 2, label: "Tussenkoppen",
    detail: headings >= 2 ? `${headings} tussenkoppen gevonden.` : "Geen of één tussenkop gevonden. Tussenkoppen helpen lezers en Google de tekst te scannen." })

  // Regio
  if (idea.regions?.length) {
    const miss = idea.regions.filter(r => !has(low, r))
    checks.push({ key: "regio", ok: miss.length === 0, label: "Regio genoemd",
      detail: miss.length ? `Niet genoemd: ${miss.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")}.` : `Noemt ${idea.regions.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")}.` })
  }

  // Call-to-action naar de energiescan
  const cta = /energiescan|woningscan|gratis (advies|adviesgesprek)|neem contact|plan (een|je|jouw)|vraag .* aan/i.test(flat)
  checks.push({ key: "cta", ok: cta, label: "Verwijzing naar de energiescan", detail: cta ? "De tekst verwijst naar een vervolgstap." : "Geen verwijzing naar de energiescan of een andere vervolgstap gevonden." })

  // Actualiteit: verouderde jaartallen en bedragen
  // Elke zin met een jaartal (niet alleen zinnen over bekende regelingen)
  const yearFacts = sentences.filter(x => /\b20\d\d\b/.test(x)).map(x => ({ topic: "", sentence: x.trim(), years: [...new Set((x.match(/\b20\d\d\b/g) || []).map(Number))], amounts: [] }))
  const stale = yearFacts.map(f => ({ f, why: staleYear(f, now) })).filter(x => x.why)
  if (stale.length) checks.push({ key: "actualiteit", ok: false, label: "Actualiteit", detail: `${stale.length} ${stale.length === 1 ? "zin" : "zinnen"} met een mogelijk verouderd jaartal, bijvoorbeeld: "${stale[0].f.sentence.slice(0, 140)}${stale[0].f.sentence.length > 140 ? "…" : ""}" (${stale[0].why}).` })
  if (amounts > 0) checks.push({ key: "bedragen", ok: null, label: "Bedragen", detail: `${amounts} ${amounts === 1 ? "bedrag" : "bedragen"} in de tekst. Controleer ze tegen de bron${idea.impact === "subsidie" || idea.impact === "kosten" ? "; bij subsidies en kosten is dit het belangrijkste punt van de controle" : ""}.` })

  return {
    stats, checks, firstLine: lines[0] || "", readable: true,
    features: { words: words.length, lengthBucket: lengthBucket(words.length), readable, kwIntro, kwCoverage, cta },
  }
}
