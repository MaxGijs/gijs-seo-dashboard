"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { addDays, dateLong, today } from "@/lib/format"

// Herinnering toevoegen: iets wat op een datum terug moet komen ("17 december beslist de gemeente opnieuw").
export default function ReminderDialog({ onClose }: { onClose: () => void }) {
  const { addReminder, toast, users, me } = useWorkspace()
  const t0 = today()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState("")
  const [link, setLink] = useState("")
  const [owner, setOwner] = useState<string>(me || "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  useEffect(() => { if (!owner && me) setOwner(me) }, [me, owner])

  const quick: [string, string][] = [["Morgen", addDays(t0, 1)], ["Over 1 week", addDays(t0, 7)], ["Over 2 weken", addDays(t0, 14)], ["Over 1 maand", addDays(t0, 30)]]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError("Waaraan wil je herinnerd worden?"); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Kies een datum."); return }
    if (date < t0) { setError("Kies vandaag of een datum in de toekomst."); return }
    if (link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) { setError("De link moet beginnen met https://"); return }
    setBusy(true)
    const key = await addReminder({ title, description, date, link, owner: owner || null })
    setBusy(false)
    if (key) { toast(`Herinnering staat op ${dateLong(date)}`); onClose() }
  }

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rem-title">
        <div className="modal-head">
          <h2 id="rem-title">Herinnering toevoegen</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Sluiten"><X /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <label className="field-label" htmlFor="r-title">Waaraan wil je herinnerd worden?</label>
          <input id="r-title" ref={firstRef} className="input" value={title} onChange={e => { setTitle(e.target.value); setError(null) }} placeholder="Bijvoorbeeld: Apeldoorn beslist opnieuw over het warmtenet" maxLength={140} />

          <label className="field-label" htmlFor="r-desc">Wat moet je dan doen of weten? <span className="subtle">(optioneel)</span></label>
          <textarea id="r-desc" className="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Bijvoorbeeld: de warmtenet-oplossing wordt niet gehaald; kijk wat de gemeente besluit en of we daar een artikel of regiotekst over maken." />

          <span className="field-label">Wanneer?</span>
          <div className="quick-dates">
            {quick.map(([l, d]) => <button type="button" key={l} className={`chip${date === d ? " is-active" : ""}`} onClick={() => { setDate(d); setError(null) }}>{l}</button>)}
            <input id="r-date" type="date" className="input" min={t0} value={date} onChange={e => { setDate(e.target.value); setError(null) }} aria-label="Datum" />
          </div>
          {date && <p className="field-hint">Komt terug op {dateLong(date)}: bovenaan Vandaag en in Te beoordelen.</p>}

          <div className="modal-row">
            <div>
              <label className="field-label" htmlFor="r-link">Link <span className="subtle">(optioneel)</span></label>
              <input id="r-link" className="input" value={link} onChange={e => { setLink(e.target.value); setError(null) }} placeholder="https://… (nieuwsbericht of raadsstuk)" inputMode="url" />
            </div>
            <div>
              <label className="field-label" htmlFor="r-owner">Voor wie</label>
              <select id="r-owner" className="select" value={owner} onChange={e => setOwner(e.target.value)}>
                <option value="">Iedereen</option>
                {users.map(u => <option key={u.email} value={u.email}>{u.email === me ? `Ik (${u.name || u.email})` : u.name || u.email}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="field-error">{error}</p>}
          <div className="inline-form-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuleren</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Opslaan…" : "Herinnering opslaan"}</button>
          </div>
        </form>
      </div>
    </>
  )
}
