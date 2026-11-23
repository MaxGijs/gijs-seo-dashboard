"use client"

// Contentkansen samenvoegen tot één artikel: kies de hoofdkans en de titel. De andere kansen gaan
// erin op (zoekwoorden, bronnen, aanleidingen) en zijn met Splitsen terug te halen.

import { useEffect, useMemo, useState } from "react"
import { Layers, X } from "lucide-react"
import { effectiveScore, serviceLabel, STATUS_META, type ContentIdea } from "@/lib/content/model"
import { num } from "@/lib/format"

export async function postMerge(body: Record<string, unknown>) {
  const res = await fetch("/api/content/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json as { ok: true; idea: ContentIdea | null; merged?: string[]; split?: string }
}

// Standaard hoofdkans: de kans die het verst is, daarna de hoogste score
export const defaultMainIdea = (ideas: ContentIdea[]) => [...ideas].sort((a, b) => STATUS_META[b.status].step - STATUS_META[a.status].step || effectiveScore(b) - effectiveScore(a))[0]

export default function ContentMergeDialog({ ideas, initialMain, onClose, onDone }: { ideas: ContentIdea[]; initialMain?: string; onClose: () => void; onDone: (main: ContentIdea, mergedIds: string[]) => void }) {
  const [main, setMain] = useState(initialMain || defaultMainIdea(ideas).id)
  const mainIdea = ideas.find(i => i.id === main)!
  const [title, setTitle] = useState(mainIdea.title)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!touched) setTitle(mainIdea.title) }, [main]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, busy])

  const others = ideas.filter(i => i.id !== main)
  const preview = useMemo(() => {
    const kw = new Map<string, number>()
    for (const k of ideas.flatMap(i => i.keywords || [])) kw.set(k.query.toLowerCase(), Math.max(kw.get(k.query.toLowerCase()) || 0, k.impressions || 0))
    const services = [...new Set(ideas.map(i => i.service).filter(Boolean))] as string[]
    return { keywords: kw.size, demand: [...kw.values()].reduce((a, b) => a + b, 0), sources: new Set(ideas.flatMap(i => (i.sources || []).map(s => s.url || s.title))).size, services }
  }, [ideas])

  const go = async () => {
    setBusy(true); setError(null)
    try {
      const r = await postMerge({ action: "merge", mainId: main, ids: others.map(o => o.id), title })
      onDone(r.idea!, r.merged || [])
    } catch (e: any) { setError(e.message); setBusy(false) }
  }

  return (
    <>
      <div className="panel-overlay" style={{ zIndex: 320 }} onClick={() => !busy && onClose()} aria-hidden />
      <div className="modal" style={{ zIndex: 330 }} role="dialog" aria-modal="true" aria-labelledby="cmerge-title">
        <div className="modal-head">
          <h2 id="cmerge-title">{ideas.length} contentkansen samenvoegen tot één artikel</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Sluiten"><X /></button>
        </div>
        <div className="modal-body">
          <p className="field-hint" style={{ marginTop: 0 }}>Eén artikel dat alle vragen beantwoordt. Kies welke kans blijft staan; de andere gaan erin op met hun zoekwoorden, bronnen en aanleiding.</p>
          <fieldset className="merge-pick">
            <legend className="field-label">Hoofdkans</legend>
            {ideas.map(i => (
              <label key={i.id} className={`merge-option${main === i.id ? " is-main" : ""}`}>
                <input type="radio" name="cmerge-main" value={i.id} checked={main === i.id} onChange={() => setMain(i.id)} disabled={busy} />
                <span className="bulk-main">
                  <span className="merge-meta"><span className="subtle small">{STATUS_META[i.status].label} · score {effectiveScore(i)} · {serviceLabel(i.service)}</span></span>
                  <b>{i.title}</b>
                  {i.why_now && <span className="subtle small clamp2">{i.why_now}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field-label" htmlFor="cmerge-titel">Titel van het artikel</label>
          <input id="cmerge-titel" className="input" value={title} maxLength={200} disabled={busy} onChange={e => { setTitle(e.target.value); setTouched(true) }} />
          <p className="field-hint">Kies een titel die alle onderwerpen dekt, bijvoorbeeld de vraag die ze gemeen hebben.</p>
          <div className="merge-result">
            <p><b>Na samenvoegen:</b> één kans met {num(preview.keywords)} zoekwoorden ({num(preview.demand)} vertoningen in 28 dagen) en {preview.sources} {preview.sources === 1 ? "bron" : "bronnen"}{preview.services.length > 1 ? `, over ${preview.services.map(serviceLabel).join(" en ")}` : ""}.</p>
            <p>De andere {others.length === 1 ? "kans verdwijnt" : `${others.length} kansen verdwijnen`} uit de lijst en {others.length === 1 ? "staat" : "staan"} in de hoofdkans. Samenvoegen telt niet als afwijzen; met Splitsen zet je alles terug zoals het was.{mainIdea.briefing ? " De hoofdkans heeft al een briefing: werk die daarna bij met de nieuwe zoekwoorden." : ""}</p>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="inline-form-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Annuleren</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={go} disabled={busy || !title.trim()}><Layers aria-hidden />{busy ? "Bezig…" : `${ideas.length} kansen samenvoegen`}</button>
          </div>
        </div>
      </div>
    </>
  )
}
