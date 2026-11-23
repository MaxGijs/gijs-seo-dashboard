"use client"

// In een contentkans: wat is hierin samengevoegd (met Splitsen), en welke andere kansen lijken
// erop (samenvoegen tot één artikel). Een samengevoegde kans verwijst naar de hoofdkans.

import { useMemo, useState } from "react"
import Link from "next/link"
import { Layers, Unlink } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { canMerge, suggestions } from "@/lib/content/merge"
import type { ContentIdea } from "@/lib/content/model"
import ContentMergeDialog, { postMerge } from "./ContentMergeDialog"

export default function ContentMergeSection({ idea, all, onUpdate }: { idea: ContentIdea; all: ContentIdea[]; onUpdate: (i: ContentIdea) => void }) {
  const { toast } = useWorkspace()
  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState(false)
  const children = useMemo(() => all.filter(i => i.merged_into === idea.id && i.status === "samengevoegd"), [all, idea.id])
  const similar = useMemo(() => suggestions(idea as any, all as any) as unknown as { idea: ContentIdea; why: string }[], [idea, all])

  const split = async (c: ContentIdea) => {
    setBusy(c.id)
    try {
      const r = await postMerge({ action: "split", id: c.id })
      onUpdate({ ...c, status: (c.merge_backup?.status as ContentIdea["status"]) || "nieuw", merged_into: null, merge_backup: null })
      if (r.idea) onUpdate(r.idea)
      toast(`"${c.title}" is weer een losse kans`)
    } catch (e: any) { toast(`Splitsen mislukt: ${e.message}`, "error") }
    setBusy(null)
  }

  // Deze kans is zelf samengevoegd
  if (idea.status === "samengevoegd") {
    const main = all.find(i => i.id === idea.merged_into)
    return (
      <section className="psec" aria-label="Samengevoegd">
        <div className="merge-note">
          <Layers aria-hidden />
          <p>Deze kans is samengevoegd met <b>{main ? main.title : "een andere kans"}</b>: daar wordt hij in één artikel meegenomen.</p>
          {main && <Link className="btn btn-secondary btn-sm" href={`/content/${main.id}`}>Open de hoofdkans</Link>}
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => split(idea)}><Unlink aria-hidden />Splitsen</button>
        </div>
      </section>
    )
  }
  if (!children.length && (!canMerge(idea) || !similar.length)) return null
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <section className="psec" aria-labelledby="cp-merge">
      {children.length > 0 && (
        <>
          <h3 className="psec-title" id="cp-merge"><Layers aria-hidden />Samengevoegd in deze kans ({children.length + 1} ideeën, één artikel)</h3>
          <p className="muted small">De zoekwoorden, bronnen en aanleidingen van deze ideeën zitten in deze kans en in de briefing. Splitsen zet alles terug zoals het was.</p>
          <ul className="merge-list">
            {children.map(c => (
              <li key={c.id}>
                <span className="bulk-main"><b>{c.title}</b>{c.why_now && <span className="subtle small clamp2">{c.why_now}</span>}</span>
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => split(c)}><Unlink aria-hidden />{busy === c.id ? "Bezig…" : "Splitsen"}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {canMerge(idea) && similar.length > 0 && (
        <details className="merge-more" open={!children.length}>
          <summary id={children.length ? undefined : "cp-merge"}>Lijkt op {similar.length} andere {similar.length === 1 ? "kans" : "kansen"}: samen één artikel?</summary>
          <ul className="merge-list">
            {similar.map(s => (
              <li key={s.idea.id}>
                <label className="merge-cand">
                  <input type="checkbox" checked={picked.has(s.idea.id)} onChange={() => toggle(s.idea.id)} />
                  <span className="bulk-main"><span className="subtle small">{s.why}</span><b>{s.idea.title}</b></span>
                </label>
              </li>
            ))}
          </ul>
          <div className="inline-form-actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn btn-secondary btn-sm" disabled={!picked.size} onClick={() => setDialog(true)}><Layers aria-hidden />Samenvoegen met {picked.size || ""} {picked.size === 1 ? "kans" : "kansen"}</button>
          </div>
        </details>
      )}
      {dialog && (
        <ContentMergeDialog ideas={[idea, ...all.filter(i => picked.has(i.id))]} initialMain={idea.id} onClose={() => setDialog(false)}
          onDone={(main, ids) => {
            for (const id of ids) { const o = all.find(i => i.id === id); if (o) onUpdate({ ...o, status: "samengevoegd", merged_into: main.id, merge_backup: { status: o.status } }) }
            onUpdate(main); setDialog(false); setPicked(new Set())
            toast(`${ids.length + 1} kansen samengevoegd tot "${main.title}"`)
          }} />
      )}
    </section>
  )
}
