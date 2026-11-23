"use client"

// Waarschuwing als je een kaart plant of in uitvoering zet terwijl er op dezelfde pagina of hetzelfde
// zoekwoord nog een meting loopt. Anders pas je weer iets aan en weet je niet of het vorige heeft geholpen.

import { useEffect, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { waitUntil } from "@/lib/running"
import { dateShort } from "@/lib/format"
import { groupName } from "@/lib/workflow"

const TO_LABEL: Record<string, string> = { goedgekeurd: "Gepland", in_uitvoering: "In uitvoering" }

export default function RunningWarningDialog() {
  const { runningWarning: w, answerRunningWarning, setStatus, openTask } = useWorkspace()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!w) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") answerRunningWarning(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [w, answerRunningWarning])
  if (!w) return null

  const until = waitUntil(w.hits)
  const name = groupName(w.task) || (w.task.signal.query ? `"${w.task.signal.query}"` : w.task.signal.headline)
  const postpone = async () => {
    setBusy(true)
    const task = w.task
    answerRunningWarning(false)
    await setStatus(task, "uitgesteld", { note: task.note, snoozeUntil: until })
    setBusy(false)
  }

  return (
    <>
      <div className="panel-overlay" style={{ zIndex: 320 }} onClick={() => answerRunningWarning(false)} aria-hidden />
      <div className="modal running-warning" style={{ zIndex: 330 }} role="alertdialog" aria-modal="true" aria-labelledby="rw-title" aria-describedby="rw-text">
        <div className="modal-head">
          <h2 id="rw-title"><AlertTriangle aria-hidden className="rw-icon" />Hier loopt al een meting</h2>
          <button className="icon-btn" onClick={() => answerRunningWarning(false)} aria-label="Sluiten"><X /></button>
        </div>
        <div className="modal-body">
          <p id="rw-text" style={{ marginTop: 0 }}>Je zet <b>{name}</b> op {TO_LABEL[w.to] || w.to}. Op dezelfde pagina of hetzelfde zoekwoord wordt een eerdere aanpassing nog gemeten. Pas je nu weer iets aan, dan is niet meer te zien of die vorige aanpassing heeft geholpen.</p>
          <ul className="rw-list">
            {w.hits.slice(0, 3).map(h => (
              <li key={h.experiment.id}>
                <b>{h.experiment.family_title || h.experiment.description}</b>
                <span className="subtle small">
                  Aangepast op {dateShort(h.experiment.changed_at)}
                  {h.on.length ? ` · zelfde ${h.on.some(o => o.startsWith('"')) ? "zoekwoord/pagina" : "pagina"}: ${h.on.slice(0, 3).join(", ")}` : h.sameCard ? " · deze kaart zelf" : ""}
                  {h.next && h.next >= new Date().toISOString().slice(0, 10) ? ` · volgende meting ${dateShort(h.next)}` : ""} · eindoordeel rond {dateShort(h.end)}
                </span>
                <button type="button" className="link-btn small" onClick={() => { const k = h.experiment.advice_key; answerRunningWarning(false); openTask(k) }}>Bekijk die meting</button>
              </li>
            ))}
            {w.hits.length > 3 && <li className="subtle small">en nog {w.hits.length - 3} {w.hits.length - 3 === 1 ? "meting" : "metingen"}</li>}
          </ul>
          <p className="field-hint">Advies: wacht tot na {dateShort(until)}. Raakt deze aanpassing de meting niet (bijvoorbeeld een tikfout of een andere pagina-onderdeel zonder invloed op Google), dan kun je gewoon doorgaan.</p>
          <div className="inline-form-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => answerRunningWarning(false)} disabled={busy}>Annuleren</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => answerRunningWarning(true)} disabled={busy}>Toch {w.to === "goedgekeurd" ? "plannen" : "in uitvoering zetten"}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={postpone} disabled={busy}>{busy ? "Bezig…" : `Uitstellen tot ${dateShort(until)}`}</button>
          </div>
        </div>
      </div>
    </>
  )
}
