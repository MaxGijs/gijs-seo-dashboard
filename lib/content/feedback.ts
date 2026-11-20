// Leren van wat een medewerker zelf schrijft bij het afwijzen van een contentkans.
// Geen AI: vaste, uitlegbare patronen. Elke les verwijst naar de zin waar hij uit komt,
// werkt pas licht na één keer en sterker als dezelfde reden vaker terugkomt, en is terug te draaien.
//
// Twee soorten lessen:
// 1. Redenen ("geen aankoopbeslissing", "geen echte zoekvraag", "actualiteit telt te zwaar", …)
// 2. Onderwerpen: woorden die in je toelichting én in de afgewezen kans staan ("miljoenenclaim")

import { SERVICE_TERMS, type ContentIdea, type Impact, type Origin } from "./model"
import type { Lesson } from "@/lib/learning"

export type ReasonCode = "doelgroep" | "bedrijfsnieuws" | "zoekvraag" | "actualiteit" | "regio" | "kortlopend" | "dubbel" | "onjuist" | "toon"

export const REASONS: Record<ReasonCode, { label: string; pattern: RegExp; effect: string; applies: boolean }> = {
  doelgroep: {
    label: "Geen aankoopbeslissing of verkeerde doelgroep",
    pattern: /(aankoop|koop)beslissing|nieuwszoekers?|gedupeerd|verkeerde doelgroep|niet voor (huis|woning)eigenaren|huurders|installateurs|ondernemers|conversie(kans)?|energiescan (wil(len)? )?aanvragen|commerci[ëe]le (zoek)?intentie|geen klant(en)?|trekt (vooral )?(de )?verkeerde/i,
    effect: "Nieuwe kansen over hetzelfde soort onderwerp (zelfde herkomst en soort gevolgen) krijgen een lagere score.",
    applies: true,
  },
  bedrijfsnieuws: {
    label: "Bedrijfsnieuws, geen adviesonderwerp",
    pattern: /faillis|failliet|curator|(miljoenen)?claim|rechtszaak|rechter|aanklacht|aangeklaagd|fraude|overname|aandeelhouder|beursgang|bedrijfsnieuws|nieuwsforum|nieuwssite|geen advies(onderwerp|vraag)|adviesbureau/i,
    effect: "Nieuwe nieuwskansen over faillissementen, claims, rechtszaken of overnames krijgen een lagere score, bij elke dienst. Het onderwerp zelf (bijvoorbeeld zonnepanelen) blijft gewoon relevant.",
    applies: true,
  },
  zoekvraag: {
    label: "Geen echte zoekvraag",
    pattern: /zoekvraag|zoekvolume|vertoningen|belangstelling|weinig (op )?gezocht|niemand zoekt|andere zoekvragen|search console/i,
    effect: "Nieuwe kansen zonder eigen zoekvraag (minder dan 10 vertoningen) krijgen een lagere score.",
    applies: true,
  },
  actualiteit: {
    label: "Actualiteit telt te zwaar in de score",
    pattern: /(actualiteit|actueel|nieuwswaarde)[^.]{0,80}(te )?(zwaar|hoog|beloond|overschat)|(score|dashboardscore)[^.]{0,30}te hoog|te hoog[^.]{0,30}score/i,
    effect: "Bij nieuws zonder eigen zoekvraag telt actualiteit minder zwaar mee in de score.",
    applies: true,
  },
  regio: {
    label: "Te landelijk, niet voor de regio",
    pattern: /landelijk|niet (in|voor) (onze|de|ons) (regio|werkgebied)|buiten (ons|het) werkgebied|andere provincie/i,
    effect: "Nieuwe nieuwskansen zonder regio (landelijk) krijgen een lagere score.",
    applies: true,
  },
  kortlopend: {
    label: "Kortlopend nieuws, geen blijvend onderwerp",
    pattern: /geen (sterk )?evergreen|snel verouderd|eenmalig|kortstondig|hype|over een (paar|twee) weken/i,
    effect: "Ter informatie; telt mee als het samen met een andere reden wordt genoemd.",
    applies: false,
  },
  dubbel: {
    label: "Bestaat al op de site",
    pattern: /bestaat al|al een (pagina|artikel)|staat al (op de (site|website)|online)|al op de (site|website)|al (eerder )?(geschreven|gepubliceerd|behandeld)|overlap|dubbel/i,
    effect: "Nieuws dat inhoudelijk op deze kans lijkt, wordt niet opnieuw als nieuw artikel voorgesteld: hetzelfde nieuws via een andere bron wordt bij de bestaande kans gevoegd, een verwant onderwerp wordt \"bestaande pagina bijwerken\".",
    applies: true,
  },
  onjuist: {
    label: "Feitelijk onjuist of onvoldoende onderbouwd",
    pattern: /onjuist|klopt niet|feitelijk (fout|onjuist)|niet waar|onvoldoende onderbouwd/i,
    effect: "Ter informatie: gaat mee in de briefing als aandachtspunt.",
    applies: false,
  },
  toon: {
    label: "Toon past niet (te negatief of sensationeel)",
    pattern: /te negatief|bangmakerij|sensatie|angst ?zaaien|clickbait/i,
    effect: "Ter informatie: gaat mee in de briefing als aandachtspunt.",
    applies: false,
  },
}

// Woorden die nooit als "onderwerp dat niet past" gelden: diensten van Gijs en algemene termen
const NEVER_RAW = [
  ...Object.keys(SERVICE_TERMS), ...Object.values(SERVICE_TERMS).flat(),
  "energiescan", "verduurzamen", "verduurzaming", "woning", "woningen", "woningeigenaren", "huiseigenaren", "eigenaren", "particuliere", "particulieren",
  "artikel", "dashboard", "dashboardscore", "score", "actualiteit", "zoekvraag", "zoekvragen", "vertoningen", "search", "console", "onderwerp", "berichtgeving",
  "nieuws", "actueel", "relevante", "relevant", "belangstelling", "aansluiting", "commerciële", "zoekintentie", "conversiekans", "evergreen", "bovendien",
  "waarschijnlijk", "vooral", "concreet", "probleem", "aankoopbeslissing", "eerder", "betreffen", "bewijzen", "vermeld", "beloond", "terwijl", "andere",
  "energie", "subsidie", "subsidies", "huizen", "mensen", "nederland", "overijssel", "gelderland", "utrecht", "flevoland", "regio", "landelijk",
  // Gewone woorden die geen onderwerp zijn
  "voormalige", "voormalig", "nieuwe", "grote", "kleine", "eerste", "laatste", "belangrijke", "verschillende", "bepaalde", "huidige", "mogelijke",
  "andere", "echter", "daarom", "hierover", "daarover", "gewoon", "zeker", "misschien", "precies", "volgens", "tussen", "zonder", "tegen",
  "omdat", "wanneer", "waarbij", "daarnaast", "sinds", "tijdens", "alleen", "steeds", "weinig", "minder", "meer", "groot", "klein", "zwakke",
  "sterke", "sterk", "artikelen", "pagina", "paginas", "klanten", "klant", "bedrijf", "bedrijven", "berichten", "bericht", "nieuwsbericht",
  // Namen van nieuwsbronnen: waar iets stond zegt niets over het onderwerp
  "omroep", "tubantia", "gelderlander", "stentor", "destentor", "nieuwsuur", "telegraaf", "volkskrant", "trouw", "parool", "rijksoverheid",
  "milieucentraal", "omroepgelderland", "rtvutrecht", "omroepflevoland", "dagblad", "nieuwsblad", "persbericht", "bericht", "berichtgeving",
  // Gewone woorden uit een toelichting
  "toelichting", "oordeel", "vermelden", "particuliere", "eigenlijk", "zwakke", "trekken", "aanvragen",
  // Woorden uit de vaste zinnen die het systeem zelf schrijft
  "subsidienieuws", "huiseigenaren", "verduurzamen", "uitleggen", "aanleiding", "publiceerde",
]

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
const words = (t: string) => (norm(t).match(/[a-z]{6,}/g) || [])
// Eenvoudige stam: meervoud en verbuiging eraf, zodat "faillissementen" en "faillissement" samenvallen
export const stem = (w: string) => w.replace(/(ingen|heden|en|es|s|e)$/, "")
const NEVER = new Set(NEVER_RAW.flatMap(t => words(t)).flatMap(w => [w, stem(w)]))
// Algemeen woord (geen onderwerp): ook gebruikt door de controle "staat al op de site"
export const isGeneric = (w: string) => NEVER.has(w) || NEVER.has(stem(w))
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)

export interface ReadNote { reasons: { code: ReasonCode; quote: string }[]; topics: { stem: string; word: string; quote: string }[] }

// Lees één toelichting bij één afgewezen kans
export function readNote(raw: string, ideaText: string): ReadNote {
  // Meegekopieerde bronvermeldingen uit Claude ("NOS+1") en dubbele spaties eruit
  const note = raw.replace(/\b\S+\+\d+\b/g, " ").replace(/[ \t]{2,}/g, " ").trim()
  const reasons: ReadNote["reasons"] = []
  for (const code of Object.keys(REASONS) as ReasonCode[]) {
    const s = sentences(note).find(x => REASONS[code].pattern.test(x))
    if (s) reasons.push({ code, quote: s.length > 220 ? s.slice(0, 217) + "…" : s })
  }
  const inIdea = new Map(words(ideaText).map(w => [stem(w), w]))
  const topics: ReadNote["topics"] = []
  const seen = new Set<string>()
  for (const s of sentences(note)) {
    for (const w of words(s)) {
      const st = stem(w)
      if (st.length < 6 || NEVER.has(w) || NEVER.has(st) || seen.has(st) || !inIdea.has(st)) continue
      seen.add(st)
      topics.push({ stem: st, word: inIdea.get(st)!, quote: s.length > 220 ? s.slice(0, 217) + "…" : s })
    }
  }
  return { reasons, topics: topics.slice(0, 4) }
}

type IdeaLike = Pick<ContentIdea, "id" | "title" | "status" | "origin"> & Partial<Pick<ContentIdea, "summary" | "why_now" | "feedback" | "impact" | "decision_note" | "regions">>
// Tekst waarin onderwerpen gezocht worden: titel en samenvatting van de kans. "Waarom nu" niet bij
// automatische kansen: daar staan zinnen die het systeem zelf schrijft ("Subsidienieuws leidt direct
// tot zoekvragen"), en een woord daaruit is geen onderwerp van het nieuws.
export const ideaText = (i: Partial<Pick<ContentIdea, "title" | "summary" | "why_now" | "origin">>) => `${i.title || ""} ${i.summary || ""}${i.origin === "handmatig" ? ` ${i.why_now || ""}` : ""}`
export const noteOf = (i: IdeaLike) => [...(i.feedback || []).map(f => f.note).filter(Boolean), i.decision_note].filter(Boolean).join(" ").trim()

export interface Learned {
  reasons: Map<ReasonCode, { n: number; quotes: { id: string; title: string; quote: string }[]; impacts: Set<string>; origins: Set<string> }>
  topics: Map<string, { word: string; n: number; quotes: { id: string; title: string; quote: string }[] }>
}

// Alles wat we leren uit de toelichtingen bij afgewezen kansen
export function learnFromFeedback(ideas: IdeaLike[], ignore: Set<string> = new Set()): Learned {
  const out: Learned = { reasons: new Map(), topics: new Map() }
  // Woorden die ook in niet-afgewezen kansen staan, zijn geen onderwerp dat "niet past"
  const okStems = new Set(ideas.filter(i => i.status !== "afgewezen").flatMap(i => words(ideaText(i)).map(stem)))
  for (const i of ideas.filter(x => x.status === "afgewezen")) {
    const note = noteOf(i)
    if (!note) continue
    const r = readNote(note, ideaText(i))
    for (const { code, quote } of r.reasons) {
      if (ignore.has(`reden|${code}`)) continue
      const cur = out.reasons.get(code) || { n: 0, quotes: [], impacts: new Set<string>(), origins: new Set<string>() }
      cur.n++; cur.quotes.push({ id: i.id, title: i.title, quote })
      if (i.impact) cur.impacts.add(i.impact); cur.origins.add(i.origin)
      out.reasons.set(code, cur)
    }
    for (const t of r.topics) {
      if (okStems.has(t.stem) || ignore.has(`onderwerp|${t.stem}`)) continue
      const cur = out.topics.get(t.stem) || { word: t.word, n: 0, quotes: [] }
      cur.n++; cur.quotes.push({ id: i.id, title: i.title, quote: t.quote })
      out.topics.set(t.stem, cur)
    }
  }
  return out
}

// Nieuws over bedrijven in plaats van over een keuze van de huiseigenaar
export const BUSINESS_NEWS = /faillis|failliet|curator|claim|rechtszaak|rechter|aanklacht|aangeklaagd|fraude|overname|overgenomen|aandeelhouder|beursgang|beursgenoteerd|reorganisatie|ontslagen/i

// Heeft deze afwijzing een toelichting waar het dashboard een reden of onderwerp in herkent?
// Dan telt de afwijzing alleen voor die reden of dat onderwerp, niet voor de hele dienst:
// "zonnepanelen" blijft relevant als je een claim tegen een zonnepanelenbedrijf afwijst.
export function explainedRejection(i: IdeaLike): boolean {
  const note = noteOf(i)
  if (!note) return false
  const r = readNote(note, ideaText(i))
  return r.reasons.some(x => x.code !== "dubbel") || r.topics.length > 0
}

export const factorFor = (n: number) => Math.max(0.5, Math.pow(0.85, n))
export const nlF = (f: number) => f.toFixed(2).replace(/0$/, "").replace(".", ",")

// Wat betekent het geleerde voor een nieuwe kans? Elke afgewezen kans telt hooguit één keer mee
// (×0,85), hoeveel redenen de toelichting ook bevat; de redenen zelf worden wel allemaal genoemd.
export function feedbackEffects(l: Learned | undefined, d: { subject: string; summary?: string; whyNow?: string; origin: Origin; impact: Impact; regions: string[]; demand: number }) {
  const matches: { label: string; ids: string[] }[] = []
  let actWeight = 1
  if (!l) return { matches, actWeight }
  const text = new Set(words(`${d.subject} ${d.summary || ""}${d.origin === "handmatig" ? ` ${d.whyNow || ""}` : ""}`).map(stem))
  const ids = (q: { id: string }[]) => [...new Set(q.map(x => x.id))]
  for (const [st, t] of l.topics) if (text.has(st)) matches.push({ label: `onderwerp "${t.word}"`, ids: ids(t.quotes) })
  const news = d.origin === "actualiteit" || d.origin === "trend"
  const r = l.reasons
  const doel = r.get("doelgroep")
  if (doel && doel.origins.has(d.origin) && doel.impacts.has(d.impact)) matches.push({ label: "vergelijkbaar onderwerp zonder aankoopbeslissing", ids: ids(doel.quotes) })
  const zv = r.get("zoekvraag")
  if (zv && d.demand < 10) matches.push({ label: "geen eigen zoekvraag", ids: ids(zv.quotes) })
  const reg = r.get("regio")
  if (reg && news && !d.regions.length) matches.push({ label: "landelijk nieuws", ids: ids(reg.quotes) })
  const biz = r.get("bedrijfsnieuws")
  if (biz && news && BUSINESS_NEWS.test(`${d.subject} ${d.summary || ""} ${d.whyNow || ""}`)) matches.push({ label: "bedrijfsnieuws (faillissement, claim, rechtszaak of overname)", ids: ids(biz.quotes) })
  const act = r.get("actualiteit")
  if (act && news && d.demand < 10) actWeight = factorFor(act.n)
  return { matches, actWeight }
}

// Lessen voor "Wat hebben we geleerd?" (bron: je eigen feedback)
export function feedbackLessons(l: Learned): Lesson[] {
  const conf = (n: number): Lesson["confidence"] => (n >= 6 ? "hoog" : n >= 3 ? "middel" : "laag")
  const out: Lesson[] = []
  for (const [code, r] of l.reasons) {
    const meta = REASONS[code], f = factorFor(r.n)
    out.push({
      key: `feedback|reden|${code}`, source: "feedback",
      title: `${meta.label} — ${r.n}× in je feedback`,
      conclusion: `Je schreef dit ${r.n}× bij een afwijzing. Herkend in: “${r.quotes[0].quote}”`,
      evidence: { n: r.n, reasons: r.quotes.map(q => q.quote), items: r.quotes.map(q => ({ id: q.id, title: q.title })) },
      confidence: conf(r.n),
      effect: code === "dubbel" ? { type: "content-feedback", text: meta.effect } : meta.applies ? { type: "content-feedback", factor: f, text: `${meta.effect} Nu ×${nlF(f)}.` } : { type: "info", text: meta.effect },
    })
  }
  for (const [st, t] of l.topics) {
    const f = factorFor(t.n)
    out.push({
      key: `feedback|onderwerp|${st}`, source: "feedback",
      title: `Onderwerp "${t.word}" past niet bij Gijs — ${t.n}× afgewezen`,
      conclusion: `Uit je feedback: “${t.quotes[0].quote}”`,
      evidence: { n: t.n, reasons: t.quotes.map(q => q.quote), items: t.quotes.map(q => ({ id: q.id, title: q.title })) },
      confidence: conf(t.n),
      effect: { type: "content-feedback", factor: f, text: `Nieuwe kansen waarin "${t.word}" voorkomt krijgen een lagere score. Nu ×${nlF(f)}.` },
    })
  }
  return out
}

// Aandachtspunten voor de briefing uit "ter informatie"-redenen (onjuist, toon, dubbel)
export function briefingNotes(l: Learned): string[] {
  const out: string[] = []
  const add = (code: ReasonCode, text: string) => { const r = l.reasons.get(code); if (r) out.push(`${text} (${r.n}× genoemd in feedback, bijvoorbeeld: “${r.quotes[0].quote}”)`) }
  add("onjuist", "Controleer elk feit en elk bedrag tegen de bron")
  add("toon", "Houd de toon rustig en oplossingsgericht, niet sensationeel")
  add("dubbel", "Controleer eerst of een bestaande pagina dit al behandelt; verwijs daarnaar in plaats van te herhalen")
  add("doelgroep", "Schrijf voor huiseigenaren die een keuze moeten maken, niet voor nieuwszoekers")
  add("bedrijfsnieuws", "Gijs is een adviesbureau, geen nieuwssite: schrijf over de keuze of het gevolg voor de huiseigenaar, niet over het bedrijf zelf")
  return out
}

// Voorvertoning in het afwijsformulier: wat herkent het dashboard in deze toelichting?
export function previewNote(note: string, idea: IdeaLike, all: IdeaLike[]) {
  if (!note.trim()) return { reasons: [] as { code: ReasonCode; label: string; applies: boolean }[], topics: [] as string[] }
  const okStems = new Set(all.filter(i => i.status !== "afgewezen" && i.id !== idea.id).flatMap(i => words(ideaText(i)).map(stem)))
  const r = readNote(note, ideaText(idea))
  return {
    reasons: r.reasons.map(x => ({ code: x.code, label: REASONS[x.code].label, applies: REASONS[x.code].applies })),
    topics: r.topics.filter(t => !okStems.has(t.stem)).map(t => t.word),
  }
}
