"use client"

// Meerdere taken uit "In uitvoering" in één keer op uitgevoerd zetten, met dezelfde toelichting.
// Elke taak krijgt zijn eigen nulmeting en meting (7, 14 en 28 dagen), precies zoals vanuit het paneel.

import ChangeTypeSelect from "@/components/panel/ChangeTypeSelect"
import { inferChangeType, type ChangeType } from "@/lib/experiment"
import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { prepareExecution } from "@/lib/execute"
import { KindLabel } from "@/components/ui"
import type { Task } from "@/lib/types"

type Result = { key: string; ok: boolean; reason?: string }

export default function BulkExecuteDialog({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const { getDetail, ctrModel, listWindow, pages, signals, overview, setStatus, toast, openTask } = useWorkspace()
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tasks.map(t => t.key)))
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<Result[] | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, busy])

  const [changeType, setChangeType] = useState<ChangeType | null>(null)
  const chosen = useMemo(() => tasks.filter(t => picked.has(t.key)), [tasks, picked])
  const allOn = picked.size === tasks.length
  const toggle = (k: string) => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chosen.length) { setError("Kies minstens één taak."); return }
    if (!text.trim()) { setError("Beschrijf kort wat je hebt aangepast, zodat je later weet wat er gemeten wordt."); return }
    setBusy(true); setProgress(0)
    const out: Result[] = []
    // Eén voor één: elke taak haalt zijn eigen live cijfers op voor de nulmeting
    for (const t of chosen) {
      const prep = await prepareExecution(t, { getDetail, ctrModel, listWindow, pages, signalCount: signals.length, overview }, text, changeType || inferChangeType(text))
      if (!prep.ok) { out.push({ key: t.key, ok: false, reason: prep.reason }) }
      else {
        const ok = await setStatus({ ...t, signal: prep.signal }, "uitgevoerd", { note: t.note, experiment: prep.experiment })
        out.push({ key: t.key, ok, reason: ok ? undefined : "Opslaan mislukt" })
      }
      setProgress(out.length)
    }
    setBusy(false)
    const good = out.filter(r => r.ok).length
    if (good === out.length) { toast(`${good} ${good === 1 ? "taak" : "taken"} op uitgevoerd gezet; de metingen zijn gestart`); onClose() }
    else setResults(out)
  }

  const label = (t: Task) => (t.signal.query ? `"${t.signal.query}"` : t.signal.headline)

  return (
    <>
      <div className="panel-overlay" onClick={() => !busy && onClose()} aria-hidden />
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
        <div className="modal-head">
          <h2 id="bulk-title">Meerdere taken afronden</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Sluiten"><X /></button>
        </div>
        {results ? (
          <div className="modal-body">
            <p>{results.filter(r => r.ok).length} van de {results.length} taken staan nu in Evalueren. Deze lukten niet:</p>
            <ul className="bulk-list">
              {results.filter(r => !r.ok).map(r => { const t = tasks.find(x => x.key === r.key)!; return (
                <li key={r.key}><span className="bulk-main"><b>{label(t)}</b><span className="field-error" style={{ margin: 0 }}>{r.reason}</span></span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onClose(); openTask(t.key, "execute") }}>Openen</button></li>
              ) })}
            </ul>
            <div className="inline-form-actions"><button className="btn btn-primary btn-sm" onClick={onClose}>Sluiten</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="modal-body">
            <p className="field-hint" style={{ marginTop: 0 }}>Zet taken die klaar zijn in één keer op uitgevoerd. Elke taak krijgt zijn eigen nulmeting; de metingen volgen na 7 dagen (signalering), 14 dagen (eerste beoordeling) en 28 dagen (eindmeting).</p>
            <div className="bulk-head">
              <span className="field-label" style={{ margin: 0 }}>Welke taken? <span className="subtle">({chosen.length} van {tasks.length})</span></span>
              <button type="button" className="link-btn small" onClick={() => setPicked(allOn ? new Set() : new Set(tasks.map(t => t.key)))}>{allOn ? "Niets selecteren" : "Alles selecteren"}</button>
            </div>
            <ul className="bulk-list" aria-label="Taken in uitvoering">
              {tasks.map(t => (
                <li key={t.key}>
                  <label className="bulk-item">
                    <input type="checkbox" checked={picked.has(t.key)} onChange={() => toggle(t.key)} disabled={busy} />
                    <span className="bulk-main">
                      <KindLabel signal={t.signal} />
                      <b>{label(t)}</b>
                      <span className="subtle small">{t.signal.action || t.signal.title}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="field-label" htmlFor="bulk-desc">Wat heb je aangepast? <span className="subtle">(geldt voor alle gekozen taken)</span></label>
            <textarea id="bulk-desc" ref={textRef} className="textarea" rows={3} value={text} disabled={busy}
              onChange={e => { setText(e.target.value); setError(null) }} placeholder="Bijvoorbeeld: title en meta description herschreven en interne links vanaf de provinciepagina toegevoegd" />
            <ChangeTypeSelect id="bulk-type" description={text} value={changeType} onChange={setChangeType} disabled={busy} />
            {error && <p className="field-error">{error}</p>}
            <div className="inline-form-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Annuleren</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !chosen.length}>
                <CheckCircle2 aria-hidden />{busy ? `Bezig… ${progress} van ${chosen.length}` : `${chosen.length} ${chosen.length === 1 ? "taak" : "taken"} op uitgevoerd zetten`}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}
