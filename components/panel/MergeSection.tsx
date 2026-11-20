"use client"

// In het takenpaneel: wat is er in deze kaart samengevoegd (met Splitsen), en "Samenvoegen met…"
// met voorstellen voor dezelfde pagina of plaats en een zoekveld voor alle andere open kaarten.

import { useMemo, useState } from "react"
import { Layers, Search, Unlink } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { columnOf, isVisible } from "@/lib/workflow"
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
  const { tasks, splitTask, openTask } = useWorkspace()
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
          <p>Deze kaart is samengevoegd met <b>{main ? label(main) : "een andere kaart"}</b> en wordt daar in één keer gedaan.</p>
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
          <h3 className="psec-title" id="sec-merge">Samengevoegd in deze kaart</h3>
          <p className="muted small">Je doet deze in één keer. Bij uitvoeren legt de meting alle zoekwoorden en pagina&apos;s vast.</p>
          <ul className="merge-list">
            {task.merged.map(m => (
              <li key={m.key}>
                <span className="bulk-main"><b>{label(m)}</b><span className="subtle small">{m.signal.action || m.signal.title}</span></span>
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={async () => { setBusy(m.key); await splitTask(m); setBusy(null) }}><Unlink aria-hidden />{busy === m.key ? "Bezig…" : "Splitsen"}</button>
              </li>
            ))}
          </ul>
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
