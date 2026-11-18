// Content Intelligence — gedeelde typen en regels (puur, zonder serveraanroepen).
//
// Het dashboard bepaalt met vaste, uitlegbare regels wanneer er een artikel nodig is:
// een actualiteit uit een betrouwbare bron, zoekvraag zonder goed antwoord op de site,
// of een seizoensmoment. Er wordt nooit iets gepubliceerd; een medewerker beslist.

export type Origin = "actualiteit" | "trend" | "zoekdata" | "seizoen" | "handmatig"
export type IdeaStatus =
  | "nieuw" | "geaccepteerd" | "briefing" | "concept" | "review" | "goedgekeurd" | "gepubliceerd"
  | "later" | "afgewezen" | "verlopen"
export type Impact = "regelgeving" | "subsidie" | "kosten" | "net" | "advies" | "overig"
export type Angle = "probleemgericht" | "negatief" | "positief" | "neutraal"
export type Advice = "nieuw" | "bijwerken" | "samenvoegen" | "niets"
export type Reliability = "overheid" | "voorlichting" | "vakmedia" | "nieuws" | "web" | "eigen-data" | "kalender" | "medewerker"
// Digitaal of fysiek hoort niet bij de beoordeling van een contentkans (operationele planning) en is bewust weggelaten.
export type CapacityMode = "actief" | "normaal" | "minder" | "niet-beschikbaar"

export interface SourceRef { title: string; url?: string; publisher: string; date?: string | null; reliability: Reliability; firstSeen?: boolean }
// Gemeten = rechtstreeks uit data (Search Console, publicatiedatum); afgeleid = door een regel bepaald uit
// gemeten data; aangenomen = vaste aanname tot er echte data is (bijvoorbeeld conversies).
export type Basis = "gemeten" | "afgeleid" | "aangenomen"
export interface ScorePart { label: string; points: number; max: number; why: string; basis?: Basis; value?: number }

// Versie van de regels waarmee voorstellen worden opgebouwd. Onaangeroerde voorstellen van een
// oudere versie worden bij de volgende scan opnieuw opgebouwd.
export const CONTENT_MODEL_VERSION = 2
export interface KeywordRef { query: string; impressions: number; clicks: number; position: number | null }
export interface Feedback { tag: string; note?: string; at: string; by?: string }
export interface Eval { impressions: number; clicks: number; ctr: number; position: number | null; measured_at: string; window: string }

export interface ContentIdea {
  id: string
  fingerprint: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  origin: Origin
  status: IdeaStatus
  title: string
  title_options: { angle: Angle; title: string }[]
  summary: string | null
  why_now: string | null
  audience: string | null
  service: string | null
  regions: string[]
  intent: string | null
  angle: Angle | null
  format: string | null
  advice: Advice | null
  advice_note: string | null
  target_page: string | null
  related_pages: string[]
  keywords: KeywordRef[]
  sources: SourceRef[]
  impact: Impact | null
  shelf_life: "actueel" | "evergreen" | null
  goal: string | null
  cta: string | null
  commercial_value: string | null
  reach_value: string | null
  risks: string[]
  score: number
  score_parts: ScorePart[]
  score_override: number | null
  priority: "hoog" | "middel" | "laag" | null
  briefing: string | null
  concept_original: string | null
  concept_original_at: string | null
  concept_final: string | null
  concept_change_pct: number | null
  review: Record<string, { by: string; at: string; ok: boolean; note?: string }>
  feedback: Feedback[]
  decision_note: string | null
  note?: string | null          // vrije notitie van een medewerker
  note_by?: string | null
  note_at?: string | null
  published_url: string | null
  published_at: string | null
  evals: Partial<Record<"d7" | "d30" | "d90", Eval>>
  owner?: string | null
  original: any
}

export const STATUS_META: Record<IdeaStatus, { label: string; step: number }> = {
  nieuw: { label: "Te beoordelen", step: 0 },
  geaccepteerd: { label: "Geaccepteerd", step: 1 },
  briefing: { label: "Briefing klaar", step: 2 },
  concept: { label: "Concept binnen", step: 3 },
  review: { label: "In review", step: 4 },
  goedgekeurd: { label: "Goedgekeurd", step: 5 },
  gepubliceerd: { label: "Gepubliceerd", step: 6 },
  later: { label: "Later opnieuw bekijken", step: -1 },
  afgewezen: { label: "Afgewezen", step: -1 },
  verlopen: { label: "Verlopen", step: -1 },
}

export const ORIGIN_META: Record<Origin, { label: string }> = {
  actualiteit: { label: "Actualiteit" },
  trend: { label: "Trend (web)" },
  zoekdata: { label: "Zoekvraag" },
  seizoen: { label: "Seizoen" },
  handmatig: { label: "Eigen idee" },
}

export const IMPACT_META: Record<Impact, { label: string; points: number }> = {
  regelgeving: { label: "Nieuwe of veranderende regels", points: 15 },
  subsidie: { label: "Subsidie of financiering", points: 15 },
  kosten: { label: "Energiekosten en tarieven", points: 12 },
  net: { label: "Stroomnet en aansluiting", points: 9 },
  advies: { label: "Praktisch advies", points: 6 },
  overig: { label: "Overig", points: 3 },
}

export const ANGLE_META: Record<Angle, { label: string }> = {
  probleemgericht: { label: "Probleemgericht" },
  negatief: { label: "Negatief" },
  positief: { label: "Positief" },
  neutraal: { label: "Neutraal" },
}

export const CAPACITY_META: Record<CapacityMode, { label: string; factor: number; hint: string }> = {
  actief: { label: "Actief promoten", factor: 1.15, hint: "Kansen voor deze dienst krijgen voorrang." },
  normaal: { label: "Normale capaciteit", factor: 1, hint: "Geen aanpassing." },
  minder: { label: "Tijdelijk minder promoten", factor: 0.7, hint: "Kansen zakken in de lijst." },
  "niet-beschikbaar": { label: "Dienst tijdelijk niet beschikbaar", factor: 0, hint: "Kansen voor deze dienst worden niet voorgesteld." },
}

export const FEEDBACK_TAGS = [
  "technisch onjuist", "onvoldoende onderbouwd", "te commercieel", "te negatief", "te algemeen",
  "goede invalshoek", "sterke regionale kans", "past niet bij Gijs", "verkeerde dienst gekoppeld",
  "call-to-action verbeteren", "later opnieuw beoordelen",
] as const

export const FORMATS = [
  "Actueel nieuwsartikel", "Uitgebreid kennisartikel", "Kort nieuwsbericht", "FAQ", "Stappenplan", "Vergelijking",
  "Checklist", "Update bestaande pagina", "Lokale landingspagina", "Socialmediabericht", "Nieuwsbrief", "Klantcase",
] as const

// Controles in de review. "Subsidie en actualiteit" en "techniek" zijn verplicht bij regels en subsidies.
export const REVIEW_ROLES = [
  { key: "marketing", label: "Marketingcontrole" },
  { key: "techniek", label: "Technische controle" },
  { key: "actualiteit", label: "Subsidies en actualiteit gecontroleerd" },
  { key: "eindredactie", label: "Eindredactie" },
  { key: "goedkeuring", label: "Definitieve goedkeuring" },
] as const

export function requiredReviews(idea: Pick<ContentIdea, "impact">): string[] {
  const base = ["marketing", "eindredactie", "goedkeuring"]
  if (idea.impact === "regelgeving" || idea.impact === "subsidie" || idea.impact === "kosten") base.splice(1, 0, "techniek", "actualiteit")
  return base
}

// ── Diensten ────────────────────────────────────────────────────────────────
// Het aanbod komt dynamisch uit de site (/maatregelen/*). Hier staan alleen de
// zoektermen die bij een dienst horen; een nieuwe maatregel op de site krijgt
// automatisch zijn eigen naam als zoekterm.

export const SERVICE_TERMS: Record<string, string[]> = {
  warmtepomp: ["warmtepomp", "hybride pomp", "lucht-water", "bodemwarmte", "all-electric"],
  zonnepanelen: ["zonnepane", "salderin", "terugleverkost", "terugleververgoeding", "zonne-energie", "omvormer"],
  thuisbatterij: ["thuisbatterij", "thuisaccu", "thuisopslag", "batterij thuis", "batterij in huis"],
  spouwmuurisolatie: ["spouwmuur", "spouwisolatie"],
  dakisolatie: ["dakisolatie", "dak isoleren", "zolder isoleren"],
  vloerisolatie: ["vloerisolatie", "bodemisolatie", "kruipruimte"],
  isolatieglas: ["isolatieglas", "glasisolatie", "glas isol", "isoleren met glas", "isolerende beglazing", "isolerende ramen", "hr++", "hr+++", "triple glas", "dubbel glas", "enkel glas", "enkelglas", "glas vervangen"],
  kozijnen: ["kozijn"],
  vloerverwarming: ["vloerverwarming"],
  ketel: ["cv-ketel", "gasketel", "hr-ketel", "ketel"],
}
// Onderwerpen die op verduurzamen in het algemeen gaan → energiescan als passende dienst
export const GENERAL_TERMS = [
  "verduurzam", "isolatie", "isoleren", "energielabel", "isde", "warmtefonds", "energierekening", "energiebelasting",
  "energieprijs", "energietarie", "stroomnet", "netcongestie", "netbeheer", "aansluiting verzwaren", "3-fase", "energiebesparing",
  "energie besparen", "aardgasvrij", "gasvrij", "gasprijs", "warmtenet", "energiearmoede",
]
export const SCAN_SERVICE = "energiescan"

// Niet voor particulieren: alleen relevant als er óók een huishoudwoord in staat
const BUSINESS = /\b(kantoor|kantoren|bedrijven|ondernemer|industrie|utiliteit|glastuinbouw|mkb|zakelijk|luchtvaart|kinderopvang)\b/i
const HOUSEHOLD = /(woning|huishoud|huiseigena|thuis|consument|particulier|huurder|bewoner|koophuis|eigen huis)/i

export function servicesIn(text: string, siteServices: string[]): string[] {
  const t = text.toLowerCase()
  const out: string[] = []
  for (const s of siteServices) {
    const terms = SERVICE_TERMS[s] || [s.replace(/-/g, " ")]
    if (terms.some(term => t.includes(term))) out.push(s)
  }
  if (!out.length && GENERAL_TERMS.some(term => t.includes(term))) out.push(SCAN_SERVICE)
  return out
}

// Gijs werkt voor woningeigenaren: berichten die alleen over huurders gaan tellen niet mee
const RENTERS = /(huurder|huurwoning|verhuurder|woningcorporatie|energieprestatievergoeding)/i
const OWNERS = /(huiseigena|woningeigena|woningbezitter|koopwoning|eigen woning|eigen huis)/i

export function isForHouseholds(text: string) {
  if (RENTERS.test(text) && !OWNERS.test(text)) return false
  return !BUSINESS.test(text) || HOUSEHOLD.test(text)
}

// Harde relevantiecontrole vóór er een kans van wordt gemaakt. Een dienst moet in de kop of de
// eerste zinnen staan (niet ergens terloops onderaan), een algemeen verduurzamingsthema in de kop.
// Gaat de kop over iets anders (zorgpremie, pensioen …), dan alleen door als er een dienst in de kop staat.
// Bij twijfel: archiveren, niet als kans tonen.
const OFFTOPIC = /(zorgpremie|zorgverzeker|zorgkosten|basisverzekering|ziekenhuis|pensioen|uitkering|kinderopvang|benzine|diesel|brandstofprijs|vliegtax|boodschappen|huurprijs|hypotheekrente|loonkosten|minimumloon)/i
export function relevanceOf(title: string, summary: string, siteServices: string[]): { relevant: boolean; services: string[]; reason: string } {
  const t = title.toLowerCase()
  const lead = `${title} ${(summary || "").slice(0, 300)}`.toLowerCase()
  const termsOf = (s: string) => SERVICE_TERMS[s] || [s.replace(/-/g, " ")]
  const inTitle = siteServices.filter(s => termsOf(s).some(term => t.includes(term)))
  const inLead = siteServices.filter(s => termsOf(s).some(term => lead.includes(term)))
  const generalTitle = GENERAL_TERMS.some(g => t.includes(g))
  const services = inLead.length ? inLead : generalTitle ? [SCAN_SERVICE] : []
  if (!services.length) return { relevant: false, services: [], reason: "Geen dienst van Gijs of verduurzamingsthema in de kop of de eerste zinnen." }
  if (OFFTOPIC.test(t) && !inTitle.length) return { relevant: false, services, reason: `Gaat in de kern over iets anders ("${(t.match(OFFTOPIC) || [""])[0]}"); verduurzaming wordt alleen terloops genoemd.` }
  if (!isForHouseholds(`${title} ${summary}`)) return { relevant: false, services, reason: "Niet gericht op particuliere woningeigenaren." }
  return { relevant: true, services, reason: inTitle.length ? "Dienst van Gijs in de kop." : inLead.length ? "Dienst van Gijs in de eerste zinnen." : "Verduurzamingsthema in de kop." }
}

export function impactOf(text: string): Impact {
  const t = text.toLowerCase()
  if (/(subsidie|isde|warmtefonds|lening|regeling .*open|financier)/.test(t)) return "subsidie"
  if (/(wet|wetsvoorstel|verplicht|norm\b|normering|standaard|raad van state|kabinet wil|vanaf 20\d\d|regels|verbod|eisen)/.test(t)) return "regelgeving"
  if (/(energierekening|tarie|prijs|kosten|energiebelasting|salderin|terugleverkost|vergoeding)/.test(t)) return "kosten"
  if (/(stroomnet|netcongestie|netbeheer|aansluiting|3-fase|wachtlijst)/.test(t)) return "net"
  if (/(tip|zo |hoe |wat |waarom|besparen|advies)/.test(t)) return "advies"
  return "overig"
}

export const PROVINCES: Record<string, string[]> = {
  overijssel: ["overijssel", "zwolle", "enschede", "deventer", "hengelo", "almelo", "kampen", "twente", "salland"],
  gelderland: ["gelderland", "arnhem", "nijmegen", "apeldoorn", "ede", "veluwe", "achterhoek", "oosterbeek", "zutphen"],
  utrecht: ["utrecht", "amersfoort", "veenendaal", "nieuwegein", "zeist"],
  flevoland: ["flevoland", "flevopolder", "almere", "lelystad", "dronten"],
}
export const LAUNCHED_PROVINCES = new Set(Object.keys(PROVINCES))

export function regionsIn(text: string): string[] {
  const t = text.toLowerCase()
  return Object.entries(PROVINCES).filter(([, words]) => words.some(w => new RegExp(`\\b${w}\\b`).test(t))).map(([p]) => p)
}

// ── Scoring ─────────────────────────────────────────────────────────────────
// 0–100, opgebouwd uit zes onderdelen. Elk onderdeel heeft een uitleg, zodat een
// medewerker ziet waarom iets bovenaan staat en het kan overrulen.

export const RELIABILITY_META: Record<Reliability, { label: string; points: number }> = {
  overheid: { label: "Overheid", points: 10 },
  voorlichting: { label: "Onafhankelijke voorlichting", points: 9 },
  "eigen-data": { label: "Eigen data (Search Console)", points: 10 },
  vakmedia: { label: "Vakmedia", points: 7 },
  nieuws: { label: "Nieuwsmedium", points: 7 },
  web: { label: "Webonderzoek (wekelijkse zoektaak)", points: 6 },
  kalender: { label: "Seizoenspatroon", points: 6 },
  medewerker: { label: "Medewerker", points: 8 },
}

// Aanname tot GA4-conversies beschikbaar zijn: hoofddiensten met een hoge orderwaarde scoren hoger
const COMMERCIAL: Record<string, [number, string]> = {
  energiescan: [10, "leidt direct naar de energiescan, het startpunt van elk traject"],
  warmtepomp: [9, "hoge orderwaarde"],
  zonnepanelen: [8, "veel vraag, hoge orderwaarde"],
  thuisbatterij: [8, "groeiende vraag, hoge orderwaarde"],
  spouwmuurisolatie: [8, "snel terugverdiend, vaak eerste stap"],
  dakisolatie: [8, "vaak eerste stap"],
  vloerisolatie: [7, "vaak gecombineerd met andere isolatie"],
  isolatieglas: [7, "veel zoekvraag"],
  kozijnen: [6, "middelgrote orderwaarde"],
  vloerverwarming: [5, "meestal onderdeel van een groter traject"],
  ketel: [4, "beperkte aansluiting op verduurzaming"],
}

export function commercialFor(service: string | null): [number, string] {
  if (!service) return [3, "geen dienst gekoppeld"]
  return COMMERCIAL[service] || [6, "dienst van Gijs"]
}

export interface ScoreInput {
  origin: Origin
  ageDays: number | null      // leeftijd van de aanleiding (nieuws), null = n.v.t.
  service: string | null
  impact: Impact
  demand: number              // vertoningen in 28 dagen op precies de zoekwoorden van dit voorstel
  keywordCount: number
  urgency?: "hoog" | "middel" | "laag" // alleen bij eigen ideeën: de urgentie die de medewerker aangeeft
  reliability: Reliability
  capacity: CapacityMode
  rejectedSimilar: number     // eerder afgewezen kansen voor dezelfde dienst en herkomst
}

export function scoreIdea(i: ScoreInput): { score: number; parts: ScorePart[]; factors: string[] } {
  const parts: ScorePart[] = []
  // 1. Actualiteit
  let act = 0, actWhy = ""
  if ((i.origin === "actualiteit" || i.origin === "trend") && i.ageDays !== null) {
    act = i.ageDays <= 7 ? 25 : i.ageDays <= 21 ? 20 : i.ageDays <= 45 ? 14 : i.ageDays <= 90 ? 8 : 3
    actWhy = `Aanleiding is ${Math.round(i.ageDays)} dagen oud${i.ageDays <= 7 ? ": nu publiceren heeft het meeste effect" : i.ageDays > 45 ? ": het nieuws is niet vers meer, wel nog bruikbaar als achtergrond" : ""}.`
  } else if (i.origin === "seizoen") { act = 14; actWhy = "Het seizoen begint nu; zoekvraag naar dit onderwerp stijgt in deze periode." }
  else if (i.origin === "zoekdata") { act = 10; actWhy = "Er wordt nu al op gezocht; geen nieuws, wel een vaste vraag." }
  else {
    act = i.urgency === "hoog" ? 22 : i.urgency === "laag" ? 6 : 12
    actWhy = `Aanleiding aangedragen door een medewerker${i.urgency ? ` met urgentie ${i.urgency}` : ""}.`
  }
  parts.push({ label: "Actualiteit", points: act, max: 25, why: actWhy, basis: (i.origin === "actualiteit" || i.origin === "trend") && i.ageDays !== null ? "gemeten" : i.origin === "zoekdata" ? "afgeleid" : "aangenomen" })

  // 2. Aansluiting op een dienst
  const fit = !i.service ? 0 : i.service === SCAN_SERVICE ? 13 : 20
  parts.push({ label: "Aansluiting op dienst", points: fit, max: 20, why: !i.service ? "Geen dienst van Gijs gevonden." : i.service === SCAN_SERVICE ? "Gaat over verduurzamen in het algemeen; past bij de energiescan." : `Past direct bij ${serviceLabel(i.service)}.`, basis: "afgeleid" })

  // 3. Zoekvraag
  const dem = Math.min(20, Math.round(5 * Math.log10(1 + i.demand)))
  parts.push({ label: "Zoekvraag", points: dem, max: 20, basis: "gemeten", value: i.demand,
    why: i.demand ? `${i.demand.toLocaleString("nl-NL")} vertoningen in 28 dagen op de ${i.keywordCount} zoekwoorden in de tabel hieronder.` : "Geen zoekwoorden in Search Console die precies over dit onderwerp gaan. Nieuw terrein: het bereik is onzeker." })

  // 4. Gevolgen voor huiseigenaren
  parts.push({ label: "Gevolgen voor huiseigenaren", points: IMPACT_META[i.impact].points, max: 15, why: IMPACT_META[i.impact].label + ".", basis: "afgeleid" })

  // 5. Commerciële waarde (aanname tot GA4-conversies er zijn)
  const [com, comWhy] = commercialFor(i.service)
  parts.push({ label: "Commerciële waarde", points: com, max: 10, why: `${comWhy[0].toUpperCase()}${comWhy.slice(1)} (aanname; wordt vervangen door GA4-conversies zodra die zijn ingesteld).`, basis: "aangenomen" })

  // 6. Betrouwbaarheid van de bron
  const rel = RELIABILITY_META[i.reliability]
  parts.push({ label: "Betrouwbaarheid bron", points: rel.points, max: 10, why: `${rel.label}.`, basis: "afgeleid" })

  let score = parts.reduce((s, p) => s + p.points, 0)
  const factors: string[] = []
  const cap = CAPACITY_META[i.capacity]
  if (cap.factor !== 1) { score *= cap.factor; factors.push(`Capaciteit: ${cap.label.toLowerCase()} (×${cap.factor.toLocaleString("nl-NL")})`) }
  if (i.rejectedSimilar > 0) {
    const f = Math.max(0.5, Math.pow(0.85, i.rejectedSimilar))
    score *= f
    factors.push(`${i.rejectedSimilar}× eerder afgewezen voor deze dienst (×${f.toFixed(2).replace(".", ",")})`)
  }
  return { score: Math.round(score), parts, factors }
}

export function effectiveScore(i: Pick<ContentIdea, "score" | "score_override">) {
  return i.score_override ?? i.score
}

export function priorityFor(score: number): "hoog" | "middel" | "laag" {
  return score >= 65 ? "hoog" : score >= 45 ? "middel" : "laag"
}

const NAMES: Record<string, string> = {
  energiescan: "verduurzamen in het algemeen (energiescan)", warmtepomp: "warmtepompen", zonnepanelen: "zonnepanelen", thuisbatterij: "thuisbatterijen",
  spouwmuurisolatie: "spouwmuurisolatie", dakisolatie: "dakisolatie", vloerisolatie: "vloerisolatie", isolatieglas: "isolatieglas",
  kozijnen: "kozijnen", vloerverwarming: "vloerverwarming", ketel: "de cv-ketel",
}
export function serviceLabel(s: string | null) {
  if (!s) return "geen dienst"
  return NAMES[s] || s.replace(/-/g, " ")
}
export function servicePage(s: string | null): string {
  if (!s || s === SCAN_SERVICE) return "/subsidiecheck"
  return `/maatregelen/${s}`
}

// ── Voorstel opbouwen ──────────────────────────────────────────────────────

export function titleOptions(subject: string, impact: Impact): { angle: Angle; title: string }[] {
  const s = subject.replace(/\s+/g, " ").trim().replace(/[.:]$/, "")
  const opts: { angle: Angle; title: string }[] = []
  switch (impact) {
    case "regelgeving":
      opts.push({ angle: "probleemgericht", title: `${s}: moet je nu iets doen?` })
      opts.push({ angle: "neutraal", title: `${s}: dit verandert er voor huiseigenaren` })
      opts.push({ angle: "positief", title: `${s}: zo maak je er slim gebruik van` })
      break
    case "subsidie":
      opts.push({ angle: "positief", title: `${s}: zoveel subsidie kun je krijgen` })
      opts.push({ angle: "probleemgericht", title: `${s}: mis je straks de subsidie?` })
      opts.push({ angle: "neutraal", title: `${s}: wat betekent dit voor jouw huis?` })
      break
    case "kosten":
      opts.push({ angle: "probleemgericht", title: `${s}: wat kost het jou?` })
      opts.push({ angle: "positief", title: `${s}: zo houd je je energierekening laag` })
      opts.push({ angle: "neutraal", title: `${s}: de gevolgen op een rij` })
      break
    case "net":
      opts.push({ angle: "probleemgericht", title: `${s}: kun je nog wel verduurzamen?` })
      opts.push({ angle: "positief", title: `${s}: verduurzamen kan toch, zo pak je het aan` })
      break
    default:
      opts.push({ angle: "neutraal", title: `${s}: wat betekent dit voor huiseigenaren?` })
      opts.push({ angle: "probleemgericht", title: `${s}: waar moet je op letten?` })
  }
  return opts
}

export function defaultAngle(impact: Impact): Angle {
  return impact === "subsidie" ? "positief" : impact === "advies" || impact === "overig" ? "neutraal" : "probleemgericht"
}

export function formatFor(origin: Origin, impact: Impact, ageDays: number | null): string {
  if (origin === "zoekdata") return "Uitgebreid kennisartikel"
  if (origin === "seizoen") return "Stappenplan"
  if (origin === "actualiteit" || origin === "trend") {
    if (ageDays !== null && ageDays <= 21 && (impact === "regelgeving" || impact === "subsidie" || impact === "kosten" || impact === "net")) return "Actueel nieuwsartikel"
    return "Uitgebreid kennisartikel"
  }
  return "Uitgebreid kennisartikel"
}

export function ctaFor(service: string | null, _capacity: CapacityMode, _regions: string[]): string {
  if (!service || service === SCAN_SERVICE) return "Doe de subsidiecheck of plan een energiescan"
  return `Laat in een energiescan uitzoeken of ${serviceLabel(service)} past bij jouw huis`
}

export function regionNote(regions: string[], _capacity: CapacityMode): string | null {
  if (!regions.length) return null
  const names = regions.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")
  return `Raakt ${names}. Noem de regio in de tekst en link naar de passende regiopagina.`
}

export function risksFor(impact: Impact, reliability: Reliability, firstSeen: boolean): string[] {
  const r: string[] = []
  if (impact === "subsidie") r.push("Bedragen, voorwaarden en looptijd van de subsidie vóór publicatie controleren bij de oorspronkelijke bron (RVO of gemeente), met datum.")
  if (impact === "regelgeving") r.push("Gaat het om een voorstel of een besluit? Een voorstel mag niet als vaststaand feit worden gepresenteerd.")
  if (impact === "kosten") r.push("Tarieven en prijzen veranderen; vermeld de peildatum en bron bij elk bedrag.")
  if (reliability === "web") r.push("Gevonden via webonderzoek: open de bron, controleer of die betrouwbaar is en zoek waar nodig de oorspronkelijke overheids- of fabrikantbron op.")
  if (reliability === "nieuws") r.push("Bron is een nieuwsmedium: zoek de oorspronkelijke bron (gemeente, provincie, netbeheerder, overheid) op en verwijs daarnaar.")
  if (reliability === "vakmedia") r.push("Bron is vakmedia: zoek de oorspronkelijke overheids- of fabrikantbron op.")
  if (firstSeen) r.push("De bron gaf geen publicatiedatum; de datum is het moment waarop het dashboard het bericht vond.")
  r.push("Een stevige kop mag, maar het artikel moet nuance en een praktische oplossing bieden.")
  return r
}

export function reliabilityOf(url: string): Reliability {
  const h = (() => { try { return new URL(url).hostname } catch { return "" } })()
  if (/(rijksoverheid|overheid|rvo|government|tweedekamer|provincie|gemeente|cbs|acm|netbeheernederland)\./.test(h) || /\.overheid\.nl$/.test(h)) return "overheid"
  if (/(milieucentraal|verbeterjehuis|consumentenbond|vereniging-eigen-huis|warmtefonds)\./.test(h)) return "voorlichting"
  return "web"
}

// Hoeveel van het concept heeft de redactie veranderd? (woordniveau, 0–100)
export function changePct(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\s+/).filter(Boolean), wb = b.toLowerCase().split(/\s+/).filter(Boolean)
  if (!wa.length) return wb.length ? 100 : 0
  const count = new Map<string, number>()
  wa.forEach(w => count.set(w, (count.get(w) || 0) + 1))
  let same = 0
  wb.forEach(w => { const c = count.get(w) || 0; if (c > 0) { same++; count.set(w, c - 1) } })
  return Math.round(100 * (1 - same / Math.max(wa.length, wb.length)))
}

export function tokens(s: string) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9à-ü\s-]/g, " ").split(/\s+/).filter(w => w.length > 3))
}
export function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0
  a.forEach(w => { if (b.has(w)) inter++ })
  return inter / Math.max(1, a.size + b.size - inter)
}


// ── Controle op consistentie ───────────────────────────────────────────────
// Een voorstel mag alleen getoond worden als samenvatting, score en zoekwoordtabel dezelfde cijfers gebruiken.
export function consistencyIssues(i: Pick<ContentIdea, "score" | "score_parts" | "keywords" | "original" | "title">): string[] {
  const issues: string[] = []
  const kwTotal = (i.keywords || []).reduce((s, k) => s + (k.impressions || 0), 0)
  const demand = (i.score_parts || []).find(p => p.label === "Zoekvraag")
  if (!demand || demand.value === undefined) issues.push("Dit voorstel is gemaakt met een oudere rekenregel: de zoekvraag in de score is niet terug te voeren op de zoekwoordtabel. Het wordt bij de volgende scan opnieuw opgebouwd.")
  else if (demand.value !== kwTotal) issues.push(`De zoekvraag in de score (${demand.value.toLocaleString("nl-NL")} vertoningen) wijkt af van de zoekwoordtabel (${kwTotal.toLocaleString("nl-NL")}).`)
  const sum = (i.score_parts || []).reduce((s, p) => s + p.points, 0)
  if (i.score > sum) issues.push(`De score (${i.score}) is hoger dan de som van de onderdelen (${sum}).`)
  if ((i.title || "").length > TITLE_MAX + 15) issues.push("De werktitel is te lang.")
  return issues
}

export const TITLE_MAX = 80
