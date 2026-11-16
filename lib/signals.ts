import type { Evidence, GscRow, Priority, Signal, SignalKind, Streak } from "./types"
import { buildCtrModel, clicksAt, gainFromMove, type CtrModel } from "./ctr"
import { num, pos, pct } from "./format"

export function toPath(url: string) {
  const p = url.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "")
  return p || "/"
}

// De sleutelvorm is gelijk aan de eerdere versie, zodat al opgeslagen statussen blijven kloppen.
const LEGACY_TYPE: Record<SignalKind, string> = {
  "trend-dalend": "trend", "trend-stijgend": "trend", daler: "daler", stijger: "stijger",
  kans: "kans", ctr: "probleem", pagina: "probleem", dubbel: "dubbel", analyse: "analyse",
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

interface Draft extends Omit<Signal, "priority" | "priorityRank" | "score" | "legacyType" | "generatedAt"> {
  urgency?: number
}

export interface SignalInput {
  keywords: GscRow[]       // huidige 28 dagen, gesorteerd op vertoningen
  prevKeywords: GscRow[]   // vorige 28 dagen
  pages: GscRow[]          // huidige 28 dagen
  streaks: Streak[]
}

export function buildSignals(input: SignalInput, ctrModel?: CtrModel): Signal[] {
  const model = ctrModel || buildCtrModel(input.keywords)
  const now = new Date().toISOString()
  const kwMap = new Map(input.keywords.map(k => [k.keys[0], k]))
  const prevMap = new Map(input.prevKeywords.map(k => [k.keys[0], k]))
  const drafts: Draft[] = []
  const covered = new Set<string>() // één signaal per zoekwoord

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
  for (const k of input.keywords) {
    const q = k.keys[0]
    if (covered.has(q) || k.position < 8.5 || k.position > 20 || k.impressions < 20) continue
    const target = k.position <= 10.5 ? 5 : 8
    const [evidence, reason] = evidenceFromImpressions(k.impressions, 150, 40)
    kansDrafts.push({
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
    })
  }
  kansDrafts.sort((a, b) => b.gain - a.gain || (b.metrics.impressions || 0) - (a.metrics.impressions || 0))
    .slice(0, 8).forEach(d => { drafts.push(d); covered.add(d.query!) })

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
  for (const [slug, rows] of bySlug) {
    const paths = rows.map(r => toPath(r.keys[0]))
    const parents = new Set(paths.map(p => p.split("/").slice(0, -1).join("/")))
    if (rows.length < 2 || parents.size < 2) continue
    rows.sort((a, b) => a.position - b.position)
    const best = rows[0]
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
    })
  }

  // Score en prioriteit. Prioriteit is relatief: de beste kansen in jóuw huidige data.
  const scored = drafts.map(d => {
    const brand = isBrandQuery(d.query) ? 0.5 : 1
    const score = (d.gain + (d.metrics.impressions || 0) * 0.002) * EVIDENCE_WEIGHT[d.evidence] * (d.urgency || 1) * brand
    return { ...d, score }
  }).sort((a, b) => b.score - a.score)

  return scored.map((d, i) => {
    let priority: Priority = i < 3 ? "hoog" : i < 8 ? "middel" : "laag"
    if (d.evidence === "zwak" && priority === "hoog") priority = "middel"
    if (d.gain < 0.2 && priority !== "laag") priority = d.evidence === "sterk" ? "middel" : "laag"
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
  return {
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
    metrics: row ? { position: row.position, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr } : {},
    gain: row && position ? gainFromMove(model, imp, position, Math.max(1, position - 3)) : 0,
    priority: "laag",
    priorityRank: 0,
    evidence,
    evidenceReason: reason,
    score: 0,
    generatedAt: new Date().toISOString(),
  }
}
