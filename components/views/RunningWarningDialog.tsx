"use client"

// Waarschuwing als je een kaart plant of in uitvoering zet terwijl er op dezelfde pagina of hetzelfde
// zoekwoord nog een meting loopt. Anders pas je weer iets aan en weet je niet of het vorige heeft geholpen.

import { useEffect, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { overlapText, waitsForFirst, waitUntil } from "@/lib/running"
import { dateShort } from "@/lib/format"
import { groupName } from "@/lib/workflow"

const TO_LABEL: Record<string, string> = { goedgekeurd: "Gepland", in_uitvoering: "In uitvoering, nog niet live" }

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
  // Kop en uitleg naar de sterkste overlap: zelfde pagina, pagina genoemd, of dezelfde plaats
  const top = w.hits[0]
  const where = top.level === "plaats" ? `In ${top.on[0]}` : top.level === "zoekwoord" ? "Op dit zoekwoord" : top.level === "genoemd" ? "Op een meting die deze pagina raakt" : "Op deze pagina"
  const what = top.source === "content" ? "een contentmeting" : "een SEO-experiment"
  const first = waitsForFirst(w.hits)
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
          <h2 id="rw-title"><AlertTriangle aria-hidden className="rw-icon" />{top.level === "genoemd" ? "Er loopt al een meting die deze pagina raakt" : `${where} loopt al ${what}`}</h2>
          <button className="icon-btn" onClick={() => answerRunningWarning(false)} aria-label="Sluiten"><X /></button>
        </div>
        <div className="modal-body">
          <p id="rw-text" style={{ marginTop: 0 }}>Je zet <b>{name}</b> op {TO_LABEL[w.to] || w.to}. {top.level === "plaats" ? `In dezelfde plaats loopt al ${what} op een andere pagina. Zoekwoorden en interne links in ${top.on[0]} hangen vaak samen, dus een nieuwe wijziging kan de interpretatie van de resultaten beïnvloeden.` : top.level === "genoemd" ? "Deze pagina wordt genoemd in een meting die nog loopt. Een nieuwe wijziging kan de interpretatie van de resultaten beïnvloeden." : `${where} loopt al ${what}. Een nieuwe wijziging kan de interpretatie van de resultaten beïnvloeden.`}</p>
          <ul className="rw-list">
            {w.hits.slice(0, 3).map(h => (
              <li key={h.experiment.id}>
                <b>{h.experiment.family_title || h.experiment.description}</b>
                <span className="subtle small">
                  Aangepast op {dateShort(h.experiment.changed_at)}
                  {` · ${overlapText(h)}`}{h.on.length && h.level !== "plaats" ? `: ${h.on.slice(0, 3).join(", ")}` : ""}
                  {h.assessed ? ` · eerste beoordeling gedaan · eindmeting rond ${dateShort(h.end)}` : ` · eerste beoordeling rond ${dateShort(h.firstAssessment)} · eindmeting rond ${dateShort(h.end)}`}
                </span>
                {h.source === "seo" && <button type="button" className="link-btn small" onClick={() => { const k = h.experiment.advice_key; answerRunningWarning(false); openTask(k) }}>Bekijk die meting</button>}
              </li>
            ))}
            {w.hits.length > 3 && <li className="subtle small">en nog {w.hits.length - 3} {w.hits.length - 3 === 1 ? "meting" : "metingen"}</li>}
          </ul>
          <p className="field-hint">{first ? `Na de eerste beoordeling (rond ${dateShort(until)}) weet je of de vorige wijziging een signaal geeft; daarna kun je verder zonder het experiment te verstoren.` : `De eerste beoordeling is al gedaan. Voer je nu uit, dan wordt de eindmeting (rond ${dateShort(until)}) als "mogelijk beïnvloed" gemarkeerd.`} Kies je &ldquo;toch uitvoeren&rdquo;, dan legt het dashboard de overlap vast bij beide metingen.</p>
          <div className="inline-form-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => answerRunningWarning(false)} disabled={busy}>Annuleren</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => answerRunningWarning(true)} disabled={busy}>Toch uitvoeren en overlap vastleggen</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={postpone} disabled={busy}>{busy ? "Bezig…" : first ? `Na de eerste beoordeling (${dateShort(until)})` : `Na de eindmeting (${dateShort(until)})`}</button>
          </div>
        </div>
      </div>
    </>
  )
}
