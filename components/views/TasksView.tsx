"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { BellRing, CalendarClock, ChevronRight, Clock, Plus, Eye, KanbanSquare, List, Newspaper, Play, ShieldCheck, TrendingUp, Inbox, SearchX, UserRound, StickyNote, CircleHelp, ClipboardCheck, CheckCheck } from "lucide-react"
import { ownerName } from "@/components/OwnerSelect"
import { readStorage, sortByPriority, useWorkspace, writeStorage } from "@/lib/workspace"
import type { Priority, SignalKind, Status, Task } from "@/lib/types"
import { COLUMNS, columnOf, KIND_META, type ColumnId } from "@/lib/workflow"
import { addDays, dateShort, gainShort, normalize, num, today } from "@/lib/format"
import AddTaskDialog from "./AddTaskDialog"
import ReminderDialog from "@/components/reminders/ReminderDialog"
import BulkExecuteDialog from "./BulkExecuteDialog"
import SiteAdviceStrip from "@/components/siteadvice/SiteAdviceStrip"
import BoardLegend from "./BoardLegend"
import { CONTENT_STEP, contentColumn, useContentIdeas } from "@/lib/content/useContent"
import { type ContentIdea, effectiveScore, ORIGIN_META, serviceLabel } from "@/lib/content/model"
import { isPageUpdate, nextMilestone } from "@/lib/content/update"
import { Breakable, EmptyState, IntentBadge, KindLabel, MeasuringBadge, NewBadge, PageHeader, PriorityMeter, RejectedBadge, Skeleton, StatusBadge, type StatusTone } from "@/components/ui"

// Contentkansen hebben geen eigen "sinds je vorige bezoek"-mechanisme zoals SEO-signalen;
// dat bouwen we hier apart op, met dezelfde opslag-aanpak (lib/workspace.tsx).
const CONTENT_SEEN_KEY = "gijs.content.seenIdeas"
function useNewContentIds(ideas: ContentIdea[] | null) {
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const markedRef = useRef<string>("")
  useEffect(() => {
    if (!ideas) return
    // React (in dev met Strict Mode) kan een effect twee keer achter elkaar aanroepen; zonder
    // deze bewaking zou de tweede aanroep de net geschreven opslag alweer als "gezien" lezen.
    const key = ideas.map(i => i.id).sort().join(",")
    if (markedRef.current === key) return
    markedRef.current = key
    const prevSeen = readStorage(CONTENT_SEEN_KEY)
    const seen = new Set<string>(prevSeen ? JSON.parse(prevSeen) : [])
    setNewIds(prevSeen ? new Set(ideas.filter(i => !seen.has(i.id)).map(i => i.id)) : new Set())
    const all = new Set([...seen, ...ideas.map(i => i.id)])
    writeStorage(CONTENT_SEEN_KEY, JSON.stringify([...all].slice(-500)))
  }, [ideas])
  return newIds
}

type TypeFilter = "alle" | "techniek" | "kansen" | "dalingen" | "snippet" | "analyse" | "content"
const TYPE_FILTERS: { id: TypeFilter; label: string; kinds: SignalKind[] }[] = [
  { id: "alle", label: "Alle", kinds: [] },
  { id: "techniek", label: "Technisch", kinds: ["techniek"] },
  { id: "kansen", label: "Kansen", kinds: ["kans", "stijger", "trend-stijgend"] },
  { id: "dalingen", label: "Dalingen", kinds: ["daler", "trend-dalend"] },
  { id: "snippet", label: "Zoekresultaat en dubbele pagina's", kinds: ["ctr", "pagina", "dubbel"] },
  { id: "analyse", label: "Eigen analyses", kinds: ["analyse"] },
  { id: "content", label: "Content", kinds: [] },
]

// Eén kaart op het bord: een SEO-advies of een contentkans
// old: al langer dan een week in meting. Die verdwijnen van het bord (ze staan in Experimenten);
// nieuwe meetresultaten verschijnen op Vandaag en het Dashboard.
type Entry =
  | { kind: "seo"; key: string; col: ColumnId; prio: Priority; dim: boolean; date: string; old?: boolean; t: Task }
  | { kind: "content"; key: string; col: ColumnId; prio: Priority; dim: boolean; date: string; old?: boolean; i: ContentIdea }
export const BOARD_MEASURE_DAYS = 7
const PRIO_RANK: Record<Priority, number> = { hoog: 0, middel: 1, laag: 2 }

function contentMeta(i: ContentIdea, col: ColumnId) {
  if (col === "beoordelen") return { icon: <TrendingUp aria-hidden />, text: `Score ${effectiveScore(i)}` }
  if (col === "evalueren" && i.status !== "gepubliceerd") return { icon: <ClipboardCheck aria-hidden />, text: i.status === "goedgekeurd" ? "Goedgekeurd: publiceren" : "Ingeleverd: beoordelen" }
  if (col === "evalueren" && isPageUpdate(i)) {
    if (!i.published_at) return { icon: <CalendarClock aria-hidden />, text: "Wordt gemeten" }
    const n = nextMilestone(i.evals?.update || { points: {} }, i.published_at)
    return { icon: <CalendarClock aria-hidden />, text: n ? `${n.days}-dagenmeting ${dateShort(n.date)}` : "Eindoordeel volgt" }
  }
  if (col === "evalueren") {
    const next = !i.evals?.d7 ? 7 : !i.evals?.d30 ? 30 : 90
    return { icon: <CalendarClock aria-hidden />, text: i.published_at ? `${next}-dagenmeting ${dateShort(addDays(i.published_at, next))}` : "Wordt gemeten" }
  }
  if (i.due_date && ["geaccepteerd", "briefing", "concept"].includes(i.status)) {
    const late = i.due_date < new Date().toISOString().slice(0, 10)
    return { icon: <CalendarClock aria-hidden />, text: `${late ? "Te laat: inleveren vóór" : "Inleveren vóór"} ${dateShort(i.due_date)}`, late }
  }
  return { icon: col === "uitvoering" ? <Play aria-hidden /> : <CalendarClock aria-hidden />, text: CONTENT_STEP[i.status] || "" }
}

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
const ORDER: ColumnId[] = ["beoordelen", "gepland", "uitvoering", "evalueren", "afgerond"]

export default function TasksView() {
  const { loading, visibleTasks, openTask, newSinceLastVisit, setStatus, undoExecution, toast, users, me } = useWorkspace()
  const content = useContentIdeas()
  const newContentIds = useNewContentIds(content.ideas)
  const router = useRouter()
  // Contentkansen openen op een eigen pagina (inleverpunt) in plaats van een zijpaneel
  const setOpenIdea = (id: string | null) => { if (id) router.push(`/content/${id}?van=taken`) }
  const [legend, setLegend] = useState(false)
  const [view, setViewState] = useState<"bord" | "lijst">("bord")
  const [viewChosen, setViewChosen] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [reminding, setReminding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [overCol, setOverCol] = useState<ColumnId | null>(null)
  const setView = (v: "bord" | "lijst") => {
    setViewState(v); setViewChosen(true)
    try { window.localStorage.setItem(VIEW_KEY, v) } catch { /* privémodus */ }
  }
  const [type, setType] = useState<TypeFilter>("alle")
  const [prio, setPrio] = useState<"alle" | Priority>("alle")
  const [text, setText] = useState("")
  const [owner, setOwnerFilter] = useState<"alle" | "ik" | "niemand" | string>("alle")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const entries = useMemo<Entry[]>(() => {
    const cutoff = addDays(today(), -BOARD_MEASURE_DAYS)
    const seo: Entry[] = visibleTasks.map(t => {
      const col = columnOf(t.status)
      const since = col === "evalueren" ? (t.experiments[0]?.changed_at || t.updatedAt || "").slice(0, 10) : ""
      return { kind: "seo", key: t.key, col, prio: t.signal.priority, dim: !!t.snoozed, date: t.updatedAt || "", old: !!since && since < cutoff, t }
    })
    const ideas: Entry[] = (content.ideas || []).flatMap(i => {
      const col = contentColumn(i)
      const old = col === "evalueren" && i.status === "gepubliceerd" && !!i.published_at && i.published_at.slice(0, 10) < cutoff
      return col ? [{ kind: "content" as const, key: `content:${i.id}`, col, prio: i.priority || "middel", dim: i.status === "later", date: i.updated_at, old, i }] : []
    })
    return [...seo, ...ideas]
  }, [visibleTasks, content.ideas])

  const filtered = useMemo(() => {
    const kinds = TYPE_FILTERS.find(f => f.id === type)!.kinds
    const n = normalize(text)
    // Langer lopende metingen alleen als je er gericht naar zoekt
    return entries.filter(e => (!e.old || !!n) &&
      (type === "alle" || (type === "content" ? e.kind === "content" : e.kind === "seo" && kinds.includes(e.t.signal.kind))) &&
      (prio === "alle" || e.prio === prio) &&
      (owner === "alle" || (() => { const o = (e.kind === "seo" ? e.t.owner : e.i.owner) || null; return owner === "niemand" ? !o : owner === "ik" ? o === me : o === owner })()) &&
      (!n || normalize(e.kind === "seo" ? `${e.t.signal.query || ""} ${e.t.signal.page || ""} ${e.t.signal.headline}` : `${e.i.title} ${e.i.service || ""} ${e.i.target_page || ""}`).includes(n))
    )
  }, [entries, type, prio, text, owner, me])

  const typeCounts = useMemo(() => Object.fromEntries(TYPE_FILTERS.map(f => [
    f.id, f.id === "alle" ? entries.length : f.id === "content" ? entries.filter(e => e.kind === "content").length : entries.filter(e => e.kind === "seo" && f.kinds.includes(e.t.signal.kind)).length,
  ])), [entries])

  const columns = useMemo(() => {
    const byCol: Record<ColumnId, Entry[]> = { beoordelen: [], gepland: [], uitvoering: [], evalueren: [], afgerond: [] }
    for (const e of filtered) byCol[e.col].push(e)
    byCol.beoordelen.sort((a, b) => Number(a.dim) - Number(b.dim) || PRIO_RANK[a.prio] - PRIO_RANK[b.prio]
      || (a.kind === b.kind ? (a.kind === "seo" ? sortByPriority(a.t, (b as typeof a).t) : effectiveScore((b as typeof a).i) - effectiveScore(a.i)) : a.kind === "seo" ? -1 : 1))
    for (const c of ["gepland", "uitvoering", "evalueren", "afgerond"] as ColumnId[]) byCol[c].sort((a, b) => b.date.localeCompare(a.date))
    return byCol
  }, [filtered])

  // Standaardweergave: je eigen keuze, anders de lijst zolang vrijwel alles nog te beoordelen is
  useEffect(() => {
    if (loading || viewChosen) return
    let saved: string | null = null
    try { saved = window.localStorage.getItem(VIEW_KEY) } catch { /* privémodus */ }
    if (saved === "bord" || saved === "lijst") { setViewState(saved); return }
    const total = entries.length
    const inReview = entries.filter(e => e.col === "beoordelen").length
    setViewState(total > 0 && total - inReview <= 2 ? "lijst" : "bord")
  }, [loading, viewChosen, entries])

  // Contentkaarten volgen hun eigen workflow; slepen doet alleen wat zonder extra invoer kan
  const dropContent = async (i: ContentIdea, from: ColumnId, to: ColumnId) => {
    if (from === to) return
    const patch = async (status: string, msg: string) => {
      const res = await fetch(`/api/content/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", status }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast(json.error || "Verplaatsen mislukt", "error"); return }
      content.update(json.idea); toast(msg)
    }
    if (from === "beoordelen" && to === "gepland") return patch("geaccepteerd", "Geaccepteerd. Open de kaart om de briefing te maken.")
    // Terug slepen: zonder vragen naar de vorige stap
    if (ORDER.indexOf(to) < ORDER.indexOf(from)) {
      if (i.status === "gepubliceerd") { toast("Een gepubliceerd artikel wordt gemeten en kan niet terug.", "info"); return }
      if (from === "afgerond" && (to === "uitvoering" || to === "evalueren")) { toast("Zet een afgewezen kans eerst terug naar Te beoordelen of Gepland.", "info"); return }
      if (to === "beoordelen") return patch("nieuw", "Terug naar te beoordelen")
      if (to === "gepland") return patch(i.briefing ? "briefing" : "geaccepteerd", "Terug naar Gepland")
      if (to === "uitvoering") return patch("concept", "Terug naar In uitvoering")
      if (to === "evalueren") return patch("review", "Terug naar Evalueren")
    }
    if (to === "evalueren" && (from === "gepland" || from === "uitvoering")) {
      // Inleveren: alleen als het concept als bijlage is geüpload
      const res = await fetch(`/api/content/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit" }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setOpenIdea(i.id); toast(json.error || "Inleveren mislukt", "info"); return }
      content.update(json.idea); toast("Ingeleverd ter beoordeling"); return
    }
    if (to === "afgerond" && from !== "evalueren") { setOpenIdea(i.id); toast("Geef aan waarom je deze kans afwijst (knop Afwijzen of Stoppen).", "info"); return }
    setOpenIdea(i.id)
    toast(to === "uitvoering" ? "Content gaat naar In uitvoering zodra het concept binnen is. Maak eerst de briefing." : to === "evalueren" ? "Na goedkeuring leg je de publicatie vast (URL en datum); daarna start de meting." : "Deze stap volgt uit de contentworkflow in het paneel.", "info")
  }

  const drop = async (t: Task, to: ColumnId) => {
    const from = columnOf(t.status)
    if (from === to) return
    const back = ORDER.indexOf(to) < ORDER.indexOf(from)
    const label = COLUMNS.find(c => c.id === to)!.label
    // Een stap (of meer) terug: zonder vragen
    if (back && from === "evalueren") {
      const ok = await undoExecution(t, DROP_STATUS[to]!)
      if (ok) toast(`Terug naar ${label}; de meting is gestopt`)
      return
    }
    if (back && from === "afgerond") {
      if (t.experiments.some(e => e.outcome)) { toast("Deze taak is gemeten en afgerond; terugzetten zou de uitkomst weggooien.", "info"); return }
      if (!DROP_STATUS[to]) { toast("Zet een afgesloten taak terug naar Te beoordelen, Gepland of In uitvoering.", "info"); return }
      const ok = await setStatus(t, DROP_STATUS[to]!, { note: t.note, snoozeUntil: null })
      if (ok) toast(`Terug naar ${label}`)
      return
    }
    if (to === "evalueren") { openTask(t.key, "execute"); return }
    if (to === "afgerond") { openTask(t.key, "close"); return }
    const status = DROP_STATUS[to]!
    const ok = await setStatus(t, status, { note: t.note, snoozeUntil: null })
    if (ok) toast(`Verplaatst naar ${COLUMNS.find(c => c.id === to)!.label}`)
  }

  // SEO-taken in uitvoering: in één keer naar Evalueren (contentkansen volgen hun eigen inleverstap)
  const running = useMemo(() => entries.filter(e => e.col === "uitvoering" && e.kind === "seo").map(e => (e as Extract<Entry, { kind: "seo" }>).t), [entries])

  const measuringElsewhere = useMemo(() => entries.filter(e => e.old).length, [entries])

  // Statusregel: wat ligt er, en vraagt iets aandacht?
  const boardStatus = useMemo(() => {
    if (loading) return null
    const review = entries.filter(e => e.col === "beoordelen" && !e.dim), high = review.filter(e => e.prio === "hoog").length
    const doing = entries.filter(e => e.col === "uitvoering").length, planned = entries.filter(e => e.col === "gepland").length
    const parts = [
      review.length ? `${review.length} te beoordelen${high ? `, waarvan ${high} met hoge prioriteit` : ""}` : "Niets te beoordelen",
      planned ? `${planned} gepland` : "", doing ? `${doing} in uitvoering` : "",
    ].filter(Boolean)
    return { tone: (high ? "attention" : "good") as StatusTone, text: `${parts.join(", ")}.` }
  }, [entries, loading])

  const filtersActive = type !== "alle" || prio !== "alle" || text.trim() !== "" || owner !== "alle"

  return (
    <>
      <PageHeader title="Mijn taken" status={boardStatus}
        sub="Elk SEO-advies en elke contentkans van signaal tot resultaat. Open een kaart om te beslissen, of sleep hem naar een andere kolom."
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => setReminding(true)}><BellRing aria-hidden />Herinnering</button>
          {running.length >= 2 && view === "lijst" && <button className="btn btn-secondary btn-sm" onClick={() => setBulk(true)}><CheckCheck aria-hidden />Meerdere afronden</button>}
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus aria-hidden />Taak toevoegen</button>
        </>} />

      {legend && <BoardLegend onClose={() => setLegend(false)} />}


      <div className="toolbar">
        <div className="toolbar-left" role="group" aria-label="Filter op type">
          {TYPE_FILTERS.filter(f => f.id === "alle" || typeCounts[f.id] > 0).map(f => (
            <button key={f.id} className={`chip${type === f.id ? " is-active" : ""}`} onClick={() => setType(f.id)} aria-pressed={type === f.id}>
              {f.label}<span className="chip-count">{typeCounts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-left toolbar-view">
          <div className="seg" role="group" aria-label="Weergave">
            <button className={view === "bord" ? "is-active" : ""} onClick={() => setView("bord")} aria-pressed={view === "bord"}><KanbanSquare aria-hidden />Bord</button>
            <button className={view === "lijst" ? "is-active" : ""} onClick={() => setView("lijst")} aria-pressed={view === "lijst"}><List aria-hidden />Lijst</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setLegend(l => !l)} aria-expanded={legend}><CircleHelp aria-hidden />Hoe werkt het bord?</button>
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
          <label className="sr-only" htmlFor="owner-filter">Eigenaar</label>
          <select id="owner-filter" className="select" style={{ width: 170, height: 36, borderRadius: 999 }} value={owner} onChange={e => setOwnerFilter(e.target.value)}>
            <option value="alle">Iedereen</option>
            <option value="ik">Alleen mijn taken</option>
            <option value="niemand">Niet toegewezen</option>
            {users.filter(u => u.email !== me).map(u => <option key={u.email} value={u.email}>{u.name || u.email}</option>)}
          </select>
          {filtersActive && <button className="btn btn-ghost btn-sm" onClick={() => { setType("alle"); setPrio("alle"); setText(""); setOwnerFilter("alle") }}>Filters wissen</button>}
        </div>
      </div>

      {loading ? (
        <div className="board">
          {COLUMNS.map(c => (
            <div key={c.id} className={`col col-${c.id}`}><div className="col-head"><h2>{c.label}</h2></div><Skeleton height={96} radius={12} /><Skeleton height={96} radius={12} /></div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="card"><EmptyState icon={<Inbox />} title="Nog geen signalen" text="Zodra Search Console genoeg data heeft, verschijnen hier de adviezen. Je kunt ook via de zoekbalk zelf een zoekwoord of pagina analyseren." /></div>
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<SearchX />} title="Geen taken met deze filters" action={<button className="btn btn-secondary btn-sm" onClick={() => { setType("alle"); setPrio("alle"); setText("") }}>Filters wissen</button>} /></div>
      ) : view === "bord" ? (
        <div className={`board${dragKey ? " is-dragging" : ""}`}>
          {COLUMNS.map(c => {
            const items = columns[c.id]
            const showAll = expanded[c.id]
            const visible = showAll ? items : items.slice(0, COLUMN_LIMIT)
            const dragged = dragKey ? filtered.find(e => e.key === dragKey) : null
            const canDrop = !!dragged && dragged.col !== c.id
            return (
              <section key={c.id} className={`col col-${c.id}${overCol === c.id && canDrop ? " is-over" : ""}`} aria-labelledby={`col-${c.id}`} title={c.hint}
                onDragOver={e => { if (!canDrop) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overCol !== c.id) setOverCol(c.id) }}
                onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverCol(o => (o === c.id ? null : o)) }}
                onDrop={e => { e.preventDefault(); const key = e.dataTransfer.getData("text/plain") || dragKey; setOverCol(null); setDragKey(null); const en = filtered.find(x => x.key === key); if (en?.kind === "seo") drop(en.t, c.id); else if (en) dropContent(en.i, en.col, c.id) }}>
                <div className="col-head">
                  <h2 id={`col-${c.id}`}>{c.label}</h2>{(() => {
                    // Zelfde telling als de zijbalk: uitgesteld en al-opgelost tellen niet als openstaand
                    const open = items.filter(e => !e.dim && !(e.kind === "seo" && e.t.signal.resolved && e.t.current)).length
                    const rest = items.length - open
                    return <span className="col-count" title={rest ? `${open} openstaand, ${rest} uitgesteld of al opgelost` : undefined}>{open}{rest ? <small> +{rest}</small> : null}</span>
                  })()}

                </div>
                <div className="col-body">
                {c.id === "uitvoering" && running.length >= 2 && (
                  <button className="col-action" onClick={() => setBulk(true)} title="Meerdere taken tegelijk op uitgevoerd zetten, met één toelichting"><CheckCheck aria-hidden />Meerdere tegelijk afronden</button>
                )}
                {items.length === 0 ? (
                  <p className="col-empty">{c.id === "beoordelen" ? "Niets te beoordelen" : c.id === "evalueren" ? "Sleep een taak hierheen als hij is aangepast; de meting start dan" : c.id === "afgerond" ? "Sleep hierheen om af te sluiten met een uitkomst" : c.id === "gepland" ? "Sleep een taak hierheen om hem in te plannen" : "Sleep een taak hierheen als je ermee begint"}</p>
                ) : visible.map(en => {
                  const dragProps = {
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/plain", en.key); e.dataTransfer.effectAllowed = "move"; setDragKey(en.key) },
                    onDragEnd: () => { setDragKey(null); setOverCol(null) },
                    "aria-roledescription": "versleepbare kaart",
                  }
                  if (en.kind === "content") {
                    const i = en.i, meta = contentMeta(i, c.id), isNew = c.id === "beoordelen" && newContentIds.has(i.id)
                    const isMeasuring = c.id === "evalueren" && i.status === "gepubliceerd"
                    return (
                      <button key={en.key} className={`tcard interactive tcard-content${en.dim ? " is-dim" : ""}${i.status === "afgewezen" ? " is-rejected" : isNew ? " is-new" : isMeasuring ? " is-measuring" : ""}${dragKey === en.key ? " is-dragged" : ""}`} onClick={() => setOpenIdea(i.id)} {...dragProps}>
                        <span className="tcard-top">
                          <span className="kind-label tone-info"><Newspaper aria-hidden />Content · {ORIGIN_META[i.origin].label}</span>
                          {i.status === "afgewezen" ? <RejectedBadge /> : isNew ? <NewBadge /> : isMeasuring ? <MeasuringBadge /> : c.id === "beoordelen" ? <PriorityMeter priority={en.prio} /> : null}
                        </span>
                        <span className="tcard-title">{i.title}</span>
                        <span className="tcard-sub clamp2">{i.advice === "bijwerken" ? `${i.target_page} bijwerken` : i.format} · {serviceLabel(i.service)}</span>
                        {(i.note || i.decision_note) && <span className="tcard-note" title={(i.note || i.decision_note)!}><StickyNote aria-hidden /><span>{i.note || i.decision_note}</span></span>}
                        <span className="tcard-foot"><span className={"late" in meta && meta.late ? "txt-down" : undefined}>{meta.icon}{meta.text}</span>{i.owner ? <span className="owner-chip"><UserRound aria-hidden />{ownerName(i.owner, users, me)}</span> : null}{i.status === "later" ? <span>Later</span> : null}</span>
                      </button>
                    )
                  }
                  const t = en.t
                  const meta = cardMeta(t)
                  const isNew = c.id === "beoordelen" && newSinceLastVisit.has(t.key)
                  const isMeasuring = c.id === "evalueren"
                  return (
                    <button key={t.key} className={`tcard interactive${t.snoozed ? " is-dim" : ""}${t.status === "afgewezen" ? " is-rejected" : isNew ? " is-new" : isMeasuring ? " is-measuring" : ""}${dragKey === t.key ? " is-dragged" : ""}`} onClick={() => openTask(t.key)} {...dragProps}>
                      <span className="tcard-top">
                        <KindLabel signal={t.signal} />
                        {isNew ? <NewBadge /> : isMeasuring ? <MeasuringBadge /> : c.id === "beoordelen" && t.signal.kind !== "analyse" ? <PriorityMeter priority={t.signal.priority} /> : c.id === "afgerond" ? <StatusBadge task={t} /> : null}
                      </span>
                      <span className="tcard-title">{t.signal.query ? `"${t.signal.query}"` : <Breakable text={t.signal.headline} />}</span>
                      <span className="tcard-sub clamp2" title={t.signal.action || t.signal.title}>{t.signal.action || t.signal.title}</span>
                      {t.note && <span className="tcard-note" title={t.note}><StickyNote aria-hidden /><span>{t.note}</span></span>}
                      <span className="tcard-foot">
                        <span>{meta.icon}{meta.text}</span>
                        {t.owner ? <span className="owner-chip"><UserRound aria-hidden />{ownerName(t.owner, users, me)}</span> : null}
                        {t.status === "onderzoeken" ? <span>In onderzoek</span>
                          : !t.current && c.id !== "afgerond" ? <span title="Niet meer in de actuele signalen">Niet actueel</span> : null}
                      </span>
                    </button>
                  )
                })}
                {c.id === "evalueren" && measuringElsewhere > 0 && (
                  <Link href="/experimenten" className="col-elsewhere">{measuringElsewhere} {measuringElsewhere === 1 ? "meting loopt" : "metingen lopen"} al langer dan een week. Die staan in Experimenten; nieuwe resultaten zie je op Vandaag.</Link>
                )}
                {items.length > COLUMN_LIMIT && (
                  <button className="col-more" onClick={() => setExpanded(e => ({ ...e, [c.id]: !showAll }))}>
                    {showAll ? "Minder tonen" : `Nog ${items.length - COLUMN_LIMIT} tonen`}
                  </button>
                )}
                </div>
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
                {COLUMNS.flatMap(c => columns[c.id]).map(en => en.kind === "content" ? (
                  <tr key={en.key} className="is-clickable" onClick={() => setOpenIdea(en.i.id)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") setOpenIdea(en.i.id) }}>
                    <td className="cell-main"><span className="truncate" style={{ display: "block" }}>{en.i.title}</span><span className="subtle" style={{ fontSize: 12, fontWeight: 400, display: "block" }}>{en.i.format} · {serviceLabel(en.i.service)}</span></td>
                    <td className="nowrap">Content<div style={{ marginTop: 4 }}><span className="badge tone-neutral">{ORIGIN_META[en.i.origin].label}</span></div></td>
                    <td>{en.i.status === "afgewezen" ? <RejectedBadge /> : <span className="badge tone-info badge-dot">{CONTENT_STEP[en.i.status] || en.i.status}</span>}{en.i.owner && <div style={{ marginTop: 4 }}><span className="owner-chip"><UserRound aria-hidden />{ownerName(en.i.owner, users, me)}</span></div>}</td>
                    <td><PriorityMeter priority={en.prio} /></td>
                    <td className="nowrap"><TrendingUp size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--accent-700)" }} aria-hidden />Score {effectiveScore(en.i)}</td>
                    <td className="num">{en.i.keywords?.length ? num(en.i.keywords.reduce((s, k) => s + k.impressions, 0)) : "—"}</td>
                    <td className="nowrap"><ShieldCheck size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--grey-400)" }} aria-hidden />{en.i.sources[0]?.publisher || "—"}</td>
                    <td className="cell-arrow"><ChevronRight aria-hidden /></td>
                  </tr>
                ) : (() => { const t = en.t; return (
                  <tr key={t.key} className="is-clickable" onClick={() => openTask(t.key)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") openTask(t.key) }}>
                    <td className="cell-main"><span className="truncate" style={{ display: "block" }}>{t.signal.query || t.signal.headline}</span><span className="subtle" style={{ fontSize: 12, fontWeight: 400, display: "block" }}>{t.signal.action || t.signal.title}</span>{t.note && <span className="tcard-note" title={t.note}><StickyNote aria-hidden /><span>{t.note}</span></span>}</td>
                    <td className="nowrap">{KIND_META[t.signal.kind].label}{t.signal.intent && <div style={{ marginTop: 4 }}><IntentBadge intent={t.signal.intent} /></div>}</td>
                    <td><StatusBadge task={t} />{t.owner && <div style={{ marginTop: 4 }}><span className="owner-chip"><UserRound aria-hidden />{ownerName(t.owner, users, me)}</span></div>}</td>
                    <td>{t.signal.kind !== "analyse" ? <PriorityMeter priority={t.signal.priority} /> : <span className="subtle">—</span>}</td>
                    <td className="nowrap"><TrendingUp size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--accent-700)" }} aria-hidden />{gainShort(t.signal.gain)}</td>
                    <td className="num"><Eye size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--grey-400)" }} aria-hidden />{num(t.signal.metrics.impressions)}</td>
                    <td className="nowrap"><ShieldCheck size={13} style={{ display: "inline", verticalAlign: -2, marginRight: 4, color: "var(--grey-400)" }} aria-hidden />{t.signal.evidence}</td>
                    <td className="cell-arrow"><ChevronRight aria-hidden /></td>
                  </tr>
                ) })())}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Onder het bord: grote adviezen die veel pagina's of de hele site raken */}
      <SiteAdviceStrip />
      {adding && <AddTaskDialog onClose={() => setAdding(false)} />}
      {reminding && <ReminderDialog onClose={() => setReminding(false)} />}
      {bulk && <BulkExecuteDialog tasks={running} onClose={() => setBulk(false)} />}
    </>
  )
}
