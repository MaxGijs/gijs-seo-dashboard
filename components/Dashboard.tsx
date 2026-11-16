"use client"

import { useEffect, useState } from "react"
import StatsRow from "./StatsRow"
import KeywordsTable from "./KeywordsTable"
import PagesTable from "./PagesTable"
import TrendChart from "./TrendChart"
import Advisor from "./Advisor"

export default function Dashboard() {
  const [period, setPeriod] = useState(28)
  const [gscOverview, setGscOverview] = useState<any>(null)
  const [gscPrev, setGscPrev] = useState<any>(null)
  const [keywords, setKeywords] = useState<any[]>([])
  const [prevKeywords, setPrevKeywords] = useState<any[]>([])
  const [pages, setPages] = useState<any[]>([])
  const [ga4, setGa4] = useState<any>(null)
  const [ga4Prev, setGa4Prev] = useState<any>(null)
  const [ga4Error, setGa4Error] = useState<string | null>(null)
  const [streaks, setStreaks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setGa4Error(null)
    Promise.all([
      fetch(`/api/gsc?type=overview&days=${period}`).then(r => r.json()),
      fetch(`/api/gsc?type=overview&days=${period * 2}&offset=${period}`).then(r => r.json()),
      fetch(`/api/gsc?type=keywords&days=${period}`).then(r => r.json()),
      fetch(`/api/gsc?type=keywords&days=${period * 2}&offset=${period}`).then(r => r.json()),
      fetch(`/api/gsc?type=pages&days=${period}`).then(r => r.json()),
      fetch(`/api/ga4?days=${period}`).then(r => r.json()).catch(() => null),
      fetch(`/api/ga4?days=${period * 2}`).then(r => r.json()).catch(() => null),
      fetch(`/api/trends?type=streaks`).then(r => r.json()).catch(() => ({ rows: [] })),
    ])
      .then(([overview, prev, kw, prevKw, pg, ga4Res, ga4PrevRes, trendsRes]) => {
        setGscOverview(overview)
        setGscPrev(prev)
        setKeywords(kw.rows || [])
        setPrevKeywords(prevKw.rows || [])
        setPages(pg.rows || [])
        setStreaks(trendsRes?.rows || [])
        if (ga4Res?.error) {
          setGa4Error(ga4Res.error)
        } else {
          setGa4(ga4Res)
          setGa4Prev(ga4PrevRes)
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [period])

  const sum = (rows: any[], key: string) => rows?.reduce((s: number, r: any) => s + (r[key] || 0), 0) || 0
  const totalClicks = sum(gscOverview?.rows, "clicks")
  const totalImpressions = sum(gscOverview?.rows, "impressions")
  const prevClicks = sum(gscPrev?.rows, "clicks")
  const prevImpressions = sum(gscPrev?.rows, "impressions")
  const avgPosition = gscOverview?.rows?.length
    ? (sum(gscOverview.rows, "position") / gscOverview.rows.length).toFixed(1)
    : "—"
  const prevAvgPosition = gscPrev?.rows?.length
    ? (sum(gscPrev.rows, "position") / gscPrev.rows.length).toFixed(1)
    : null

  const sumGa4 = (resp: any, metricIndex: number) =>
    resp?.rows?.reduce((s: number, r: any) => s + (parseFloat(r.metricValues?.[metricIndex]?.value) || 0), 0) || 0
  const totalConversions = sumGa4(ga4, 1)
  const prevConversions = sumGa4(ga4Prev, 1)

  const delta = (curr: number, prev: number) => {
    if (!prev) return null
    const pct = Math.round(((curr - prev) / prev) * 100)
    return pct
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px 60px", fontFamily: "'Open Sans', sans-serif" }}>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#133e35", letterSpacing: "-0.025em", margin: 0 }}>
            groeninjestraat.nl
          </h1>
          <p style={{ fontSize: 12, color: "#4a4f4d", marginTop: 2 }}>
            Google Search Console · vergelijking vorige periode
          </p>
        </div>
        <div style={{ display: "flex", gap: 3, background: "#eff2f1", borderRadius: 999, padding: 3 }}>
          {[7, 28, 90].map(d => (
            <button key={d} onClick={() => setPeriod(d)} style={{
              padding: "6px 16px", borderRadius: 999, border: "none",
              background: period === d ? "#fff" : "none",
              color: period === d ? "#133e35" : "#4a4f4d",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
              boxShadow: period === d ? "0 1px 2px #133e350a, 0 4px 16px #133e350a" : "none",
              transition: "all .14s"
            }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: "#fbecea", border: "1px solid #f5c6c3", color: "#b23225", borderRadius: 12, padding: "12px 16px", fontSize: 13, marginBottom: 16 }}>
          Fout bij ophalen data: {error}
        </div>
      )}

      {/* KPI tiles */}
      <StatsRow loading={loading} stats={[
        { label: "Clicks", value: totalClicks.toLocaleString("nl"), accent: "#06a77d", delta: delta(totalClicks, prevClicks) },
        { label: "Impressies", value: totalImpressions.toLocaleString("nl"), accent: "#1b5348", delta: delta(totalImpressions, prevImpressions) },
        { label: "Gem. positie", value: avgPosition, accent: "#17bf92", delta: prevAvgPosition ? Math.round((parseFloat(prevAvgPosition) - parseFloat(avgPosition as string)) * 10) / 10 : null, deltaInvert: true },
        ga4Error
          ? { label: "Conversies", value: "—", accent: "#04815f", delta: null }
          : { label: "Conversies", value: totalConversions.toLocaleString("nl"), accent: "#04815f", delta: delta(totalConversions, prevConversions) },
      ]} />

      {/* Advisor */}
      <Advisor keywords={keywords} prevKeywords={prevKeywords} pages={pages} streaks={streaks} loading={loading} />

      {/* Chart */}
      <div style={{ background: "#fff", border: "1px solid #e2e8e6", borderRadius: 20, padding: "22px 24px", boxShadow: "0 1px 2px #133e350a, 0 4px 16px #133e350a", marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "#133e35", margin: "0 0 16px" }}>Clicks per dag</h2>
        <TrendChart rows={gscOverview?.rows || []} loading={loading} />
      </div>

      {/* Tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #e2e8e6", borderRadius: 20, padding: "22px 24px", boxShadow: "0 1px 2px #133e350a, 0 4px 16px #133e350a" }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#133e35", margin: "0 0 16px" }}>Top zoekwoorden</h2>
          <KeywordsTable rows={keywords} loading={loading} />
        </div>
        <div style={{ background: "#fff", border: "1px solid #e2e8e6", borderRadius: 20, padding: "22px 24px", boxShadow: "0 1px 2px #133e350a, 0 4px 16px #133e350a" }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#133e35", margin: "0 0 16px" }}>Top pagina's</h2>
          <PagesTable rows={pages} loading={loading} />
        </div>
      </div>
    </div>
  )
}
