// Laadsnelheid en stabiliteit (Core Web Vitals). Google gebruikt dit als rankingsignaal,
// vooral op mobiel. Drempels van Google: goed / verbeteren / slecht.
export type CwvStatus = "goed" | "verbeteren" | "slecht"
export interface CwvRow {
  path: string; strategy: string; measured_at: string; score: number | null
  lcp_ms: number | null; cls: number | null; tbt_ms: number | null; fcp_ms: number | null
  field: { lcp_ms?: number; inp_ms?: number; cls?: number; category?: string; origin?: boolean } | null
  status: CwvStatus | null; error: string | null
}

export const CWV_LIMITS = { lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600], inp: [200, 500] } as const

export function labStatus(lcp: number | null, cls: number | null, tbt: number | null): CwvStatus | null {
  if (lcp === null && cls === null && tbt === null) return null
  const bad = (lcp ?? 0) > CWV_LIMITS.lcp[1] || (cls ?? 0) > CWV_LIMITS.cls[1] || (tbt ?? 0) > CWV_LIMITS.tbt[1]
  const good = (lcp ?? 0) <= CWV_LIMITS.lcp[0] && (cls ?? 0) <= CWV_LIMITS.cls[0] && (tbt ?? 0) <= CWV_LIMITS.tbt[0]
  return bad ? "slecht" : good ? "goed" : "verbeteren"
}

export function fieldStatus(category?: string): CwvStatus | null {
  return category === "FAST" ? "goed" : category === "AVERAGE" ? "verbeteren" : category === "SLOW" ? "slecht" : null
}

// Wat er mis is, in gewone taal
export function cwvProblems(r: Pick<CwvRow, "lcp_ms" | "cls" | "tbt_ms" | "field">) {
  const out: string[] = []
  const lcp = r.field?.lcp_ms ?? r.lcp_ms
  if (lcp !== null && lcp !== undefined && lcp > CWV_LIMITS.lcp[0]) out.push(`grootste element pas na ${(lcp / 1000).toFixed(1).replace(".", ",")} s zichtbaar (doel ≤ 2,5 s): vaak een te zware afbeelding bovenaan`)
  const cls = r.field?.cls ?? r.cls
  if (cls !== null && cls !== undefined && cls > CWV_LIMITS.cls[0]) out.push(`pagina verspringt tijdens laden (CLS ${cls.toFixed(2).replace(".", ",")}, doel ≤ 0,1): geef afbeeldingen en banners een vaste hoogte`)
  if (r.field?.inp_ms && r.field.inp_ms > CWV_LIMITS.inp[0]) out.push(`reageert traag op klikken (${r.field.inp_ms} ms, doel ≤ 200 ms)`)
  else if (r.tbt_ms !== null && r.tbt_ms > CWV_LIMITS.tbt[0]) out.push(`browser is ${r.tbt_ms} ms bezig met scripts (doel ≤ 200 ms): te veel of te zware scripts (chat, tracking, sliders)`)
  return out
}
