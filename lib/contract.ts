// Datacontract voor het advies.
//
// Een advies wordt pas getoond als alle cijfers uit dezelfde bron, periode en scope komen.
// De lijst (Vandaag, Mijn taken) rekent met de bulkgegevens van Search Console; het zijpaneel
// haalt daarna live gegevens op. Deze module bouwt uit die live gegevens één consistent
// geheel: cijfers, schatting en scope worden samen vervangen, en verschillen met de lijst
// worden benoemd. Kloppen de gegevens niet, dan wordt het advies geblokkeerd.

import type { AdviceDetail, Evidence, MetricScope, MetricSet, Signal, SignalMetrics } from "./types"
import type { CtrModel } from "./ctr"
import { estimateFor } from "./intent"
import { dateShort, num, pos } from "./format"

export interface Reconciled {
  signal: Signal              // signaal met live cijfers, schatting en scope
  scopeText: string           // in gewone taal: waar de cijfers over gaan
  changes: string[]           // wat er t.o.v. de lijst is veranderd
  blocked: string | null      // reden waarom het advies niet bevestigd kan worden
  targetRow: (MetricSet & { path: string }) | null // doelpagina voor dit zoekwoord (zoekwoord-paginacombinatie)
}

type Window = { startDate: string; endDate: string } | null | undefined

const period = (w: Window) => (w ? `${dateShort(w.startDate)} – ${dateShort(w.endDate)}` : "laatste 28 dagen")

function changed(a: number | undefined, b: number | undefined, rel = 0.15, abs = 1) {
  if (a === undefined || b === undefined) return false
  return Math.abs(a - b) > Math.max(abs, Math.abs(a) * rel)
}

function evidenceFor(impressions: number): [Evidence, string] {
  if (impressions >= 150) return ["sterk", `${num(impressions)} vertoningen in 28 dagen (live): genoeg om op te bouwen.`]
  if (impressions >= 40) return ["redelijk", `${num(impressions)} vertoningen in 28 dagen (live): de richting is zichtbaar, maar toeval speelt nog mee.`]
  return ["zwak", `Slechts ${num(impressions)} vertoningen in 28 dagen (live): te weinig om harde conclusies te trekken.`]
}

export function scopeLabel(scope?: MetricScope): string {
  if (!scope) return "Laatste 28 dagen"
  const when = period(scope.window)
  const src = scope.source === "live" ? "live uit Search Console" : scope.source === "inventaris" ? "pagina-inventaris en nachtelijke controle" : "uit de lijst"
  switch (scope.kind) {
    case "zoekwoord": return `Zoekwoord als geheel (alle eigen pagina's samen) · ${when} · ${src}`
    case "pagina": return `Pagina ${scope.page}, alle zoekwoorden samen · ${when} · ${src}`
    case "zoekwoord-pagina": return `Zoekwoord "${scope.query}" op ${scope.page} · ${when} · ${src}`
    case "paginagroep": return `${scope.pages?.length ?? 0} pagina's opgeteld (per pagina geteld) · ${when} · ${src}`
    case "inventaris": return `Alle pagina's uit de sitemap · ${src}`
    case "geen": return "Eigen taak, niet gekoppeld aan een zoekwoord of pagina"
  }
}

export function listScope(signal: Signal, window: Window): MetricScope {
  if (signal.kind === "techniek") return { kind: "inventaris", source: "inventaris" }
  if (signal.kind === "eigen" && !signal.query && !signal.page) return { kind: "geen", source: "lijst" }
  if (signal.kind === "dubbel") return { kind: "paginagroep", pages: signal.relatedPages, window, source: "lijst" }
  if (signal.query) return { kind: "zoekwoord", query: signal.query, window, source: "lijst" }
  return { kind: "pagina", page: signal.page, window, source: "lijst" }
}

const TREND = new Set(["trend-dalend", "trend-stijgend"])

export function reconcile(signal: Signal, detail: AdviceDetail | null, model: CtrModel, listWindow?: Window): Reconciled {
  const base = (extra: Partial<Reconciled> = {}): Reconciled => {
    const scope = signal.scope || listScope(signal, listWindow)
    return { signal: { ...signal, scope }, scopeText: scopeLabel(scope), changes: [], blocked: null, targetRow: null, ...extra }
  }
  if (signal.kind === "techniek" || (signal.kind === "eigen" && !signal.query && !signal.page)) return base()
  if (!detail) return base({ changes: ["De live controle is niet gelukt. De cijfers komen uit de lijst; controleer ze voordat je iets aanpast."] })

  const changes: string[] = []
  if (listWindow?.endDate && detail.window?.endDate && listWindow.endDate !== detail.window.endDate) {
    changes.push(`De lijst liep tot ${dateShort(listWindow.endDate)}, de live gegevens tot ${dateShort(detail.window.endDate)}. Het advies gebruikt de live periode.`)
  }
  const old = signal.metrics
  let metrics: SignalMetrics = { ...old }
  let scope: MetricScope
  let blocked: string | null = null
  let targetRow: Reconciled["targetRow"] = null
  let resolved: string | null = signal.resolved ?? null
  const scopeRows: { label: string; value: string }[] = []

  const note = (label: string, a: number | undefined, b: number | undefined, fmt: (n?: number) => string) => {
    if (changed(a, b, label === "positie" ? 0.08 : 0.15, label === "positie" ? 0.5 : 1)) changes.push(`${label}: ${fmt(a)} in de lijst, ${fmt(b)} live`)
  }

  if (signal.kind === "dubbel") {
    // Paginagroep: elke pagina live, en dezelfde telling (per pagina) voor alle pagina's
    const rel = signal.relatedPages || []
    const totals = detail.relatedTotals || []
    const redirects = detail.redirects || []
    scope = { kind: "paginagroep", pages: rel, window: detail.window, source: "live" }
    const finals = rel.map(p => redirects.find(r => r.path === p)?.finalPath ?? p)
    if (redirects.length === rel.length && new Set(finals).size === 1) {
      resolved = `${rel.filter(p => p !== finals[0]).join(" en ")} verwijst al door naar ${finals[0]}.`
    }
    if (!totals.length) {
      blocked = "Voor deze paginagroep zijn geen live cijfers per pagina opgehaald. Zonder die cijfers is niet te zeggen of de pagina's elkaar in de weg zitten."
    } else {
      const live = totals.filter(t => t.cur)
      const imp = live.reduce((s, t) => s + (t.cur?.impressions || 0), 0)
      const clicks = live.reduce((s, t) => s + (t.cur?.clicks || 0), 0)
      // Hoofdpagina = pagina met de meeste vertoningen die niet doorverwijst
      const candidates = live.filter(t => !redirects.find(r => r.path === t.path && r.redirected))
      const main = (candidates.length ? candidates : live).sort((a, b) => (b.cur!.impressions - a.cur!.impressions) || (a.cur!.position - b.cur!.position))[0]
      for (const t of totals) scopeRows.push({ label: t.path, value: t.cur ? `positie ${pos(t.cur.position)} · ${num(t.cur.impressions)} vertoningen · ${num(t.cur.clicks)} clicks` : "geen vertoningen" })
      note("vertoningen", old.impressions, imp, n => num(n))
      metrics = { position: main?.cur?.position, impressions: imp, clicks, ctr: imp ? clicks / imp : 0 }
      if (main) signal = { ...signal, page: main.path }
    }
  } else if (signal.query) {
    const live = detail.queryTotals?.cur || null
    scope = { kind: "zoekwoord", query: signal.query, window: detail.window, source: "live" }
    if (!live) {
      if ((old.impressions || 0) > 0) blocked = `Search Console geeft voor "${signal.query}" nu geen cijfers over ${period(detail.window)}, terwijl de lijst ${num(old.impressions)} vertoningen noemde. Zonder bevestiging geen advies.`
    } else {
      const prev = detail.queryTotals?.prev || null
      note("vertoningen", old.impressions, live.impressions, n => num(n))
      note("clicks", old.clicks, live.clicks, n => num(n))
      if (!TREND.has(signal.kind)) note("positie", old.position, live.position, n => pos(n))
      metrics = {
        ...old,
        // Bij een trend gaat de positie over de laatste weken (zie het verloop); de rest is 28 dagen live
        position: TREND.has(signal.kind) ? old.position : live.position,
        impressions: live.impressions, clicks: live.clicks, ctr: live.ctr,
        prevPosition: TREND.has(signal.kind) ? old.prevPosition : prev?.position ?? old.prevPosition,
        prevImpressions: prev?.impressions ?? old.prevImpressions,
        prevClicks: prev?.clicks ?? old.prevClicks,
      }
      // Zoekwoord-paginacombinatie van de doelpagina
      const target = detail.auditTarget || null
      const pages = detail.queryPages?.cur || []
      targetRow = target ? pages.find(p => p.path === target) || null : null
      const top = pages[0]
      if (target && top && top.path !== target) {
        scopeRows.push({ label: `Zoekwoord als geheel`, value: `positie ${pos(live.position)} · ${num(live.impressions)} vertoningen` })
        scopeRows.push({ label: `Nu vooral getoond: ${top.path}`, value: `positie ${pos(top.position)} · ${num(top.impressions)} vertoningen (per pagina)` })
        scopeRows.push({ label: `Doelpagina ${target}`, value: targetRow ? `positie ${pos(targetRow.position)} · ${num(targetRow.impressions)} vertoningen (per pagina)` : "verschijnt nog niet voor dit zoekwoord" })
      }
    }
  } else {
    const live = detail.pageTotals?.cur || null
    scope = { kind: "pagina", page: signal.page, window: detail.window, source: "live" }
    if (!live) {
      if ((old.impressions || 0) > 0) blocked = `Search Console geeft voor ${signal.page} nu geen cijfers over ${period(detail.window)}, terwijl de lijst ${num(old.impressions)} vertoningen noemde. Zonder bevestiging geen advies.`
    } else {
      const prev = detail.pageTotals?.prev || null
      note("vertoningen", old.impressions, live.impressions, n => num(n))
      note("clicks", old.clicks, live.clicks, n => num(n))
      note("positie", old.position, live.position, n => pos(n))
      metrics = { ...old, position: live.position, impressions: live.impressions, clicks: live.clicks, ctr: live.ctr, prevPosition: prev?.position ?? old.prevPosition, prevImpressions: prev?.impressions ?? old.prevImpressions, prevClicks: prev?.clicks ?? old.prevClicks }
    }
  }

  // Schatting opnieuw berekenen op exact deze cijfers
  let estimate = resolved || blocked ? undefined : estimateFor({ kind: signal.kind, metrics }, model)
  if (estimate && scopeRows.length) {
    const target = detail.auditTarget
    estimate = {
      ...estimate,
      scopeRows,
      scenario: signal.kind === "dubbel"
        ? `${signal.page} wordt de enige pagina en stijgt ±5 posities`
        : target && targetRow !== null && detail.queryPages?.cur?.[0]?.path !== target
          ? `${target} neemt het zoekwoord over op positie ${pos(estimate.toPosition)}`
          : estimate.scenario,
    }
  }
  let evidence = signal.evidence, evidenceReason = signal.evidenceReason
  if (metrics.impressions !== undefined && changed(old.impressions, metrics.impressions)) [evidence, evidenceReason] = evidenceFor(metrics.impressions)

  const out: Signal = {
    ...signal, metrics, scope, estimate, gain: estimate?.gain ?? 0, evidence, evidenceReason, resolved,
  }
  return { signal: out, scopeText: scopeLabel(scope), changes, blocked, targetRow }
}
