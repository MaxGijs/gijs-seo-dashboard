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
  const { experiments, contentTries } = useWorkspace()
  const tries = triesFor([...toTries(experiments), ...(contentTries || [])].filter(t => t.key !== taskKey), { page, query })
  if (!tries.length && !routeNote) return null
  return (
    <section className="psec" aria-labelledby="sec-routes">
      <h3 className="psec-title" id="sec-routes"><History aria-hidden />Eerder geprobeerd{page ? ` voor ${page}` : ""}</h3>
      {routeNote && <p className="route-note"><RouteIcon aria-hidden /><span>{routeNote}</span></p>}
      {tries.length > 0 && (
        <table className="ptable">
          <thead><tr><th>Datum</th><th>Route</th><th>Wat er is gedaan</th><th>Uitkomst</th></tr></thead>
          <tbody>{tries.map((t, i) => (
            <tr key={i}>
              <td className="nowrap">{dateShort(t.date)}</td>
              <th scope="row">{ROUTE_LABEL[t.route] || t.route}</th>
              <td>{t.description}{t.summary ? <span className="subtle"> · {t.summary}</span> : null}{t.confounders.length > 0 && <span className="subtle small" style={{ display: "block", marginTop: 3 }}>Mogelijk ook van invloed: {t.confounders.join("; ")}.</span>}</td>
              <td className={`nowrap ${t.outcome ? OUTCOME[t.outcome].cls : "subtle"}`}>{t.outcome ? OUTCOME[t.outcome].label : "Meting loopt"}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  )
}
