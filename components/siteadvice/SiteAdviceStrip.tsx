"use client"

import Link from "next/link"
import { ArrowRight, Compass, Layers, TrendingUp } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { PriorityMeter } from "@/components/ui"
import AdviceActions, { decisionOf } from "./AdviceActions"
import { planFor, type SiteAdvice } from "@/lib/siteadvice"
import { prettySlug } from "@/lib/pages"

export const ADVICE_KIND_LABEL: Record<string, string> = {
  groep: "Patroon in je taken", "route-uitrollen": "Bewezen aanpak uitrollen", "route-stoppen": "Stoppen met wat niet werkt",
  regio: "Regio", indexering: "Indexering", dienst: "Dienst en zoekvraag", conversie: "Aanvragen",
}
const anchor = (key: string) => `advies-${key.replace(/[^a-z0-9]+/gi, "-")}`

// Omvang van een advies: hoeveel pagina's, of een hele provincie
export function scopeOf(a: SiteAdvice): { label: string; big: boolean } {
  if (a.kind === "regio" || a.kind === "indexering") return { label: `Hele provincie ${prettySlug(a.key.split("|")[1] || "")}`.trim(), big: true }
  if (a.kind === "route-stoppen") return { label: "Aanpak", big: false }
  const n = a.taskKeys.length || a.pages.length
  return { label: n > 1 ? `${n} pagina's` : n === 1 ? "1 pagina" : "Onderwerp", big: n >= 3 }
}

// Onder het bord in Mijn taken: grote adviezen die veel pagina's of de hele site raken en meer tijd vragen
export default function SiteAdviceStrip() {
  const { siteAdvice, siteDecisions, tasks, loading } = useWorkspace()
  if (loading) return null
  const open = siteAdvice.filter(a => scopeOf(a).big && (a.priority === "hoog" || a.priority === "middel") && !decisionOf(siteDecisions.get(a.key)))
  if (!open.length) return null
  return (
    <section className="site-strip" aria-labelledby="site-strip-title">
      <div className="site-strip-head">
        <div>
          <h2 className="section-title" id="site-strip-title"><Compass aria-hidden />Grote adviezen voor de website</h2>
          <p className="section-sub">Werk dat veel pagina's of een hele provincie raakt en meer tijd vraagt (hoge of middelhoge prioriteit). Inplannen maakt de taken per pagina aan in Gepland.</p>
        </div>
        <Link href="/advies" className="section-link">Alle siteadviezen<ArrowRight aria-hidden /></Link>
      </div>
      <div className="site-strip-row" role="list">
        {open.map(a => (
          <article key={a.key} className="card site-card" role="listitem">
            <div className="site-card-top">
              <PriorityMeter priority={a.priority!} />
              <span className="kind-label tone-accent">{ADVICE_KIND_LABEL[a.kind]}</span>
              <span className="badge tone-neutral site-scope"><Layers aria-hidden />{scopeOf(a).label}</span>
            </div>
            <h3 className="site-card-title" title={a.title}>{a.title}</h3>
            <p className="site-card-meta">
              {a.gain ? <span className="advice-gain"><TrendingUp aria-hidden />± {a.gain} klikken / 28 d</span> : null}
              <span className="subtle small">zekerheid {a.confidence}</span>
            </p>
            <p className="subtle small site-card-plan">{planFor(a, tasks).summary}</p>
            <Link href={`/advies#${anchor(a.key)}`} className="link-btn small">Bekijk waarom en wat te doen</Link>
            <div className="site-card-actions"><AdviceActions a={a} compact /></div>
          </article>
        ))}
      </div>
    </section>
  )
}
