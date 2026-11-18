"use client"

import { useCallback, useEffect, useState } from "react"
import type { ColumnId } from "@/lib/workflow"
import type { ContentIdea, IdeaStatus } from "./model"

// Contentkansen ophalen voor andere schermen (Mijn taken)
export function useContentIdeas() {
  const [ideas, setIdeas] = useState<ContentIdea[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/content", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setIdeas(json.ideas || []); setError(null)
    } catch (e: any) { setError(e.message); setIdeas([]) }
  }, [])
  useEffect(() => { load() }, [load])
  const update = useCallback((idea: ContentIdea) => setIdeas(list => (list || []).map(i => (i.id === idea.id ? idea : i))), [])
  const remove = useCallback((id: string) => setIdeas(list => (list || []).filter(i => i.id !== id)), [])
  return { ideas, error, reload: load, update, remove }
}

// Waar een contentkans op het takenbord staat
export function contentColumn(i: Pick<ContentIdea, "status" | "evals">): ColumnId | null {
  const s: IdeaStatus = i.status
  if (s === "nieuw" || s === "later") return "beoordelen"
  if (s === "geaccepteerd" || s === "briefing") return "gepland"
  if (s === "concept") return "uitvoering"
  // Ingeleverd en in beoordeling, goedgekeurd (wacht op publicatie) en gepubliceerd (wordt gemeten)
  if (s === "review" || s === "goedgekeurd") return "evalueren"
  if (s === "gepubliceerd") return i.evals?.d90 ? "afgerond" : "evalueren"
  if (s === "afgewezen") return "afgerond"
  return null // verlopen: niet op het bord
}

export const CONTENT_STEP: Partial<Record<IdeaStatus, string>> = {
  nieuw: "Beoordelen",
  later: "Later bekijken",
  geaccepteerd: "Briefing maken",
  briefing: "Concept laten schrijven",
  concept: "Redigeren en controleren",
  review: "Ingeleverd: beoordelen",
  goedgekeurd: "Publiceren en vastleggen",
  gepubliceerd: "Wordt gemeten",
  afgewezen: "Afgewezen",
}
