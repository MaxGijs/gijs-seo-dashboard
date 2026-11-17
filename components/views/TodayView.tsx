"use client"

import Link from "next/link"
import { useMemo } from "react"
import { AlertsBlock } from "@/components/dashboard/Alerts"
import { ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, Eye, FlaskConical, Play, ShieldCheck, TrendingUp, ListTodo } from "lucide-react"
import { useTaskGroups, useWorkspace } from "@/lib/workspace"
import { useContentIdeas } from "@/lib/content/useContent"
import type { Experiment, Task } from "@/lib/types"
import { addDays, dateLong, dateShort, gainShort, greeting, num, plural, signedPct, today } from "@/lib/format"
import { Breakable, EmptyState, IntentBadge, KindLabel, PriorityMeter, Skeleton, StatusBadge } from "@/components/ui"

function sum(rows: { clicks: number; impressions: number }[], key: "clicks" | "impressions") {
  return rows.reduce((s, r) => s + r[key], 0)
}

function nextMeasurement(e: Experiment) {
  const steps: [number, keyof Experiment][] = [[14, "result_14d"], [28, "result_28d"], [56, "result_56d"]]
  for (const [d, k] of steps) if (!e[k]) return { days: d, date: addDays(e.changed_at, d) }
  return null
}

// embedded = als blok "Vandaag" onderaan het Dashboard (zonder eigen paginakop)
export default function TodayView({ embedded = false }: { embedded?: boolean }) {
  const { user, loading, overview, prevOverview, tasks, experiments, newSinceLastVisit, lastVisit, openTask } = useWorkspace()
  const { toReview, snoozed, active, evaluating, resolved } = useTaskGroups()
  const content = useContentIdeas()
  const contentNew = (content.ideas || []).filter(i => i.status === "nieuw").length
  const first = user.name?.split(" ")[0] || ""

  const clicks = sum(overview, "clicks"), prevClicks = sum(prevOverview, "clicks")
  const impressions = sum(overview, "impressions")
  const clickDelta = prevClicks ? ((clicks - prevClicks) / prevClicks) * 100 : null
  // Merkzoekwoorden horen zelden bij de drie acties van de dag; ze blijven wel op het bord staan.
  const focus = toReview.filter(t => t.signal.intent !== "merk").slice(0, 3)
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

  const body = () => (
    <>
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
          <p className="section-sub">Technische blokkades eerst, daarna de signalen met de meeste verwachte winst, gewogen naar bewijskracht en zoekintentie.</p>
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
      {!loading && resolved.length > 0 && (
        <p className="slim-note">
          <CheckCircle2 aria-hidden />
          <span>
            {resolved.length === 1 ? "1 signaal is" : `${resolved.length} signalen zijn`} al opgelost en telt niet mee:{" "}
            {resolved.map((t, i) => <span key={t.key}>{i > 0 && ", "}<button className="link-btn" style={{ display: "inline" }} onClick={() => openTask(t.key)}>{t.signal.headline}</button></span>)}. Controleer en sluit.
          </span>
        </p>
      )}

      {/* Lopend werk en metingen: compact zolang er niets loopt */}
      {loading ? null : active.length === 0 && measurements.length === 0 ? (
        <p className="slim-note"><Play aria-hidden />Nog geen lopende taken of metingen. Plan een advies hierboven in; zodra je het als uitgevoerd markeert, start de meting automatisch.</p>
      ) : (
        <div className={`split${active.length === 0 || measurements.length === 0 ? " split-single" : ""}`}>
          {active.length > 0 ? (
            <section className="card" aria-labelledby="lopend">
              <div className="card-head">
                <div>
                  <h2 className="card-title" id="lopend"><ListTodo aria-hidden />Lopende taken</h2>
                  <p className="card-sub">Ingepland of in uitvoering</p>
                </div>
                <Link href="/taken" className="section-link">Naar bord<ArrowRight aria-hidden /></Link>
              </div>
              <div className="row-list" style={{ marginTop: 12 }}>
                {active.slice(0, 6).map(t => (
                  <button key={t.key} className="row-item" onClick={() => openTask(t.key)}>
                    <span className="row-icon tone-accent" aria-hidden>{t.status === "in_uitvoering" ? <Play /> : <CalendarClock />}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="row-title truncate" style={{ display: "block" }}>{t.signal.query ? `"${t.signal.query}"` : t.signal.headline}</span>
                      <span className="row-sub truncate" style={{ display: "block" }}>{t.signal.action || t.signal.title}</span>
                    </span>
                    <StatusBadge task={t} />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <p className="slim-note"><ListTodo aria-hidden />Geen lopende taken. Plan een advies hierboven in.</p>
          )}
          {measurements.length > 0 ? (
            <section className="card" aria-labelledby="metingen">
              <div className="card-head">
                <div>
                  <h2 className="card-title" id="metingen"><FlaskConical aria-hidden />Metingen</h2>
                  <p className="card-sub">Effect van wat je hebt aangepast</p>
                </div>
                <Link href="/experimenten" className="section-link">Alle experimenten<ArrowRight aria-hidden /></Link>
              </div>
              <div className="row-list" style={{ marginTop: 12 }}>
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
            </section>
          ) : (
            <p className="slim-note"><FlaskConical aria-hidden />Nog geen metingen. Die starten zodra je een taak als uitgevoerd markeert.</p>
          )}
        </div>
      )}
    </>
  )

  if (embedded) return (
    <section className="today-block" aria-labelledby="vandaag-title">
      <div className="section-head">
        <div>
          <h2 className="section-title" id="vandaag-title"><Link href="/vandaag" className="today-link">Vandaag<ArrowRight aria-hidden /></Link></h2>
          <p className="section-sub">{dateLong(today())}{headline ? ` · ${headline}` : ""}{!loading && lastVisit && lastVisit !== today() ? ` · sinds ${dateShort(lastVisit)} ${newCount} ${newCount === 1 ? "nieuw signaal" : "nieuwe signalen"}` : ""}</p>
        </div>
      </div>
      {body()}
    </section>
  )

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

      <div style={{ marginBottom: 20 }}><AlertsBlock /></div>
      {body()}
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
          {s.intent && <IntentBadge intent={s.intent} />}
          {task.status !== "nieuw" && <StatusBadge task={task} />}
          {isNew && <span className="new-dot">Nieuw</span>}
        </span>
        <span className="focus-title">{s.action || (s.query ? `"${s.query}"` : <Breakable text={s.headline} />)}</span>
        <span className="focus-subject">{s.query ? <b>&ldquo;{s.query}&rdquo;</b> : <b><Breakable text={s.headline} /></b>} · {s.title}</span>
        <span className="focus-why">
          {s.kind === "techniek"
            ? <span><TrendingUp aria-hidden />Randvoorwaarde: gaat vóór kansen</span>
            : <span><TrendingUp aria-hidden />{gainShort(s.gain)}</span>}
          {s.metrics.impressions !== undefined && <span><Eye aria-hidden />{num(s.metrics.impressions)} vertoningen</span>}
          <span><ShieldCheck aria-hidden />Bewijs {s.evidence}</span>
        </span>
      </span>
      <span className="focus-cta">Bekijk advies<ArrowRight aria-hidden /></span>
    </button>
  )
}

