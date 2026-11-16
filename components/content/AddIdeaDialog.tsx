"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { type ContentIdea, FORMATS, serviceLabel } from "@/lib/content/model"

// Eigen idee: een klantvraag, een vakartikel of iets wat een medewerker opviel.
// Krijgt dezelfde score, briefing en workflow als de automatische kansen.
export default function AddIdeaDialog({ services, onClose, onAdded }: { services: string[]; onClose: () => void; onAdded: (i: ContentIdea) => void }) {
  const { toast } = useWorkspace()
  const [kind, setKind] = useState<"idee" | "klantvraag" | "bron">("idee")
  const [title, setTitle] = useState("")
  const [why, setWhy] = useState("")
  const [service, setService] = useState("")
  const [format, setFormat] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [sourceTitle, setSourceTitle] = useState("")
  const [sourceDate, setSourceDate] = useState("")
  const [question, setQuestion] = useState("")
  const [regions, setRegions] = useState<string[]>([])
  const [urgency, setUrgency] = useState<"hoog" | "middel" | "laag">("middel")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = title.trim() || (kind === "klantvraag" ? question.trim().slice(0, 120) : "")
    if (!t) { setError(kind === "klantvraag" ? "Vul de vraag van de klant of een onderwerp in." : "Geef het idee een titel of onderwerp."); return }
    if (kind === "bron" && !/^https?:\/\/\S+$/i.test(sourceUrl.trim())) { setError("Vul de link naar de bron in."); return }
    if (sourceUrl.trim() && !/^https?:\/\/\S+$/i.test(sourceUrl.trim())) { setError("De bronlink moet beginnen met https://"); return }
    setBusy(true)
    const res = await fetch("/api/content", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, title: t, why, question: question || undefined, regions, urgency, service: service || undefined, format: format || undefined, sourceUrl: sourceUrl.trim() || undefined, sourceTitle: sourceTitle || undefined, sourceDate: sourceDate || undefined }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error || "Opslaan mislukt"); return }
    toast("Idee toegevoegd en gescoord")
    onAdded(json.idea)
    onClose()
  }

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ai-title">
        <div className="modal-head">
          <h2 id="ai-title">Idee toevoegen</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Sluiten"><X /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <div className="seg" role="radiogroup" aria-label="Soort idee" style={{ alignSelf: "flex-start" }}>
            {([["idee", "Eigen idee"], ["klantvraag", "Klantvraag"], ["bron", "Artikel of nieuws"]] as const).map(([k, l]) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? "is-active" : ""} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          {kind === "klantvraag" && (
            <>
              <label className="field-label" htmlFor="ai-q">Letterlijke vraag van de klant</label>
              <textarea id="ai-q" className="textarea" value={question} onChange={e => { setQuestion(e.target.value); if (!title) setError(null) }} placeholder="Zoals de klant het vroeg, bijvoorbeeld: “Kan ik een warmtepomp nemen als mijn huis nog niet geïsoleerd is?”" />
            </>
          )}
          <label className="field-label" htmlFor="ai-t">{kind === "klantvraag" ? "Onderwerp of werktitel" : "Onderwerp of werktitel"}</label>
          <input id="ai-t" ref={first} className="input" maxLength={200} value={title} onChange={e => { setTitle(e.target.value); setError(null) }}
            placeholder={kind === "klantvraag" ? "Bijvoorbeeld: Warmtepomp in een slecht geïsoleerd huis" : "Bijvoorbeeld: Netcongestie in Gelderland: kun je nog een warmtepomp nemen?"} />
          <label className="field-label" htmlFor="ai-w">Waarom nu? <span className="subtle">(aanleiding)</span></label>
          <textarea id="ai-w" className="textarea" value={why} onChange={e => setWhy(e.target.value)} placeholder="Wat is de aanleiding, hoe vaak horen we dit, wat moet de lezer weten?" />
          <label className="field-label" htmlFor="ai-u">Link naar de bron {kind !== "bron" && <span className="subtle">(optioneel)</span>}</label>
          <input id="ai-u" className="input" value={sourceUrl} onChange={e => { setSourceUrl(e.target.value); setError(null) }} placeholder="https://…" />
          {sourceUrl.trim() && (
            <div className="modal-row">
              <div><label className="field-label" htmlFor="ai-st">Titel van de bron <span className="subtle">(optioneel)</span></label><input id="ai-st" className="input" value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} /></div>
              <div><label className="field-label" htmlFor="ai-sd">Datum van de bron</label><input id="ai-sd" type="date" className="input" value={sourceDate} onChange={e => setSourceDate(e.target.value)} /></div>
            </div>
          )}
          <p className="field-label" style={{ marginBottom: 0 }}>Regio <span className="subtle">(optioneel)</span></p>
          <div className="tag-pick" role="group" aria-label="Regio">
            {["overijssel", "gelderland", "utrecht", "flevoland"].map(r => (
              <button type="button" key={r} aria-pressed={regions.includes(r)} className={`chip chip-sm${regions.includes(r) ? " is-active" : ""}`} onClick={() => setRegions(x => (x.includes(r) ? x.filter(y => y !== r) : [...x, r]))}>{r[0].toUpperCase() + r.slice(1)}</button>
            ))}
          </div>
          <div className="modal-row modal-row-3">
            <div>
              <label className="field-label" htmlFor="ai-g">Urgentie</label>
              <select id="ai-g" className="select" value={urgency} onChange={e => setUrgency(e.target.value as typeof urgency)}>
                <option value="hoog">Hoog: nu actueel</option><option value="middel">Middel</option><option value="laag">Laag: kan wachten</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="ai-s">Dienst</label>
              <select id="ai-s" className="select" value={service} onChange={e => setService(e.target.value)}>
                <option value="">Automatisch herkennen</option>
                {services.map(s => <option key={s} value={s}>{serviceLabel(s)[0].toUpperCase() + serviceLabel(s).slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="ai-f">Contentvorm</label>
              <select id="ai-f" className="select" value={format} onChange={e => setFormat(e.target.value)}>
                <option value="">Automatisch kiezen</option>
                {FORMATS.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="inline-form-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuleren</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Scoren…" : "Toevoegen"}</button>
          </div>
        </form>
      </div>
    </>
  )
}
