"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, BookOpenCheck, CircleSlash, GraduationCap, History, RotateCcw, Sparkles, Undo2, XCircle } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { describeMatch, type Lesson, type LessonRejection } from "@/lib/learning"
import { columnOf } from "@/lib/workflow"
import type { Task } from "@/lib/types"
import { dateShort } from "@/lib/format"
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui"

interface LogRow { id: number; lesson_key: string; at: string; action: string; detail: string | null; by: string | null }
interface Data { lessons: Lesson[]; log: LogRow[]; stats: { lopend: number; afgerond: number; afgewezen: number; gepubliceerd: number } | null }

const SOURCE_LABEL: Record<Lesson["source"], string> = { meting: "Uit metingen", afwijzing: "Uit afwijzingen", content: "Uit content", feedback: "Uit je feedback" }
const ACTION_LABEL: Record<string, string> = { nieuw: "Nieuwe les", bijgewerkt: "Bijgewerkt", vervallen: "Vervallen", "weer-geldig": "Weer geldig", teruggedraaid: "Teruggedraaid", hersteld: "Hersteld" }

export default function LearnedView() {
  const { toast, reload, tasks, openTask } = useWorkspace()
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/lessons", { cache: "no-store" })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(String(body.key || body.action))
    try {
      const r = await fetch("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      toast(done); await load(); reload()
    } catch (e: any) { toast(e.message, "error") } finally { setBusy(null) }
  }

  // Vanuit het logboek naar de les springen (en kort oplichten)
  const showLesson = (key: string) => {
    const el = document.getElementById(lessonId(key))
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash")
  }

  const active = (data?.lessons || []).filter(l => l.status === "actief")
  const applied = active.filter(l => l.effect && l.effect.type !== "info")
  const watching = active.filter(l => !applied.includes(l))
  const inactive = (data?.lessons || []).filter(l => l.status !== "actief")
  const s = data?.stats

  return (
    <>
      <PageHeader title="Lessen"
        status={!data ? null : !active.length ? { tone: "info", text: "Nog geen lessen. Elke afgeronde meting en elke afwijzing telt direct mee." } : { tone: "info", text: `${applied.length} ${applied.length === 1 ? "les past" : "lessen passen"} nu zelf iets aan${watching.length ? `, ${watching.length} ${watching.length === 1 ? "wordt" : "worden"} nog in de gaten gehouden` : ""}. Alles is terug te draaien.` }}
        sub="Wat hebben we geleerd? Conclusies uit afgeronde metingen en jullie beslissingen, en wat het systeem daardoor zelf anders doet."
        actions={<button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => act({ action: "recompute" }, "Lessen opnieuw berekend")}><RotateCcw aria-hidden />Nu opnieuw berekenen</button>}>
        <details className="page-more"><summary>Hoe het systeem leert</summary><p className="page-sub small"><Rule /></p></details>
      </PageHeader>

      {err && <Alert tone="error" title="Lessen konden niet worden geladen">{err}</Alert>}

      <div className="learn-stats">
        <Stat label="Afgeronde metingen" value={s?.afgerond} />
        <Stat label="Lopende metingen" value={s?.lopend} />
        <Stat label="Afgewezen adviezen" value={s?.afgewezen} />
        <Stat label="Gemeten publicaties" value={s?.gepubliceerd} />
      </div>

      {!data ? <Skeleton height={160} /> : data.lessons.length === 0 ? (
        <div className="card"><EmptyState icon={<BookOpenCheck />} title="Nog niets geleerd"
          text={<><Rule /> Een meting is na 14, 28 en 56 dagen klaar. <b>Zo versnel je dit:</b> markeer elke uitgevoerde taak als uitgevoerd (dan start de meting), pas per pagina één ding tegelijk aan, en geef bij afwijzen altijd een reden.</>} /></div>
      ) : (
        <>
          <Section title="Automatisch toegepast" sub="Deze lessen veranderen nu de volgorde van adviezen of de score van contentkansen." icon={<Sparkles aria-hidden />}>
            {applied.length === 0 ? <p className="muted small">Nog geen lessen met voldoende zekerheid om zelf toe te passen.</p> : applied.map(l => <LessonCard key={l.key} l={l} tasks={tasks} openTask={openTask} busy={busy === l.key} onRevert={() => act({ action: "revert", key: l.key }, "Les teruggedraaid")} />)}
          </Section>
          {watching.length > 0 && (
            <Section title="Ter informatie" sub="Wordt (nog) niet automatisch toegepast." icon={<BookOpenCheck aria-hidden />}>
              {watching.map(l => <LessonCard key={l.key} l={l} tasks={tasks} openTask={openTask} busy={busy === l.key} onRevert={() => act({ action: "revert", key: l.key }, "Les uitgezet")} />)}
            </Section>
          )}
          {inactive.length > 0 && (
            <Section title="Teruggedraaid of vervallen" sub="Hebben geen invloed meer." icon={<CircleSlash aria-hidden />}>
              {inactive.map(l => <LessonCard key={l.key} l={l} tasks={tasks} openTask={openTask} busy={busy === l.key} onRestore={l.status === "teruggedraaid" ? () => act({ action: "restore", key: l.key }, "Les weer actief") : undefined} />)}
            </Section>
          )}
        </>
      )}

      {data && data.log.length > 0 && (
        <section className="card" style={{ marginTop: 24 }} aria-labelledby="log-title">
          <div className="card-head"><div><h2 className="card-title" id="log-title"><History aria-hidden />Logboek</h2><p className="card-sub">Wat het systeem zelf heeft aangepast, en wie iets terugdraaide</p></div></div>
          <div className="card-body">
            <ul className="learn-log">
              {data.log.map(r => (
                <li key={r.id}><span className="learn-log-date">{dateShort(r.at)}</span><Badge tone={r.action === "teruggedraaid" || r.action === "vervallen" ? "neutral" : "success"}>{ACTION_LABEL[r.action] || r.action}</Badge><span>{r.detail}{r.by && r.by !== "systeem" ? <span className="subtle"> · {r.by}</span> : null}
                  {data.lessons.some(l => l.key === r.lesson_key) && <> <button className="link-btn learn-log-link" onClick={() => showLesson(r.lesson_key)}>Bekijk les en reden<ArrowRight aria-hidden /></button></>}</span></li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  return <div className="learn-stat"><span className="learn-stat-value">{value ?? "—"}</span><span className="learn-stat-label">{label}</span></div>
}

function Section({ title, sub, icon, children }: { title: string; sub: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="learn-section">
      <div className="section-head"><div><h2 className="section-title learn-section-title">{icon}{title}</h2><p className="section-sub">{sub}</p></div></div>
      <div className="learn-list">{children}</div>
    </section>
  )
}

const lessonId = (key: string) => `les-${key.replace(/[^a-z0-9]+/gi, "-")}`
const nlFactor = (f: number) => f.toFixed(2).replace(/0$/, "").replace(".", ",")
const ZEKERHEID: Record<Lesson["confidence"], string> = {
  laag: "Zekerheid laag: nog weinig bewijs (1 of 2 keer). Het effect is daarom klein en groeit als het vaker gebeurt.",
  middel: "Zekerheid middel: 3 tot 5 keer gezien.",
  hoog: "Zekerheid hoog: 6 keer of vaker gezien.",
}

// Wat leert het systeem hiervan, in gewone taal, en wat verandert er nu concreet?
function Learning({ l, affected, openTask }: { l: Lesson; affected: Task[]; openTask: (k: string) => void }) {
  const e = l.effect
  const off = l.status !== "actief"
  const lines: React.ReactNode[] = []
  if (!e) return null
  if (e.type === "content-afwijzing") {
    lines.push(<>Nieuwe contentkansen van deze soort krijgen bij de volgende scan een lagere score: <b>×{nlFactor(e.factor || 1)}</b>. Elke volgende afwijzing van dezelfde soort verlaagt dit verder (×0,85 per keer, nooit lager dan ×0,5).</>)
    lines.push(<>Ze verdwijnen niet: je ziet ze nog steeds, alleen lager in de lijst. Zo blijft de beslissing bij jullie.</>)
  } else if (e.type === "afwijzing") {
    lines.push(<>{describeMatch(e.match || {})} zakken nu in de prioriteit: <b>×{nlFactor(e.factor || 1)}</b> (×0,85 per afwijzing, nooit lager dan ×0,5). Ze blijven zichtbaar op het bord.</>)
    if (!off) lines.push(affected.length
      ? <>Dit raakt nu {affected.length} {affected.length === 1 ? "advies" : "adviezen"} in Te beoordelen: {affected.slice(0, 4).map((t, i) => <span key={t.key}>{i > 0 ? ", " : ""}<button className="link-btn" onClick={() => openTask(t.key)}>{t.signal.query ? `"${t.signal.query}"` : t.signal.headline}</button></span>)}{affected.length > 4 ? ` en ${affected.length - 4} meer` : ""}.</>
      : <>Er staan nu geen vergelijkbare adviezen in Te beoordelen.</>)
  } else if (e.type === "prioriteit") {
    lines.push(<>{describeMatch(e.match || {})} {(e.factor || 1) > 1 ? "krijgen iets voorrang" : "zakken iets in de prioriteit"}: <b>×{nlFactor(e.factor || 1)}</b>. Het effect blijft tussen ×0,7 en ×1,3 en groeit pas als volgende metingen dit bevestigen.</>)
    if (!off && affected.length) lines.push(<>Dit raakt nu {affected.length} {affected.length === 1 ? "advies" : "adviezen"} in Te beoordelen.</>)
  } else if (e.type === "content-feedback" || l.source === "feedback") {
    lines.push(<>{e.text}</>)
    const quotes = l.evidence.reasons || []
    if (quotes.length) lines.push(<>Herkend in je eigen woorden: {quotes.slice(0, 3).map((q, i) => <span key={i} className="learn-quote">“{q}”</span>)}</>)
    if (e.type === "content-feedback" && e.factor) lines.push(<>Schrijf je dit vaker, dan wordt het effect sterker (×0,85 per keer, nooit lager dan ×0,5). Ze blijven wel zichtbaar.</>)
  } else lines.push(<>{e.text}</>)
  lines.push(<span className="subtle">{ZEKERHEID[l.confidence]}{off ? " Deze les is nu uitgeschakeld en heeft geen invloed." : " Klopt dit niet? Draai de les terug; dan telt het niet meer mee."}</span>)
  return (
    <div className="learn-effect">
      <GraduationCap aria-hidden />
      <div><p className="learn-block-title">Wat het systeem hiervan leert</p><ul className="learn-lines">{lines.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    </div>
  )
}

function Rejections({ items, openTask }: { items: LessonRejection[]; openTask: (k: string) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 5)
  return (
    <div className="learn-why">
      <p className="learn-block-title"><XCircle aria-hidden />Waarom afgewezen</p>
      <ul className="learn-rej">
        {shown.map((r, i) => (
          <li key={i}>
            <span className="learn-rej-title">{r.href ? <Link href={r.href}>{r.title}</Link> : r.taskKey ? <button className="link-btn" onClick={() => openTask(r.taskKey!)}>{r.title}</button> : r.title}</span>
            {r.reasons.length > 0 && <span className="learn-rej-tags">{r.reasons.map(t => <Badge key={t} tone="neutral">{t}</Badge>)}</span>}
            <span className="learn-rej-note">{r.note ? `“${r.note}”` : <span className="subtle">Geen toelichting gegeven.</span>}</span>
            {(r.by || r.at) && <span className="subtle small">{[r.by, r.at ? dateShort(r.at) : null].filter(Boolean).join(" · ")}</span>}
          </li>
        ))}
      </ul>
      {items.length > 5 && <button className="link-btn" onClick={() => setAll(x => !x)}>{all ? "Minder tonen" : `Alle ${items.length} tonen`}</button>}
    </div>
  )
}

function LessonCard({ l, tasks, openTask, busy, onRevert, onRestore }: { l: Lesson; tasks: Task[]; openTask: (k: string) => void; busy: boolean; onRevert?: () => void; onRestore?: () => void }) {
  // Welke adviezen in "Te beoordelen" raakt deze les nu?
  // Zelfde regel als het bord: afwijzingen tellen bij exact dezelfde soort én zoekintentie
  const [, rKind, rIntent] = l.key.split("|")
  const review = tasks.filter(t => columnOf(t.status) === "beoordelen")
  const affected = l.effect?.type === "afwijzing"
    ? review.filter(t => t.signal.kind === rKind && (t.signal.intent || "-") === rIntent && (t.signal.rejectedSimilar || 0) > 0)
    : l.effect?.type === "prioriteit" ? review.filter(t => t.signal.lesson?.key === l.key) : []
  // Terugval: live uitleg niet beschikbaar, dan de bij de berekening opgeslagen kansen (zonder reden)
  const rejections: LessonRejection[] | undefined = l.rejections ?? (l.evidence.items?.length ? l.evidence.items.map(it => ({ title: it.title, href: `/content/${it.id}?van=geleerd`, reasons: [], note: null, by: null, at: null })) : undefined)
  return (
    <article className={`card learn-card${l.status !== "actief" ? " is-inactive" : ""}`} id={lessonId(l.key)}>
      <div className="learn-card-top">
        <Badge tone="neutral">{SOURCE_LABEL[l.source]}</Badge>
        <Badge tone={l.confidence === "hoog" ? "success" : l.confidence === "middel" ? "info" : "neutral"}>Zekerheid {l.confidence}</Badge>
        {l.first_seen && <span className="subtle small">sinds {dateShort(l.first_seen)}</span>}
        {l.status === "teruggedraaid" && <span className="subtle small">teruggedraaid{l.reverted_by ? ` door ${l.reverted_by}` : ""}{l.reverted_at ? ` op ${dateShort(l.reverted_at)}` : ""}</span>}
      </div>
      <h3 className="learn-title">{l.title}</h3>
      <p><b>Bewijs:</b> {l.conclusion}</p>
      <Reliability l={l} />
      {rejections && rejections.length > 0 && <Rejections items={rejections} openTask={openTask} />}
      {rejections && rejections.length === 0 && (l.source === "afwijzing" || l.effect?.type === "content-afwijzing") && <p className="subtle small">De afgewezen {l.source === "afwijzing" ? "adviezen zijn" : "kansen zijn"} inmiddels weer opgepakt of verwijderd; druk op "Nu opnieuw berekenen" om de les bij te werken.</p>}
      <Learning l={l} affected={affected} openTask={openTask} />
      {l.evidence.examples?.length ? (
        <details className="learn-examples" open={l.evidence.examples.length <= 3}><summary>Gebruikte metingen ({l.evidence.examples.length})</summary><ul>{l.evidence.examples.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
      ) : null}
      <div className="learn-actions">
        {onRevert && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onRevert}><Undo2 aria-hidden />Terugdraaien</button>}
        {onRestore && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onRestore}><RotateCcw aria-hidden />Weer toepassen</button>}
      </div>
    </article>
  )
}

// Betrouwbaarheid: hoeveel bewijs, eerdere resultaten en hoe zeker (docs/DESIGN.md)
const UNCERTAINTY: Record<Lesson["confidence"], string> = {
  laag: "Nog weinig bewijs; de les kan nog omslaan.",
  middel: "Redelijk bewijs; de volgende uitkomsten kunnen het effect nog verschuiven.",
  hoog: "Bevestigd door meerdere uitkomsten.",
}
function Reliability({ l }: { l: Lesson }) {
  const e = l.evidence
  const unit = l.source === "meting" || l.source === "content" ? (e.n === 1 ? "meting" : "metingen") : l.source === "afwijzing" ? (e.n === 1 ? "afwijzing" : "afwijzingen") : (e.n === 1 ? "toelichting" : "toelichtingen")
  const results = e.success !== undefined || e.fail !== undefined ? `${e.success || 0} geslaagd, ${e.fail || 0} niet geslaagd` : null
  return (
    <dl className="trust-line">
      <div><dt>Bewijs</dt><dd>{e.n} {unit}</dd></div>
      {results && <div><dt>Eerdere resultaten</dt><dd>{results}{e.rate !== undefined && e.baseline !== undefined ? ` (${Math.round(e.rate * 100)}% tegen gemiddeld ${Math.round(e.baseline * 100)}%)` : ""}</dd></div>}
      <div><dt>Zekerheid</dt><dd>{l.confidence[0].toUpperCase() + l.confidence.slice(1)}: {UNCERTAINTY[l.confidence]}</dd></div>
    </dl>
  )
}

// Eén regel, op elke plek hetzelfde (zie lib/learning.ts)
function Rule() {
  return <>De regel: elk afgerond resultaat telt direct mee. Eén resultaat verschuift de prioriteit een klein beetje (bijvoorbeeld ×1,07); hoe vaker uitkomsten elkaar bevestigen, hoe groter het effect (nooit meer dan ×0,7 tot ×1,3). Een afgewezen advies telt ook direct mee (×0,85 per afwijzing, nooit lager dan ×0,5). En per pagina onthoudt het systeem welke routes al geprobeerd zijn.</>
}
