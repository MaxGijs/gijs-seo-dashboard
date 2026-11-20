// Een taak op "uitgevoerd" zetten en de meting starten. Gedeeld door het takenpaneel (één taak)
// en "Meerdere afronden" op het bord (meerdere taken met dezelfde toelichting), zodat de
// nulmeting, hypothese en doelpagina's overal precies hetzelfde worden vastgelegd.

import type { AdviceDetail, Signal, Task } from "./types"
import type { GscRow } from "./types"
import { baselineFrom, buildDiagnosis, type Diagnosis } from "./diagnosis"
import { reconcile, type Reconciled } from "./contract"

export interface SiteBaseline { impressionsPerDay: number; clicksPerDay: number; days: number }

export function siteBaselineOf(overview: GscRow[]): SiteBaseline | null {
  return overview.length ? {
    impressionsPerDay: Math.round(overview.reduce((a, r) => a + r.impressions, 0) / overview.length),
    clicksPerDay: Math.round((overview.reduce((a, r) => a + r.clicks, 0) / overview.length) * 10) / 10,
    days: overview.length,
  } : null
}

export function experimentFor(signal: Signal, detail: AdviceDetail | null, diag: Diagnosis, targetRow: Reconciled["targetRow"], site: SiteBaseline | null, description: string, merged: Signal[] = []) {
  const target = diag.target
  // Samengevoegde kaarten: hun zoekwoorden en pagina's horen bij deze meting
  const extraQueries = merged.map(m => m.query).filter((x): x is string => !!x && x !== signal.query)
  const extraPages = merged.map(m => m.page || m.conversions?.page).filter((x): x is string => !!x)
  const uniq = (xs: string[]) => [...new Set(xs)]
  return {
    description: description.trim(),
    baseline: { ...baselineFrom(signal, detail, diag, targetRow), site },
    hypothesis: `${diag.steps[0]?.title || signal.action || ""}. Verwacht: ${diag.importance.gainText.toLowerCase()}. ${diag.plan.success}`,
    targetPages: uniq([...(signal.kind === "techniek" ? signal.tech?.pages.map(p => p.path) || [] : [target, ...(signal.relatedPages || [])].filter((x): x is string => !!x)), ...extraPages]),
    targetQueries: uniq([...(signal.query ? [signal.query] : []), ...extraQueries]),
    predicted: { gain: signal.estimate ? Math.round(signal.estimate.gain * 10) / 10 : null, low: signal.estimate?.low ?? null, high: signal.estimate?.high ?? null, metric: diag.successMetric },
  }
}

export const needsDetail = (s: Signal) => {
  const isSeo = !(s.kind === "eigen" && s.goal && s.goal !== "seo")
  return isSeo && s.kind !== "techniek" && !(s.kind === "eigen" && !s.query && !s.page)
}

// Alles wat nodig is om één taak buiten het paneel als uitgevoerd vast te leggen
export async function prepareExecution(task: Task, ctx: {
  getDetail: (s: Signal) => Promise<AdviceDetail>
  ctrModel: Parameters<typeof reconcile>[2]
  listWindow?: Parameters<typeof reconcile>[3]
  pages: Parameters<typeof buildDiagnosis>[2]["pages"]
  signalCount: number
  overview: GscRow[]
}, description: string): Promise<{ ok: true; signal: Signal; experiment: ReturnType<typeof experimentFor> } | { ok: false; reason: string }> {
  const raw = task.signal
  let detail: AdviceDetail | null = null
  if (needsDetail(raw)) {
    try { detail = await ctx.getDetail(raw) } catch (e: any) { return { ok: false, reason: `Live controle mislukt (${e?.message || "onbekende fout"}). Open de taak en probeer het daar.` } }
  }
  const rec = reconcile(raw, detail, ctx.ctrModel, ctx.listWindow)
  if (rec.blocked) return { ok: false, reason: rec.blocked }
  const diag = buildDiagnosis(rec.signal, detail, { model: ctx.ctrModel, pages: ctx.pages, signalCount: ctx.signalCount })
  return { ok: true, signal: rec.signal, experiment: experimentFor(rec.signal, detail, diag, rec.targetRow, siteBaselineOf(ctx.overview), description, (task.merged || []).map(m => m.signal)) }
}
