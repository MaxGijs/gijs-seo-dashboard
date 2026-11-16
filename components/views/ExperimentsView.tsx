"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { CalendarClock, FlaskConical } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import type { Experiment } from "@/lib/types"
import { addDays, dateLong, dateShort, num, pct, pos } from "@/lib/format"
import { Badge, EmptyState, KindLabel, Skeleton } from "@/components/ui"

type Filter = "alle" | "lopend" | "succesvol" | "niet_succesvol" | "onduidelijk"

function outcomeBadge(e: Experiment) {
  if (!e.outcome) return <Badge tone="accent" dot>Wordt gemeten</Badge>
  if (e.outcome === "succesvol") return <Badge tone="success" dot>Succesvol</Badge>
  if (e.outcome === "niet_succesvol") return <Badge tone="error" dot>Niet succesvol</Badge>
  return <Badge tone="neutral" dot>Geen duidelijk effect</Badge>
}

function Delta({ base, value, metric }: { base: number | null | undefined; value: number | null | undefined; metric: "position" | "ctr" }) {
  if (typeof base !== "number" || typeof value !== "number") return null
  if (metric === "position") {
    const d = base - value
    if (Math.abs(d) < 0.1) return <span className="delta-flat">gelijk</span>
    return <span className={d > 0 ? "delta-up" : "delta-down"}>{d > 0 ? "▲" : "▼"} {num(Math.abs(d), 1)}</span>
  }
  const d = (value - base) * 100
  if (Math.abs(d) < 0.05) return <span className="delta-flat">gelijk</span>
  return <span className={d > 0 ? "delta-up" : "delta-down"}>{d > 0 ? "+" : "−"}{num(Math.abs(d), 1)} pp</span>
}

export default function ExperimentsView() {
  const { loading, experiments, tasks, openTask } = useWorkspace()
  const [filter, setFilter] = useState<Filter>("alle")
  const byKey = useMemo(() => new Map(tasks.map(t => [t.key, t])), [tasks])

  const counts = useMemo(() => ({
    alle: experiments.length,
    lopend: experiments.filter(e => !e.outcome).length,
    succesvol: experiments.filter(e => e.outcome === "succesvol").length,
    niet_succesvol: experiments.filter(e => e.outcome === "niet_succesvol").length,
    onduidelijk: experiments.filter(e => e.outcome === "onduidelijk").length,
  }), [experiments])

  const list = experiments.filter(e => filter === "alle" || (filter === "lopend" ? !e.outcome : e.outcome === filter))
  const FILTERS: { id: Filter; label: string }[] = [
    { id: "alle", label: "Alle" }, { id: "lopend", label: "Lopend" }, { id: "succesvol", label: "Succesvol" },
    { id: "niet_succesvol", label: "Niet succesvol" }, { id: "onduidelijk", label: "Geen duidelijk effect" },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Experimenten</h1>
          <p className="page-sub">Wat je hebt aangepast en wat het opleverde. Het dashboard meet automatisch na 14, 28 en 56 dagen.</p>
        </div>
      </div>

      {loading ? (
        <div className="exp-list">{[0, 1].map(i => <div key={i} className="card card-pad"><Skeleton height={20} width="35%" /><div style={{ height: 12 }} /><Skeleton height={56} /></div>)}</div>
      ) : experiments.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FlaskConical />}
            title="Nog geen experimenten"
            text="Een experiment start zodra je in het zijpaneel een taak als uitgevoerd markeert. Dan wordt de nulmeting vastgelegd en meet het dashboard na 14, 28 en 56 dagen opnieuw. Zo zie je welke aanpassingen echt werken."
            action={<Link href="/taken" className="btn btn-secondary btn-sm">Naar Mijn taken</Link>}
          />
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-left" role="group" aria-label="Filter op resultaat">
              {FILTERS.filter(f => f.id === "alle" || counts[f.id] > 0).map(f => (
                <button key={f.id} className={`chip${filter === f.id ? " is-active" : ""}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
                  {f.label}<span className="chip-count">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="exp-list">
            {list.map(e => {
              const task = byKey.get(e.advice_key)
              const base = e.baseline || {}
              const metric: "position" | "ctr" = base.successMetric === "ctr" ? "ctr" : "position"
              // Technisch, indexering en samenvoegen worden niet op positie gemeten
              const other = ["technisch", "indexering", "consolidatie", "geen"].includes(base.successMetric)
              const pair = !!(e.query && e.page && base.targetPage)
              const basePos = pair ? (base.pairPosition ?? null) : base.position ?? base.positionNow
              const baseText = base.successMetric === "technisch" ? `${num(base.count ?? base.paths?.length)} fout`
                : base.successMetric === "indexering" ? `${num(base.paths?.length ?? 1)} niet geïndexeerd`
                : base.successMetric === "consolidatie" ? `${num((base.pages || []).reduce((a: number, p: any) => a + (p.impressions || 0), 0))} vert.`
                : "—"
              const subject = task ? (task.signal.query ? `"${task.signal.query}"` : task.signal.headline) : e.query ? `"${e.query}"` : e.page || e.advice_key
              const ms: { label: string; days: number; d: Record<string, any> | null }[] = [
                { label: "Na 14 dagen", days: 14, d: e.result_14d }, { label: "Na 28 dagen", days: 28, d: e.result_28d }, { label: "Na 56 dagen", days: 56, d: e.result_56d },
              ]
              return (
                <button key={e.id} className="card exp-card interactive" onClick={() => task && openTask(task.key)} disabled={!task} aria-label={`Open advies ${subject}`}>
                  <div style={{ minWidth: 0 }}>
                    <div className="meta-line" style={{ marginBottom: 6 }}>
                      {task && <KindLabel signal={task.signal} />}
                      {outcomeBadge(e)}
                    </div>
                    <p className="exp-title">{subject}</p>
                    <p className="exp-desc">{e.description}</p>
                    <p className="meta-line" style={{ marginTop: 8 }}><CalendarClock aria-hidden />Aangepast op {dateLong(e.changed_at)} · gemeten op {other ? ({ technisch: "HTTP-status en sitemap", indexering: "indexeringsstatus", consolidatie: "doorverwijzing en vertoningen", geen: "niets" } as Record<string, string>)[base.successMetric] : metric === "ctr" ? "doorklik" : pair ? `positie van ${e.page}` : "positie"}</p>
                  </div>
                  <div className="exp-measures">
                    <div className="measure">
                      <p className="measure-label">Nulmeting</p>
                      <p className="measure-value">{other ? baseText : metric === "ctr" ? pct(base.ctr) : basePos === null && pair ? "niet zichtbaar" : `pos. ${pos(basePos)}`}</p>
                      <p className="measure-sub">{other ? "bij uitvoeren" : `${num(base.clicks)} clicks / 28 d`}</p>
                    </div>
                    {ms.map(m => m.d ? (
                      <div className="measure" key={m.label}>
                        <p className="measure-label">{m.label}</p>
                        <p className="measure-value">{other ? (m.d.summary?.split(" · ")[0] ?? "gemeten") : metric === "ctr" ? pct(m.d.ctr) : `pos. ${pos(m.d.position)}`}</p>
                        {other ? <p className="measure-sub">{m.d.summary?.split(" · ").slice(1).join(" · ")}</p> : <p className="measure-sub"><Delta base={metric === "ctr" ? base.ctr : basePos} value={metric === "ctr" ? m.d.ctr : m.d.position} metric={metric} /> · {num(m.d.clicks)} clicks / {m.d.sampleDays ?? 7} d</p>}
                      </div>
                    ) : (
                      <div className="measure is-pending" key={m.label}>
                        <p className="measure-label">{m.label}</p>
                        <p className="measure-value subtle">—</p>
                        <p className="measure-sub">{dateShort(addDays(e.changed_at, m.days))}</p>
                      </div>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
