"use client"

// Laadsnelheid van echte Chrome-bezoekers per week (CrUX History), voor de hele site.
// Drie kleine grafieken (laden, reageren, verspringen), elk met de grens van Google.

import { useEffect, useMemo, useState } from "react"
import { Activity, RotateCcw } from "lucide-react"
import { CRUX_LIMITS, cruxStatus, type CruxMetric, type CruxPoint } from "@/lib/crux"
import { dateShort } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"
import { Skeleton } from "@/components/ui"

const META: Record<CruxMetric, { label: string; what: string; fmt: (v: number) => string }> = {
  lcp_ms: { label: "Laden (LCP)", what: "tot het grootste element zichtbaar is", fmt: v => `${(v / 1000).toFixed(1).replace(".", ",")} s` },
  inp_ms: { label: "Reageren (INP)", what: "tot de pagina reageert op een klik", fmt: v => `${Math.round(v)} ms` },
  cls: { label: "Verspringen (CLS)", what: "hoeveel de pagina verspringt", fmt: v => v.toFixed(2).replace(".", ",") },
}
const STATUS_LABEL: Record<string, string> = { goed: "goed", verbeteren: "matig", slecht: "slecht" }

function Mini({ metric, pts }: { metric: CruxMetric; pts: CruxPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const vals = pts.map(p => p[metric])
  const known = vals.filter((v): v is number => v !== null)
  if (!known.length) return null
  const W = 300, H = 92, P = { l: 4, r: 4, t: 10, b: 16 }
  const limit = CRUX_LIMITS[metric][0]
  const max = Math.max(limit * 1.25, ...known) * 1.05
  const x = (i: number) => P.l + (i / Math.max(1, pts.length - 1)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b)
  const path = vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" L ")
  const lastIdx = vals.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0).pop()!
  const shown = hover ?? lastIdx
  const sv = vals[shown]
  const st = cruxStatus(metric, sv)
  return (
    <figure className="crux-mini">
      <figcaption>
        <span className="crux-label">{META[metric].label}</span>
        <span className="crux-value">{sv === null ? "—" : META[metric].fmt(sv)}{st && <span className={`badge badge-dot tone-${st === "goed" ? "success" : st === "slecht" ? "error" : "warning"}`}>{STATUS_LABEL[st]}</span>}</span>
        <span className="subtle crux-when">{hover === null ? "laatste 28 dagen t/m " : "28 dagen t/m "}{dateShort(pts[shown].period_end)} · grens goed ≤ {META[metric].fmt(limit)} (stippellijn)</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${META[metric].label} per week, laatste waarde ${sv === null ? "onbekend" : META[metric].fmt(sv)}; grens voor goed ${META[metric].fmt(limit)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * (pts.length - 1)); setHover(Math.max(0, Math.min(pts.length - 1, i))) }}>
        <line x1={P.l} x2={W - P.r} y1={y(limit)} y2={y(limit)} className="crux-limit" />
        <path d={`M ${path}`} className="crux-line" />
        {hover !== null && sv !== null && <><line x1={x(shown)} x2={x(shown)} y1={P.t} y2={H - P.b} className="crux-cross" /><circle cx={x(shown)} cy={y(sv)} r={4} className="crux-dot" /></>}
        {hover === null && sv !== null && <circle cx={x(shown)} cy={y(sv)} r={4} className="crux-dot" />}
        <text x={P.l} y={H - 3} className="crux-axis">{dateShort(pts[0].period_end)}</text>
        <text x={W - P.r} y={H - 3} textAnchor="end" className="crux-axis">{dateShort(pts[pts.length - 1].period_end)}</text>
      </svg>
      <p className="subtle crux-what">Tijd {META[metric].what}; 3 op de 4 bezoekers zitten hieronder.</p>
    </figure>
  )
}

export default function CruxTrend() {
  const { toast } = useWorkspace()
  const [d, setD] = useState<{ configured: boolean; points: CruxPoint[] } | null>(null)
  const [ff, setFf] = useState<"PHONE" | "DESKTOP">("PHONE")
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetch("/api/crux").then(r => (r.ok ? r.json() : null)).then(setD).catch(() => setD({ configured: false, points: [] })) }, [])
  const pts = useMemo(() => (d?.points || []).filter(p => p.form_factor === ff), [d, ff])
  const refresh = async () => {
    setBusy(true)
    try {
      const r = await fetch("/api/crux", { method: "POST" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setD({ configured: true, points: j.points || [] }); toast(j.overgeslagen || "Snelheid van echte bezoekers opgehaald")
    } catch (e: any) { toast(`Ophalen mislukt: ${e.message}`, "error") } finally { setBusy(false) }
  }
  return (
    <section className="card crux-card" aria-labelledby="crux-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="crux-title"><Activity aria-hidden />Snelheid van echte bezoekers, per week</h2>
          <p className="card-sub">Hele site, uit het Chrome-gebruikersrapport van Google (CrUX). Elke week een nieuw punt over de 28 dagen daarvoor. Een sprong omhoog na een deploy is een verstoring voor lopende metingen.</p>
        </div>
        <div className="crux-actions">
          <div className="seg" role="group" aria-label="Apparaat">
            <button type="button" className={ff === "PHONE" ? "is-active" : ""} aria-pressed={ff === "PHONE"} onClick={() => setFf("PHONE")}>Mobiel</button>
            <button type="button" className={ff === "DESKTOP" ? "is-active" : ""} aria-pressed={ff === "DESKTOP"} onClick={() => setFf("DESKTOP")}>Desktop</button>
          </div>
          <button className="icon-btn" onClick={refresh} disabled={busy} aria-label="Nu ophalen" title="Nu ophalen"><RotateCcw className={busy ? "spin" : ""} /></button>
        </div>
      </div>
      <div className="card-body">
        {!d ? <Skeleton height={120} /> : !d.configured ? (
          <p className="muted small">Nog niet gekoppeld: zet in Google Cloud de &quot;Chrome UX Report API&quot; aan voor de API-sleutel (of maak een sleutel CRUX_API_KEY).</p>
        ) : !pts.length ? (
          <p className="muted small">Nog geen weekcijfers. Ze worden elke week automatisch opgehaald; met de knop rechtsboven kan het nu.</p>
        ) : (
          <>
            <div className="crux-grid">{(["lcp_ms", "inp_ms", "cls"] as CruxMetric[]).map(m => <Mini key={m} metric={m} pts={pts} />)}</div>
            <details className="crux-table">
              <summary>Als tabel</summary>
              <div className="table-wrap"><table className="table small">
                <thead><tr><th>28 dagen t/m</th><th className="num">Laden</th><th className="num">Reageren</th><th className="num">Verspringen</th></tr></thead>
                <tbody>{[...pts].reverse().map(p => <tr key={p.period_end}><td>{dateShort(p.period_end)}</td><td className="num">{p.lcp_ms === null ? "—" : META.lcp_ms.fmt(p.lcp_ms)}</td><td className="num">{p.inp_ms === null ? "—" : META.inp_ms.fmt(p.inp_ms)}</td><td className="num">{p.cls === null ? "—" : META.cls.fmt(p.cls)}</td></tr>)}</tbody>
              </table></div>
            </details>
          </>
        )}
      </div>
    </section>
  )
}
