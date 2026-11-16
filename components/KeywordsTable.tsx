"use client"

interface Row { keys: string[]; clicks: number; impressions: number; position: number; ctr: number }

export default function KeywordsTable({ rows, loading }: { rows: Row[]; loading: boolean }) {
  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ height: 32, background: "var(--grey-100)", borderRadius: 6, animation: "pulse 1.5s infinite" }} />
      ))}
    </div>
  )
  if (!rows.length) return <p style={{ fontSize: 13, color: "var(--muted)" }}>Geen data beschikbaar</p>

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr>
          {["Zoekwoord", "Clicks", "Imp.", "Pos."].map((h, i) => (
            <th key={h} style={{
              textAlign: i === 0 ? "left" : "right", paddingBottom: 10,
              fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
              color: "var(--muted)", borderBottom: "1px solid var(--border)"
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={{ padding: "9px 0", borderBottom: "1px solid var(--grey-100)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, color: "var(--grey-800)" }} title={r.keys[0]}>
              {r.keys[0]}
            </td>
            <td style={{ padding: "9px 0", borderBottom: "1px solid var(--grey-100)", textAlign: "right", fontWeight: 600, color: "var(--accent-600)", fontVariantNumeric: "tabular-nums" }}>{r.clicks}</td>
            <td style={{ padding: "9px 0", borderBottom: "1px solid var(--grey-100)", textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{r.impressions}</td>
            <td style={{ padding: "9px 0", borderBottom: "1px solid var(--grey-100)", textAlign: "right", fontWeight: 600, color: "var(--green-700)", fontVariantNumeric: "tabular-nums" }}>{r.position.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
