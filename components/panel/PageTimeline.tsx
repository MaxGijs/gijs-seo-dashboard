"use client"

// Tijdlijn van een pagina bij Google: gevonden → gecrawld → geïndexeerd → eerste vertoning →
// eerste klik → pagina 1. Met waarom de pagina dagelijks gevolgd wordt en wanneer Google hem
// voor het laatst bekeek. Gegevens uit de nachtelijke URL-inspectie en Search Console.

import { useEffect, useState } from "react"
import { Check, Circle, Eye, TriangleAlert } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { dateShort } from "@/lib/format"
import { EVENT_META, timeline, type PageEvent, type WatchReason } from "@/lib/watch"

interface PageNow { path: string; index_verdict: string | null; coverage_state: string | null; last_crawl_time: string | null; inspected_at: string | null }
interface Data { events: PageEvent[]; watch: Record<string, WatchReason[]>; pages: Record<string, PageNow> }

export function usePageEvents(paths: string[]) {
  const { reloadTick } = useWorkspace()
  const key = paths.join(",")
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    fetch(`/api/pages/events?paths=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); if (live) { setD(j); setErr(null) } })
      .catch(e => live && setErr(e.message))
    return () => { live = false }
  }, [key, reloadTick])
  return { d, err }
}

export default function PageTimeline({ paths, title = "Bij Google" }: { paths: string[]; title?: string }) {
  const list = [...new Set(paths.filter(Boolean))].slice(0, 5)
  const { d, err } = usePageEvents(list)
  if (!list.length) return null
  return (
    <section className="psec ptl" aria-label="Tijdlijn bij Google">
      <h3 className="psec-title">{title}</h3>
      {err && <p className="muted small">Tijdlijn niet geladen: {err}</p>}
      {!d && !err && <p className="muted small">Laden…</p>}
      {d && list.map(path => <One key={path} path={path} d={d} multiple={list.length > 1} />)}
    </section>
  )
}

function One({ path, d, multiple }: { path: string; d: Data; multiple: boolean }) {
  const events = d.events.filter(e => e.path === path)
  const now = d.pages[path] || null
  const { steps, lost } = timeline(events, now)
  const reasons = d.watch[path] || []
  const doneCount = steps.filter(s => s.done).length
  const recent = [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4)
  return (
    <div className="ptl-page">
      {multiple && <p className="ptl-path">{path}</p>}
      {lost && <p className="ptl-lost"><TriangleAlert aria-hidden />Uit de index sinds {dateShort(lost.at)}{lost.detail?.state ? ` (${String(lost.detail.state)})` : ""}.</p>}
      <ol className="ptl-steps" aria-label={`${doneCount} van ${steps.length} stappen gezet`}>
        {steps.map(s => (
          <li key={s.event} className={s.done ? "is-done" : ""}>
            <span className="ptl-dot" aria-hidden>{s.done ? <Check /> : <Circle />}</span>
            <span className="ptl-label">{s.label}</span>
            <span className="ptl-date">{s.at ? dateShort(s.at) : s.done ? "ja" : "nog niet"}</span>
          </li>
        ))}
      </ol>
      <p className="ptl-meta">
        <Eye aria-hidden />
        {reasons.length ? <>Wordt elke nacht gecontroleerd: {reasons.map(r => r.text).join("; ")}.</> : <>Wordt eens per week gecontroleerd.</>}
        {now?.inspected_at && <> Laatste controle {dateShort(now.inspected_at)}{now.coverage_state ? `: ${now.coverage_state}` : ""}.</>}
        {!now && <> Staat (nog) niet in de pagina-inventaris; komt erin zodra hij in de sitemap staat.</>}
      </p>
      {recent.length > 0 && (
        <ul className="ptl-events">
          {recent.map(e => <li key={`${e.event}${e.at}`} className={EVENT_META[e.event].good ? "" : "is-bad"}><b>{dateShort(e.at)}</b> {EVENT_META[e.event].text(e)}</li>)}
        </ul>
      )}
    </div>
  )
}
