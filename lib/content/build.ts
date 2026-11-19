// Content Intelligence — voorstellen opbouwen uit een aanleiding (puur, zonder netwerk of database).
//
// Regels voor betrouwbaarheid:
// - Elk voorstel heeft één eigen lijst zoekwoorden; de zoekvraag in de score is precies de som daarvan.
// - Alleen informatieve zoekvragen die over het onderwerp gaan tellen mee (geen "isolatie zwolle").
// - Eerst kijken of een bestaande pagina het onderwerp kan dragen, pas daarna een nieuw artikel.
// - Titels worden opgebouwd uit onderwerp en invalshoek, niet uit een ruwe zoekterm of een lange overheidskop.

import type { Item } from "./parse"
import {
  type Angle, type CapacityMode, type ContentIdea, type Impact, type KeywordRef, type Origin, type Reliability, type SourceRef,
  commercialFor, consistencyIssues, CONTENT_MODEL_VERSION, ctaFor, defaultAngle, formatFor, GENERAL_TERMS, priorityFor,
  PROVINCES, regionNote, regionsIn, risksFor, SCAN_SERVICE, scoreIdea, SERVICE_TERMS, serviceLabel, servicePage, TITLE_MAX,
} from "./model"
import { feedbackEffects, type Learned } from "./feedback"

export const dayMs = 86400000
export const ageOf = (iso: string | null | undefined) => (iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / dayMs) : null)
export const nlDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : "onbekende datum")

export function termsFor(service: string) {
  return service === SCAN_SERVICE ? GENERAL_TERMS : SERVICE_TERMS[service] || [service.replace(/-/g, " ")]
}

// Informatieve zoekvraag: een vraag, of een zoekwoord over kosten, subsidie, keuze of werking
export const INFO = /(^|\s)(wat|hoe|waarom|wanneer|welke|welk|hoeveel|is|kan|moet|zijn|beste|heb)\s|kosten|prijs|subsidie|terugverdien|rendabel|bespar|scheelt|nadelen|voordelen|ervaring|verschil|\bvs\b|vergelijk|nodig|zelf|vergunning|verplicht|alternatief|betekenis|condens/
const BRAND = /gijs|groen in je straat|groeninjestraat/

// De zoekwoorden die bij een onderwerp horen: informatief én met een onderwerpterm erin. Gesorteerd, max. 25.
export function topicKeywords(terms: string[], queries: KeywordRef[], exclude?: (q: string) => boolean): KeywordRef[] {
  if (!terms.length) return []
  return queries.filter(q => !BRAND.test(q.query) && INFO.test(q.query) && terms.some(t => q.query.includes(t)) && !(exclude && exclude(q.query)))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 25)
}
const sumImp = (kw: KeywordRef[]) => kw.reduce((s, k) => s + k.impressions, 0)

// Termen die letterlijk in een tekst voorkomen (voor nieuws: alleen wat het bericht echt noemt)
export function termsInText(text: string, services: string[]): string[] {
  const t = text.toLowerCase()
  const all = [...services.flatMap(s => SERVICE_TERMS[s] || [s.replace(/-/g, " ")]), ...GENERAL_TERMS]
  return [...new Set(all.filter(term => t.includes(term)))]
}

// ── Redactie: titels ────────────────────────────────────────────────────────

const NOUN: Record<string, string> = {
  warmtepomp: "een warmtepomp", zonnepanelen: "zonnepanelen", thuisbatterij: "een thuisbatterij", spouwmuurisolatie: "spouwmuurisolatie",
  dakisolatie: "dakisolatie", vloerisolatie: "vloerisolatie", isolatieglas: "isolatieglas", kozijnen: "nieuwe kozijnen",
  vloerverwarming: "vloerverwarming", ketel: "een nieuwe cv-ketel", [SCAN_SERVICE]: "verduurzamen",
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function noun(service: string | null, hint = "") {
  if (service === "warmtepomp" && /hybride/.test(hint)) return "een hybride warmtepomp"
  if (service === SCAN_SERVICE && /isol/.test(hint)) return "isolatie"
  return NOUN[service || ""] || (service ? service.replace(/-/g, " ") : "verduurzamen")
}
function listNl(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} en ${xs[xs.length - 1]}`
}
const provinceName = (p: string) => cap(p)

// Kort een lange kop in tot een bruikbaar onderwerp
export function shorten(title: string, max = 55): string {
  let t = title.replace(/\s+/g, " ").trim().replace(/^(update|nieuws|persbericht)\s*:?\s+/i, "")
  const colon = t.indexOf(":")
  if (colon > 0 && t.slice(0, colon).split(" ").length >= 3) t = t.slice(0, colon)
  t = t.replace(/\s+[–-]\s+.*$/, "")
  if (t.length <= max) return t
  const cut = t.slice(0, max).replace(/\s+\S*$/, "")
  return cut.replace(/[,;:]$/, "")
}

// Houdt een titel binnen de maximale lengte: liever de vraag weglaten dan midden in een woord afbreken
function fit(main: string, suffix: string): string {
  const full = `${main}${suffix}`
  if (full.length <= TITLE_MAX) return full
  if (main.length <= TITLE_MAX) return main
  return shorten(main, TITLE_MAX)
}

export function newsTitles(title: string, impact: Impact, service: string | null, regions: string[]): { angle: Angle; title: string }[] {
  const year = (title.match(/\b(vanaf|per|in|tot)\s+(20\d\d)\b/i) || [])[2]
  const n = noun(service, title.toLowerCase())
  const where = regions.length === 1 ? ` in ${provinceName(regions[0])}` : ""
  const subject = shorten(title)
  switch (impact) {
    case "net":
      return [
        { angle: "probleemgericht", title: fit(`Vol stroomnet${where}`, ": kun je nog verduurzamen?") },
        { angle: "positief", title: fit(`Vol stroomnet${where}`, ": zo kun je toch verduurzamen") },
        { angle: "neutraal", title: fit(cap(subject), ": wat betekent dit voor jouw huis?") },
      ]
    case "regelgeving":
      return [
        { angle: "probleemgericht", title: fit(`Nieuwe regels voor ${n}${year ? ` vanaf ${year}` : ""}`, ": moet je nu iets doen?") },
        { angle: "neutraal", title: fit(`Nieuwe regels voor ${n}${year ? ` vanaf ${year}` : ""}`, ": dit verandert er") },
        { angle: "positief", title: fit(`Nieuwe regels voor ${n}${year ? ` vanaf ${year}` : ""}`, ": zo speel je erop in") },
      ]
    case "subsidie":
      return [
        { angle: "positief", title: fit(`Subsidie voor ${n === "verduurzamen" ? "je huis" : n}${year ? ` in ${year}` : ""}`, ": dit kun je krijgen") },
        { angle: "probleemgericht", title: fit(`Subsidie voor ${n === "verduurzamen" ? "je huis" : n}${year ? ` in ${year}` : ""}`, ": mis je hem straks?") },
        { angle: "neutraal", title: fit(cap(subject), ": wat betekent dit voor jou?") },
      ]
    case "kosten":
      return [
        { angle: "probleemgericht", title: fit(cap(subject), ": wat kost het jou?") },
        { angle: "positief", title: fit(cap(subject), ": zo houd je de rekening laag") },
        { angle: "neutraal", title: fit(cap(subject), ": de gevolgen op een rij") },
      ]
    default:
      return [
        { angle: "neutraal", title: fit(cap(subject), ": wat betekent dit voor jou?") },
        { angle: "probleemgericht", title: fit(cap(subject), ": waar moet je op letten?") },
      ]
  }
}

type SearchIntent = "subsidie" | "kosten" | "comfort" | "keuze" | "ramen" | "werking"
export function intentOf(q: string): SearchIntent {
  if (/subsidie|isde|warmtefonds|tegoed/.test(q)) return "subsidie"
  if (/ijs|condens|beslagen/.test(q)) return "ramen"
  if (/graden|warmer|tocht|koud/.test(q)) return "comfort"
  if (/kosten|prijs|bespar|terugverdien|rendabel|scheelt|per maand/.test(q)) return "kosten"
  if (/beste|welke|welk|verschil|\bvs\b|vergelijk|alternatief/.test(q)) return "keuze"
  return "werking"
}
const INTENT_LABEL: Record<SearchIntent, string> = {
  subsidie: "subsidie", kosten: "kosten en besparing", comfort: "comfort en temperatuur", keuze: "keuze en vergelijking", ramen: "condens en ijs op ramen", werking: "werking en aanpak",
}

function searchTitles(service: string, intent: SearchIntent, hint: string, place: string | null): { angle: Angle; title: string }[] {
  const n = noun(service, hint)
  const N = cap(n.replace(/^een /, ""))
  const loc = place ? ` in ${place}` : ""
  switch (intent) {
    case "subsidie": return [
      { angle: "positief", title: fit(`Subsidie voor ${n === "verduurzamen" ? "je huis" : n}${loc}`, ": dit kun je krijgen") },
      { angle: "neutraal", title: fit(`Subsidie voor ${n === "verduurzamen" ? "je huis" : n}${loc}`, ": zo vraag je het aan") },
      { angle: "probleemgericht", title: fit(`Subsidie voor ${n === "verduurzamen" ? "je huis" : n}${loc}`, ": de fouten die geld kosten") },
    ]
    case "kosten": return [
      { angle: "neutraal", title: fit(`Wat kost ${n} en wat bespaar je ermee?`, "") },
      { angle: "probleemgericht", title: fit(`Is ${n} het geld waard?`, "") },
      { angle: "positief", title: fit(`Zoveel bespaar je met ${n}`, "") },
    ]
    case "comfort": return [
      { angle: "neutraal", title: fit(`Hoeveel warmer wordt je huis met ${n}?`, "") },
      { angle: "probleemgericht", title: fit(`Nog steeds koud na ${n}? Dit kan de oorzaak zijn`, "") },
    ]
    case "keuze": return [
      { angle: "neutraal", title: fit(`Welke ${N.toLowerCase()} past bij jouw huis?`, "") },
      { angle: "probleemgericht", title: fit(`${N} kiezen: deze fouten maken veel mensen`, "") },
    ]
    case "ramen": return [
      { angle: "neutraal", title: "Condens of ijs op je ramen: wat zegt het over je glas?" },
      { angle: "probleemgericht", title: "IJs op je dubbel glas: is er iets mis?" },
    ]
    default: return [
      { angle: "neutraal", title: fit(`${N}: zo werkt het en dit moet je weten`, "") },
      { angle: "probleemgericht", title: fit(`${N}: waar gaat het vaak mis?`, "") },
    ]
  }
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
  keywords: KeywordRef[]              // precies de zoekwoorden waarop de zoekvraag in de score is gebaseerd
  advice?: "nieuw" | "bijwerken"
  targetPage?: string | null          // bestaande pagina die het onderwerp kan dragen
  adviceReason?: string
  format?: string
  titleOverride?: { angle: Angle; title: string }[]
  urgency?: "hoog" | "middel" | "laag"
}

export interface Place { name: string; path: string }
export interface Ctx {
  services: string[]
  hasArticles: boolean
  queries: KeywordRef[]
  capacity: Map<string, CapacityMode>
  places: Map<string, Place>          // "zwolle" → { name: "Zwolle", path: "/regio/overijssel/zwolle" }
  existing: (Pick<ContentIdea, "id" | "fingerprint" | "origin" | "status" | "service" | "sources" | "created_at" | "title"> & Partial<Pick<ContentIdea, "summary" | "why_now" | "feedback" | "impact" | "decision_note" | "regions">>)[]
  ignoreRejections?: Set<string>      // "dienst|herkomst" van teruggedraaide lessen
  learned?: Learned                   // geleerd uit de eigen toelichtingen bij afwijzingen
}

function rejectedIds(ctx: Ctx, service: string | null, origin: Origin): string[] {
  // Teruggedraaide les ("Wat hebben we geleerd?"): afwijzingen van deze soort tellen niet meer mee
  if (ctx.ignoreRejections?.has(`${service || "-"}|${origin}`)) return []
  return ctx.existing.filter(e => e.status === "afgewezen" && e.service === service && e.origin === origin).map(e => e.id)
}

// Plaatsnaam in een zoekvraag (langste match eerst, zodat "hof van twente" wint van "twente")
export function placeIn(q: string, places: Map<string, Place>): Place | null {
  const words = q.toLowerCase()
  let best: Place | null = null, bestLen = 0
  for (const [key, p] of places) {
    if (key.length > bestLen && new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(words)) { best = p; bestLen = key.length }
  }
  return best
}

export function buildIdea(d: Draft, ctx: Ctx) {
  const capacity = (d.service && ctx.capacity.get(d.service)) || "normaal"
  const kw = d.keywords
  const demand = sumImp(kw)
  // Eerder afgewezen kansen die hierop lijken: zelfde dienst en herkomst, of volgens de eigen toelichtingen.
  // Elke afgewezen kans telt één keer, ook als hij om meerdere redenen lijkt.
  const fb = feedbackEffects(ctx.learned, { subject: d.subject, summary: d.summary, whyNow: d.whyNow, origin: d.origin, impact: d.impact, regions: d.regions, demand })
  const similar = new Set([...rejectedIds(ctx, d.service, d.origin), ...fb.matches.flatMap(m => m.ids)])
  const scored = scoreIdea({ origin: d.origin, ageDays: d.ageDays, service: d.service, impact: d.impact, demand, keywordCount: kw.length, urgency: d.urgency, reliability: d.reliability, capacity, rejectedSimilar: similar.size, feedback: { reasons: fb.matches.map(m => m.label), actWeight: fb.actWeight } })
  const format = d.format || formatFor(d.origin, d.impact, d.ageDays)
  const page = servicePage(d.service)
  const pageExists = d.service && d.service !== SCAN_SERVICE ? ctx.services.includes(d.service) : true
  const options = d.titleOverride || newsTitles(d.subject, d.impact, d.service, d.regions)
  const angle = options.find(o => o.angle === defaultAngle(d.impact))?.angle || options[0].angle
  const advice = d.advice || "nieuw"
  const target = d.targetPage !== undefined ? d.targetPage : pageExists ? page : null
  const notes: string[] = []
  if (advice === "bijwerken") notes.push(`Werk ${target} bij in plaats van een nieuwe pagina te maken${d.adviceReason ? `: ${d.adviceReason}` : ""}. Een los artikel alleen als het onderwerp daar niet past; anders gaan eigen pagina's met elkaar concurreren.`)
  else notes.push(d.service === SCAN_SERVICE ? "Nieuw artikel: er is geen bestaande pagina die dit actuele onderwerp dekt. Verwijs naar de subsidiecheck en de energiescan."
    : pageExists ? `Nieuw artikel voor het actuele nieuws. Controleer daarnaast of ${page} nog klopt en link vanuit het artikel naar die pagina, zodat beide niet om dezelfde zoekwoorden concurreren.` : "Nieuw artikel: er is nog geen pagina over dit onderwerp.")
  if (advice === "nieuw" && d.adviceReason) notes.push(d.adviceReason)
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
    audience: `Particuliere woningeigenaren${d.service && d.service !== SCAN_SERVICE ? ` die nadenken over ${serviceLabel(d.service)}` : " die willen verduurzamen"}${d.regions.length ? ` in ${listNl(d.regions.map(provinceName))}` : ""}`,
    service: d.service,
    regions: d.regions,
    intent: d.origin === "actualiteit" || d.origin === "trend" ? "Informatief (actueel)" : d.origin === "seizoen" ? "Oriënterend" : "Informatief",
    angle,
    format,
    advice,
    advice_note: notes.join(" "),
    target_page: target,
    related_pages: [...new Set([target, pageExists ? page : null, "/subsidiecheck"].filter(Boolean) as string[])],
    keywords: kw,
    sources: d.sources,
    impact: d.impact,
    shelf_life: format === "Actueel nieuwsartikel" || format === "Kort nieuwsbericht" ? "actueel" : "evergreen",
    goal: format === "Actueel nieuwsartikel"
      ? "Als eerste een betrouwbare, begrijpelijke uitleg bieden (bereik en autoriteit) en lezers doorleiden naar de energiescan."
      : advice === "bijwerken" ? "De bestaande pagina laten scoren op de vragen die mensen nu stellen, zonder een concurrerende nieuwe pagina."
      : "Organisch verkeer op informatieve zoekvragen binnenhalen en lezers doorleiden naar de passende dienst.",
    cta: ctaFor(d.service, capacity, d.regions),
    commercial_value: `${com >= 8 ? "Hoog" : com >= 6 ? "Middel" : "Laag"} (aanname): ${comWhy}`,
    reach_value: demand >= 300 || d.impact === "regelgeving" || d.impact === "subsidie" ? "Hoog" : demand >= 50 ? "Middel" : "Laag",
    risks: risksFor(d.impact, d.reliability, d.sources.some(s => s.firstSeen)),
    score: scored.score,
    score_parts: [...scored.parts, ...scored.factors.map(f => ({ label: "Correctie", points: 0, max: 0, why: f }))],
    priority: priorityFor(scored.score),
  }
  const idea = { ...row, original: { ...row, version: CONTENT_MODEL_VERSION } }
  // Automatische controle: een inconsistent voorstel wordt niet opgeslagen
  const issues = consistencyIssues(idea as any)
  return issues.length ? { ...idea, issues } : idea
}

// ── Kansen uit actualiteiten ────────────────────────────────────────────────

export function newsDraft(i: Item & { services: string[]; impact: Impact; regions: string[]; reason?: string | null }, src: { publisher: string; reliability: Reliability }, ctx: Ctx, origin: "actualiteit" | "trend" = "actualiteit"): Draft {
  const ref: SourceRef = { title: i.title, url: i.url, publisher: src.publisher, date: i.published, reliability: src.reliability, firstSeen: i.firstSeen }
  let service = i.services.find(s => s !== SCAN_SERVICE) || i.services[0] || null
  // Stroomnetnieuws zonder specifieke dienst: de warmtepomp is de keuze die het meest geraakt wordt
  if (i.impact === "net" && service === SCAN_SERVICE && ctx.services.includes("warmtepomp")) service = "warmtepomp"
  const text = `${i.title} ${i.summary}`
  const keywords = topicKeywords(termsInText(text, ctx.services), ctx.queries)
  return {
    fingerprint: `nieuws:${i.url}`,
    origin,
    subject: i.title,
    summary: i.summary,
    whyNow: `${origin === "trend" && i.reason ? `${i.reason} ` : ""}${src.publisher} publiceerde op ${nlDate(i.published)}: "${i.title}". ${i.impact === "regelgeving" ? "Nieuwe of veranderende regels roepen vragen op bij huiseigenaren; wie nu een heldere uitleg geeft, wordt gevonden." : i.impact === "subsidie" ? "Subsidienieuws leidt direct tot zoekvragen en aanvragen." : i.impact === "kosten" ? "Veranderende kosten zijn een directe aanleiding om te verduurzamen." : i.impact === "net" ? "Problemen met het stroomnet raken direct de keuze voor warmtepomp, zonnepanelen en batterij." : "Actuele aanleiding om het onderwerp uit te leggen."}`,
    service, impact: i.impact, regions: i.regions,
    sources: [ref], ageDays: ageOf(i.published), reliability: src.reliability, keywords,
  }
}

// ── Kansen uit zoekdata ─────────────────────────────────────────────────────
// Per dienst en per soort vraag één voorstel, zodat de zoekwoorden echt bij elkaar horen.

export function searchDrafts(ctx: Ctx): Draft[] {
  const month = new Date().toISOString().slice(0, 7)
  const drafts: Draft[] = []
  const specific = (q: string) => ctx.services.some(s => (SERVICE_TERMS[s] || [s]).some(t => q.includes(t)))
  for (const service of [...ctx.services, SCAN_SERVICE]) {
    const all = topicKeywords(termsFor(service), ctx.queries, q => service === SCAN_SERVICE && specific(q))
      .filter(q => q.impressions >= 3 && (q.position === null || q.position > 7 || q.clicks === 0))
    const groups = new Map<SearchIntent, KeywordRef[]>()
    for (const q of all) groups.set(intentOf(q.query), [...(groups.get(intentOf(q.query)) || []), q])
    for (const [intent, qs] of groups) {
      const imp = sumImp(qs)
      if (imp < 30) continue
      const avgPos = qs.reduce((s, q) => s + (q.position || 0) * q.impressions, 0) / Math.max(1, imp)
      const clicks = qs.reduce((s, q) => s + q.clicks, 0)
      // Bestaande pagina eerst: een plaatspagina als de vraag vooral over één plaats gaat, anders de dienstpagina
      const byPlace = new Map<string, { p: Place; imp: number }>()
      qs.forEach(q => { const p = placeIn(q.query, ctx.places); if (p) byPlace.set(p.path, { p, imp: (byPlace.get(p.path)?.imp || 0) + q.impressions }) })
      const topPlace = [...byPlace.values()].sort((a, b) => b.imp - a.imp)[0]
      const localShare = topPlace ? topPlace.imp / imp : 0
      const servicePageExists = service !== SCAN_SERVICE && ctx.services.includes(service)
      let targetPage: string | null = null, adviceReason = ""
      if (topPlace && localShare >= 0.6) { targetPage = topPlace.p.path; adviceReason = `${Math.round(localShare * 100)}% van deze zoekvraag gaat over ${topPlace.p.name} en daar is al een pagina voor` }
      else if (servicePageExists) { targetPage = servicePage(service); adviceReason = `de dienstpagina staat al voor ${serviceLabel(service)} en kan een sectie over ${INTENT_LABEL[intent]} dragen` }
      const place = topPlace && localShare >= 0.6 ? topPlace.p.name : null
      if (!targetPage && byPlace.size >= 2) adviceReason = `De vragen komen uit meerdere plaatsen (${[...byPlace.values()].sort((a, b) => b.imp - a.imp).slice(0, 4).map(x => x.p.name).join(", ")}): één algemeen artikel, en op die plaatspagina's een korte alinea met een link ernaartoe.`
      const name = serviceLabel(service)
      const top = qs.slice(0, 3).map(q => `"${q.query}"`).join(", ")
      drafts.push({
        fingerprint: `zoek:${service}:${intent}:${month}`,
        origin: "zoekdata",
        subject: `${INTENT_LABEL[intent]} – ${name}`,
        summary: `${qs.length} informatieve ${qs.length === 1 ? "zoekvraag" : "zoekvragen"} over ${INTENT_LABEL[intent]} (${name}), samen ${imp.toLocaleString("nl-NL")} vertoningen in 28 dagen. Belangrijkste: ${top}.`,
        whyNow: `Mensen zoeken nu al naar ${INTENT_LABEL[intent]} rond ${name}: ${imp.toLocaleString("nl-NL")} vertoningen in 28 dagen, maar Gijs staat gemiddeld op positie ${avgPos.toFixed(1).replace(".", ",")} en krijgt ${clicks} ${clicks === 1 ? "klik" : "klikken"}. Er is vraag zonder goed antwoord op de site.`,
        service,
        impact: intent === "subsidie" ? "subsidie" : intent === "kosten" ? "kosten" : "advies",
        regions: [...new Set(qs.flatMap(q => regionsIn(q.query)).concat(place ? Object.entries(PROVINCES).filter(([prov]) => topPlace!.p.path.includes(`/${prov}/`)).map(([prov]) => prov) : []))],
        sources: [{ title: `Search Console: ${qs.length} zoekvragen over ${INTENT_LABEL[intent]} (${name})`, publisher: "Google Search Console", date: new Date().toISOString(), reliability: "eigen-data" }],
        ageDays: null, reliability: "eigen-data", keywords: qs,
        advice: targetPage ? "bijwerken" : "nieuw",
        targetPage, adviceReason,
        format: targetPage ? "Update bestaande pagina" : intent === "keuze" ? "Vergelijking" : "Uitgebreid kennisartikel",
        titleOverride: searchTitles(service, intent, qs.map(q => q.query).join(" "), place),
      })
    }
  }
  return drafts
}

// ── Seizoenskalender ────────────────────────────────────────────────────────
// Alleen het moment, geen feiten: bedragen en regels komen uit de briefing-bronnen.
// "terms" bepalen welke zoekvragen als bewijs voor dit seizoensonderwerp tellen.

const SEASONS: { key: string; months: number[]; service: string; subject: string; why: string; impact: Impact; terms: string[]; titles: { angle: Angle; title: string }[] }[] = [
  { key: "koud-huis", months: [9, 10, 11, 0], service: "spouwmuurisolatie", impact: "kosten", subject: "Koud huis in de winter", terms: ["spouwmuur", "tocht", "koud", "koude muur", "graden"],
    why: "De stookperiode begint. Huiseigenaren merken tocht, koude muren en een hoge rekening, en zoeken nu naar oplossingen.",
    titles: [{ angle: "probleemgericht", title: "Waarom blijft je huis koud ondanks een hoge energierekening?" }, { angle: "positief", title: "Warmer wonen deze winter: de isolatie die het meeste oplevert" }, { angle: "neutraal", title: "Isoleren voor de winter: waar begin je?" }] },
  { key: "vocht-schimmel", months: [10, 11, 0, 1], service: "vloerisolatie", impact: "advies", subject: "Vocht en schimmel na isoleren", terms: ["vocht", "schimmel", "condens", "ventil", "kruipruimte"],
    why: "In de natte wintermaanden zoeken mensen naar vocht- en schimmelproblemen, vaak na of rond isolatiewerk.",
    titles: [{ angle: "probleemgericht", title: "Deze isolatiefouten veroorzaken vocht en schimmel" }, { angle: "neutraal", title: "Isoleren zonder vochtproblemen: zo doe je het goed" }] },
  { key: "subsidie-jaarwissel", months: [10, 11], service: SCAN_SERVICE, impact: "subsidie", subject: "Subsidie rond de jaarwisseling", terms: ["subsidie", "isde", "warmtefonds"],
    why: "Rond de jaarwisseling veranderen subsidies en tarieven vaak. Mensen willen weten of ze moeten aanvragen vóór 1 januari of beter kunnen wachten.",
    titles: [{ angle: "probleemgericht", title: "Verduurzamen rond de jaarwisseling: nu doen of wachten?" }, { angle: "positief", title: "Subsidie voor je huis in het nieuwe jaar: zo pak je het aan" }] },
  { key: "zonnepanelen-voorjaar", months: [1, 2, 3], service: "zonnepanelen", impact: "kosten", subject: "Zonnepanelen in het voorjaar", terms: SERVICE_TERMS.zonnepanelen,
    why: "In het voorjaar stijgt de interesse in zonnepanelen; wie nu laat plaatsen, profiteert van de zonnigste maanden.",
    titles: [{ angle: "neutraal", title: "Zonnepanelen nemen dit voorjaar: wat leveren ze nog op?" }, { angle: "probleemgericht", title: "Waarom zonnepanelen alleen niet altijd genoeg zijn" }] },
  { key: "warmtepomp-najaar", months: [7, 8, 9], service: "warmtepomp", impact: "kosten", subject: "Warmtepomp voor de winter", terms: SERVICE_TERMS.warmtepomp,
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
    keywords: topicKeywords(s.terms, ctx.queries),
  }))
}

// Twee voorstellen die op grotendeels dezelfde zoekwoorden leunen, gaan met elkaar concurreren.
export function keywordOverlap(a: KeywordRef[], b: KeywordRef[]): number {
  if (!a.length) return 0
  const set = new Set(b.map(k => k.query))
  return a.filter(k => set.has(k.query)).length / a.length
}
