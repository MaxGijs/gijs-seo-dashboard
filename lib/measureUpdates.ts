// Nieuwe meetresultaten voor Vandaag en het Dashboard.
// Lopende metingen staan na een week niet meer op het bord (ze staan in Experimenten). Elke keer
// dat er een tussenmeting of het eindoordeel binnenkomt, verschijnt hier een update tot je hem
// als gezien markeert (of tot hij twee weken oud is).

import { useCallback, useEffect, useMemo, useState } from "react"
import type { Task } from "./types"
import type { ContentIdea } from "./content/model"
import { OUTCOME_META, UPDATE_MILESTONES } from "./content/update"
import { OUTCOME_META as EXP_OUTCOME } from "./experiment"
import { addDays, num, pos, today } from "./format"
import { readStorage, writeStorage } from "./workspace"

export interface MeasureUpdate {
  key: string
  date: string                 // dag van de meting
  title: string                // waar gaat het over
  milestone: number            // na hoeveel dagen
  text: string                 // het resultaat in één zin
  final: boolean               // eindoordeel
  tone: "goed" | "slecht" | "neutraal"
  taskKey?: string
  ideaId?: string
}

const FRESH_DAYS = 14
const SEO_STEPS = [[14, "result_14d"], [28, "result_28d"], [56, "result_56d"], [84, "result_84d"]] as const
const toneOf = (o: string | null | undefined): MeasureUpdate["tone"] => (o === "succesvol" ? "goed" : o === "niet_succesvol" ? "slecht" : "neutraal")

export function measureUpdates(tasks: Task[], ideas: ContentIdea[], now = today()): MeasureUpdate[] {
  const since = addDays(now, -FRESH_DAYS)
  const out: MeasureUpdate[] = []
  for (const t of tasks) {
    const title = t.signal.query ? `"${t.signal.query}"` : t.signal.headline
    for (const e of t.experiments) {
      for (const [d, col] of SEO_STEPS) {
        const r = (e as any)[col] as { measuredAt?: string; summary?: string } | null
        const date = (r?.measuredAt || "").slice(0, 10)
        if (!r || !date || date < since) continue
        // Eindoordeel bij de laatste meting die er is (56, of 84 dagen bij verlengd meten)
        const last = SEO_STEPS.filter(([, c]) => (e as any)[c]).pop()?.[0]
        const final = d === last && !!e.outcome
        out.push({
          key: `exp:${e.id}:${d}`, date, title, milestone: d, final, taskKey: t.key,
          tone: final ? toneOf(e.outcome) : "neutraal",
          text: final ? `Eindoordeel: ${EXP_OUTCOME[e.outcome!].label.toLowerCase()}. ${r.summary || ""}`.trim() : `${r.summary || "Gemeten"}.`,
        })
      }
    }
  }
  for (const i of ideas) {
    if (i.status !== "gepubliceerd") continue
    const u = i.advice === "bijwerken" ? i.evals?.update : null
    if (u) {
      for (const d of UPDATE_MILESTONES) {
        const p = u.points?.[`d${d}`]
        const date = (p?.measured_at || "").slice(0, 10)
        if (!p || !date || date < since) continue
        const final = d === 56 && !!u.outcome
        out.push({
          key: `upd:${i.id}:${d}`, date, title: `${u.page} bijgewerkt`, milestone: d, final, ideaId: i.id,
          tone: final ? toneOf(u.outcome) : "neutraal",
          text: `${final ? `Eindoordeel: ${OUTCOME_META[u.outcome!].label.toLowerCase()}. ` : ""}${num(p.page.clicks)} klikken en ${num(p.page.impressions)} vertoningen in ${p.window.days} dagen${p.page.position !== null ? `, positie ${pos(p.page.position)}` : ""}.`,
        })
      }
      continue
    }
    for (const [d, k] of [[7, "d7"], [30, "d30"], [90, "d90"]] as const) {
      const ev = i.evals?.[k]
      const date = (ev?.measured_at || "").slice(0, 10)
      if (!ev || !date || date < since) continue
      out.push({
        key: `art:${i.id}:${d}`, date, title: i.title, milestone: d, final: d === 90, ideaId: i.id, tone: "neutraal",
        text: `${num(ev.clicks)} klikken en ${num(ev.impressions)} vertoningen${ev.position !== null ? `, positie ${pos(ev.position)}` : ""}${ev.ga4 ? `, ${num(ev.ga4.views)} keer bekeken` : ""}.`,
      })
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || Number(b.final) - Number(a.final))
}

// Wat je al gezien hebt, per browser (een gemak, geen gedeelde staat)
const SEEN_KEY = "gijs.seo.seenMeasurements"

export function useMeasureUpdates(tasks: Task[], ideas: ContentIdea[] | null | undefined) {
  const [seen, setSeen] = useState<Set<string>>(new Set())
  useEffect(() => {
    try { const raw = readStorage(SEEN_KEY); const v = raw ? JSON.parse(raw) : []; setSeen(new Set(Array.isArray(v) ? v : [])) } catch { /* leeg */ }
  }, [])
  const all = useMemo(() => measureUpdates(tasks, ideas || []), [tasks, ideas])
  const items = useMemo(() => all.filter(u => !seen.has(u.key)), [all, seen])
  const persist = (next: Set<string>) => {
    // Alleen sleutels bewaren die nog kunnen verschijnen
    const live = new Set(all.map(u => u.key))
    writeStorage(SEEN_KEY, JSON.stringify([...next].filter(k => live.has(k))))
    setSeen(next)
  }
  const dismiss = useCallback((key: string) => persist(new Set([...seen, key])), [seen, all]) // eslint-disable-line react-hooks/exhaustive-deps
  const dismissAll = useCallback(() => persist(new Set([...seen, ...items.map(u => u.key)])), [seen, items, all]) // eslint-disable-line react-hooks/exhaustive-deps
  return { items, dismiss, dismissAll }
}
