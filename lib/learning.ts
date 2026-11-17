// Wat hebben we geleerd? — lessen uit afgeronde metingen en beslissingen.
// Pure functies: gebruikt door de nachtelijke berekening (server) en bij het toepassen
// op de prioriteit van adviezen (interface).
//
// Veiligheidsregels (afgesproken met Max):
// 1. Elke les toont de conclusie, het bewijs en wat er aan de prioritering verandert.
// 2. Eén regel, overal hetzelfde: een les uit metingen ontstaat én wordt toegepast vanaf
//    LESSON_MIN_MEASUREMENTS vergelijkbare afgeronde metingen. Afwijzingen tellen direct mee
//    (×0,85 per afwijzing); vanaf LESSON_MIN_REJECTIONS verschijnt daar een les van.
// 3. Per advies telt hooguit één les mee (de sterkste), zodat effecten niet opstapelen.
// 4. Elke les kan worden teruggedraaid; dat wordt vastgelegd.

import { classifyPath } from "./pages"

export type PosBucket = "1-3" | "4-7" | "8-15" | "16-30" | "30+"
export interface Features {
  kind?: string
  intent?: string
  pos?: PosBucket
  pageType?: string
  action?: string
}
export type LessonMatch = Partial<Features>

export interface LessonEffect {
  type: "prioriteit" | "afwijzing" | "content-afwijzing" | "info"
  factor?: number
  match?: LessonMatch
  service?: string | null
  origin?: string
  text: string
}

export interface Lesson {
  key: string
  source: "meting" | "afwijzing" | "content"
  title: string
  conclusion: string
  evidence: { n: number; success?: number; fail?: number; rate?: number; baseline?: number; examples?: string[]; reasons?: string[] }
  confidence: "laag" | "middel" | "hoog"
  effect: LessonEffect | null
  status?: "actief" | "teruggedraaid" | "vervallen"
  first_seen?: string
  updated_at?: string
  reverted_at?: string | null
  reverted_by?: string | null
}

// ── Kenmerken van een advies ────────────────────────────────────────────────

export function posBucket(p?: number | null): PosBucket | undefined {
  if (p === null || p === undefined || !Number.isFinite(p) || p <= 0) return undefined
  return p <= 3 ? "1-3" : p <= 7 ? "4-7" : p <= 15 ? "8-15" : p <= 30 ? "16-30" : "30+"
}

export function pageGroup(path?: string | null) {
  if (!path) return undefined
  const t = classifyPath(path).type
  if (t === "gemeente" || t === "plaats") return "lokaal"
  if (t === "provincie" || t === "overzicht") return "regio-overzicht"
  if (t === "maatregel") return "maatregel"
  if (t === "home") return "home"
  if (t === "artikel") return "artikel"
  return "overig"
}

export function actionOf(text?: string | null) {
  const t = (text || "").toLowerCase()
  if (!t) return undefined
  if (/interne? link|linkt?ekst|link vanaf|links? naar/.test(t)) return "interne-links"
  if (/title|titel|meta ?descr|h1|kop/.test(t)) return "titel-meta"
  if (/doorverwijz|redirect|sitemap|404|index/.test(t)) return "techniek"
  if (/tekst|inhoud|alinea|faq|veelgestelde|uitbreid|herschrijf|content/.test(t)) return "inhoud"
  return "overig"
}

export function featuresOf(s: { kind?: string; intent?: string; position?: number | null; page?: string | null; action?: string | null }): Features {
  return { kind: s.kind, intent: s.intent, pos: posBucket(s.position), pageType: pageGroup(s.page), action: actionOf(s.action) }
}

export function matches(f: Features, m: LessonMatch) {
  const keys = Object.keys(m) as (keyof Features)[]
  return keys.length > 0 && keys.every(k => f[k] !== undefined && f[k] === m[k])
}

// Sterkste toepasselijke les (alleen actieve prioriteitslessen met minstens middelmatige zekerheid)
export function lessonFor(f: Features, lessons: Pick<Lesson, "key" | "title" | "effect" | "status" | "confidence">[]) {
  let best: { key: string; title: string; factor: number } | null = null
  for (const l of lessons) {
    if (l.status && l.status !== "actief") continue
    if (l.confidence === "laag" || l.effect?.type !== "prioriteit" || !l.effect.match || !l.effect.factor) continue
    if (!matches(f, l.effect.match)) continue
    if (!best || Math.abs(l.effect.factor - 1) > Math.abs(best.factor - 1)) best = { key: l.key, title: l.title, factor: l.effect.factor }
  }
  return best
}

// ── Labels ─────────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  "interne-links": "extra interne links", "titel-meta": "aanpassingen aan title en meta", techniek: "technische reparaties", inhoud: "inhoudelijke uitbreidingen", overig: "overige aanpassingen",
}
const PAGE_LABEL: Record<string, string> = {
  lokaal: "lokale pagina's", "regio-overzicht": "provincie- en overzichtspagina's", maatregel: "maatregelpagina's", home: "de homepage", artikel: "artikelen", overig: "overige pagina's",
}
const KIND_LABEL: Record<string, string> = {
  kans: "kansen net buiten pagina 1", stijger: "stijgers", daler: "dalers", "trend-stijgend": "stijgende trends", "trend-dalend": "dalende trends",
  ctr: "CTR-adviezen", pagina: "pagina-adviezen", dubbel: "dubbele pagina's", techniek: "technische adviezen", eigen: "eigen taken", analyse: "analyses",
}
const INTENT_LABEL: Record<string, string> = { lokaal: "lokale", commercieel: "commerciële", informatief: "informatieve", merk: "merk" }

export function describeMatch(m: LessonMatch) {
  const parts: string[] = []
  const subject = m.action ? ACTION_LABEL[m.action] || m.action : m.kind ? KIND_LABEL[m.kind] || m.kind : "aanpassingen"
  parts.push(subject.charAt(0).toUpperCase() + subject.slice(1))
  if (m.action && m.kind) parts.push(`bij ${KIND_LABEL[m.kind] || m.kind}`)
  if (m.pageType) parts.push(`op ${PAGE_LABEL[m.pageType] || m.pageType}`)
  if (m.intent) parts.push(`voor ${INTENT_LABEL[m.intent] || m.intent} zoekwoorden`)
  if (m.pos) parts.push(`rond positie ${m.pos.replace("-", "–")}`)
  return parts.join(" ")
}

const pctNl = (r: number) => `${Math.round(r * 100)}%`
const factorNl = (f: number) => f.toFixed(2).replace(/0$/, "").replace(".", ",")

// ── Berekening ──────────────────────────────────────────────────────────────

export interface ExperimentFact { outcome: "succesvol" | "niet_succesvol" | "onduidelijk" | null; features: Features; label: string }
export interface DecisionFact { kind: string; intent?: string; status: string; note?: string | null }
export interface ContentFact { service: string | null; origin: string; status: string; tags: string[]; format?: string | null; clicks30?: number | null }

export const LESSON_MIN_MEASUREMENTS = 6
export const LESSON_MIN_REJECTIONS = 3
export const MIN_GROUP = LESSON_MIN_MEASUREMENTS

export function computeLessons(input: { experiments: ExperimentFact[]; decisions: DecisionFact[]; content: ContentFact[] }): Lesson[] {
  const out: Lesson[] = []

  // 1. Metingen: welke soort aanpassing werkt beter of slechter dan gemiddeld?
  const decided = input.experiments.filter(e => e.outcome === "succesvol" || e.outcome === "niet_succesvol")
  const totalSuccess = decided.filter(e => e.outcome === "succesvol").length
  const baseline = decided.length >= 8 ? totalSuccess / decided.length : 0.5
  const dims: (keyof Features)[][] = [["action"], ["pos"], ["pageType"], ["kind"], ["intent"], ["action", "pos"], ["action", "pageType"], ["kind", "pos"]]
  for (const dim of dims) {
    const groups = new Map<string, ExperimentFact[]>()
    for (const e of decided) {
      if (dim.some(d => e.features[d] === undefined)) continue
      const k = dim.map(d => `${d}=${e.features[d]}`).join("|")
      groups.set(k, [...(groups.get(k) || []), e])
    }
    for (const [k, list] of groups) {
      if (list.length < MIN_GROUP) continue
      const success = list.filter(e => e.outcome === "succesvol").length
      const rate = success / list.length
      const diff = rate - baseline
      if (Math.abs(diff) < 0.2) continue
      const match = Object.fromEntries(k.split("|").map(p => p.split("="))) as LessonMatch
      const factor = Math.round(Math.min(1.3, Math.max(0.7, 1 + diff)) * 20) / 20
      const confidence = list.length >= 12 ? "hoog" : "middel"
      const good = diff > 0
      out.push({
        key: `meting|${k}`, source: "meting",
        title: `${describeMatch(match)} ${good ? "werken bovengemiddeld goed" : "leveren weinig op"}`,
        conclusion: `${success} van ${list.length} vergelijkbare aanpassingen ${success === 1 ? "verbeterde" : "verbeterden"} (${pctNl(rate)}), tegen ${pctNl(baseline)} ${decided.length >= 8 ? "gemiddeld" : "als neutrale verwachting (nog te weinig metingen voor een eigen gemiddelde)"}.`,
        evidence: { n: list.length, success, fail: list.length - success, rate, baseline, examples: list.slice(0, 6).map(e => e.label) },
        confidence,
        effect: {
          type: "prioriteit", factor, match,
          text: `Vergelijkbare adviezen ${good ? "krijgen voorrang" : "zakken in de prioriteit"} (×${factorNl(factor)}).`,
        },
      })
    }
  }

  // 2. Afgewezen adviezen: welke soort advies past niet bij Gijs?
  const rej = input.decisions.filter(d => (d.status === "afgewezen" || d.status === "onvoldoende_bewijs") && !(d.note || "").startsWith("Al opgelost"))
  const byGroup = new Map<string, DecisionFact[]>()
  for (const d of rej) byGroup.set(`${d.kind}|${d.intent || "-"}`, [...(byGroup.get(`${d.kind}|${d.intent || "-"}`) || []), d])
  for (const [k, list] of byGroup) {
    if (list.length < LESSON_MIN_REJECTIONS) continue
    const [kind, intent] = k.split("|")
    const accepted = input.decisions.filter(d => d.kind === kind && (d.intent || "-") === intent && ["goedgekeurd", "in_uitvoering", "uitgevoerd", "in_evaluatie", "succesvol", "niet_succesvol"].includes(d.status)).length
    const reasons = [...new Set(list.map(d => (d.note || "").trim()).filter(Boolean))].slice(0, 5)
    const factor = Math.max(0.5, Math.pow(0.85, list.length))
    out.push({
      key: `afwijzing|${k}`, source: "afwijzing",
      title: `${(KIND_LABEL[kind] || kind).replace(/^./, c => c.toUpperCase())}${intent !== "-" ? ` (${INTENT_LABEL[intent] || intent})` : ""} worden vaak afgewezen`,
      conclusion: `${list.length}× afgewezen, ${accepted}× opgepakt.${reasons.length ? ` Genoemde redenen: ${reasons.map(r => `"${r}"`).join(", ")}.` : ""}`,
      evidence: { n: list.length, success: accepted, reasons },
      confidence: list.length >= 6 ? "hoog" : "middel",
      effect: { type: "afwijzing", factor, match: { kind, ...(intent !== "-" ? { intent } : {}) }, text: `Nieuwe adviezen van deze soort zakken in de prioriteit (nu ×${factorNl(factor)}; ×0,85 per afwijzing, nooit lager dan ×0,5). Ze blijven wel zichtbaar.` },
    })
  }

  // 3. Content: afwijzingen per dienst en herkomst, en (later) resultaten per format
  const cRej = input.content.filter(c => c.status === "afgewezen")
  const cGroups = new Map<string, ContentFact[]>()
  for (const c of cRej) cGroups.set(`${c.service || "-"}|${c.origin}`, [...(cGroups.get(`${c.service || "-"}|${c.origin}`) || []), c])
  for (const [k, list] of cGroups) {
    if (list.length < LESSON_MIN_REJECTIONS) continue
    const [service, origin] = k.split("|")
    const tags = new Map<string, number>()
    list.forEach(c => c.tags.forEach(t => tags.set(t, (tags.get(t) || 0) + 1)))
    const factor = Math.max(0.5, Math.pow(0.85, list.length))
    out.push({
      key: `content|${k}`, source: "content",
      title: `Contentkansen ${origin === "actualiteit" ? "uit nieuws" : origin === "zoekdata" ? "uit zoekdata" : origin === "seizoen" ? "uit de seizoenskalender" : origin === "trend" ? "uit webtrends" : "van eigen ideeën"} over ${service === "-" ? "algemene onderwerpen" : service.replace(/-/g, " ")} worden vaak afgewezen`,
      conclusion: `${list.length}× afgewezen.${tags.size ? ` Meest genoemd: ${[...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n}×)`).join(", ")}.` : ""}`,
      evidence: { n: list.length, reasons: [...tags.keys()] },
      confidence: list.length >= 6 ? "hoog" : "middel",
      effect: { type: "content-afwijzing", factor, service: service === "-" ? null : service, origin, text: `Nieuwe kansen van deze soort krijgen een lagere score (nu ×${factorNl(factor)}).` },
    })
  }
  const measured = input.content.filter(c => c.status === "gepubliceerd" && c.clicks30 !== null && c.clicks30 !== undefined)
  const byFormat = new Map<string, ContentFact[]>()
  for (const c of measured) if (c.format) byFormat.set(c.format, [...(byFormat.get(c.format) || []), c])
  const avgAll = measured.length ? measured.reduce((s, c) => s + (c.clicks30 || 0), 0) / measured.length : 0
  for (const [format, list] of byFormat) {
    if (list.length < LESSON_MIN_MEASUREMENTS) continue
    const avg = list.reduce((s, c) => s + (c.clicks30 || 0), 0) / list.length
    if (!avgAll || Math.abs(avg / avgAll - 1) < 0.3) continue
    out.push({
      key: `content|format=${format}`, source: "content",
      title: `${format} ${avg > avgAll ? "trekt meer bezoekers dan gemiddeld" : "trekt minder bezoekers dan gemiddeld"}`,
      conclusion: `Gemiddeld ${Math.round(avg)} klikken na 30 dagen, tegen ${Math.round(avgAll)} voor alle gemeten publicaties (${list.length} van ${measured.length} publicaties).`,
      evidence: { n: list.length },
      confidence: "middel",
      effect: { type: "info", text: "Alleen ter informatie: het systeem past dit nog niet zelf toe." },
    })
  }
  return out
}
