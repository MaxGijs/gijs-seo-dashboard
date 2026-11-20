// Pagina's volgen (pure functies, getest).
// Welke pagina's volgen we dagelijks, welke stappen zette Google (gevonden, gecrawld, geïndexeerd)
// en wanneer kwamen de eerste vertoning, klik en positie op pagina 1. De nachtelijke controle legt
// elke verandering vast als gebeurtenis, zodat je een tijdlijn ziet in plaats van alleen de laatste stand.

export type PageEventType = "ontdekt" | "gecrawld" | "geindexeerd" | "uit-index" | "eerste-vertoning" | "eerste-klik" | "pagina-1"
export interface PageEvent { path: string; event: PageEventType; at: string; detail?: Record<string, unknown> | null; created_at?: string }

export const EVENT_META: Record<PageEventType, { label: string; good: boolean; text: (e: PageEvent) => string }> = {
  ontdekt: { label: "Gevonden door Google", good: true, text: () => "Google kent de pagina en zet hem in de wachtrij om te crawlen." },
  gecrawld: { label: "Gecrawld", good: true, text: e => e.detail?.again ? "Google heeft de pagina opnieuw opgehaald." : "Google heeft de pagina voor het eerst opgehaald." },
  geindexeerd: { label: "Geïndexeerd", good: true, text: () => "De pagina staat in Google en kan gevonden worden." },
  "uit-index": { label: "Uit de index", good: false, text: e => `Google heeft de pagina uit de index gehaald${e.detail?.state ? ` (${e.detail.state})` : ""}.` },
  "eerste-vertoning": { label: "Eerste vertoning", good: true, text: e => `Voor het eerst getoond in de zoekresultaten${e.detail?.query ? ` op "${e.detail.query}"` : ""}.` },
  "eerste-klik": { label: "Eerste klik", good: true, text: () => "Iemand klikte voor het eerst vanuit Google op de pagina." },
  "pagina-1": { label: "Op pagina 1", good: true, text: e => `Voor het eerst gemiddeld in de top 10${typeof e.detail?.position === "number" ? ` (positie ${String(e.detail.position).replace(".", ",")})` : ""}.` },
}

// Volgorde van de tijdlijn
export const STEPS: PageEventType[] = ["ontdekt", "gecrawld", "geindexeerd", "eerste-vertoning", "eerste-klik", "pagina-1"]

export interface InspectState {
  index_verdict: string | null
  coverage_state: string | null
  last_crawl_time: string | null
  inspected_at: string | null
}

const unknownToGoogle = (s: string | null) => !s || /onbekend|unknown/i.test(s)

// Wat is er veranderd tussen twee controles? (prev = de vorige stand, next = de nieuwe)
export function indexEvents(path: string, prev: InspectState | null, next: InspectState, now: string, watched: boolean): PageEvent[] {
  const out: PageEvent[] = []
  const firstCheck = !prev || !prev.inspected_at
  if (!unknownToGoogle(next.coverage_state) && (firstCheck ? watched && next.index_verdict !== "PASS" : unknownToGoogle(prev!.coverage_state)))
    out.push({ path, event: "ontdekt", at: now, detail: { state: next.coverage_state } })
  // Crawls alleen voor gevolgde pagina's: anders vult elke herhaalde crawl de tabel
  if (watched && next.last_crawl_time && (!prev?.last_crawl_time || next.last_crawl_time > prev.last_crawl_time))
    out.push({ path, event: "gecrawld", at: next.last_crawl_time, detail: { again: !!prev?.last_crawl_time } })
  const wasIndexed = prev?.index_verdict === "PASS", isIndexed = next.index_verdict === "PASS"
  if (isIndexed && !wasIndexed && (!firstCheck || watched))
    out.push({ path, event: "geindexeerd", at: now, detail: prev?.inspected_at ? { between: prev.inspected_at } : null })
  if (wasIndexed && !isIndexed)
    out.push({ path, event: "uit-index", at: now, detail: { state: next.coverage_state } })
  return out
}

// Eerste vertoning, eerste klik, eerste dag gemiddeld op pagina 1 (uit dagcijfers per pagina)
export interface DayRow { date: string; impressions: number; clicks: number; position: number; query?: string }
export function searchMilestones(path: string, days: DayRow[], have: Set<PageEventType>): PageEvent[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const out: PageEvent[] = []
  const at = (d: string) => `${d}T12:00:00Z`
  const imp = sorted.find(d => d.impressions > 0)
  if (imp && !have.has("eerste-vertoning")) out.push({ path, event: "eerste-vertoning", at: at(imp.date), detail: imp.query ? { query: imp.query } : null })
  const click = sorted.find(d => d.clicks > 0)
  if (click && !have.has("eerste-klik")) out.push({ path, event: "eerste-klik", at: at(click.date) })
  const top = sorted.find(d => d.impressions > 0 && d.position > 0 && d.position <= 10)
  if (top && !have.has("pagina-1")) out.push({ path, event: "pagina-1", at: at(top.date), detail: { position: Math.round(top.position * 10) / 10 } })
  return out
}

// ── Welke pagina's volgen we? ───────────────────────────────────────────────

export interface WatchInput {
  advice: { advice_key: string; advice_title?: string | null; status: string; updated_at: string; snapshot: any }[]
  experiments: { advice_key: string; page: string | null; changed_at: string; baseline: any }[]
  ideas: { id: string; title: string; status: string; published_at: string | null; published_url: string | null; target_page: string | null; advice?: string | null }[]
  pages: { path: string; page_type: string | null; in_sitemap: boolean; index_verdict: string | null; http_status: number | null }[]
}
export interface WatchReason { kind: "taak" | "meting" | "content" | "kernpagina"; text: string; ref?: string }

const ACTIVE = new Set(["goedgekeurd", "in_uitvoering", "uitgevoerd", "in_evaluatie"])
const CORE_TYPES = new Set(["home", "maatregel", "artikel", "overig"])
const pathOf = (u: string | null | undefined) => {
  if (!u) return null
  const p = u.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").split(/[?#]/)[0] || "/"
  return p.length > 1 ? p.replace(/\/$/, "") : p
}
const daysBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86400000

export const WATCH_LIMIT = 150

export function watchReasons(input: WatchInput, now = new Date().toISOString()): Map<string, WatchReason[]> {
  const out = new Map<string, WatchReason[]>()
  const add = (path: string | null, r: WatchReason) => {
    if (!path) return
    const list = out.get(path) || []
    if (!list.some(x => x.kind === r.kind && x.ref === r.ref)) list.push(r)
    out.set(path, list)
  }
  // Open of net uitgevoerde taken over een pagina (ook de pagina's van een indexeringstaak)
  for (const a of input.advice) {
    if (!ACTIVE.has(a.status)) continue
    if ((a.status === "uitgevoerd" || a.status === "in_evaluatie") && daysBetween(a.updated_at, now) > 56) continue
    const s = a.snapshot || {}
    const title = String(a.advice_title || s.headline || a.advice_key).split(" — ")[0]
    const paths = [s.page, s.conversions?.page, ...(s.tech?.type === "niet-geindexeerd" ? (s.tech.pages || []).map((p: any) => p.path) : [])]
    for (const p of paths) add(pathOf(p), { kind: "taak", text: `Taak "${title}"`, ref: a.advice_key })
  }
  // Lopende metingen (56 dagen na de aanpassing)
  for (const e of input.experiments) {
    if (daysBetween(e.changed_at, now) > 56) continue
    for (const p of [e.page, ...((e.baseline?.paths as string[]) || [])]) add(pathOf(p), { kind: "meting", text: "Meting na je aanpassing loopt", ref: e.advice_key })
  }
  // Gepubliceerde of bijgewerkte content (90 dagen)
  for (const i of input.ideas) {
    if (i.status !== "gepubliceerd" || !i.published_at || daysBetween(i.published_at, now) > 90) continue
    add(pathOf(i.published_url || i.target_page), { kind: "content", text: `${i.advice === "bijwerken" ? "Bijgewerkt" : "Gepubliceerd"}: ${i.title}`, ref: i.id })
  }
  // Kernpagina's die (nog) niet in Google staan
  for (const p of input.pages) {
    if (p.in_sitemap && CORE_TYPES.has(p.page_type || "") && p.index_verdict !== "PASS" && !(p.http_status && p.http_status >= 400))
      add(p.path, { kind: "kernpagina", text: "Belangrijke pagina die nog niet in Google staat" })
  }
  // Begrenzen: taken en metingen eerst
  const rank = (rs: WatchReason[]) => Math.min(...rs.map(r => ({ taak: 0, meting: 1, content: 2, kernpagina: 3 })[r.kind]))
  return new Map([...out.entries()].sort((a, b) => rank(a[1]) - rank(b[1])).slice(0, WATCH_LIMIT))
}

// ── Tijdlijn voor de weergave ───────────────────────────────────────────────

export interface TimelineStep { event: PageEventType; label: string; at: string | null; done: boolean }
export function timeline(events: PageEvent[], current: { index_verdict: string | null; last_crawl_time: string | null } | null): { steps: TimelineStep[]; lost: PageEvent | null } {
  const first = (t: PageEventType) => events.filter(e => e.event === t).map(e => e.at).sort()[0] || null
  const lastIndexed = events.filter(e => e.event === "geindexeerd").map(e => e.at).sort().pop() || null
  const lastLost = events.filter(e => e.event === "uit-index").sort((a, b) => a.at.localeCompare(b.at)).pop() || null
  const indexedNow = current?.index_verdict === "PASS"
  const steps = STEPS.map(t => {
    let at = first(t)
    if (t === "gecrawld" && !at && current?.last_crawl_time) at = current.last_crawl_time
    if (t === "geindexeerd") at = lastIndexed
    const done = t === "geindexeerd" ? indexedNow || (!!at && !lastLost) : t === "ontdekt" ? !!at || !!current?.last_crawl_time || indexedNow : t === "gecrawld" ? !!at || indexedNow : !!at
    return { event: t, label: EVENT_META[t].label, at, done }
  })
  return { steps, lost: lastLost && !indexedNow && (!lastIndexed || lastLost.at > lastIndexed) ? lastLost : null }
}
