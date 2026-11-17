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

function ExpOutcome({ e }: { e: Experiment }) {
  const last = e.result_56d || e.result_28d || e.result_14d
  const pred = e.predicted?.gain ?? e.baseline?.predictedGain
  const lines: string[] = []
  if (typeof pred === "number") lines.push(`Voorspeld: ${pred >= 1 ? `+${num(e.predicted?.low ?? Math.floor(pred * 0.6))}–${num(e.predicted?.high ?? Math.ceil(pred * 1.3))}` : "< 1"} clicks / 28 d`)
  if (last && typeof last.actualGain === "number") {
    lines.push(`Werkelijk tot nu: ${last.actualGain >= 0 ? "+" : ""}${num(last.actualGain, 1)} clicks / 28 d${typeof last.actualGainCorrected === "number" && last.actualGainCorrected !== last.actualGain ? ` (gecorrigeerd voor sitebrede groei: ${last.actualGainCorrected >= 0 ? "+" : ""}${num(last.actualGainCorrected, 1)})` : ""}`)
  }
  const conf: string[] = last?.confounders || []
  if (!lines.length && !conf.length && !last?.evidence) return null
  return (
    <div className="exp-outcome">
      {lines.map(l => <p key={l}>{l}</p>)}
      {conf.length > 0 && <p className="exp-conf">Let op: {conf.join("; ")}.</p>}
      {last?.evidence && <Badge tone={last.evidence === "telt mee" ? "success" : "neutral"}>{last.evidence === "telt mee" ? "Telt als leerbewijs" : "Te weinig data om van te leren"}</Badge>}
    </div>
  )
}

const TYPE_LABEL: Record<string, string> = {
  technisch: "Technische reparatie", indexering: "Indexering", consolidatie: "Samenvoegen", snippet: "Title en description",
  ranking: "Positie (links en inhoud)", merk: "Controle", geen: "Geen aanpassing", handmatig: "Eigen taak", conversie: "Meer aanvragen", controle: "Controletaak",
}

// Wat heeft Gijs geleerd? Per soort aanpassing: hoeveel experimenten, hoeveel succesvol, voorspeld vs werkelijk
function Learned({ experiments }: { experiments: Experiment[] }) {
  const groups = new Map<string, Experiment[]>()
  for (const e of experiments) {
    const t = e.baseline?.actionType || (e.baseline?.successMetric === "ctr" ? "snippet" : "ranking")
    groups.set(t, [...(groups.get(t) || []), e])
  }
  const rows = [...groups.entries()].map(([type, list]) => {
    const done = list.filter(e => e.outcome && e.result_56d?.evidence !== "te weinig data")
    const ok = done.filter(e => e.outcome === "succesvol").length
    const withGain = done.filter(e => typeof e.result_56d?.actualGainCorrected === "number" && typeof (e.predicted?.gain ?? e.baseline?.predictedGain) === "number")
    const pred = withGain.reduce((a, e) => a + (e.predicted?.gain ?? e.baseline?.predictedGain), 0)
    const act = withGain.reduce((a, e) => a + e.result_56d!.actualGainCorrected, 0)
    return { type, total: list.length, running: list.filter(e => !e.outcome).length, done: done.length, ok, withGain: withGain.length, pred, act }
  })
  const anyDone = rows.some(r => r.done > 0)
  return (
    <section className="card learned" aria-labelledby="learned-title">
      <div className="card-head"><h2 className="card-title" id="learned-title">Wat heeft Gijs geleerd?</h2></div>
      {!anyDone ? (
        <p className="muted learned-empty">Nog geen afgeronde experimenten met genoeg data. Na de eindmeting (56 dagen) zie je hier per soort aanpassing hoe vaak het werkte en hoe de voorspelling uitpakte. Nieuwe adviezen verwijzen dan naar deze uitkomsten.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Soort aanpassing</th><th className="num">Experimenten</th><th className="num">Afgerond (telt mee)</th><th className="num">Succesvol</th><th>Voorspeld vs werkelijk</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.type}>
                <td>{TYPE_LABEL[r.type] || r.type}</td>
                <td className="num">{r.total}{r.running ? <span className="subtle"> ({r.running} lopend)</span> : null}</td>
                <td className="num">{r.done}</td>
                <td className="num">{r.done ? `${r.ok} (${Math.round((r.ok / r.done) * 100)}%)` : "—"}</td>
                <td>{r.withGain ? `${num(r.pred, 1)} voorspeld, ${num(r.act, 1)} werkelijk (gecorrigeerd), over ${r.withGain}` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
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
          <Learned experiments={experiments} />
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
              const other = ["technisch", "indexering", "consolidatie", "geen", "conversie", "controle"].includes(base.successMetric)
              const pair = !!(e.query && e.page && base.targetPage)
              const basePos = pair ? (base.pairPosition ?? null) : base.position ?? base.positionNow
              const baseText = base.successMetric === "technisch" ? `${num(base.count ?? base.paths?.length)} fout`
                : base.successMetric === "indexering" ? `${num(base.paths?.length ?? 1)} niet geïndexeerd`
                : base.successMetric === "consolidatie" ? `${num((base.pages || []).reduce((a: number, p: any) => a + (p.impressions || 0), 0))} vert.`
                : base.successMetric === "conversie" ? "28 d ervoor"
                : base.successMetric === "controle" ? "probleem open"
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
                    {e.hypothesis && <p className="exp-hyp"><b>Hypothese:</b> {e.hypothesis}</p>}
                    <ExpOutcome e={e} />
                    <p className="meta-line" style={{ marginTop: 8 }}><CalendarClock aria-hidden />Aangepast op {dateLong(e.changed_at)} · gemeten op {other ? ({ technisch: "HTTP-status en sitemap", indexering: "indexeringsstatus", consolidatie: "doorverwijzing en vertoningen", geen: "niets", conversie: "energiescanaanvragen (GA4)", controle: "of het probleem weg is" } as Record<string, string>)[base.successMetric] : metric === "ctr" ? "doorklik" : pair ? `positie van ${e.page}` : "positie"}</p>
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
