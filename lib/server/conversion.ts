// Conversie: sessies en energiescanaanvragen uit GA4, voor eigen taken die over leads gaan
// (bijvoorbeeld "woningscan verkorten"). Telt per sessie met de events die als aanvraag gelden.

import { ga4Client, readMeasurement } from "./dashboard"
import type { Measurement } from "@/lib/dashboard"

export interface ConversionWindow { start: string; end: string; sessions: number; requests: number | null; rate: number | null }

const fmt = (d: Date) => d.toISOString().slice(0, 10)
export const addDaysIso = (s: string, n: number) => fmt(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86400000))

function pageFilter(page?: string | null) {
  if (!page || page === "/") return null
  return { filter: { fieldName: "landingPage", stringFilter: { matchType: "BEGINS_WITH", value: page } } }
}

export async function conversionWindows(windows: { start: string; end: string }[], page?: string | null): Promise<{ measurement: Measurement; windows: ConversionWindow[] }> {
  const g = ga4Client()
  const measurement = await readMeasurement(g)
  const pf = pageFilter(page)
  const lead = measurement.used.length ? { filter: { fieldName: "eventName", inListFilter: { values: measurement.used } } } : null
  const run = async (w: { start: string; end: string }, withLead: boolean) => {
    const parts = [pf, withLead ? lead : null].filter(Boolean) as any[]
    const [res] = await g.client.runReport({
      property: g.property, dateRanges: [{ startDate: w.start, endDate: w.end }], metrics: [{ name: "sessions" }],
      dimensionFilter: parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { andGroup: { expressions: parts } },
    } as any)
    return Number(res.rows?.[0]?.metricValues?.[0]?.value || 0)
  }
  const out = await Promise.all(windows.map(async w => {
    const [sessions, requests] = await Promise.all([run(w, false), lead ? run(w, true) : Promise.resolve(null)])
    return { ...w, sessions, requests, rate: requests !== null && sessions ? requests / sessions : null }
  }))
  return { measurement, windows: out }
}

// Oordeel: alleen als de meting klopt en er genoeg aanvragen zijn om iets te zeggen
export function conversionVerdict(before: ConversionWindow, after: ConversionWindow, measurement: Measurement): { verdict: "succesvol" | "niet_succesvol" | "onduidelijk"; reason: string } {
  if (measurement.status !== "ok") return { verdict: "onduidelijk", reason: "De meting van energiescanaanvragen klopt nog niet (zie de controletaak), dus geen oordeel." }
  if (before.requests === null || after.requests === null || before.rate === null || after.rate === null) return { verdict: "onduidelijk", reason: "Geen aanvraaggegevens." }
  if (before.requests + after.requests < 6) return { verdict: "onduidelijk", reason: `Te weinig aanvragen om iets te zeggen (${before.requests} vóór, ${after.requests} na).` }
  if (after.rate >= before.rate * 1.2 && after.requests >= before.requests + 2) return { verdict: "succesvol", reason: `Aandeel bezoeken met een aanvraag van ${(before.rate * 100).toFixed(1)}% naar ${(after.rate * 100).toFixed(1)}%.` }
  if (after.rate <= before.rate * 0.8 && after.requests < before.requests) return { verdict: "niet_succesvol", reason: `Aandeel bezoeken met een aanvraag daalde van ${(before.rate * 100).toFixed(1)}% naar ${(after.rate * 100).toFixed(1)}%.` }
  return { verdict: "onduidelijk", reason: "Geen duidelijke verandering in het aandeel bezoeken met een aanvraag." }
}
