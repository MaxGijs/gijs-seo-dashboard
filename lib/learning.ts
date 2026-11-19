// Wat hebben we geleerd? — lessen uit afgeronde metingen en beslissingen.
// Pure functies: gebruikt door de nachtelijke berekening (server) en bij het toepassen
// op de prioriteit van adviezen (interface).
//
// Veiligheidsregels (afgesproken met Max):
// 1. Elke les toont de conclusie, het bewijs en wat er aan de prioritering verandert.
// 2. Eén regel, overal hetzelfde: élk afgerond resultaat telt direct mee, maar met een gewicht dat
//    groeit naarmate uitkomsten elkaar bevestigen (bijstellen per waarneming). We starten bij een
//    neutrale verwachting en schuiven per resultaat een stukje op; één uitschieter stuurt dus weinig.
//    Afwijzingen tellen ook direct mee (×0,85 per afwijzing, nooit lager dan ×0,5).
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
  type: "prioriteit" | "afwijzing" | "content-afwijzing" | "content-feedback" | "info"
  factor?: number
  match?: LessonMatch
  service?: string | null
  origin?: string
  text: string
}

export interface LessonRejection {
  title: string
  href?: string          // contentkans
  taskKey?: string       // SEO-advies (opent het taakpaneel)
  reasons: string[]      // gekozen redenen (labels)
  note: string | null    // toelichting van de medewerker
  by: string | null
  at: string | null
}

export interface Lesson {
  key: string
  source: "meting" | "afwijzing" | "content" | "feedback"
  title: string
  conclusion: string
  evidence: { n: number; success?: number; fail?: number; rate?: number; baseline?: number; examples?: string[]; reasons?: string[]; items?: { id: string; title: string }[] }  // reasons bij feedback: de herkende zinnen
  confidence: "laag" | "middel" | "hoog"
  effect: LessonEffect | null
  // Alleen bij het lezen (niet opgeslagen): welke afwijzingen zitten erachter, met reden en notitie
  rejections?: LessonRejection[]
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
    if (l.effect?.type !== "prioriteit" || !l.effect.match || !l.effect.factor) continue
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
export interface ContentFact { id?: string; title?: string; service: string | null; origin: string; status: string; tags: string[]; format?: string | null; clicks30?: number | null
  advice?: string | null   // "bijwerken" = bestaande pagina; telt niet mee in vergelijkingen tussen artikelen
  views30?: number | null; leads30?: number | null; engagement30?: number | null   // GA4, eerste 30 dagen
  // Kenmerken van de eigen tekst (uit de ingeleverde PDF/Word)
  text?: { words: number; lengthBucket: "kort" | "middel" | "lang"; readable: boolean; kwIntro: boolean | null; kwCoverage: number | null; cta: boolean } | null }

// Bijstellen per waarneming: we beginnen bij de neutrale verwachting alsof er al PRIOR_STRENGTH
// metingen waren, en elk resultaat verschuift die verwachting. Het effect op de prioriteit is
// EFFECT_SCALE × (verwachting − neutraal), begrensd tussen ×0,7 en ×1,3.
// Voorbeeld bij 50% neutraal: 1 succes → ×1,07 · 3 op rij → ×1,15 · 6 op rij → ×1,2 · succes + mislukking → ×1,0.
export const PRIOR_STRENGTH = 4
export const EFFECT_SCALE = 0.7
export const LESSON_MIN_REJECTIONS = 1

export function updatedFactor(success: number, n: number, baseline: number) {
  const post = (success + PRIOR_STRENGTH * baseline) / (n + PRIOR_STRENGTH)
  return { post, factor: Math.round(Math.min(1.3, Math.max(0.7, 1 + EFFECT_SCALE * (post - baseline))) * 100) / 100 }
}

export function computeLessons(input: { experiments: ExperimentFact[]; decisions: DecisionFact[]; content: ContentFact[] }): Lesson[] {
  const out: Lesson[] = []

  // 1. Metingen: elke afgeronde meting telt mee voor de route (soort aanpassing) die is gekozen.
  //    "Geen duidelijk effect" telt als half mislukt.
  const done = input.experiments.filter(e => e.outcome === "succesvol" || e.outcome === "niet_succesvol" || e.outcome === "onduidelijk")
  const weight = (e: ExperimentFact) => (e.outcome === "onduidelijk" ? 0.5 : 1)
  const decidedN = done.reduce((s, e) => s + weight(e), 0)
  const totalSuccess = done.filter(e => e.outcome === "succesvol").length
  const baseline = decidedN >= 8 ? totalSuccess / decidedN : 0.5
  // Per route; per route en paginasoort of positie pas als die combinatie minstens twee keer voorkwam
  const dims: [(keyof Features)[], number][] = [[["action"], 1], [["action", "pageType"], 2], [["action", "pos"], 2]]
  for (const [dim, min] of dims) {
    const groups = new Map<string, ExperimentFact[]>()
    for (const e of done) {
      if (dim.some(d => e.features[d] === undefined)) continue
      const k = dim.map(d => `${d}=${e.features[d]}`).join("|")
      groups.set(k, [...(groups.get(k) || []), e])
    }
    for (const [k, list] of groups) {
      if (list.length < min) continue
      const success = list.filter(e => e.outcome === "succesvol").length
      const fail = list.filter(e => e.outcome === "niet_succesvol").length
      const unclear = list.filter(e => e.outcome === "onduidelijk").length
      const n = list.reduce((s, e) => s + weight(e), 0)
      const { post, factor } = updatedFactor(success, n, baseline)
      if (Math.abs(factor - 1) < 0.03) continue
      const match = Object.fromEntries(k.split("|").map(p => p.split("="))) as LessonMatch
      const confidence = list.length >= 6 ? "hoog" : list.length >= 3 ? "middel" : "laag"
      const good = factor > 1
      out.push({
        key: `meting|${k}`, source: "meting",
        title: `${describeMatch(match)} ${good ? (list.length === 1 ? "werkten hier één keer" : "werken tot nu toe goed") : (list.length === 1 ? "werkten hier één keer niet" : "leveren tot nu toe weinig op")}`,
        conclusion: `${success} geslaagd, ${fail} niet geslaagd${unclear ? `, ${unclear} zonder duidelijk effect` : ""} (${list.length} ${list.length === 1 ? "meting" : "metingen"}). Verwachte slagingskans nu ${pctNl(post)}, tegen ${pctNl(baseline)} ${decidedN >= 8 ? "gemiddeld" : "als neutrale start"}.${list.length < 3 ? " Nog weinig bewijs: het effect is daarom klein en groeit als volgende resultaten dit bevestigen." : ""}`,
        evidence: { n: list.length, success, fail, rate: post, baseline, examples: list.slice(0, 6).map(e => e.label) },
        confidence,
        effect: {
          type: "prioriteit", factor, match,
          text: `Vergelijkbare adviezen ${good ? "krijgen iets voorrang" : "zakken iets in de prioriteit"} (×${factorNl(factor)}).`,
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
      title: `${(KIND_LABEL[kind] || kind).replace(/^./, c => c.toUpperCase())}${intent !== "-" ? ` (${INTENT_LABEL[intent] || intent})` : ""}: ${list.length}× afgewezen`,
      conclusion: `${list.length}× afgewezen, ${accepted}× opgepakt.${reasons.length ? ` Genoemde redenen: ${reasons.map(r => `"${r}"`).join(", ")}.` : ""}`,
      evidence: { n: list.length, success: accepted, reasons },
      confidence: list.length >= 6 ? "hoog" : list.length >= 3 ? "middel" : "laag",
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
    list.forEach(c => c.tags.filter(t => t !== "opmerking").forEach(t => tags.set(t, (tags.get(t) || 0) + 1)))
    const factor = Math.max(0.5, Math.pow(0.85, list.length))
    out.push({
      key: `content|${k}`, source: "content",
      title: `Contentkansen ${origin === "actualiteit" ? "uit nieuws" : origin === "zoekdata" ? "uit zoekdata" : origin === "seizoen" ? "uit de seizoenskalender" : origin === "trend" ? "uit webtrends" : "van eigen ideeën"} over ${service === "-" ? "algemene onderwerpen" : service.replace(/-/g, " ")} — ${list.length}× afgewezen`,
      conclusion: `${list.length}× afgewezen.${tags.size ? ` Meest genoemd: ${[...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n}×)`).join(", ")}.` : ""}`,
      evidence: { n: list.length, reasons: [...tags.keys()], items: list.filter(c => c.id && c.title).slice(0, 10).map(c => ({ id: c.id!, title: c.title! })) },
      confidence: list.length >= 6 ? "hoog" : list.length >= 3 ? "middel" : "laag",
      effect: { type: "content-afwijzing", factor, service: service === "-" ? null : service, origin, text: `Nieuwe kansen van deze soort krijgen een lagere score (nu ×${factorNl(factor)}).` },
    })
  }
  const measured = input.content.filter(c => c.status === "gepubliceerd" && c.advice !== "bijwerken" && c.clicks30 !== null && c.clicks30 !== undefined)
  const byFormat = new Map<string, ContentFact[]>()
  for (const c of measured) if (c.format) byFormat.set(c.format, [...(byFormat.get(c.format) || []), c])
  const avgAll = measured.length ? measured.reduce((s, c) => s + (c.clicks30 || 0), 0) / measured.length : 0
  for (const [format, list] of byFormat) {
    if (list.length < 3) continue
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
  // Schrijfstijl: welke kenmerken van eigen teksten gaan samen met meer bezoek, langer lezen of meer aanvragen?
  const METRICS: { key: string; label: string; unit: string; get: (c: ContentFact) => number | null; min: number }[] = [
    { key: "bezoek", label: "trekken meer bezoekers", unit: "keer bekeken", get: c => c.views30 ?? c.clicks30 ?? null, min: 4 },
    { key: "aanvragen", label: "leveren meer aanvragen op", unit: "aanvragen", get: c => c.leads30 ?? null, min: 4 },
    { key: "leestijd", label: "worden langer gelezen", unit: "seconden actief", get: c => c.engagement30 ?? null, min: 4 },
  ]
  const TRAITS: { key: string; label: (v: string) => string; value: (c: ContentFact) => string | null }[] = [
    { key: "lengte", label: v => `Artikelen van ${v === "kort" ? "minder dan 600" : v === "middel" ? "600 tot 1.200" : "meer dan 1.200"} woorden`, value: c => c.text!.lengthBucket },
    { key: "intro", label: v => v === "ja" ? "Artikelen met het hoofdzoekwoord in de inleiding" : "Artikelen zonder het hoofdzoekwoord in de inleiding", value: c => c.text!.kwIntro === null ? null : c.text!.kwIntro ? "ja" : "nee" },
    { key: "b1", label: v => v === "ja" ? "Artikelen op B1-niveau (korte zinnen)" : "Artikelen met lange zinnen", value: c => c.text!.readable ? "ja" : "nee" },
  ]
  for (const m of METRICS) {
    const withText = input.content.filter(c => c.status === "gepubliceerd" && c.advice !== "bijwerken" && c.text && m.get(c) !== null)
    if (withText.length < m.min) continue
    const avgT = withText.reduce((s, c) => s + (m.get(c) || 0), 0) / withText.length
    if (!avgT) continue
    for (const t of TRAITS) {
      const groups = new Map<string, ContentFact[]>()
      for (const c of withText) { const v = t.value(c); if (v) groups.set(v, [...(groups.get(v) || []), c]) }
      for (const [v, list] of groups) {
        if (list.length < 2 || list.length === withText.length) continue
        const avg = list.reduce((s, c) => s + (m.get(c) || 0), 0) / list.length
        if (Math.abs(avg / avgT - 1) < 0.3) continue
        const better = avg > avgT
        out.push({
          key: `content|stijl|${m.key}|${t.key}=${v}`, source: "content",
          title: `${t.label(v)} ${better ? m.label : m.label.replace("meer", "minder").replace("langer", "korter")}`,
          conclusion: `Gemiddeld ${Math.round(avg)} ${m.unit} in de eerste 30 dagen, tegen ${Math.round(avgT)} voor alle gemeten eigen teksten (${list.length} van ${withText.length}).`,
          evidence: { n: list.length },
          confidence: list.length >= 5 ? "middel" : "laag",
          effect: { type: "info", text: "Wordt meegegeven in de briefing via de stijlvoorbeelden van de best presterende artikelen." },
        })
      }
    }
  }
  return out
}
