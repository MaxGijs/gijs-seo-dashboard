"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Compass, ListChecks, Target, TrendingUp } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { useContentIdeas } from "@/lib/content/useContent"
import { buildSiteAdvice, siteState, type AdviceKind, type SiteAdvice } from "@/lib/siteadvice"
import { toTries } from "@/lib/routes"
import { Badge, EmptyState, PriorityMeter, Skeleton } from "@/components/ui"
import AdviceActions from "@/components/siteadvice/AdviceActions"

const KIND_LABEL: Record<AdviceKind, string> = {
  groep: "Patroon in je taken", "route-uitrollen": "Bewezen aanpak uitrollen", "route-stoppen": "Stoppen met wat niet werkt",
  regio: "Regio", indexering: "Indexering", dienst: "Dienst en zoekvraag", conversie: "Aanvragen",
}
const num = (n: number) => Math.round(n).toLocaleString("nl-NL")

export default function SiteAdviceView() {
  const { loading, tasks, inventory, lessons, experiments, contentTries, keywords, ctrModel, ga4Pages, openTask } = useWorkspace()
  const { ideas } = useContentIdeas()
  const advice = useMemo(() => (loading ? [] : buildSiteAdvice({
    tasks, inventory, lessons, tries: [...toTries(experiments), ...(contentTries || [])], keywords, ctrModel, ga4Pages, ideas,
  })), [loading, tasks, inventory, lessons, experiments, contentTries, keywords, ctrModel, ga4Pages, ideas])
  const st = useMemo(() => siteState({ inventory }), [inventory])
  // Vanuit de rij in Mijn taken: naar het juiste advies scrollen zodra het geladen is
  useEffect(() => {
    if (!advice.length || !window.location.hash) return
    const el = document.getElementById(window.location.hash.slice(1))
    if (el) { el.scrollIntoView({ block: "start" }); el.classList.add("is-flash") }
  }, [advice.length])
  const trend = st.prev ? (st.imp - st.prev) / st.prev : null

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Siteadvies</h1>
          <p className="page-sub">Wat het dashboard adviseert voor de hele site, niet per losse pagina. Automatisch berekend uit alle data, metingen, lessen en jullie beslissingen, telkens als je deze pagina opent.</p>
        </div>
      </div>

      {loading ? <Skeleton height={120} /> : (
        <div className="learn-stats">
          <div className="learn-stat"><span className="learn-stat-value">{num(st.pages)}</span><span className="learn-stat-label">Pagina's in de sitemap</span></div>
          <div className="learn-stat"><span className="learn-stat-value">{st.inspected ? `${Math.round((st.indexed / st.inspected) * 100)}%` : "—"}</span><span className="learn-stat-label">In Google ({num(st.indexed)} van {num(st.inspected)} gecontroleerd)</span></div>
          <div className="learn-stat"><span className="learn-stat-value">{num(st.imp)}</span><span className="learn-stat-label">Vertoningen in 28 dagen{trend !== null ? ` (${trend >= 0 ? "+" : ""}${Math.round(trend * 100)}% t.o.v. ervoor)` : ""}</span></div>
          <div className="learn-stat"><span className="learn-stat-value">{num(st.clicks)}</span><span className="learn-stat-label">Klikken in 28 dagen</span></div>
        </div>
      )}
      {!loading && st.young.length > 0 && <p className="field-hint" style={{ marginTop: -12, marginBottom: 20 }}>In opbouw (minder dan 8 weken live): {st.young.join(", ")}. Daar beoordeelt het advies alleen de basis, nog geen prestaties.</p>}

      {loading ? <Skeleton height={240} /> : advice.length === 0 ? (
        <div className="card"><EmptyState icon={<Compass />} title="Geen siteadvies op dit moment"
          text="Er is geen patroon dat groot genoeg is voor een advies over de hele site. Losse adviezen staan in Mijn taken." /></div>
      ) : (
        <div className="advice-list">
          {advice.map((a, i) => <AdviceCard key={a.key} a={a} rank={i + 1} openTask={openTask} taskTitle={k => { const t = tasks.find(x => x.key === k); return t ? (t.signal.query ? `"${t.signal.query}"` : t.signal.headline) : k }} ideaTitle={id => ideas?.find(x => x.id === id)?.title || "Contentkans"} />)}
        </div>
      )}
      <p className="field-hint" style={{ marginTop: 16 }}>Volgorde: geschatte winst in klikken, plus voorrang voor de basis (indexering, regio's in opbouw), gewogen naar zekerheid. Schattingen zijn indicatief; de metingen na 14, 28 en 56 dagen laten zien wat het echt oplevert.</p>
    </>
  )
}

function AdviceCard({ a, rank, openTask, taskTitle, ideaTitle }: { a: SiteAdvice; rank: number; openTask: (k: string) => void; taskTitle: (k: string) => string; ideaTitle: (id: string) => string }) {
  const [open, setOpen] = useState(false)
  const items = a.taskKeys.length + a.pages.length + a.ideaIds.length
  return (
    <article className="card advice-card" id={`advies-${a.key.replace(/[^a-z0-9]+/gi, "-")}`}>
      <div className="advice-rank" aria-hidden>{rank}</div>
      <div className="advice-main">
        <div className="learn-card-top">
          {a.priority && <PriorityMeter priority={a.priority} />}
          <Badge tone="neutral">{KIND_LABEL[a.kind]}</Badge>
          <Badge tone={a.confidence === "hoog" ? "success" : a.confidence === "middel" ? "info" : "neutral"} title={a.confidenceWhy}>Zekerheid {a.confidence}</Badge>
          {a.gain ? <span className="advice-gain" title={a.gainNote}><TrendingUp aria-hidden />± {num(a.gain)} klikken per 28 dagen</span> : null}
        </div>
        <h2 className="learn-title">{a.title}</h2>
        <p>{a.summary}</p>
        <div className="advice-cols">
          <div>
            <p className="learn-block-title"><Target aria-hidden />Waarom</p>
            <ul className="advice-ul">{a.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
          <div>
            <p className="learn-block-title"><ListChecks aria-hidden />Wat te doen</p>
            <ol className="advice-ol">{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        </div>
        {a.gainNote && a.gain ? <p className="field-hint">Verwacht effect: {a.gainNote} {a.confidenceWhy}</p> : <p className="field-hint">{a.confidenceWhy}</p>}
        <AdviceActions a={a} />
        {items > 0 && (
          <div>
            <button className="link-btn" aria-expanded={open} onClick={() => setOpen(x => !x)}>{open ? "Verberg" : "Toon"} waar dit over gaat ({items})</button>
            {open && (
              <ul className="advice-items">
                {a.taskKeys.map(k => <li key={k}><button className="link-btn" onClick={() => openTask(k)}>{taskTitle(k)}</button><span className="subtle small">advies in Mijn taken</span></li>)}
                {a.ideaIds.map(id => <li key={id}><Link href={`/content/${id}`}>{ideaTitle(id)}</Link><span className="subtle small">contentkans</span></li>)}
                {a.pages.filter(p => !a.taskKeys.length).map(p => <li key={p.path}><a href={`https://www.groeninjestraat.nl${p.path}`} target="_blank" rel="noopener noreferrer">{p.path}</a>{p.note && <span className="subtle small">{p.note}</span>}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
