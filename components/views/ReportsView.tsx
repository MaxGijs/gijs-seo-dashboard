"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarRange, FileText, RotateCcw } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { dateLong, dateShort, num } from "@/lib/format"
import { Alert, EmptyState, Skeleton } from "@/components/ui"

export interface ReportSummary {
  headline: string; conclusion: string
  range?: { start: string; end: string }; compareRange?: { start: string; end: string } | null
  metrics: { label: string; value: number | null; prev: number | null }[]
  changes: string[]; done: string[]; started: string[]; results: string[]; stalled: string[]; next: string[]; learned: string[]; warnings: string[]
  by?: string
}
export interface Report { week_end: string; week_start: string; created_at: string; summary: ReportSummary }

const SECTIONS: { key: keyof ReportSummary; title: string; empty: string }[] = [
  { key: "changes", title: "Belangrijkste veranderingen", empty: "Geen opvallende verschuivingen." },
  { key: "done", title: "Uitgevoerd", empty: "Deze week niets als uitgevoerd gemarkeerd." },
  { key: "started", title: "Metingen gestart", empty: "Geen nieuwe metingen." },
  { key: "results", title: "Eerste resultaten", empty: "Nog geen meetmomenten deze week." },
  { key: "stalled", title: "Loopt vast", empty: "Niets blijft liggen." },
  { key: "next", title: "Kansen voor volgende week", empty: "Geen nieuwe kansen." },
  { key: "learned", title: "Wat het systeem deze week leerde", empty: "Geen nieuwe lessen." },
]

export default function ReportsView() {
  const { toast } = useWorkspace()
  const [rows, setRows] = useState<Report[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/reports", { cache: "no-store" })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows(j.rows); setSel(s => s || j.rows[0]?.week_end || null); setErr(null)
    } catch (e: any) { setErr(e.message); setRows([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const make = async () => {
    setBusy(true)
    try {
      const r = await fetch("/api/reports", { method: "POST" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      toast("Rapport van deze week gemaakt"); setSel(j.week_end); await load()
    } catch (e: any) { toast(e.message, "error") } finally { setBusy(false) }
  }

  const report = rows?.find(r => r.week_end === sel) || null
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Vrijdagrapport</h1>
          <p className="page-sub">Elke vrijdagmiddag automatisch vastgelegd, ook als er weinig verandert. Zo zie je hoe de website zich week na week ontwikkelt.</p>
        </div>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={make}><RotateCcw className={busy ? "spin" : ""} aria-hidden />{busy ? "Bezig…" : "Rapport van deze week nu maken"}</button>
      </div>
      {err && <Alert tone="error" title="Rapporten konden niet worden geladen">{err}</Alert>}
      {!rows ? <Skeleton height={200} /> : rows.length === 0 ? (
        <div className="card"><EmptyState icon={<FileText />} title="Nog geen rapporten" text="Het eerste rapport verschijnt vrijdagmiddag. Je kunt er nu ook alvast één laten maken." action={<button className="btn btn-primary btn-sm" disabled={busy} onClick={make}>Nu maken</button>} /></div>
      ) : (
        <div className="report-layout">
          <nav className="card report-weeks" aria-label="Weken">
            {rows.map(r => (
              <button key={r.week_end} className={`report-week${r.week_end === sel ? " is-active" : ""}`} onClick={() => setSel(r.week_end)}>
                <b>Week t/m {dateShort(r.week_end)}</b><span className="truncate">{r.summary.headline}</span>
              </button>
            ))}
          </nav>
          {report && <ReportBody r={report} />}
        </div>
      )}
    </>
  )
}

export function ReportBody({ r, compact = false }: { r: Report; compact?: boolean }) {
  const s = r.summary
  return (
    <article className="card report-body">
      <div className="card-head"><div>
        <h2 className="card-title"><CalendarRange aria-hidden />{s.headline}{r.created_at.slice(0, 10) < r.week_end ? <span className="badge tone-neutral" style={{ marginLeft: 6 }}>Tussenstand</span> : null}</h2>
        <p className="card-sub">{dateLong(r.week_start)} t/m {dateLong(r.week_end)}{s.range ? ` · cijfers ${dateShort(s.range.start)} – ${dateShort(s.range.end)}` : ""} · gemaakt {dateShort(r.created_at)}{s.by && s.by !== "systeem" ? ` door ${s.by}` : ""}</p>
      </div></div>
      <div className="card-body">
        <p className="report-lead">{s.conclusion}</p>
        <div className="report-metrics">
          {s.metrics.map(m => (
            <div key={m.label} className="report-metric">
              <span className="report-metric-label">{m.label}</span>
              <span className="report-metric-value">{m.value === null ? "—" : num(m.value)}</span>
              {m.value !== null && m.prev !== null && <span className={m.value > m.prev ? "txt-up" : m.value < m.prev ? "txt-down" : "subtle"}>{m.value - m.prev > 0 ? "+" : m.value - m.prev < 0 ? "−" : "±"}{num(Math.abs(m.value - m.prev))}</span>}
            </div>
          ))}
        </div>
        {s.warnings?.length ? <Alert tone="warning" title="Aandachtspunten">{s.warnings.join(" ")}</Alert> : null}
        {!compact && SECTIONS.map(sec => {
          const items = (s[sec.key] as string[]) || []
          return (
            <section key={sec.key} className="report-sec">
              <h3>{sec.title}</h3>
              {items.length ? <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="muted small">{sec.empty}</p>}
            </section>
          )
        })}
      </div>
    </article>
  )
}
