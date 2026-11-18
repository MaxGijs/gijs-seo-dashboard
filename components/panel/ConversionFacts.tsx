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
      <table className="ptable kpi-table">
        <thead><tr><th>Meting</th><th className="num">Laatste 28 d</th><th className="num">28 d ervoor</th></tr></thead>
        <tbody>
          <tr><th scope="row">Sessies</th><td className="num kpi-val">{num(d.cur.sessions)}</td><td className="num">{num(d.prev.sessions)}</td></tr>
          <tr><th scope="row">Energiescanaanvragen</th><td className="num kpi-val">{d.cur.requests === null ? "—" : num(d.cur.requests)}</td><td className="num">{d.prev.requests === null ? "—" : num(d.prev.requests)}</td></tr>
          <tr><th scope="row">Conversie</th><td className="num kpi-val">{d.cur.rate === null ? "—" : pct(d.cur.rate, 2)}</td><td className="num">{d.prev.rate === null ? "—" : pct(d.prev.rate, 2)}</td></tr>
        </tbody>
      </table>
      <p className="scope-line"><span>{d.page ? `Bezoekers die binnenkwamen via ${d.page}` : "Hele site"} · laatste 28 dagen · GA4{d.measurement.used.length ? ` · aanvragen = sessies met ${d.measurement.used.join(" of ")}` : ""}</span></p>
      {d.measurement.status !== "ok" && <Alert tone="warning" title="De meting van aanvragen klopt nog niet">{d.measurement.note} Tot die is opgelost geeft de meting van deze taak geen oordeel; zie de controletaak in Vandaag.</Alert>}
    </>
  )
}
