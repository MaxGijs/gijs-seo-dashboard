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

  return (
    <div className="p-6 space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-sm">Periode:</span>
        {[7, 28, 90].map(d => (
          <button
            key={d}
            onClick={() => setPeriod(d)}
            className={`px-3 py-1 rounded text-sm transition ${
              period === d
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {d} dagen
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-4 text-sm">
          Fout: {error}
        </div>
      )}

      {/* KPI tiles */}
      <StatsRow
        loading={loading}
        stats={[
          { label: "Clicks", value: totalClicks.toLocaleString("nl"), color: "blue" },
          { label: "Impressies", value: totalImpressions.toLocaleString("nl"), color: "purple" },
          { label: "Gem. positie", value: avgPosition, color: "green" },
          { label: "Conversies", value: totalConversions.toFixed(0), color: "orange" },
        ]}
      />

      {/* Trend chart */}
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <h2 className="text-white font-semibold mb-4">Clicks & Impressies</h2>
        <TrendChart rows={gscOverview?.rows || []} loading={loading} />
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <h2 className="text-white font-semibold mb-4">Top zoekwoorden</h2>
          <KeywordsTable rows={keywords} loading={loading} />
        </div>
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <h2 className="text-white font-semibold mb-4">Top pagina's</h2>
          <PagesTable rows={pages} loading={loading} />
        </div>
      </div>
    </div>
  )
}
