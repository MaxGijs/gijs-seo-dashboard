"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, ArrowDown, ArrowUp, CalendarDays, Globe, Layers, Lightbulb, Newspaper, Plus, RefreshCw, Search, Sparkles, StickyNote, TrendingDown, TrendingUp } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type StatusTone } from "@/components/ui"
import { num, pct } from "@/lib/format"
import {
  type CapacityMode, type ContentIdea, type IdeaStatus, type Origin, ANGLE_META, CAPACITY_META, effectiveScore, IMPACT_META,
  ORIGIN_META, STATUS_META, serviceLabel,
} from "@/lib/content/model"
import AddIdeaDialog from "./AddIdeaDialog"
import ContentMergeDialog from "./ContentMergeDialog"
import { canMerge } from "@/lib/content/merge"

export interface SourceRow { id: string; name: string; publisher: string; region: string | null; status: "actief" | "storing" | "geblokkeerd" | "web"; lastOk: string | null; lastError: string | null; failedRuns: number; itemsLastRun: number | null; new24h: number; relevant30d: number; why?: string }

export interface ContentData {
  ideas: ContentIdea[]
  capacity: { service: string; mode: CapacityMode; note: string | null; updated_at: string; updated_by: string | null }[]
  lastScan: { run_at: string; ok: boolean; details: any; error: string | null } | null
  services: string[]
  newsCount: number
  sources?: SourceRow[]
}

type Tab = "beoordelen" | "productie" | "gepubliceerd" | "archief"
const TABS: { id: Tab; label: string; statuses: IdeaStatus[] }[] = [
  { id: "beoordelen", label: "Te beoordelen", statuses: ["nieuw"] },
  { id: "productie", label: "In productie", statuses: ["geaccepteerd", "briefing", "concept", "review", "goedgekeurd"] },
  { id: "gepubliceerd", label: "Gepubliceerd", statuses: ["gepubliceerd"] },
  { id: "archief", label: "Archief", statuses: ["later", "afgewezen", "verlopen"] },
]

type SortKey = "score" | "datum" | "titel"
const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "datum", label: "Datum" },
  { id: "titel", label: "Titel (A-Z)" },
]
const SORT_DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = { score: "desc", datum: "desc", titel: "asc" }
// Welke datum tellen we bij "Datum": per tab de datum die er het meest toe doet.
function dateOf(i: ContentIdea, tab: Tab) {
  if (tab === "gepubliceerd") return i.published_at || i.updated_at || i.created_at
  if (tab === "productie") return i.due_date || i.updated_at || i.created_at
  return i.updated_at || i.created_at
}
function sortValue(i: ContentIdea, tab: Tab, key: SortKey): number | string {
  if (key === "titel") return i.title.toLocaleLowerCase("nl")
  if (key === "datum") return +new Date(dateOf(i, tab) || 0)
  return effectiveScore(i)
}

const ORIGIN_ICON: Record<Origin, React.ReactNode> = {
  actualiteit: <Newspaper aria-hidden />, trend: <Globe aria-hidden />, zoekdata: <Search aria-hidden />, seizoen: <CalendarDays aria-hidden />, handmatig: <Lightbulb aria-hidden />, prestatie: <TrendingDown aria-hidden />,
}

export function ago(iso: string | null | undefined) {
  if (!iso) return ""
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return "vandaag"
  if (d === 1) return "gisteren"
  if (d < 30) return `${d} dagen geleden`
  const m = Math.round(d / 30)
  return `${m} ${m === 1 ? "maand" : "maanden"} geleden`
}

export function newestSource(i: ContentIdea) {
  return i.sources.filter(s => s.date).sort((a, b) => +new Date(b.date!) - +new Date(a.date!))[0]
}

export function scoreTone(s: number) {
  return s >= 65 ? "high" : s >= 45 ? "mid" : "low"
}

function IdeaCard({ idea, onOpen, merged = [], selecting, picked, pickable }: { idea: ContentIdea; onOpen: () => void; merged?: ContentIdea[]; selecting?: boolean; picked?: boolean; pickable?: boolean }) {
  const s = effectiveScore(idea)
  const src = newestSource(idea)
  const production = STATUS_META[idea.status].step > 0
  return (
    <button className={`card idea-card${idea.note ? " has-note" : ""}${selecting ? (pickable ? " is-pickable" : " is-unpickable") : ""}${picked ? " is-picked" : ""}`} onClick={onOpen} title={idea.title} disabled={selecting && !pickable} aria-pressed={selecting ? !!picked : undefined}>
      {selecting && pickable && <span className="tcard-check idea-check" aria-hidden>{picked ? "✓" : ""}</span>}
      <span className={`idea-score score-${scoreTone(s)}`} title={idea.score_override !== null ? `Score aangepast door een medewerker (berekend: ${idea.score})` : "Score van 0 tot 100"}>
        <strong>{s}</strong><small>{idea.score_override !== null ? "aangepast" : "score"}</small>
      </span>
      <span className="idea-main">
        <span className="idea-tags">
          <span className="idea-origin">{ORIGIN_ICON[idea.origin]}{ORIGIN_META[idea.origin].label}</span>
          {idea.impact && idea.impact !== "overig" && <Badge tone="neutral">{IMPACT_META[idea.impact].label}</Badge>}
          <Badge tone="neutral">{serviceLabel(idea.service)}</Badge>
          {idea.regions.length > 0 && <Badge tone="info">{idea.regions.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")}</Badge>}
          {production && <Badge tone="success" dot>{STATUS_META[idea.status].label}</Badge>}
          {idea.covered_by && !production && idea.status !== "verlopen" && <Badge tone="warning">Staat al op de site</Badge>}
          {idea.status === "verlopen" && <Badge tone="neutral" title={idea.decision_note || undefined}>Automatisch gearchiveerd</Badge>}
        </span>
        {merged.length > 0 && <span className="merged-banner"><Layers aria-hidden />Samengevoegd · {merged.length + 1} ideeën, één artikel</span>}
        <span className="idea-title">{idea.title}</span>
        {merged.length > 0 && <span className="merged-names">{merged.slice(0, 3).map(m => <span key={m.id}>+ {m.title}</span>)}{merged.length > 3 ? <span>en nog {merged.length - 3}</span> : null}</span>}
        <span className="idea-why">{idea.why_now}</span>
        {idea.note && <span className="tcard-note" title={idea.note}><StickyNote aria-hidden /><span>{idea.note}</span></span>}
        <span className="idea-meta">
          <span>{idea.advice === "bijwerken" ? "Bestaande pagina bijwerken" : idea.format}</span>
          {idea.angle && <span>Invalshoek: {ANGLE_META[idea.angle].label.toLowerCase()}</span>}
          {src && <span>{src.publisher} · {ago(src.date)}</span>}
          {idea.sources.length > 1 && <span>{idea.sources.length} bronnen</span>}
        </span>
      </span>
    </button>
  )
}

function Capacity({ data, onSaved }: { data: ContentData; onSaved: () => void }) {
  const { toast } = useWorkspace()
  const [busy, setBusy] = useState<string | null>(null)
  const modeOf = (s: string) => data.capacity.find(c => c.service === s)?.mode || "normaal"
  const save = async (service: string, mode: CapacityMode) => {
    setBusy(service)
    const res = await fetch("/api/content/capacity", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service, mode }) })
    setBusy(null)
    if (!res.ok) { toast((await res.json().catch(() => ({}))).error || "Opslaan mislukt", "error"); return }
    toast(`Capaciteit voor ${serviceLabel(service)} opgeslagen. Geldt voor nieuwe kansen vanaf de volgende scan.`)
    onSaved()
  }
  return (
    <section className="card" aria-labelledby="cap-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="cap-title">Capaciteit per dienst</h2>
          <p className="card-sub">Telt mee in de score: actief promoten geeft voorrang, minder promoten laat kansen zakken.</p>
        </div>
      </div>
      <div className="card-body">
        <div className="cap-grid">
          {data.services.map(s => (
            <label key={s} className="cap-row">
              <span>{serviceLabel(s)[0].toUpperCase() + serviceLabel(s).slice(1)}</span>
              <select className="select" value={modeOf(s)} disabled={busy === s} onChange={e => save(s, e.target.value as CapacityMode)}>
                {(Object.keys(CAPACITY_META) as CapacityMode[]).map(m => <option key={m} value={m}>{CAPACITY_META[m].label}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
    </section>
  )
}

// Wat werkt? Vergelijking van gepubliceerde content per invalshoek en vorm (30-dagenmeting)
function WhatWorks({ ideas }: { ideas: ContentIdea[] }) {
  // Alleen nieuwe artikelen; bijgewerkte pagina's worden apart gemeten (voor/na op dezelfde pagina)
  const measured = ideas.filter(i => i.status === "gepubliceerd" && i.advice !== "bijwerken" && i.evals?.d30)
  const group = (key: (i: ContentIdea) => string | null) => {
    const m = new Map<string, ContentIdea[]>()
    measured.forEach(i => { const k = key(i); if (k) m.set(k, [...(m.get(k) || []), i]) })
    return [...m.entries()].map(([k, list]) => {
      const imp = list.reduce((s, i) => s + i.evals.d30!.impressions, 0), clicks = list.reduce((s, i) => s + i.evals.d30!.clicks, 0)
      return { k, n: list.length, clicks: clicks / list.length, ctr: imp ? clicks / imp : 0 }
    }).sort((a, b) => b.clicks - a.clicks)
  }
  const rows = [
    ...group(i => (i.angle ? `Invalshoek: ${ANGLE_META[i.angle].label.toLowerCase()}` : null)),
    ...group(i => (i.format ? `Vorm: ${i.format.toLowerCase()}` : null)),
    ...group(i => (i.shelf_life === "actueel" ? "Nieuws (actueel)" : "Evergreen")),
    ...group(i => (i.regions.length ? "Lokaal of regionaal" : "Landelijk")),
  ]
  return (
    <section className="card" aria-labelledby="works-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="works-title">Wat werkt?</h2>
          <p className="card-sub">Werkt een probleemgerichte kop beter dan een positieve? Dat wordt getoetst, niet aangenomen.</p>
        </div>
      </div>
      <div className="card-body">
        {!rows.length ? (
          <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Nog geen gepubliceerde content met een 30-dagenmeting. Elk gepubliceerd artikel krijgt labels (invalshoek, vorm, dienst, regio) en wordt na 7, 30 en 90 dagen gemeten. Vanaf 5 artikelen per groep tonen we hier een vergelijking.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Groep</th><th className="num">Artikelen</th><th className="num">Gem. klikken (30 d)</th><th className="num">Doorklik</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.k}><td>{r.k}</td><td className="num">{r.n}</td><td className="num">{num(r.clicks, 1)}</td><td className="num">{pct(r.ctr)}</td>
                    <td>{r.n < 5 ? <Badge tone="neutral">te weinig data</Badge> : <Badge tone="success">telt mee</Badge>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

const SOURCE_NAMES: Record<string, string> = {
  milieucentraal: "Milieu Centraal", "nos-binnenland": "NOS · Binnenland", "nos-economie": "NOS · Economie", oost: "Oost (RTV Oost)",
  tubantia: "Tubantia", stentor: "De Stentor", gld: "Omroep Gelderland", rtvutrecht: "RTV Utrecht",
}
function sourceName(id: string) {
  if (SOURCE_NAMES[id]) return SOURCE_NAMES[id]
  if (id === "ro-energie-thuis") return "Rijksoverheid · Energie thuis"
  if (id === "ro-energielabel") return "Rijksoverheid · Energielabel"
  return `Rijksoverheid · "${id.replace(/^ro-/, "")}"`
}

const SRC_STATUS: Record<SourceRow["status"], { label: string; tone: "success" | "warning" | "error" | "neutral" }> = {
  actief: { label: "Actief", tone: "success" }, storing: { label: "Storing", tone: "warning" }, geblokkeerd: { label: "Geblokkeerd", tone: "error" }, web: { label: "Alleen via webonderzoek", tone: "neutral" },
}

function Sources({ data }: { data: ContentData }) {
  const rows = data.sources || []
  const nightly = rows.filter(r => r.status !== "web").sort((a, b) => a.name.localeCompare(b.name))
  const web = rows.filter(r => r.status === "web")
  const when = (iso: string | null) => (iso ? `${ago(iso)}` : "—")
  return (
    <section className="card content-sources" aria-labelledby="src-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="src-title">Bronnen</h2>
          <p className="card-sub">{nightly.filter(r => r.status === "actief").length} van {nightly.length} automatische bronnen werken. Alleen berichten met een dienst van Gijs of een verduurzamingsthema in de kop of de eerste zinnen worden een kans; de rest blijft in het archief.</p>
        </div>
      </div>
      <div className="card-body">
        {!rows.length ? <p className="muted small">Nog niet gescand.</p> : (
          <>
            <h3 className="src-group">Elke nacht automatisch gelezen</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Bron</th><th>Status</th><th>Laatst gelukt</th><th className="num">Laatste scan</th><th className="num">Nieuw (24 u)</th><th className="num">Relevant (30 d)</th></tr></thead>
                <tbody>
                  {nightly.map(r => (
                    <tr key={r.id}>
                      <td>{r.name}{r.region ? <span className="subtle"> · {r.region[0].toUpperCase() + r.region.slice(1)}</span> : null}</td>
                      <td><Badge tone={SRC_STATUS[r.status].tone} dot title={r.lastError || undefined}>{SRC_STATUS[r.status].label}</Badge>{r.lastError && <span className="subtle small" style={{ display: "block" }}>{r.lastError}{r.failedRuns > 1 ? ` (${r.failedRuns}× op rij)` : ""}</span>}</td>
                      <td className="nowrap">{when(r.lastOk)}</td>
                      <td className="num">{r.itemsLastRun ?? "—"}</td>
                      <td className="num">{r.new24h}</td>
                      <td className="num">{r.relevant30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="src-group">Alleen via webonderzoek</h3>
            <ul className="src-web">
              {web.map(r => <li key={r.id}><b>{r.name}</b> <span className="subtle">· {r.why}{r.id === "claude-web" && r.lastOk ? ` · laatste vondst ${ago(r.lastOk)}, ${r.relevant30d} relevant (30 d)` : ""}</span></li>)}
            </ul>
          </>
        )}
        <p className="field-hint">{num(data.newsCount)} berichten in het archief. Vakmedia en eigen klantvragen kun je toevoegen via “Idee toevoegen”.</p>
      </div>
    </section>
  )
}

export default function ContentView() {
  const { toast } = useWorkspace()
  const [data, setData] = useState<ContentData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("beoordelen")
  const [origin, setOrigin] = useState<"alle" | Origin>("alle")
  const [sort, setSort] = useState<SortKey>("score")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const chooseSort = (k: SortKey) => { setSort(k); setSortDir(SORT_DEFAULT_DIR[k]) }
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState(false)
  // Samenvoegen: kansen kiezen met vinkjes, dan één artikel van maken
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()) }
  const togglePick = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/content", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const scan = async () => {
    setScanning(true)
    try {
      const res = await fetch("/api/content/scan", { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast(json.nieuweKansen ? `${json.nieuweKansen} nieuwe ${json.nieuweKansen === 1 ? "kans" : "kansen"} gevonden` : "Geen nieuwe kansen sinds de vorige scan", json.nieuweKansen ? "success" : "info")
      await load()
    } catch (e: any) { toast(`Scannen mislukt: ${e.message}`, "error") }
    setScanning(false)
  }

  const update = (idea: ContentIdea) => setData(d => (d ? { ...d, ideas: d.ideas.map(i => (i.id === idea.id ? idea : i)) } : d))

  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.id, (data?.ideas || []).filter(i => t.statuses.includes(i.status)).length])), [data])
  const list = useMemo(() => {
    const t = TABS.find(x => x.id === tab)!
    return (data?.ideas || []).filter(i => t.statuses.includes(i.status) && (origin === "alle" || i.origin === origin))
      .sort((a, b) => {
        const va = sortValue(a, tab, sort), vb = sortValue(b, tab, sort)
        const base = typeof va === "string" ? va.localeCompare(vb as string, "nl") : (va as number) - (vb as number)
        return sortDir === "desc" ? -base : base
      })
  }, [data, tab, origin, sort, sortDir])
  const pageStatus = useMemo(() => {
    if (!data) return null
    const open = data.ideas.filter(i => i.status === "nieuw"), prod = data.ideas.filter(i => STATUS_META[i.status].step > 0 && i.status !== "gepubliceerd")
    const best = open.length ? Math.max(...open.map(effectiveScore)) : 0
    const late = prod.filter(i => i.due_date && i.due_date < new Date().toISOString().slice(0, 10)).length
    const text = [
      open.length ? `${open.length} ${open.length === 1 ? "kans" : "kansen"} te beoordelen${best >= 70 ? `, de beste scoort ${best}` : ""}` : "Niets te beoordelen",
      prod.length ? `${prod.length} in productie${late ? `, ${late} te laat` : ""}` : "",
    ].filter(Boolean).join(". ")
    return { tone: (late ? "problem" : best >= 70 ? "attention" : "good") as StatusTone, text: `${text}.` }
  }, [data])
  // Twee rijen: nieuwe artikelen apart van het bijwerken van bestaande pagina's
  const childrenOf = useMemo(() => {
    const m = new Map<string, ContentIdea[]>()
    for (const i of data?.ideas || []) if (i.status === "samengevoegd" && i.merged_into) m.set(i.merged_into, [...(m.get(i.merged_into) || []), i])
    return m
  }, [data])
  const card = (i: ContentIdea) => (
    <IdeaCard key={i.id} idea={i} merged={childrenOf.get(i.id) || []} selecting={selecting} picked={picked.has(i.id)} pickable={canMerge(i)}
      onOpen={() => (selecting ? (canMerge(i) && togglePick(i.id)) : router.push(`/content/${i.id}`))} />
  )
  const newArticles = useMemo(() => list.filter(i => i.advice !== "bijwerken"), [list])
  const pageUpdates = useMemo(() => list.filter(i => i.advice === "bijwerken"), [list])

  return (
    <>
      <PageHeader title="Contentkansen" status={pageStatus}
        sub={<>Het dashboard stelt voor; een medewerker beslist, schrijft en publiceert. Er wordt nooit automatisch gepubliceerd.{data?.lastScan ? ` Laatste scan ${ago(data.lastScan.run_at)}.` : ""}</>}
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning || !data}>
            <RefreshCw aria-hidden style={scanning ? { animation: "spin 1s linear infinite" } : undefined} />{scanning ? "Bronnen lezen…" : "Nu zoeken naar kansen"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} disabled={!data} aria-pressed={selecting}><Layers aria-hidden />Samenvoegen</button>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus aria-hidden />Idee toevoegen</button>
        </>} />

      {error && <div style={{ marginBottom: 20 }}><Alert tone="error" title="Contentkansen konden niet worden geladen" action={<button className="btn btn-secondary btn-sm" onClick={load}>Opnieuw</button>}>{error}</Alert></div>}
      {data?.lastScan && !data.lastScan.ok && <p className="data-notice-line is-problem"><AlertCircle aria-hidden />De laatste scan is mislukt, dus er kunnen nieuwe kansen ontbreken. <Link href="/data">Bekijk Datastatus</Link></p>}

      {!data && !error ? (
        <div className="idea-list">{[0, 1, 2].map(i => <div key={i} className="card card-pad"><Skeleton height={18} width="60%" /><div style={{ height: 10 }} /><Skeleton height={14} /></div>)}</div>
      ) : data && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="tabs" role="tablist">
              {TABS.map(t => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " is-active" : ""}`} onClick={() => setTab(t.id)}>
                  {t.label}<span className="chip-count">{counts[t.id]}</span>
                </button>
              ))}
            </div>
            <div className="table-tools">
              <div className="toolbar-left">
                {(["alle", "actualiteit", "trend", "zoekdata", "seizoen", "handmatig"] as const).map(o => (
                  <button key={o} className={`chip${origin === o ? " is-active" : ""}`} onClick={() => setOrigin(o)}>{o === "alle" ? "Alle" : ORIGIN_META[o].label}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label className="subtle small" htmlFor="content-sort" style={{ whiteSpace: "nowrap" }}>Sorteer op</label>
                <select id="content-sort" className="select" style={{ height: 34, fontSize: "var(--fs-sm)" }} value={sort} onChange={e => chooseSort(e.target.value as SortKey)}>
                  {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" title={sortDir === "desc" ? "Aflopend (hoog/nieuw naar laag/oud) — klik voor oplopend" : "Oplopend — klik voor aflopend"} onClick={() => setSortDir(d => (d === "desc" ? "asc" : "desc"))}>
                  {sortDir === "desc" ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />}
                </button>
              </div>
            </div>
          </div>

          {list.length ? (
            <div className="content-rows">
              <section className="content-row" aria-labelledby="row-articles">
                <h2 className="content-row-title" id="row-articles">Artikelen<span className="chip-count">{newArticles.length}</span></h2>
                {newArticles.length ? (
                  <div className="idea-list">{newArticles.map(card)}</div>
                ) : <p className="muted small">Geen artikelen in deze lijst.</p>}
              </section>
              <section className="content-row" aria-labelledby="row-updates">
                <h2 className="content-row-title" id="row-updates">Bestaande pagina's bijwerken<span className="chip-count">{pageUpdates.length}</span></h2>
                {pageUpdates.length ? (
                  <div className="idea-list">{pageUpdates.map(card)}</div>
                ) : <p className="muted small">Niets om bij te werken in deze lijst.</p>}
              </section>
            </div>
          ) : (
            <div className="card">
              {!data.ideas.length ? (
                <EmptyState icon={<Sparkles />} title="Nog geen contentkansen" text="Laat het dashboard de bronnen lezen: Rijksoverheid, Milieu Centraal, je eigen zoekdata en de seizoenskalender. Dit gebeurt daarna elke nacht automatisch."
                  action={<button className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning}>{scanning ? "Bronnen lezen…" : "Nu zoeken naar kansen"}</button>} />
              ) : (
                <EmptyState compact icon={<TrendingUp />} title={tab === "beoordelen" ? "Alles beoordeeld" : "Niets in deze lijst"} text={tab === "beoordelen" ? "Nieuwe kansen verschijnen hier zodra er een aanleiding is. Er is geen vast publicatietempo." : undefined} />
              )}
            </div>
          )}

          <div className="content-side content-side-2">
            <Capacity data={data} onSaved={load} />
            <WhatWorks ideas={data.ideas} />
          </div>
          <Sources data={data} />
        </>
      )}

      {selecting && (
        <div className="select-bar" role="region" aria-label="Samenvoegen">
          <span><b>{picked.size}</b> {picked.size === 1 ? "kans" : "kansen"} gekozen. Kies de ideeën die samen één artikel worden (alleen kansen waar nog niet aan geschreven is).</span>
          <button className="btn btn-ghost btn-sm" onClick={stopSelecting}>Annuleren</button>
          <button className="btn btn-primary btn-sm" disabled={picked.size < 2} onClick={() => setMerging(true)}><Layers aria-hidden />Samenvoegen</button>
        </div>
      )}
      {merging && data && (
        <ContentMergeDialog ideas={data.ideas.filter(i => picked.has(i.id))} onClose={() => setMerging(false)}
          onDone={(main, ids) => {
            setData(d => (d ? { ...d, ideas: d.ideas.map(i => (i.id === main.id ? main : ids.includes(i.id) ? { ...i, status: "samengevoegd" as const, merged_into: main.id } : i)) } : d))
            setMerging(false); stopSelecting()
            toast(`${ids.length + 1} kansen samengevoegd tot "${main.title}"`)
          }} />
      )}
      {adding && data && <AddIdeaDialog services={data.services} onClose={() => setAdding(false)} onAdded={idea => { setData(d => (d ? { ...d, ideas: [idea, ...d.ideas] } : d)); setTab("beoordelen"); router.push(`/content/${idea.id}`) }} />}
    </>
  )
}
