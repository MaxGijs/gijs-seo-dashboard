"use client"

import { useMemo, useState } from "react"
import { CalendarClock, ChevronRight, Clock, Eye, KanbanSquare, List, Play, ShieldCheck, TrendingUp, Inbox, SearchX } from "lucide-react"
import { sortByPriority, useWorkspace } from "@/lib/workspace"
import type { Priority, SignalKind, Task } from "@/lib/types"
import { COLUMNS, columnOf, KIND_META, type ColumnId } from "@/lib/workflow"
import { addDays, dateShort, gainShort, normalize, num } from "@/lib/format"
import { Breakable, EmptyState, IntentBadge, KindLabel, PriorityMeter, Skeleton, StatusBadge } from "@/components/ui"

type TypeFilter = "alle" | "techniek" | "kansen" | "dalingen" | "snippet" | "analyse"
const TYPE_FILTERS: { id: TypeFilter; label: string; kinds: SignalKind[] }[] = [
  { id: "alle", label: "Alle", kinds: [] },
  { id: "techniek", label: "Technisch", kinds: ["techniek"] },
  { id: "kansen", label: "Kansen", kinds: ["kans", "stijger", "trend-stijgend"] },
  { id: "dalingen", label: "Dalingen", kinds: ["daler", "trend-dalend"] },
  { id: "snippet", label: "Zoekresultaat en dubbele pagina's", kinds: ["ctr", "pagina", "dubbel"] },
  { id: "analyse", label: "Eigen analyses", kinds: ["analyse"] },
]

const COLUMN_LIMIT = 8

function cardMeta(t: Task) {
  const col = columnOf(t.status)
  if (col === "beoordelen") {
    if (t.snoozed && t.snoozeUntil) return { icon: <Clock aria-hidden />, text: `Terug op ${dateShort(t.snoozeUntil)}` }
    if (t.signal.kind === "techniek") return { icon: <TrendingUp aria-hidden />, text: "Technische blokkade" }
    if (t.signal.resolved) return { icon: <TrendingUp aria-hidden />, text: "Al opgelost" }
    return { icon: <TrendingUp aria-hidden />, text: gainShort(t.signal.gain) }
  }
  if (col === "gepland") return { icon: <CalendarClock aria-hidden />, text: t.updatedAt ? `Gepland ${dateShort(t.updatedAt)}` : "Gepland" }
  if (col === "uitvoering") return { icon: <Play aria-hidden />, text: t.updatedAt ? `Gestart ${dateShort(t.updatedAt)}` : "Bezig" }
  if (col === "evalueren") {
    const e = t.experiments[0]
    if (e) {
      const next = !e.result_14d ? 14 : !e.result_28d ? 28 : !e.result_56d ? 56 : null
      return { icon: <CalendarClock aria-hidden />, text: next ? `${next}-dagenmeting ${dateShort(addDays(e.changed_at, next))}` : "Alle metingen binnen" }
    }
    return { icon: <CalendarClock aria-hidden />, text: "Wordt gemeten" }
  }
  return { icon: null, text: t.updatedAt ? dateShort(t.updatedAt) : "" }
}

export default function TasksView() {
  const { loading, visibleTasks, openTask, newSinceLastVisit } = useWorkspace()
  const [view, setView] = useState<"bord" | "lijst">("bord")
  const [type, setType] = useState<TypeFilter>("alle")
  const [prio, setPrio] = useState<"alle" | Priority>("alle")
  const [text, setText] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const filtered = useMemo(() => {
    const kinds = TYPE_FILTERS.find(f => f.id === type)!.kinds
    const n = normalize(text)
    return visibleTasks.filter(t =>
      (type === "alle" || kinds.includes(t.signal.kind)) &&
      (prio === "alle" || t.signal.priority === prio) &&
      (!n || normalize(`${t.signal.query || ""} ${t.signal.page || ""} ${t.signal.headline}`).includes(n))
    )
  }, [visibleTasks, type, prio, text])

  const typeCounts = useMemo(() => Object.fromEntries(TYPE_FILTERS.map(f => [
    f.id, f.id === "alle" ? visibleTasks.length : visibleTasks.filter(t => f.kinds.includes(t.signal.kind)).length,
  ])), [visibleTasks])

  const columns = useMemo(() => {
    const byCol: Record<ColumnId, Task[]> = { beoordelen: [], gepland: [], uitvoering: [], evalueren: [], afgerond: [] }
    for (const t of filtered) byCol[columnOf(t.status)].push(t)
    byCol.beoordelen.sort((a, b) => Number(a.snoozed) - Number(b.snoozed) || sortByPriority(a, b))
    for (const c of ["gepland", "uitvoering", "evalueren", "afgerond"] as ColumnId[]) {
      byCol[c].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    }
    return byCol
  }, [filtered])

  const filtersActive = type !== "alle" || prio !== "alle" || text.trim() !== ""

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Mijn taken</h1>
          <p className="page-sub">Elk SEO-advies van signaal tot resultaat. Open een kaart om te beslissen wat ermee gebeurt.</p>
        </div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label="Weergave">
            <button className={view === "bord" ? "is-active" : ""} onClick={() => setView("bord")} aria-pressed={view === "bord"}><KanbanSquare aria-hidden />Bord</button>
            <button className={view === "lijst" ? "is-active" : ""} onClick={() => setView("lijst")} aria-pressed={view === "lijst"}><List aria-hidden />Lijst</button>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left" role="group" aria-label="Filter op type">
          {TYPE_FILTERS.filter(f => f.id === "alle" || typeCounts[f.id] > 0).map(f => (
            <button key={f.id} className={`chip${type === f.id ? " is-active" : ""}`} onClick={() => setType(f.id)} aria-pressed={type === f.id}>
              {f.label}<span className="chip-count">{typeCounts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-left">
          <label className="sr-only" htmlFor="prio-filter">Prioriteit</label>
          <select id="prio-filter" className="select" style={{ width: 170, height: 36, borderRadius: 999 }} value={prio} onChange={e => setPrio(e.target.value as typeof prio)}>
            <option value="alle">Alle prioriteiten</option>
            <option value="hoog">Hoge prioriteit</option>
            <option value="middel">Middel</option>
            <option value="laag">Laag</option>
          </select>
          <label className="sr-only" htmlFor="text-filter">Filter op zoekwoord of pagina</label>
          <input id="text-filter" className="input" style={{ width: 240, height: 36, borderRadius: 999, paddingLeft: 14 }} placeholder="Filter op zoekwoord of pagina" value={text} onChange={e => setText(e.target.value)} />
          {filtersActive && <button className="btn btn-ghost btn-sm" onClick={() => { setType("alle"); setPrio("alle"); setText("") }}>Filters wissen</button>}
        </div>
      </div>

      {loading ? (
        <div className="board">
          {COLUMNS.map(c => (
            <div key={c.id} className="col"><div className="col-head"><h2>{c.label}</h2></div><Skeleton height={96} radius={12} /><Skeleton height={96} radius={12} /></div>
          ))}
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="card"><EmptyState icon={<Inbox />} title="Nog geen signalen" text="Zodra Search Console genoeg data heeft, verschijnen hier de adviezen. Je kunt ook via de zoekbalk zelf een zoekwoord of pagina analyseren." /></div>
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<SearchX />} title="Geen taken met deze filters" action={<button className="btn btn-secondary btn-sm" onClick={() => { setType("alle"); setPrio("alle"); setText("") }}>Filters wissen</button>} /></div>
      ) : view === "bord" ? (
        <div className="board">
          {COLUMNS.map(c => {
            const items = columns[c.id]
            const showAll = expanded[c.id]
            const visible = showAll ? items : items.slice(0, COLUMN_LIMIT)
            return (
              <section key={c.id} className="col" aria-labelledby={`col-${c.id}`}>
                <div className="col-head"><h2 id={`col-${c.id}`}>{c.label}</h2><span className="col-count">{items.length}</span></div>
                <p className="col-hint">{c.hint}</p>
                {items.length === 0 ? (
                  <p className="col-empty">{c.id === "beoordelen" ? "Niets te beoordelen" : c.id === "afgerond" ? "Nog niets afgerond" : "Leeg"}</p>
                ) : visible.map(t => {
                  const meta = cardMeta(t)
                  return (
                    <button key={t.key} className={`tcard interactive${t.snoozed ? " is-dim" : ""}`} onClick={() => openTask(t.key)}>
                      <span className="tcard-top">
                        <KindLabel signal={t.signal} />
                        {c.id === "beoordelen" && t.signal.kind !== "analyse" ? <PriorityMeter priority={t.signal.priority} /> : c.id === "afgerond" ? <StatusBadge task={t} /> : null}
                      </span>
                      <span className="tcard-title">{t.signal.query ? `"${t.signal.query}"` : <Breakable text={t.signal.headline} />}</span>
                      <span className="tcard-sub clamp" title={t.signal.title}>{t.signal.action || t.signal.title}</span>
                      <span className="tcard-foot">
                        <span>{meta.icon}{meta.text}</span>
                        {newSinceLastVisit.has(t.key) && c.id === "beoordelen" ? <span className="new-dot">Nieuw</span>
                          : t.status === "onderzoeken" ? <span>In onderzoek</span>
                          : !t.current && c.id !== "afgerond" ? <span title="Niet meer in de actuele signalen">Niet actueel</span> : null}
                      </span>
                    </button>
                  )
                })}
                {items.length > COLUMN_LIMIT && (
                  <button className="col-more" onClick={() => setExpanded(e => ({ ...e, [c.id]: !showAll }))}>
                    {showAll ? "Minder tonen" : `Nog ${items.length - COLUMN_LIMIT} tonen`}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Onderwerp</th><th>Type</th><th>Status</th><th>Prioriteit</th><th>Verwachte winst</th><th className="num">Vertoningen</th><th>Bewijs</th><th aria-label="Openen" /></tr>
              </thead>
              <tbody>
                {COLUMNS.flatMap(c => columns[c.id]).map(t => (
                  <tr key={t.key} className="is-clickable" onClick={() => openTask(t.key)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") openTask(t.key) }}>
                    <td className="cell-main"><span className="truncate" style={{ display: "block" }}>{t.signal.query || t.signal.headline}</span><span className="subtle" style={{ fontSize: 12, fontWeight: 400, display: "block" }}>{t.signal.action || t.signal.title}</span></td>
                    <td className="nowrap">{KIND_META[t.signal.kind].label}{t.signal.intent && <div style={{ marginTop: 4 }}><IntentBadge intent={t.signal.intent} /></div>}</td>
                    <td><StatusBadge task={t} /></td>
                    <td>{t.signal.kind !== "analyse" ? <PriorityMeter priority={t.signal.priority} /> : <span className="subtle">—</span>}</td>
                    <td className="nowrap"><TrendingUp size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--accent-700)" }} aria-hidden />{gainShort(t.signal.gain)}</td>
                    <td className="num"><Eye size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--grey-400)" }} aria-hidden />{num(t.signal.metrics.impressions)}</td>
                    <td className="nowrap"><ShieldCheck size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--grey-400)" }} aria-hidden />{t.signal.evidence}</td>
                    <td className="cell-arrow"><ChevronRight aria-hidden /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
