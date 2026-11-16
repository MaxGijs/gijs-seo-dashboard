"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, ChevronRight, Clock, Plus, Eye, KanbanSquare, List, Play, ShieldCheck, TrendingUp, Inbox, SearchX } from "lucide-react"
import { sortByPriority, useWorkspace } from "@/lib/workspace"
import type { Priority, SignalKind, Status, Task } from "@/lib/types"
import { COLUMNS, columnOf, KIND_META, type ColumnId } from "@/lib/workflow"
import { addDays, dateShort, gainShort, normalize, num } from "@/lib/format"
import AddTaskDialog from "./AddTaskDialog"
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

// Wat er gebeurt als je een kaart naar een kolom sleept
const DROP_STATUS: Partial<Record<ColumnId, Status>> = { beoordelen: "nieuw", gepland: "goedgekeurd", uitvoering: "in_uitvoering" }
const VIEW_KEY = "gijs.seo.tasksView"

export default function TasksView() {
  const { loading, visibleTasks, openTask, newSinceLastVisit, setStatus, toast } = useWorkspace()
  const [view, setViewState] = useState<"bord" | "lijst">("bord")
  const [viewChosen, setViewChosen] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [overCol, setOverCol] = useState<ColumnId | null>(null)
  const setView = (v: "bord" | "lijst") => {
    setViewState(v); setViewChosen(true)
    try { window.localStorage.setItem(VIEW_KEY, v) } catch { /* privémodus */ }
  }
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

  // Standaardweergave: je eigen keuze, anders de lijst zolang vrijwel alles nog te beoordelen is
  useEffect(() => {
    if (loading || viewChosen) return
    let saved: string | null = null
    try { saved = window.localStorage.getItem(VIEW_KEY) } catch { /* privémodus */ }
    if (saved === "bord" || saved === "lijst") { setViewState(saved); return }
    const total = visibleTasks.length
    const inReview = visibleTasks.filter(t => columnOf(t.status) === "beoordelen").length
    setViewState(total > 0 && total - inReview <= 2 ? "lijst" : "bord")
  }, [loading, viewChosen, visibleTasks])

  const drop = async (t: Task, to: ColumnId) => {
    const from = columnOf(t.status)
    if (from === to) return
    if (from === "evalueren" && to !== "afgerond") {
      toast("Een taak in evaluatie wordt gemeten. Sleep hem naar Afgerond om af te sluiten, of laat de meting lopen.", "info"); return
    }
    if (to === "evalueren") { openTask(t.key, "execute"); return }
    if (to === "afgerond") { openTask(t.key, "close"); return }
    const status = DROP_STATUS[to]!
    const ok = await setStatus(t, status, { note: t.note, snoozeUntil: null })
    if (ok) toast(`Verplaatst naar ${COLUMNS.find(c => c.id === to)!.label}`)
  }

  const filtersActive = type !== "alle" || prio !== "alle" || text.trim() !== ""

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Mijn taken</h1>
          <p className="page-sub">Elk SEO-advies van signaal tot resultaat. Open een kaart om te beslissen wat ermee gebeurt, of sleep hem naar een andere kolom.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus aria-hidden />Taak toevoegen</button>
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
        <div className={`board${dragKey ? " is-dragging" : ""}`}>
          {COLUMNS.map(c => {
            const items = columns[c.id]
            const showAll = expanded[c.id]
            const visible = showAll ? items : items.slice(0, COLUMN_LIMIT)
            // Lege kolommen klappen in, behalve tijdens slepen (dan zijn ze een doel)
            const collapsed = items.length === 0 && !dragKey && !expanded[`open-${c.id}`]
            const dragged = dragKey ? filtered.find(t => t.key === dragKey) : null
            const canDrop = !!dragged && columnOf(dragged.status) !== c.id
            if (collapsed) {
              return (
                <button key={c.id} className="col col-collapsed" onClick={() => setExpanded(e => ({ ...e, [`open-${c.id}`]: true }))} aria-label={`${c.label}: leeg. Klik om uit te klappen`} title={c.hint}>
                  <span className="col-collapsed-label">{c.label}</span><span className="col-count">0</span>
                </button>
              )
            }
            return (
              <section key={c.id} className={`col${overCol === c.id && canDrop ? " is-over" : ""}`} aria-labelledby={`col-${c.id}`}
                onDragOver={e => { if (!canDrop) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overCol !== c.id) setOverCol(c.id) }}
                onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverCol(o => (o === c.id ? null : o)) }}
                onDrop={e => { e.preventDefault(); const key = e.dataTransfer.getData("text/plain") || dragKey; setOverCol(null); setDragKey(null); const t = filtered.find(x => x.key === key); if (t) drop(t, c.id) }}>
                <div className="col-head">
                  <h2 id={`col-${c.id}`}>{c.label}</h2><span className="col-count">{items.length}</span>
                  {items.length === 0 && expanded[`open-${c.id}`] && <button className="icon-btn col-fold" onClick={() => setExpanded(e => ({ ...e, [`open-${c.id}`]: false }))} aria-label={`${c.label} inklappen`}>–</button>}
                </div>
                <p className="col-hint">{c.id === "evalueren" ? "Sleep hierheen als het is aangepast: je beschrijft kort wat en de meting start" : c.id === "afgerond" ? "Sleep hierheen om af te sluiten met een uitkomst" : c.hint}</p>
                {items.length === 0 ? (
                  <p className="col-empty">{c.id === "beoordelen" ? "Niets te beoordelen" : c.id === "afgerond" ? "Nog niets afgerond" : "Leeg"}</p>
                ) : visible.map(t => {
                  const meta = cardMeta(t)
                  return (
                    <button key={t.key} className={`tcard interactive${t.snoozed ? " is-dim" : ""}${dragKey === t.key ? " is-dragged" : ""}`} onClick={() => openTask(t.key)}
                      draggable onDragStart={e => { e.dataTransfer.setData("text/plain", t.key); e.dataTransfer.effectAllowed = "move"; setDragKey(t.key) }}
                      onDragEnd={() => { setDragKey(null); setOverCol(null) }}
                      aria-roledescription="versleepbare kaart">
                      <span className="tcard-top">
                        <KindLabel signal={t.signal} />
                        {c.id === "beoordelen" && t.signal.kind !== "analyse" ? <PriorityMeter priority={t.signal.priority} /> : c.id === "afgerond" ? <StatusBadge task={t} /> : null}
                      </span>
                      <span className="tcard-title">{t.signal.query ? `"${t.signal.query}"` : <Breakable text={t.signal.headline} />}</span>
                      <span className="tcard-sub" title={t.signal.title}>{t.signal.action || t.signal.title}</span>
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
      {adding && <AddTaskDialog onClose={() => setAdding(false)} />}
    </>
  )
}
