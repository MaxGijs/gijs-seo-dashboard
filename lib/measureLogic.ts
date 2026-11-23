// Meetlogica van SEO-experimenten (pure functies, getest).
//
// Dag 0   wijziging vastgelegd met een nulmeting (28 dagen vóór de wijziging)
// Dag 7   signaleringsmeting: heeft Google de gewijzigde pagina's opnieuw gecrawld? Geen oordeel.
// Dag 14  eerste inhoudelijke beoordeling met vervolgadvies (behouden, verder meten, onderzoeken,
//         opnieuw optimaliseren). Voorlopig: nooit automatisch "geslaagd" of "mislukt".
// Dag 28  eindmeting en conclusie, als er genoeg data is
// Dag 56  alleen als verlenging: te weinig data, Google verwerkte de pagina's laat, of de cijfers schommelen te veel
//
// Vergeleken worden even lange perioden: de N dagen na de wijziging tegen de N dagen ervoor.
// Search Console loopt een paar dagen achter; de meting van dag N gebeurt op dag N + LAG, zodat
// alleen complete meetdagen meetellen.
// Beoordeeld wordt alleen wat de wijziging raakt: de aangepaste pagina's en de relevante zoekopdrachten,
// niet de hele website. Geen data is nooit "nul resultaat", maar "onvoldoende data".

export const LAG = 3
export const CRAWL_DAY = 7
export const EARLY_DAY = 14
export const FINAL_DAY = 28
export const EXTENDED_DAY = 56
export const BASELINE_DAYS = 28
export const MIN_IMPRESSIONS = 100     // per 28 dagen, vóór én na de wijziging (ook de geschiktheidscontrole)
export const MAX_SPREAD = 8            // posities verschil tussen de weken (nulmeting en meting)
const QUERY_MIN = 10                   // vertoningen per zoekopdracht per 28 dagen om mee te tellen

export type Effect = "positief" | "neutraal" | "negatief" | "onvoldoende"
export type Level = "hoog" | "redelijk" | "laag"
export type CrawlState = "verwerkt" | "niet-verwerkt" | "onbekend"
export type Advice = "behouden" | "verder meten" | "onderzoeken" | "opnieuw optimaliseren"

// Signaal per meetpunt en per experiment
export const SIGNAL: Record<Effect, { label: string; tone: "success" | "error" | "neutral" | "info" }> = {
  positief: { label: "Positief signaal", tone: "success" },
  negatief: { label: "Negatief signaal", tone: "error" },
  neutraal: { label: "Geen duidelijke verandering", tone: "neutral" },
  onvoldoende: { label: "Onvoldoende data", tone: "info" },
}
export const ADVICE: Record<Advice, string> = {
  behouden: "Behouden",
  "verder meten": "Verder meten",
  onderzoeken: "Onderzoeken",
  "opnieuw optimaliseren": "Opnieuw optimaliseren",
}

export interface Totals { impressions: number; clicks: number; ctr: number; position: number | null; queries: number }
export interface QueryPoint { query: string; tracked: boolean; before: { impressions: number; clicks: number; position: number | null }; after: { impressions: number; clicks: number; position: number | null } }
export interface Window { start: string; end: string; days: number }
// Wat Google toont voor het zoekwoord: de bedoelde pagina of een andere URL (diagnostisch, geen fout)
export interface Ranking { query: string; shown: { page: string; impressions: number; position: number | null }[]; intendedShown: boolean | null }
export interface PagePoint { page: string; before: Totals; after: Totals; ranking: Ranking | null }
export interface Scoped {
  scope: "pagina" | "zoekwoord" | "zoekwoord-pagina"
  pages: string[]
  queries: string[]                 // de zoekwoorden van de aanpassing
  beforeWindow: Window
  afterWindow: Window
  before: Totals
  after: Totals
  main: { label: string; before: number | null; after: number | null }   // positie (of CTR) die beslist
  perQuery: QueryPoint[]
  weeklyAfter: number[]             // gemiddelde positie per week na de wijziging
  points?: PagePoint[]              // per aangepaste pagina (als het er meer dan één zijn)
  ranking?: Ranking | null          // hoofdzoekwoord: welke URL toont Google?
}
export interface Crawl { state: CrawlState; crawled: number; total: number; pages: { path: string; lastCrawl: string | null }[] }

export interface Row { key: string; label: string; before: number | null; after: number | null; abs: number | null; pct: number | null; better: boolean | null; unit: "aantal" | "positie" | "pct" }
export interface PointResult { page: string; signal: Effect; reason: string; rows: Row[]; ranking: Ranking | null }
export interface Report {
  day: number
  provisional: boolean          // dag 14: voorlopig (nooit automatisch geslaagd of mislukt)
  final: boolean                // conclusie (dag 28, of 56 na verlenging)
  extend: boolean               // verlengd tot dag 56
  effect: Effect                // signaal: positief, negatief, geen duidelijke verandering, onvoldoende data
  status: StatusKey
  advice: Advice                // vervolgadvies
  reliability: { level: Level; reasons: string[] }
  rows: Row[]
  points: PointResult[]
  why: string[]                 // wat het signaal bepaalde
  missing: string[]             // wat er nog ontbreekt (bij onvoldoende data of verlengen)
  extendReasons: string[]
  influencedBy: string[]        // andere aanpassingen aan dezelfde pagina of zoekopdracht in de meetperiode
  observed: string              // waargenomen verandering
  contribution: string          // mogelijke bijdrage van de wijziging
  causal: string                // oorzakelijk effect: vrijwel nooit vast te stellen met alleen Search Console
  ranking: Ranking | null
  headline: string              // de conclusie in één zin (binnen tien seconden te begrijpen)
  explanation: string           // korte uitleg in gewone taal
  next: string                  // aanbevolen vervolgstap, concreet
  period: string                // meetperiode in woorden
}

export type StatusKey = "wacht" | "vroeg" | "positief" | "neutraal" | "negatief" | "verlengd" | "afgerond"
export const STATUS: Record<StatusKey, { label: string; tone: "neutral" | "info" | "success" | "error" | "warning" }> = {
  wacht: { label: "Wacht op verwerking door Google", tone: "neutral" },
  vroeg: { label: "Vroege indicatie beschikbaar", tone: "info" },
  positief: { label: "Positief effect", tone: "success" },
  neutraal: { label: "Geen duidelijk effect", tone: "neutral" },
  negatief: { label: "Mogelijk negatief effect", tone: "error" },
  verlengd: { label: "Onvoldoende data — meting verlengd", tone: "warning" },
  afgerond: { label: "Meting afgerond", tone: "neutral" },
}

export const NOT_ENOUGH = "Nog onvoldoende gegevens voor een betrouwbare conclusie. De meting wordt verlengd om meer vertoningen te verzamelen."
export const CAUSAL = "Niet aangetoond. Search Console laat zien wat er gebeurde, niet waarom; seizoen, concurrenten en Google-updates kunnen ook meespelen."

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
export const addDaysIso = (d: string, n: number) => { const x = new Date(`${d.slice(0, 10)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const ds = (d: string) => { const x = new Date(`${d.slice(0, 10)}T12:00:00Z`); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}` }
const nl = (n: number, digits = 0) => n.toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits })

// Even lange perioden: de N dagen na de wijziging tegen de N dagen ervoor
export function windowsFor(changedAt: string, day: number): { before: Window; after: Window } {
  return {
    before: { start: addDaysIso(changedAt, -day), end: addDaysIso(changedAt, -1), days: day },
    after: { start: addDaysIso(changedAt, 1), end: addDaysIso(changedAt, day), days: day },
  }
}
// Op welke dag gebeurt de meting van dag N (Search Console-vertraging)
export const measureDate = (changedAt: string, day: number) => addDaysIso(changedAt, day === CRAWL_DAY ? day : day + LAG)
// Minimum aantal vertoningen voor een periode van N dagen (100 per 28 dagen)
export const minFor = (days: number) => Math.ceil((MIN_IMPRESSIONS * days) / BASELINE_DAYS)

// Kleine stap = meetruis. Zelfde regel als het positiecriterium (lib/measure.ts).
const posStep = (base: number) => Math.max(2, Math.round(base * 0.15 * 10) / 10)
const queryStep = (base: number) => Math.max(1, Math.round(base * 0.1 * 10) / 10)

export function crawlState(changedAt: string, pages: { path: string; lastCrawl: string | null }[]): Crawl {
  const known = pages.filter(p => p.lastCrawl)
  const crawled = known.filter(p => p.lastCrawl!.slice(0, 10) >= changedAt.slice(0, 10)).length
  const state: CrawlState = !pages.length || !known.length ? "onbekend" : crawled >= Math.max(1, Math.ceil(pages.length / 2)) ? "verwerkt" : "niet-verwerkt"
  return { state, crawled, total: pages.length, pages }
}

function row(key: string, label: string, before: number | null, after: number | null, unit: Row["unit"], lowerIsBetter = false): Row {
  const abs = before === null || after === null ? null : Math.round((after - before) * 10000) / 10000
  const pct = before === null || after === null || before === 0 ? null : Math.round(((after - before) / Math.abs(before)) * 1000) / 10
  const better = abs === null || Math.abs(abs) < (unit === "positie" ? 0.1 : unit === "pct" ? 0.0005 : 0.5) ? null : lowerIsBetter ? abs < 0 : abs > 0
  return { key, label, before, after, abs, pct, better, unit }
}
function rowsOf(before: Totals, after: Totals, main: Scoped["main"] | null, metric: "position" | "ctr", withQueries: boolean): Row[] {
  const rows = [
    row("impressions", "Vertoningen", before.impressions, after.impressions, "aantal"),
    row("clicks", "Klikken", before.clicks, after.clicks, "aantal"),
    row("ctr", "CTR", before.ctr, after.ctr, "pct"),
    row("position", main && main.label !== "CTR" ? main.label : "Gemiddelde positie", main && main.label !== "CTR" ? main.before : before.position, main && main.label !== "CTR" ? main.after : after.position, "positie", true),
    ...(withQueries ? [row("queries", "Zoekopdrachten waarop de pagina zichtbaar is", before.queries, after.queries, "aantal")] : []),
  ]
  // De beslissende waarde bovenaan
  const first = metric === "ctr" ? "ctr" : "position"
  return [rows.find(r => r.key === first)!, ...rows.filter(r => r.key !== first)]
}

// Signaal van één meetpunt (één aangepaste pagina): genoeg data, dan positie, vertoningen en klikken samen
export function pointSignal(before: Totals, after: Totals, days: number): { signal: Effect; reason: string } {
  const min = minFor(days)
  if (before.impressions < min || after.impressions < min) return { signal: "onvoldoende", reason: `${nl(before.impressions)} vertoningen vóór en ${nl(after.impressions)} erna; minimaal ${min} per periode nodig.` }
  let score = 0
  const parts: string[] = []
  if (before.position !== null && after.position !== null) {
    const step = posStep(before.position)
    if (after.position <= before.position - step || (before.position > 10 && after.position <= 10)) { score += 2; parts.push(`positie ${nl(before.position, 1)} → ${nl(after.position, 1)}`) }
    else if (after.position >= before.position + step || (before.position <= 10 && after.position > 10)) { score -= 2; parts.push(`positie ${nl(before.position, 1)} → ${nl(after.position, 1)}`) }
  }
  const ip = (after.impressions - before.impressions) / before.impressions
  if (ip >= 0.2) { score += 1; parts.push(`vertoningen +${Math.round(ip * 100)}%`) } else if (ip <= -0.2) { score -= 1; parts.push(`vertoningen ${Math.round(ip * 100)}%`) }
  const cd = after.clicks - before.clicks
  if (cd >= 3 && before.clicks && cd / before.clicks >= 0.2) { score += 1; parts.push(`klikken +${cd}`) } else if (cd <= -3 && before.clicks && cd / before.clicks <= -0.2) { score -= 1; parts.push(`klikken ${cd}`) }
  return { signal: score >= 2 ? "positief" : score <= -2 ? "negatief" : "neutraal", reason: parts.length ? parts.join(", ") : "binnen de normale schommeling" }
}

export interface EvalInput {
  day: number                    // 14, 28 of 56
  metric: "position" | "ctr"
  changedAt: string
  scoped: Scoped | null          // null = Search Console niet bereikbaar
  crawl: Crawl
  otherChanges: string[]         // andere aanpassingen aan dezelfde pagina in de meetperiode
  context: string[]              // overige verstorende factoren (campagnes, lanceringen)
  kind?: "experiment" | "meting" | "validatie"
}

export function evaluate(i: EvalInput): Report {
  const provisional = i.day < FINAL_DAY
  const lastDay = i.day >= EXTENDED_DAY
  const period = `${i.day} dagen na de wijziging (${ds(addDaysIso(i.changedAt, 1))} – ${ds(addDaysIso(i.changedAt, i.day))}) tegen de ${i.day} dagen ervóór (${ds(addDaysIso(i.changedAt, -i.day))} – ${ds(addDaysIso(i.changedAt, -1))})`
  const missing: string[] = [], why: string[] = [], extendReasons: string[] = []
  const s = i.scoped
  const min = minFor(i.day)

  // ── Genoeg data? (geen data is "onvoldoende data", nooit een nulprestatie) ──
  let enough = false
  const beforeImp = s?.before.impressions ?? 0, afterImp = s?.after.impressions ?? 0
  if (!s) missing.push("Search Console kon niet worden gelezen voor deze periode.")
  else {
    enough = beforeImp >= min && afterImp >= min
    if (!enough) missing.push(`Minimaal ${min} vertoningen nodig in elke periode van ${i.day} dagen (100 per 28 dagen). Vóór: ${nl(beforeImp)}; erna: ${nl(afterImp)}.`)
  }
  const crawlPending = i.crawl.state === "niet-verwerkt"
  if (crawlPending) missing.push(`Google heeft ${i.crawl.total - i.crawl.crawled} van de ${i.crawl.total} aangepaste pagina's nog niet opnieuw gecrawld; zonder verwerking zegt een meting niets over de wijziging.`)
  const weeks = s ? s.weeklyAfter.filter(w => Number.isFinite(w) && w > 0) : []
  const spread = weeks.length >= 2 ? Math.max(...weeks) - Math.min(...weeks) : null
  const fluctuating = spread !== null && spread > MAX_SPREAD

  // ── Signaal: meerdere zoekopdrachten en meetwaarden, niet alleen één gemiddelde positie ──
  let effect: Effect = "onvoldoende"
  const drivers: string[] = []      // wat het signaal echt bepaalde (voor de kernuitleg)
  if (s && enough && !crawlPending) {
    let score = 0
    const push = (line: string, delta: number) => { why.push(line); if (delta) drivers.push(line); score += delta }
    const m = s.main
    if (i.metric === "ctr") {
      const up = s.after.ctr >= Math.max(s.before.ctr * 1.2, s.before.ctr + 0.002), down = s.after.ctr <= s.before.ctr * 0.8
      if (up) push(`CTR steeg van ${nl(s.before.ctr * 100, 1)}% naar ${nl(s.after.ctr * 100, 1)}%.`, 2)
      else if (down) push(`CTR daalde van ${nl(s.before.ctr * 100, 1)}% naar ${nl(s.after.ctr * 100, 1)}%.`, -2)
      else push(`CTR ${nl(s.before.ctr * 100, 1)}% → ${nl(s.after.ctr * 100, 1)}%, binnen de normale schommeling.`, 0)
    } else if (m.before !== null && m.after !== null) {
      const b = m.before, a = m.after, step = posStep(b)
      if ((b > 10 && a <= 10) || a <= b - step) push(`${m.label}: van ${nl(b, 1)} naar ${nl(a, 1)} (beter).`, 2)
      else if (a >= b + step || (b <= 10 && a > 10)) push(`${m.label}: van ${nl(b, 1)} naar ${nl(a, 1)} (slechter).`, -2)
      else push(`${m.label}: van ${nl(b, 1)} naar ${nl(a, 1)}, binnen de normale schommeling (±${nl(step, 1)}).`, 0)
    } else if (m.before === null && m.after !== null && m.after <= 20) push(`De pagina verschijnt nu op het zoekwoord (positie ${nl(m.after, 1)}); vóór de wijziging niet.`, 2)
    const qmin = Math.ceil((QUERY_MIN * i.day) / BASELINE_DAYS)
    const comparable = s.perQuery.filter(q => q.before.impressions >= qmin && q.after.impressions >= qmin && q.before.position !== null && q.after.position !== null)
    const up = comparable.filter(q => q.after.position! <= q.before.position! - queryStep(q.before.position!)).length
    const down = comparable.filter(q => q.after.position! >= q.before.position! + queryStep(q.before.position!)).length
    const qd0 = up >= 2 && up >= 2 * Math.max(down, 1) ? 1 : down >= 2 && down >= 2 * Math.max(up, 1) ? -1 : 0
    if (comparable.length) push(`Zoekopdrachten met genoeg vertoningen: ${up} beter, ${down} slechter, ${comparable.length - up - down} gelijk (van ${comparable.length}).`, qd0)
    const impPct = beforeImp ? (afterImp - beforeImp) / beforeImp : 0
    if (impPct >= 0.2) push(`Vertoningen +${Math.round(impPct * 100)}%.`, 1); else if (impPct <= -0.2) push(`Vertoningen ${Math.round(impPct * 100)}%.`, -1)
    const cd = s.after.clicks - s.before.clicks, cPct = s.before.clicks ? cd / s.before.clicks : 0
    if (cd >= 3 && cPct >= 0.2) push(`Klikken +${nl(cd)} (+${Math.round(cPct * 100)}%).`, 1); else if (cd <= -3 && cPct <= -0.2) push(`Klikken ${nl(cd)} (${Math.round(cPct * 100)}%).`, -1)
    const qd = s.after.queries - s.before.queries
    if (s.before.queries >= 5 && Math.abs(qd) >= Math.max(3, s.before.queries * 0.2)) why.push(`Zichtbaar op ${qd > 0 ? "meer" : "minder"} zoekopdrachten (${nl(s.before.queries)} → ${nl(s.after.queries)}).`)
    effect = score >= 2 ? "positief" : score <= -2 ? "negatief" : "neutraal"
  }

  // ── Per aangepaste pagina (meetpunten binnen één experiment) ──
  const points: PointResult[] = (s?.points || []).map(p => ({ page: p.page, ...pointSignal(p.before, p.after, i.day), rows: rowsOf(p.before, p.after, null, i.metric, false), ranking: p.ranking }))

  // ── Verlengen (alleen op dag 28) ──
  let extend = false
  if (i.day === FINAL_DAY) {
    if (!s || !enough) extendReasons.push("te weinig vertoningen voor een betrouwbare conclusie")
    if (crawlPending) extendReasons.push("Google heeft de aangepaste pagina's nog niet (allemaal) opnieuw verwerkt")
    if (fluctuating && enough) extendReasons.push(`de positie schommelt sterk tussen de weken (${nl(spread!, 1)} plaatsen)`)
    extend = extendReasons.length > 0
  }
  const final = !provisional && !extend
  if (lastDay && effect !== "onvoldoende" && fluctuating) why.push(`Let op: de positie schommelde ook na 56 dagen sterk (${nl(spread!, 1)} plaatsen tussen de weken).`)

  // ── Betrouwbaarheid ──
  const rel: string[] = []
  let pts = 0
  if (!s || !enough) rel.push("te weinig vertoningen")
  else if (beforeImp >= 3 * min && afterImp >= 3 * min) { pts += 2; rel.push(`ruim voldoende vertoningen (${nl(beforeImp)} vóór, ${nl(afterImp)} erna)`) }
  else { pts += 1; rel.push(`net voldoende vertoningen (${nl(beforeImp)} vóór, ${nl(afterImp)} erna)`) }
  if (i.crawl.state === "verwerkt") { pts += 1; rel.push("Google heeft de pagina's opnieuw verwerkt") }
  else if (i.crawl.state === "onbekend") rel.push("niet bekend of Google de pagina's opnieuw heeft verwerkt")
  else rel.push("pagina's nog niet opnieuw verwerkt")
  if (spread === null) rel.push("te weinig weken om de schommeling te bepalen")
  else if (fluctuating) { pts -= 1; rel.push(`positie schommelt sterk (${nl(spread, 1)} plaatsen)`) }
  else { pts += 1; rel.push("stabiele cijfers tussen de weken") }
  const comparableN = s ? s.perQuery.filter(q => q.before.impressions > 0 && q.after.impressions > 0).length : 0
  if (comparableN >= 3) { pts += 1; rel.push(`${comparableN} zoekopdrachten te vergelijken`) }
  if (i.otherChanges.length) { pts -= 2; rel.push("andere aanpassingen aan dezelfde pagina in de meetperiode") }
  if (i.context.length) { pts -= 1; rel.push("verstorende factoren in de meetperiode") }
  let level: Level = !s || !enough || crawlPending ? "laag" : pts >= 5 ? "hoog" : pts >= 3 ? "redelijk" : "laag"
  if (provisional && level === "hoog") { level = "redelijk"; rel.push("voorlopig: pas 14 dagen gemeten") }

  // ── Wat Google toont ──
  const ranking = s?.ranking ?? null
  const otherUrl = ranking && ranking.intendedShown === false && ranking.shown[0] ? ranking.shown[0].page : null

  // ── Waargenomen, mogelijke bijdrage, oorzaak ──
  const posRow = s ? (s.main.before !== null && s.main.after !== null ? `${s.main.label.toLowerCase()} ${nl(s.main.before, 1)} → ${nl(s.main.after, 1)}` : null) : null
  const observed = !s ? "Geen gegevens uit Search Console." : !enough
    ? `Te weinig vertoningen om een verandering vast te stellen (${nl(beforeImp)} vóór, ${nl(afterImp)} erna).`
    : [posRow, `vertoningen ${nl(beforeImp)} → ${nl(afterImp)}`, `klikken ${nl(s.before.clicks)} → ${nl(s.after.clicks)}`].filter(Boolean).join("; ") + "."
  const contribution = i.otherChanges.length ? "Niet aan één wijziging toe te schrijven: in dezelfde periode is de pagina ook op een andere manier aangepast."
    : effect === "onvoldoende" ? "Nog niet te beoordelen."
    : effect === "neutraal" ? "Niet zichtbaar: de verandering valt binnen de normale schommeling."
    : `Mogelijk: de ${effect === "positief" ? "verbetering" : "verslechtering"} valt samen met de wijziging en is groter dan de normale schommeling${level === "laag" ? ", maar de gegevens zijn beperkt" : ""}.`

  // ── Vervolgadvies (concreet, ook na 14 dagen) ──
  const finalDate = ds(measureDate(i.changedAt, FINAL_DAY)), extDate = ds(measureDate(i.changedAt, EXTENDED_DAY))
  let advice: Advice
  if (effect === "onvoldoende" || crawlPending) advice = "verder meten"
  else if (effect === "positief") advice = "behouden"
  else if (effect === "negatief") advice = "onderzoeken"
  else advice = provisional ? "verder meten" : "opnieuw optimaliseren"
  if (otherUrl && effect !== "positief" && advice !== "verder meten") advice = "onderzoeken"

  // ── Status, kernzin, uitleg en vervolgstap ──
  const sig = SIGNAL[effect].label.toLowerCase()
  let status: StatusKey, headline: string, explanation: string, next: string
  if (provisional) {
    status = crawlPending ? "wacht" : "vroeg"
    headline = crawlPending ? "Wacht op verwerking door Google." : `Eerste beoordeling: ${sig}.`
    explanation = crawlPending
      ? `Google heeft de aangepaste pagina's nog niet opnieuw verwerkt, dus er is nog geen inhoudelijk oordeel. De eindmeting volgt rond ${finalDate}.`
      : `Voorlopig resultaat na 14 dagen, geen conclusie. ${effect === "onvoldoende" ? "Er zijn nog te weinig vertoningen; dat zegt niets over of de wijziging werkt." : effect === "neutraal" ? "De cijfers vallen binnen de normale schommeling." : drivers.join(" ")} De eindmeting volgt rond ${finalDate}.`
    next = advice === "behouden" ? `Behouden. De pagina is weer vrij om verder aan te werken; doe je dat vóór ${finalDate}, dan wordt de eindmeting als "mogelijk beïnvloed" gemarkeerd.`
      : advice === "onderzoeken" ? `Onderzoeken: kijk of er iets anders aan de pagina is veranderd${otherUrl ? ` en waarom Google voor het zoekwoord ${otherUrl} toont` : ""}. Draai de wijziging nog niet terug; de eindmeting volgt rond ${finalDate}.`
      : `Verder meten: laat de aangepaste pagina's ongemoeid tot de eindmeting rond ${finalDate}.`
  } else if (extend) {
    status = "verlengd"
    headline = "Onvoldoende data — meting verlengd."
    explanation = `${!s || !enough ? NOT_ENOUGH : "Nog geen betrouwbare conclusie mogelijk; de meting wordt verlengd."} Reden: ${extendReasons.join("; ")}. Nieuwe meting rond ${extDate}.`
    next = `Verder meten tot rond ${extDate}. Pas de aangepaste pagina's in die tijd liever niet aan.`
  } else if (effect === "onvoldoende") {
    status = "afgerond"
    headline = "Meting afgerond: onvoldoende gegevens voor een conclusie."
    explanation = `Ook na ${i.day} dagen ${crawlPending ? "heeft Google de pagina's niet opnieuw verwerkt" : "zijn er te weinig vertoningen"} voor een betrouwbare conclusie. Dit betekent niet dat de wijziging niet heeft gewerkt.`
    next = "Opnieuw optimaliseren mag. Meet zulke kleine wijzigingen liever op pagina's met meer vertoningen, of combineer ze tot één groter experiment."
  } else {
    status = effect
    headline = { positief: "Positief effect.", neutraal: "Geen duidelijk effect.", negatief: "Mogelijk negatief effect." }[effect]
    explanation = effect === "neutraal" ? `Na ${i.day} dagen vallen de cijfers binnen de normale schommeling.${why[0] ? ` ${why[0]}` : ""}` : `Na ${i.day} dagen: ${drivers.join(" ")}`
    next = advice === "behouden" ? "Behouden. Probeer dezelfde aanpak op vergelijkbare pagina's."
      : advice === "opnieuw optimaliseren" ? "Opnieuw optimaliseren: niet terugdraaien, maar probeer een grotere aanpassing (meer inhoud of meer interne links)."
      : `Onderzoeken: controleer of er in dezelfde periode iets anders is veranderd${otherUrl ? ` en waarom Google ${otherUrl} toont` : ""}, en overweeg de wijziging (deels) terug te draaien.`
  }
  if (otherUrl) why.push(`Google toont voor "${ranking!.query}" vooral ${otherUrl} in plaats van de aangepaste pagina. Dat is een signaal om te onderzoeken, geen bewijs dat het experiment verkeerd is ingesteld.`)
  if (i.otherChanges.length) {
    explanation += ` Let op: het resultaat is mogelijk beïnvloed door ${i.otherChanges.length === 1 ? "een andere aanpassing" : `${i.otherChanges.length} andere aanpassingen`} aan dezelfde pagina.`
    if (final) next = "Beoordeel deze wijzigingen samen: het effect is niet aan één aanpassing toe te schrijven."
  }
  return {
    day: i.day, provisional, final, extend, effect, status, advice,
    reliability: { level, reasons: rel },
    rows: s ? rowsOf(s.before, s.after, s.main, i.metric, s.scope !== "zoekwoord") : [],
    points, why, missing, extendReasons, influencedBy: i.otherChanges,
    observed, contribution, causal: CAUSAL, ranking,
    headline, explanation, next, period,
  }
}

// ── Status van een lopend of afgerond experiment ────────────────────────────

type ExpLike = { changed_at: string; outcome: string | null; kind?: string | null; result_7d?: any; result_14d?: any; result_28d?: any; result_56d?: any; result_84d?: any }
const isNew = (r: any) => !!r && (r.v === 2 || !!r.report)

// De laatste meting met een rapport (dag 56, 28 of 14)
export function latestReport(e: ExpLike): Report | null {
  return (e.result_56d?.report || e.result_28d?.report || e.result_14d?.report || null) as Report | null
}
// De conclusie (dag 28 zonder verlenging, of dag 56)
export function conclusionOf(e: ExpLike): { result: Record<string, any>; report: Report | null } | null {
  if (isNew(e.result_56d)) return { result: e.result_56d, report: e.result_56d.report || null }
  if (isNew(e.result_28d) && !(e.result_28d.report?.extend || e.result_28d.extend)) return { result: e.result_28d, report: e.result_28d.report || null }
  // Oude metingen (vóór deze meetlogica): de eindmeting was na 56 dagen (84 bij verlenging); historie blijft geldig
  if (!isNew(e.result_28d) && !isNew(e.result_56d)) { const r = e.result_84d || e.result_56d; return r ? { result: r, report: null } : null }
  return null
}

export function statusOf(e: ExpLike): StatusKey {
  const o = e.outcome
  if (o === "succesvol") return "positief"
  if (o === "niet_succesvol") return "negatief"
  if (o === "onduidelijk") return "neutraal"
  if (o) return "afgerond"
  if (isNew(e.result_28d) && (e.result_28d.report?.extend || e.result_28d.extend)) return "verlengd"
  const r = e.result_14d?.report as Report | undefined
  if (r) return r.status === "wacht" ? "wacht" : "vroeg"
  if (e.result_14d) return "vroeg"
  return "wacht"
}

// Volgende meetmoment: 7 (crawl), 14, 28, en 56 alleen bij verlenging
export function nextCheckpoint(e: ExpLike, today = new Date().toISOString().slice(0, 10)): { day: number; date: string; label: string } | null {
  if (e.outcome) return null
  const age = Math.floor((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${e.changed_at.slice(0, 10)}T12:00:00Z`).getTime()) / 86400000)
  const at = (day: number, label: string) => ({ day, date: measureDate(e.changed_at, day), label })
  if (!e.result_7d && !e.result_14d && age < EARLY_DAY) return at(CRAWL_DAY, "signaleringsmeting")
  if (!e.result_14d) return at(EARLY_DAY, "eerste beoordeling")
  if (!isNew(e.result_28d)) return at(FINAL_DAY, "eindmeting")
  if ((e.result_28d.report?.extend || e.result_28d.extend) && !isNew(e.result_56d)) return at(EXTENDED_DAY, "verlengde meting")
  return null
}

// Eindoordeel voor de taak en het leren (pas vanaf dag 28)
export function outcomeFromReport(r: Report): "succesvol" | "niet_succesvol" | "onduidelijk" | null {
  return r.effect === "positief" ? "succesvol" : r.effect === "negatief" ? "niet_succesvol" : r.effect === "neutraal" ? "onduidelijk" : null
}

// Samenvatting over meetpunten (familie of meerdere pagina's)
export function summarizeSignals(signals: Effect[]): { counts: Record<Effect, number>; overall: Effect; text: string } {
  const counts = { positief: 0, negatief: 0, neutraal: 0, onvoldoende: 0 } as Record<Effect, number>
  for (const s of signals) counts[s]++
  const decided = counts.positief + counts.negatief + counts.neutraal
  const overall: Effect = !decided ? "onvoldoende"
    : counts.positief > counts.negatief + counts.neutraal ? "positief"
    : counts.negatief > counts.positief + counts.neutraal ? "negatief" : "neutraal"
  const parts = (["positief", "negatief", "neutraal", "onvoldoende"] as Effect[]).filter(k => counts[k]).map(k => `${counts[k]} ${SIGNAL[k].label.toLowerCase()}`)
  return { counts, overall, text: parts.join(", ") }
}
