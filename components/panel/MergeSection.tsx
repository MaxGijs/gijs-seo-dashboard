"use client"

// In het takenpaneel: wat is er in deze kaart samengevoegd (met Splitsen), en "Samenvoegen met…"
// met voorstellen voor dezelfde pagina of plaats en een zoekveld voor alle andere open kaarten.

import { useMemo, useState } from "react"
import { Layers, Pencil, Search, Unlink } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { columnOf, groupName, isVisible } from "@/lib/workflow"
import { normalize } from "@/lib/format"
import type { Task } from "@/lib/types"
import MergeDialog, { label } from "@/components/views/MergeDialog"
import { KindLabel } from "@/components/ui"

const OPEN = new Set(["beoordelen", "gepland", "uitvoering"])
const pageOf = (t: Task) => t.signal.page || t.signal.conversions?.page || null
const words = (q?: string) => new Set(normalize(q || "").split(/\s+/).filter(w => w.length > 2))

// Waarom lijkt deze kaart op de open kaart? Alleen duidelijke, uitlegbare redenen.
export function similarity(a: Task, b: Task): string | null {
  const pa = pageOf(a), pb = pageOf(b)
  if (pa && pa === pb) return `zelfde pagina (${pa})`
  if (a.signal.place && a.signal.place === b.signal.place && a.signal.kind === b.signal.kind) return `zelfde plaats (${a.signal.place}) en soort`
  const wa = words(a.signal.query), wb = words(b.signal.query)
  if (wa.size && wb.size) {
    const shared = [...wa].filter(w => wb.has(w)).length
    if (shared / Math.min(wa.size, wb.size) >= 0.75 && shared >= 2) return "bijna hetzelfde zoekwoord"
  }
  return null
}

export default function MergeSection({ task }: { task: Task }) {
  const { tasks, splitTask, openTask, setGroupTitle } = useWorkspace()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(task.signal.groupTitle || "")
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const mergeable = task.status !== "samengevoegd" && OPEN.has(columnOf(task.status)) && !task.signal.reminder
  const candidates = useMemo(() => tasks.filter(t => t.key !== task.key && isVisible(t) && OPEN.has(columnOf(t.status)) && !t.signal.reminder), [tasks, task.key])
  const suggested = useMemo(() => candidates.map(t => ({ t, why: similarity(task, t) })).filter(x => x.why).slice(0, 5) as { t: Task; why: string }[], [candidates, task])
  const found = useMemo(() => {
    const n = normalize(q).trim()
    if (n.length < 2) return []
    return candidates.filter(t => normalize(`${t.signal.query || ""} ${t.signal.headline} ${t.signal.page || ""}`).includes(n)).slice(0, 8)
  }, [candidates, q])

  // Deze kaart is zelf samengevoegd in een andere kaart
  if (task.status === "samengevoegd") {
    const main = tasks.find(t => t.key === task.signal.mergedInto)
    return (
      <section className="psec" aria-label="Samengevoegd">
        <div className="merge-note">
          <Layers aria-hidden />
          <p>Deze kaart is samengevoegd {main && groupName(main) ? <>in de groep <b>{groupName(main)}</b></> : <>met <b>{main ? label(main) : "een andere kaart"}</b></>} en wordt daar in één keer gedaan.</p>
          {main && <button className="btn btn-secondary btn-sm" onClick={() => openTask(main.key)}>Open hoofdkaart</button>}
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={async () => { setBusy(task.key); await splitTask(task); setBusy(null) }}><Unlink aria-hidden />Splitsen</button>
        </div>
      </section>
    )
  }

  const toggle = (k: string) => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })
  const row = (t: Task, why?: string) => (
    <li key={t.key}>
      <label className="merge-cand">
        <input type="checkbox" checked={picked.has(t.key)} onChange={() => toggle(t.key)} />
        <span className="bulk-main"><span className="merge-meta"><KindLabel signal={t.signal} />{why && <span className="subtle small">{why}</span>}</span><b>{label(t)}</b><span className="subtle small">{t.signal.action || t.signal.title}</span></span>
      </label>
    </li>
  )

  return (
    <section className="psec" aria-labelledby="sec-merge">
      {task.merged?.length ? (
        <>
          <h3 className="psec-title" id="sec-merge">{groupName(task) ? `In deze groep (${task.merged.length + 1})` : `Samengevoegd in deze kaart (${task.merged.length + 1})`}</h3>
          {naming ? (
            <form className="group-name-form" onSubmit={async e => { e.preventDefault(); setBusy("naam"); const ok = await setGroupTitle(task, name.trim() || null); setBusy(null); if (ok) setNaming(false) }}>
              <label className="field-label" htmlFor="group-name">Naam van de groep</label>
              <input id="group-name" className="input" value={name} maxLength={140} autoFocus onChange={e => setName(e.target.value)} placeholder="Bijv. Warmtepompartikel op de regiopagina's" />
              <p className="field-hint">Staat op het bord, in Vandaag en als naam van de meting in Experimenten.</p>
              <div className="inline-form-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNaming(false); setName(task.signal.groupTitle || "") }}>Annuleren</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy === "naam"}>{busy === "naam" ? "Bezig…" : "Naam opslaan"}</button>
              </div>
            </form>
          ) : (
            <p className="group-name-line">
              {groupName(task) ? <>Groepsnaam: <b>{groupName(task)}</b></> : <span className="subtle">Nog geen groepsnaam; de kaart heet nu naar {label(task)}.</span>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setName(task.signal.groupTitle || ""); setNaming(true) }}><Pencil aria-hidden />{groupName(task) ? "Naam wijzigen" : "Groep een naam geven"}</button>
            </p>
          )}
          <p className="muted small">Je doet deze in één keer. Bij uitvoeren legt de meting alle zoekwoorden en pagina&apos;s vast. Uit elkaar halen kan per kaart of in één keer; elke kaart krijgt dan zijn eigen status terug.</p>
          <ul className="merge-list">
            {task.merged.map(m => (
              <li key={m.key}>
                <span className="bulk-main"><b>{label(m)}</b><span className="subtle small">{m.signal.action || m.signal.title}</span></span>
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={async () => { setBusy(m.key); const ok = await splitTask(m); if (ok && task.merged!.length === 1 && task.signal.groupTitle) await setGroupTitle({ ...task, merged: [] }, null); setBusy(null) }}><Unlink aria-hidden />{busy === m.key ? "Bezig…" : "Splitsen"}</button>
              </li>
            ))}
          </ul>
          {task.merged.length > 1 && (
            <div className="inline-form-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={async () => { setBusy("alles"); for (const m of task.merged!) await splitTask(m); if (task.signal.groupTitle) await setGroupTitle({ ...task, merged: [] }, null); setBusy(null) }}><Unlink aria-hidden />{busy === "alles" ? "Bezig…" : `Alles weer los (${task.merged.length + 1} kaarten)`}</button>
            </div>
          )}
        </>
      ) : null}
      {mergeable && (
        <details className="merge-more">
          <summary id={task.merged?.length ? undefined : "sec-merge"}>Samenvoegen met andere kaarten{suggested.length ? ` (${suggested.length} ${suggested.length === 1 ? "lijkt" : "lijken"} erop)` : ""}</summary>
          {suggested.length > 0 && <ul className="merge-list">{suggested.map(x => row(x.t, x.why))}</ul>}
          <label className="merge-search">
            <Search aria-hidden />
            <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Zoek een andere kaart" aria-label="Zoek een kaart om samen te voegen" />
          </label>
          {found.length > 0 && <ul className="merge-list">{found.filter(t => !suggested.some(x => x.t.key === t.key)).map(t => row(t))}</ul>}
          {q.trim().length >= 2 && !found.length && <p className="muted small" style={{ marginTop: 6 }}>Geen open kaart gevonden.</p>}
          <div className="inline-form-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-secondary btn-sm" disabled={!picked.size} onClick={() => setDialog(true)}><Layers aria-hidden />{picked.size ? `Samenvoegen met ${picked.size} ${picked.size === 1 ? "kaart" : "kaarten"}` : "Kies kaarten om samen te voegen"}</button>
          </div>
        </details>
      )}
      {dialog && <MergeDialog tasks={[task, ...tasks.filter(t => picked.has(t.key))]} initialMain={task.key} onClose={() => setDialog(false)} onDone={() => setPicked(new Set())} />}
    </section>
  )
}
