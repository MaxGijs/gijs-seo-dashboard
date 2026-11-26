// CrUX History (pure functies, getest): echte laadsnelheid van Chrome-gebruikers per week,
// tot 40 weken terug. Per periode van 28 dagen het 75e percentiel (wat 3 op de 4 bezoekers halen).

export interface CruxPoint {
  scope: string           // "origin" of een pad (/regio/...)
  form_factor: "PHONE" | "DESKTOP"
  period_start: string    // YYYY-MM-DD
  period_end: string
  lcp_ms: number | null
  inp_ms: number | null
  cls: number | null
  fcp_ms: number | null
  ttfb_ms: number | null
}

export const CRUX_METRICS = ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift", "first_contentful_paint", "experimental_time_to_first_byte"] as const

const day = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
const val = (v: unknown) => { if (v === null || v === undefined || v === "NaN") return null; const n = Number(v); return Number.isFinite(n) ? n : null }

export function parseCruxHistory(json: any, scope: string, formFactor: "PHONE" | "DESKTOP"): CruxPoint[] {
  const periods: any[] = json?.record?.collectionPeriods || []
  const m = json?.record?.metrics || {}
  const p75 = (k: string, i: number) => val(m[k]?.percentilesTimeseries?.p75s?.[i])
  return periods.map((p, i) => ({
    scope, form_factor: formFactor,
    period_start: day(p.firstDate), period_end: day(p.lastDate),
    lcp_ms: p75("largest_contentful_paint", i), inp_ms: p75("interaction_to_next_paint", i),
    cls: p75("cumulative_layout_shift", i), fcp_ms: p75("first_contentful_paint", i), ttfb_ms: p75("experimental_time_to_first_byte", i),
  })).filter(p => p.lcp_ms !== null || p.inp_ms !== null || p.cls !== null)
}

// Grenzen van Google (goed / verbeteren / slecht)
export const CRUX_LIMITS = { lcp_ms: [2500, 4000], inp_ms: [200, 500], cls: [0.1, 0.25] } as const
export type CruxMetric = keyof typeof CRUX_LIMITS
export const cruxStatus = (k: CruxMetric, v: number | null) => (v === null ? null : v <= CRUX_LIMITS[k][0] ? "goed" : v <= CRUX_LIMITS[k][1] ? "verbeteren" : "slecht")

// Werd de site merkbaar trager rond een datum? Vergelijkt de periode die vlak vóór de datum eindigt met de
// eerste periode die er volledig na ligt. Alleen een "verslechtering" als de grens van Google wordt
// overschreden of de waarde ≥ 20% slechter is. Bedoeld als context bij metingen, niet als oordeel.
export function speedAround(points: CruxPoint[], date: string, formFactor: "PHONE" | "DESKTOP" = "PHONE") {
  const s = points.filter(p => p.scope === "origin" && p.form_factor === formFactor).sort((a, b) => a.period_end.localeCompare(b.period_end))
  const before = [...s].reverse().find(p => p.period_end < date)
  const after = s.find(p => p.period_start >= date)
  if (!before || !after) return null
  const worse: { metric: CruxMetric; from: number; to: number }[] = []
  for (const k of ["lcp_ms", "inp_ms", "cls"] as CruxMetric[]) {
    const a = before[k], b = after[k]
    if (a === null || b === null) continue
    const crossed = (cruxStatus(k, b) !== cruxStatus(k, a)) && (cruxStatus(k, a) === "goed" || cruxStatus(k, b) === "slecht")
    if (b > a && (crossed || (a > 0 && (b - a) / a >= 0.2))) worse.push({ metric: k, from: a, to: b })
  }
  return { before, after, worse }
}
