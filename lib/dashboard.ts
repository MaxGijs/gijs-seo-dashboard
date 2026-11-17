// Dashboard — gedeelde typen en pure hulpfuncties (server én interface).

export type PresetPeriod = "1" | "7" | "28" | "90"
export type Compare = "prev" | "year" | "none"

export interface DashboardQuery {
  period: PresetPeriod | "custom"
  start?: string      // alleen bij custom (JJJJ-MM-DD)
  end?: string
  compare: Compare
  regio?: string | null   // provincie-slug, bv. "overijssel"
  dienst?: string | null  // maatregel-slug, bv. "warmtepomp"
}

export interface Range { start: string; end: string; days: number }

export interface Metric {
  value: number | null
  prev: number | null       // null = geen vergelijking of geen data
}

export interface SeriesPoint {
  date: string
  clicks: number
  impressions: number
  sessions: number | null
  requests: number | null
}

export interface KeywordItem {
  query: string
  position: number
  prevPosition: number | null
  impressions: number
  clicks: number
}

// Beste en slechtste zoekwoorden (zonder merk), met in gewone taal waarom
export interface RankedKeyword extends KeywordItem {
  prevClicks: number | null
  reason: string
  missed?: number   // klikken die je laat liggen t.o.v. een top-3-positie
}

export interface PageItem {
  path: string
  clicks: number
  impressions: number
  position: number | null
  prevClicks: number | null
  prevImpressions: number | null
  sessions: number | null
  prevSessions: number | null
  requests: number | null
}

export interface TrendItem {
  key: string                         // zoekwoord of pad
  weeks: (number | null)[]            // positie per week, oudste eerst (8 weken)
  positionNow: number
  positionThen: number | null
  impressions4w: number
}
export interface TrendSet {
  nieuwPagina1: TrendItem[]
  stijgend: TrendItem[]
  stilstand: TrendItem[]
  dalend: TrendItem[]
  bijna: TrendItem[]
  counts: Record<"nieuwPagina1" | "stijgend" | "stilstand" | "dalend" | "bijna", number>
}

export interface Warning {
  id: string
  severity: "error" | "warning"
  what: string          // wat is er mis
  effect: string        // wat is het gevolg
  action: string        // wat moet er gebeuren
  urgency: string       // hoe urgent
  href?: string
}

export interface DataNote {
  id: string
  title: string
  text: string
  advice: string
}

export interface LeadEvent { name: string; count: number; sessions: number; isKey: boolean }
export interface Measurement {
  status: "ok" | "controleren" | "geen-event" | "fout"
  used: string[]           // events die als energiescanaanvraag tellen
  events: LeadEvent[]      // alle formulier-/aanvraag-achtige events in GA4 (laatste 90 dagen)
  note: string
  advice: string
}

export interface Driver { text: string; tone: "up" | "down" | "flat"; summary?: string }

export interface Conclusion {
  tone: "groei" | "stabiel" | "daling" | "geen-vergelijking"
  headline: string
  body: string
  attention: boolean
}

export interface DashboardData {
  range: Range
  compareRange: Range | null
  dataUntil: string | null
  filters: { regio: string | null; dienst: string | null }
  cards: {
    page1: Metric & { top3: number | null; brandPage1: number | null }
    bijna: Metric
    clicks: Metric
    impressions: Metric
    sessions: Metric
    requests: Metric
    position: Metric
    ctr: Metric
    pageviews: Metric
    users: Metric
  }
  series: SeriesPoint[]
  keywords: { page1: KeywordItem[]; bijna: KeywordItem[]; newPage1: KeywordItem[]; lostPage1: KeywordItem[]; brand: KeywordItem[] }
  ranking?: { best: RankedKeyword[]; worst: RankedKeyword[]; fallers: RankedKeyword[]; minImpressions: number }
  pages: PageItem[]
  channels: { name: string; sessions: number; prevSessions: number | null; requests: number | null }[]
  local: { key: string; label: string; provincie: string | null; clicks: number; impressions: number; prevImpressions: number | null; position: number | null }[]
  drivers: Driver[]
  trends: { keywords: TrendSet; pages: TrendSet; weekEnds: string[] } | null
  warnings: Warning[]
  notes: DataNote[]
  measurement: Measurement
  conclusion: Conclusion
  stalled: { id: string; text: string; href: string; kind: "seo" | "content" }[]
  competitors: { week: string; queries: number; gijsFound: number; domains: { domain: string; count: number; above: number; examples: string[] }[] } | null
  errors: { gsc: string | null; ga4: string | null; trends: string | null }
  campaigns?: { id: string; name: string; kind: string; start: string; end: string; endSet: boolean; regions: string[]; amount: number | null; inCurrent: boolean }[]
}

// Minimum aantal vertoningen (laatste 4 weken) voordat een zoekwoord of pagina in een trendlijst komt.
// Daaronder is een stijging of daling meestal toeval. Alles blijft wel zichtbaar in de volledige lijsten.
export const TREND_MIN_IMPRESSIONS = 10

// Events die als energiescanaanvraag kunnen gelden. Per sessie geteld: een aanvraag die
// meerdere van deze events afvuurt, telt één keer. Gewone contactformulieren tellen niet mee.
export const LEAD_EVENTS = ["energy_scan_request_submitted", "energyscan_requested", "energyscan_requeted", "energy_scan_requested", "lead_created"]
export const FORM_EVENT_RE = /(lead|scan|aanvra|request|form|contact|submit|offerte|conversion|subsidie)/i

export function delta(m: Metric): number | null {
  if (m.value === null || m.prev === null) return null
  return m.value - m.prev
}
export function deltaPct(m: Metric): number | null {
  if (m.value === null || m.prev === null || !m.prev) return null
  return ((m.value - m.prev) / m.prev) * 100
}

export const PERIOD_LABEL: Record<PresetPeriod | "custom", string> = {
  "1": "Laatste dag", "7": "7 dagen", "28": "28 dagen", "90": "90 dagen", custom: "Aangepast",
}
export const COMPARE_LABEL: Record<Compare, string> = {
  prev: "Vorige periode", year: "Vorig jaar", none: "Geen vergelijking",
}

export function queryString(q: DashboardQuery) {
  const p = new URLSearchParams({ period: q.period, compare: q.compare })
  if (q.period === "custom" && q.start && q.end) { p.set("start", q.start); p.set("end", q.end) }
  if (q.regio) p.set("regio", q.regio)
  if (q.dienst) p.set("dienst", q.dienst)
  return p.toString()
}
