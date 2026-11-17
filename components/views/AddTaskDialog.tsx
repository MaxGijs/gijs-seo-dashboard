"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useWorkspace, type NewTask } from "@/lib/workspace"
import type { Level, Priority } from "@/lib/types"

// Eigen taak toevoegen. Met een zoekwoord of pagina krijgt de taak dezelfde live analyse
// en automatische meting als de adviezen uit de data.
export default function AddTaskDialog({ onClose }: { onClose: () => void }) {
  const { addTask, toast, openTask } = useWorkspace()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState("")
  const [priority, setPriority] = useState<Priority>("middel")
  const [effort, setEffort] = useState<Level>("middel")
  const [status, setStatusValue] = useState<NewTask["status"]>("goedgekeurd")
  const [goal, setGoal] = useState<NonNullable<NewTask["goal"]>>("seo")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError("Geef de taak een titel."); return }
    const p = page.trim()
    if (p && !/^(https?:\/\/(www\.)?groeninjestraat\.nl)?\/[^\s]*$/i.test(p)) {
      setError("Vul een pad in zoals /regio/overijssel/zwolle, of een volledige URL van groeninjestraat.nl."); return
    }
    setBusy(true)
    const key = await addTask({ title, description, query: goal === "seo" ? query : "", page: p, priority, status, effort, goal })
    setBusy(false)
    if (key) {
      toast("Taak toegevoegd")
      onClose()
      if (goal !== "seo" || query.trim() || p) openTask(key)
    }
  }

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head">
          <h2 id="add-title">Taak toevoegen</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Sluiten"><X /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <label className="field-label" htmlFor="t-title">Titel</label>
          <input id="t-title" ref={firstRef} className="input" value={title} onChange={e => { setTitle(e.target.value); setError(null) }} placeholder="Bijvoorbeeld: FAQ over subsidie toevoegen aan /isolatie" maxLength={140} />

          <label className="field-label" htmlFor="t-desc">Wat moet er gebeuren? <span className="subtle">(optioneel)</span></label>
          <textarea id="t-desc" className="textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Korte omschrijving, zodat je later weet wat de bedoeling was" />

          <span className="field-label">Wat moet het opleveren?</span>
          <div className="seg goal-seg" role="radiogroup" aria-label="Doel van de taak">
            {([["seo", "Beter gevonden worden"], ["conversie", "Meer aanvragen"], ["overig", "Overig"]] as const).map(([v, l]) => (
              <button type="button" key={v} role="radio" aria-checked={goal === v} className={goal === v ? "is-active" : ""} onClick={() => setGoal(v)}>{l}</button>
            ))}
          </div>
          <p className="field-hint" style={{ marginBottom: 12 }}>{goal === "seo" ? "Gemeten op posities, vertoningen en klikken in Google." : goal === "conversie" ? "Bijvoorbeeld de woningscan verkorten of het formulier verbeteren. Gemeten op energiescanaanvragen in GA4 (vóór en na), niet op Google-posities." : "Wordt niet automatisch gemeten."}</p>

          <div className="modal-row">
            {goal === "seo" && <div>
              <label className="field-label" htmlFor="t-query">Zoekwoord <span className="subtle">(optioneel)</span></label>
              <input id="t-query" className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="isolatie zwolle" />
            </div>}
            <div>
              <label className="field-label" htmlFor="t-page">{goal === "conversie" ? "Alleen bezoekers via deze pagina meten" : "Pagina"} <span className="subtle">(optioneel{goal === "conversie" ? "; leeg = hele site" : ""})</span></label>
              <input id="t-page" className="input" value={page} onChange={e => { setPage(e.target.value); setError(null) }} placeholder="/regio/overijssel/zwolle" />
            </div>
          </div>
          {goal === "seo" && <p className="field-hint">Met een zoekwoord of pagina krijgt de taak een live diagnose en, als je hem uitvoert, een automatische meting.</p>}

          <div className="modal-row modal-row-3">
            <div>
              <label className="field-label" htmlFor="t-prio">Prioriteit</label>
              <select id="t-prio" className="select" value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                <option value="hoog">Hoog</option><option value="middel">Middel</option><option value="laag">Laag</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="t-effort">Inspanning</label>
              <select id="t-effort" className="select" value={effort} onChange={e => setEffort(e.target.value as Level)}>
                <option value="laag">Laag</option><option value="middel">Middel</option><option value="hoog">Hoog</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="t-status">Kolom</label>
              <select id="t-status" className="select" value={status} onChange={e => setStatusValue(e.target.value as NewTask["status"])}>
                <option value="nieuw">Te beoordelen</option><option value="goedgekeurd">Gepland</option><option value="in_uitvoering">In uitvoering</option>
              </select>
            </div>
          </div>

          {error && <p className="field-error">{error}</p>}
          <div className="inline-form-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuleren</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Opslaan…" : "Taak toevoegen"}</button>
          </div>
        </form>
      </div>
    </>
  )
}
