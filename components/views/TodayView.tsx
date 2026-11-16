"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, Eye, FlaskConical, Play, ShieldCheck, TrendingUp, ListTodo } from "lucide-react"
import { useTaskGroups, useWorkspace } from "@/lib/workspace"
import type { Experiment, Task } from "@/lib/types"
import { addDays, dateLong, dateShort, gainShort, greeting, num, plural, signedPct, today } from "@/lib/format"
import { Breakable, EmptyState, KindLabel, PriorityMeter, Skeleton, StatusBadge } from "@/components/ui"

function sum(rows: { clicks: number; impressions: number }[], key: "clicks" | "impressions") {
  return rows.reduce((s, r) => s + r[key], 0)
}

function nextMeasurement(e: Experiment) {
  const steps: [number, keyof Experiment][] = [[14, "result_14d"], [28, "result_28d"], [56, "result_56d"]]
  for (const [d, k] of steps) if (!e[k]) return { days: d, date: addDays(e.changed_at, d) }
  return null
}

export default function TodayView() {
  const { user, loading, overview, prevOverview, tasks, experiments, newSinceLastVisit, lastVisit, openTask } = useWorkspace()
  const { toReview, snoozed, active, evaluating } = useTaskGroups()
  const first = user.name?.split(" ")[0] || ""

  const clicks = sum(overview, "clicks"), prevClicks = sum(prevOverview, "clicks")
  const impressions = sum(overview, "impressions")
  const clickDelta = prevClicks ? ((clicks - prevClicks) / prevClicks) * 100 : null
  const focus = toReview.slice(0, 3)
  const highCount = toReview.filter(t => t.signal.priority === "hoog").length
  const newCount = toReview.filter(t => newSinceLastVisit.has(t.key)).length
  const inProgress = active.filter(t => t.status === "in_uitvoering").length

  const measurements = useMemo(() => {
    const byKey = new Map(tasks.map(t => [t.key, t]))
    return experiments
      .map(e => ({ e, next: nextMeasurement(e), task: byKey.get(e.advice_key) }))
      .filter(x => x.task && (x.next || x.e.outcome))
      .sort((a, b) => (a.next?.date || "9999") < (b.next?.date || "9999") ? -1 : 1)
      .slice(0, 5)
  }, [experiments, tasks])
  const nextDue = measurements.find(m => m.next)?.next

  const headline = loading ? "" : toReview.length
    ? (highCount ? "Dit vraagt vandaag je aandacht." : "Er liggen nieuwe signalen klaar.")
    : active.length ? "Werk verder aan je lopende taken." : "Alles is beoordeeld."

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting()}{first ? `, ${first}` : ""}. <span className="soft">{headline}</span></h1>
          <div className="context-line">
            <span>{dateLong(today())}</span>
            {!loading && overview.length > 0 && (
              <span>Laatste 28 dagen: <b>{num(clicks)}</b> clicks{clickDelta !== null && <> ({signedPct(clickDelta)})</>} en <b>{num(impressions)}</b> vertoningen</span>
            )}
            {!loading && lastVisit && lastVisit !== today() && (
              <span>Sinds {dateShort(lastVisit)}: <b>{newCount}</b> {newCount === 1 ? "nieuw signaal" : "nieuwe signalen"}</span>
            )}
          </div>
        </div>
      </div>

      {/* Drie tellers: wat ligt er op je bord */}
      <div className="stat-grid">
        <Link href="/taken" className="stat stat--dark interactive">
          <div className="stat-top"><span className="stat-label">Te beoordelen</span><span className="stat-arrow" aria-hidden><ArrowUpRight /></span></div>
          <span className="stat-value">{loading ? <Skeleton height={40} width={56} /> : toReview.length}</span>
          <span className="stat-foot">
            {loading ? " " : <>{highCount} met hoge prioriteit{snoozed.length ? ` · ${snoozed.length} uitgesteld` : ""}{newCount > 0 && <span className="badge">{newCount} nieuw</span>}</>}
          </span>
        </Link>
        <Link href="/taken" className="stat interactive">
          <div className="stat-top"><span className="stat-label">Lopende taken</span><span className="stat-arrow" aria-hidden><ArrowUpRight /></span></div>
          <span className="stat-value">{loading ? <Skeleton height={40} width={56} /> : active.length}</span>
          <span className="stat-foot">{loading ? " " : active.length ? `${inProgress} in uitvoering · ${active.length - inProgress} gepland` : "Nog niets ingepland"}</span>
        </Link>
        <Link href="/experimenten" className="stat interactive">
          <div className="stat-top"><span className="stat-label">In evaluatie</span><span className="stat-arrow" aria-hidden><ArrowUpRight /></span></div>
          <span className="stat-value">{loading ? <Skeleton height={40} width={56} /> : evaluating.length}</span>
          <span className="stat-foot">{loading ? " " : nextDue ? `Volgende meting ${dateShort(nextDue.date)}` : "Nog geen lopende metingen"}</span>
        </Link>
      </div>

      {/* Prioriteit vandaag */}
      <div className="section-head">
        <div>
          <h2 className="section-title">Prioriteit vandaag</h2>
          <p className="section-sub">De drie signalen met de meeste verwachte winst, gewogen naar bewijskracht.</p>
        </div>
        {!loading && toReview.length > 3 && (
          <Link href="/taken" className="section-link">Alle {toReview.length} signalen<ArrowRight aria-hidden /></Link>
        )}
      </div>
      <div className="focus-list">
        {loading ? (
          [0, 1, 2].map(i => <div key={i} className="card card-pad"><Skeleton height={20} width="40%" /><div style={{ height: 10 }} /><Skeleton height={14} width="75%" /></div>)
        ) : focus.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<CheckCircle2 />}
              title="Alles is beoordeeld"
              text={snoozed.length ? `Er staan nog ${plural(snoozed.length, "uitgesteld signaal", "uitgestelde signalen")} klaar die later terugkomen.` : "Er zijn geen nieuwe signalen. Nieuwe data komt elke nacht binnen."}
              action={active.length ? <Link href="/taken" className="btn btn-secondary btn-sm">Naar lopende taken</Link> : undefined}
            />
          </div>
        ) : focus.map((t, i) => <FocusCard key={t.key} task={t} rank={i + 1} isNew={newSinceLastVisit.has(t.key)} onOpen={() => openTask(t.key)} />)}
      </div>

      {/* Lopend werk en metingen */}
      <div className="split">
        <section className="card" aria-labelledby="lopend">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="lopend"><ListTodo aria-hidden />Lopende taken</h2>
              <p className="card-sub">Ingepland of in uitvoering</p>
            </div>
            {active.length > 0 && <Link href="/taken" className="section-link">Naar bord<ArrowRight aria-hidden /></Link>}
          </div>
          <div style={{ marginTop: 12 }}>
            {loading ? (
              <div className="card-body"><Skeleton height={36} /></div>
            ) : active.length === 0 ? (
              <EmptyState compact icon={<Play />} title="Nog geen taken" text="Open een signaal hierboven en kies 'Inplannen als taak'." />
            ) : (
              <div className="row-list">
                {active.slice(0, 6).map(t => (
                  <button key={t.key} className="row-item" onClick={() => openTask(t.key)}>
                    <span className="row-icon tone-accent" aria-hidden>{t.status === "in_uitvoering" ? <Play /> : <CalendarClock />}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="row-title truncate" style={{ display: "block" }}>{t.signal.query || t.signal.headline}</span>
                      <span className="row-sub truncate" style={{ display: "block" }}>{t.signal.title}</span>
                    </span>
                    <StatusBadge task={t} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="metingen">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="metingen"><FlaskConical aria-hidden />Metingen</h2>
              <p className="card-sub">Effect van wat je hebt aangepast</p>
            </div>
            {measurements.length > 0 && <Link href="/experimenten" className="section-link">Alle experimenten<ArrowRight aria-hidden /></Link>}
          </div>
          <div style={{ marginTop: 12 }}>
            {loading ? (
              <div className="card-body"><Skeleton height={36} /></div>
            ) : measurements.length === 0 ? (
              <EmptyState compact icon={<FlaskConical />} title="Nog geen metingen" text="Zodra je een taak als uitgevoerd markeert, legt het dashboard een nulmeting vast en meet het na 14, 28 en 56 dagen opnieuw." />
            ) : (
              <div className="row-list">
                {measurements.map(({ e, next, task }) => (
                  <button key={e.id} className="row-item" onClick={() => openTask(e.advice_key)}>
                    <span className={`row-icon ${e.outcome === "succesvol" ? "tone-success" : e.outcome === "niet_succesvol" ? "tone-error" : "tone-info"}`} aria-hidden>
                      {e.outcome ? <CheckCircle2 /> : <CalendarClock />}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="row-title truncate" style={{ display: "block" }}>{task!.signal.query || task!.signal.headline}</span>
                      <span className="row-sub truncate" style={{ display: "block" }}>{e.description}</span>
                    </span>
                    <span className="row-sub nowrap">
                      {e.outcome ? (e.outcome === "succesvol" ? "Succesvol" : e.outcome === "niet_succesvol" ? "Niet succesvol" : "Geen duidelijk effect")
                        : next ? `${next.days}-dagenmeting ${dateShort(next.date)}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function FocusCard({ task, rank, isNew, onOpen }: { task: Task; rank: number; isNew: boolean; onOpen: () => void }) {
  const s = task.signal
  return (
    <button className="focus-card interactive" onClick={onOpen} aria-label={`Bekijk advies: ${s.query || s.headline}`}>
      <span className="focus-rank" aria-hidden>{rank}</span>
      <span className="focus-main">
        <span className="focus-meta">
          <KindLabel signal={s} />
          <PriorityMeter priority={s.priority} />
          {task.status !== "nieuw" && <StatusBadge task={task} />}
          {isNew && <span className="new-dot">Nieuw</span>}
        </span>
        <span className="focus-title">{s.query ? `"${s.query}"` : <Breakable text={s.headline} />}</span>
        <span className="focus-text">{s.title}</span>
        <span className="focus-why">
          <span><TrendingUp aria-hidden />{gainShort(s.gain)}</span>
          {s.metrics.impressions !== undefined && <span><Eye aria-hidden />{num(s.metrics.impressions)} vertoningen</span>}
          <span><ShieldCheck aria-hidden />Bewijs {s.evidence}</span>
        </span>
      </span>
      <span className="focus-cta">Bekijk advies<ArrowRight aria-hidden /></span>
    </button>
  )
}

