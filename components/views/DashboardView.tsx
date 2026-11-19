"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertCircle, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Award, CircleHelp, ExternalLink, Filter, Gauge,
  LineChart, MapPin, MousePointerClick, Eye, Users, Target, TrendingDown, TrendingUp, Minus, X, Lightbulb, Radio, Hourglass, BookOpenCheck, FileBarChart, Swords, BellRing,
} from "lucide-react"
import { useTaskGroups, useWorkspace } from "@/lib/workspace"
import { useContentIdeas } from "@/lib/content/useContent"
import { useMeasureUpdates } from "@/lib/measureUpdates"
import {
  type Compare, type DashboardData, type DashboardQuery, type KeywordItem, type Metric, type PresetPeriod, type TrendItem, type TrendSet,
  COMPARE_LABEL, delta, deltaPct, PERIOD_LABEL, queryString, TREND_MIN_IMPRESSIONS,
} from "@/lib/dashboard"
import { SERVICE_TERMS } from "@/lib/content/model"
import { LAUNCH_DATES, prettySlug } from "@/lib/pages"
import { dateShort, gainShort, num, pct, pos } from "@/lib/format"
import { Alert, EmptyState, PageHeader, PriorityMeter, SectionTabs, Skeleton, type StatusTone } from "@/components/ui"
import { CwvBlock, useAlerts } from "@/components/dashboard/Alerts"
import type { Report } from "./ReportsView"

const STORE_KEY = "gijs.dashboard.filters"
const DEFAULT_Q: DashboardQuery = { period: "28", compare: "prev", regio: null, dienst: null }
const GSC_URL = "https://search.google.com/search-console/performance/search-analytics?resource_id=https%3A%2F%2Fwww.groeninjestraat.nl%2F"
const GA4_URL = "https://analytics.google.com/analytics/web/"

type CardId = "page1" | "bijna" | "clicks" | "impressions" | "sessions" | "requests"

function readStored(): DashboardQuery {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return DEFAULT_Q
    const q = JSON.parse(raw)
    return { ...DEFAULT_Q, ...q }
  } catch { return DEFAULT_Q }
}
function writeStored(q: DashboardQuery) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(q)) } catch { /* privémodus */ }
}

// ── Notatie ─────────────────────────────────────────────────────────────────

function signedNum(n: number, digits = 0) {
  const s = Math.abs(n).toLocaleString("nl-NL", { maximumFractionDigits: digits })
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${s}`
}
function DeltaLine({ m, kind = "count", invert = false, compareLabel }: { m: Metric; kind?: "count" | "position" | "small"; invert?: boolean; compareLabel: string }) {
  if (m.value === null) return <span className="dash-delta is-flat">Geen gegevens</span>
  if (m.prev === null) return <span className="dash-delta is-flat">{compareLabel === COMPARE_LABEL.none ? "Geen vergelijking" : "Geen vergelijkingsdata"}</span>
  const d = delta(m)!
  const good = invert ? d < 0 : d > 0
  const flat = Math.abs(d) < (kind === "position" ? 0.1 : 0.5)
  const cls = flat ? "is-flat" : good ? "is-up" : "is-down"
  const Icon = flat ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight
  let text: string
  if (kind === "position") text = flat ? "gelijk" : `${pos(m.prev)} → ${pos(m.value)} · ${num(Math.abs(d), 1)} ${Math.abs(d) === 1 ? "positie" : "posities"} ${d < 0 ? "beter" : "slechter"}`
  else {
    const p = deltaPct(m)
    text = `${signedNum(d)}${kind === "count" && p !== null && m.prev >= 5 ? ` · ${signedNum(Math.round(p))}%` : ""}`
  }
  return <span className={`dash-delta ${cls}`}><Icon aria-hidden />{text}<span className="dash-delta-vs"> vs {compareLabel.toLowerCase()}</span></span>
}

// ── Hoofdcomponent ──────────────────────────────────────────────────────────

export default function DashboardView() {
  const { authError, reloadTick } = useWorkspace()
  const [q, setQ] = useState<DashboardQuery | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<CardId | null>(null)
  const reqId = useRef(0)

  useEffect(() => { setQ(readStored()) }, [])

  const load = useCallback(async (query: DashboardQuery, fresh = false) => {
    const id = ++reqId.current
    setState("loading")
    try {
      const res = await fetch(`/api/dashboard?${queryString(query)}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      if (id === reqId.current) { setData(json); setState("ready"); setErr(null) }
    } catch (e: any) {
      if (id === reqId.current) { setErr(e?.message || "Ophalen mislukt"); setState("error") }
    }
  }, [])

  useEffect(() => { if (q && !authError) load(q) }, [q, load, authError])
  // De vernieuwknop bovenaan (workspace.reload) haalt ook het dashboard opnieuw op, buiten de cache om
  const firstTick = useRef(reloadTick)
  useEffect(() => { if (q && reloadTick !== firstTick.current) { firstTick.current = reloadTick; load(q, true) } }, [reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<DashboardQuery>) => {
    setQ(prev => {
      const next = { ...(prev || DEFAULT_Q), ...patch }
      writeStored(next)
      return next
    })
  }

  const loading = state === "loading" || !q
  const compareLabel = q ? COMPARE_LABEL[q.compare] : COMPARE_LABEL.prev
  const c = data?.conclusion
  // Status: groen = goed, oranje = aandacht, grijs = informatief (docs/DESIGN.md)
  const status = !c ? null : { tone: (c.attention || c.tone === "daling" ? "attention" : c.tone === "geen-vergelijking" ? "info" : "good") as StatusTone, text: c.headline }

  return (
    <>
      {/* 1. Conclusie */}
      <PageHeader title="Dashboard" status={status}
        sub={c ? c.body : "Hoe presteert de website en wat moeten we doen?"}
        actions={<Link href="/vandaag" className="btn btn-primary btn-sm">Naar Vandaag</Link>} />
      {q && <FilterBar q={q} onChange={update} range={data ? <>Periode {dateShort(data.range.start)} – {dateShort(data.range.end)}{data.compareRange ? <>, vergeleken met {dateShort(data.compareRange.start)} – {dateShort(data.compareRange.end)}</> : null}. Search Console loopt ±2 dagen achter.</> : null} />}

      {state === "error" && !data ? (
        <Alert tone="error" title="Het dashboard kon niet worden geladen" action={q ? <button className="btn btn-secondary btn-sm" onClick={() => load(q)}>Opnieuw</button> : undefined}>{err}</Alert>
      ) : (
        <div className={`dash${loading && data ? " is-refreshing" : ""}`} aria-busy={loading}>
          {/* 2. Belangrijkste cijfers: zes in één vlak */}
          <section className="card metric-strip" aria-label="Belangrijkste cijfers">
            <Kpi id="page1" label="Zoekwoorden op pagina 1" loading={!data} onOpen={setOpen}
              value={data?.cards.page1.value != null ? num(data.cards.page1.value) : "—"}
              delta={data && <DeltaLine m={data.cards.page1} compareLabel={compareLabel} kind="small" />}
              foot={data?.cards.page1.top3 != null ? `${data.cards.page1.top3} in de top 3, merk apart` : undefined} />
            <Kpi id="bijna" label="Bijna op pagina 1" hint="positie 11–20" loading={!data} onOpen={setOpen}
              value={data?.cards.bijna.value != null ? num(data.cards.bijna.value) : "—"}
              delta={data && <DeltaLine m={data.cards.bijna} compareLabel={compareLabel} kind="small" />}
              foot="De snelste kansen" />
            <Kpi id="clicks" label="Google-klikken" loading={!data} onOpen={setOpen}
              value={data?.cards.clicks.value != null ? num(data.cards.clicks.value) : "—"}
              delta={data && <DeltaLine m={data.cards.clicks} compareLabel={compareLabel} />}
              foot={data?.cards.ctr.value != null ? `CTR ${pct(data.cards.ctr.value)}` : undefined} />
            <Kpi id="impressions" label="Google-vertoningen" loading={!data} onOpen={setOpen}
              value={data?.cards.impressions.value != null ? num(data.cards.impressions.value) : "—"}
              delta={data && <DeltaLine m={data.cards.impressions} compareLabel={compareLabel} />}
              foot={data?.cards.position.value != null ? <>Gem. positie {pos(data.cards.position.value)}{data.cards.position.prev != null ? <> (was {pos(data.cards.position.prev)})</> : null}</> : undefined} />
            <Kpi id="sessions" label="Sessies" hint="alle kanalen" loading={!data} onOpen={setOpen}
              value={data?.cards.sessions.value != null ? num(data.cards.sessions.value) : "—"}
              delta={data && <DeltaLine m={data.cards.sessions} compareLabel={compareLabel} />}
              foot={data?.errors.ga4 ? "GA4 niet bereikbaar" : data?.cards.users.value != null ? `${num(data.cards.users.value)} bezoekers, ${num(data.cards.pageviews.value)} paginaweergaven` : undefined} />
            <Kpi id="requests" label="Energiescanaanvragen" loading={!data} onOpen={setOpen}
              value={data?.cards.requests.value != null ? num(data.cards.requests.value) : "—"}
              delta={data && (data.cards.requests.value === null ? <span className="dash-delta is-warn"><AlertTriangle aria-hidden />{data.measurement.status === "geen-event" ? "Nog niet gemeten" : "Meting niet beschikbaar"}</span> : <DeltaLine m={data.cards.requests} compareLabel={compareLabel} />)}
              foot={data ? requestFoot(data) : undefined} warn={!!data && data.measurement.status !== "ok"} />
          </section>
          {data && <DataNotice data={data} />}

          {/* 3. Eén waarschuwing (de rest uitklapbaar) */}
          <TopWarning data={data} />

          {/* 4. Eén grafiek */}
          <TimeChart data={data} loading={!data} />

          {/* 5. De drie belangrijkste acties */}
          <TopActions stalled={data?.stalled || []} />

          {/* 6. Verdieping: één onderwerp tegelijk */}
          <Deeper data={data} />
        </div>
      )}

      {open && data && <MetricPanel id={open} data={data} compareLabel={compareLabel} onClose={() => setOpen(null)} />}
    </>
  )
}

// Technische problemen staan op Datastatus; hier alleen één regel als de cijfers erdoor onvolledig zijn
function DataNotice({ data }: { data: DashboardData }) {
  const tech = data.warnings.filter(w => ["gsc", "ga4", "sync", "fresh"].includes(w.id))
  const filter = data.notes.find(n => n.id === "filter"), campaign = data.notes.find(n => n.id === "campagne")
  if (!tech.length && !filter && !campaign) return null
  return (
    <div className="data-notice">
      {tech.length > 0 && <p className={tech.some(w => w.severity === "error") ? "is-problem" : "is-attention"}><AlertCircle aria-hidden />Cijfers mogelijk onvolledig: {tech[0].what.replace(/\.$/, "")}{tech.length > 1 ? ` (en ${tech.length - 1} andere)` : ""}. <Link href="/data">Bekijk Datastatus</Link></p>}
      {filter && <p><Filter aria-hidden />{filter.text}</p>}
      {campaign && <p><Radio aria-hidden />{campaign.title}: extra bezoek in die periode komt mogelijk niet uit Google.</p>}
    </div>
  )
}

const ALERT_RANK: Record<string, number> = { "site-daling": 0, "indexering-daling": 1, "pagina1-kwijt": 2, "pagina-daling": 3, snelheid: 4 }

// De belangrijkste melding prominent; de andere achter "nog N meldingen"
function TopWarning({ data }: { data: DashboardData | null }) {
  const { d } = useAlerts()
  const { openSubject } = useWorkspace()
  const [more, setMore] = useState(false)
  type Item = { key: string; severity: "error" | "warning"; title: string; detail: string; since?: string; go?: () => void; href?: string }
  const items: Item[] = [
    ...(d?.alerts || []).filter(a => !a.resolved_at).map(a => ({
      key: a.key, severity: a.severity, title: a.title, detail: a.detail, since: a.first_seen,
      go: a.type === "pagina1-kwijt" && a.subject ? () => openSubject({ query: a.subject! }) : (a.type === "pagina-daling" || a.type === "snelheid") && a.subject ? () => openSubject({ page: a.subject! }) : undefined,
      rank: ALERT_RANK[a.type] ?? 9,
    })).sort((a, b) => (a.severity === b.severity ? a.rank - b.rank : a.severity === "error" ? -1 : 1)),
    ...(data?.warnings || []).filter(w => w.id === "sitemap").map(w => ({ key: w.id, severity: w.severity, title: w.what, detail: `${w.effect} ${w.action}`, href: w.href })),
  ].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1))
  if (!items.length) return null
  const [top, ...rest] = items
  const action = (it: Item) => it.go ? <button className="btn btn-secondary btn-sm" onClick={it.go}>Bekijk</button> : it.href ? <Link className="btn btn-secondary btn-sm" href={it.href}>Bekijk</Link> : null
  return (
    <section className="page-block dash-warn" aria-label="Waarschuwing">
      <div className={`warn-main is-${top.severity === "error" ? "problem" : "attention"}`} role={top.severity === "error" ? "alert" : "status"}>
        <AlertTriangle aria-hidden />
        <div className="warn-body">
          <strong>{top.title}</strong>
          <p>{top.detail}{top.since ? ` Sinds ${dateShort(top.since)}.` : ""}</p>
        </div>
        {action(top)}
      </div>
      {rest.length > 0 && (
        <>
          <button className="link-btn small warn-more" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? "Minder tonen" : `Nog ${rest.length} ${rest.length === 1 ? "melding" : "meldingen"}`}</button>
          {more && (
            <ul className="warn-list">
              {rest.map(it => (
                <li key={it.key} className={`is-${it.severity === "error" ? "problem" : "attention"}`}>
                  <span className="warn-dot" aria-hidden />
                  <span className="warn-text"><b>{it.title}</b><span>{it.detail}</span></span>
                  {action(it)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// De drie belangrijkste acties, in dezelfde volgorde als Vandaag
function TopActions({ stalled }: { stalled: DashboardData["stalled"] }) {
  const { loading, tasks, openTask } = useWorkspace()
  const { toReview } = useTaskGroups()
  const content = useContentIdeas()
  const updates = useMeasureUpdates(tasks, content.ideas)
  const top = toReview.filter(t => t.signal.intent !== "merk" && !t.signal.reminder).slice(0, 3)
  const due = tasks.filter(t => t.signal.reminder && t.status === "uitgesteld" && !t.snoozed).length
  if (loading) return <section className="card card-pad page-block"><Skeleton height={18} width="40%" /><div style={{ height: 12 }} /><Skeleton height={60} /></section>
  return (
    <section className="card page-block dash-actions" aria-labelledby="actions-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="actions-title">Wat nu te doen</h2>
          <p className="card-sub">De drie adviezen met de meeste verwachte winst. Technische blokkades gaan voor.</p>
        </div>
        <Link href="/taken" className="btn btn-ghost btn-sm">Alle taken</Link>
      </div>
      {top.length === 0 ? <p className="card-body muted small">Alles is beoordeeld. Nieuwe adviezen komen elke nacht binnen.</p> : (
        <ol className="action-list">
          {top.map((t, i) => (
            <li key={t.key}>
              <button className={`action-row${t.signal.priority === "hoog" ? " is-high" : ""}`} onClick={() => openTask(t.key)}>
                <span className="action-n">{i + 1}</span>
                <span className="action-main">
                  <b className="truncate">{t.signal.query ? `"${t.signal.query}"` : t.signal.headline}</b>
                  <span className="truncate">{t.signal.action || t.signal.title}</span>
                </span>
                <span className="action-meta">{t.signal.priority === "hoog" ? <span className="badge tone-success">Hoge prioriteit</span> : <PriorityMeter priority={t.signal.priority} />}<small>{gainShort(t.signal.gain)}</small></span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {(due > 0 || updates.items.length > 0 || stalled.length > 0) && (
        <div className="card-foot inline-links">
          {due > 0 && <Link href="/vandaag"><BellRing aria-hidden />{due} {due === 1 ? "herinnering" : "herinneringen"} voor vandaag</Link>}
          {updates.items.length > 0 && <Link href="/vandaag"><LineChart aria-hidden />{updates.items.length} nieuwe {updates.items.length === 1 ? "meetresultaat" : "meetresultaten"}</Link>}
          {stalled.slice(0, 2).map(st => <Link key={st.id} href={st.href}><Hourglass aria-hidden />{st.text}</Link>)}
        </div>
      )}
    </section>
  )
}

type DeepTab = "ontwikkeling" | "zoekwoorden" | "paginas" | "snelheid" | "concurrentie"

// Verdieping: alles wat er verder is, één onderwerp tegelijk
function Deeper({ data }: { data: DashboardData | null }) {
  const [tab, setTab] = useState<DeepTab>("ontwikkeling")
  const tabs: { id: DeepTab; label: string }[] = [
    { id: "ontwikkeling", label: "Ontwikkeling in Google" },
    { id: "zoekwoorden", label: "Beste en slechtste zoekwoorden" },
    { id: "paginas", label: "Pagina's, kanalen en regio's" },
    { id: "snelheid", label: "Laadsnelheid" },
    ...(data?.competitors?.domains.length ? [{ id: "concurrentie" as const, label: "Concurrentie" }] : []),
  ]
  return (
    <section className="page-block dash-deeper" aria-labelledby="deeper-title">
      <h2 className="page-block-title" id="deeper-title">Verdieping</h2>
      <p className="page-block-sub">Waar de cijfers vandaan komen. Kies een onderwerp.</p>
      <SectionTabs label="Verdieping" tabs={tabs} value={tab} onChange={setTab} />
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "ontwikkeling" && <GoogleDevelopment data={data} loading={!data} />}
        {tab === "zoekwoorden" && <KeywordRanking data={data} />}
        {tab === "paginas" && <div className="dash-grid"><Drivers data={data} /><TopPages data={data} /><Channels data={data} /><Local data={data} /></div>}
        {tab === "snelheid" && <CwvBlock />}
        {tab === "concurrentie" && <Competitors data={data} />}
      </div>
      <DeepLinks />
    </section>
  )
}

// Rapport en lessen alleen als er iets is
function DeepLinks() {
  const { lessons } = useWorkspace()
  const [r, setR] = useState<Report | null>(null)
  useEffect(() => { fetch("/api/reports", { cache: "no-store" }).then(x => x.ok ? x.json() : { rows: [] }).then(j => setR(j.rows?.[0] || null)).catch(() => setR(null)) }, [])
  const active = lessons.filter(l => l.status === "actief")
  if (!r && !active.length) return null
  return (
    <div className="inline-links deep-links">
      {r && <Link href="/rapporten"><FileBarChart aria-hidden />Vrijdagrapport t/m {dateShort(r.week_end)}: {r.summary.headline}</Link>}
      {active.length > 0 && <Link href="/geleerd"><BookOpenCheck aria-hidden />{active.length} {active.length === 1 ? "les" : "lessen"} uit metingen en beslissingen</Link>}
    </div>
  )
}

function requestFoot(d: DashboardData): string {
  if (d.measurement.status === "ok") return d.cards.sessions.value ? `Conversie ${pct((d.cards.requests.value || 0) / d.cards.sessions.value, 2)}` : "Per sessie geteld"
  if (d.measurement.status === "controleren") return "Meting controleren"
  return "Bekijk hoe je dit meet"
}

// ── Filterbalk ──────────────────────────────────────────────────────────────

function FilterBar({ q, onChange, range }: { q: DashboardQuery; onChange: (p: Partial<DashboardQuery>) => void; range?: ReactNode }) {
  const [more, setMore] = useState(!!(q.regio || q.dienst))
  const [start, setStart] = useState(q.start || "")
  const [end, setEnd] = useState(q.end || "")
  const services = Object.keys(SERVICE_TERMS)
  const regions = Object.keys(LAUNCH_DATES)
  const active = [q.regio && prettySlug(q.regio), q.dienst && prettySlug(q.dienst)].filter(Boolean)
  return (
    <div className="dash-filters" role="group" aria-label="Filters">
      <div className="dash-filters-row">
        <div className="seg" role="tablist" aria-label="Periode">
          {(["1", "7", "28", "90", "custom"] as const).map(p => (
            <button key={p} role="tab" aria-selected={q.period === p} className={q.period === p ? "is-active" : ""}
              onClick={() => p === "custom" ? onChange({ period: "custom", start: start || undefined, end: end || undefined }) : onChange({ period: p })}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <label className="dash-select">
          <span className="sr-only">Vergelijken met</span>
          <select className="select" value={q.compare} onChange={e => onChange({ compare: e.target.value as Compare })}>
            {(["prev", "year", "none"] as const).map(c => <option key={c} value={c}>{c === "none" ? COMPARE_LABEL[c] : c === "year" ? "Vergelijk met dezelfde dagen vorig jaar" : `Vergelijk met ${q.period === "1" ? "de dag ervoor" : q.period === "custom" ? "de even lange periode ervoor" : `de ${q.period} dagen ervoor`}`}</option>)}
          </select>
        </label>
        <button className={`chip${more || active.length ? " is-active" : ""}`} onClick={() => setMore(m => !m)} aria-expanded={more}>
          <Filter aria-hidden />Meer filters{active.length ? `: ${active.join(", ")}` : ""}
        </button>
        {range && <span className="dash-range">{range}</span>}
      </div>
      {q.period === "custom" && (
        <div className="dash-filters-row">
          <label className="dash-date"><span>Van</span><input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label className="dash-date"><span>Tot en met</span><input className="input" type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
          <button className="btn btn-secondary btn-sm" disabled={!start || !end} onClick={() => onChange({ period: "custom", start, end })}>Toepassen</button>
        </div>
      )}
      {more && (
        <div className="dash-filters-row">
          <label className="dash-select">
            <span className="field-label">Regio</span>
            <select className="select" value={q.regio || ""} onChange={e => onChange({ regio: e.target.value || null })}>
              <option value="">Alle regio&apos;s</option>
              {regions.map(r => <option key={r} value={r}>{prettySlug(r)}</option>)}
            </select>
          </label>
          <label className="dash-select">
            <span className="field-label">Dienst</span>
            <select className="select" value={q.dienst || ""} onChange={e => onChange({ dienst: e.target.value || null })}>
              <option value="">Alle diensten</option>
              {services.map(s => <option key={s} value={s}>{prettySlug(s)}</option>)}
            </select>
          </label>
          {(q.regio || q.dienst) && <button className="btn btn-ghost btn-sm" onClick={() => onChange({ regio: null, dienst: null })}>Filters wissen</button>}
        </div>
      )}
    </div>
  )
}

// ── Waarschuwing en conclusie ───────────────────────────────────────────────

// ── Kaarten ─────────────────────────────────────────────────────────────────

function Kpi({ id, label, hint, value, delta: d, foot, loading, onOpen, warn }: {
  id: CardId; label: string; hint?: string; value: string; delta: ReactNode; foot?: ReactNode; loading: boolean; onOpen: (id: CardId) => void; warn?: boolean
}) {
  return (
    <button className={`metric${warn ? " is-warn" : ""}`} onClick={() => onOpen(id)} disabled={loading} aria-label={`${label}: details bekijken`}>
      <span className="metric-label">{label}{hint && <small> ({hint})</small>}</span>
      <span className="metric-value">{loading ? <Skeleton height={30} width={70} /> : value}</span>
      <span className="metric-delta">{loading ? <Skeleton height={14} width="70%" /> : d}</span>
      {foot && !loading && <span className="metric-foot">{foot}</span>}
    </button>
  )
}

// ── Grafiek ─────────────────────────────────────────────────────────────────

type SeriesKey = "sessions" | "requests" | "clicks" | "impressions"
const SERIES: { key: SeriesKey; label: string; color: string; axis: "left" | "right"; type: "line" | "bar" }[] = [
  { key: "sessions", label: "Sessies", color: "var(--green-800)", axis: "left", type: "line" },
  { key: "requests", label: "Energiescanaanvragen", color: "var(--accent-600)", axis: "right", type: "bar" },
  { key: "clicks", label: "Google-klikken", color: "#c47f17", axis: "left", type: "line" },
  { key: "impressions", label: "Vertoningen", color: "#7a8fc2", axis: "left", type: "line" },
]
const CHART_KEY = "gijs.dashboard.series"

function TimeChart({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const [on, setOn] = useState<Record<SeriesKey, boolean>>({ sessions: true, requests: true, clicks: false, impressions: false })
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => { try { const s = window.localStorage.getItem(CHART_KEY); if (s) setOn(o => ({ ...o, ...JSON.parse(s) })) } catch { /* */ } }, [])
  const toggle = (k: SeriesKey) => setOn(o => { const n = { ...o, [k]: !o[k] }; try { window.localStorage.setItem(CHART_KEY, JSON.stringify(n)) } catch { /* */ } return n })

  const pts = data?.series || []
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(960)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])
  const W = width, H = width < 520 ? 200 : 240, padL = 40, padR = 32, padT = 12, padB = 26
  const iw = W - padL - padR, ih = H - padT - padB
  const active = SERIES.filter(s => on[s.key] && pts.some(p => p[s.key] !== null))
  const leftMax = Math.max(1, ...active.filter(s => s.axis === "left").flatMap(s => pts.map(p => (p[s.key] as number) || 0)))
  const rightMax = Math.max(1, ...pts.map(p => p.requests || 0))
  const niceL = nice(leftMax), niceR = Math.max(nice(rightMax), 2)
  const x = (i: number) => padL + (pts.length <= 1 ? iw / 2 : (i / (pts.length - 1)) * iw)
  const yL = (v: number) => padT + ih - (v / niceL) * ih
  const yR = (v: number) => padT + ih - (v / niceR) * ih
  const barW = Math.max(2, Math.min(14, (iw / Math.max(pts.length, 1)) * 0.6))
  const leftLabels = [0, 0.5, 1].map(f => Math.round(niceL * f))
  const hasRight = active.some(s => s.axis === "right")
  const noLeads = data && data.cards.requests.value === null

  return (
    <section className="card dash-chart" aria-labelledby="chart-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="chart-title"><LineChart aria-hidden />Prestaties door de tijd</h2>
          <p className="card-sub">Per dag. Aanvragen hebben een eigen schaal rechts, anders lijken ze altijd plat.</p>
        </div>
      </div>
      <div className="card-body">
        <div className="dash-series" role="group" aria-label="Lijnen tonen">
          {SERIES.map(s => (
            <label key={s.key} className={`dash-series-item${on[s.key] ? " is-on" : ""}`}>
              <input type="checkbox" checked={on[s.key]} onChange={() => toggle(s.key)} />
              <span className="dash-swatch" style={{ background: s.color }} aria-hidden />{s.label}
            </label>
          ))}
        </div>
        {loading ? <Skeleton height={H} /> : pts.length === 0 ? <EmptyState compact icon={<LineChart />} title="Geen gegevens in deze periode" /> : (
           <div className="dash-chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Verloop per dag van de gekozen lijnen">
              {leftLabels.map(v => (
                <g key={v}>
                  <line x1={padL} x2={W - padR} y1={yL(v)} y2={yL(v)} stroke="var(--grey-100)" />
                  <text x={padL - 8} y={yL(v) + 4} textAnchor="end" className="dash-axis">{v.toLocaleString("nl-NL")}</text>
                </g>
              ))}
              {hasRight && [0, niceR / 2, niceR].map(v => <text key={v} x={W - padR + 8} y={yR(v) + 4} className="dash-axis is-right">{Number.isInteger(v) ? v : ""}</text>)}
              {(data?.campaigns || []).filter(c => c.inCurrent).map(c => {
                // Offline campagne als gearceerde band: begin = verzonden, eind = einddatum of 3 weken na-effect
                const i0 = pts.findIndex(p => p.date >= c.start), i1 = (() => { let k = -1; pts.forEach((p, i) => { if (p.date <= c.end) k = i }); return k })()
                const a = i0 < 0 ? pts.length - 1 : i0, b = i1 < 0 ? 0 : i1
                if (b < a && i0 >= 0) return null
                const x0 = i0 < 0 ? x(pts.length - 1) : x(a), x1 = Math.max(x(b), x0 + 2)
                return (
                  <g key={c.id} className="dash-campaign">
                    <rect x={x0} y={padT} width={x1 - x0} height={ih} fill="var(--warning-bg)" opacity={0.55} />
                    <line x1={x0} x2={x0} y1={padT} y2={padT + ih} stroke="var(--warning-dot)" strokeDasharray="4 3" />
                    <text x={x0 + 4} y={padT + 11} className="dash-axis dash-campaign-label">{c.name}</text>
                  </g>
                )
              })}
              {on.requests && pts.map((p, i) => p.requests ? <rect key={p.date} x={x(i) - barW / 2} y={yR(p.requests)} width={barW} height={padT + ih - yR(p.requests)} rx={2} fill="var(--accent-600)" opacity={0.85} /> : null)}
              {active.filter(s => s.type === "line").map(s => (
                <path key={s.key} d={pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yL((p[s.key] as number) || 0).toFixed(1)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} stroke="var(--grey-300)" strokeDasharray="3 3" />}
              {pts.map((p, i) => (
                <rect key={`h${p.date}`} x={x(i) - iw / Math.max(pts.length, 1) / 2} y={padT} width={iw / Math.max(pts.length, 1)} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
              ))}
              <text x={padL} y={H - 6} className="dash-axis">{dateShort(pts[0].date)}</text>
              <text x={W - padR} y={H - 6} textAnchor="end" className="dash-axis">{dateShort(pts[pts.length - 1].date)}</text>
            </svg>
            {hover !== null && pts[hover] && (
              <div className="dash-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
                <b>{dateShort(pts[hover].date)}</b>
                {SERIES.filter(s => on[s.key]).map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}: {pts[hover][s.key] === null ? "—" : num(pts[hover][s.key] as number)}</span>)}
              </div>
            )}
          </div>
        )}
        {(data?.campaigns || []).some(c => c.inCurrent) && <p className="field-hint"><span className="dash-campaign-key" aria-hidden />Gele band = offline campagne (brief, flyer…) met na-effect. Extra bezoek en aanvragen in die periode komen mogelijk niet uit Google. <a href="/campagnes">Campagnes beheren</a></p>}
        {noLeads && on.requests && <p className="field-hint">Energiescanaanvragen worden nog niet gemeten; zie de kaart hierboven voor uitleg.</p>}
      </div>
    </section>
  )
}
function nice(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

// ── Ontwikkeling in Google ──────────────────────────────────────────────────

const TREND_TABS: { key: keyof Omit<TrendSet, "counts">; label: string; sub: string; tone: string }[] = [
  { key: "nieuwPagina1", label: "Nieuw op pagina 1", sub: "Voor het eerst in de top 10", tone: "up" },
  { key: "stijgend", label: "3 weken stijgend", sub: "Drie weken op rij beter", tone: "up" },
  { key: "bijna", label: "Bijna op pagina 1", sub: "Positie 11–20: de snelste kansen", tone: "accent" },
  { key: "stilstand", label: "Aandacht nodig", sub: "4 weken rond dezelfde plek (positie 4–20)", tone: "warn" },
  { key: "dalend", label: "Dalend", sub: "Drie weken op rij slechter", tone: "down" },
]

function GoogleDevelopment({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const { openSubject } = useWorkspace()
  const [kind, setKind] = useState<"keywords" | "pages">("keywords")
  const [tab, setTab] = useState<keyof Omit<TrendSet, "counts">>("nieuwPagina1")
  const set = data?.trends?.[kind]
  const items = set?.[tab] || []
  const meta = TREND_TABS.find(t => t.key === tab)!
  return (
    <section className="card dash-dev" aria-labelledby="dev-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="dev-title"><TrendingUp aria-hidden />Ontwikkeling in Google</h2>
          <p className="card-sub">Laatste 8 weken, per week. Alleen met minstens {TREND_MIN_IMPRESSIONS} vertoningen in 4 weken, zodat toeval niet bovenaan komt. Merkzoekwoorden tellen niet mee.</p>
        </div>
        <div className="seg" role="tablist" aria-label="Zoekwoorden of pagina's">
          <button role="tab" aria-selected={kind === "keywords"} className={kind === "keywords" ? "is-active" : ""} onClick={() => setKind("keywords")}>Zoekwoorden</button>
          <button role="tab" aria-selected={kind === "pages"} className={kind === "pages" ? "is-active" : ""} onClick={() => setKind("pages")}>Pagina&apos;s</button>
        </div>
      </div>
      <div className="card-body">
        {loading ? <Skeleton height={180} /> : !data?.trends ? (
          <Alert tone="warning" title="Ontwikkeling niet beschikbaar">{data?.errors.trends || "Search Console kon niet worden gelezen."}</Alert>
        ) : (
          <>
            <div className="dash-dev-tabs" role="tablist">
              {TREND_TABS.map(t => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} className={`dash-dev-tab tone-${t.tone}${tab === t.key ? " is-active" : ""}`} onClick={() => setTab(t.key)}>
                  <span className="dash-dev-count">{set!.counts[t.key]}</span><span>{t.label}</span>
                </button>
              ))}
            </div>
            <p className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>{meta.sub}</p>
            {items.length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-sm)", padding: "10px 0" }}>Niets in deze groep.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{kind === "keywords" ? "Zoekwoord" : "Pagina"}</th><th>Verloop (8 weken)</th><th className="num">Nu</th><th className="num">Was</th><th className="num">Vertoningen 4 wk</th></tr></thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.key} className="is-clickable" onClick={() => openSubject(kind === "keywords" ? { query: it.key } : { page: it.key })}>
                        <td className="truncate" style={{ maxWidth: 320 }}>{kind === "keywords" ? <b>{it.key}</b> : it.key}</td>
                        <td><MiniTrend it={it} /></td>
                        <td className="num">{pos(it.positionNow)}</td>
                        <td className="num">{it.positionThen !== null ? pos(it.positionThen) : "—"}</td>
                        <td className="num">{num(it.impressions4w)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {set!.counts[tab] > items.length && <p className="field-hint">De {items.length} met de meeste vertoningen van {set!.counts[tab]}.</p>}
          </>
        )}
      </div>
    </section>
  )
}

function MiniTrend({ it }: { it: TrendItem }) {
  const vals = it.weeks
  const present = vals.filter((v): v is number => v !== null)
  if (present.length < 2) return <span className="subtle">—</span>
  const w = 96, h = 24
  const min = Math.min(...present), max = Math.max(...present), span = Math.max(max - min, 1)
  const x = (i: number) => (i / (vals.length - 1)) * (w - 4) + 2
  const y = (v: number) => 2 + ((v - min) / span) * (h - 4)  // lager = beter = hoger in beeld
  let d = ""
  vals.forEach((v, i) => { if (v !== null) d += `${d && vals[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}` })
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={`Positie van ${pos(present[0])} naar ${pos(present[present.length - 1])}`}><path d={d} fill="none" stroke="var(--accent-600)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
}

// ── Blokken ─────────────────────────────────────────────────────────────────

function Drivers({ data }: { data: DashboardData | null }) {
  return (
    <section className="card" aria-labelledby="drivers-title">
      <div className="card-head"><div><h2 className="card-title" id="drivers-title"><Lightbulb aria-hidden />Waardoor verandert het?</h2><p className="card-sub">Welke pagina&apos;s de verandering veroorzaken</p></div></div>
      <div className="card-body">
        {!data ? <Skeleton height={90} /> : !data.compareRange ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Kies een vergelijking om oorzaken te zien.</p> : data.drivers.length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Geen opvallende verschuivingen.</p> : (
          <ul className="dash-drivers">
            {data.drivers.map((d, i) => <li key={i} className={`tone-${d.tone}`}>{d.tone === "up" ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />}<span>{d.text}</span></li>)}
          </ul>
        )}
      </div>
    </section>
  )
}

// ── Beste en slechtste zoekwoorden ──────────────────────────────────────────
const RANK_TABS = [
  { key: "best", label: "Beste", sub: "Meeste Google-klikken (zonder merk)" },
  { key: "worst", label: "Slechtste", sub: "Veel gezocht, weinig opbrengst: klikken die je laat liggen t.o.v. een top-3-positie" },
  { key: "fallers", label: "Grootste dalers", sub: "Duidelijk gezakt t.o.v. de vergelijkingsperiode" },
] as const

function KeywordRanking({ data }: { data: DashboardData | null }) {
  const { openSubject } = useWorkspace()
  const [tab, setTab] = useState<(typeof RANK_TABS)[number]["key"]>("best")
  const r = data?.ranking
  const tabs = RANK_TABS.filter(t => t.key !== "fallers" || !!data?.compareRange)
  const rows = r ? r[tab] : []
  const meta = RANK_TABS.find(t => t.key === tab)!
  return (
    <section className="card dash-rank" aria-labelledby="rank-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="rank-title"><Award aria-hidden />Beste en slechtste zoekwoorden</h2>
          <p className="card-sub">{meta.sub}{tab !== "best" && r ? `. Alleen zoekwoorden met minstens ${r.minImpressions} vertoningen.` : "."} Klik voor de analyse.</p>
        </div>
        <div className="seg" role="tablist" aria-label="Beste of slechtste zoekwoorden">
          {tabs.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "is-active" : ""} onClick={() => setTab(t.key)}>{t.label}{r ? <small> {r[t.key].length}</small> : null}</button>)}
        </div>
      </div>
      <div className="card-body">
        {!data ? <Skeleton height={180} /> : !r || rows.length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>{tab === "best" ? "Nog geen zoekwoorden met klikken in deze periode." : tab === "worst" ? "Geen zoekwoorden die opvallend weinig opleveren." : "Geen zoekwoorden die duidelijk zijn gezakt."}</p> : (
          <ol className="rank-list">
            {rows.map((k, i) => (
              <li key={k.query}><button className={`rank-row is-${tab}`} onClick={() => openSubject({ query: k.query })}>
                <span className="rank-n">{i + 1}</span>
                <span className="rank-main"><b className="truncate">{k.query}</b><span className="rank-reason">{k.reason}</span></span>
                <span className="rank-stat"><b>{pos(k.position)}</b><small>positie{k.prevPosition !== null && Math.abs(k.prevPosition - k.position) >= 0.5 ? <> · was {pos(k.prevPosition)}</> : null}</small></span>
                <span className="rank-stat"><b>{num(k.clicks)}</b><small>klikken{k.prevClicks !== null && data.compareRange ? <> · <Diff v={k.clicks - k.prevClicks} /></> : null}</small></span>
                <span className="rank-stat">{tab === "worst" && k.missed ? <><b className="txt-down">±{num(k.missed)}</b><small>laat je liggen</small></> : <><b>{num(k.impressions)}</b><small>vertoningen</small></>}</span>
              </button></li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function TopPages({ data }: { data: DashboardData | null }) {
  const { openSubject } = useWorkspace()
  const rows = (data?.pages || []).filter(p => p.clicks || p.impressions).slice(0, 6)
  return (
    <section className="card" aria-labelledby="pages-title">
      <div className="card-head"><div><h2 className="card-title" id="pages-title"><Award aria-hidden />Best presterende pagina&apos;s</h2><p className="card-sub">Op Google-klikken</p></div><Link href="/analyses" className="section-link">Alle pagina&apos;s<ArrowRight aria-hidden /></Link></div>
      <div className="card-body">
        {!data ? <Skeleton height={140} /> : rows.length === 0 ? <p className="muted">Geen gegevens.</p> : (
          <ul className="dash-rows">
            {rows.map(p => (
              <li key={p.path}><button className="dash-row" onClick={() => openSubject({ page: p.path })}>
                <span className="truncate">{p.path}</span>
                <span className="dash-row-num">{num(p.clicks)} <small>klikken</small></span>
                <span className="dash-row-sub">{num(p.impressions)} vert.{p.prevClicks !== null ? <> · <Diff v={p.clicks - (p.prevClicks || 0)} /></> : null}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Channels({ data }: { data: DashboardData | null }) {
  const rows = data?.channels.slice(0, 6) || []
  const max = Math.max(1, ...rows.map(r => r.sessions))
  return (
    <section className="card" aria-labelledby="chan-title">
      <div className="card-head"><div><h2 className="card-title" id="chan-title"><Radio aria-hidden />Verkeer per kanaal</h2><p className="card-sub">Sessies uit GA4</p></div></div>
      <div className="card-body">
        {!data ? <Skeleton height={140} /> : data.errors.ga4 ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>{data.errors.ga4}</p> : rows.length === 0 ? <p className="muted">Geen sessies in deze periode.</p> : (
          <ul className="dash-bars">
            {rows.map(r => (
              <li key={r.name}>
                <span className="dash-bar-label">{r.name}</span>
                <span className="dash-bar"><span style={{ width: `${(r.sessions / max) * 100}%` }} /></span>
                <span className="dash-row-num">{num(r.sessions)}{r.prevSessions !== null && <small> <Diff v={r.sessions - r.prevSessions} /></small>}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Local({ data }: { data: DashboardData | null }) {
  const [mode, setMode] = useState<"best" | "worst">("best")
  const rows = useMemo(() => {
    const l = (data?.local || []).filter(x => x.impressions + (x.prevImpressions || 0) >= 10)
    if (data?.compareRange) {
      const withD = l.map(x => ({ ...x, d: x.impressions - (x.prevImpressions || 0) }))
      return withD.sort((a, b) => mode === "best" ? b.d - a.d : a.d - b.d).slice(0, 6)
    }
    return l.sort((a, b) => mode === "best" ? b.impressions - a.impressions : a.impressions - b.impressions).slice(0, 6).map(x => ({ ...x, d: null as number | null }))
  }, [data, mode])
  return (
    <section className="card" aria-labelledby="local-title">
      <div className="card-head">
        <div><h2 className="card-title" id="local-title"><MapPin aria-hidden />Lokale prestaties</h2><p className="card-sub">Per plaats waar de pagina over gaat. Gemeten op vertoningen in Google{data?.compareRange ? ": meer of minder dan in de vergelijkingsperiode" : ""}.</p></div>
        <div className="seg" role="tablist" aria-label="Meer of minder vertoningen">
          <button role="tab" aria-selected={mode === "best"} className={mode === "best" ? "is-active" : ""} onClick={() => setMode("best")}>{data?.compareRange ? "Meer" : "Meeste"}</button>
          <button role="tab" aria-selected={mode === "worst"} className={mode === "worst" ? "is-active" : ""} onClick={() => setMode("worst")}>{data?.compareRange ? "Minder" : "Minste"}</button>
        </div>
      </div>
      <div className="card-body">
        {!data ? <Skeleton height={140} /> : rows.length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Nog te weinig lokale data.</p> : (
          <ul className="dash-rows">
            {rows.map(r => (
              <li key={r.key}><Link className="dash-row" href={`/analyses?tab=audit&q=${encodeURIComponent(r.label)}`}>
                <span className="truncate"><b>{r.label}</b> <small className="subtle">{r.provincie ? prettySlug(r.provincie) : ""}</small></span>
                <span className="dash-row-num">{num(r.impressions)} <small>vert.</small></span>
                <span className="dash-row-sub">{num(r.clicks)} klikken{r.position !== null ? ` · pos. ${pos(r.position)}` : ""}{r.d !== null ? <> · <Diff v={r.d} /></> : null}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Diff({ v }: { v: number }) {
  return <span className={v > 0 ? "txt-up" : v < 0 ? "txt-down" : "subtle"}>{signedNum(v)}</span>
}

// ── Zijpaneel per cijfer ────────────────────────────────────────────────────

const PANEL_TITLE: Record<CardId, string> = {
  page1: "Zoekwoorden op pagina 1", bijna: "Bijna op pagina 1", clicks: "Google-klikken", impressions: "Google-vertoningen", sessions: "Sessies", requests: "Energiescanaanvragen",
}

function MetricPanel({ id, data, compareLabel, onClose }: { id: CardId; data: DashboardData; compareLabel: string; onClose: () => void }) {
  const { openSubject } = useWorkspace()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const source = id === "sessions" || id === "requests" ? "GA4" : "Search Console"
  const card = id === "page1" ? data.cards.page1 : data.cards[id]
  const kwRow = (k: KeywordItem) => (
    <tr key={k.query} className="is-clickable" onClick={() => { onClose(); openSubject({ query: k.query }) }}>
      <td className="truncate" style={{ maxWidth: 240 }}><b>{k.query}</b></td>
      <td className="num">{pos(k.position)}</td>
      <td className="num">{k.prevPosition !== null ? pos(k.prevPosition) : "—"}</td>
      <td className="num">{num(k.impressions)}</td>
      <td className="num">{num(k.clicks)}</td>
    </tr>
  )
  const kwTable = (rows: KeywordItem[], empty: string, limit = 30) => rows.length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>{empty}</p> : (
    <div className="table-wrap"><table className="table"><thead><tr><th>Zoekwoord</th><th className="num">Positie</th><th className="num">Was</th><th className="num">Vert.</th><th className="num">Klikken</th></tr></thead><tbody>{rows.slice(0, limit).map(kwRow)}</tbody></table></div>
  )
  const pageDelta = (key: "clicks" | "impressions" | "sessions") => [...data.pages]
    .map(p => ({ p, v: (p[key] as number | null) ?? 0, d: key === "clicks" ? p.clicks - (p.prevClicks || 0) : key === "impressions" ? p.impressions - (p.prevImpressions || 0) : (p.sessions || 0) - (p.prevSessions || 0) }))
    .filter(x => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10)

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby="mp-title">
        <header className="panel-head">
          <div className="panel-head-top">
            <span className="eyebrow">Bron: {source}</span>
            <button className="icon-btn" onClick={onClose} aria-label="Sluiten"><X /></button>
          </div>
          <h2 className="panel-title" id="mp-title">{PANEL_TITLE[id]}</h2>
          <p className="panel-subtitle">
            <b>{card.value === null ? "—" : num(card.value)}</b> in {dateShort(data.range.start)} – {dateShort(data.range.end)}
            {data.compareRange && card.prev !== null ? <> · {compareLabel.toLowerCase()}: {num(card.prev)}</> : null}
            {" · "}<a href={source === "GA4" ? GA4_URL : GSC_URL} target="_blank" rel="noreferrer">Open in {source}<ExternalLink aria-hidden /></a>
          </p>
        </header>
        <div className="panel-body">
          {id === "page1" && (
            <>
              <section className="psec"><p className="lead">Zoekwoorden met een gemiddelde positie van 1 tot en met 10 in deze periode. Merkzoekwoorden (Gijs, Groen in je straat) tellen niet mee: {data.cards.page1.brandPage1 ?? 0} daarvan staan ook op pagina 1. {data.cards.page1.top3 ?? 0} zoekwoorden staan in de top 3.</p></section>
              {data.compareRange && <section className="psec"><h3 className="psec-title">Nieuw op pagina 1 ({data.keywords.newPage1.length})</h3>{kwTable(data.keywords.newPage1, "Geen nieuwe zoekwoorden op pagina 1.", 15)}</section>}
              {data.compareRange && data.keywords.lostPage1.length > 0 && <section className="psec"><h3 className="psec-title">Van pagina 1 af ({data.keywords.lostPage1.length})</h3>{kwTable(data.keywords.lostPage1, "", 15)}</section>}
              <section className="psec"><h3 className="psec-title">Alle zoekwoorden op pagina 1 ({data.keywords.page1.length})</h3>{kwTable(data.keywords.page1, "Nog geen zoekwoorden op pagina 1.", 50)}</section>
            </>
          )}
          {id === "bijna" && (
            <>
              <section className="psec"><p className="lead">Zoekwoorden op positie 11 tot en met 20: net niet op de eerste pagina. Een betere pagina of extra interne links kan ze daar brengen. Klik een zoekwoord voor het advies.</p></section>
              <section className="psec">{kwTable(data.keywords.bijna, "Geen zoekwoorden op positie 11–20.", 50)}</section>
            </>
          )}
          {(id === "clicks" || id === "impressions" || id === "sessions") && (
            <>
              <section className="psec"><MiniSeries data={data} k={id} /></section>
              {id === "impressions" && <section className="psec"><p className="lead">De gemiddelde positie ({pos(data.cards.position.value)}) staat hier alleen als hulpcijfer. Als Gijs op meer nieuwe zoekwoorden verschijnt, wordt dat gemiddelde vaak slechter terwijl de zichtbaarheid juist groeit. Kijk daarom vooral naar pagina 1 en &ldquo;bijna op pagina 1&rdquo;.</p></section>}
              {id === "sessions" && (
                <section className="psec">
                  <p className="lead">Een sessie is één bezoek aan de website. Eén bezoeker kan meerdere sessies hebben, en binnen één sessie meerdere pagina&apos;s bekijken.</p>
                  <div className="kpis-inline" style={{ marginTop: 10 }}><span><b>{num(data.cards.users.value)}</b> bezoekers</span><span><b>{num(data.cards.pageviews.value)}</b> paginaweergaven</span></div>
                  <h3 className="psec-title" style={{ marginTop: 16 }}>Per kanaal</h3>
                  <ul className="dash-bars">{data.channels.map(c => <li key={c.name}><span className="dash-bar-label">{c.name}</span><span className="dash-bar"><span style={{ width: `${(c.sessions / Math.max(1, data.channels[0]?.sessions || 1)) * 100}%` }} /></span><span className="dash-row-num">{num(c.sessions)}</span></li>)}</ul>
                </section>
              )}
              {data.compareRange && (
                <section className="psec">
                  <h3 className="psec-title">Pagina&apos;s die de verandering veroorzaken</h3>
                  <div className="table-wrap"><table className="table"><thead><tr><th>Pagina</th><th className="num">Nu</th><th className="num">Verschil</th></tr></thead><tbody>
                    {pageDelta(id).map(({ p, v, d }) => <tr key={p.path} className="is-clickable" onClick={() => { onClose(); openSubject({ page: p.path }) }}><td className="truncate" style={{ maxWidth: 300 }}>{p.path}</td><td className="num">{num(v)}</td><td className="num"><Diff v={d} /></td></tr>)}
                  </tbody></table></div>
                </section>
              )}
            </>
          )}
          {id === "requests" && (
            <>
              <section className="psec">
                <Alert tone={data.measurement.status === "ok" ? "info" : "warning"} title={data.measurement.status === "ok" ? "Meting in orde" : data.measurement.status === "geen-event" ? "Nog niet gemeten" : "Meting controleren"}>{data.measurement.note}</Alert>
                <p className="dash-advice" style={{ marginTop: 10 }}><b>{data.measurement.status === "ok" ? "Tip:" : "Zo los je dit op:"}</b> {data.measurement.advice}</p>
              </section>
              {data.measurement.events.length > 0 && (
                <section className="psec">
                  <h3 className="psec-title">Aanvraag- en formulier-events in GA4 (90 dagen)</h3>
                  <div className="table-wrap"><table className="table"><thead><tr><th>Event</th><th className="num">Aantal</th><th className="num">Sessies</th><th>Telt mee</th></tr></thead><tbody>
                    {data.measurement.events.map(e => <tr key={e.name}><td><code>{e.name}</code>{e.isKey && <small className="subtle"> · key event</small>}</td><td className="num">{num(e.count)}</td><td className="num">{num(e.sessions)}</td><td>{data.measurement.used.includes(e.name) ? "Ja" : "Nee"}</td></tr>)}
                  </tbody></table></div>
                  <p className="field-hint">Telt mee: per sessie geteld, dus een aanvraag die meerdere events afvuurt telt één keer. Gewone contactformulieren tellen niet mee.</p>
                </section>
              )}
              {data.cards.requests.value !== null && (
                <section className="psec">
                  <h3 className="psec-title">Via welke pagina&apos;s</h3>
                  {data.pages.filter(p => p.requests).length === 0 ? <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Geen aanvragen in deze periode.</p> : (
                    <div className="table-wrap"><table className="table"><thead><tr><th>Landingspagina</th><th className="num">Aanvragen</th><th className="num">Sessies</th></tr></thead><tbody>
                      {data.pages.filter(p => p.requests).sort((a, b) => (b.requests || 0) - (a.requests || 0)).slice(0, 10).map(p => <tr key={p.path}><td className="truncate" style={{ maxWidth: 300 }}>{p.path}</td><td className="num">{num(p.requests)}</td><td className="num">{num(p.sessions)}</td></tr>)}
                    </tbody></table></div>
                  )}
                  <h3 className="psec-title" style={{ marginTop: 16 }}>Via welke kanalen</h3>
                  <ul className="dash-bars">{data.channels.filter(c => c.requests).map(c => <li key={c.name}><span className="dash-bar-label">{c.name}</span><span className="dash-bar"><span style={{ width: `${((c.requests || 0) / Math.max(1, data.cards.requests.value || 1)) * 100}%` }} /></span><span className="dash-row-num">{num(c.requests)}</span></li>)}</ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function MiniSeries({ data, k }: { data: DashboardData; k: "clicks" | "impressions" | "sessions" }) {
  const pts = data.series
  const vals = pts.map(p => (p[k] as number | null) ?? 0)
  const max = Math.max(1, ...vals)
  return (
    <div>
      <div className="spark-head"><span>Per dag</span><span>hoogste {num(max)} op één dag</span></div>
      <div className="chart-bars" style={{ height: 90 }} role="img" aria-label={`Verloop per dag, maximaal ${max}`}>
        {pts.map((p, i) => <div key={p.date} className="chart-bar" title={`${dateShort(p.date)}: ${num(vals[i])}`} style={{ height: `${Math.max((vals[i] / max) * 100, 2)}%` }} />)}
      </div>
      <div className="chart-axis"><span>{dateShort(pts[0]?.date || data.range.start)}</span><span>{dateShort(pts[pts.length - 1]?.date || data.range.end)}</span></div>
    </div>
  )
}

// ── Leren en rapport ────────────────────────────────────────────────────────

function Competitors({ data }: { data: DashboardData | null }) {
  const c = data?.competitors
  return (
    <section className="card" aria-labelledby="comp-title">
      <div className="card-head"><div><h2 className="card-title" id="comp-title"><Swords aria-hidden />Wie staat er boven Gijs?</h2><p className="card-sub">{c ? `${c.queries} belangrijke zoekwoorden, week van ${dateShort(c.week)}. Indicatie via een webzoekmachine, niet exact Google.` : "Wekelijks gecontroleerd op de belangrijkste zoekwoorden"}</p></div></div>
      <div className="card-body">
        {!data ? <Skeleton height={100} /> : !c ? <p className="muted small">Nog geen gegevens. De wekelijkse zoektaak legt elke maandag vast wie er op de belangrijkste zoekwoorden boven Gijs staat.</p> : c.domains.length === 0 ? <p className="muted small">Geen concurrenten gevonden.</p> : (
          <ul className="dash-rows">
            {c.domains.slice(0, 6).map(d => (
              <li key={d.domain}><div className="dash-row" style={{ cursor: "default" }}>
                <span className="truncate"><b>{d.domain}</b></span>
                <span className="dash-row-num">{d.above}× <small>boven Gijs</small></span>
                <span className="dash-row-sub truncate">bv. {d.examples.map(e => `"${e}"`).join(", ")}</span>
              </div></li>
            ))}
          </ul>
        )}
        {c && <p className="field-hint">Gijs gevonden bij {c.gijsFound} van {c.queries} zoekwoorden.</p>}
      </div>
    </section>
  )
}
