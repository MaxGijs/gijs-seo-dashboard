"use client"

const colorMap: Record<string, string> = {
  blue: "text-blue-400",
  purple: "text-purple-400",
  green: "text-green-400",
  orange: "text-orange-400",
}

interface Stat {
  label: string
  value: string | number
  color: string
}

export default function StatsRow({ stats, loading }: { stats: Stat[]; loading: boolean }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <p className="text-gray-400 text-sm">{s.label}</p>
          {loading ? (
            <div className="h-8 w-24 bg-gray-800 rounded animate-pulse mt-1" />
          ) : (
            <p className={`text-2xl font-bold mt-1 ${colorMap[s.color]}`}>{s.value}</p>
          )}
        </div>
      ))}
    </div>
  )
}
