"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import PageAuditView from "./PageAuditView"
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, FileText, Hash, LineChart, SearchX } from "lucide-react"
import { useWorkspace, type AnalyticsData } from "@/lib/workspace"
import type { GscRow } from "@/lib/types"
import { toPath } from "@/lib/signals"
import { dateShort, normalize, num, pct, pos, signedPct } from "@/lib/format"
import { Alert, EmptyState, posClass, Skeleton } from "@/components/ui"

const PERIODS = [7, 28, 90]

function totals(rows: GscRow[]) {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0)
  const impressions = rows.reduce((s, r) => s + r.impressions, 0)
  const position = impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : null
  return { clicks, impressions, position, ctr: impressions ? clicks / impressions : null }
}

function DeltaText({ cur, prev, invert = false, absolute = false }: { cur: number | null; prev: number | null; invert?: boolean; absolute?: boolean }) {
  if (cur === null || prev === null || !prev) return <p className="kpi-delta delta-flat">Geen vergelijking</p>
  const diff = absolute ? prev - cur : ((cur - prev) / prev) * 100
  const good = invert ? diff > 0 : diff > 0
  const cls = Math.abs(diff) < (absolute ? 0.1 : 0.5) ? "delta-flat" : good ? "delta-up" : "delta-down"
  const label = absolute
    ? `${diff > 0 ? "▲" : diff < 0 ? "▼" : ""} ${num(Math.abs(diff), 1)} posities ${diff > 0 ? "beter" : diff < 0 ? "slechter" : ""}`
    : `${signedPct(diff)} t.o.v. vorige periode`
  return <p className={`kpi-delta ${cls}`}>{label}</p>
}

function ViewTabs({ tab }: { tab: "overzicht" | "audit" }) {
  const router = useRouter()
  return (
    <div className="seg" role="tablist" aria-label="Onderdeel">
      <button role="tab" aria-selected={tab === "overzicht"} className={tab === "overzicht" ? "is-active" : ""} onClick={() => router.replace("/analyses")}>Overzicht</button>
      <button role="tab" aria-selected={tab === "audit"} className={tab === "audit" ? "is-active" : ""} onClick={() => router.replace("/analyses?tab=audit")}>Pagina-audit</button>
    </div>
  )
}

export default function AnalysesView() {
  const params = useSearchParams()
  const tab = params.get("tab") === "audit" ? "audit" : "overzicht"
  if (tab === "audit") {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">SEO-analyses</h1>
            <p className="page-sub">Alle pagina&apos;s uit de sitemap naast Search Console: kent Google ze, toont Google ze, en wat is de volgende stap?</p>
          </div>
          <ViewTabs tab="audit" />
        </div>
        <PageAuditView />
      </>
    )
  }
  return <OverviewAnalyses tabs={<ViewTabs tab="overzicht" />} />
}

function OverviewAnalyses({ tabs }: { tabs: ReactNode }) {
  const { getAnalytics, openSubject, loading: wsLoading, authError } = useWorkspace()
  const [period, setPeriod] = useState(28)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (wsLoading || authError) return
    let cancelled = false
    setState("loading")
    getAnalytics(period)
      .then(d => { if (!cancelled) { setData(d); setState("ready") } })
      .catch(e => { if (!cancelled) { setErr(e?.message || "Ophalen mislukt"); setState("error") } })
    return () => { cancelled = true }
  }, [period, getAnalytics, wsLoading, authError])

  const cur = useMemo(() => totals(data?.overview || []), [data])
  const prev = useMemo(() => totals(data?.prevOverview || []), [data])
  const loading = state === "loading" || wsLoading

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">SEO-analyses</h1>
          <p className="page-sub">
            Google Search Console{data?.range && state === "ready" ? `, ${dateShort(data.range.startDate)} t/m ${dateShort(data.range.endDate)}` : ""}. Klik op een zoekwoord of pagina voor de volledige diagnose.
          </p>
        </div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label="Periode">
            {PERIODS.map(p => (
              <button key={p} className={period === p ? "is-active" : ""} onClick={() => setPeriod(p)} aria-pressed={period === p}>{p} dagen</button>
            ))}
          </div>
          {tabs}
        </div>
      </div>

      {state === "error" && <div style={{ marginBottom: 16 }}><Alert tone="error" title="Analyses konden niet worden geladen">{err}</Alert></div>}

      <div className="kpi-grid">
        <div className="card kpi">
          <p className="kpi-label">Clicks</p>
          <p className="kpi-value">{loading ? <Skeleton height={32} width={80} /> : num(cur.clicks)}</p>
          {!loading && <DeltaText cur={cur.clicks} prev={prev.clicks} />}
        </div>
        <div className="card kpi">
          <p className="kpi-label">Vertoningen</p>
          <p className="kpi-value">{loading ? <Skeleton height={32} width={80} /> : num(cur.impressions)}</p>
          {!loading && <DeltaText cur={cur.impressions} prev={prev.impressions} />}
        </div>
        <div className="card kpi">
          <p className="kpi-label">Gem. positie</p>
          <p className="kpi-value">{loading ? <Skeleton height={32} width={80} /> : pos(cur.position)}</p>
          {!loading && <DeltaText cur={cur.position} prev={prev.position} absolute />}
          {!loading && <p className="kpi-note">Gewogen naar vertoningen. Stijgt vaak als je op méér zoekwoorden verschijnt.</p>}
        </div>
        <div className="card kpi">
          <p className="kpi-label">Conversies (GA4)</p>
          {loading ? <p className="kpi-value"><Skeleton height={32} width={80} /></p> : data?.ga4Error ? (
            <>
              <p className="kpi-value subtle">—</p>
              <p className="kpi-note">
                {data.ga4Error.code === "permission"
                  ? <>Nog niet gekoppeld. Geef {data.ga4Error.serviceAccount ? <b style={{ wordBreak: "break-all" }}>{data.ga4Error.serviceAccount}</b> : "het serviceaccount"} de rol Lezer in Google Analytics (Beheer → Toegangsbeheer property).</>
                  : "GA4 is op dit moment niet bereikbaar."}
              </p>
            </>
          ) : (
            <>
              <p className="kpi-value">{num(data?.ga4?.keyEvents ?? 0)}</p>
              <DeltaText cur={data?.ga4?.keyEvents ?? null} prev={data?.ga4Prev?.keyEvents ?? null} />
              <p className="kpi-note">{num(data?.ga4?.sessions ?? 0)} sessies, alle kanalen</p>
            </>
          )}
        </div>
      </div>

      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="chart-title">
        <div className="card-head">
          <h2 className="card-title" id="chart-title"><LineChart aria-hidden />Clicks per dag</h2>
        </div>
        <div className="card-body">
          {loading ? <Skeleton height={150} /> : <DailyChart rows={data?.overview || []} />}
        </div>
      </section>

      <DataTables data={data} loading={loading} onOpen={openSubject} />
    </>
  )
}

function DailyChart({ rows }: { rows: GscRow[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!rows.length) return <EmptyState compact icon={<LineChart />} title="Geen gegevens in deze periode" />
  const max = Math.max(...rows.map(r => r.clicks), 1)
  const h = hover !== null ? rows[hover] : null
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="chart-bars" role="img" aria-label={`Clicks per dag, ${rows.length} dagen, maximaal ${max} op één dag`}>
        {rows.map((r, i) => (
          <div key={r.keys[0]} className={`chart-bar${hover === i ? " is-hover" : ""}`} style={{ height: `${Math.max((r.clicks / max) * 100, 2)}%` }} onMouseEnter={() => setHover(i)} />
        ))}
      </div>
      {h && hover !== null && (
        <div className="chart-tip" style={{ left: `${((hover + 0.5) / rows.length) * 100}%`, top: `${150 - Math.max((h.clicks / max) * 150, 3) - 8}px` }}>
          {dateShort(h.keys[0])}<span>{num(h.clicks)} clicks · {num(h.impressions)} vertoningen</span>
        </div>
      )}
      <div className="chart-axis"><span>{dateShort(rows[0].keys[0])}</span><span>{dateShort(rows[rows.length - 1].keys[0])}</span></div>
    </div>
  )
}

type SortKey = "clicks" | "impressions" | "ctr" | "position"

function DataTables({ data, loading, onOpen }: { data: AnalyticsData | null; loading: boolean; onOpen: (s: { query?: string; page?: string }) => void }) {
  const [tab, setTab] = useState<"zoekwoorden" | "paginas">("zoekwoorden")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "impressions", dir: -1 })
  const [limit, setLimit] = useState(50)

  const prevMap = useMemo(() => new Map((data?.prevKeywords || []).map(k => [k.keys[0], k])), [data])
  const rows = useMemo(() => {
    const src = tab === "zoekwoorden" ? data?.keywords || [] : data?.pages || []
    const n = normalize(q)
    return src
      .filter(r => !n || normalize(tab === "paginas" ? toPath(r.keys[0]) : r.keys[0]).includes(n))
      .sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir)
  }, [data, tab, q, sort])

  const head = (key: SortKey, label: string) => (
    <th className="num" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className={sort.key === key ? "is-sorted" : ""} onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "position" ? 1 : -1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />) : <ChevronsUpDown aria-hidden />}
      </button>
    </th>
  )

  return (
    <section className="card" aria-label="Zoekwoorden en pagina's">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "zoekwoorden"} className={`tab${tab === "zoekwoorden" ? " is-active" : ""}`} onClick={() => { setTab("zoekwoorden"); setLimit(50) }}><Hash size={15} aria-hidden />Zoekwoorden{data && <span className="subtle">{num(data.keywords.length)}</span>}</button>
        <button role="tab" aria-selected={tab === "paginas"} className={`tab${tab === "paginas" ? " is-active" : ""}`} onClick={() => { setTab("paginas"); setLimit(50) }}><FileText size={15} aria-hidden />Pagina&apos;s{data && <span className="subtle">{num(data.pages.length)}</span>}</button>
      </div>
      <div className="table-tools">
        <input className="input" placeholder={tab === "zoekwoorden" ? "Filter zoekwoorden" : "Filter pagina's"} aria-label="Filter" value={q} onChange={e => { setQ(e.target.value); setLimit(50) }} />
        <span className="subtle" style={{ fontSize: 12 }}>Gesorteerd op {sort.key === "impressions" ? "vertoningen" : sort.key === "clicks" ? "clicks" : sort.key === "ctr" ? "doorklik" : "positie"}</span>
      </div>
      {loading ? (
        <div className="card-body" style={{ display: "grid", gap: 10 }}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={30} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState compact icon={<SearchX />} title={q ? "Niets gevonden" : "Geen gegevens"} text={q ? "Probeer een ander woord, of gebruik de zoekbalk bovenaan om een zoekwoord direct te analyseren." : undefined} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{tab === "zoekwoorden" ? "Zoekwoord" : "Pagina"}</th>
                  {head("clicks", "Clicks")}{head("impressions", "Vertoningen")}{head("ctr", "Doorklik")}{head("position", "Positie")}
                  {tab === "zoekwoorden" && <th className="num">Verschil</th>}
                  <th aria-label="Openen" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map(r => {
                  const label = tab === "paginas" ? toPath(r.keys[0]) : r.keys[0]
                  const open = () => onOpen(tab === "zoekwoorden" ? { query: r.keys[0] } : { page: label })
                  const p = tab === "zoekwoorden" ? prevMap.get(r.keys[0]) : undefined
                  const diff = p ? p.position - r.position : null
                  return (
                    <tr key={r.keys[0]} className="is-clickable" onClick={open} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") open() }}>
                      <td className="cell-main"><span className="truncate" style={{ display: "block" }} title={label}>{label}</span></td>
                      <td className="num">{num(r.clicks)}</td>
                      <td className="num">{num(r.impressions)}</td>
                      <td className="num">{pct(r.ctr)}</td>
                      <td className="num"><span className={`pos-pill ${posClass(r.position)}`}>{pos(r.position)}</span></td>
                      {tab === "zoekwoorden" && (
                        <td className="num">{diff === null ? <span className="delta-flat">nieuw</span> : Math.abs(diff) < 0.5 ? <span className="delta-flat">=</span> : <span className={diff > 0 ? "delta-up" : "delta-down"}>{diff > 0 ? "▲" : "▼"} {num(Math.abs(diff), 1)}</span>}</td>
                      )}
                      <td className="cell-arrow"><ChevronRight aria-hidden /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <div style={{ padding: "12px 22px 18px", textAlign: "center" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setLimit(l => l + 100)}>Nog {num(Math.min(100, rows.length - limit))} tonen{rows.length - limit > 100 && <span className="subtle">van {num(rows.length - limit)}</span>}</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
