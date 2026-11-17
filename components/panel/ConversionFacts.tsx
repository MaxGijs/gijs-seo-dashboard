"use client"

import { useEffect, useState } from "react"
import { num, pct } from "@/lib/format"
import { Alert, Skeleton } from "@/components/ui"

interface W { start: string; end: string; sessions: number; requests: number | null; rate: number | null }
interface Data { page: string | null; days: number; measurement: { status: string; used: string[]; note: string }; cur: W; prev: W }

// Huidige stand van sessies en energiescanaanvragen (laatste 28 dagen tegen de 28 ervoor)
export default function ConversionFacts({ page }: { page: string | null }) {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    fetch(`/api/conversion?days=28${page && page !== "/" ? `&page=${encodeURIComponent(page)}` : ""}`, { cache: "no-store" })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); if (!off) setD(j) })
      .catch(e => { if (!off) setErr(e.message) })
    return () => { off = true }
  }, [page])
  if (err) return <Alert tone="warning" title="GA4 kon niet worden gelezen">{err}</Alert>
  if (!d) return <div className="kpis-inline"><Skeleton height={40} width={90} /><Skeleton height={40} width={90} /><Skeleton height={40} width={90} /></div>
  return (
    <>
      <div className="kpis-inline">
        <div className="kpi-inline"><span className="kpi-inline-label">Sessies</span><span className="kpi-inline-value">{num(d.cur.sessions)}</span><span className="kpi-inline-sub">vorige 28 d: {num(d.prev.sessions)}</span></div>
        <div className="kpi-inline"><span className="kpi-inline-label">Energiescanaanvragen</span><span className="kpi-inline-value">{d.cur.requests === null ? "—" : num(d.cur.requests)}</span><span className="kpi-inline-sub">vorige 28 d: {d.prev.requests === null ? "—" : num(d.prev.requests)}</span></div>
        <div className="kpi-inline"><span className="kpi-inline-label">Conversie</span><span className="kpi-inline-value">{d.cur.rate === null ? "—" : pct(d.cur.rate, 2)}</span><span className="kpi-inline-sub">vorige 28 d: {d.prev.rate === null ? "—" : pct(d.prev.rate, 2)}</span></div>
      </div>
      <p className="scope-line"><span>{d.page ? `Bezoekers die binnenkwamen via ${d.page}` : "Hele site"} · laatste 28 dagen · GA4{d.measurement.used.length ? ` · aanvragen = sessies met ${d.measurement.used.join(" of ")}` : ""}</span></p>
      {d.measurement.status !== "ok" && <Alert tone="warning" title="De meting van aanvragen klopt nog niet">{d.measurement.note} Tot die is opgelost geeft de meting van deze taak geen oordeel; zie de controletaak in Vandaag.</Alert>}
    </>
  )
}
