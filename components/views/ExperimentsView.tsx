"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CalendarClock, ChevronRight, FlaskConical, Newspaper } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { useContentIdeas } from "@/lib/content/useContent"
import { ArticleResults } from "@/components/content/ContentPanel"
import type { Experiment } from "@/lib/types"
import { addDays, dateLong, dateShort, num, pct, pos } from "@/lib/format"
import { Badge, EmptyState, KindLabel, PageHeader, Skeleton, type StatusTone } from "@/components/ui"
import AccuracyCard from "@/components/views/AccuracyCard"
import { familyOutcome, goalOf, KIND_META, nextMeasurement, OUTCOME_META, type ExpKind, type Outcome } from "@/lib/experiment"
import type { Task } from "@/lib/types"

const TONE: Record<string, "success" | "error" | "neutral" | "warning" | "info"> = { good: "success", problem: "error", info: "neutral", attention: "warning" }
function outcomeBadge(o: Outcome | null | undefined, running = "Wordt gemeten") {
  if (!o) return <Badge tone="info" dot>{running}</Badge>
  return <Badge tone={TONE[OUTCOME_META[o].tone]} dot>{OUTCOME_META[o].label}</Badge>
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
function Learned({ experiments: all }: { experiments: Experiment[] }) {
  // Alleen echte experimenten; een familie telt als één (eerste meetpunt staat voor de familie)
  const seen = new Set<string>()
  const experiments = all.filter(e => (e.kind || "experiment") === "experiment").filter(e => { const k = e.family_id || e.id; if (seen.has(k)) return false; seen.add(k); return true })
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

// Contentkansen die gepubliceerd zijn (en dus gemeten worden)
function ContentExperiments() {
  const { ideas, error } = useContentIdeas()
  const published = useMemo(() => (ideas || []).filter(i => i.status === "gepubliceerd" && i.published_at)
    .sort((a, b) => (b.published_at! < a.published_at! ? -1 : b.published_at! > a.published_at! ? 1 : 0)), [ideas])

  if (error) return <div className="card card-pad"><p className="muted">Contentkansen konden niet worden geladen: {error}</p></div>
  if (!ideas) return <div className="exp-list">{[0, 1].map(i => <div key={i} className="card card-pad"><Skeleton height={20} width="35%" /><div style={{ height: 12 }} /><Skeleton height={56} /></div>)}</div>
  if (published.length === 0) return (
    <div className="card">
      <EmptyState
        icon={<Newspaper />}
        title="Nog geen gepubliceerde content"
        text="Zodra een artikel of contentkans als gepubliceerd wordt vastgelegd, verschijnt het hier en meet het dashboard automatisch hoe het presteert: een nieuw artikel na 7, 30 en 90 dagen, een bijgewerkte pagina vóór en na de aanpassing (14, 28 en 56 dagen)."
        action={<Link href="/content" className="btn btn-secondary btn-sm">Naar Content</Link>}
      />
    </div>
  )
  return (
    <div className="exp-list">
      {published.map(idea => (
        <div className="card card-pad" key={idea.id}>
          <div className="meta-line" style={{ marginBottom: 6, justifyContent: "space-between" }}>
            <Link href={`/content/${idea.id}?van=experimenten`} className="exp-title" style={{ textDecoration: "none" }}>{idea.title}</Link>
            <span className="meta-line"><CalendarClock aria-hidden />{idea.advice === "bijwerken" ? "Pagina bijgewerkt op" : "Gepubliceerd op"} {dateLong(idea.published_at!)}</span>
          </div>
          <ArticleResults idea={idea} all={ideas} />
        </div>
      ))}
    </div>
  )
}

// ── Overzicht: per soort, families als één rij ─────────────────────────────

interface Unit { id: string; kind: ExpKind; members: Experiment[]; title: string | null }
function unitsOf(experiments: Experiment[]): Unit[] {
  const map = new Map<string, Unit>()
  for (const e of experiments) {
    const id = e.family_id || e.id
    const u = map.get(id) || { id, kind: (e.kind || "experiment") as ExpKind, members: [], title: e.family_id ? e.family_title || e.description : null }
    u.members.push(e)
    map.set(id, u)
  }
  return [...map.values()].sort((a, b) => b.members[0].changed_at.localeCompare(a.members[0].changed_at))
}
const unitOutcome = (u: Unit): Outcome | null => (u.members.length > 1 ? familyOutcome(u.members.map(m => m.outcome as Outcome | null)) : (u.members[0].outcome as Outcome | null))
const unitNext = (u: Unit) => u.members.map(m => nextMeasurement(m as any)).filter(Boolean).sort((a, b) => a!.date.localeCompare(b!.date))[0] || null
const subjectOf = (e: Experiment, task?: Task) => (task ? (task.signal.query ? `"${task.signal.query}"` : task.signal.headline) : e.query ? `"${e.query}"` : e.page || e.advice_key)
// Deel van de taaktitel na het streepje ("… – Hardenberg") als naam van het meetpunt
const pointName = (e: Experiment, task?: Task) => { const t = (task?.signal.headline || "").split(" — ")[0]; const m = t.match(/\s[–-]\s([^–-]+)$/); return m ? m[1].trim() : null }

function Reliability({ u }: { u: Unit }) {
  if (u.kind === "validatie") return <span className="subtle">n.v.t. (controle)</span>
  const failed = [...new Set(u.members.flatMap(m => (m.suitability?.checks || []).filter(c => c.state === "fout").map(c => c.label)))]
  const s = u.members[0].suitability
  if (!s) return <span className="subtle">niet gecontroleerd</span>
  if (!failed.length) return <Badge tone="success">Geschikt</Badge>
  return <span className="exp-rel">{failed.slice(0, 3).map(f => <Badge key={f} tone="warning">{({ "Genoeg data": "Te weinig data", "Pagina oud genoeg": "Pagina te jong", "Zoekwoord en doelpagina kloppen": "Doelpagina klopt niet", "Stabiele nulmeting": "Onrustige nulmeting", "Eén herkenbare verandering": "Overlap", "Resultaat is meetbaar": "Niet meetbaar" } as Record<string, string>)[f] || f}</Badge>)}</span>
}

export default function ExperimentsView() {
  const router = useRouter()
  const params = useSearchParams()
  const tab = params.get("tab") === "content" ? "content" : "seo"
  const kindTab = (["experiment", "meting", "validatie"].includes(params.get("soort") || "") ? params.get("soort") : "experiment") as ExpKind
  const { loading, experiments, tasks, openTask } = useWorkspace()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const byKey = useMemo(() => new Map(tasks.map(t => [t.key, t])), [tasks])
  const units = useMemo(() => unitsOf(experiments), [experiments])
  const byKind = (k: ExpKind) => units.filter(u => u.kind === k)
  const shown = byKind(kindTab)
  const decided = units.filter(u => u.kind === "experiment" && unitOutcome(u) && OUTCOME_META[unitOutcome(u)!].decisive).length
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n })
  const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`
  const famPoints = byKind("meting").concat(byKind("experiment")).filter(u => u.members.length > 1)

  return (
    <>
      <PageHeader title="Experimenten"
        status={loading ? null : !units.length ? { tone: "info", text: "Nog geen metingen. Ze starten zodra je een taak als uitgevoerd markeert." } : {
          tone: "info" as StatusTone,
          text: `${plural(byKind("experiment").length, "experiment", "experimenten")}, ${plural(byKind("meting").length, "meting", "metingen")} zonder oordeel en ${plural(byKind("validatie").length, "validatie", "validaties")}. ${decided ? `${plural(decided, "experiment heeft", "experimenten hebben")} een eindoordeel.` : "Nog geen eindoordeel."}${famPoints.length ? ` ${plural(famPoints.length, "familie telt", "families tellen")} als één experiment.` : ""}`,
        }}
        sub={tab === "content" ? "Gepubliceerde content en wat het oplevert, gemeten tegen het doel en de succesgrens die bij publicatie zijn vastgelegd." : "Experiment = onzekere aanpassing met genoeg data. Meting = volgen zonder oordeel. Validatie = controleren of een technische oplossing werkt."} />

      <div className="seg" role="tablist" aria-label="SEO of content">
        <button role="tab" aria-selected={tab === "seo"} className={tab === "seo" ? "is-active" : ""} onClick={() => router.replace("/experimenten")}>SEO</button>
        <button role="tab" aria-selected={tab === "content"} className={tab === "content" ? "is-active" : ""} onClick={() => router.replace("/experimenten?tab=content")}>Content</button>
      </div>

      {tab === "content" ? <ContentExperiments /> : loading ? (
        <div className="exp-list">{[0, 1].map(i => <div key={i} className="card card-pad"><Skeleton height={20} width="35%" /><div style={{ height: 12 }} /><Skeleton height={56} /></div>)}</div>
      ) : experiments.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FlaskConical />}
            title="Nog geen experimenten"
            text="Een meting start zodra je in het zijpaneel een taak als uitgevoerd markeert. Het dashboard controleert dan of het een zuiver experiment kan zijn, legt de nulmeting vast en meet na 14, 28 en 56 dagen opnieuw."
            action={<Link href="/taken" className="btn btn-secondary btn-sm">Naar Mijn taken</Link>}
          />
        </div>
      ) : (
        <>
          <div className="exp-kinds chips" role="tablist" aria-label="Soort">
            {(["experiment", "meting", "validatie"] as ExpKind[]).map(k => (
              <button key={k} role="tab" aria-selected={kindTab === k} className={`chip${kindTab === k ? " is-active" : ""}`} onClick={() => router.replace(k === "experiment" ? "/experimenten" : `/experimenten?soort=${k}`)}>
                {KIND_META[k].plural}<span className="chip-count">{byKind(k).length}</span>
              </button>
            ))}
          </div>
          <p className="muted small exp-kind-text">{KIND_META[kindTab].text}{kindTab === "validatie" ? " Telt niet mee bij de nauwkeurigheid of bij geleerde SEO-effecten." : kindTab === "meting" ? " Telt niet mee bij de nauwkeurigheid of bij geleerde SEO-effecten; de cijfers blijven zichtbaar." : ""}</p>

          {shown.length === 0 ? <div className="card card-pad"><p className="muted small" style={{ margin: 0 }}>Geen {KIND_META[kindTab].plural.toLowerCase()}.</p></div> : (
            <div className="table-wrap card exp-table">
              <table className="table">
                <thead><tr><th scope="col">Verandering</th><th scope="col">Doel en meetwaarde</th><th scope="col">Betrouwbaarheid</th><th scope="col">Volgende meting</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {shown.map(u => {
                    const e = u.members[0], task = byKey.get(e.advice_key)
                    const g = goalOf(e.baseline?.successMetric)
                    const next = unitNext(u)
                    const isOpen = open.has(u.id)
                    return (
                      <FragmentRow key={u.id}>
                        <tr className={`exp-row${isOpen ? " is-open" : ""}`} data-unit={u.id}>
                          <th scope="row">
                            <button className="exp-toggle" onClick={() => toggle(u.id)} aria-expanded={isOpen} aria-controls={`exp-${u.id}`}>
                              <ChevronRight aria-hidden className="exp-chev" />
                              <span className="exp-main">
                                <b>{u.title || subjectOf(e, task)}</b>
                                <span className="subtle small">{u.members.length > 1 ? `Familie: ${u.members.length} meetpunten, telt als één experiment · ` : ""}aangepast {dateShort(e.changed_at)}</span>
                              </span>
                            </button>
                          </th>
                          <td><span className="exp-goal">{g.goal}</span><span className="subtle small">{g.metric}</span></td>
                          <td><Reliability u={u} /></td>
                          <td className="small">{next ? <>{dateShort(next.date)} <span className="subtle">({next.days} d)</span></> : unitOutcome(u) ? <span className="subtle">afgerond</span> : <span className="subtle">—</span>}</td>
                          <td>{outcomeBadge(unitOutcome(u), u.members.some(m => m.outcome) ? "Deels gemeten" : "Wordt gemeten")}</td>
                        </tr>
                        {isOpen && (
                          <tr className="exp-detail-row" id={`exp-${u.id}`}><td colSpan={5}>
                            {u.members.length > 1 ? (
                              <>
                                <p className="small" style={{ margin: "0 0 8px" }}><b>Wat is aangepast:</b> {e.description}</p>
                                {e.suitability && <p className="small subtle" style={{ margin: "0 0 10px" }}>{e.suitability.summary}</p>}
                                <table className="mini-table exp-points">
                                  <thead><tr><th>Meetpunt</th><th>Zoekwoord en pagina</th><th className="num">Nulmeting</th><th className="num">Laatste meting</th><th>Status</th></tr></thead>
                                  <tbody>{u.members.map(m => { const t = byKey.get(m.advice_key); const last = (m.result_84d || m.result_56d || m.result_28d || m.result_14d) as any; const bp = m.baseline?.targetPage ? m.baseline?.pairPosition : m.baseline?.position; return (
                                    <tr key={m.id}>
                                      <td>{t ? <button className="link-btn" onClick={() => openTask(t.key)}>{pointName(m, t) || subjectOf(m, t)}</button> : pointName(m, t) || subjectOf(m, t)}</td>
                                      <td className="small">{m.query ? `"${m.query}"` : "—"} · {m.baseline?.targetPage || m.page || "—"}</td>
                                      <td className="num">{typeof bp === "number" ? `pos. ${pos(bp)}` : "—"}<span className="subtle small"> · {num(m.baseline?.impressions ?? 0)} vert.</span></td>
                                      <td className="num">{last ? (typeof last.position === "number" ? `pos. ${pos(last.position)}` : last.summary || "gemeten") : <span className="subtle">{(() => { const n = nextMeasurement(m as any); return n ? `op ${dateShort(n.date)}` : "—" })()}</span>}</td>
                                      <td>{outcomeBadge(m.outcome as Outcome | null)}</td>
                                    </tr>
                                  ) })}</tbody>
                                </table>
                                <p className="field-hint">Elk meetpunt houdt zijn eigen zoekwoord, nulmeting, datum en metingen. Bij het leren en de nauwkeurigheid telt de familie als één experiment; verschillen per pagina blijven hier zichtbaar.</p>
                              </>
                            ) : <ExpDetail e={e} task={task} openTask={openTask} />}
                          </td></tr>
                        )}
                      </FragmentRow>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {kindTab === "experiment" && <><AccuracyCard /><Learned experiments={experiments} /></>}
        </>
      )}
    </>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</> }

// Details van één experiment: geschiktheid, hypothese en alle metingen
function ExpDetail({ e, task, openTask }: { e: Experiment; task?: Task; openTask: (k: string) => void }) {
  const base = e.baseline || {}
  const metric: "position" | "ctr" = base.successMetric === "ctr" ? "ctr" : "position"
  const other = ["technisch", "indexering", "consolidatie", "geen", "conversie", "controle"].includes(base.successMetric)
  const pair = !!(e.query && e.page && base.targetPage)
  const basePos = pair ? (base.pairPosition ?? null) : base.position ?? base.positionNow
  const baseText = base.successMetric === "technisch" ? `${num(base.count ?? base.paths?.length)} fout`
    : base.successMetric === "indexering" ? `${num(base.paths?.length ?? 1)} niet geïndexeerd`
    : base.successMetric === "consolidatie" ? `${num((base.pages || []).reduce((a: number, p: any) => a + (p.impressions || 0), 0))} vert.`
    : base.successMetric === "conversie" ? "28 d ervoor"
    : base.successMetric === "controle" ? "probleem open"
    : "—"
  const ms: { label: string; days: number; d: Record<string, any> | null | undefined }[] = [
    { label: "Na 14 dagen", days: 14, d: e.result_14d }, { label: "Na 28 dagen", days: 28, d: e.result_28d }, { label: "Na 56 dagen", days: 56, d: e.result_56d },
    ...(e.result_56d && (e.kind || "experiment") === "experiment" && (e.result_84d || !e.outcome) ? [{ label: "Na 84 dagen (verlengd)", days: 84, d: e.result_84d }] : []),
  ]
  return (
    <div className="exp-detail">
      <div style={{ minWidth: 0 }}>
        <div className="meta-line" style={{ marginBottom: 6 }}>{task && <KindLabel signal={task.signal} />}{task && <button className="link-btn" onClick={() => openTask(task.key)}>Taak openen</button>}</div>
        <p className="exp-desc">{e.description}</p>
        {e.hypothesis && <p className="exp-hyp"><b>Hypothese:</b> {e.hypothesis}</p>}
        {e.suitability && e.suitability.checks.length > 0 && (
          <details className="exp-suit"><summary>Geschiktheidscontrole: {e.suitability.summary}</summary>
            <ul>{e.suitability.checks.map(c => <li key={c.key} data-state={c.state}><b>{c.label}:</b> {c.state === "ok" ? "ja" : c.state === "fout" ? "nee" : "onbekend"}. <span className="subtle">{c.detail}</span></li>)}</ul>
          </details>
        )}
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
            <p className="measure-sub">meetdatum {dateShort(addDays(e.changed_at, m.days))}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
