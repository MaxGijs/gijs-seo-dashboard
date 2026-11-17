// Bewaking van verouderde informatie op de site (pure functies).
// De nachtelijke scan leest de kernpagina's van groeninjestraat.nl (alleen lezen), haalt de zinnen
// over regels, bedragen en regelingen eruit, en vergelijkt die met recent nieuws over wijzigingen.
// Resultaat: een "controleer en werk bij"-kans in Mijn taken. Er wordt nooit iets aan de site veranderd.

import type { Impact, Reliability, SourceRef } from "./model"
import { nlDate, termsInText, topicKeywords, type Ctx, type Draft } from "./build"

export interface Topic { id: string; label: string; terms: string[] }
export const TOPICS: Topic[] = [
  { id: "isde", label: "de ISDE-subsidie", terms: ["isde", "investeringssubsidie duurzame energie"] },
  { id: "saldering", label: "de salderingsregeling", terms: ["salderingsregeling", "salderen", "saldering"] },
  { id: "teruglever", label: "terugleverkosten", terms: ["terugleverkosten", "terugleververgoeding", "teruglevertarief"] },
  { id: "warmtefonds", label: "het Warmtefonds", terms: ["warmtefonds", "energiebespaarlening"] },
  { id: "btw", label: "de btw-regels", terms: ["0% btw", "btw-tarief", "nultarief", "btw op zonnepanelen"] },
  { id: "energiebelasting", label: "de energiebelasting", terms: ["energiebelasting", "belastingvermindering"] },
  { id: "warmtepompnorm", label: "de warmtepompnorm", terms: ["hybride warmtepomp verplicht", "warmtepompnorm", "normering", "verplichte hybride"] },
  { id: "energielabel", label: "het energielabel", terms: ["energielabel", "label c-verplichting"] },
  { id: "stroomnet", label: "netcongestie", terms: ["netcongestie", "vol stroomnet", "stroomnet vol", "capaciteitstarief"] },
  { id: "energieprijs", label: "energieprijzen", terms: ["energieprijs", "gasprijs", "stroomprijs", "prijsplafond", "energietarief"] },
  { id: "gemeente", label: "gemeentelijke regelingen", terms: ["subsidie van de gemeente", "gemeentelijke subsidie", "duurzaamheidslening", "stimuleringslening"] },
]

export interface Fact { topic: string; sentence: string; years: number[]; amounts: string[] }
export interface PageFacts { path: string; title: string | null; template: string | null; facts: Fact[] }

const CLAIM = /(€|euro|\d+\s?%|procent|\b20\d\d\b|vanaf|tot en met|t\/m|per 1 |maximaal|minimaal|ontvang|krijg|vergoed|verplicht|verdwijnt|stopt|afgeschaft|geldt)/i

export function extractFacts(text: string): Fact[] {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9€])/)
  const out: Fact[] = []
  const seen = new Set<string>()
  for (const raw of sentences) {
    const s = raw.trim()
    if (s.length < 25 || s.length > 400) continue
    const low = s.toLowerCase()
    const topic = TOPICS.find(t => t.terms.some(term => low.includes(term)))
    // Elke bewering over een regeling telt (ook zonder bedrag: "je kunt ISDE-subsidie aanvragen");
    // vragen en losse verwijzingen ("Meer weten over de ISDE?") niet
    if (!topic || s.endsWith("?") || (!CLAIM.test(s) && !/\b(kun|kan|krijg|mag|moet|is|zijn|wordt|geldt)\b/i.test(s))) continue
    const key = `${topic.id}|${low.slice(0, 80)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      topic: topic.id, sentence: s,
      years: [...new Set((s.match(/\b20\d\d\b/g) || []).map(Number))],
      amounts: [...new Set(s.match(/€\s?[\d.,]+|\d+\s?%/g) || [])],
    })
    if (out.length >= 30) break
  }
  return out
}

// Jaartallen die in de toekomst bedoeld waren maar inmiddels voorbij zijn ("vanaf 2025", "tot 2026")
export function staleYear(f: Fact, now = new Date()): string | null {
  const y = now.getFullYear()
  const past = f.years.filter(v => v < y)
  if (!past.length) return null
  if (/(vanaf|per 1|in|tot|t\/m|tot en met|na|voor|vóór)\s+(1\s+\w+\s+)?20\d\d/i.test(f.sentence)) return `noemt ${past.join(" en ")} als toekomst of termijn`
  // Laatste weken van het jaar: regels die "tot en met dit jaar" lopen
  if (now.getMonth() >= 10 && f.years.includes(y) && /(tot|t\/m|tot en met|nog)\s+(\d+\s+\w+\s+)?20\d\d/i.test(f.sentence)) return `loopt af aan het eind van ${y}`
  return null
}

export interface NewsRef { url: string; title: string; summary: string | null; published_at: string; impact: Impact | null; source_id: string; publisher?: string | null; reliability: Reliability }

const UPDATE_IMPACT = new Set<Impact>(["regelgeving", "subsidie", "kosten", "net"])

export function freshnessDrafts(pages: PageFacts[], news: NewsRef[], ctx: Ctx, now = new Date()): Draft[] {
  const recent = news.filter(n => n.impact && UPDATE_IMPACT.has(n.impact))
  // Bevindingen bundelen: één taak per nieuwsbericht (met alle pagina's die het raakt),
  // en één taak per pagina voor verouderde jaartallen zonder nieuws.
  type Finding = { page: PageFacts; topic: Topic; sentence: string; why: string }
  const groups = new Map<string, { news: NewsRef | null; findings: Finding[] }>()
  for (const p of pages) {
    for (const f of p.facts) {
      const topic = TOPICS.find(t => t.id === f.topic)!
      const n = recent.filter(r => topic.terms.some(term => `${r.title} ${r.summary || ""}`.toLowerCase().includes(term)))
        .sort((a, b) => b.published_at.localeCompare(a.published_at))[0]
      const sy = staleYear(f, now)
      const key = n ? `nieuws:${n.url}` : sy ? `jaar:${p.path}` : null
      if (!key) continue
      const g = groups.get(key) || { news: n || null, findings: [] }
      g.findings.push({ page: p, topic, sentence: f.sentence, why: n ? `Nieuws van ${nlDate(n.published_at)}: "${n.title}".` : `De zin ${sy}.` })
      groups.set(key, g)
    }
  }
  const rank = (p: PageFacts) => (p.path.startsWith("/maatregelen/") ? 0 : p.path === "/" ? 1 : p.template ? 2 : 3)
  const drafts: Draft[] = []
  for (const [key, g] of groups) {
    const pagesHit = [...new Map(g.findings.map(f => [f.page.path, f.page])).values()].sort((a, b) => rank(a) - rank(b))
    const main = pagesHit[0]
    const topics = [...new Map(g.findings.map(f => [f.topic.id, f.topic])).values()]
    const label = topics.map(t => t.label).slice(0, 2).join(" en ")
    const name = (p: PageFacts) => p.title?.split("|")[0].trim() || p.path
    const where = pagesHit.length === 1 ? name(main) : `${pagesHit.length} pagina's`
    const title = `Controleer ${label} op ${where}`
    const perPage = pagesHit.map(p => {
      const q = g.findings.filter(f => f.page.path === p.path).slice(0, 2).map(f => `"${f.sentence.length > 160 ? f.sentence.slice(0, 157) + "…" : f.sentence}"`).join(" ")
      return `${p.path}${p.template ? ` (sjabloon: ${p.template})` : ""}: ${q}`
    }).join(" · ")
    const why = g.findings[0].why
    const n = g.news
    const sources: SourceRef[] = n
      ? [{ title: n.title, url: n.url, publisher: n.publisher || n.source_id, date: n.published_at, reliability: n.reliability }]
      : [{ title: `Eigen pagina ${main.path}`, url: `https://www.groeninjestraat.nl${main.path}`, publisher: "groeninjestraat.nl", date: now.toISOString(), reliability: "eigen-data" }]
    const text = g.findings.map(f => f.sentence).join(" ")
    drafts.push({
      fingerprint: `actueel:${key}:${topics.map(t => t.id).sort().join("+")}${n ? "" : `:${now.getFullYear()}`}`,
      origin: "actualiteit",
      subject: title,
      summary: `${why} Deze ${pagesHit.length === 1 ? "pagina noemt" : "pagina's noemen"} ${label}; controleer of de tekst nog klopt. ${perPage}`.slice(0, 600),
      whyNow: `${n ? `Er is nieuws over ${label}. ` : ""}Verouderde bedragen of regels kosten vertrouwen en kunnen tot verkeerde verwachtingen leiden. Controleer de zinnen bij de oorspronkelijke bron en pas ze aan als dat nodig is.`,
      service: null, impact: n?.impact || "regelgeving", regions: [],
      sources, ageDays: n ? Math.max(0, (now.getTime() - new Date(n.published_at).getTime()) / 86400000) : 0,
      reliability: n?.reliability || "eigen-data",
      keywords: topicKeywords(termsInText(text, ctx.services), ctx.queries),
      advice: "bijwerken", targetPage: main.path,
      adviceReason: `${why} Controleer ${pagesHit.length === 1 ? "deze pagina" : "deze pagina's"}: ${perPage}`,
      format: "Bestaande pagina bijwerken",
      titleOverride: [{ angle: "neutraal", title: title.length > 80 ? `${title.slice(0, 77)}…` : title }],
      urgency: n ? "hoog" : "middel",
    })
  }
  return drafts
}
