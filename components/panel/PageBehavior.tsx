"use client"

// Gedrag op een pagina uit Microsoft Clarity (laatste 28 dagen): leest men de pagina, of gaat men snel terug?
// Toont niets zolang Clarity niet gekoppeld is.

import { useEffect, useState } from "react"
import { MousePointerClick } from "lucide-react"
import type { Behavior } from "@/lib/clarity"
import { dateShort, num } from "@/lib/format"

const pct = (v: number | null) => (v === null ? "—" : `${String(Math.round(v * 10) / 10).replace(".", ",")}%`)
const secs = (v: number | null) => (v === null ? "—" : v >= 60 ? `${Math.floor(v / 60)} min ${Math.round(v % 60)} s` : `${Math.round(v)} s`)

export default function PageBehavior({ path }: { path: string | null | undefined }) {
  const [d, setD] = useState<{ configured: boolean; behavior: Behavior | null; notes: { tone: string; text: string }[] } | null>(null)
  useEffect(() => {
    if (!path) return
    let off = false
    fetch(`/api/behavior?path=${encodeURIComponent(path)}`).then(r => (r.ok ? r.json() : null)).then(j => { if (!off) setD(j) }).catch(() => {})
    return () => { off = true }
  }, [path])
  if (!path || !d || !d.configured) return null
  const b = d.behavior
  return (
    <section className="psec page-behavior" aria-labelledby="pb-title">
      <h3 className="psec-title" id="pb-title"><MousePointerClick aria-hidden />Gedrag op deze pagina</h3>
      {!b ? <p className="muted small">Nog geen bezoek gemeten in Clarity voor {path}.</p> : (
        <>
          <p className="subtle small">Microsoft Clarity, {b.days} {b.days === 1 ? "dag" : "dagen"} ({b.from ? dateShort(b.from) : "?"} t/m {b.to ? dateShort(b.to) : "?"}), alle bezoekers.</p>
          <dl className="pb-grid">
            <div><dt>Sessies</dt><dd>{num(b.sessions)}</dd></div>
            <div><dt>Scrolldiepte</dt><dd>{pct(b.scroll_depth)}</dd></div>
            <div><dt>Actieve tijd</dt><dd>{secs(b.active_time)}</dd></div>
            <div><dt title="Sessies waarin iemand snel teruggaat naar de vorige pagina">Snel terug</dt><dd>{pct(b.quickback_pct)}</dd></div>
            <div><dt title="Sessies met herhaald snel klikken op dezelfde plek">Woedeklikken</dt><dd>{pct(b.rage_click_pct)}</dd></div>
            <div><dt title="Sessies met een klik op iets dat niets doet">Dode klikken</dt><dd>{pct(b.dead_click_pct)}</dd></div>
          </dl>
          {d.notes.length > 0 && <ul className="pb-notes">{d.notes.map((n, i) => <li key={i} className={n.tone === "warning" ? "is-warn" : ""}>{n.text}</li>)}</ul>}
        </>
      )}
    </section>
  )
}
