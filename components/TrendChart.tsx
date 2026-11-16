"use client"
import { useState } from "react"

interface Row { keys: string[]; clicks: number; impressions: number }

export default function TrendChart({ rows, loading }: { rows: Row[]; loading: boolean }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: Row } | null>(null)

  if (loading) return <div style={{ height: 96, background: "#eff2f1", borderRadius: 8 }} />
  if (!rows.length) return <p style={{ fontSize: 13, color: "#4a4f4d" }}>Geen data beschikbaar</p>

  const maxClicks = Math.max(...rows.map(r => r.clicks), 1)

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              flex: 1, borderRadius: "4px 4px 0 0", minWidth: 0,
              height: `${Math.max((r.clicks / maxClicks) * 100, 2)}%`,
              background: "#a9e4d2",
              transition: "background .1s", cursor: "pointer", position: "relative"
            }}
            onMouseEnter={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const parent = e.currentTarget.parentElement!.getBoundingClientRect()
              setTooltip({ x: rect.left - parent.left + rect.width / 2, y: rect.top - parent.top - 8, row: r })
              e.currentTarget.style.background = "#06a77d"
            }}
            onMouseLeave={e => {
              setTooltip(null)
              e.currentTarget.style.background = "#a9e4d2"
            }}
          />
        ))}
      </div>
      {tooltip && (
        <div style={{
          position: "absolute",
          left: tooltip.x, top: tooltip.y,
          transform: "translate(-50%, -100%)",
          background: "#133e35", color: "#fff",
          padding: "6px 10px", borderRadius: 8,
          fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
          pointerEvents: "none", zIndex: 10,
          boxShadow: "0 4px 12px #0004"
        }}>
          <div>{tooltip.row.keys[0]}</div>
          <div style={{ color: "#17bf92" }}>{tooltip.row.clicks} clicks · {tooltip.row.impressions.toLocaleString("nl")} imp.</div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#767c7a" }}>
        <span>{rows[0]?.keys[0]}</span>
        <span>{rows[rows.length - 1]?.keys[0]}</span>
      </div>
    </div>
  )
}
