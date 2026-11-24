"use client"

// Label op een kaart als er al een meting loopt op dezelfde pagina (of in dezelfde plaats).
// Zo zie je het vóórdat je eraan begint, zonder te zoeken: dubbel meten maakt beide uitkomsten onbruikbaar.

import { useMemo } from "react"
import { Activity } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { overlapText, runningMeasurements, waitUntil } from "@/lib/running"
import { dateShort } from "@/lib/format"
import type { Task } from "@/lib/types"

export default function RunningLabel({ task, compact }: { task: Task; compact?: boolean }) {
  const { experiments, contentTries } = useWorkspace()
  const hits = useMemo(() => runningMeasurements(task, experiments, undefined, contentTries).filter(h => !h.sameCard), [task, experiments, contentTries])
  if (!hits.length) return null
  const h = hits[0]
  const until = waitUntil(hits)
  const detail = hits.slice(0, 3).map(x => `${overlapText(x)}${x.level !== "plaats" && x.on.length ? ` (${x.on.slice(0, 2).join(", ")})` : ""}: ${(x.experiment.family_title || x.experiment.description).slice(0, 90)}`).join("\n")
  return (
    <span className={`tcard-running level-${h.level}${compact ? " is-compact" : ""}`} title={`${detail}\nWacht bij voorkeur tot ${dateShort(until)}.`}>
      <Activity aria-hidden />{overlapText(h)}{hits.length > 1 ? ` (+${hits.length - 1})` : ""} · tot {dateShort(until)}
    </span>
  )
}
