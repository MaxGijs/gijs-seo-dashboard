"use client"

import SpeedAround from "@/components/panel/SpeedAround"
import { CorrectButton, CorrectionNote } from "@/components/panel/ExperimentCorrect"
import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CalendarClock, ChevronRight, FlaskConical, Newspaper, Pencil, Search } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { useContentIdeas } from "@/lib/content/useContent"
import { ArticleResults } from "@/components/content/ContentPanel"
import type { Experiment } from "@/lib/types"
import { dateLong, dateShort, num, pct, pos } from "@/lib/format"
import { Badge, EmptyState, KindLabel, PageHeader, Skeleton, type StatusTone } from "@/components/ui"
import AccuracyCard from "@/components/views/AccuracyCard"
import { familyOutcome, goalOf, KIND_META, nextMeasurement, OUTCOME_META, type ExpKind, type Outcome } from "@/lib/experiment"
import type { Task } from "@/lib/types"
import { ExperimentFacts, MeasurementReport, MeasureTimeline } from "@/components/panel/MeasurementReport"
import { ADVICE, conclusionOf, latestReport, SIGNAL, STATUS, statusOf, summarizeSignals, type Advice, type StatusKey } from "@/lib/measureLogic"
import { normalize } from "@/lib/format"

function ExpOutcome({ e }: { e: Experiment }) {
  const last = conclusionOf(e)?.result || e.result_28d || e.result_14d
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
    const done = list.filter(e => e.outcome && conclusionOf(e)?.result.evidence !== "te weinig data")
    const ok = done.filter(e => e.outcome === "succesvol").length
    const withGain = done.filter(e => typeof conclusionOf(e)?.result.actualGainCorrected === "number" && typeof (e.predicted?.gain ?? e.baseline?.predictedGain) === "number")
    const pred = withGain.reduce((a, e) => a + (e.predicted?.gain ?? e.baseline?.predictedGain), 0)
    const act = withGain.reduce((a, e) => a + conclusionOf(e)!.result.actualGainCorrected, 0)
    return { type, total: list.length, running: list.filter(e => !e.outcome).length, done: done.length, ok, withGain: withGain.length, pred, act }
  })
  const anyDone = rows.some(r => r.done > 0)
  return (
    <section className="card learned" aria-labelledby="learned-title">
      <div className="card-head"><h2 className="card-title" id="learned-title">Wat heeft Gijs geleerd?</h2></div>
      {!anyDone ? (
        <p className="muted learned-empty">Nog geen afgeronde experimenten met genoeg data. Na de eindmeting (28 dagen, of 56 bij verlenging) zie je hier per soort aanpassing hoe vaak het werkte en hoe de voorspelling uitpakte. Nieuwe adviezen verwijzen dan naar deze uitkomsten.</p>
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
        text="Zodra een artikel of contentkans als gepubliceerd wordt vastgelegd, verschijnt het hier en meet het dashboard automatisch hoe het presteert: na 7, 14 en 28 dagen (56 bij het doel SEO-groei of zichtbaarheid, of bij te weinig data); een bijgewerkte pagina vóór en na de aanpassing."
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
// Welke pagina's onder een familie of groep vallen
const unitPages = (u: Unit) => [...new Set(u.members.flatMap(m => [m.baseline?.targetPage || m.page, ...(m.target_pages || [])]).filter((p): p is string => !!p))]

// "Hengelo (Overijssel)" en "Hengelo (Gelderland)" zijn verschillende meetpunten: naam uit de volledige URL
const cap = (x: string) => x.split("-").map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ")
export const placeOf = (path?: string | null) => {
  if (!path) return null
  const seg = path.split("/").filter(Boolean)
  if (seg[0] !== "regio" || seg.length < 2) return null
  return seg.length >= 3 ? `${cap(seg[seg.length - 1])} (${cap(seg[1])})` : cap(seg[1])
}
const changedOf = (e: Experiment): string[] => e.changed_pages || []
const pagesOf = (e: Experiment) => { const c = changedOf(e); return [...new Set((c.length ? c : [e.baseline?.targetPage, e.page, ...(e.target_pages || [])]).filter((p): p is string => typeof p === "string" && !!p))] }
function unitStatus(u: Unit): StatusKey {
  if (u.members.length === 1) return statusOf(u.members[0])
  if (u.members.every(m => m.outcome)) { const o = familyOutcome(u.members.map(m => m.outcome as Outcome)); return o === "succesvol" ? "positief" : o === "niet_succesvol" ? "negatief" : o === "onduidelijk" ? "neutraal" : "afgerond" }
  const st = u.members.map(statusOf)
  return st.includes("verlengd") ? "verlengd" : st.includes("vroeg") ? "vroeg" : "wacht"
}
function unitSignal(u: Unit) {
  const reps = u.members.map(latestReport).filter((r): r is NonNullable<typeof r> => !!r)
  if (!reps.length) return null
  const sum = summarizeSignals(reps.map(r => r.effect))
  const provisional = reps.some(r => !r.final)
  const advice: Advice = sum.overall === "onvoldoende" ? "verder meten" : sum.overall === "positief" ? "behouden" : sum.overall === "negatief" ? "onderzoeken" : provisional ? "verder meten" : "opnieuw optimaliseren"
  return { ...sum, advice, measured: reps.length }
}
const searchText = (e: Experiment, t?: Task) => normalize([...changedOf(e), e.page, e.baseline?.targetPage, ...(e.target_pages || []), e.query, ...(e.target_queries || []), e.description, e.family_title, t?.signal.headline, ...pagesOf(e).map(placeOf)].filter(Boolean).join(" ").replace(/[-/]/g, " "))

const unitQueries = (u: Unit) => [...new Set(u.members.flatMap(m => [m.query, ...(m.target_queries || [])]).filter((q): q is string => !!q))]

function FamilyRename({ u }: { u: Unit }) {
  const { reload } = useWorkspace()
  const [edit, setEdit] = useState(false)
  const [name, setName] = useState(u.title || "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const famId = u.members[0].family_id
  if (!famId) return null
  if (!edit) return <p className="exp-rename small">Naam: <b>{u.title}</b><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setName(u.title || ""); setEdit(true) }}><Pencil aria-hidden />Naam wijzigen</button></p>
  return (
    <form className="exp-rename" onSubmit={async e => {
      e.preventDefault(); if (!name.trim()) return
      setBusy(true); setErr(null)
      const res = await fetch("/api/experiments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family_id: famId, family_title: name.trim() }) }).catch(() => null)
      setBusy(false)
      if (!res?.ok) { setErr("Opslaan mislukt. Probeer het opnieuw."); return }
      setEdit(false); reload()
    }}>
      <label className="sr-only" htmlFor={`fam-${u.id}`}>Naam van de familie</label>
      <input id={`fam-${u.id}`} className="input" value={name} maxLength={140} autoFocus onChange={e => setName(e.target.value)} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Annuleren</button>
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>{busy ? "Bezig…" : "Naam opslaan"}</button>
      {err && <span className="txt-down small">{err}</span>}
    </form>
  )
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
  const [q, setQ] = useState(() => params.get("q") || "")
  const byKey = useMemo(() => new Map(tasks.map(t => [t.key, t])), [tasks])
  const units = useMemo(() => unitsOf(experiments), [experiments])
  const byKind = (k: ExpKind) => units.filter(u => u.kind === k)
  // Zoeken op plaats, pagina of zoekwoord: lopende én afgeronde metingen van alle soorten
  const needle = normalize(q).replace(/[-/]/g, " ").trim()
  const hit = (e: Experiment) => !!needle && searchText(e, byKey.get(e.advice_key)).includes(needle)
  const shown = needle.length >= 2 ? units.filter(u => u.members.some(hit)) : byKind(kindTab)
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
        sub={tab === "content" ? "Gepubliceerde content en wat het oplevert, gemeten tegen het doel en de succesgrens die bij publicatie zijn vastgelegd. Meetmomenten: na 7 dagen signalering, na 14 dagen een eerste beoordeling, na 28 dagen het eindoordeel; 56 dagen bij het doel SEO-groei of zichtbaarheid, of bij te weinig data. Bijgewerkte pagina's worden vóór en na gemeten." : "Experiment = onzekere aanpassing met genoeg data. Meting = volgen zonder oordeel. Validatie = controleren of een technische oplossing werkt. Meetmomenten: na 7 dagen signalering (opnieuw gecrawld?), na 14 dagen een eerste beoordeling met vervolgadvies (voorlopig), na 28 dagen de eindmeting; 56 dagen alleen bij te weinig data. Vergeleken worden even lange perioden vóór en na de wijziging."} />

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
            text="Een meting start zodra je in het zijpaneel een taak als uitgevoerd markeert. Het dashboard controleert dan of het een zuiver experiment kan zijn, legt de nulmeting vast en meet na 7, 14 en 28 dagen opnieuw."
            action={<Link href="/taken" className="btn btn-secondary btn-sm">Naar Mijn taken</Link>}
          />
        </div>
      ) : (
        <>
          <label className="exp-search">
            <Search aria-hidden />
            <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Zoek op plaats, pagina of zoekwoord, bijv. Hengelo" aria-label="Zoek in metingen op plaats, pagina of zoekwoord" />
          </label>
          {needle.length >= 2 ? (
            <p className="muted small exp-kind-text">{shown.length ? `${shown.length} ${shown.length === 1 ? "resultaat" : "resultaten"} voor "${q.trim()}": lopende en afgeronde metingen van alle soorten.` : `Geen metingen gevonden voor "${q.trim()}".`}</p>
          ) : <>
          <div className="exp-kinds chips" role="tablist" aria-label="Soort">
            {(["experiment", "meting", "validatie"] as ExpKind[]).map(k => (
              <button key={k} role="tab" aria-selected={kindTab === k} className={`chip${kindTab === k ? " is-active" : ""}`} onClick={() => router.replace(k === "experiment" ? "/experimenten" : `/experimenten?soort=${k}`)}>
                {KIND_META[k].plural}<span className="chip-count">{byKind(k).length}</span>
              </button>
            ))}
          </div>
          <p className="muted small exp-kind-text">{KIND_META[kindTab].text}{kindTab === "validatie" ? " Telt niet mee bij de nauwkeurigheid of bij geleerde SEO-effecten." : kindTab === "meting" ? " Telt niet mee bij de nauwkeurigheid of bij geleerde SEO-effecten; de cijfers blijven zichtbaar." : ""}</p>
          </>}

          {shown.length === 0 ? (needle.length >= 2 ? null : <div className="card card-pad"><p className="muted small" style={{ margin: 0 }}>Geen {KIND_META[kindTab].plural.toLowerCase()}.</p></div>) : (
            <div className="table-wrap card exp-table">
              <table className="table">
                <thead><tr><th scope="col">Verandering</th><th scope="col">Doel en meetwaarde</th><th scope="col">Geschiktheid</th><th scope="col">Volgende meting</th><th scope="col">Status en signaal</th></tr></thead>
                <tbody>
                  {shown.map(u => {
                    const e = u.members[0], task = byKey.get(e.advice_key)
                    const g = goalOf(e.baseline?.successMetric)
                    const next = unitNext(u)
                    const isOpen = open.has(u.id) !== (needle.length >= 2 && u.members.length > 1)
                    const st = STATUS[unitStatus(u)], sig = unitSignal(u)
                    return (
                      <FragmentRow key={u.id}>
                        <tr className={`exp-row${isOpen ? " is-open" : ""}`} data-unit={u.id}>
                          <th scope="row">
                            <button className="exp-toggle" onClick={() => toggle(u.id)} aria-expanded={isOpen} aria-controls={`exp-${u.id}`}>
                              <ChevronRight aria-hidden className="exp-chev" />
                              <span className="exp-main">
                                <b>{u.title || subjectOf(e, task)}</b>
                                {(u.title || u.members.length > 1) && unitPages(u).length > 0 && (() => { const ps = unitPages(u); return <span className="exp-pages">{ps.length === 1 ? "Pagina" : `${ps.length} pagina's`}: {ps.slice(0, 4).join(", ")}{ps.length > 4 ? ` en nog ${ps.length - 4}` : ""}</span> })()}
                                {u.title && (() => { const qs = unitQueries(u); return qs.length > 1 ? <span className="exp-pages">{qs.length} zoekwoorden: {qs.slice(0, 4).map(q => `"${q}"`).join(", ")}{qs.length > 4 ? ` en nog ${qs.length - 4}` : ""}</span> : null })()}
                                <span className="subtle small">{needle.length >= 2 ? `${KIND_META[u.kind].label} · ` : ""}{u.members.length > 1 ? `Familie: ${u.members.length} meetpunten, telt als één experiment · ` : ""}aangepast {dateShort(e.changed_at)}</span>
                              </span>
                            </button>
                          </th>
                          <td><span className="exp-goal">{g.goal}</span><span className="subtle small">{g.metric}</span></td>
                          <td><Reliability u={u} /></td>
                          <td className="small">{next ? <>{dateShort(next.date)} <span className="subtle">(dag {next.days}, {next.label})</span></> : unitOutcome(u) ? <span className="subtle">afgerond</span> : <span className="subtle">—</span>}</td>
                          <td><span className="mr-badges"><Badge tone={st.tone} dot>{st.label}</Badge>{sig && <Badge tone={SIGNAL[sig.overall].tone} title={sig.text}>{SIGNAL[sig.overall].label}</Badge>}</span>{sig && u.members.length > 1 && <span className="subtle small" style={{ display: "block", marginTop: 2 }}>{sig.text}</span>}</td>
                        </tr>
                        {isOpen && (
                          <tr className="exp-detail-row" id={`exp-${u.id}`}><td colSpan={5}>
                            <FamilyRename u={u} />
                            {u.members.length > 1 ? (
                              <>
                                <ExperimentFacts e={e} pages={[...new Set(u.members.flatMap(pagesOf))]} />
                                <MeasureTimeline e={e} members={u.members} />
                                {sig ? (
                                  <p className="mr-next" style={{ margin: "8px 0" }}><b>Experiment als geheel: {SIGNAL[sig.overall].label.toLowerCase()}</b> ({sig.text}, {sig.measured} van {u.members.length} meetpunten gemeten). <b>Vervolgadvies: {ADVICE[sig.advice]}.</b></p>
                                ) : <p className="small subtle" style={{ margin: "8px 0" }}>Nog geen beoordeling; de eerste volgt na 14 dagen.</p>}
                                <div className="table-wrap">
                                <table className="mini-table exp-points">
                                  <thead><tr><th>Meetpunt</th><th>Aangepaste URL</th><th>Zoekwoord</th><th>Google toont</th><th className="num">Nulmeting</th><th className="num">Laatste meting</th><th>Signaal</th></tr></thead>
                                  <tbody>{[...u.members].sort((x, y) => Number(hit(y)) - Number(hit(x))).map(m => {
                                    const t = byKey.get(m.advice_key)
                                    const b = m.baseline || {}
                                    const url = pagesOf(m)[0] || null
                                    const bp = b.targetPage ? b.pairPosition : b.position
                                    const rep = latestReport(m)
                                    const g = (k: string) => rep?.rows.find(r => r.key === k)
                                    const shown = rep?.ranking?.shown[0]
                                    const name = placeOf(url) || pointName(m, t) || subjectOf(m, t)
                                    return (
                                    <tr key={m.id} className={hit(m) ? "is-current" : undefined}>
                                      <td>{t ? <button className="link-btn" onClick={() => openTask(t.key)}>{name}</button> : name}</td>
                                      <td className="small">{url || "—"}</td>
                                      <td className="small">{m.query ? `"${m.query}"` : "—"}</td>
                                      <td className="small">{shown ? <>{shown.page}{rep!.ranking!.intendedShown === false && <span className="subtle" title="Google toont een andere URL dan de aangepaste pagina: een signaal om te onderzoeken, geen fout"> (andere URL)</span>}</> : b.targetPage ? <>{b.targetPage}{url && b.targetPage !== url && <span className="subtle" title="Bij de nulmeting toonde Google voor dit zoekwoord een andere URL dan de aangepaste pagina: een signaal om te onderzoeken, geen fout"> (bij nulmeting, andere URL)</span>}</> : <span className="subtle">nog niet gemeten</span>}</td>
                                      <td className="num small">{num(b.impressions ?? 0)} vert. · {num(b.clicks ?? 0)} kl. · {pct(b.ctr)} · {typeof bp === "number" ? `pos. ${pos(bp)}` : "pos. —"}</td>
                                      <td className="num small">{rep ? <>{num(g("impressions")?.after)} vert. · {num(g("clicks")?.after)} kl. · {pct(g("ctr")?.after)} · pos. {pos(g("position")?.after)}<span className="subtle"> (dag {rep.day})</span></> : <span className="subtle">{(() => { const n = nextMeasurement(m as any); return n ? `dag ${n.days}: ${dateShort(n.date)}` : "—" })()}</span>}</td>
                                      <td>{rep ? <Badge tone={SIGNAL[rep.effect].tone}>{SIGNAL[rep.effect].label}</Badge> : <Badge tone={STATUS[statusOf(m)].tone} dot>{STATUS[statusOf(m)].label}</Badge>}</td>
                                    </tr>
                                  ) })}</tbody>
                                </table>
                                </div>
                                <p className="field-hint">Elk meetpunt houdt zijn eigen aangepaste URL, zoekwoord, nulmeting (28 dagen vóór), datum en metingen; plaatsen met dezelfde naam in verschillende provincies zijn aparte meetpunten. &ldquo;Google toont&rdquo; is de URL die Google voor het zoekwoord laat zien; wijkt die af, dan is dat een signaal om te onderzoeken, geen fout. Bij het leren en de nauwkeurigheid telt de familie als één experiment.</p>
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

// Details van één experiment: wat, waarom, waar, wanneer; tijdlijn 7/14/28(/56); resultaat met vervolgadvies
function ExpDetail({ e, task, openTask }: { e: Experiment; task?: Task; openTask: (k: string) => void }) {
  return (
    <div className="exp-detail-v2">
      <div className="meta-line" style={{ marginBottom: 6 }}>{task && <KindLabel signal={task.signal} />}{task && <button className="link-btn" onClick={() => openTask(task.key)}>Taak openen</button>}<span className="subtle small"><CalendarClock aria-hidden /> Aangepast op {dateLong(e.changed_at)}</span><CorrectButton e={e} /></div>
      <CorrectionNote e={e} />
      <SpeedAround date={e.changed_at} />
      <ExperimentFacts e={e} pages={pagesOf(e)} />
      <MeasureTimeline e={e} />
      <div style={{ marginTop: 10 }}><MeasurementReport e={e} /></div>
      {e.suitability && e.suitability.checks.length > 0 && (
        <details className="exp-suit" style={{ marginTop: 8 }}><summary>Geschiktheidscontrole bij de start: {e.suitability.summary}</summary>
          <ul>{e.suitability.checks.map(c => <li key={c.key} data-state={c.state}><b>{c.label}:</b> {c.state === "ok" ? "ja" : c.state === "fout" ? "nee" : "onbekend"}. <span className="subtle">{c.detail}</span></li>)}</ul>
        </details>
      )}
      <ExpOutcome e={e} />
    </div>
  )
}
