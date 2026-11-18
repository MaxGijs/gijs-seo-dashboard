"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useContentIdeas } from "@/lib/content/useContent"
import { Alert, Skeleton } from "@/components/ui"
import ContentPanel from "./ContentPanel"

// Eigen pagina per contentkans, ingericht als inleverpunt (in plaats van het zijpaneel)
export default function ContentIdeaPage({ id }: { id: string }) {
  const router = useRouter()
  const from = useSearchParams().get("van")
  const back = from === "taken" ? { href: "/taken", label: "Terug naar Mijn taken" } : from === "vandaag" ? { href: "/vandaag", label: "Terug naar Vandaag" } : from === "experimenten" ? { href: "/experimenten?tab=content", label: "Terug naar Experimenten" } : { href: "/content", label: "Terug naar Contentkansen" }
  const content = useContentIdeas()
  if (content.error) return <Alert tone="error" title="Contentkansen konden niet worden geladen">{content.error}</Alert>
  if (!content.ideas) return <div style={{ display: "grid", gap: 16 }}><Skeleton height={120} /><Skeleton height={400} /></div>
  const idea = content.ideas.find(i => i.id === id)
  if (!idea) return (
    <div className="card" style={{ padding: 24 }}>
      <p>Deze contentkans bestaat niet (meer). Misschien is hij verwijderd of gearchiveerd.</p>
      <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => router.push(back.href)}>{back.label}</button>
    </div>
  )
  return <ContentPanel key={idea.id} variant="page" backLabel={back.label} idea={idea} all={content.ideas} onClose={() => router.push(back.href)} onUpdate={content.update} onDeleted={id2 => { content.remove(id2); router.push(back.href) }} />
}
