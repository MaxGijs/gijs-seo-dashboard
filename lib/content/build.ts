// Content Intelligence — voorstellen opbouwen uit een aanleiding (puur, zonder netwerk of database).

import type { Item } from "./parse"
import {
  type Angle, type CapacityMode, type ContentIdea, type Impact, type KeywordRef, type Origin, type Reliability, type SourceRef,
  commercialFor, ctaFor, defaultAngle, formatFor, GENERAL_TERMS, priorityFor, regionNote, regionsIn, risksFor, SCAN_SERVICE,
  scoreIdea, SERVICE_TERMS, serviceLabel, servicePage, titleOptions,
} from "./model"

export const dayMs = 86400000
export const ageOf = (iso: string | null | undefined) => (iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / dayMs) : null)
export const nlDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : "onbekende datum")
export function termsFor(service: string) {
  return service === SCAN_SERVICE ? GENERAL_TERMS : SERVICE_TERMS[service] || [service.replace(/-/g, " ")]
}
export function demandFor(service: string | null, queries: KeywordRef[]) {
  if (!service) return { demand: 0, keywords: [] as KeywordRef[] }
  const terms = termsFor(service)
  const match = queries.filter(q => terms.some(t => q.query.includes(t)))
  return { demand: match.reduce((s, q) => s + q.impressions, 0), keywords: match.sort((a, b) => b.impressions - a.impressions).slice(0, 8) }
}

// ── Voorstel opbouwen ───────────────────────────────────────────────────────

export interface Draft {
  fingerprint: string
  origin: Origin
  subject: string
  summary: string
  whyNow: string
  service: string | null
  impact: Impact
  regions: string[]
  sources: SourceRef[]
  ageDays: number | null
  reliability: Reliability
  advice?: "nieuw" | "bijwerken"
  format?: string
  titleOverride?: { angle: Angle; title: string }[]
  keywordsOverride?: KeywordRef[]
}

export interface Ctx {
  services: string[]
  hasArticles: boolean
  queries: KeywordRef[]
  capacity: Map<string, CapacityMode>
  existing: Pick<ContentIdea, "id" | "fingerprint" | "origin" | "status" | "service" | "sources" | "created_at" | "title">[]
}

function rejectedCount(ctx: Ctx, service: string | null, origin: Origin) {
  return ctx.existing.filter(e => e.status === "afgewezen" && e.service === service && e.origin === origin).length
}

export function buildIdea(d: Draft, ctx: Ctx) {
  const capacity = (d.service && ctx.capacity.get(d.service)) || "normaal"
  const { demand, keywords } = demandFor(d.service, ctx.queries)
  const kw = d.keywordsOverride || keywords
  const scored = scoreIdea({ origin: d.origin, ageDays: d.ageDays, service: d.service, impact: d.impact, demand, reliability: d.reliability, capacity, rejectedSimilar: rejectedCount(ctx, d.service, d.origin) })
  const format = d.format || formatFor(d.origin, d.impact, d.ageDays)
  const page = servicePage(d.service)
  const pageExists = d.service && d.service !== SCAN_SERVICE ? ctx.services.includes(d.service) : true
  const options = d.titleOverride || titleOptions(d.subject, d.impact)
  const angle = options.find(o => o.angle === defaultAngle(d.impact))?.angle || options[0].angle
  const advice = d.advice || "nieuw"
  const notes: string[] = []
  if (advice === "nieuw") notes.push(d.service === SCAN_SERVICE ? "Schrijf een nieuw artikel en verwijs naar de subsidiecheck en de energiescan."
    : pageExists ? `Schrijf een nieuw artikel en controleer of ${page} nog klopt met deze informatie; link vanuit het artikel naar die pagina.` : "Schrijf een nieuw artikel.")
  else notes.push(`Werk ${page} bij in plaats van een losse pagina te maken: daar staat Gijs al voor dit onderwerp.`)
  if (advice === "nieuw" && !ctx.hasArticles) notes.push("De site heeft nog geen blog- of nieuwssectie. Vraag de websitebouwer daar een plek voor te maken (bijvoorbeeld /kennis/… of /nieuws/…).")
  const rn = regionNote(d.regions, capacity)
  if (rn) notes.push(rn)
  const [com, comWhy] = commercialFor(d.service)

  const row = {
    fingerprint: d.fingerprint,
    origin: d.origin,
    status: capacity === "niet-beschikbaar" ? "later" : "nieuw",
    title: options.find(o => o.angle === angle)!.title,
    title_options: options,
    summary: d.summary.slice(0, 600),
    why_now: d.whyNow,
    audience: `Particuliere woningeigenaren${d.service && d.service !== SCAN_SERVICE ? ` die nadenken over ${serviceLabel(d.service)}` : " die willen verduurzamen"}${d.regions.length ? ` in ${d.regions.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")}` : ""}`,
    service: d.service,
    regions: d.regions,
    intent: d.origin === "actualiteit" ? "Informatief (actueel)" : d.origin === "seizoen" ? "Oriënterend" : "Informatief",
    angle,
    format,
    advice,
    advice_note: notes.join(" "),
    target_page: pageExists ? page : null,
    related_pages: [...new Set([pageExists ? page : null, "/kennis", "/subsidiecheck"].filter(Boolean) as string[])],
    keywords: kw,
    sources: d.sources,
    impact: d.impact,
    shelf_life: format === "Actueel nieuwsartikel" || format === "Kort nieuwsbericht" ? "actueel" : "evergreen",
    goal: format === "Actueel nieuwsartikel"
      ? "Als eerste een betrouwbare, begrijpelijke uitleg bieden (bereik en autoriteit) en lezers doorleiden naar de energiescan."
      : "Organisch verkeer op informatieve zoekvragen binnenhalen en lezers doorleiden naar de passende dienst.",
    cta: ctaFor(d.service, capacity, d.regions),
    commercial_value: `${com >= 8 ? "Hoog" : com >= 6 ? "Middel" : "Laag"}: ${comWhy}`,
    reach_value: demand >= 500 || d.impact === "regelgeving" || d.impact === "subsidie" ? "Hoog" : demand >= 50 ? "Middel" : "Laag",
    risks: risksFor(d.impact, d.reliability, d.sources.some(s => s.firstSeen)),
    score: scored.score,
    score_parts: [...scored.parts, ...scored.factors.map(f => ({ label: "Correctie", points: 0, max: 0, why: f }))],
    priority: priorityFor(scored.score),
  }
  return { ...row, original: { ...row } }
}

// ── Kansen uit actualiteiten ────────────────────────────────────────────────

export function newsDraft(i: Item & { services: string[]; impact: Impact; regions: string[]; reason?: string | null }, src: { publisher: string; reliability: Reliability }, origin: "actualiteit" | "trend" = "actualiteit"): Draft {
  const ref: SourceRef = { title: i.title, url: i.url, publisher: src.publisher, date: i.published, reliability: src.reliability, firstSeen: i.firstSeen }
  const service = i.services.find(s => s !== SCAN_SERVICE) || i.services[0] || null
  return {
    fingerprint: `nieuws:${i.url}`,
    origin,
    subject: i.title,
    summary: i.summary,
    whyNow: `${origin === "trend" && i.reason ? `${i.reason} ` : ""}${src.publisher} publiceerde op ${nlDate(i.published)}: "${i.title}". ${i.impact === "regelgeving" ? "Nieuwe of veranderende regels roepen vragen op bij huiseigenaren; wie nu een heldere uitleg geeft, wordt gevonden." : i.impact === "subsidie" ? "Subsidienieuws leidt direct tot zoekvragen en aanvragen." : i.impact === "kosten" ? "Veranderende kosten zijn een directe aanleiding om te verduurzamen." : i.impact === "net" ? "Problemen met het stroomnet raken direct de keuze voor warmtepomp, zonnepanelen en batterij." : "Actuele aanleiding om het onderwerp uit te leggen."}`,
    service, impact: i.impact, regions: i.regions,
    sources: [ref], ageDays: ageOf(i.published), reliability: src.reliability,
  }
}

// ── Kansen uit zoekdata ─────────────────────────────────────────────────────

const INFO = /(^|\s)(wat|hoe|waarom|wanneer|welke|welk|hoeveel|is|kan|moet|zijn|beste|heb)\s|kosten|prijs|subsidie|terugverdien|rendabel|bespar|scheelt|nadelen|voordelen|ervaring|verschil|\bvs\b|vergelijk|nodig|zelf|vergunning|verplicht|alternatief|betekenis/
// Werktitels voor een zoekvraag; de schrijver maakt er definitieve titels van
function searchTitles(q: string): { angle: Angle; title: string }[] {
  const cap = q[0].toUpperCase() + q.slice(1)
  const question = /^(wat|hoe|waarom|wanneer|welke|welk|hoeveel|is|kan|moet|zijn|heb)\b/.test(q)
  return [
    { angle: "neutraal", title: question ? `${cap}?` : `${cap}: wat moet je weten?` },
    { angle: "probleemgericht", title: `${cap}: waar gaat het vaak mis?` },
    { angle: "positief", title: `${cap}: zo haal je er het meeste uit` },
  ]
}

export function searchDrafts(ctx: Ctx): Draft[] {
  const month = new Date().toISOString().slice(0, 7)
  const drafts: Draft[] = []
  for (const service of [...ctx.services, SCAN_SERVICE]) {
    const terms = termsFor(service)
    // Vragen die al bij een specifieke dienst horen, tellen niet nog eens mee voor de energiescan
    const specific = (q: string) => ctx.services.some(s => (SERVICE_TERMS[s] || [s]).some(t => q.includes(t)))
    const qs = ctx.queries.filter(q => terms.some(t => q.query.includes(t)) && INFO.test(q.query) && (service !== SCAN_SERVICE || !specific(q.query)) && !/gijs|groen in je straat|groeninjestraat/.test(q.query))
      .filter(q => q.impressions >= 15 && (q.position === null || q.position > 7 || q.clicks === 0))
      .sort((a, b) => b.impressions - a.impressions)
    if (!qs.length) continue
    const top = qs[0]
    const imp = qs.reduce((s, q) => s + q.impressions, 0)
    const avgPos = qs.reduce((s, q) => s + (q.position || 0) * q.impressions, 0) / Math.max(1, imp)
    const ranks = avgPos > 0 && avgPos <= 20
    const name = serviceLabel(service)
    drafts.push({
      fingerprint: `zoek:${service}:${month}`,
      origin: "zoekdata",
      subject: top.query,
      summary: `${qs.length} informatieve zoekvragen over ${name}, samen ${imp.toLocaleString("nl-NL")} vertoningen in 28 dagen. Belangrijkste: ${qs.slice(0, 4).map(q => `"${q.query}"`).join(", ")}.`,
      whyNow: `Mensen zoeken nu al naar antwoorden over ${name} (${imp.toLocaleString("nl-NL")} vertoningen in 28 dagen), maar Gijs staat gemiddeld op positie ${avgPos.toFixed(1).replace(".", ",")} en krijgt ${qs.reduce((s, q) => s + q.clicks, 0)} klikken. Er is vraag zonder goed antwoord op de site.`,
      service, impact: /subsidie/.test(top.query) ? "subsidie" : /kosten|prijs|terugverdien|rendabel/.test(top.query) ? "kosten" : "advies",
      regions: regionsIn(qs.map(q => q.query).join(" ")),
      sources: [{ title: `Search Console: ${qs.length} zoekvragen over ${name}`, publisher: "Google Search Console", date: new Date().toISOString(), reliability: "eigen-data" }],
      ageDays: null, reliability: "eigen-data",
      advice: ranks && service !== SCAN_SERVICE ? "bijwerken" : "nieuw",
      format: ranks && service !== SCAN_SERVICE ? "Update bestaande pagina" : "Uitgebreid kennisartikel",
      titleOverride: searchTitles(top.query),
      keywordsOverride: qs.slice(0, 10),
    })
  }
  return drafts
}

// ── Seizoenskalender ────────────────────────────────────────────────────────
// Alleen het moment, geen feiten: bedragen en regels komen uit de briefing-bronnen.

const SEASONS: { key: string; months: number[]; service: string; subject: string; why: string; impact: Impact; titles: { angle: Angle; title: string }[] }[] = [
  { key: "koud-huis", months: [9, 10, 11, 0], service: "spouwmuurisolatie", impact: "kosten", subject: "Koud huis in de winter",
    why: "De stookperiode begint. Huiseigenaren merken tocht, koude muren en een hoge rekening, en zoeken nu naar oplossingen.",
    titles: [{ angle: "probleemgericht", title: "Waarom blijft je huis koud ondanks een hoge energierekening?" }, { angle: "positief", title: "Deze winter warmer wonen: de isolatiemaatregelen die het meeste opleveren" }, { angle: "neutraal", title: "Isoleren voor de winter: waar begin je?" }] },
  { key: "vocht-schimmel", months: [10, 11, 0, 1], service: "vloerisolatie", impact: "advies", subject: "Vocht en schimmel na isoleren",
    why: "In de natte wintermaanden zoeken mensen naar vocht- en schimmelproblemen, vaak na of rond isolatiewerk.",
    titles: [{ angle: "probleemgericht", title: "Deze isolatiefouten veroorzaken vocht en schimmel" }, { angle: "neutraal", title: "Isoleren zonder vochtproblemen: zo doe je het goed" }] },
  { key: "subsidie-jaarwissel", months: [10, 11], service: SCAN_SERVICE, impact: "subsidie", subject: "Subsidie rond de jaarwisseling",
    why: "Rond de jaarwisseling veranderen subsidies en tarieven vaak. Mensen willen weten of ze moeten aanvragen vóór 1 januari of beter kunnen wachten.",
    titles: [{ angle: "probleemgericht", title: "Verduurzamen rond de jaarwisseling: nu doen of wachten?" }, { angle: "positief", title: "Subsidie voor je huis in het nieuwe jaar: zo pak je het aan" }] },
  { key: "zonnepanelen-voorjaar", months: [1, 2, 3], service: "zonnepanelen", impact: "kosten", subject: "Zonnepanelen in het voorjaar",
    why: "In het voorjaar stijgt de interesse in zonnepanelen; wie nu laat plaatsen, profiteert van de zonnigste maanden.",
    titles: [{ angle: "neutraal", title: "Zonnepanelen nemen dit voorjaar: wat leveren ze nog op?" }, { angle: "probleemgericht", title: "Waarom zonnepanelen alleen niet altijd genoeg zijn" }] },
  { key: "warmtepomp-najaar", months: [7, 8, 9], service: "warmtepomp", impact: "kosten", subject: "Warmtepomp voor de winter",
    why: "Wie vóór de winter een warmtepomp wil, moet in de nazomer beslissen; installateurs raken in het najaar volgeboekt.",
    titles: [{ angle: "probleemgericht", title: "Is een warmtepomp nog wel rendabel?" }, { angle: "positief", title: "Voor de winter een warmtepomp: zo plan je het goed" }] },
]

export function seasonDrafts(ctx: Ctx): Draft[] {
  const now = new Date()
  const m = now.getMonth()
  return SEASONS.filter(s => s.months.includes(m) && (s.service === SCAN_SERVICE || ctx.services.includes(s.service))).map(s => ({
    fingerprint: `seizoen:${s.key}:${s.months[0] > m ? now.getFullYear() - 1 : now.getFullYear()}`,
    origin: "seizoen" as const,
    subject: s.subject, summary: s.why, whyNow: s.why,
    service: s.service, impact: s.impact, regions: [],
    sources: [{ title: "Seizoenskalender Gijs Intelligence", publisher: "Seizoenspatroon", date: now.toISOString(), reliability: "kalender" as const }],
    ageDays: null, reliability: "kalender" as const, titleOverride: s.titles,
  }))
}

