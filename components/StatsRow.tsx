"use client"

interface Stat {
  label: string
  value: string | number
  accent: string
  delta: number | null
  deltaInvert?: boolean
}

export default function StatsRow({ stats, loading }: { stats: Stat[]; loading: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
      {stats.map((s) => {
        const isPositive = s.deltaInvert ? (s.delta || 0) > 0 : (s.delta || 0) > 0
        const deltaColor = s.delta === null ? "#767c7a" : isPositive ? "#04815f" : "#b23225"
        return (
          <div key={s.label} style={{
            background: "#fff", border: "1px solid #e2e8e6",
            borderRadius: 20, padding: "20px",
            boxShadow: "0 1px 2px #133e350a, 0 4px 16px #133e350a",
            position: "relative", overflow: "hidden"
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: s.accent }} />
            <p style={{ fontSize: 11, fontWeight: 600, color: "#767c7a", letterSpacing: ".08em", textTransform: "uppercase", margin: "0 0 8px" }}>
              {s.label}
            </p>
            {loading ? (
              <div style={{ height: 32, width: 80, background: "#eff2f1", borderRadius: 6 }} />
            ) : (
              <>
                <p style={{ fontSize: 28, fontWeight: 700, color: "#133e35", letterSpacing: "-0.03em", margin: 0, fontVariantNumeric: "tabular-nums" }}>
                  {s.value}
                </p>
                {s.delta !== null && (
                  <p style={{ fontSize: 11, color: deltaColor, marginTop: 4, fontWeight: 600 }}>
                    {s.delta > 0 ? "↑" : "↓"} {Math.abs(s.delta)}{typeof s.delta === "number" && !s.deltaInvert ? "%" : ""} vs vorige periode
                  </p>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
