"use client"

// Context bij een meting: werd de hele site rond de live-datum merkbaar trager (echte bezoekers, CrUX)?
// Dan kan een daling ook daaraan liggen. Alleen een melding, geen oordeel; toont niets als er niets speelt.

import { useEffect, useState } from "react"
import { Gauge } from "lucide-react"
import { speedAround, type CruxMetric, type CruxPoint } from "@/lib/crux"
import { dateShort } from "@/lib/format"

let cache: Promise<CruxPoint[]> | null = null
const load = () => (cache ||= fetch("/api/crux").then(r => (r.ok ? r.json() : { points: [] })).then(j => j.points || []).catch(() => []))
const LABEL: Record<CruxMetric, string> = { lcp_ms: "laden", inp_ms: "reageren", cls: "verspringen" }
const fmt = (k: CruxMetric, v: number) => (k === "lcp_ms" ? `${(v / 1000).toFixed(1).replace(".", ",")} s` : k === "inp_ms" ? `${Math.round(v)} ms` : v.toFixed(2).replace(".", ","))

export default function SpeedAround({ date }: { date: string }) {
  const [pts, setPts] = useState<CruxPoint[] | null>(null)
  useEffect(() => { load().then(setPts) }, [])
  if (!pts) return null
  const a = speedAround(pts, date)
  if (!a || !a.worse.length) return null
  return (
    <p className="speed-around"><Gauge aria-hidden />
      Rond de live-datum werd de site trager voor echte bezoekers op mobiel: {a.worse.map(w => `${LABEL[w.metric]} ${fmt(w.metric, w.from)} → ${fmt(w.metric, w.to)}`).join(", ")} (28 dagen t/m {dateShort(a.before.period_end)} tegenover t/m {dateShort(a.after.period_end)}). Houd daar rekening mee bij het oordeel.
    </p>
  )
}
