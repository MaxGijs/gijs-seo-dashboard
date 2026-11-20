"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, BookOpenCheck, Check, CircleSlash, FlaskConical, GraduationCap, History, ListChecks, MessageSquareText, RotateCcw, Undo2, XCircle } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { describeMatch, type Lesson, type LessonRejection } from "@/lib/learning"
import { columnOf } from "@/lib/workflow"
import type { Task } from "@/lib/types"
import { dateShort } from "@/lib/format"
import { Alert, Badge, EmptyState, PageHeader, Skeleton, StatusLine } from "@/components/ui"
import { useAccuracy } from "@/components/views/AccuracyCard"
import { accuracySentence } from "@/lib/accuracy"

interface LogRow { id: number; lesson_key: string; at: string; action: string; detail: string | null; by: string | null }
interface Data { lessons: Lesson[]; log: LogRow[]; stats: { lopend: number; afgerond: number; afgewezen: number; gepubliceerd: number } | null }

const SOURCE_LABEL: Record<Lesson["source"], string> = { meting: "Uit metingen", afwijzing: "Uit afwijzingen", content: "Uit content", feedback: "Uit je feedback" }
const ACTION_LABEL: Record<string, string> = { nieuw: "Nieuwe les", bijgewerkt: "Bijgewerkt", vervallen: "Vervallen", "weer-geldig": "Weer geldig", teruggedraaid: "Teruggedraaid", hersteld: "Hersteld", bevestigd: "Bevestigd" }
// Bewezen = uit afgeronde experimenten en gemeten publicaties; voorkeur = uit menselijke beslissingen
const isProven = (l: Lesson) => l.source === "meting" || (l.source === "content" && l.effect?.type !== "content-afwijzing")
// Voorstel: een voorkeur uit één afwijzing die niet bevestigd is (ook bij lessen van vóór deze regel)
const isPending = (l: Lesson) => !isProven(l) && !l.confirmed_at && !!l.effect && l.effect.type !== "info" && l.effect.factor !== undefined && (l.effect.pending ?? (l.evidence.n || 0) < 2)

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
  const proven = active.filter(isProven)
  const prefs = active.filter(l => !isProven(l))
  const pending = prefs.filter(isPending)
  const applied = prefs.filter(l => !isPending(l) && l.effect && l.effect.type !== "info" && (l.effect.factor !== undefined || l.effect.type === "content-feedback"))
  const info = prefs.filter(l => !applied.includes(l) && !pending.includes(l))
  const inactive = (data?.lessons || []).filter(l => l.status !== "actief")
  const s = data?.stats
  const card = (l: Lesson) => <LessonCard key={l.key} l={l} tasks={tasks} openTask={openTask} busy={busy === l.key}
    onRevert={() => act({ action: "revert", key: l.key }, "Les teruggedraaid")}
    onConfirm={isPending(l) ? () => act({ action: "confirm", key: l.key }, "Bevestigd: wordt nu toegepast") : undefined} />
  const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`

  return (
    <>
      <PageHeader title="Lessen"
        status={!data ? null : { tone: "info", text: `${proven.length ? plural(proven.length, "bewezen les", "bewezen lessen") : "Nog geen bewezen lessen"} uit experimenten (${plural(s?.afgerond ?? 0, "afgerond experiment", "afgeronde experimenten")}). ${plural(applied.length, "voorkeur", "voorkeuren")} uit jullie feedback ${applied.length === 1 ? "wordt" : "worden"} toegepast${pending.length ? `, ${plural(pending.length, "voorstel wacht", "voorstellen wachten")} op bevestiging` : ""}.` }}
        sub="Wat is bewezen met experimenten, welke voorkeuren komen uit jullie beslissingen, en welke vaste regels gebruikt het systeem. Alles is terug te draaien."
        actions={<button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => act({ action: "recompute" }, "Lessen opnieuw berekend")}><RotateCcw aria-hidden />Nu opnieuw berekenen</button>}>
        <details className="page-more"><summary>Hoe het systeem leert</summary><p className="page-sub small"><Rule /></p></details>
      </PageHeader>

      {err && <Alert tone="error" title="Lessen konden niet worden geladen">{err}</Alert>}

      <AccuracySummary />

      <div className="learn-stats">
        <Stat label="Afgeronde experimenten" value={s?.afgerond} />
        <Stat label="Lopende metingen" value={s?.lopend} />
        <Stat label="Afgewezen adviezen" value={s?.afgewezen} />
        <Stat label="Gemeten publicaties" value={s?.gepubliceerd} />
      </div>

      {!data ? <Skeleton height={160} /> : (
        <>
          <Section id="bewezen" title="Bewezen lessen uit experimenten" sub="Alleen uit afgeronde experimenten met genoeg data. Validaties en metingen zonder oordeel tellen niet mee; een experimentfamilie telt als één experiment." icon={<FlaskConical aria-hidden />}>
            {proven.length ? proven.map(card) : <p className="muted small">Nog geen. Een bewezen les ontstaat pas uit afgeronde experimenten: na 56 dagen, met minstens 100 vertoningen. Tot die tijd beïnvloeden alleen jullie voorkeuren de volgorde.</p>}
          </Section>

          <Section id="voorkeuren" title="Voorkeuren uit jullie feedback" sub="Uit afwijzingen en toelichtingen. Dit is wat jullie willen, geen bewezen SEO-effect. Eén afwijzing is een voorstel; pas bij een tweede vergelijkbare afwijzing, of als je hem bevestigt, verandert er iets." icon={<MessageSquareText aria-hidden />}>
            {!prefs.length && <p className="muted small">Nog geen. Geef bij afwijzen altijd een reden; daar leert het systeem van.</p>}
            {applied.length > 0 && <><h3 className="learn-sub">Toegepast ({applied.length})</h3>{applied.map(card)}</>}
            {pending.length > 0 && <><h3 className="learn-sub">Voorstellen ({pending.length})</h3><p className="subtle small learn-sub-text">Nog niet toegepast. Klopt het? Bevestig het, dan telt het nu al mee.</p>{pending.map(card)}</>}
            {info.length > 0 && <><h3 className="learn-sub">Ter informatie ({info.length})</h3>{info.map(card)}</>}
          </Section>

          <Section id="regels" title="Vaste regels en controles" sub="Regels die het systeem altijd toepast. Ze komen niet uit metingen of feedback en veranderen alleen als wij de regel aanpassen." icon={<ListChecks aria-hidden />}>
            <FixedRules />
          </Section>

          {inactive.length > 0 && (
            <Section id="uit" title="Teruggedraaid of vervallen" sub="Hebben geen invloed meer." icon={<CircleSlash aria-hidden />}>
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

// Hoe goed klopt de voorspelling? Eén regel, met de details op Experimenten
function AccuracySummary() {
  const a = useAccuracy()
  if (!a.rows.length) return null
  return (
    <section className="card card-pad accuracy acc-summary" aria-label="Nauwkeurigheid van de voorspelling">
      <StatusLine tone={a.level === "geen" || a.level === "te-weinig" ? "info" : (a.hitRate ?? 0) >= 0.5 && (a.skill ?? 0) > 0 ? "good" : "attention"}>Voorspelling: {accuracySentence(a)}</StatusLine>
      <Link href="/experimenten" className="btn btn-ghost btn-sm">Voorspeld tegen gemeten bekijken<ArrowRight aria-hidden /></Link>
    </section>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  return <div className="learn-stat"><span className="learn-stat-value">{value ?? "—"}</span><span className="learn-stat-label">{label}</span></div>
}

// Vaste regels: wat het systeem altijd doet, los van metingen en feedback
const RULES: [string, string][] = [
  ["Experiment, validatie of meting", "Een aanpassing is pas een experiment als er genoeg data is (minstens 100 vertoningen in 28 dagen), de pagina uit de opbouwfase is (56 dagen), de doelpagina klopt, de nulmeting stabiel is en er geen andere wijziging op dezelfde pagina loopt. Anders wordt hij gevolgd zonder oordeel. Technische controles zijn validaties."],
  ["Experimentfamilies", "Eén aanpassing op meerdere pagina's (zelfde beschrijving, binnen 3 dagen) is één experiment met meerdere meetpunten. Het telt één keer mee bij lessen en nauwkeurigheid; verschillen per pagina blijven zichtbaar."],
  ["Eindoordeel", "Na 56 dagen: geslaagd, niet geslaagd of geen duidelijk effect. Te weinig data: verder meten tot 84 dagen, daarna \"onvoldoende data\". Doelpagina kapot of doorverwezen: \"meting ongeldig\". Een andere wijziging op dezelfde pagina of hetzelfde zoekwoord: \"beïnvloed\"."],
  ["Staat al op de site", "Nieuws dat inhoudelijk op een bestaande pagina of eerder afgewezen kans lijkt, wordt niet opnieuw als nieuw artikel voorgesteld maar als \"bestaande pagina bijwerken\"."],
  ["Verouderde tekst en refresh", "Een zin met een verlopen jaartal, nieuws over een regeling die de pagina noemt, of minstens 30% minder vertoningen geeft een refresh-melding. Die verloopt niet vanzelf."],
  ["Voorkeuren uit feedback", "Eén afwijzing is een voorstel. Pas vanaf twee vergelijkbare afwijzingen, of na bevestiging, verandert de score (×0,85 per keer, nooit lager dan ×0,5). Een onderwerp telt alleen als het in de titel van de kans staat. Verkeerd gekoppeld nieuws telt nergens mee."],
]
function FixedRules() {
  return <ul className="learn-rules">{RULES.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ul>
}

function Section({ id, title, sub, icon, children }: { id?: string; title: string; sub: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="learn-section" aria-labelledby={id ? `sec-${id}` : undefined} data-section={id}>
      <div className="section-head"><div><h2 className="section-title learn-section-title" id={id ? `sec-${id}` : undefined}>{icon}{title}</h2><p className="section-sub">{sub}</p></div></div>
      <div className="learn-list">{children}</div>
    </section>
  )
}

const lessonId = (key: string) => `les-${key.replace(/[^a-z0-9]+/gi, "-")}`
const nlFactor = (f: number) => f.toFixed(2).replace(/0$/, "").replace(".", ",")
const ZEKERHEID: Record<Lesson["confidence"], string> = {
  laag: "Zekerheid laag: nog weinig bewijs (1 of 2 keer). Het effect is klein en groeit als het vaker gebeurt.",
  middel: "Zekerheid middel: 3 tot 5 keer gezien.",
  hoog: "Zekerheid hoog: 6 keer of vaker gezien.",
}

// Wat leert het systeem hiervan, in gewone taal, en wat verandert er nu concreet?
function Learning({ l, affected, openTask, pending }: { l: Lesson; affected: Task[]; openTask: (k: string) => void; pending: boolean }) {
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
      ? <>{pending ? "Na bevestiging zakken" : "Dit raakt nu"} {affected.length} {affected.length === 1 ? "advies" : "adviezen"} in Te beoordelen: {affected.slice(0, 4).map((t, i) => <span key={t.key}>{i > 0 ? ", " : ""}<button className="link-btn" onClick={() => openTask(t.key)}>{t.signal.query ? `"${t.signal.query}"` : t.signal.headline}</button></span>)}{affected.length > 4 ? ` en ${affected.length - 4} meer` : ""}.</>
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
  if (pending && !off) lines.unshift(<b>Voorstel, nog niet toegepast. Dit gebeurt pas bij een tweede vergelijkbare afwijzing, of als je hem bevestigt.</b>)
  if (l.confirmed_at && !off) lines.push(<span className="subtle">Bevestigd{l.confirmed_by ? ` door ${l.confirmed_by}` : ""} op {dateShort(l.confirmed_at)}.</span>)
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

function LessonCard({ l, tasks, openTask, busy, onRevert, onRestore, onConfirm }: { l: Lesson; tasks: Task[]; openTask: (k: string) => void; busy: boolean; onRevert?: () => void; onRestore?: () => void; onConfirm?: () => void }) {
  // Welke adviezen in "Te beoordelen" raakt deze les nu?
  // Zelfde regel als het bord: afwijzingen tellen bij exact dezelfde soort én zoekintentie
  const [, rKind, rIntent] = l.key.split("|")
  const review = tasks.filter(t => columnOf(t.status) === "beoordelen")
  // Bij een voorstel: welke adviezen zouden na bevestiging zakken (nu nog niet, want het wordt nog niet toegepast)
  const pend = isPending(l)
  const affected = l.effect?.type === "afwijzing"
    ? review.filter(t => t.signal.kind === rKind && (t.signal.intent || "-") === rIntent && (pend || (t.signal.rejectedSimilar || 0) > 0))
    : l.effect?.type === "prioriteit" ? review.filter(t => t.signal.lesson?.key === l.key) : []
  // Terugval: live uitleg niet beschikbaar, dan de bij de berekening opgeslagen kansen (zonder reden)
  const rejections: LessonRejection[] | undefined = l.rejections ?? (l.evidence.items?.length ? l.evidence.items.map(it => ({ title: it.title, href: `/content/${it.id}?van=geleerd`, reasons: [], note: null, by: null, at: null })) : undefined)
  return (
    <article className={`card learn-card${l.status !== "actief" ? " is-inactive" : ""}`} id={lessonId(l.key)}>
      <div className="learn-card-top">
        <Badge tone="neutral">{SOURCE_LABEL[l.source]}</Badge>
        {pend && l.status === "actief" && <Badge tone="warning">Voorstel</Badge>}
        <Badge tone={l.confidence === "hoog" ? "success" : l.confidence === "middel" ? "info" : "neutral"}>Zekerheid {l.confidence}</Badge>
        {l.first_seen && <span className="subtle small">sinds {dateShort(l.first_seen)}</span>}
        {l.status === "teruggedraaid" && <span className="subtle small">teruggedraaid{l.reverted_by ? ` door ${l.reverted_by}` : ""}{l.reverted_at ? ` op ${dateShort(l.reverted_at)}` : ""}</span>}
      </div>
      <h3 className="learn-title">{l.title}</h3>
      <p><b>Bewijs:</b> {l.conclusion}</p>
      <Reliability l={l} />
      {rejections && rejections.length > 0 && <Rejections items={rejections} openTask={openTask} />}
      {rejections && rejections.length === 0 && (l.source === "afwijzing" || l.effect?.type === "content-afwijzing") && <p className="subtle small">De afgewezen {l.source === "afwijzing" ? "adviezen zijn" : "kansen zijn"} inmiddels weer opgepakt of verwijderd; druk op "Nu opnieuw berekenen" om de les bij te werken.</p>}
      <Learning l={l} affected={affected} openTask={openTask} pending={pend} />
      {l.evidence.examples?.length ? (
        <details className="learn-examples" open={l.evidence.examples.length <= 3}><summary>Gebruikte metingen ({l.evidence.examples.length})</summary><ul>{l.evidence.examples.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
      ) : null}
      <div className="learn-actions">
        {onConfirm && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onConfirm}><Check aria-hidden />Bevestigen en toepassen</button>}
        {onRevert && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onRevert}><Undo2 aria-hidden />{pend ? "Klopt niet" : "Terugdraaien"}</button>}
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
  const unit = l.source === "afwijzing" || l.effect?.type === "content-afwijzing" ? (e.n === 1 ? "afwijzing" : "afwijzingen") : l.source === "meting" || l.source === "content" ? (e.n === 1 ? "meting" : "metingen") : (e.n === 1 ? "toelichting" : "toelichtingen")
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
  return <>Bewezen lessen komen alleen uit afgeronde experimenten met genoeg data; één resultaat verschuift de prioriteit een klein beetje (bijvoorbeeld ×1,07), en hoe vaker uitkomsten elkaar bevestigen, hoe groter het effect (nooit meer dan ×0,7 tot ×1,3). Voorkeuren uit afwijzingen zijn geen bewijs: één afwijzing is een voorstel, pas vanaf twee vergelijkbare (of na bevestiging) zakt de score (×0,85 per keer, nooit lager dan ×0,5). Per pagina onthoudt het systeem welke routes al geprobeerd zijn.</>
}
