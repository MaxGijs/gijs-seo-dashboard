"use client"

// Mijn taken: voorstel om kaarten samen te voegen die op dezelfde pagina uitkomen (of dezelfde plaats
// en hetzelfde onderwerp hebben). "Niet samen" onthoudt deze browser; een nieuwe kaart erbij geeft
// een nieuw voorstel.

import { useMemo, useState } from "react"
import { Layers, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { mergeSuggestions, type MergeSuggestion } from "@/lib/mergeSuggest"
import { gainShort, pos } from "@/lib/format"
import { StatusBadge } from "@/components/ui"
import MergeDialog from "./MergeDialog"

const STORE = "gic:merge-dismissed"
const SHOW = 3
function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORE) || "[]")) } catch { return new Set() }
}

export default function MergeSuggestions() {
  const { tasks, loading } = useWorkspace()
  const [dismissed, setDismissed] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : readDismissed()))
  const [open, setOpen] = useState<MergeSuggestion | null>(null)
  const [all, setAll] = useState(false)
  const list = useMemo(() => mergeSuggestions(tasks, dismissed), [tasks, dismissed])
  if (loading || !list.length) return null
  const dismiss = (id: string) => {
    const next = new Set(dismissed); next.add(id); setDismissed(next)
    try { localStorage.setItem(STORE, JSON.stringify([...next].slice(-200))) } catch { /* alleen gemak */ }
  }
  const shown = all ? list : list.slice(0, SHOW)

  return (
    <section className="merge-suggest" aria-labelledby="merge-suggest-title">
      <h2 className="merge-suggest-title" id="merge-suggest-title"><Layers aria-hidden />Samenvoegen voorgesteld<span className="chip-count">{list.length}</span></h2>
      <ul className="merge-suggest-list">
        {shown.map(s => (
          <li key={s.id} className="merge-suggest-item">
            <div className="merge-suggest-main">
              <b>{s.title}</b>
              <span className="subtle small">{s.why} Samen indicatief {gainShort(s.tasks.reduce((a, t) => a + (t.signal.gain || 0), 0))}.</span>
              <span className="merge-suggest-cards">
                {s.tasks.map(t => (
                  <span key={t.key} className="merge-suggest-card">&ldquo;{t.signal.query}&rdquo;{t.signal.metrics.position ? <span className="subtle"> · pos. {pos(t.signal.metrics.position)}</span> : null}{t.merged?.length ? <span className="subtle"> · +{t.merged.length}</span> : null}<StatusBadge task={t} /></span>
                ))}
              </span>
            </div>
            <div className="merge-suggest-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setOpen(s)}><Layers aria-hidden />Samenvoegen…</button>
              <button className="btn btn-ghost btn-sm" onClick={() => dismiss(s.id)} aria-label={`Niet samenvoegen: ${s.title}`}><X aria-hidden />Niet samen</button>
            </div>
          </li>
        ))}
      </ul>
      {list.length > SHOW && <button className="link-btn merge-suggest-more" onClick={() => setAll(a => !a)}>{all ? "Toon minder" : `Toon alle ${list.length} voorstellen`}</button>}
      {open && <MergeDialog tasks={open.tasks} initialMain={open.tasks[0].key} initialGroup={open.title} onClose={() => setOpen(null)} />}
    </section>
  )
}
