"use client"

// Kaarten samenvoegen tot één opdracht. De hoofdkaart blijft staan; de andere hangen eronder en
// verdwijnen van het bord. Bij uitvoeren worden alle zoekwoorden en pagina's mee vastgelegd.
// Telt niet als afwijzing en is met "Splitsen" terug te draaien.

import { useEffect, useMemo, useState } from "react"
import { Layers, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { columnOf, COLUMNS, STATUS_META } from "@/lib/workflow"
import { gainShort } from "@/lib/format"
import { KindLabel, PriorityMeter } from "@/components/ui"
import type { Task } from "@/lib/types"

const STAGE = { uitvoering: 0, gepland: 1, beoordelen: 2, evalueren: 3, afgerond: 4 } as const
export const label = (t: Task) => (t.signal.query ? `"${t.signal.query}"` : t.signal.headline)

// Standaard hoofdkaart: de kaart die het verst is, daarna de hoogste prioriteit en verwachte winst
export function defaultMain(tasks: Task[]) {
  const prio = { hoog: 0, middel: 1, laag: 2 }
  return [...tasks].sort((a, b) => STAGE[columnOf(a.status)] - STAGE[columnOf(b.status)] || prio[a.signal.priority] - prio[b.signal.priority] || b.signal.gain - a.signal.gain)[0]
}

export default function MergeDialog({ tasks, initialMain, initialGroup, onClose, onDone }: { tasks: Task[]; initialMain?: string; initialGroup?: string; onClose: () => void; onDone?: (mainKey: string) => void }) {
  const { mergeTasks, openTask } = useWorkspace()
  const [main, setMain] = useState(initialMain || defaultMain(tasks).key)
  const [busy, setBusy] = useState(false)
  // Eigen groepsnaam; bestaat er al een (in een van de kaarten), dan die als begin
  const [group, setGroup] = useState(() => tasks.find(t => t.key === (initialMain || defaultMain(tasks).key))?.signal.groupTitle || tasks.find(t => t.signal.groupTitle)?.signal.groupTitle || initialGroup || "")
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, busy])

  const mainTask = tasks.find(t => t.key === main)!
  const others = tasks.filter(t => t.key !== main)
  const all = useMemo(() => [mainTask, ...others].flatMap(t => [t, ...(t.merged || [])]), [mainTask, others])
  const queries = [...new Set(all.map(t => t.signal.query).filter(Boolean))] as string[]

  const go = async () => {
    setBusy(true)
    const ok = await mergeTasks(mainTask, others, group.trim() || null)
    setBusy(false)
    if (ok) { onClose(); onDone?.(main); openTask(main) }
  }

  return (
    <>
      <div className="panel-overlay" onClick={() => !busy && onClose()} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="merge-title">
        <div className="modal-head">
          <h2 id="merge-title">{tasks.length} kaarten samenvoegen</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Sluiten"><X /></button>
        </div>
        <div className="modal-body">
          <p className="field-hint" style={{ marginTop: 0 }}>Kies welke kaart blijft staan. De andere verdwijnen van het bord en staan in die kaart, zodat je ze in één keer doet.</p>
          <fieldset className="merge-pick">
            <legend className="field-label">Hoofdkaart</legend>
            {tasks.map(t => (
              <label key={t.key} className={`merge-option${main === t.key ? " is-main" : ""}`}>
                <input type="radio" name="merge-main" value={t.key} checked={main === t.key} onChange={() => setMain(t.key)} disabled={busy} />
                <span className="bulk-main">
                  <span className="merge-meta"><KindLabel signal={t.signal} /><span className="subtle small">{STATUS_META[t.status].label}</span><PriorityMeter priority={t.signal.priority} /></span>
                  <b>{label(t)}</b>
                  <span className="subtle small">{t.signal.action || t.signal.title}</span>
                  {t.merged?.length ? <span className="subtle small">Bevat al {t.merged.length} samengevoegde {t.merged.length === 1 ? "kaart" : "kaarten"}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field-label" htmlFor="merge-group">Naam van de groep <span className="subtle small">(optioneel)</span></label>
          <input id="merge-group" className="input" value={group} maxLength={140} disabled={busy} onChange={e => setGroup(e.target.value)} placeholder="Bijv. Warmtepompartikel op de regiopagina's" />
          <p className="field-hint">Met een naam staat de kaart onder die naam op het bord, met eronder welke zoekwoorden en pagina&apos;s erbij horen. De meting krijgt dezelfde naam in Experimenten.</p>
          <div className="merge-result">
            <p><b>Na samenvoegen:</b> één kaart, {group.trim() ? <>&ldquo;{group.trim()}&rdquo; ({all.length} kaarten)</> : label(mainTask)}, in de kolom {COLUMNS.find(c => c.id === columnOf(mainTask.status))!.label}.{queries.length > 1 ? ` Zoekwoorden: ${queries.map(q => `"${q}"`).join(", ")}.` : ""}</p>
            <p>Zet je hem later op uitgevoerd, dan legt de meting alle zoekwoorden en pagina&apos;s vast. Samenvoegen telt niet als afwijzing, en met Splitsen in de kaart maak je het ongedaan.</p>
            <p className="subtle small">Samen indicatief {gainShort(all.reduce((s, t) => s + (t.signal.gain || 0), 0))}.</p>
          </div>
          <div className="inline-form-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Annuleren</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={go} disabled={busy}><Layers aria-hidden />{busy ? "Bezig…" : `${tasks.length} kaarten samenvoegen`}</button>
          </div>
        </div>
      </div>
    </>
  )
}
