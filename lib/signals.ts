import type { DataCheck, Evidence, GscRow, Level, Priority, Signal, SignalKind, Streak } from "./types"
import { buildCtrModel, clicksAt, gainFromMove, type CtrModel } from "./ctr"
import { num, pos, pct } from "./format"
import { actionFor, classifyPage, classifyQuery, estimateFor, INTENT_META, placeIn, regionSegments } from "./intent"
import { assessPage, type PageRow } from "./pages"
import { featuresOf, lessonFor, type Lesson } from "./learning"
import { nextRouteFor, ROUTE_LABEL, routeAction, triesFor, type RouteTry } from "./routes"

export function toPath(url: string) {
  const p = url.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "")
  return p || "/"
}

// De sleutelvorm is gelijk aan de eerdere versie, zodat al opgeslagen statussen blijven kloppen.
const LEGACY_TYPE: Record<SignalKind, string> = {
  "trend-dalend": "trend", "trend-stijgend": "trend", daler: "daler", stijger: "stijger",
  kans: "kans", ctr: "probleem", pagina: "probleem", dubbel: "dubbel", analyse: "analyse", techniek: "techniek", eigen: "eigen",
}

export function signalKey(kind: SignalKind, subject: string) {
  switch (kind) {
    case "trend-dalend":
    case "trend-stijgend": return `trend:${subject}`
    case "daler": return `daler:${subject}`
    case "stijger": return `stijger:${subject}`
    case "kans": return `kans:${subject}`
    case "ctr": return `probleem:${subject}`
    case "pagina": return `probleem:page:${subject}`
    case "dubbel": return `dubbel:${subject}`
    case "analyse": return `analyse:${subject}`
    case "techniek": return `techniek:${subject}`
    case "eigen": return `eigen:${subject}`
  }
}

const EVIDENCE_WEIGHT: Record<Evidence, number> = { sterk: 1, redelijk: 0.7, zwak: 0.35 }

// Merkzoekwoorden: mensen zoeken Gijs zelf. "Gijs" is ook een voornaam, dus posities zijn
// hier minder stuurbaar en inhoudelijke SEO-adviezen (zoekwoord in de H1) slaan nergens op.
export function isBrandQuery(q?: string) {
  if (!q) return false
  const n = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  return /\bgijs\b/.test(n) || n.includes("groen in je straat") || n.includes("groeninjestraat")
}

function evidenceFromImpressions(impressions: number, strong: number, fair: number): [Evidence, string] {
  if (impressions >= strong) return ["sterk", `${num(impressions)} vertoningen in 28 dagen: genoeg om op te bouwen.`]
  if (impressions >= fair) return ["redelijk", `${num(impressions)} vertoningen in 28 dagen: de richting is zichtbaar, maar toeval speelt nog mee.`]
  return ["zwak", `Slechts ${num(impressions)} vertoningen in 28 dagen: te weinig om harde conclusies te trekken.`]
}

// Stond de vorige periode op pagina 1 (≤ 10), nu niet meer
export const lostPage1 = (s: Pick<Signal, "kind" | "metrics">) =>
  s.kind === "daler" && (s.metrics.prevPosition ?? 99) <= 10 && (s.metrics.position == null || s.metrics.position > 10)

// Kans net onder of net buiten pagina 1 (ook gebruikt als je zelf een zoekwoord op de lijst zet)
function kansDraft(k: GscRow, model: CtrModel): Draft {
  const q = k.keys[0]
  const target = k.position <= 10.5 ? 5 : 8
  const [evidence, reason] = evidenceFromImpressions(k.impressions, 150, 40)
  return {
    key: signalKey("kans", q),
    kind: "kans",
    query: q,
    headline: q,
    title: k.position <= 10.5
      ? `Onderaan pagina 1 (positie ${pos(k.position)})`
      : `Net buiten pagina 1 (positie ${pos(k.position)})`,
    summary: `${num(k.impressions)} vertoningen en ${num(k.clicks)} clicks in 28 dagen. Een paar posities stijgen maakt hier het verschil tussen onzichtbaar en aangeklikt worden.`,
    metrics: { position: k.position, impressions: k.impressions, clicks: k.clicks, ctr: k.ctr },
    gain: gainFromMove(model, k.impressions, k.position, target),
    evidence, evidenceReason: reason,
  }
}

// Momentopname om een zoekwoord zelf op de takenlijst te zetten. De volgende berekening vervangt hem
// door het actuele advies (pinned), met verse cijfers, intentie en actie.
export function kansSignal(k: GscRow, model: CtrModel): Signal {
  const d = kansDraft(k, model)
  return { ...d, ...EFFORT_RISK.kans, legacyType: LEGACY_TYPE.kans, priority: "middel", priorityRank: 0, score: 0, generatedAt: new Date().toISOString() }
}

interface Draft extends Omit<Signal, "priority" | "priorityRank" | "score" | "legacyType" | "generatedAt"> {
  urgency?: number
}

export interface SignalInput {
  keywords: GscRow[]       // huidige 28 dagen, gesorteerd op vertoningen
  prevKeywords: GscRow[]   // vorige 28 dagen
  pages: GscRow[]          // huidige 28 dagen
  streaks: Streak[]
  inventory?: PageRow[]    // pagina-inventaris (sitemap + nachtelijke HTTP- en indexeringscontrole)
  ga4Pages?: { path: string; sessions: number; keyEvents: number }[]  // GA4 per landingspagina (28 d)
  feedback?: { key: string; kind: SignalKind; intent?: string }[]    // eerder afgewezen of 'onvoldoende bewijs'
  lessons?: Pick<Lesson, "key" | "title" | "effect" | "status" | "confidence">[]  // wat we geleerd hebben (Wat hebben we geleerd?)
  checks?: DataCheck[]     // metingen of koppelingen die niet goed werken (controletaken)
  tries?: RouteTry[]       // eerder geprobeerde routes per pagina/zoekwoord (uit experimenten)
  pinned?: string[]        // zelf op de takenlijst gezet (bv. "bijna op pagina 1"): blijft een actuele taak
  pinnedRows?: GscRow[]    // cijfers van vastgezette zoekwoorden buiten de top 250 (lange lijst)
}

// Inspanning en wijzigingsrisico per soort signaal (in het zijpaneel verfijnd per aanpassing)
export const EFFORT_RISK: Record<SignalKind, { effort: Level; risk: Level }> = {
  kans: { effort: "laag", risk: "laag" },
  stijger: { effort: "laag", risk: "laag" },
  "trend-stijgend": { effort: "laag", risk: "laag" },
  analyse: { effort: "laag", risk: "laag" },
  daler: { effort: "middel", risk: "laag" },
  "trend-dalend": { effort: "middel", risk: "laag" },
  ctr: { effort: "laag", risk: "middel" },
  pagina: { effort: "laag", risk: "middel" },
  dubbel: { effort: "middel", risk: "middel" },
  techniek: { effort: "middel", risk: "laag" },
  eigen: { effort: "middel", risk: "laag" },
}
const EFFORT_FACTOR: Record<Level, number> = { laag: 1, middel: 0.85, hoog: 0.7 }
const RISK_FACTOR: Record<Level, number> = { laag: 1, middel: 0.9, hoog: 0.75 }

// Conversies via de pagina: een pagina die aanvragen of energiescans oplevert, weegt zwaarder (max ×2)
export function conversionFactor(c?: { keyEvents: number } | null) {
  if (!c) return 1
  return 1 + Math.min(c.keyEvents, 20) / 20
}

export function buildSignals(input: SignalInput, ctrModel?: CtrModel): Signal[] {
  const model = ctrModel || buildCtrModel(input.keywords)
  const now = new Date().toISOString()
  const kwMap = new Map(input.keywords.map(k => [k.keys[0], k]))
  const prevMap = new Map(input.prevKeywords.map(k => [k.keys[0], k]))
  const drafts: Draft[] = []
  const covered = new Set<string>() // één signaal per zoekwoord

  // 0. Van pagina 1 af: stond de vorige 28 dagen in de top 10, nu niet meer. Altijd een taak, ook bij een
  //    kleine stap (9 → 11): onder positie 10 vallen de klikken weg.
  for (const prev of input.prevKeywords) {
    const q = prev.keys[0]
    if (prev.position > 10 || prev.impressions < 10 || covered.has(q)) continue
    const k = kwMap.get(q)
    if (k && k.position <= 10) continue
    if (!k && prev.impressions < 20) continue
    const imp = k?.impressions ?? 0
    const [evidence, reason] = k
      ? evidenceFromImpressions(Math.min(k.impressions, prev.impressions), 100, 25)
      : (["redelijk", `Stond met ${num(prev.impressions)} vertoningen op pagina 1 en heeft nu geen vertoningen meer.`] as [Evidence, string])
    drafts.push({
      key: signalKey("daler", q),
      kind: "daler",
      query: q,
      headline: q,
      title: k ? `Van pagina 1 af: positie ${pos(prev.position)} → ${pos(k.position)}` : `Van pagina 1 af: geen vertoningen meer (was positie ${pos(prev.position)})`,
      summary: `Stond de vorige 28 dagen op pagina 1. ${k ? `${num(prev.impressions)} → ${num(k.impressions)} vertoningen, ${num(prev.clicks)} → ${num(k.clicks)} klikken.` : ""} Onder positie 10 klikt bijna niemand meer door: kijk wat er veranderde en of de pagina terug kan.`.replace(/\s+/g, " ").trim(),
      metrics: { position: k?.position, prevPosition: prev.position, impressions: imp, prevImpressions: prev.impressions, clicks: k?.clicks ?? 0, prevClicks: prev.clicks, ctr: k?.ctr },
      gain: Math.max(gainFromMove(model, Math.max(imp, prev.impressions), k?.position ?? 20, prev.position), prev.clicks * 0.5),
      evidence, evidenceReason: reason,
      urgency: 1.5,
    })
    covered.add(q)
  }

  // 1. Meerweken-trends: een patroon dat je nooit uit één periodevergelijking haalt
  for (const s of input.streaks) {
    const k = kwMap.get(s.query)
    const imp = k?.impressions ?? Math.round(s.impressions * 0.4)
    const falling = s.direction === "dalend"
    const gain = falling
      ? gainFromMove(model, imp, s.positionNow, s.positionWeeksAgo)
      : gainFromMove(model, imp, s.positionNow, Math.max(1, s.positionNow - 3))
    const [evidence, reason] = s.weeks >= 4 && s.impressions >= 100
      ? ["sterk", `${s.weeks} weken op rij dezelfde richting, over ${num(s.impressions)} vertoningen.`] as [Evidence, string]
      : s.impressions >= 40
        ? ["redelijk", `${s.weeks} weken op rij dezelfde richting, maar met ${num(s.impressions)} vertoningen nog een beperkte basis.`] as [Evidence, string]
        : ["zwak", `${s.weeks} weken dezelfde richting, maar met slechts ${num(s.impressions)} vertoningen.`] as [Evidence, string]
    drafts.push({
      key: signalKey(falling ? "trend-dalend" : "trend-stijgend", s.query),
      kind: falling ? "trend-dalend" : "trend-stijgend",
      query: s.query,
      headline: s.query,
      title: falling
        ? `Daalt al ${s.weeks} weken op rij: positie ${pos(s.positionWeeksAgo)} → ${pos(s.positionNow)}`
        : `Stijgt al ${s.weeks} weken op rij: positie ${pos(s.positionWeeksAgo)} → ${pos(s.positionNow)}`,
      summary: falling
        ? `Structurele daling, geen eenmalige uitschieter. ${s.positionNow > 20 ? "Beide posities liggen voorbij pagina 2, dus het directe verlies aan clicks is klein." : "Dit kost zichtbaarheid op een positie waar klikken wél te halen zijn."}`
        : `Structurele stijging. ${s.positionNow <= 15 ? "Dit zoekwoord nadert pagina 1: nu is het moment om de pagina te versterken." : "Nog ver van pagina 1, maar de beweging is de goede kant op."}`,
      metrics: { position: s.positionNow, prevPosition: s.positionWeeksAgo, impressions: imp, clicks: k?.clicks, ctr: k?.ctr, weeks: s.weeks },
      gain, evidence, evidenceReason: reason,
      urgency: falling ? 1.3 : 1.1,
    })
    covered.add(s.query)
  }

  // 2. Duidelijke positieverschuiving t.o.v. de vorige 28 dagen
  for (const k of input.keywords) {
    const q = k.keys[0]
    if (covered.has(q)) continue
    const prev = prevMap.get(q)
    if (!prev || prev.impressions < 10 || k.impressions < 20) continue
    const diff = prev.position - k.position // positief = beter geworden
    if (Math.abs(diff) < 3) continue
    const rising = diff > 0
    const [evidence, reason] = k.impressions >= 150 && prev.impressions >= 50
      ? ["sterk", `Beide perioden hebben genoeg vertoningen (${num(prev.impressions)} → ${num(k.impressions)}).`] as [Evidence, string]
      : evidenceFromImpressions(Math.min(k.impressions, prev.impressions * 2), 150, 30)
    drafts.push({
      key: signalKey(rising ? "stijger" : "daler", q),
      kind: rising ? "stijger" : "daler",
      query: q,
      headline: q,
      title: rising
        ? `Stijgt van positie ${pos(prev.position)} naar ${pos(k.position)}`
        : `Zakt van positie ${pos(prev.position)} naar ${pos(k.position)}`,
      summary: `${num(prev.impressions)} → ${num(k.impressions)} vertoningen, ${num(prev.clicks)} → ${num(k.clicks)} clicks ten opzichte van de vorige 28 dagen.`,
      metrics: { position: k.position, prevPosition: prev.position, impressions: k.impressions, prevImpressions: prev.impressions, clicks: k.clicks, prevClicks: prev.clicks, ctr: k.ctr },
      gain: rising
        ? gainFromMove(model, k.impressions, k.position, Math.max(1, k.position - 3))
        : gainFromMove(model, k.impressions, k.position, prev.position),
      evidence, evidenceReason: reason,
      urgency: rising ? 1 : 1.25,
    })
    covered.add(q)
  }

  // 3. Lage doorklik op pagina 1: alleen waar je op die positie écht meer clicks mag verwachten
  const ctrDrafts: Draft[] = []
  for (const k of input.keywords) {
    const q = k.keys[0]
    if (covered.has(q) || k.position > 10 || k.impressions < 50) continue
    const expected = model.at(k.position)
    if (k.ctr >= expected * 0.5) continue
    const [evidence, reason] = evidenceFromImpressions(k.impressions, 300, 100)
    ctrDrafts.push({
      key: signalKey("ctr", q),
      kind: "ctr",
      query: q,
      headline: q,
      title: `Wordt gezien maar weinig aangeklikt: ${pct(k.ctr)} op positie ${pos(k.position)}`,
      summary: `Op positie ${pos(k.position)} klikt gemiddeld ${pct(expected)} door. Hier ${num(k.clicks)} clicks op ${num(k.impressions)} vertoningen: de zoekresultaat-tekst overtuigt niet.`,
      metrics: { position: k.position, impressions: k.impressions, clicks: k.clicks, ctr: k.ctr },
      gain: Math.max(0, k.impressions * expected - k.clicks),
      evidence, evidenceReason: reason,
    })
  }
  ctrDrafts.sort((a, b) => b.gain - a.gain).slice(0, 4).forEach(d => { drafts.push(d); covered.add(d.query!) })

  // 4. Kansen: net onder of net buiten pagina 1
  const kansDrafts: Draft[] = []
  const pinned = new Set(input.pinned || [])
  const extra = (input.pinnedRows || []).filter(r => !kwMap.has(r.keys[0]) && pinned.has(signalKey("kans", r.keys[0])))
  for (const k of [...input.keywords, ...extra]) {
    const q = k.keys[0]
    if (covered.has(q) || k.position < 8.5 || k.position > 20 || k.impressions < (pinned.has(signalKey("kans", q)) ? 5 : 20)) continue
    kansDrafts.push(kansDraft(k, model))
  }
  // De 8 sterkste worden vanzelf een taak; wat je zelf op de lijst zette (SEO-kansen › Bijna pagina 1) blijft er ook op
  kansDrafts.sort((a, b) => b.gain - a.gain || (b.metrics.impressions || 0) - (a.metrics.impressions || 0))
    .filter((d, i) => i < 8 || pinned.has(d.key)).forEach(d => { drafts.push(d); covered.add(d.query!) })

  // 5. Pagina's die op een klikbare positie staan maar geen enkele click krijgen
  const pageDrafts: Draft[] = []
  for (const p of input.pages) {
    if (p.clicks > 0 || p.position > 15 || p.impressions < 80) continue
    const path = toPath(p.keys[0])
    const [evidence, reason] = evidenceFromImpressions(p.impressions, 300, 100)
    pageDrafts.push({
      key: signalKey("pagina", path),
      kind: "pagina",
      page: path,
      headline: path,
      title: `${num(p.impressions)} vertoningen, 0 clicks (positie ${pos(p.position)})`,
      summary: `Op deze gemiddelde positie mag je ongeveer ${num(clicksAt(model, p.impressions, p.position), 1)} clicks verwachten. Nul wijst op een zoekresultaat dat niet aansluit bij wat mensen zoeken.`,
      metrics: { position: p.position, impressions: p.impressions, clicks: 0, ctr: 0 },
      gain: clicksAt(model, p.impressions, p.position),
      evidence, evidenceReason: reason,
    })
  }
  pageDrafts.sort((a, b) => b.gain - a.gain).slice(0, 4).forEach(d => drafts.push(d))

  // 6. Twee eigen pagina's over hetzelfde onderwerp (bv. /spouwmuurisolatie en /maatregelen/spouwmuurisolatie)
  const bySlug = new Map<string, GscRow[]>()
  for (const p of input.pages) {
    const path = toPath(p.keys[0])
    if (path === "/" || p.impressions < 30) continue
    const slug = path.split("/").filter(Boolean).pop()!.replace(/(en|s)$/, "")
    if (slug.length < 5) continue
    bySlug.set(slug, [...(bySlug.get(slug) || []), p])
  }
  const inv = new Map((input.inventory || []).map(r => [r.path, r]))
  for (const [slug, rows] of bySlug) {
    const paths = rows.map(r => toPath(r.keys[0]))
    const parents = new Set(paths.map(p => p.split("/").slice(0, -1).join("/")))
    if (rows.length < 2 || parents.size < 2) continue
    // Waar komt elke URL uit volgens de nachtelijke HTTP-controle?
    const finalOf = (p: string) => inv.get(p)?.http_final_path || p
    const known = paths.every(p => inv.get(p)?.http_checked_at)
    const finals = new Set(paths.map(finalOf))
    const resolvedText = known && finals.size === 1
      ? `${paths.filter(p => finalOf(p) !== p).join(" en ")} verwijst al door naar ${[...finals][0]} (nachtelijke controle).`
      : null
    // Hoofdpagina: meeste vertoningen onder de pagina's die niet doorverwijzen
    const live = rows.filter(r => finalOf(toPath(r.keys[0])) === toPath(r.keys[0]))
    const pool = live.length ? live : rows
    pool.sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    const best = pool[0]
    const total = rows.reduce((s, r) => s + r.impressions, 0)
    drafts.push({
      key: signalKey("dubbel", slug),
      kind: "dubbel",
      page: toPath(best.keys[0]),
      relatedPages: paths,
      headline: `${paths.length} pagina's over "${slug}"`,
      title: `Eigen pagina's concurreren met elkaar`,
      summary: `${paths.join(" en ")} verschijnen allebei in Google (samen ${num(total)} vertoningen). Google moet kiezen welke de beste is, en kiest dan vaak geen van beide hoog.`,
      metrics: { position: best.position, impressions: total, clicks: rows.reduce((s, r) => s + r.clicks, 0) },
      gain: gainFromMove(model, total, best.position, Math.max(1, best.position - 5)),
      evidence: "redelijk",
      evidenceReason: "Gebaseerd op overeenkomende paden; het zijpaneel controleert per zoekwoord of ze elkaar echt in de weg zitten.",
      urgency: 1.1,
      resolved: resolvedText,
    })
  }

  // Intentie, controleerbare schatting en concrete taak per signaal
  const regions = regionSegments(input.pages.map(p => toPath(p.keys[0])))
  const ga = new Map((input.ga4Pages || []).map(r => [r.path, r]))
  const pagePaths = input.pages.map(p => toPath(p.keys[0]))
  for (const d of drafts) {
    // Welke pagina hoort bij dit signaal? Bij een plaats-zoekwoord de regiopagina van die plaats.
    let page = d.page || null
    if (!page && d.query) {
      const place = placeIn(d.query, regions)
      if (place) page = pagePaths.filter(p => p.startsWith("/regio/") && p.endsWith(`/${place}`)).sort((a, b) => a.length - b.length)[0] || null
    }
    const conv = page ? ga.get(page) : undefined
    d.conversions = input.ga4Pages ? (conv ? { page: page!, sessions: conv.sessions, keyEvents: conv.keyEvents } : page ? { page, sessions: 0, keyEvents: 0 } : null) : null
    d.effort = EFFORT_RISK[d.kind].effort
    d.risk = EFFORT_RISK[d.kind].risk
    d.intent = d.query ? classifyQuery(d.query, regions, isBrandQuery(d.query)) : classifyPage(d.page || "/")
    // Pas ná het bepalen van de zoekintentie: afwijzingen tellen bij dezelfde soort én intentie
    d.rejectedSimilar = (input.feedback || []).filter(f => f.key !== d.key && f.kind === d.kind && (f.intent || null) === (d.intent || null)).length
    d.place = d.query ? placeIn(d.query, regions) : null
    d.estimate = estimateFor(d, model)
    if (d.estimate) d.gain = d.estimate.gain
    d.action = actionFor(d, d.intent, d.place)
    // Meerdere wegen naar Borne: is deze route hier al geprobeerd zonder effect (of loopt hij nog)? Dan de volgende.
    if (input.tries?.length && (page || d.query)) {
      const tries = triesFor(input.tries.filter(t => t.key !== d.key), { page, query: d.query })
      const next = nextRouteFor(d.action, tries)
      if (next) {
        d.routeNote = `${next.reason}${next.route ? ` Daarom nu: ${ROUTE_LABEL[next.route].toLowerCase()}.` : ""}`
        d.action = routeAction(next.route, page || d.page || "de pagina", d.query || null)
      }
    }
  }

  // Technische blokkades uit de pagina-audit: gegroepeerd, en altijd boven inhoudelijke kansen
  const techDrafts: Draft[] = []
  if (input.inventory?.length) {
    const errors = input.inventory.filter(r => r.in_sitemap && r.http_status && r.http_status >= 400)
    if (errors.length) {
      const sameName = errors.filter(r => r.page_type === "plaats" && r.plaats === r.gemeente).length
      techDrafts.push({
        key: signalKey("techniek", "sitemap-fouten"),
        kind: "techniek",
        headline: `${num(errors.length)} sitemap-URL's geven een foutmelding`,
        title: `Google stuit op ${num(errors.length)} foutpagina's uit je eigen sitemap`,
        summary: "Technische blokkade: deze URL's staan in de sitemap maar bestaan niet. Gaat vóór inhoudelijke optimalisaties.",
        metrics: {}, gain: 0, evidence: "sterk",
        evidenceReason: "Zelf gecontroleerd: elke URL is vannacht opgevraagd en gaf een foutcode.",
        action: sameName >= errors.length * 0.6
          ? `Haal de ${num(errors.length)} plaatspagina's met dezelfde naam als de gemeente uit de sitemap en stuur ze door naar de gemeentepagina`
          : `Haal de ${num(errors.length)} foutieve URL's uit de sitemap of herstel de pagina's`,
        tech: { type: "sitemap-fout", pages: errors.map(r => ({ path: r.path, status: r.http_status ?? null, provincie: r.provincie, gemeente: r.gemeente, plaats: r.plaats })) },
      })
    }
    const unindexed = input.inventory.filter(r => !(r.http_status && r.http_status >= 400)).map(r => ({ r, a: assessPage(r) }))
      .filter(x => x.a.status === "niet-geindexeerd" && x.a.priority === "hoog")
    if (unindexed.length) {
      techDrafts.push({
        key: signalKey("techniek", "niet-geindexeerd"),
        kind: "techniek",
        headline: `${num(unindexed.length)} belangrijke ${unindexed.length === 1 ? "pagina" : "pagina's"} niet geïndexeerd`,
        title: "Buiten de opbouwfase en nog niet in Google",
        summary: "Zonder indexering kan een pagina nergens op ranken.",
        metrics: {}, gain: 0, evidence: "sterk",
        evidenceReason: "Volgens de URL-inspectie van Google (pagina-audit).",
        action: unindexed.length === 1 ? `Zorg dat Google ${unindexed[0].r.path} indexeert` : `Zorg dat Google deze ${num(unindexed.length)} pagina's indexeert, te beginnen bij ${unindexed[0].r.path}`,
        tech: { type: "niet-geindexeerd", pages: unindexed.map(x => ({ path: x.r.path, status: x.r.http_status ?? null, provincie: x.r.provincie, gemeente: x.r.gemeente, plaats: x.r.plaats, reason: x.a.reason })) },
      })
    }
  }

  // Controletaken: wat niet (goed) gemeten wordt of niet werkt. Altijd bovenaan, net als technische blokkades.
  for (const c of input.checks || []) {
    techDrafts.push({
      key: signalKey("techniek", `controle-${c.id}`),
      kind: "techniek",
      headline: c.what.length > 90 ? `${c.what.slice(0, 87)}…` : c.what,
      title: `${c.area}: ${c.severity === "error" ? "werkt niet" : "controleren"}`,
      summary: `${c.what} ${c.effect}`,
      metrics: {}, gain: 0, evidence: "sterk",
      evidenceReason: "Automatisch vastgesteld door de controle van het dashboard.",
      action: c.steps[0]?.title || "Controleer en herstel",
      tech: { type: "datakwaliteit", pages: [], check: c },
    })
  }

  // Score en prioriteit. Prioriteit is relatief: de beste kansen in jóuw huidige data,
  // gewogen naar verwachte winst, bewijskracht, urgentie en zoekintentie (zakelijke waarde).
  const scored = [
    // Technische blokkades eerst, op volgorde van omvang
    ...techDrafts.map(d => ({ ...d, ...EFFORT_RISK.techniek, score: 10000 + (d.tech?.check ? (d.tech.check.severity === "error" ? 50 : 5) : d.tech?.pages.length || 0) })),
    ...drafts.map(d => {
      const intentWeight = INTENT_META[d.intent || "informatief"].weight
      // Al opgelost: blijft zichtbaar als "controleer en sluit", maar telt niet mee in de wachtrij
      const score = d.resolved ? 0 : (d.gain + (d.metrics.impressions || 0) * 0.002) * EVIDENCE_WEIGHT[d.evidence] * (d.urgency || 1) * intentWeight
        * EFFORT_FACTOR[d.effort || "laag"] * RISK_FACTOR[d.risk || "laag"] * conversionFactor(d.conversions)
        // Wat je eerder afwees, telt voor vergelijkbare adviezen minder zwaar (max. halvering)
        * Math.max(0.5, Math.pow(0.85, d.rejectedSimilar || 0))
      // Geleerd uit afgeronde metingen: hooguit één les per advies, alleen met voldoende zekerheid
      const lesson = input.lessons?.length ? lessonFor(featuresOf({ kind: d.kind, intent: d.intent, position: d.metrics.position ?? null, page: d.page || d.conversions?.page || null, action: d.action }), input.lessons) : null
      return { ...d, score: score * (lesson?.factor ?? 1), lesson }
    }),
  ].sort((a, b) => b.score - a.score)

  return scored.map((d, i) => {
    let priority: Priority = d.kind === "techniek" ? "hoog" : i < 3 ? "hoog" : i < 8 ? "middel" : "laag"
    if (d.evidence === "zwak" && priority === "hoog") priority = "middel"
    if (isBrandQuery(d.query) && priority === "hoog") priority = "middel"
    if (d.resolved) priority = "laag"
    if (d.kind !== "techniek" && d.gain < 0.2 && priority !== "laag") priority = d.evidence === "sterk" ? "middel" : "laag"
    // Van pagina 1 af: altijd hoog, ongeacht de rangorde (geen merknamen, niet als het al is opgelost)
    if (lostPage1(d) && !d.resolved && !isBrandQuery(d.query)) priority = "hoog"
    const { urgency, ...rest } = d
    void urgency
    return { ...rest, legacyType: LEGACY_TYPE[d.kind], priority, priorityRank: i + 1, generatedAt: now }
  })
}

// Een losse analyse van een zoekwoord of pagina (vanuit SEO-analyses of zoeken)
export function buildAdhocSignal(
  subject: { query?: string; page?: string },
  input: { keywords: GscRow[]; pages: GscRow[] },
  ctrModel?: CtrModel
): Signal {
  const model = ctrModel || buildCtrModel(input.keywords)
  const row = subject.query
    ? input.keywords.find(k => k.keys[0] === subject.query)
    : input.pages.find(p => toPath(p.keys[0]) === subject.page)
  const imp = row?.impressions ?? 0
  const position = row?.position
  const [evidence, reason] = evidenceFromImpressions(imp, 150, 40)
  const id = subject.query ? `query:${subject.query}` : `page:${subject.page}`
  const headline = subject.query || subject.page || ""
  const regions = regionSegments(input.pages.map(p => toPath(p.keys[0])))
  const intent = subject.query ? classifyQuery(subject.query, regions, isBrandQuery(subject.query)) : classifyPage(subject.page || "/")
  const place = subject.query ? placeIn(subject.query, regions) : null
  const metrics = row ? { position: row.position, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr } : {}
  const estimate = estimateFor({ kind: "analyse", metrics }, model)
  return {
    intent, place, estimate,
    action: actionFor({ kind: "analyse", query: subject.query, page: subject.page }, intent, place),
    key: signalKey("analyse", id),
    kind: "analyse",
    legacyType: "analyse",
    query: subject.query,
    page: subject.page,
    headline,
    title: row
      ? `Positie ${pos(position)} · ${num(imp)} vertoningen · ${num(row.clicks)} clicks`
      : "Geen Search Console-data in de laatste 28 dagen",
    summary: row
      ? `Eigen analyse van ${subject.query ? "dit zoekwoord" : "deze pagina"} over de laatste 28 dagen.`
      : "Er zijn in de laatste 28 dagen geen vertoningen gemeten.",
    metrics,
    gain: estimate?.gain ?? 0,
    priority: "laag",
    priorityRank: 0,
    evidence,
    evidenceReason: reason,
    score: 0,
    generatedAt: new Date().toISOString(),
  }
}
