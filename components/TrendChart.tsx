"use client"

interface Row {
  keys: string[]
  clicks: number
  impressions: number
}

export default function TrendChart({ rows, loading }: { rows: Row[]; loading: boolean }) {
  if (loading) {
    return <div className="h-40 bg-gray-800 rounded animate-pulse" />
  }

  if (!rows.length) return <p className="text-gray-500 text-sm">Geen data</p>

  const maxClicks = Math.max(...rows.map(r => r.clicks), 1)
  const maxImpressions = Math.max(...rows.map(r => r.impressions), 1)

  const w = 100 / rows.length

  return (
    <div className="space-y-3">
      {/* Clicks bar chart */}
      <div>
        <p className="text-xs text-blue-400 mb-1">Clicks</p>
        <div className="flex items-end gap-0.5 h-24">
          {rows.map((r, i) => (
            <div
              key={i}
              className="bg-blue-600/70 hover:bg-blue-500 rounded-sm transition flex-1"
              style={{ height: `${(r.clicks / maxClicks) * 100}%` }}
              title={`${r.keys[0]}: ${r.clicks} clicks`}
            />
          ))}
        </div>
      </div>
      {/* Date labels */}
      <div className="flex justify-between text-xs text-gray-600">
        <span>{rows[0]?.keys[0]}</span>
        <span>{rows[rows.length - 1]?.keys[0]}</span>
      </div>
    </div>
  )
}
