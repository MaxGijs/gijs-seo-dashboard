"use client"

// Nieuwe meetresultaten (Vandaag en Dashboard, huidige opmaak). Toont niets als er niets nieuws is.
import Link from "next/link"
import { Check, LineChart } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { useContentIdeas } from "@/lib/content/useContent"
import { useMeasureUpdates } from "@/lib/measureUpdates"
import { dateShort } from "@/lib/format"

const TONE = { goed: "tone-success", slecht: "tone-error", neutraal: "tone-neutral" } as const

export default function MeasureUpdatesBlock() {
  const { tasks, openTask, loading } = useWorkspace()
  const content = useContentIdeas()
  const { items, dismiss, dismissAll } = useMeasureUpdates(tasks, content.ideas)
  if (loading || !items.length) return null
  return (
    <section className="card measure-updates" aria-labelledby="mu-head">
      <div className="section-head">
        <div>
          <h2 className="section-title" id="mu-head"><LineChart aria-hidden />Nieuwe meetresultaten</h2>
          <p className="section-sub">{items.length} {items.length === 1 ? "meting is" : "metingen zijn"} binnengekomen. Lopende metingen staan in <Link href="/experimenten">Experimenten</Link>.</p>
        </div>
        {items.length > 1 && <button className="btn btn-ghost btn-sm" onClick={dismissAll}><Check aria-hidden />Alles gezien</button>}
      </div>
      <ul className="mu-list">
        {items.slice(0, 6).map(u => (
          <li key={u.key} className="mu-item">
            {u.ideaId
              ? <Link className="mu-main" href={`/content/${u.ideaId}?van=vandaag`}><MuText u={u} /></Link>
              : <button className="mu-main" onClick={() => openTask(u.taskKey!)}><MuText u={u} /></button>}
            <button className="icon-btn mu-seen" onClick={() => dismiss(u.key)} aria-label={`${u.title}: gezien`} title="Gezien"><Check /></button>
          </li>
        ))}
      </ul>
      {items.length > 6 && <p className="subtle small" style={{ margin: "8px 0 0" }}>En nog {items.length - 6}. Markeer ze als gezien of bekijk ze in Experimenten.</p>}
    </section>
  )
}

function MuText({ u }: { u: ReturnType<typeof useMeasureUpdates>["items"][number] }) {
  return (
    <>
      <span className="mu-top"><span className={`badge ${u.final ? TONE[u.tone] : "tone-info"}`}>{u.final ? "Eindoordeel" : `Na ${u.milestone} dagen`}</span><span className="subtle small">{dateShort(u.date)}</span></span>
      <span className="mu-title">{u.title}</span>
      <span className="mu-text">{u.text}</span>
    </>
  )
}
