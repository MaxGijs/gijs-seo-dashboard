"use client"

// Mijn taken: zoek je op een plaats, pagina of zoekwoord, dan zie je bovenaan welke metingen daar nog
// lopen (SEO-metingen, familieleden en bijgewerkte contentpagina's). Zo ga je niet dubbel meten.

import { useMemo } from "react"
import Link from "next/link"
import { Activity, ArrowRight } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { contentRuns, experimentTargets, runInfo } from "@/lib/running"
import { townOf } from "@/lib/paths"
import { prettyPlace } from "@/lib/intent"
import { dateShort, normalize } from "@/lib/format"
import type { Experiment } from "@/lib/types"

const SHOW = 6
const fold = (s: string) => normalize(s).replace(/[-/]/g, " ").replace(/\s+/g, " ").trim()

export default function RunningSearch({ text }: { text: string }) {
  const { experiments, contentTries, openTask, tasks } = useWorkspace()
  const needle = fold(text)
  const found = useMemo(() => {
    if (needle.length < 2) return []
    const words = needle.split(" ")
    return [...experiments, ...contentRuns(contentTries)].map(e => {
      const run = runInfo(e)
      if (!run) return null
      const x = experimentTargets(e)
      const towns = [...x.towns].map(prettyPlace)
      const hay = fold([...x.pages, ...x.mentioned, ...towns, ...x.queries, e.description, e.family_title || ""].join(" "))
      return words.every(w => hay.includes(w)) ? { e, run, pages: [...x.pages], towns } : null
    }).filter((r): r is { e: Experiment; run: NonNullable<ReturnType<typeof runInfo>>; pages: string[]; towns: string[] } => !!r)
      .sort((a, b) => a.run.end.localeCompare(b.run.end))
  }, [experiments, contentTries, needle])
  if (needle.length < 2) return null
  const keys = new Set(tasks.map(t => t.key))

  return (
    <section className="running-search" aria-live="polite" aria-labelledby="running-search-title">
      <h2 id="running-search-title"><Activity aria-hidden />Lopende metingen met &ldquo;{text.trim()}&rdquo;<span className="chip-count">{found.length}</span></h2>
      {!found.length ? (
        <p className="subtle small">Hier loopt nu geen meting. Je kunt een aanpassing doen zonder een lopende meting te verstoren.</p>
      ) : (
        <>
          <p className="subtle small">Pas hier liever niets aan tot de eerste beoordeling (dag 14) is gedaan; anders weet je niet welke wijziging het effect gaf.</p>
          <ul className="running-search-list">
            {found.slice(0, SHOW).map(({ e, run, pages, towns }) => (
              <li key={e.id}>
                <span className="running-search-main">
                  <b>{e.family_title || (e.query ? `"${e.query}"` : pages[0] || "Meting")}</b>
                  <span className="small clamp2" title={e.description}>{run.content ? "Contentupdate · " : ""}{e.description}</span>
                  <span className="subtle small">{pages.slice(0, 3).join(", ")}{pages.length > 3 ? ` en nog ${pages.length - 3}` : ""}{towns.length && !pages.some(p => townOf(p)) ? ` · ${towns.join(", ")}` : ""}</span>
                </span>
                <span className="running-search-when small">
                  <span>Live {dateShort(e.changed_at)}</span>
                  <span>{run.assessed ? `Eindmeting ${dateShort(run.end)}` : `Eerste beoordeling ${dateShort(run.firstAssessment)}`}</span>
                  {!run.content && keys.has(e.advice_key) && <button type="button" className="link-btn" onClick={() => openTask(e.advice_key)}>Open kaart</button>}
                </span>
              </li>
            ))}
          </ul>
          <Link className="link-btn running-search-all" href={`/experimenten?soort=meting&q=${encodeURIComponent(text.trim())}`}>{found.length > SHOW ? `Alle ${found.length} in Experimenten` : "Bekijk in Experimenten"}<ArrowRight aria-hidden /></Link>
        </>
      )}
    </section>
  )
}
