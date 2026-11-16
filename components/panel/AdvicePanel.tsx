"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, CalendarClock, CheckCircle2, Clock, Copy, ExternalLink,
  Eye, FlaskConical, Gauge, ListChecks, MessageSquareText, Play, RotateCcw, ShieldCheck, Stethoscope,
  Target, ThumbsDown, ThumbsUp, TrendingUp, X, XCircle, CircleSlash, PauseCircle, PencilLine,
  ClipboardCheck, Database, Users, Calculator,
} from "lucide-react"
import type { AdviceDetail, Estimate, Experiment, Status, Task } from "@/lib/types"
import { INTENT_META } from "@/lib/intent"
import { useWorkspace } from "@/lib/workspace"
import { baselineFrom, buildClaudePrompt, buildDiagnosis, type Diagnosis, type FindingTone } from "@/lib/diagnosis"
import { columnOf } from "@/lib/workflow"
import { addDays, dateLong, dateShort, num, pct, pos, today } from "@/lib/format"
import { Alert, Badge, Breakable, IntentBadge, KindLabel, PriorityMeter, Skeleton, Sparkline, StatusBadge } from "@/components/ui"

const SITE = "https://www.groeninjestraat.nl"

export default function AdvicePanel() {
  const { panelTask, closePanel } = useWorkspace()
  if (!panelTask) return null
  return <PanelContent key={panelTask.key} task={panelTask} onClose={closePanel} />
}

const FINDING_TAG: Record<FindingTone, { label: string; tone: "info" | "warning" | "neutral" | "error" }> = {
  feit: { label: "Feit", tone: "info" },
  aanwijzing: { label: "Aanwijzing", tone: "warning" },
  check: { label: "Zelf checken", tone: "neutral" },
  spoed: { label: "Spoed", tone: "error" },
}

type Mode = null | "reject" | "snooze" | "execute" | "note" | "copy-fallback"

function PanelContent({ task, onClose }: { task: Task; onClose: () => void }) {
  const { getDetail, ctrModel, pages, signals, setStatus, toast, dataUntil } = useWorkspace()
  const [detail, setDetail] = useState<AdviceDetail | null>(null)
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("loading")
  const [detailError, setDetailError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [promptText, setPromptText] = useState("")
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const signal = task.signal

  useEffect(() => {
    let cancelled = false
    setDetailState("loading")
    getDetail(signal)
      .then(d => { if (!cancelled) { setDetail(d); setDetailState("ready") } })
      .catch(e => { if (!cancelled) { setDetailError(e?.message || "onbekende fout"); setDetailState("error") } })
    return () => { cancelled = true }
  }, [getDetail, signal])

  // Focus, Escape en scroll-lock
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose() }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], textarea, input, select, summary")
        if (!focusables.length) return
        const first = focusables[0], last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; previous?.focus?.() }
  }, [onClose])

  const diag: Diagnosis = useMemo(
    () => buildDiagnosis(signal, detail, { model: ctrModel, pages, signalCount: signals.length }),
    [signal, detail, ctrModel, pages, signals.length]
  )

  const column = columnOf(task.status)
  const target = diag.target

  const run = async (to: Status, opts: Parameters<typeof setStatus>[2], message: string) => {
    setBusy(true)
    const ok = await setStatus(task, to, opts)
    setBusy(false)
    if (ok) { toast(message); setMode(null); setText(""); setFormError(null) }
    return ok
  }

  const copyToClaude = async () => {
    const prompt = buildClaudePrompt(signal, diag)
    try {
      await navigator.clipboard.writeText(prompt)
      window.open("https://claude.ai/new", "_blank", "noopener")
      toast("Analyse gekopieerd. Plak hem in het geopende Claude-tabblad.", "info")
    } catch {
      setPromptText(prompt)
      setMode("copy-fallback")
    }
  }

  const latestExperiment: Experiment | undefined = task.experiments[0]

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" ref={panelRef}>
        <header className="panel-head">
          <div className="panel-head-top">
            <div className="panel-tags">
              <KindLabel signal={signal} />
              <StatusBadge task={task} />
              {signal.kind !== "analyse" && <PriorityMeter priority={signal.priority} />}
              {signal.intent && <IntentBadge intent={signal.intent} />}
            </div>
            <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Paneel sluiten"><X /></button>
          </div>
          <h2 className="panel-title" id="panel-title">{signal.query ? `"${signal.query}"` : <Breakable text={signal.headline} />}</h2>
          <p className="panel-subtitle">
            {target ? (
              <a href={`${SITE}${target}`} target="_blank" rel="noopener noreferrer">{target}<ExternalLink aria-hidden /></a>
            ) : detailState === "loading" ? "Rankende pagina wordt opgezocht…" : "Geen rankende pagina gevonden"}
            {dataUntil && <> · laatste 28 dagen t/m {dateShort(dataUntil)}</>}
          </p>
          {signal.action && (
            <p className="panel-task"><ClipboardCheck aria-hidden /><span><b>Taak:</b> {signal.action}</span></p>
          )}
        </header>

        <div className="panel-body">
          {!task.current && signal.kind !== "analyse" && (
            <div className="psec" style={{ paddingBottom: 0 }}>
              <Alert tone="info" title="Niet meer in de actuele signalen">
                Dit advies kwam eerder uit de data. De cijfers hieronder zijn opnieuw opgehaald, zodat je ziet hoe het er nu voor staat.
              </Alert>
            </div>
          )}

          {/* Oordeel */}
          <section className="psec">
            <div className={`verdict verdict-${diag.verdict.kind}`}>
              {diag.verdict.kind === "spoed" ? <AlertTriangle aria-hidden /> : diag.verdict.kind === "afwachten" ? <PauseCircle aria-hidden /> : <CheckCircle2 aria-hidden />}
              <div><strong>{diag.verdict.label}</strong><p>{diag.verdict.text}</p></div>
            </div>
          </section>

          {/* 1. Probleem */}
          <section className="psec" aria-labelledby="sec-probleem">
            <h3 className="psec-title" id="sec-probleem"><Activity aria-hidden /><span className="psec-num">1</span>Probleem: wat is er veranderd</h3>
            <p className="lead">{diag.situation}</p>
          </section>

          {/* 2. Bewijs */}
          <section className="psec" aria-labelledby="sec-bewijs">
            <h3 className="psec-title" id="sec-bewijs"><Database aria-hidden /><span className="psec-num">2</span>Bewijs</h3>
            <div className="facts" style={{ marginTop: 0 }}>
              {diag.facts.map(f => (
                <div className="fact" key={f.label}>
                  <p className="fact-label">{f.label}</p>
                  <p className="fact-value">{detailState === "loading" && f.value === "—" ? <Skeleton height={20} width={48} /> : f.value}</p>
                  {f.sub && <p className="fact-sub">{f.sub}</p>}
                </div>
              ))}
            </div>
            {diag.history.length >= 2 && <Sparkline points={diag.history} />}
            {detail && (detail.queryPages?.cur?.length || detail.pageQueries?.length) ? (
              <details className="evidence-details">
                <summary>Pagina&apos;s en zoekwoorden achter deze cijfers</summary>
                <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
                  {!!detail.queryPages?.cur?.length && (
                    <div>
                      <p className="eyebrow" style={{ marginBottom: 6 }}>Eigen pagina&apos;s die op dit zoekwoord verschijnen</p>
                      <table className="mini-table">
                        <thead><tr><th>Pagina</th><th className="num">Positie</th><th className="num">Vertoningen</th><th className="num">Clicks</th></tr></thead>
                        <tbody>{detail.queryPages.cur.map(p => (
                          <tr key={p.path}><td className="truncate" style={{ maxWidth: 260 }}>{p.path}</td><td className="num">{pos(p.position)}</td><td className="num">{num(p.impressions)}</td><td className="num">{num(p.clicks)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {!!detail.pageQueries?.length && (
                    <div>
                      <p className="eyebrow" style={{ marginBottom: 6 }}>Zoekwoorden van {detail.auditTarget}</p>
                      <table className="mini-table">
                        <thead><tr><th>Zoekwoord</th><th className="num">Positie</th><th className="num">Vertoningen</th><th className="num">CTR</th></tr></thead>
                        <tbody>{detail.pageQueries.slice(0, 10).map(r => (
                          <tr key={r.query}><td className="truncate" style={{ maxWidth: 260 }}>{r.query}</td><td className="num">{pos(r.position)}</td><td className="num">{num(r.impressions)}</td><td className="num">{pct(r.ctr)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              </details>
            ) : null}
          </section>

          {/* 3. Diagnose */}
          <section className="psec" aria-labelledby="sec-diagnose">
            <h3 className="psec-title" id="sec-diagnose"><Stethoscope aria-hidden /><span className="psec-num">3</span>Diagnose: waardoor kan dit komen{detailState === "loading" && <span className="subtle">pagina en rankings worden gecontroleerd…</span>}</h3>
            {detailState === "error" && (
              <div style={{ marginBottom: 12 }}>
                <Alert tone="warning" title="Detailgegevens niet opgehaald">De diagnose hieronder gebruikt alleen de cijfers van het signaal ({detailError}).</Alert>
              </div>
            )}
            {detailState === "loading" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <Skeleton height={18} /><Skeleton height={18} width="85%" /><Skeleton height={18} width="70%" />
              </div>
            ) : diag.findings.length ? (
              <ul className="findings">
                {diag.findings.map((f, i) => (
                  <li className="finding" key={i}>
                    <span className="finding-tag"><Badge tone={FINDING_TAG[f.tone].tone}>{FINDING_TAG[f.tone].label}</Badge></span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Geen opvallende bevindingen in de data.</p>
            )}
          </section>

          {/* 4. Aanbeveling */}
          <section className="psec" aria-labelledby="sec-stappen">
            <h3 className="psec-title" id="sec-stappen"><ListChecks aria-hidden /><span className="psec-num">4</span>Aanbeveling: wat je concreet aanpast</h3>
            {detailState === "loading" ? (
              <div style={{ display: "grid", gap: 12 }}><Skeleton height={40} /><Skeleton height={40} /></div>
            ) : (
              <ol className="steps">
                {diag.steps.map((s, i) => (
                  <li className="step" key={i}>
                    <span className="step-num" aria-hidden>{i + 1}</span>
                    <div><p className="step-title">{s.title}</p>{s.detail && <p className="step-detail">{s.detail}</p>}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* 5. Impact en zekerheid */}
          <section className="psec" aria-labelledby="sec-impact">
            <h3 className="psec-title" id="sec-impact"><Target aria-hidden /><span className="psec-num">5</span>Impact en zekerheid</h3>
            <p className="impact-headline"><TrendingUp aria-hidden /><span><b>{diag.importance.gainText}</b> <span className="muted">(indicatief)</span></span></p>
            {signal.estimate ? <EstimateTable e={signal.estimate} /> : (
              <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Voor dit advies is geen rekensom beschikbaar: er zijn geen actuele vertoningen of posities.</p>
            )}
            <ul className="why-list">
              <li className="why-item"><ShieldCheck aria-hidden /><span>{diag.importance.evidenceText}</span></li>
              {signal.intent && <li className="why-item"><Users aria-hidden /><span>Zoekintentie <b>{INTENT_META[signal.intent].label.toLowerCase()}</b>: deze zoeker {INTENT_META[signal.intent].explain}. Weegt ×{num(INTENT_META[signal.intent].weight, 2)} mee in de prioriteit.</span></li>}
              <li className="why-item"><BarChart3 aria-hidden /><span>{diag.importance.relativeText}</span></li>
            </ul>
            {diag.expected.slice(1).map((e, i) => <p key={i} className="field-hint" style={{ marginTop: 10 }}>{e}</p>)}
          </section>

          {/* 6. Evaluatie */}
          <section className="psec" aria-labelledby="sec-evaluatie">
            <h3 className="psec-title" id="sec-evaluatie"><CalendarClock aria-hidden /><span className="psec-num">6</span>Evaluatie: wanneer meten we het resultaat</h3>
            <ul className="plain-list">
              {diag.measurement.map((e, i) => <li key={i}><CalendarClock aria-hidden /><span>{e}</span></li>)}
            </ul>
            {task.experiments.length > 0 && (
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {task.experiments.map(e => <ExperimentSummary key={e.id} exp={e} />)}
              </div>
            )}
          </section>

          {task.note && mode !== "note" && (
            <section className="psec" aria-labelledby="sec-note">
              <h3 className="psec-title" id="sec-note"><MessageSquareText aria-hidden />Notitie</h3>
              <p className="note-box">{task.note}</p>
            </section>
          )}
        </div>

        <footer className="panel-foot">
          {mode === "reject" && (
            <div className="inline-form">
              <label className="field-label" htmlFor="reject-reason">Waarom wijs je dit af? <span className="subtle">(optioneel)</span></label>
              <textarea id="reject-reason" className="textarea" value={text} onChange={e => setText(e.target.value)} placeholder="Bijvoorbeeld: deze regio is voor ons niet belangrijk" autoFocus />
              <p className="field-hint">Je reden wordt bewaard en helpt later om vergelijkbare adviezen te beoordelen.</p>
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => { setMode(null); setText("") }}>Annuleren</button>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run("afgewezen", { note: text.trim() || null }, "Advies afgewezen")}>Afwijzen</button>
              </div>
            </div>
          )}

          {mode === "snooze" && (
            <div className="inline-form">
              <p className="field-label">Hoe lang uitstellen?</p>
              <div className="snooze-options">
                {[{ d: 7, l: "1 week" }, { d: 14, l: "2 weken" }, { d: 30, l: "1 maand" }].map(o => (
                  <button key={o.d} className="btn btn-secondary btn-sm" disabled={busy}
                    onClick={() => run("uitgesteld", { snoozeUntil: addDays(today(), o.d) }, `Uitgesteld tot ${dateShort(addDays(today(), o.d))}`)}>
                    {o.l} <span className="subtle">tot {dateShort(addDays(today(), o.d))}</span>
                  </button>
                ))}
              </div>
              <div className="inline-form-actions"><button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Annuleren</button></div>
            </div>
          )}

          {mode === "execute" && (
            <div className="inline-form">
              <label className="field-label" htmlFor="exec-desc">Wat heb je aangepast?</label>
              <textarea id="exec-desc" className="textarea" value={text} onChange={e => { setText(e.target.value); setFormError(null) }}
                placeholder={diag.steps[0] ? `Bijvoorbeeld: ${diag.steps[0].title.toLowerCase()}` : "Beschrijf de aanpassing"} autoFocus />
              {formError && <p className="field-error">{formError}</p>}
              <p className="field-hint">
                Nulmeting die wordt vastgelegd: positie {pos(baselineFrom(signal, detail, diag.successMetric).position)}, {num(baselineFrom(signal, detail, diag.successMetric).impressions)} vertoningen, {num(baselineFrom(signal, detail, diag.successMetric).clicks)} clicks. Metingen op {dateShort(addDays(today(), 14))}, {dateShort(addDays(today(), 28))} en {dateShort(addDays(today(), 56))}.
              </p>
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => { setMode(null); setText("") }}>Annuleren</button>
                <button className="btn btn-primary btn-sm" disabled={busy || detailState === "loading"} onClick={() => {
                  if (!text.trim()) { setFormError("Beschrijf kort wat je hebt aangepast, zodat je later weet wat er gemeten wordt."); return }
                  run("uitgevoerd", { experiment: { description: text.trim(), baseline: baselineFrom(signal, detail, diag.successMetric) } }, "Uitgevoerd. De meting is gestart.")
                }}>{detailState === "loading" ? "Nulmeting laden…" : "Opslaan en meting starten"}</button>
              </div>
            </div>
          )}

          {mode === "note" && (
            <div className="inline-form">
              <label className="field-label" htmlFor="note-text">Notitie</label>
              <textarea id="note-text" className="textarea" value={text} onChange={e => setText(e.target.value)} autoFocus placeholder="Bijvoorbeeld: afgestemd met marketing, oppakken na de nieuwe regiopagina's" />
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => { setMode(null); setText("") }}>Annuleren</button>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(task.status, { note: text.trim() || null, snoozeUntil: task.snoozeUntil }, "Notitie opgeslagen")}>Notitie opslaan</button>
              </div>
            </div>
          )}

          {mode === "copy-fallback" && (
            <div className="inline-form">
              <label className="field-label" htmlFor="prompt-text">Kopiëren lukte niet automatisch. Selecteer en kopieer de tekst hieronder.</label>
              <textarea id="prompt-text" className="textarea" readOnly value={promptText} style={{ minHeight: 140 }} onFocus={e => e.currentTarget.select()} autoFocus />
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Sluiten</button>
                <a className="btn btn-secondary btn-sm" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">Claude openen <ExternalLink aria-hidden /></a>
              </div>
            </div>
          )}

          {mode === null && (
            <>
              <div className="panel-actions">
                {column === "beoordelen" && (<>
                  <button className="btn btn-primary" disabled={busy} onClick={() => run("goedgekeurd", {}, "Ingepland. Je vindt de taak onder Gepland.")}><ThumbsUp aria-hidden />Inplannen als taak</button>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => setMode("snooze")}><Clock aria-hidden />Uitstellen</button>
                  <span className="grow" />
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setMode("reject")}><ThumbsDown aria-hidden />Afwijzen</button>
                </>)}
                {column === "gepland" && (<>
                  <button className="btn btn-primary" disabled={busy} onClick={() => run("in_uitvoering", {}, "Gestart. De taak staat onder In uitvoering.")}><Play aria-hidden />Start uitvoering</button>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => setMode("execute")}><CheckCircle2 aria-hidden />Direct als uitgevoerd markeren</button>
                  <span className="grow" />
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run("nieuw", {}, "Teruggezet naar Te beoordelen")}><ArrowLeft aria-hidden />Terug</button>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setMode("reject")}><ThumbsDown aria-hidden />Afwijzen</button>
                </>)}
                {column === "uitvoering" && (<>
                  <button className="btn btn-primary" disabled={busy} onClick={() => setMode("execute")}><CheckCircle2 aria-hidden />Markeer als uitgevoerd</button>
                  <span className="grow" />
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run("goedgekeurd", {}, "Teruggezet naar Gepland")}><ArrowLeft aria-hidden />Terug naar gepland</button>
                </>)}
                {column === "evalueren" && (<>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => run("succesvol", {}, "Beoordeeld als succesvol")}><ThumbsUp aria-hidden />Succesvol</button>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => run("niet_succesvol", {}, "Beoordeeld als niet succesvol")}><XCircle aria-hidden />Niet succesvol</button>
                  <span className="grow" />
                  {latestExperiment && <span className="meta-line"><CalendarClock aria-hidden />Automatische eindbeoordeling {dateShort(addDays(latestExperiment.changed_at, 56))}</span>}
                </>)}
                {column === "afgerond" && (<>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => run("nieuw", { note: task.note }, "Heropend onder Te beoordelen")}><RotateCcw aria-hidden />Heropenen</button>
                </>)}
              </div>
              <div className="panel-links">
                {column === "beoordelen" && (
                  <button className="link-btn" disabled={busy} onClick={() => run("onvoldoende_bewijs", {}, "Gemarkeerd als onvoldoende bewijs")} title="Te weinig data om nu iets te veranderen"><CircleSlash aria-hidden />Onvoldoende bewijs</button>
                )}
                <button className="link-btn" onClick={() => { setText(task.note || ""); setMode("note") }}><PencilLine aria-hidden />{task.note ? "Notitie bewerken" : "Notitie toevoegen"}</button>
                <button className="link-btn" onClick={copyToClaude}><Copy aria-hidden />Tweede mening van Claude</button>
                {task.updatedAt && <span className="meta-line" style={{ marginLeft: "auto" }}>Gewijzigd {dateShort(task.updatedAt)}</span>}
              </div>
            </>
          )}
        </footer>
      </div>
    </>
  )
}

function ExperimentSummary({ exp }: { exp: Experiment }) {
  const base = exp.baseline || {}
  const basePos = base.position ?? base.positionNow
  const milestones: { label: string; days: number; data: Record<string, any> | null }[] = [
    { label: "14 dagen", days: 14, data: exp.result_14d },
    { label: "28 dagen", days: 28, data: exp.result_28d },
    { label: "56 dagen", days: 56, data: exp.result_56d },
  ]
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="meta-line" style={{ marginBottom: 6 }}><FlaskConical aria-hidden />Aangepast op {dateLong(exp.changed_at)}{exp.outcome && <Badge tone={exp.outcome === "succesvol" ? "success" : exp.outcome === "niet_succesvol" ? "error" : "neutral"}>{exp.outcome === "onduidelijk" ? "Geen duidelijk effect" : exp.outcome === "succesvol" ? "Succesvol" : "Niet succesvol"}</Badge>}</div>
      <p style={{ fontSize: "var(--fs-sm)", marginBottom: 10 }}>{exp.description}</p>
      <div className="exp-measures">
        <div className="measure"><p className="measure-label">Nulmeting</p><p className="measure-value">pos. {pos(basePos)}</p><p className="measure-sub">{num(base.clicks)} clicks / 28 d</p></div>
        {milestones.map(m => m.data ? (
          <div className="measure" key={m.label}><p className="measure-label">{m.label}</p><p className="measure-value">pos. {pos(m.data.position)}</p><p className="measure-sub">{num(m.data.clicks)} clicks / {m.data.sampleDays ?? 7} d</p></div>
        ) : (
          <div className="measure is-pending" key={m.label}><p className="measure-label">{m.label}</p><p className="measure-value subtle">—</p><p className="measure-sub">{dateShort(addDays(exp.changed_at, m.days))}</p></div>
        ))}
      </div>
    </div>
  )
}

export { ExperimentSummary }

// De rekensom achter de schatting, regel voor regel
function EstimateTable({ e }: { e: Estimate }) {
  const sourceText = e.source === "eigen"
    ? "jouw eigen doorklik op deze posities (Search Console, laatste 28 dagen)"
    : e.source === "gemengd"
      ? "deels jouw eigen doorklik, deels het branchegemiddelde waar je eigen data te dun is (< 300 vertoningen per positie)"
      : "het branchegemiddelde; je eigen data heeft op deze posities te weinig vertoningen (< 300)"
  const ratio = e.gain / Math.max(e.noise, 0.01)
  const noiseText = e.expectedClicks < 0.5
    ? "Bij zo weinig verwachte clicks is elk resultaat grotendeels toeval."
    : ratio < 1
      ? `De natuurlijke schommeling (±${num(e.noise, 1)} clicks per 28 dagen) is groter dan de verwachte winst: één maand meten zegt nog weinig.`
      : ratio < 2
        ? `De natuurlijke schommeling (±${num(e.noise, 1)} clicks per 28 dagen) is ongeveer even groot als de verwachte winst: meet over meerdere maanden.`
        : `De verwachte winst is duidelijk groter dan de natuurlijke schommeling (±${num(e.noise, 1)} clicks): een effect zou zichtbaar moeten worden.`
  return (
    <div className="calc">
      <p className="calc-title"><Calculator aria-hidden />Zo komt deze schatting tot stand</p>
      <table className="calc-table">
        <tbody>
          <tr><th>Vertoningen (28 dagen)</th><td>{num(e.impressions)}</td></tr>
          {e.basis === "positie" ? (<>
            <tr><th>Nu: positie {pos(e.fromPosition)}</th><td>verwachte doorklik {pct(e.ctrFrom, 2)}</td></tr>
            <tr><th>Scenario: {e.scenario || `positie ${pos(e.toPosition)}`}</th><td>verwachte doorklik {pct(e.ctrTo, 2)}</td></tr>
            <tr className="calc-sum"><th>Berekening</th><td>{num(e.impressions)} × ({pct(e.ctrTo, 2)} − {pct(e.ctrFrom, 2)}) = <b>{num(e.gain, 1)} clicks</b></td></tr>
          </>) : (<>
            <tr><th>Nu: doorklik op positie {pos(e.fromPosition)}</th><td>{pct(e.ctrFrom, 2)}</td></tr>
            <tr><th>Gemiddeld op deze positie</th><td>{pct(e.ctrTo, 2)}</td></tr>
            <tr className="calc-sum"><th>Berekening</th><td>{num(e.impressions)} × {pct(e.ctrTo, 2)} − huidige clicks = <b>{num(e.gain, 1)} clicks</b></td></tr>
          </>)}
          <tr><th>Getoonde bandbreedte</th><td>{e.gain >= 1 ? `${num(e.low)}–${num(e.high)} clicks (−40% tot +30%)` : "minder dan 1 click"}</td></tr>
        </tbody>
      </table>
      <ul className="calc-notes">
        <li>Doorklik per positie: {sourceText}.</li>
        <li>Aanname: het aantal vertoningen blijft gelijk. Stijg je in Google, dan krijg je vaak ook méér vertoningen; dat zit niet in deze som.</li>
        <li>{noiseText}</li>
      </ul>
    </div>
  )
}
