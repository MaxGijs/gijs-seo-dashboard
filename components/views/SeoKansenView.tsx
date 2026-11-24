"use client"

// SEO-kansen: alle losse adviezen per zoekwoord of pagina, naar het voorbeeld van Contentkansen.
// Zelfde gegevens als Mijn taken (geen eigen berekening); hier als lijst om te beoordelen.

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, Inbox, TrendingUp, Wrench } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import type { Signal, SignalKind, Task } from "@/lib/types"
import { lostPage1 } from "@/lib/signals"
import NearPage1 from "./NearPage1"
import { columnOf, KIND_META } from "@/lib/workflow"
import { gainShort, num, pos } from "@/lib/format"
import { Badge, EmptyState, PageHeader, PriorityMeter, SectionTabs, Skeleton, StatusBadge, type StatusTone } from "@/components/ui"

type Tab = "beoordelen" | "lopend" | "meting" | "afgerond"
const TAB_COLS: Record<Tab, string[]> = { beoordelen: ["beoordelen"], lopend: ["gepland", "uitvoering"], meting: ["evalueren"], afgerond: ["afgerond"] }
const TYPES: { id: string; label: string; kinds: SignalKind[]; test?: (s: Signal) => boolean }[] = [
  { id: "alle", label: "Alle", kinds: [] },
  { id: "pagina1", label: "Van pagina 1 af", kinds: ["daler"], test: lostPage1 },
  { id: "kans", label: "Kansen", kinds: ["kans"] },
  { id: "ctr", label: "Lage doorklik", kinds: ["ctr"] },
  { id: "daling", label: "Dalingen", kinds: ["daler", "trend-dalend"] },
  { id: "stijging", label: "Stijgingen", kinds: ["stijger", "trend-stijgend"] },
  { id: "pagina", label: "Pagina's", kinds: ["pagina", "dubbel"] },
  { id: "techniek", label: "Techniek", kinds: ["techniek"] },
  { id: "eigen", label: "Eigen", kinds: ["eigen", "analyse"] },
]
const fits = (ty: (typeof TYPES)[number], t: Task) => ty.kinds.includes(t.signal.kind) && (!ty.test || ty.test(t.signal))
type Sort = "prioriteit" | "winst" | "vertoningen"

export default function SeoKansenView() {
  const { loading, visibleTasks, openTask } = useWorkspace()
  const [tab, setTab] = useState<Tab>("beoordelen")
  const [type, setType] = useState("alle")
  const [sort, setSort] = useState<Sort>("prioriteit")
  const [desc, setDesc] = useState(true)

  // Herinneringen horen bij Vandaag, niet bij SEO-kansen
  const all = useMemo(() => visibleTasks.filter(t => !t.signal.reminder), [visibleTasks])
  const inTab = (t: Task, x: Tab) => TAB_COLS[x].includes(columnOf(t.status))
  const counts = useMemo(() => Object.fromEntries((Object.keys(TAB_COLS) as Tab[]).map(x => [x, all.filter(t => inTab(t, x)).length])) as Record<Tab, number>, [all])
  const list = useMemo(() => {
    const rows = all.filter(t => inTab(t, tab) && (type === "alle" || fits(TYPES.find(x => x.id === type)!, t)))
    const val = (t: Task) => sort === "winst" ? t.signal.gain : sort === "vertoningen" ? t.signal.metrics.impressions || 0 : -(t.signal.priorityRank || 9999)
    return rows.sort((a, b) => (desc ? val(b) - val(a) : val(a) - val(b)))
  }, [all, tab, type, sort, desc])
  const keywords = list.filter(t => !!t.signal.query), pages = list.filter(t => !t.signal.query)

  const review = all.filter(t => inTab(t, "beoordelen") && !t.snoozed)
  const high = review.filter(t => t.signal.priority === "hoog").length
  const gain = review.reduce((s, t) => s + (t.signal.kind === "techniek" ? 0 : t.signal.gain || 0), 0)
  const status = loading ? null : {
    tone: (high ? "attention" : review.length ? "info" : "good") as StatusTone,
    text: review.length ? `${review.length} ${review.length === 1 ? "kans" : "kansen"} te beoordelen${high ? `, waarvan ${high} met hoge prioriteit` : ""}. Samen indicatief ${gainShort(gain)}.` : "Alles is beoordeeld. Nieuwe kansen komen elke nacht binnen.",
  }

  return (
    <>
      <PageHeader title="SEO-kansen" status={status}
        sub="Losse adviezen per zoekwoord of pagina. Het dashboard stelt voor, jij beslist. Adviezen voor de hele site staan bij Siteadvies."
        actions={<Link href="/taken" className="btn btn-secondary btn-sm">Bord in Mijn taken</Link>} />

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: "0 22px" }}>
          <SectionTabs label="Status" value={tab} onChange={setTab} tabs={[
            { id: "beoordelen", label: "Te beoordelen", count: counts.beoordelen },
            { id: "lopend", label: "Ingepland", count: counts.lopend },
            { id: "meting", label: "Wordt gemeten", count: counts.meting },
            { id: "afgerond", label: "Afgerond", count: counts.afgerond },
          ]} />
        </div>
        <div className="table-tools" style={{ paddingTop: 0 }}>
          <div className="toolbar-left" role="group" aria-label="Soort">
            {TYPES.filter(t => t.id === "alle" || all.some(x => inTab(x, tab) && fits(t, x))).map(t => (
              <button key={t.id} className={`chip${type === t.id ? " is-active" : ""}`} aria-pressed={type === t.id} onClick={() => setType(t.id)}>{t.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label className="subtle small" htmlFor="seo-sort" style={{ whiteSpace: "nowrap" }}>Sorteer op</label>
            <select id="seo-sort" className="select" style={{ height: 34, fontSize: "var(--fs-sm)", borderRadius: 999 }} value={sort} onChange={e => setSort(e.target.value as Sort)}>
              <option value="prioriteit">Prioriteit</option>
              <option value="winst">Verwachte winst</option>
              <option value="vertoningen">Vertoningen</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={desc ? "Aflopend, klik voor oplopend" : "Oplopend, klik voor aflopend"} onClick={() => setDesc(d => !d)}>{desc ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />}</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="content-rows">{[0, 1].map(i => <div key={i} className="idea-list">{[0, 1, 2].map(j => <div key={j} className="card card-pad"><Skeleton height={18} width="60%" /><div style={{ height: 10 }} /><Skeleton height={14} /></div>)}</div>)}</div>
      ) : list.length === 0 ? (
        <div className="card"><EmptyState compact icon={<Inbox />} title={tab === "beoordelen" ? "Alles beoordeeld" : "Niets in deze lijst"} text={tab === "beoordelen" ? "Nieuwe kansen verschijnen hier zodra Search Console ze laat zien." : undefined} /></div>
      ) : (
        <div className="content-rows">
          <section className="content-row" aria-labelledby="seo-row-kw">
            <h2 className="content-row-title" id="seo-row-kw">Zoekwoorden<span className="chip-count">{keywords.length}</span></h2>
            {keywords.length ? <div className="idea-list">{keywords.map(t => <SeoCard key={t.key} t={t} onOpen={() => openTask(t.key)} />)}</div> : <p className="muted small">Geen zoekwoorden in deze lijst.</p>}
          </section>
          <section className="content-row" aria-labelledby="seo-row-pg">
            <h2 className="content-row-title" id="seo-row-pg">Pagina&apos;s en techniek<span className="chip-count">{pages.length}</span></h2>
            {pages.length ? <div className="idea-list">{pages.map(t => <SeoCard key={t.key} t={t} onOpen={() => openTask(t.key)} />)}</div> : <p className="muted small">Geen pagina&apos;s of techniek in deze lijst.</p>}
          </section>
        </div>
      )}

      <NearPage1 />
    </>
  )
}

// Zelfde kaart als bij Contentkansen: links de verwachte winst, rechts waarom en wat te doen
function SeoCard({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const s = t.signal, m = s.metrics
  const tech = s.kind === "techniek"
  return (
    <button className={`card idea-card seo-card prio-${s.priority}`} onClick={onOpen} title={s.query || s.headline}>
      <span className="idea-score score-neutral" title={tech ? "Technische randvoorwaarde" : "Indicatieve extra klikken per 28 dagen"}>
        {tech ? <><Wrench aria-hidden /><small>techniek</small></> : <><strong>{s.gain >= 1 ? `+${Math.round(s.gain)}` : "<1"}</strong><small>klik/28 d</small></>}
      </span>
      <span className="idea-main">
        <span className="idea-tags">
          <PriorityMeter priority={s.priority} />
          {lostPage1(s) ? <Badge tone="error">Van pagina 1 af</Badge> : <Badge tone="neutral">{KIND_META[s.kind].label}</Badge>}
          {columnOf(t.status) !== "beoordelen" && <StatusBadge task={t} />}
        </span>
        <span className="idea-title">{s.query ? `"${s.query}"` : s.headline}</span>
        <span className="idea-why">{s.action || s.title}</span>
        <span className="idea-meta">
          {s.page && <span>{s.page}</span>}
          {m.impressions ? <span>{num(m.impressions)} vertoningen</span> : null}
          {m.position ? <span>positie {pos(m.position)}</span> : null}
          <span><TrendingUp aria-hidden style={{ width: 12, height: 12, display: "inline", verticalAlign: -1 }} /> bewijs {s.evidence}</span>
        </span>
      </span>
    </button>
  )
}
