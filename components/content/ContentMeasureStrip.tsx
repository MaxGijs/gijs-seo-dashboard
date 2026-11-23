"use client"

// Onder de grote adviezen in Mijn taken: gepubliceerde content die nu gemeten wordt.
// Die kaarten staan niet meer in Evalueren, zodat het bord over het werk gaat en content en SEO
// overzichtelijk gescheiden blijven. Klik opent de contentkans met alle resultaten.

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, CalendarClock, LineChart, Newspaper } from "lucide-react"
import { Badge, MeasuringBadge } from "@/components/ui"
import { dateShort, num } from "@/lib/format"
import { serviceLabel, type ContentIdea } from "@/lib/content/model"
import { isPageUpdate, nextMilestone } from "@/lib/content/update"
import { CONTENT_GOALS, latestArticleKey, nextArticlePoint, planVerdict } from "@/lib/content/plan"

const SHOW = 8

function nextText(i: ContentIdea) {
  if (!i.published_at) return "Wordt gemeten"
  if (isPageUpdate(i)) {
    const n = nextMilestone(i.evals?.update || { points: {} }, i.published_at)
    return n ? `${n.days}-dagenmeting ${dateShort(n.date)}` : "Eindoordeel volgt"
  }
  const n = nextArticlePoint(i)
  return n ? `Dag ${n.days} (${n.label}) ${dateShort(n.date)}` : "Eindoordeel volgt"
}

// Laatste meting in één regel
function lastResult(i: ContentIdea): string | null {
  if (isPageUpdate(i)) {
    const pts = i.evals?.update?.points || {}
    const key = (["d56", "d28", "d14"] as const).find(k => pts[k])
    const p = key ? pts[key] : null
    return p ? `${num(p.page.clicks)} klikken · ${num(p.page.impressions)} vertoningen (na ${p.window.days} dagen)` : null
  }
  const key = latestArticleKey(i)
  const e = key ? i.evals![key]! : null
  if (!e) return null
  const views = e.ga4?.views
  return `${typeof views === "number" ? `${num(views)} keer bekeken · ` : ""}${num(e.clicks)} klikken · ${num(e.impressions)} vertoningen (na ${key!.slice(1)} dagen)`
}

export default function ContentMeasureStrip({ ideas, all, onOpen }: { ideas: ContentIdea[]; all: ContentIdea[]; onOpen: (id: string) => void }) {
  const [more, setMore] = useState(false)
  if (!ideas.length) return null
  const sorted = [...ideas].sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""))
  const shown = more ? sorted : sorted.slice(0, SHOW)
  return (
    <section className="site-strip content-strip" aria-labelledby="content-strip-title">
      <div className="site-strip-head">
        <div>
          <h2 className="section-title" id="content-strip-title"><LineChart aria-hidden />Content in meting ({ideas.length})</h2>
          <p className="section-sub">Gepubliceerde artikelen en bijgewerkte pagina&apos;s die nu gemeten worden. Content die nog in de maak is, staat op het bord.</p>
        </div>
        <Link href="/experimenten?tab=content" className="section-link">Alle contentresultaten<ArrowRight aria-hidden /></Link>
      </div>
      <div className="site-strip-row" role="list">
        {shown.map(i => {
          const v = planVerdict(i, all)
          const res = lastResult(i)
          return (
            <button key={i.id} className="card site-card content-measure-card interactive" role="listitem" onClick={() => onOpen(i.id)}>
              <span className="site-card-top">
                <span className="kind-label tone-info"><Newspaper aria-hidden />{isPageUpdate(i) ? "Bijgewerkte pagina" : "Nieuw artikel"}</span>
                {v && v.label !== "Nog te vroeg" && v.label !== "Gevolgd" ? <Badge tone={v.tone === "success" ? "success" : v.tone === "error" ? "error" : v.tone === "warning" ? "warning" : "neutral"}>{v.label}</Badge> : <MeasuringBadge />}
              </span>
              <span className="site-card-title" title={i.title}>{i.title}</span>
              <span className="subtle small">{isPageUpdate(i) ? `${i.target_page} · ` : ""}{serviceLabel(i.service)} · {i.published_at ? `${isPageUpdate(i) ? "bijgewerkt" : "gepubliceerd"} ${dateShort(i.published_at)}` : "gepubliceerd"}</span>
              {i.success_plan && <span className="small">Doel: {CONTENT_GOALS[i.success_plan.goal].label.toLowerCase()} · {i.success_plan.threshold == null ? "zonder succesgrens" : `geslaagd bij ${num(i.success_plan.threshold)} ${CONTENT_GOALS[i.success_plan.goal].unit}`}</span>}
              <span className="small">{res || <span className="subtle">Nog geen meting binnen</span>}</span>
              <span className="subtle small site-card-plan"><CalendarClock aria-hidden className="inline-icon" />{nextText(i)}</span>
            </button>
          )
        })}
        {sorted.length > SHOW && !more && (
          <button className="card site-card content-measure-more" role="listitem" onClick={() => setMore(true)}>Toon alle {sorted.length}</button>
        )}
      </div>
    </section>
  )
}
