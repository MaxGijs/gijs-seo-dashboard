export interface GscRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

export interface Streak {
  query: string
  weeks: number
  direction: "stijgend" | "dalend"
  positionNow: number
  positionWeeksAgo: number
  impressions: number
}

export type SignalKind =
  | "trend-dalend" | "trend-stijgend" | "daler" | "stijger"
  | "kans" | "ctr" | "pagina" | "dubbel" | "analyse" | "techniek" | "eigen"

// Waar een cijfer over gaat. Search Console telt per zoekwoord (alle eigen pagina's samen,
// elke zoekopdracht één keer) anders dan per pagina (elke getoonde pagina telt mee).
export type ScopeKind = "zoekwoord" | "pagina" | "zoekwoord-pagina" | "paginagroep" | "inventaris" | "geen"
export interface MetricScope {
  kind: ScopeKind
  query?: string
  page?: string
  pages?: string[]
  window?: { startDate: string; endDate: string } | null
  source: "lijst" | "live" | "inventaris"
}

// Soort aanpassing: bepaalt nulmeting en succescriterium
export type ActionType = "technisch" | "indexering" | "consolidatie" | "snippet" | "ranking" | "merk" | "geen" | "handmatig" | "controle"

// Technisch signaal uit de pagina-audit (gegroepeerd)
export interface DataCheck {
  id: string
  area: string                // waar het over gaat: "Meting", "Nieuwsbronnen", "Synchronisatie"
  severity: "error" | "warning"
  what: string                // wat is er mis
  effect: string              // wat is het gevolg
  steps: { title: string; detail: string }[]
}

export interface TechIssue {
  type: "sitemap-fout" | "niet-geindexeerd" | "datakwaliteit"
  check?: DataCheck
  pages: { path: string; status: number | null; provincie: string | null; gemeente: string | null; plaats: string | null; reason?: string }[]
}

export type Priority = "hoog" | "middel" | "laag"
export type Intent = "merk" | "lokaal" | "commercieel" | "informatief"

// De rekensom achter "≈ x extra clicks", zodat die controleerbaar is
export interface Estimate {
  basis: "positie" | "doorklik"
  impressions: number
  fromPosition: number
  toPosition: number
  ctrFrom: number
  ctrTo: number
  gain: number
  low: number
  high: number
  source: "eigen" | "benchmark" | "gemengd"
  scenario?: string
  scopeRows?: { label: string; value: string }[]   // extra regels die de scope van de som uitleggen
  expectedClicks: number   // verwachte clicks per 28 d in het doelscenario
  noise: number            // natuurlijke schommeling (±√clicks)
}
export type Evidence = "sterk" | "redelijk" | "zwak"

export interface SignalMetrics {
  position?: number
  prevPosition?: number
  impressions?: number
  prevImpressions?: number
  clicks?: number
  prevClicks?: number
  ctr?: number
  weeks?: number
}

export interface Signal {
  key: string
  kind: SignalKind
  legacyType: string          // advice_type in de database (compatibel met bestaande statussen)
  query?: string
  page?: string               // pad, bv. /regio/overijssel/borne
  relatedPages?: string[]     // bij dubbele pagina's
  headline: string            // kort onderwerp: zoekwoord of pad
  title: string               // één zin: wat er speelt
  summary: string             // waarom dit opvalt, met cijfers
  metrics: SignalMetrics
  gain: number                // indicatieve extra clicks per 28 dagen
  priority: Priority
  priorityRank: number
  evidence: Evidence
  evidenceReason: string
  score: number
  generatedAt: string
  intent?: Intent
  action?: string             // concrete taak in één zin
  place?: string | null       // plaatsnaam uit het zoekwoord (regio-segment)
  estimate?: Estimate
  scope?: MetricScope         // waar metrics over gaan (datacontract)
  resolved?: string | null    // al opgelost (bv. doorverwijzing staat): uitleg
  tech?: TechIssue            // alleen bij kind "techniek"
  description?: string        // eigen taak: wat er moet gebeuren
  rejectedSimilar?: number    // eerder afgewezen adviezen van dezelfde soort en intentie
  effort?: Level              // benodigde inspanning
  risk?: Level                // risico dat de wijziging iets anders verslechtert
  conversions?: { page: string; sessions: number; keyEvents: number } | null  // GA4, laatste 28 dagen
  lesson?: { key: string; title: string; factor: number } | null  // prioriteit aangepast door een les
}

export type Level = "laag" | "middel" | "hoog"

export type Status =
  | "nieuw" | "onderzoeken" | "uitgesteld" | "goedgekeurd" | "in_uitvoering"
  | "uitgevoerd" | "in_evaluatie" | "succesvol" | "niet_succesvol" | "afgewezen" | "onvoldoende_bewijs"

export interface AdviceRecord {
  advice_key: string
  advice_title: string
  advice_type: string
  status: Status
  note: string | null
  snapshot: Signal | null
  snooze_until: string | null
  owner?: string | null
  created_at: string
  updated_at: string
}

export interface Experiment {
  id: string
  advice_key: string
  description: string
  changed_at: string
  baseline: Record<string, any>
  result_14d: Record<string, any> | null
  result_28d: Record<string, any> | null
  result_56d: Record<string, any> | null
  outcome: "succesvol" | "niet_succesvol" | "onduidelijk" | null
  query: string | null
  page: string | null
  created_at: string
  hypothesis?: string | null
  target_pages?: string[] | null
  target_queries?: string[] | null
  predicted?: { gain: number | null; low: number | null; high: number | null; metric: string } | null
}

export interface Task {
  key: string
  signal: Signal
  status: Status
  note: string | null
  snoozeUntil: string | null
  snoozed: boolean            // uitgesteld en de datum is nog niet bereikt
  current: boolean            // signaal komt voor in de actuele data
  updatedAt: string | null
  experiments: Experiment[]
  owner?: string | null       // e-mail van wie de taak oppakt
}

export interface PageAudit {
  url: string
  ok: boolean
  status?: number
  error?: string
  finalUrl?: string
  title?: string
  metaDescription?: string
  h1: string[]
  h2: string[]
  wordCount: number
  internalLinks: number
  canonical?: string
  noindex: boolean
}

export interface MetricSet { clicks: number; impressions: number; ctr: number; position: number }

export interface AdviceDetail {
  query: string | null
  page: string | null
  window: { startDate: string; endDate: string }
  prevWindow: { startDate: string; endDate: string }
  queryTotals?: { cur: MetricSet | null; prev: MetricSet | null }
  queryPages?: { cur: (MetricSet & { path: string })[]; prev: (MetricSet & { path: string })[] }
  pageTotals?: { cur: MetricSet | null; prev: MetricSet | null }
  pageQueries?: (MetricSet & { query: string })[]
  history?: { weekStart: string; clicks: number; impressions: number; position: number; days: number }[]
  auditTarget?: string | null
  intendedPage?: string | null
  pageInfo?: import("./pages").PageRow | null
  audit?: PageAudit
  relatedTotals?: { path: string; cur: MetricSet | null }[]
  redirects?: { path: string; status?: number; finalPath?: string; redirected: boolean; error?: string }[]
  errors: string[]
}
