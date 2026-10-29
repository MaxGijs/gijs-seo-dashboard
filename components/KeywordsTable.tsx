"use client"

interface Row {
  keys: string[]
  clicks: number
  impressions: number
  position: number
  ctr: number
}

export default function KeywordsTable({ rows, loading }: { rows: Row[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 bg-gray-800 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (!rows.length) return <p className="text-gray-500 text-sm">Geen data</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-left border-b border-gray-800">
            <th className="pb-2 font-medium">Zoekwoord</th>
            <th className="pb-2 font-medium text-right">Clicks</th>
            <th className="pb-2 font-medium text-right">Imp.</th>
            <th className="pb-2 font-medium text-right">Pos.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="py-2 text-gray-200 truncate max-w-[180px]">{r.keys[0]}</td>
              <td className="py-2 text-right text-blue-400">{r.clicks}</td>
              <td className="py-2 text-right text-gray-400">{r.impressions}</td>
              <td className="py-2 text-right text-green-400">{r.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
