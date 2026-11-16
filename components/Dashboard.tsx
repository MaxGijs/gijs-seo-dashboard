"use client"

import { useEffect, useState } from "react"
import StatsRow from "./StatsRow"
import KeywordsTable from "./KeywordsTable"
import PagesTable from "./PagesTable"
import TrendChart from "./TrendChart"

export default function Dashboard() {
  const [period, setPeriod] = useState(28)
  const [gscOverview, setGscOverview] = useState<any>(null)
  const [keywords, setKeywords] = useState<any[]>([])
  const [pages, setPages] = useState<any[]>([])
  const [ga4, setGa4] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`/api/gsc?type=overview&days=${period}`).then(r => r.json()),
      fetch(`/api/gsc?type=keywords&days=${period}`).then(r => r.json()),
      fetch(`/api/gsc?type=pages&days=${period}`).then(r => r.json()),
      fetch(`/api/ga4?days=${period}`).then(r => r.json()),
    ])
      .then(([overview, kw, pg, g4]) => {
        setGscOverview(overview)
        setKeywords(kw.rows || [])
        setPages(pg.rows || [])
        setGa4(g4)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [period])

  const totalClicks = gscOverview?.rows?.reduce((s: number, r: any) => s + (r.clicks || 0), 0) || 0
  const totalImpressions = gscOverview?.rows?.reduce((s: number, r: any) => s + (r.impressions || 0), 0) || 0
  const avgPosition = gscOverview?.rows?.length
    ? (gscOverview.rows.reduce((s: number, r: any) => s + (r.position || 0), 0) / gscOverview.rows.length).toFixed(1)
    : "—"
  const totalConversions = ga4?.rows?.reduce((s: number, r: any) => s + parseFloat(r.metricValues?.[1]?.value || 0), 0) || 0

  const card: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-card)", padding: "22px 24px",
    boxShadow: "var(--shadow-1)"
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px 60px" }}>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--green-800)", letterSpacing: "-0.025em", margin: 0 }}>
            groeninjestraat.nl
          </h1>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Google Search Console · Analytics</p>
        </div>
        <div style={{ display: "flex", gap: 3, background: "var(--grey-100)", borderRadius: "var(--radius-pill)", padding: 3 }}>
          {[7, 28, 90].map(d => (
            <button key={d} onClick={() => setPeriod(d)} style={{
              padding: "6px 16px", borderRadius: "var(--radius-pill)", border: "none",
              background: period === d ? "var(--surface)" : "none",
              color: period === d ? "var(--green-800)" : "var(--muted)",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
              boxShadow: period === d ? "var(--shadow-1)" : "none",
              transition: "all .14s"
            }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{
          background: "#fbecea", border: "1px solid #f5c6c3", color: "#b23225",
          borderRadius: 12, padding: "12px 16px", fontSize: 13, marginBottom: 16
        }}>
          Fout bij ophalen data: {error}
        </div>
      )}

      {/* KPI tiles */}
      <StatsRow loading={loading} stats={[
        { label: "Clicks", value: totalClicks.toLocaleString("nl"), accent: "var(--accent-600)" },
        { label: "Impressies", value: totalImpressions.toLocaleString("nl"), accent: "var(--green-700)" },
        { label: "Gem. positie", value: avgPosition, accent: "var(--accent-500)" },
        { label: "Conversies", value: totalConversions.toFixed(0), accent: "var(--accent-700)" },
      ]} />

      {/* Chart */}
      <div style={{ ...card, marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--green-800)", margin: "0 0 16px" }}>Clicks per dag</h2>
        <TrendChart rows={gscOverview?.rows || []} loading={loading} />
      </div>

      {/* Tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={card}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--green-800)", margin: "0 0 16px" }}>Top zoekwoorden</h2>
          <KeywordsTable rows={keywords} loading={loading} />
        </div>
        <div style={card}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--green-800)", margin: "0 0 16px" }}>Top pagina's</h2>
          <PagesTable rows={pages} loading={loading} />
        </div>
      </div>
    </div>
  )
}
