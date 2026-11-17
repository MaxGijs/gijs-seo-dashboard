"use client"

import { History, Route as RouteIcon } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { ROUTE_LABEL, toTries, triesFor } from "@/lib/routes"
import { dateShort } from "@/lib/format"

const OUTCOME: Record<string, { label: string; cls: string }> = {
  succesvol: { label: "Geslaagd", cls: "txt-up" }, niet_succesvol: { label: "Niet geslaagd", cls: "txt-down" }, onduidelijk: { label: "Geen duidelijk effect", cls: "subtle" },
}

// Wegen naar dezelfde pagina of hetzelfde zoekwoord: wat is al geprobeerd en wat leverde het op?
export default function RouteHistory({ taskKey, page, query, routeNote }: { taskKey: string; page: string | null; query?: string | null; routeNote?: string }) {
  const { experiments } = useWorkspace()
  const tries = triesFor(toTries(experiments).filter(t => t.key !== taskKey), { page, query })
  if (!tries.length && !routeNote) return null
  return (
    <section className="psec" aria-labelledby="sec-routes">
      <h3 className="psec-title" id="sec-routes"><History aria-hidden />Eerder geprobeerd{page ? ` voor ${page}` : ""}</h3>
      {routeNote && <p className="route-note"><RouteIcon aria-hidden /><span>{routeNote}</span></p>}
      {tries.length > 0 && (
        <ul className="route-list">
          {tries.map((t, i) => (
            <li key={i}>
              <div className="route-top"><b>{ROUTE_LABEL[t.route] || t.route}</b><span className="subtle small">{dateShort(t.date)}</span><span className={`small ${t.outcome ? OUTCOME[t.outcome].cls : "subtle"}`}>{t.outcome ? OUTCOME[t.outcome].label : "Meting loopt"}</span></div>
              <p className="small">{t.description}{t.summary ? ` · ${t.summary}` : ""}</p>
              {t.confounders.length > 0 && <p className="small subtle">Mogelijk ook van invloed: {t.confounders.join("; ")}.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
