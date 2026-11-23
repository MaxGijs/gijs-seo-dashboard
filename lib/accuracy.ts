// Hoe nauwkeurig is de voorspelling? Per experiment: voorspelde winst (clicks per 28 dagen, met
// bandbreedte) tegen de gemeten winst (gecorrigeerd voor sitebrede groei). Alleen eindmetingen
// (dag 28, of 56 na verlenging) met genoeg vertoningen tellen mee in de cijfers; tussenmetingen zijn "voorlopig".
// Dit verandert niets aan de voorspelling of de meting zelf: het vergelijkt alleen wat er al staat.

import { conclusionOf } from "./measureLogic"
import type { Experiment } from "./types"

export type Hit = "binnen" | "boven" | "onder"

export interface AccuracyRow {
  id: string
  adviceKey: string
  subject: string
  predicted: number
  low: number
  high: number
  bandFromModel: boolean          // false: bandbreedte afgeleid (±) omdat die niet is opgeslagen
  actual: number                  // gecorrigeerde winst, clicks per 28 dagen
  error: number                   // werkelijk min voorspeld
  hit: Hit
  final: boolean                  // 56-daagse eindmeting
  counts: boolean                 // telt mee in de cijfers (final + genoeg vertoningen)
  reason?: string                 // waarom het niet meetelt
  measuredAt?: string
}

export interface Accuracy {
  rows: AccuracyRow[]             // alle experimenten met voorspelling én meting
  scored: AccuracyRow[]           // de rijen die meetellen
  provisional: AccuracyRow[]      // tussenmetingen van lopende experimenten
  excluded: AccuracyRow[]         // eindmetingen die niet meetellen (te weinig data)
  n: number
  meanAbsError: number | null     // gemiddelde afwijking in clicks per 28 dagen
  bias: number | null             // gemiddeld werkelijk min voorspeld (negatief = te optimistisch)
  inBand: number                  // aantal binnen de bandbreedte
  hitRate: number | null          // aandeel binnen de bandbreedte
  tooHigh: number                 // voorspelling te optimistisch (werkelijk onder de bandbreedte)
  tooLow: number                  // voorspelling te pessimistisch
  directionRate: number | null    // aandeel waar de richting klopte (winst voorspeld, winst gemeten)
  skill: number | null            // 1 − fout model / fout "geen effect": > 0 is beter dan niets voorspellen
  realisation: number | null      // totaal werkelijk / totaal voorspeld
  level: "geen" | "te-weinig" | "indicatief" | "bruikbaar"
}

export const LEVELS = { indicatief: 5, bruikbaar: 15 } as const

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d

// Zelfde terugval als de weergave bij Experimenten: ruim onder en iets boven de verwachting
export function bandOf(e: Experiment, predicted: number): { low: number; high: number; fromModel: boolean } {
  const low = e.predicted?.low, high = e.predicted?.high
  if (typeof low === "number" && typeof high === "number") return { low, high, fromModel: true }
  return { low: Math.floor(predicted * 0.6), high: Math.ceil(predicted * 1.3), fromModel: false }
}

export function accuracyRow(e: Experiment, subject: string): AccuracyRow | null {
  const predicted = e.predicted?.gain ?? e.baseline?.predictedGain
  if (typeof predicted !== "number" || !Number.isFinite(predicted)) return null
  // Definitief = de conclusie (dag 28, of 56 na verlenging); dag 14 is voorlopig
  const concl = conclusionOf(e)
  const final = !!concl
  const m = concl?.result || e.result_56d || e.result_28d || e.result_14d
  const actual = m?.actualGainCorrected
  if (!m || typeof actual !== "number" || !Number.isFinite(actual)) return null
  const { low, high, fromModel } = bandOf(e, predicted)
  const hit: Hit = actual < low ? "onder" : actual > high ? "boven" : "binnen"
  const enough = m?.evidence !== "te weinig data"
  return {
    id: e.id, adviceKey: e.advice_key, subject, predicted: round(predicted), low, high, bandFromModel: fromModel,
    actual: round(actual), error: round(actual - predicted), hit, final,
    counts: final && enough,
    reason: !final ? "Tussenmeting, nog niet definitief" : !enough ? "Te weinig vertoningen om van te leren" : undefined,
    measuredAt: m.measuredAt,
  }
}

export function computeAccuracy(experiments: Experiment[], subjectOf: (e: Experiment) => string = e => e.query ? `"${e.query}"` : e.page || e.advice_key): Accuracy {
  // Alleen echte experimenten: validaties en metingen zonder oordeel tellen niet mee.
  // Een experimentfamilie telt als één rij: opgetelde voorspelling tegen opgetelde meting.
  const real = experiments.filter(e => (e.kind || "experiment") === "experiment")
  const groups = new Map<string, Experiment[]>()
  for (const e of real) groups.set(e.family_id || e.id, [...(groups.get(e.family_id || e.id) || []), e])
  const rows = [...groups.values()].map(list => {
    const parts = list.map(e => accuracyRow(e, subjectOf(e))).filter((r): r is AccuracyRow => !!r)
    if (list.length === 1 || !parts.length) return parts[0] || null
    const sum = (f: (r: AccuracyRow) => number) => round(parts.reduce((a, r) => a + f(r), 0))
    const predicted = sum(r => r.predicted), actual = sum(r => r.actual), low = parts.reduce((a, r) => a + r.low, 0), high = parts.reduce((a, r) => a + r.high, 0)
    const final = parts.length === list.length && parts.every(r => r.final)
    return {
      ...parts[0], id: list[0].family_id || list[0].id, subject: `${list[0].family_title || list[0].description} (${list.length} meetpunten)`,
      predicted, low, high, actual, error: round(actual - predicted), bandFromModel: parts.every(r => r.bandFromModel),
      hit: (actual < low ? "onder" : actual > high ? "boven" : "binnen") as Hit, final,
      counts: final && parts.some(r => r.counts),
      reason: !final ? "Nog niet alle meetpunten hebben een eindmeting" : parts.some(r => r.counts) ? undefined : "Te weinig vertoningen om van te leren",
      measuredAt: parts.map(r => r.measuredAt || "").sort().pop() || undefined,
    } as AccuracyRow
  }).filter((r): r is AccuracyRow => !!r)
  const scored = rows.filter(r => r.counts)
  const provisional = rows.filter(r => !r.final)
  const excluded = rows.filter(r => r.final && !r.counts)
  const n = scored.length
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const meanAbsError = n ? round(sum(scored.map(r => Math.abs(r.error))) / n) : null
  const bias = n ? round(sum(scored.map(r => r.error)) / n) : null
  const inBand = scored.filter(r => r.hit === "binnen").length
  const hitRate = n ? inBand / n : null
  const signed = scored.filter(r => r.predicted > 0)
  const directionRate = signed.length ? signed.filter(r => r.actual > 0).length / signed.length : null
  const errZero = n ? sum(scored.map(r => Math.abs(r.actual))) / n : 0   // fout als je "geen effect" voorspelt
  const skill = n && errZero > 0 ? round(1 - (meanAbsError as number) / errZero, 2) : null
  const totalPred = sum(scored.map(r => r.predicted))
  const realisation = n && totalPred > 0 ? round(sum(scored.map(r => r.actual)) / totalPred, 2) : null
  const level: Accuracy["level"] = n === 0 ? "geen" : n < LEVELS.indicatief ? "te-weinig" : n < LEVELS.bruikbaar ? "indicatief" : "bruikbaar"
  return {
    rows, scored, provisional, excluded, n, meanAbsError, bias, inBand, hitRate,
    tooHigh: scored.filter(r => r.hit === "onder").length, tooLow: scored.filter(r => r.hit === "boven").length,
    directionRate, skill, realisation, level,
  }
}

// Eén zin met de conclusie, op elke plek hetzelfde
export function accuracySentence(a: Accuracy): string {
  if (a.level === "geen") return "Nog geen afgeronde metingen om de voorspelling mee te toetsen."
  const pct = (x: number | null) => x === null ? "—" : `${Math.round(x * 100)}%`
  const base = `${a.n} ${a.n === 1 ? "eindmeting" : "eindmetingen"}: ${pct(a.hitRate)} viel binnen de voorspelde bandbreedte, gemiddeld ${String(a.meanAbsError).replace(".", ",")} klikken per 28 dagen ernaast.`
  if (a.level === "te-weinig") return `${base} Te weinig om er iets over te zeggen (vanaf ${LEVELS.indicatief} wordt het indicatief).`
  if (a.level === "indicatief") return `${base} Indicatief; vanaf ${LEVELS.bruikbaar} metingen wordt het bruikbaar.`
  return base
}
