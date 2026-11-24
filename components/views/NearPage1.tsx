"use client"

// SEO-kansen › Bijna op pagina 1: álle zoekwoorden op positie 11–20, niet alleen de sterkste die
// vanzelf een taak worden. Per zoekwoord zie je of het al op Mijn taken staat; anders zet je het er
// met één klik op. Zoekwoorden over hetzelfde onderwerp in dezelfde plaats worden één kaart.

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Layers, Minus, Plus } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { regionSegments } from "@/lib/intent"
import { toPath } from "@/lib/signals"
import { NEAR_FEW, NEAR_MIN_IMPRESSIONS, nearGroups, nearPage1, type NearGroup, type NearRow } from "@/lib/nearPage1"
import { num, pos } from "@/lib/format"
import { StatusBadge } from "@/components/ui"
import type { Task } from "@/lib/types"

const SHOW = 10

function Move({ r }: { r: NearRow }) {
  if (r.prevPosition == null) return null
  const d = r.prevPosition - r.position
  if (Math.abs(d) < 0.5) return <span className="near-move subtle"><Minus aria-hidden />was {pos(r.prevPosition)}</span>
  return <span className={`near-move ${d > 0 ? "tone-up" : "tone-down"}`} title={d > 0 ? "Gestegen" : "Gedaald"}>{d > 0 ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}was {pos(r.prevPosition)}</span>
}

export default function NearPage1() {
  const { loading, keywords, prevKeywords, longKeywords, longPrevKeywords, pages, inventory, taskForQuery, pinKeywords, openTask } = useWorkspace()
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const rows = useMemo(() => {
    const regions = regionSegments([...pages.map(p => toPath(p.keys[0])), ...inventory.map(p => p.path)])
    // De lange lijst (tot 1000 zoekwoorden) zodra hij binnen is; tot die tijd de top 250
    return nearPage1(longKeywords || keywords, longPrevKeywords || prevKeywords, regions)
  }, [keywords, prevKeywords, longKeywords, longPrevKeywords, pages, inventory])
  const groups = useMemo(() => nearGroups(rows), [rows])
  if (loading || !rows.length) return null

  const taskOf = (q: string) => taskForQuery(q)
  // Een groep staat al samen op één kaart als alle zoekwoorden in dezelfde kaart zitten
  const together = (g: NearGroup) => { const ts = g.rows.map(r => taskOf(r.q)); return ts.every(t => t && t.key === ts[0]!.key) ? ts[0] : null }
  const open = groups.filter(g => !together(g))
  const run = async (id: string, qs: string[], title?: string) => { setBusy(id); await pinKeywords(qs, title); setBusy(null) }
  const shown = more ? rows : rows.slice(0, SHOW)
  const onList = rows.filter(r => taskOf(r.q)).length

  return (
    <section className="card near-p1" aria-labelledby="near-p1-title">
      <div className="near-p1-head">
        <h2 className="section-title" id="near-p1-title">Bijna op pagina 1<span className="chip-count">{rows.length}</span></h2>
        <p className="section-sub">Zoekwoorden op positie 11–20 (pagina 2) met minstens {NEAR_MIN_IMPRESSIONS} vertoningen in 28 dagen. {onList} staan al op Mijn taken; zet de rest erop als je ermee aan de slag wilt.</p>
      </div>

      {open.length > 0 && (
        <div className="near-p1-groups">
          <h3 className="near-p1-sub"><Layers aria-hidden className="inline-icon" />Samen aanpakken</h3>
          <p className="subtle small">Zelfde onderwerp in dezelfde plaats: één pagina beantwoordt ze allemaal, dus één kaart.</p>
          <ul className="near-p1-grouplist">
            {open.map(g => (
              <li key={g.id} className="near-p1-group">
                <span className="bulk-main">
                  <b>{g.title}</b>
                  <span className="subtle small">{g.rows.map(r => `"${r.q}" (${pos(r.position)})`).join(", ")} · {num(g.impressions)} vertoningen</span>
                </span>
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => run(g.id, g.rows.map(r => r.q), g.title)}>
                  <Layers aria-hidden />{busy === g.id ? "Bezig…" : "Als één kaart op Mijn taken"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="table-wrap">
        <table className="table near-p1-table">
          <thead>
            <tr><th scope="col">Zoekwoord</th><th scope="col" className="num">Positie</th><th scope="col" className="num near-p1-wide">Vertoningen</th><th scope="col" className="num near-p1-wide">Klikken</th><th scope="col">Mijn taken</th></tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const t: Task | null = taskOf(r.q)
              return (
                <tr key={r.q}>
                  <th scope="row" className="near-p1-q">{r.q}{r.impressions < NEAR_FEW && <span className="near-few" title={`Minder dan ${NEAR_FEW} vertoningen: de positie kan nog flink schommelen`}>weinig data</span>}<span className="near-p1-mob subtle">{num(r.impressions)} vertoningen · {num(r.clicks)} klikken</span></th>
                  <td className="num near-pos"><b>{pos(r.position)}</b><Move r={r} /></td>
                  <td className="num near-p1-wide">{num(r.impressions)}</td>
                  <td className="num near-p1-wide">{num(r.clicks)}</td>
                  <td>
                    {t ? (
                      <button className="near-p1-task" onClick={() => openTask(t.key)} title="Open de kaart">
                        <StatusBadge task={t} />{t.signal.query !== r.q && <span className="subtle small">in {t.signal.groupTitle ? `"${t.signal.groupTitle}"` : `"${t.signal.query || t.signal.headline}"`}</span>}
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm near-p1-add" aria-label={`"${r.q}" op Mijn taken zetten`} disabled={!!busy} onClick={() => run(r.q, [r.q])}><Plus aria-hidden />{busy === r.q ? "Bezig…" : <><span className="near-p1-long">Op Mijn taken</span><span className="near-p1-short">Taak</span></>}</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > SHOW && (
        <div className="near-p1-foot"><button className="btn btn-ghost btn-sm" onClick={() => setMore(m => !m)}>{more ? "Toon minder" : `Toon alle ${rows.length}`}</button></div>
      )}
    </section>
  )
}
