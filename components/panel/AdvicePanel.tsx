"use client"

import { CorrectButton, CorrectionNote } from "./ExperimentCorrect"
import { MeasurementReport, MeasureTimeline } from "@/components/panel/MeasurementReport"
import { conclusionOf } from "@/lib/measureLogic"
import ChangeTypeSelect from "@/components/panel/ChangeTypeSelect"
import { inferChangeType, type ChangeType } from "@/lib/experiment"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Clock, Copy, ExternalLink,
  FlaskConical, MessageSquareText, Play, RotateCcw, ShieldCheck,
  ThumbsDown, ThumbsUp, TrendingUp, X, XCircle, CircleSlash, PauseCircle, PencilLine,
  Users, Calculator, Database, Target, Trash2, Layers,
} from "lucide-react"
import type { AdviceDetail, Estimate, Experiment, Status, Task } from "@/lib/types"
import { INTENT_META } from "@/lib/intent"
import { useWorkspace } from "@/lib/workspace"
import { buildClaudePrompt, buildDiagnosis, type Diagnosis, type FindingTone } from "@/lib/diagnosis"
import { reconcile } from "@/lib/contract"
import { experimentFor, siteBaselineOf } from "@/lib/execute"
import MergeSection from "./MergeSection"
import PageTimeline from "./PageTimeline"
import { KIND_META as EXP_KIND } from "@/lib/experiment"
import { columnOf, groupMembers, groupName, memberLabel } from "@/lib/workflow"
import { addDays, dateLong, dateShort, num, pct, pos, today } from "@/lib/format"
import { Alert, Badge, Breakable, IntentBadge, KindLabel, PriorityMeter, Skeleton, Sparkline, StatusBadge } from "@/components/ui"
import OwnerSelect from "@/components/OwnerSelect"
import LinkSuggestions from "./LinkSuggestions"
import RouteHistory from "./RouteHistory"
import ConversionFacts from "./ConversionFacts"
import Attachments from "@/components/Attachments"

const SITE = "https://www.groeninjestraat.nl"

export default function AdvicePanel() {
  const { panelTask, closePanel, panelIntent } = useWorkspace()
  if (!panelTask) return null
  return <PanelContent key={panelTask.key} task={panelTask} onClose={closePanel} intent={panelIntent} />
}

const FINDING_TAG: Record<FindingTone, { label: string; tone: "info" | "warning" | "neutral" | "error" }> = {
  feit: { label: "Feit", tone: "info" },
  aanwijzing: { label: "Aanwijzing", tone: "warning" },
  check: { label: "Zelf checken", tone: "neutral" },
  spoed: { label: "Spoed", tone: "error" },
}

type Mode = null | "reject" | "snooze" | "execute" | "note" | "copy-fallback" | "close" | "delete"

function PanelContent({ task, onClose, intent }: { task: Task; onClose: () => void; intent: "execute" | "close" | null }) {
  const { getDetail, ctrModel, pages, signals, setStatus, setOwner, setGoal, removeTask, toast, dataUntil, listWindow, experiments, ga4Pages, overview } = useWorkspace()
  const [detail, setDetail] = useState<AdviceDetail | null>(null)
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("loading")
  const [detailError, setDetailError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState("")
  const [changeType, setChangeType] = useState<ChangeType | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [promptText, setPromptText] = useState("")
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const raw = task.signal
  // Eigen taken met een ander doel dan vindbaarheid (bijv. meer aanvragen) krijgen geen SEO-analyse
  const isSeo = !(raw.kind === "eigen" && raw.goal && raw.goal !== "seo")
  const needsDetail = isSeo && raw.kind !== "techniek" && !(raw.kind === "eigen" && !raw.query && !raw.page)

  useEffect(() => {
    let cancelled = false
    if (!needsDetail) { setDetailState("ready"); return }
    setDetailState("loading")
    getDetail(raw)
      .then(d => { if (!cancelled) { setDetail(d); setDetailState("ready") } })
      .catch(e => { if (!cancelled) { setDetailError(e?.message || "onbekende fout"); setDetailState("error") } })
    return () => { cancelled = true }
  }, [getDetail, raw, needsDetail])

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

  // Datacontract: pas als de live controle klaar is, worden cijfers, schatting en oordeel
  // in één keer opgebouwd. Tot die tijd tonen we geen voorlopig oordeel.
  const rec = useMemo(
    () => (detailState === "loading" ? null : reconcile(raw, detailState === "ready" ? detail : null, ctrModel, listWindow)),
    [raw, detail, detailState, ctrModel, listWindow]
  )
  const signal = rec?.signal ?? raw
  const diag: Diagnosis | null = useMemo(() => {
    if (!rec) return null
    const d = buildDiagnosis(rec.signal, detailState === "ready" ? detail : null, { model: ctrModel, pages, signalCount: signals.length })
    if (rec.blocked) d.verdict = { kind: "afwachten", label: "Niet te bevestigen", text: rec.blocked }
    return d
  }, [rec, detail, detailState, ctrModel, pages, signals.length])

  // Belangrijkste bevindingen eerst; controles die in orde zijn en losse feiten inklapbaar
  const findings = useMemo(() => {
    const order: Record<FindingTone, number> = { spoed: 0, aanwijzing: 1, feit: 2, check: 3 }
    const quiet = (f: { tone: FindingTone; text: string }) =>
      f.tone === "feit" && /in orde|^Positie per week|^Title tag|^Meta description|^H1|^Interne links naar/i.test(f.text)
    if (!diag) return { main: [], rest: [] }
    const sorted = [...diag.findings].sort((a, b) => order[a.tone] - order[b.tone])
    const main = sorted.filter(f => !quiet(f)).slice(0, 4)
    const rest = sorted.filter(f => !main.includes(f))
    return { main, rest }
  }, [diag])

  // Geopend na slepen naar Evalueren of Afgerond: meteen de bijbehorende vraag tonen
  const intentApplied = useRef(false)
  useEffect(() => {
    if (!diag || intentApplied.current || !intent) return
    intentApplied.current = true
    setMode(intent)
  }, [diag, intent])

  const column = columnOf(task.status)
  const target = diag?.target ?? null
  const blocked = !!rec?.blocked

  const run = async (to: Status, opts: Parameters<typeof setStatus>[2], message: string) => {
    setBusy(true)
    // De verzoende versie (live cijfers en scope) wordt als momentopname bewaard
    const ok = await setStatus({ ...task, signal }, to, opts)
    setBusy(false)
    if (ok) { toast(message); setMode(null); setText(""); setFormError(null) }
    return ok
  }

  const copyToClaude = async () => {
    if (!diag) return
    const prompt = buildClaudePrompt(signal, diag, (task.merged || []).map(m => m.signal), task.signal.groupTitle)
    try {
      await navigator.clipboard.writeText(prompt)
      toast(task.merged?.length ? `Prompt gekopieerd, met alle ${task.merged.length + 1} zoekwoorden. Plak hem in Claude.` : "Prompt gekopieerd. Plak hem in Claude.", "info")
    } catch {
      setPromptText(prompt)
      setMode("copy-fallback")
    }
  }

  const latestExperiment: Experiment | undefined = task.experiments[0]

  // Sitebrede niveau bij de nulmeting: om later te corrigeren voor algemene groei (nieuwe provincies, seizoen)
  const siteBaseline = siteBaselineOf(overview)

  // GA4: conversies via de pagina waar dit advies over gaat
  const conv = (() => {
    if (!diag || signal.kind === "techniek") return null
    if (ga4Pages === null) return "GA4 is (nog) niet beschikbaar: de prioriteit rekent alleen met Search Console."
    const page = target || signal.conversions?.page
    if (!page) return null
    const r = ga4Pages.find(x => x.path === page)
    if (!r || !r.sessions) return `GA4: geen bezoek via ${page} als landingspagina in de laatste 28 dagen.`
    const f = 1 + Math.min(r.keyEvents, 20) / 20
    return `GA4: ${num(r.sessions)} sessies en ${num(r.keyEvents)} conversies (aanvragen, energiescans) via ${page} in 28 dagen${r.keyEvents ? `; weegt ×${num(f, 2)} mee in de prioriteit` : ""}.`
  })()
  // Wat leerden eerdere experimenten van dit type?
  const learned = (() => {
    if (!diag) return ""
    // Alleen echte experimenten; een familie telt als één
    const seen = new Set<string>()
    const same = experiments.filter(e => (e.kind || "experiment") === "experiment" && e.baseline?.actionType === diag.actionType && e.advice_key !== task.key)
      .filter(e => { const k = e.family_id || e.id; if (seen.has(k)) return false; seen.add(k); return true })
    const done = same.filter(e => (e.outcome === "succesvol" || e.outcome === "niet_succesvol" || e.outcome === "onduidelijk") && conclusionOf(e)?.result.evidence !== "te weinig data")
    const ok = done.filter(e => e.outcome === "succesvol").length
    if (!same.length) return `Nog geen eerdere experimenten van het type "${diag.plan.label.toLowerCase()}". Deze schatting steunt alleen op de doorklik per positie.`
    if (!done.length) return `${same.length} eerder${same.length === 1 ? " experiment" : "e experimenten"} van dit type ${same.length === 1 ? "loopt" : "lopen"} nog; er is nog geen uitkomst om op te leunen.`
    return `Gebaseerd op ${done.length} afgeronde experiment${done.length === 1 ? "" : "en"} van dit type: ${ok} succesvol, ${done.length - ok} niet of zonder duidelijk effect.`
  })()

  const header = (
    <header className="panel-head">
      <div className="panel-head-top">
        <div className="panel-tags">
          <KindLabel signal={raw} />
          <StatusBadge task={task} />
          {raw.kind !== "analyse" && <PriorityMeter priority={raw.priority} />}
          {raw.intent && <IntentBadge intent={raw.intent} />}
          <OwnerSelect value={task.owner} onChange={o => setOwner(task, o)} />
          {raw.kind === "eigen" && !raw.reminder && (
            <label className="owner-select" title="Wat moet deze taak opleveren? Bepaalt hoe er gemeten wordt.">
              <Target aria-hidden /><span className="sr-only">Doel</span>
              <select value={raw.goal || "seo"} onChange={e => setGoal(task, e.target.value as "seo" | "conversie" | "overig").then(ok => ok && toast("Doel aangepast"))}>
                <option value="seo">Doel: beter gevonden worden</option>
                <option value="conversie">Doel: meer aanvragen</option>
                <option value="overig">Doel: overig</option>
              </select>
            </label>
          )}
        </div>
        <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Paneel sluiten"><X /></button>
      </div>
      {task.merged?.length ? <p className="merged-banner panel-merged"><Layers aria-hidden />{groupName(task) ? "Groep" : "Samengevoegd"} · {task.merged.length + 1} kaarten in één opdracht</p> : null}
      {groupName(task) ? (
        <>
          <h2 className="panel-title" id="panel-title"><Breakable text={groupName(task)!} /></h2>
          <ul className="panel-group-members">{groupMembers(task).map(m => <li key={m.key}>{memberLabel(m)}</li>)}</ul>
        </>
      ) : <h2 className="panel-title" id="panel-title">{raw.kind === "eigen" ? raw.headline : raw.query ? `"${raw.query}"` : <Breakable text={raw.headline} />}{task.merged?.length ? <span className="panel-title-merged">{task.merged.map(m => <span key={m.key}> + {m.signal.query ? `"${m.signal.query}"` : m.signal.headline}</span>)}</span> : null}</h2>}
      <p className="panel-subtitle">
        {raw.reminder ? (
          <>Herinnering voor {dateShort(raw.reminder.date)}{raw.reminder.link && <> · <a href={raw.reminder.link} target="_blank" rel="noopener noreferrer">bron openen<ExternalLink aria-hidden /></a></>}</>
        ) : target ? (
          <a href={`${SITE}${target}`} target="_blank" rel="noopener noreferrer">{target}<ExternalLink aria-hidden /></a>
        ) : !diag ? "Pagina en cijfers worden live gecontroleerd…" : raw.kind === "techniek" ? "Uit de pagina-audit (nachtelijke controle)" : raw.kind === "eigen" ? (raw.query ? "Geen rankende pagina gevonden" : "Eigen taak") : "Geen rankende pagina gevonden"}
        {dataUntil && raw.kind !== "techniek" && <> · laatste 28 dagen t/m {dateShort(rec?.signal.scope?.window?.endDate || dataUntil)}</>}
      </p>
    </header>
  )

  if (!diag) {
    return (
      <>
        <div className="panel-overlay" onClick={onClose} aria-hidden />
        <div className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" aria-busy="true" ref={panelRef}>
          {header}
          <div className="panel-body">
            <section className="psec panel-loading" aria-live="polite">
              <p className="panel-loading-title">Analyse wordt voltooid</p>
              <p className="muted">Search Console, de pagina zelf en de pagina-audit worden live gecontroleerd. Het advies verschijnt pas als alle cijfers uit dezelfde periode en scope komen.</p>
              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                <Skeleton height={92} /><Skeleton height={18} /><Skeleton height={18} width="85%" /><Skeleton height={18} width="70%" />
              </div>
            </section>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" ref={panelRef}>
        {header}

        <div className="panel-body">
          {!task.current && signal.kind !== "analyse" && (
            <div className="psec" style={{ paddingBottom: 0 }}>
              <Alert tone="info" title="Niet meer in de actuele signalen">
                Dit advies kwam eerder uit de data. De cijfers hieronder zijn opnieuw opgehaald, zodat je ziet hoe het er nu voor staat.
              </Alert>
            </div>
          )}

          {/* Samenvatting: oordeel, taak en verwachte winst in één blok */}
          <section className="psec" aria-label="Samenvatting">
            <div className={`summary summary-${diag.verdict.kind}`}>
              <p className="summary-verdict">
                {diag.verdict.kind === "spoed" ? <AlertTriangle aria-hidden /> : diag.verdict.kind === "afwachten" ? <PauseCircle aria-hidden /> : <CheckCircle2 aria-hidden />}
                {diag.verdict.label}
              </p>
              <p className="summary-task">{signal.action || diag.steps[0]?.title || diag.situation}</p>
              {diag.verdict.kind !== "inplannen" && <p className="summary-note">{diag.verdict.text}</p>}
              <table className="ptable ptable-kv summary-table">
                <tbody>
                  <tr><th scope="row">Soort aanpassing</th><td>{diag.plan.label}</td></tr>
                  {isSeo ? <>
                    <tr><th scope="row">Verwachte winst</th><td>{signal.kind === "techniek" ? "randvoorwaarde" : signal.estimate ? gainLabel(signal.estimate) : "n.v.t."}</td></tr>
                    <tr><th scope="row">Bewijskracht</th><td>{capitalizeFirst(signal.evidence)}</td></tr>
                  </> : <tr><th scope="row">Gemeten op</th><td>{raw.goal === "conversie" ? "Energiescanaanvragen (GA4)" : "Niet automatisch"}</td></tr>}
                  <tr><th scope="row">Inspanning · risico</th><td>{capitalizeFirst(diag.effort)} · {diag.risk}</td></tr>
                  <tr><th scope="row">Prioriteit</th><td>{capitalizeFirst(signal.priority)}{signal.priorityRank ? ` (#${signal.priorityRank} van ${signals.length})` : ""}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Samengevoegde kaarten, en samenvoegen met andere kaarten */}
          <MergeSection task={task} />

          {/* 1. Wat speelt er: probleem en bewijs */}
          <section className="psec" aria-labelledby="sec-probleem">
            <h3 className="psec-title" id="sec-probleem"><span className="psec-num">1</span>Wat speelt er</h3>
            <p className="lead">{diag.situation}</p>
            {raw.goal === "conversie" && <ConversionFacts page={target} />}
            {isSeo && diag.facts.length > 0 && (
              <table className="ptable kpi-table">
                <thead><tr><th>Meting</th><th className="num">Waarde</th><th>Toelichting</th></tr></thead>
                <tbody>{diag.facts.map(f => (
                  <tr key={f.label}>
                    <th scope="row">{f.label}</th>
                    <td className="num kpi-val">{detailState === "loading" && f.value === "—" ? <Skeleton height={16} width={40} /> : f.value}</td>
                    <td className="muted">{f.sub || ""}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {isSeo && <p className="scope-line"><Database aria-hidden /><span>{rec!.scopeText}</span></p>}
            {isSeo && rec!.changes.length > 0 && (
              <div className="scope-changes">
                <p><b>Bijgewerkt na de live controle.</b> Cijfers, schatting en oordeel zijn opnieuw berekend:</p>
                <ul>{rec!.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}
            {signal.kind === "techniek" && signal.tech && signal.tech.pages.length > 0 && (
              <details className="evidence-details">
                <summary>Alle {signal.tech.pages.length} betrokken URL&apos;s</summary>
                <table className="mini-table" style={{ marginTop: 10 }}>
                  <thead><tr><th>URL</th><th className="num">{signal.tech.type === "sitemap-fout" ? "HTTP" : "Status"}</th></tr></thead>
                  <tbody>{signal.tech.pages.map(p => (
                    <tr key={p.path}><td className="truncate" style={{ maxWidth: 380 }}>{p.path}</td><td className="num">{signal.tech!.type === "sitemap-fout" ? (p.status ?? "—") : (p.reason?.split(".")[0] || "niet geïndexeerd")}</td></tr>
                  ))}</tbody>
                </table>
              </details>
            )}
            {signal.kind === "techniek" && signal.tech?.type === "niet-geindexeerd" && signal.tech.pages.length > 0 && <PageTimeline paths={signal.tech.pages.map(p => p.path)} />}
            {signal.kind !== "techniek" && signal.page && ["goedgekeurd", "in_uitvoering", "uitgevoerd", "in_evaluatie"].includes(task.status) && <PageTimeline paths={[signal.page]} title="Deze pagina bij Google" />}
            {diag.history.length >= 2 && <Sparkline points={diag.history} />}
            {detail && (detail.queryPages?.cur?.length || detail.pageQueries?.length) ? (
              <details className="evidence-details">
                <summary>Pagina&apos;s en zoekwoorden achter deze cijfers</summary>
                <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
                  {!!detail.queryPages?.cur?.length && (
                    <div>
                      <p className="eyebrow" style={{ marginBottom: 4 }}>Eigen pagina&apos;s die op dit zoekwoord verschijnen</p>
                      <p className="field-hint" style={{ marginBottom: 8 }}>Per pagina geteld: toont Google twee eigen pagina&apos;s in één zoekopdracht, dan telt die bij beide mee. Opgeteld ({num(detail.queryPages.cur.reduce((a, p) => a + p.impressions, 0))}) is daardoor meer dan het zoekwoordtotaal ({num(signal.metrics.impressions)}).</p>
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
                        <thead><tr><th>Zoekwoord</th><th className="num">Positie</th><th className="num">Vertoningen</th><th className="num">Aandeel</th></tr></thead>
                        <tbody>{detail.pageQueries.slice(0, 10).map(r => {
                          const c = diag.cluster?.queries.find(x => x.query === r.query)
                          return (
                            <tr key={r.query} className={r.query === signal.query ? "is-current" : undefined}><td className="truncate" style={{ maxWidth: 260 }}>{r.query}{c?.inTopic && diag.cluster?.topic ? <span className="subtle"> · {diag.cluster.topic}</span> : null}</td><td className="num">{pos(r.position)}</td><td className="num">{num(r.impressions)}</td><td className="num">{c ? `${Math.round(c.share * 100)}%` : "—"}</td></tr>
                          )
                        })}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              </details>
            ) : null}
          </section>

          {isSeo && (<>
          {/* 2. Diagnose: belangrijkste bevindingen eerst, de rest inklapbaar */}
          <section className="psec" aria-labelledby="sec-diagnose">
            <h3 className="psec-title" id="sec-diagnose"><span className="psec-num">2</span>Waardoor komt dit{detailState === "loading" && <span className="subtle">pagina wordt gecontroleerd…</span>}</h3>
            {detailState === "error" && (
              <div style={{ marginBottom: 12 }}>
                <Alert tone="warning" title="Detailgegevens niet opgehaald">De diagnose hieronder gebruikt alleen de cijfers van het signaal ({detailError}).</Alert>
              </div>
            )}
            {detailState === "loading" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <Skeleton height={18} /><Skeleton height={18} width="85%" /><Skeleton height={18} width="70%" />
              </div>
            ) : findings.main.length ? (
              <>
                <FindingsTable rows={findings.main} />
                {findings.rest.length > 0 && (
                  <details className="evidence-details">
                    <summary>{findings.rest.length} {findings.rest.length === 1 ? "controle" : "controles"} die in orde {findings.rest.length === 1 ? "is" : "zijn"} of ter info</summary>
                    <div style={{ marginTop: 10 }}><FindingsTable rows={findings.rest} quiet /></div>
                  </details>
                )}
              </>
            ) : (
              <p className="muted">Geen opvallende bevindingen in de data.</p>
            )}
          </section>

          </>)}

          {/* 3. Aanbeveling */}
          <section className="psec" aria-labelledby="sec-stappen">
            <h3 className="psec-title" id="sec-stappen"><span className="psec-num">{isSeo ? 3 : 2}</span>Wat je aanpast</h3>
            {detailState === "loading" ? (
              <div style={{ display: "grid", gap: 12 }}><Skeleton height={40} /><Skeleton height={40} /></div>
            ) : (
              <table className="ptable steps-table">
                <thead><tr><th className="col-n">#</th><th>Stap en hoe</th></tr></thead>
                <tbody>{diag.steps.map((s, i) => (
                  <tr key={i}>
                    <td className="col-n"><span className="step-num" aria-hidden>{i + 1}</span></td>
                    <td><p className="step-title">{s.title}</p>{s.detail && <p className="step-detail">{s.detail}</p>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>

          {isSeo && raw.kind !== "techniek" && <RouteHistory taskKey={task.key} page={target} query={raw.query} routeNote={raw.routeNote} />}
          {isSeo && target && raw.kind !== "techniek" && raw.kind !== "dubbel" && <LinkSuggestions target={target} query={raw.query} />}

          {/* 4. Resultaat en meting */}
          <section className="psec" aria-labelledby="sec-impact">
            <h3 className="psec-title" id="sec-impact"><span className="psec-num">{isSeo ? 4 : 3}</span>Verwacht resultaat en meting</h3>
            {!isSeo ? (
              <p className="impact-headline"><Target aria-hidden /><span><b>{raw.goal === "conversie" ? "Gemeten op energiescanaanvragen, niet op Google" : "Geen automatische meting"}</b></span></p>
            ) : <>
            <p className="impact-headline"><TrendingUp aria-hidden /><span><b>{diag.importance.gainText}</b> <span className="muted">(indicatief)</span></span></p>
            <table className="ptable ptable-kv why-table">
              <tbody>
                <tr><th scope="row"><ShieldCheck aria-hidden />Bewijs</th><td>{diag.importance.evidenceText}</td></tr>
                {signal.intent && <tr><th scope="row"><Users aria-hidden />Zoekintentie</th><td><b>{capitalizeFirst(INTENT_META[signal.intent].label.toLowerCase())}</b>: deze zoeker {INTENT_META[signal.intent].explain}.</td></tr>}
                {conv && <tr><th scope="row"><Target aria-hidden />Aanvragen</th><td>{conv}</td></tr>}
                <tr><th scope="row"><FlaskConical aria-hidden />Eerder geleerd</th><td>{learned}</td></tr>
              </tbody>
            </table>
            </>}
            <p className="field-hint" style={{ marginTop: 14 }}>Meetplan voor: <b>{diag.plan.label.toLowerCase()}</b>. De nulmeting legt {diag.plan.baselineText} vast.</p>
            <table className="ptable plan-table" aria-label="Meetplan">
              <thead><tr><th>Moment</th><th>Wat er gebeurt</th></tr></thead>
              <tbody>
                {diag.plan.timeline.map(t => <tr key={t.l}><th scope="row">{t.l}</th><td>{capitalizeFirst(t.s)}</td></tr>)}
                <tr className="plan-success"><th scope="row">Geslaagd als</th><td>{diag.plan.success}</td></tr>
              </tbody>
            </table>
            {isSeo && <details className="evidence-details">
              <summary>Hoe is deze schatting berekend?</summary>
              <div style={{ marginTop: 12 }}>
                {signal.estimate ? <EstimateTable e={signal.estimate} /> : (
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Voor dit advies is geen rekensom beschikbaar: er zijn geen actuele vertoningen of posities.</p>
                )}
                <ul className="calc-notes" style={{ marginTop: 0 }}>
                  <li>{diag.importance.relativeText}</li>
                  {signal.intent && <li>Zoekintentie weegt ×{num(INTENT_META[signal.intent].weight, 2)} mee in de prioriteit.</li>}
                  {diag.expected.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            </details>}
            {task.experiments.length > 0 && (
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {task.experiments.map(e => <ExperimentSummary key={e.id} exp={e} />)}
              </div>
            )}
          </section>

          <Attachments kind="taak" refId={task.key} />

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
              <ChangeTypeSelect id="exec-type" description={text} value={changeType} onChange={setChangeType} />
              {formError && <p className="field-error">{formError}</p>}
              <p className="field-hint">
                Nulmeting die wordt vastgelegd: {diag.plan.baselineText}{signal.kind !== "techniek" && signal.metrics.position ? ` (nu positie ${pos(signal.metrics.position)}, ${num(signal.metrics.impressions)} vertoningen, ${num(signal.metrics.clicks)} clicks${rec!.targetRow ? `; ${target} zelf op positie ${pos(rec!.targetRow.position)}` : ""})` : ""}. {diag.plan.success}
              </p>
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => { setMode(null); setText("") }}>Annuleren</button>
                <button className="btn btn-primary btn-sm" disabled={busy || blocked} onClick={() => {
                  if (!text.trim()) { setFormError("Beschrijf kort wat je hebt aangepast, zodat je later weet wat er gemeten wordt."); return }
                  run("uitgevoerd", { experiment: experimentFor(signal, detail, diag, rec!.targetRow, siteBaseline, text, (task.merged || []).map(m => m.signal), changeType || inferChangeType(text, diag.actionType)) }, "Uitgevoerd. De meting is gestart (signalering na 7 dagen, eerste beoordeling na 14, eindmeting na 28).")
                }}>Opslaan en meting starten</button>
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

          {mode === "delete" && (
            <div className="inline-form inline-form-danger">
              <p className="field-label">Deze taak definitief verwijderen?</p>
              <p className="field-hint">De taak{task.experiments.length ? ", de meting" : ""} en eventuele bijlagen verdwijnen. Dit kun je niet ongedaan maken. Bedoel je dat de taak niet nodig is? Kies dan liever Afwijzen, dan leert het systeem ervan.</p>
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Annuleren</button>
                <button className="btn btn-danger-solid btn-sm" disabled={busy} onClick={async () => { setBusy(true); const ok = await removeTask(task); setBusy(false); if (ok) onClose() }}><Trash2 aria-hidden />Verwijderen</button>
              </div>
            </div>
          )}

          {mode === "close" && (
            <div className="inline-form">
              <p className="field-label">Hoe sluit je deze taak af?</p>
              <div className="snooze-options">
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run("succesvol", {}, "Afgerond als succesvol")}><ThumbsUp aria-hidden />Succesvol</button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run("niet_succesvol", {}, "Afgerond als niet succesvol")}><XCircle aria-hidden />Niet succesvol</button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run("onvoldoende_bewijs", {}, "Afgerond: onvoldoende bewijs")}><CircleSlash aria-hidden />Onvoldoende bewijs</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setMode("reject")}><ThumbsDown aria-hidden />Afwijzen</button>
              </div>
              {task.experiments.some(e => !e.outcome) && <p className="field-hint">Er loopt nog een meting. Die gaat door; de automatische eindbeoordeling kan je keuze later aanvullen.</p>}
              <div className="inline-form-actions"><button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Annuleren</button></div>
            </div>
          )}

          {mode === "copy-fallback" && (
            <div className="inline-form">
              <label className="field-label" htmlFor="prompt-text">Kopiëren lukte niet automatisch. Selecteer en kopieer de tekst hieronder.</label>
              <textarea id="prompt-text" className="textarea" readOnly value={promptText} style={{ minHeight: 140 }} onFocus={e => e.currentTarget.select()} autoFocus />
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Sluiten</button>
              </div>
            </div>
          )}

          {mode === null && (
            <>
              <div className="panel-actions">
                {column === "beoordelen" && diag.actionType === "geen" && (<>
                  <button className="btn btn-primary" disabled={busy} onClick={() => run("afgewezen", { note: `Al opgelost: ${signal.resolved || diag.verdict.text}` }, "Gesloten als al opgelost")}><CheckCircle2 aria-hidden />Controleren en sluiten</button>
                </>)}
                {column === "beoordelen" && diag.actionType !== "geen" && (<>
                  <button className="btn btn-primary" disabled={busy || blocked} title={blocked ? "Eerst moeten de cijfers bevestigd zijn" : undefined} onClick={() => run("goedgekeurd", {}, "Ingepland. Je vindt de taak onder Gepland.")}><ThumbsUp aria-hidden />Inplannen als taak</button>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => setMode("snooze")}><Clock aria-hidden />Uitstellen</button>
                  <span className="grow" />
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setMode("reject")}><ThumbsDown aria-hidden />Afwijzen</button>
                </>)}
                {column === "gepland" && (<>
                  <button className="btn btn-primary" disabled={busy || blocked} onClick={() => run("in_uitvoering", {}, "Gestart. De taak staat onder In uitvoering.")}><Play aria-hidden />Start uitvoering</button>
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
                <button className="link-btn" onClick={copyToClaude}><Copy aria-hidden />Prompt kopiëren voor tweede mening</button>
                {raw.kind === "eigen" && <button className="link-btn link-danger" onClick={() => setMode("delete")}><Trash2 aria-hidden />Taak verwijderen</button>}
                {task.updatedAt && <span className="meta-line" style={{ marginLeft: "auto" }}>Gewijzigd {dateShort(task.updatedAt)}</span>}
              </div>
            </>
          )}
        </footer>
      </div>
    </>
  )
}

function FindingsTable({ rows, quiet }: { rows: { tone: FindingTone; text: string }[]; quiet?: boolean }) {
  return (
    <table className={`ptable findings-table${quiet ? " is-quiet" : ""}`}>
      <thead><tr><th>Soort</th><th>Bevinding</th></tr></thead>
      <tbody>{rows.map((f, i) => (
        <tr key={i}><td className="nowrap"><Badge tone={FINDING_TAG[f.tone].tone}>{FINDING_TAG[f.tone].label}</Badge></td><td>{f.text}</td></tr>
      ))}</tbody>
    </table>
  )
}

function gainLabel(e: Estimate) {
  return e.gain >= 1 ? `+${num(e.low)}–${num(e.high)} clicks / 28 d` : "minder dan 1 click"
}

function capitalizeFirst(t: string) { return t ? t[0].toUpperCase() + t.slice(1) : t }

function ExperimentSummary({ exp }: { exp: Experiment }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="meta-line" style={{ marginBottom: 6 }}><FlaskConical aria-hidden />Aangepast op {dateLong(exp.changed_at)}{exp.kind && exp.kind !== "experiment" && <Badge tone="neutral">{EXP_KIND[exp.kind].label}</Badge>}<CorrectButton e={exp} /></div>
      <p style={{ fontSize: "var(--fs-sm)", marginBottom: 10 }}>{exp.description}</p>
      <CorrectionNote e={exp} />
      <MeasureTimeline e={exp} />
      <div style={{ marginTop: 10 }}><MeasurementReport e={exp} compact /></div>
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
          {e.scopeRows?.map(r => <tr key={r.label} className="calc-scope"><th>{r.label}</th><td>{r.value}</td></tr>)}
          <tr><th>Vertoningen in de som (28 dagen)</th><td>{num(e.impressions)}</td></tr>
          {e.basis === "positie" ? (<>
            <tr><th>Nu{e.scopeRows?.length ? " (zoekwoord als geheel)" : ""}: positie {pos(e.fromPosition)}</th><td>verwachte doorklik {pct(e.ctrFrom, 2)}</td></tr>
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
