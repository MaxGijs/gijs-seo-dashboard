"use client"

import { useCallback, useEffect, useState } from "react"
import { BellRing, CheckCircle2, Gauge, RotateCcw } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { dateShort } from "@/lib/format"
import { cwvProblems, CWV_LIMITS, type CwvRow } from "@/lib/cwv"
import type { AlertRow } from "@/lib/server/alerts"
import { Skeleton } from "@/components/ui"

interface Data { alerts: AlertRow[]; cwv: CwvRow[]; keyConfigured: boolean }

export function useAlerts() {
  const { reloadTick } = useWorkspace()
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    fetch("/api/alerts", { cache: "no-store" }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setD(j); setErr(null) }).catch(e => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load, reloadTick])
  return { d, err, load, setD }
}

// Meldingen bovenaan het dashboard: alleen zichtbaar als er iets open staat
const fmtS = (ms: number | null | undefined) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`)
const tone = (v: number | null | undefined, [good, bad]: readonly [number, number]) => v === null || v === undefined ? "" : v <= good ? "txt-up" : v > bad ? "txt-down" : "txt-warn"

// Laadsnelheid op mobiel van de belangrijkste pagina's
export function CwvBlock() {
  const { d, err, setD } = useAlerts()
  const { toast } = useWorkspace()
  const [busy, setBusy] = useState<string | null>(null)
  const rows = [...(d?.cwv || [])].sort((a, b) => ({ slecht: 0, verbeteren: 1, goed: 2 } as Record<string, number>)[a.status || "goed"] - ({ slecht: 0, verbeteren: 1, goed: 2 } as Record<string, number>)[b.status || "goed"])
  const measure = async (path: string) => {
    setBusy(path)
    try {
      const r = await fetch("/api/cwv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setD(x => x && { ...x, cwv: [j.row, ...x.cwv.filter(c => c.path !== path)] }); toast(`${path} gemeten`)
    } catch (e: any) { toast(`Meten mislukt: ${e.message}`, "error") } finally { setBusy(null) }
  }
  const counts = { goed: rows.filter(r => r.status === "goed").length, verbeteren: rows.filter(r => r.status === "verbeteren").length, slecht: rows.filter(r => r.status === "slecht").length }
  return (
    <section className="card dash-cwv" aria-labelledby="cwv-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="cwv-title"><Gauge aria-hidden />Laadsnelheid op mobiel</h2>
          <p className="card-sub">Core Web Vitals van de belangrijkste pagina&apos;s, via Google PageSpeed. Google weegt dit mee in de posities. Elke ochtend worden een paar pagina&apos;s opnieuw gemeten.</p>
        </div>
        {rows.length > 0 && <div className="cwv-summary"><span className="txt-up">{counts.goed} goed</span><span className="txt-warn">{counts.verbeteren} matig</span><span className="txt-down">{counts.slecht} slecht</span></div>}
      </div>
      <div className="card-body">
        {err ? <p className="muted small">{err}</p> : !d ? <Skeleton height={120} /> : rows.length === 0 ? (
          <div className="stack">
            <p className="muted small">Nog geen metingen. De eerste pagina&apos;s worden morgenochtend gemeten.</p>
            <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => measure("/")}><RotateCcw className={busy ? "spin" : ""} aria-hidden />{busy ? "Bezig (± 20 s)…" : "Homepage nu meten"}</button>
          </div>
        ) : (
          <div className="table-wrap"><table className="table small cwv-table">
            <thead><tr><th>Pagina</th><th>Oordeel</th><th className="num" title={`Grootste element zichtbaar. Goed ≤ ${CWV_LIMITS.lcp[0] / 1000} s`}>Laden</th><th className="num" title="Verspringen tijdens laden. Goed ≤ 0,1">Verspringen</th><th className="num" title="Score van PageSpeed (0–100)">Score</th><th>Gemeten</th><th /></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.path}>
                <td className="cell-main"><span className="truncate" style={{ display: "block", maxWidth: 260 }}>{r.path}</span>{r.error ? <span className="txt-down" style={{ fontSize: 11 }}>{r.error.slice(0, 120)}</span> : r.status !== "goed" && <span className="subtle" style={{ fontSize: 11.5, fontWeight: 400 }}>{cwvProblems(r)[0]}</span>}</td>
                <td>{r.status ? <span className={`badge badge-dot tone-${r.status === "goed" ? "success" : r.status === "slecht" ? "error" : "warning"}`}>{r.status === "verbeteren" ? "matig" : r.status}</span> : "—"}{r.field && !r.field.origin ? <div className="subtle" style={{ fontSize: 10.5, marginTop: 3 }}>echte bezoekers</div> : null}</td>
                <td className={`num ${tone(r.field?.lcp_ms ?? r.lcp_ms, CWV_LIMITS.lcp)}`}>{fmtS(r.field?.lcp_ms ?? r.lcp_ms)}</td>
                <td className={`num ${tone(r.field?.cls ?? r.cls, CWV_LIMITS.cls)}`}>{(r.field?.cls ?? r.cls) === null || (r.field?.cls ?? r.cls) === undefined ? "—" : (r.field?.cls ?? r.cls)!.toFixed(2).replace(".", ",")}</td>
                <td className="num">{r.score ?? "—"}</td>
                <td className="nowrap subtle">{dateShort(r.measured_at)}</td>
                <td><button className="icon-btn" aria-label={`${r.path} opnieuw meten`} disabled={!!busy} onClick={() => measure(r.path)}><RotateCcw className={busy === r.path ? "spin" : ""} /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  )
}
