"use client"

interface Stat {
  label: string
  value: string | number
  accent: string
}

export default function StatsRow({ stats, loading }: { stats: Stat[]; loading: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
      {stats.map((s) => (
        <div key={s.label} style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)", padding: "20px",
          boxShadow: "var(--shadow-1)", position: "relative", overflow: "hidden"
        }}>
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 3,
            background: s.accent
          }} />
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase", margin: "0 0 8px" }}>
            {s.label}
          </p>
          {loading ? (
            <div style={{ height: 32, width: 80, background: "var(--grey-100)", borderRadius: 6, animation: "pulse 1.5s infinite" }} />
          ) : (
            <p style={{ fontSize: 28, fontWeight: 700, color: s.accent, letterSpacing: "-0.03em", margin: 0, fontVariantNumeric: "tabular-nums" }}>
              {s.value}
            </p>
          )}
        </div>
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </div>
  )
}
