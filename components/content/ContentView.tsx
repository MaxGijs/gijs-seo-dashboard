"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, Globe, Lightbulb, Newspaper, Plus, RefreshCw, Search, Sparkles, TrendingUp } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui"
import { num, pct } from "@/lib/format"
import {
  type CapacityMode, type ContentIdea, type IdeaStatus, type Origin, ANGLE_META, CAPACITY_META, effectiveScore, IMPACT_META,
  ORIGIN_META, STATUS_META, serviceLabel,
} from "@/lib/content/model"
import ContentPanel from "./ContentPanel"
import AddIdeaDialog from "./AddIdeaDialog"

export interface ContentData {
  ideas: ContentIdea[]
  capacity: { service: string; mode: CapacityMode; note: string | null; updated_at: string; updated_by: string | null }[]
  lastScan: { run_at: string; ok: boolean; details: any; error: string | null } | null
  services: string[]
  newsCount: number
}

type Tab = "beoordelen" | "productie" | "gepubliceerd" | "archief"
const TABS: { id: Tab; label: string; statuses: IdeaStatus[] }[] = [
  { id: "beoordelen", label: "Te beoordelen", statuses: ["nieuw"] },
  { id: "productie", label: "In productie", statuses: ["geaccepteerd", "briefing", "concept", "review", "goedgekeurd"] },
  { id: "gepubliceerd", label: "Gepubliceerd", statuses: ["gepubliceerd"] },
  { id: "archief", label: "Archief", statuses: ["later", "afgewezen", "verlopen"] },
]

const ORIGIN_ICON: Record<Origin, React.ReactNode> = {
  actualiteit: <Newspaper aria-hidden />, trend: <Globe aria-hidden />, zoekdata: <Search aria-hidden />, seizoen: <CalendarDays aria-hidden />, handmatig: <Lightbulb aria-hidden />,
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

function IdeaCard({ idea, onOpen }: { idea: ContentIdea; onOpen: () => void }) {
  const s = effectiveScore(idea)
  const src = newestSource(idea)
  const production = STATUS_META[idea.status].step > 0
  return (
    <button className="card idea-card" onClick={onOpen}>
      <span className={`idea-score score-${scoreTone(s)}`} title={idea.score_override !== null ? `Score aangepast door een medewerker (berekend: ${idea.score})` : "Score van 0 tot 100"}>
        <strong>{s}</strong><small>{idea.score_override !== null ? "aangepast" : "score"}</small>
      </span>
      <span className="idea-main">
        <span className="idea-tags">
          <span className="idea-origin">{ORIGIN_ICON[idea.origin]}{ORIGIN_META[idea.origin].label}</span>
          {idea.impact && idea.impact !== "overig" && <Badge tone="neutral">{IMPACT_META[idea.impact].label}</Badge>}
          <Badge tone="accent">{serviceLabel(idea.service)}</Badge>
          {idea.regions.length > 0 && <Badge tone="info">{idea.regions.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")}</Badge>}
          {production && <Badge tone="success" dot>{STATUS_META[idea.status].label}</Badge>}
        </span>
        <span className="idea-title">{idea.title}</span>
        <span className="idea-why">{idea.why_now}</span>
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
          <p className="card-sub">Telt mee in de score en bepaalt de call-to-action (bijvoorbeeld alleen digitale scans).</p>
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
  const measured = ideas.filter(i => i.status === "gepubliceerd" && i.evals?.d30)
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
    ...group(i => (i.advice === "bijwerken" ? "Bestaande pagina bijgewerkt" : "Nieuw artikel")),
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

function Sources({ data }: { data: ContentData }) {
  const st: { id: string; ok: boolean; items: number; error?: string }[] = data.lastScan?.details?.bronStatus || []
  return (
    <section className="card" aria-labelledby="src-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="src-title">Bronnen</h2>
          <p className="card-sub">Elke nacht gelezen: overheid, Milieu Centraal en landelijk en regionaal nieuws. Alleen berichten over woningen en een dienst van Gijs worden een kans. Op maandag zoekt Claude daarnaast het hele web af.</p>
        </div>
      </div>
      <div className="card-body">
        {!st.length ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Nog niet gescand.</p> : (
          <ul className="src-list">
            {st.sort((a, b) => sourceName(a.id).localeCompare(sourceName(b.id))).map(s => (
              <li key={s.id}><span>{sourceName(s.id)}</span>{s.ok ? <Badge tone="success" dot>{s.items} berichten</Badge> : <Badge tone="error" dot title={s.error}>niet bereikbaar</Badge>}</li>
            ))}
          </ul>
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
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState(false)

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
      .sort((a, b) => tab === "productie" ? STATUS_META[b.status].step - STATUS_META[a.status].step || effectiveScore(b) - effectiveScore(a)
        : tab === "gepubliceerd" ? +new Date(b.published_at || 0) - +new Date(a.published_at || 0) : effectiveScore(b) - effectiveScore(a))
  }, [data, tab, origin])
  const open = data?.ideas.find(i => i.id === openId) || null

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Contentkansen</h1>
          <p className="page-sub">Wat moeten we schrijven, en waarom nu? Het dashboard stelt voor, een medewerker beslist en publiceert.</p>
        </div>
        <div className="page-actions">
          {data?.lastScan && <span className="subtle" style={{ fontSize: "var(--fs-xs)" }}>Laatste scan {ago(data.lastScan.run_at)}</span>}
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><Plus aria-hidden />Idee toevoegen</button>
          <button className="btn btn-primary btn-sm" onClick={scan} disabled={scanning || !data}>
            <RefreshCw aria-hidden style={scanning ? { animation: "spin 1s linear infinite" } : undefined} />{scanning ? "Bronnen lezen…" : "Nu zoeken naar kansen"}
          </button>
        </div>
      </div>

      {error && <div style={{ marginBottom: 20 }}><Alert tone="error" title="Contentkansen konden niet worden geladen" action={<button className="btn btn-secondary btn-sm" onClick={load}>Opnieuw</button>}>{error}</Alert></div>}
      {data?.lastScan && !data.lastScan.ok && <div style={{ marginBottom: 20 }}><Alert tone="warning" title="De laatste scan is mislukt">{data.lastScan.error}</Alert></div>}

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
            </div>
          </div>

          {list.length ? (
            <div className="idea-list">{list.map(i => <IdeaCard key={i.id} idea={i} onOpen={() => setOpenId(i.id)} />)}</div>
          ) : (
            <div className="card">
              {!data.ideas.length ? (
                <EmptyState icon={<Sparkles />} title="Nog geen contentkansen" text="Laat het dashboard de bronnen lezen: Rijksoverheid, Milieu Centraal, je eigen zoekdata en de seizoenskalender. Dit gebeurt daarna elke nacht automatisch."
                  action={<button className="btn btn-primary btn-sm" onClick={scan} disabled={scanning}>{scanning ? "Bronnen lezen…" : "Nu zoeken naar kansen"}</button>} />
              ) : (
                <EmptyState compact icon={<TrendingUp />} title={tab === "beoordelen" ? "Alles beoordeeld" : "Niets in deze lijst"} text={tab === "beoordelen" ? "Nieuwe kansen verschijnen hier zodra er een aanleiding is. Er is geen vast publicatietempo." : undefined} />
              )}
            </div>
          )}

          <div className="content-side">
            <Capacity data={data} onSaved={load} />
            <WhatWorks ideas={data.ideas} />
            <Sources data={data} />
          </div>
        </>
      )}

      {open && <ContentPanel idea={open} all={data?.ideas || []} onClose={() => setOpenId(null)} onUpdate={update} />}
      {adding && data && <AddIdeaDialog services={data.services} onClose={() => setAdding(false)} onAdded={idea => { setData(d => (d ? { ...d, ideas: [idea, ...d.ideas] } : d)); setTab("beoordelen"); setOpenId(idea.id) }} />}
    </>
  )
}
