"use client"

interface Row { keys: string[]; clicks: number; impressions: number }

export default function TrendChart({ rows, loading }: { rows: Row[]; loading: boolean }) {
  if (loading) return <div style={{ height: 96, background: "var(--grey-100)", borderRadius: 8, animation: "pulse 1.5s infinite" }} />
  if (!rows.length) return <p style={{ fontSize: 13, color: "var(--muted)" }}>Geen data beschikbaar</p>

  const maxClicks = Math.max(...rows.map(r => r.clicks), 1)

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 96 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              flex: 1, borderRadius: "4px 4px 0 0", minWidth: 0,
              height: `${(r.clicks / maxClicks) * 100}%`,
              background: "var(--accent-200)",
              transition: "background .15s", cursor: "default"
            }}
            title={`${r.keys[0]}: ${r.clicks} clicks`}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--accent-600)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--accent-200)")}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--muted)" }}>
        <span>{rows[0]?.keys[0]}</span>
        <span>{rows[rows.length - 1]?.keys[0]}</span>
      </div>
    </div>
  )
}
