"use client"

// Opzet van een meting corrigeren als je iets verkeerd hebt ingevuld (live-datum, omschrijving,
// aangepaste pagina's, soort wijziging). Kan alleen vóór het eerste meetpunt. Wat er stond, blijft bewaard.

import { useEffect, useState } from "react"
import { History, PencilLine, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { canCorrect, changeTypesLabel, changeTypesOf, correctionsOf, inferChangeType, liveDateIn, type ChangeType } from "@/lib/experiment"
import ChangeTypeSelect from "./ChangeTypeSelect"
import { addDaysIso, measureDate, CRAWL_DAY } from "@/lib/measureLogic"
import { dateLong, dateShort, today } from "@/lib/format"
import type { Experiment } from "@/lib/types"

export function CorrectButton({ e }: { e: Experiment }) {
  const [open, setOpen] = useState(false)
  if (!canCorrect(e)) return null
  return (
    <>
      <button type="button" className="link-btn exp-correct-btn" onClick={() => setOpen(true)}><PencilLine aria-hidden />Opzet corrigeren</button>
      {open && <CorrectDialog e={e} onClose={() => setOpen(false)} />}
    </>
  )
}

// Eerder gecorrigeerd: wanneer, door wie en wat er stond
export function CorrectionNote({ e }: { e: Experiment }) {
  const list = correctionsOf(e)
  if (!list.length) return null
  const last = list[list.length - 1]
  return (
    <details className="exp-correction">
      <summary><History aria-hidden />Opzet gecorrigeerd op {dateShort(last.at)}{last.by ? ` door ${last.by}` : ""}</summary>
      <ul>
        {list.map((c, i) => (
          <li key={i}>
            <span className="subtle small">{dateShort(c.at)} · daarvoor stond er:</span>
            <span className="small">Live-datum {dateLong(c.from.changed_at)}{changeTypesOf(c.from).length ? ` · ${changeTypesLabel(changeTypesOf(c.from))}` : ""}{c.from.changed_pages?.length ? ` · ${c.from.changed_pages.join(", ")}` : ""}</span>
            <span className="small clamp2" title={c.from.description}>{c.from.description}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function CorrectDialog({ e, onClose }: { e: Experiment; onClose: () => void }) {
  const { correctExperiment } = useWorkspace()
  const [date, setDate] = useState(e.changed_at)
  const [desc, setDesc] = useState(e.description)
  const [pages, setPages] = useState((e.changed_pages || []).join("\n"))
  const [types, setTypes] = useState<ChangeType[]>(() => { const t = changeTypesOf(e.baseline); return t.length ? t : [inferChangeType(e.description)] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !busy) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, busy])

  const max = today(), min = addDaysIso(max, -90)
  const said = liveDateIn(desc)
  const mismatch = said && said !== date && said <= max ? said : null
  const dateChanged = date !== e.changed_at
  const save = async () => {
    setBusy(true); setError(null)
    const list = pages.split(/[\n,]+/).map(p => p.trim()).filter(Boolean)
    const err = await correctExperiment(e.id, { description: desc.trim(), changed_at: date, changed_pages: list, change_types: types })
    if (err) { setError(err); setBusy(false) } else onClose()
  }

  return (
    <>
      <div className="panel-overlay" style={{ zIndex: 320 }} onClick={() => !busy && onClose()} aria-hidden />
      <div className="modal" style={{ zIndex: 330 }} role="dialog" aria-modal="true" aria-labelledby="xcorr-title">
        <div className="modal-head">
          <h2 id="xcorr-title">Opzet corrigeren</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Sluiten"><X /></button>
        </div>
        <div className="modal-body">
          <p className="field-hint" style={{ marginTop: 0 }}>Verkeerd ingevuld? Pas het aan vóór het eerste meetpunt ({dateShort(measureDate(e.changed_at, CRAWL_DAY))}). Daarna ligt de opzet vast. Wat er nu staat, wordt bewaard.</p>

          <label className="field-label" htmlFor="xcorr-date">Live-datum (wanneer stond de wijziging online?)</label>
          <input id="xcorr-date" type="date" className="input" value={date} min={min} max={max} disabled={busy} onChange={ev => setDate(ev.target.value)} style={{ maxWidth: 200 }} />
          {mismatch && (
            <p className="xcorr-warn">In de omschrijving staat live op {dateLong(mismatch)}, maar de live-datum is {dateLong(date)}.{" "}
              <button type="button" className="link-btn" onClick={() => setDate(mismatch)}>Zet op {dateShort(mismatch)}</button>
            </p>
          )}
          <p className="field-hint">{dateChanged
            ? `Nieuwe nulmeting: de 28 dagen vóór ${dateShort(date)} (${dateShort(addDaysIso(date, -28))} t/m ${dateShort(addDaysIso(date, -1))}). Meetpunten: dag 7 rond ${dateShort(measureDate(date, 7))}, dag 14 rond ${dateShort(measureDate(date, 14))}, dag 28 rond ${dateShort(measureDate(date, 28))}.`
            : "De meting vergelijkt de 28 dagen vóór deze datum met de dagen erna."}</p>

          <label className="field-label" htmlFor="xcorr-desc">Wat is er aangepast?</label>
          <textarea id="xcorr-desc" className="textarea" rows={6} value={desc} maxLength={4000} disabled={busy} onChange={ev => setDesc(ev.target.value)} />

          <label className="field-label" htmlFor="xcorr-pages">Aangepaste pagina&apos;s (één per regel)</label>
          <textarea id="xcorr-pages" className="textarea" rows={3} value={pages} disabled={busy} onChange={ev => setPages(ev.target.value)} placeholder="/regio/gelderland/arnhem" />
          <p className="field-hint">Hierop wordt gemeten.</p>

          <ChangeTypeSelect id="xcorr-type" description={desc} value={types} onChange={v => v && setTypes(v)} disabled={busy} />

          {error && <p className="field-error">{error}</p>}
          <div className="inline-form-actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Annuleren</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !desc.trim() || !date}>{busy ? "Bezig…" : "Correctie opslaan"}</button>
          </div>
        </div>
      </div>
    </>
  )
}
