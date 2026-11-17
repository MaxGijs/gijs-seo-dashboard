"use client"

import { useState } from "react"
import { CheckCircle2, Copy, ExternalLink, Link2 } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { num } from "@/lib/format"
import { Alert, Skeleton } from "@/components/ui"

interface Suggestion { source: string; reason: string; impressions: number; alreadyLinks: boolean; existingAnchors: string[]; anchors: string[]; checked: boolean; error?: string }
const SITE = "https://www.groeninjestraat.nl"

// Concrete interne links naar de doelpagina: vanaf welke pagina, met welke tekst, en of de link er al is.
// Wordt pas opgehaald als je erom vraagt: het controleert de bronpagina's live.
export default function LinkSuggestions({ target, query }: { target: string; query?: string | null }) {
  const { toast } = useWorkspace()
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [rows, setRows] = useState<Suggestion[]>([])
  const [err, setErr] = useState<string | null>(null)
  const load = async () => {
    setState("loading")
    try {
      const r = await fetch(`/api/links?target=${encodeURIComponent(target)}${query ? `&query=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows([...j.suggestions].sort((a: Suggestion, b: Suggestion) => Number(a.alreadyLinks) - Number(b.alreadyLinks))); setState("ready")
    } catch (e: any) { setErr(e.message); setState("error") }
  }
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast("Linktekst gekopieerd")).catch(() => {}) }
  const todo = rows.filter(r => !r.alreadyLinks)
  return (
    <section className="psec" aria-labelledby="sec-links">
      <h3 className="psec-title" id="sec-links"><Link2 aria-hidden />Interne links naar {target}</h3>
      {state === "idle" && (
        <>
          <p className="step-detail">Interne links vanaf verwante pagina&apos;s zijn vaak de snelste manier om een pagina een paar posities te laten stijgen. Het dashboard zoekt de beste bronpagina&apos;s en kijkt live of de link er al staat.</p>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={load}><Link2 aria-hidden />Toon linkvoorstellen</button>
        </>
      )}
      {state === "loading" && <div style={{ display: "grid", gap: 8 }}><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>}
      {state === "error" && <Alert tone="error" title="Linkvoorstellen niet beschikbaar">{err}</Alert>}
      {state === "ready" && (
        rows.length === 0 ? <p className="muted small">Geen passende bronpagina&apos;s gevonden.</p> : (
          <>
            <p className="step-detail" style={{ marginBottom: 10 }}>{todo.length ? `${todo.length} ${todo.length === 1 ? "pagina linkt" : "pagina's linken"} nog niet naar deze pagina.` : "Alle voorgestelde pagina's linken al. Kies dan een andere aanpassing."} Gebruik wisselende linkteksten, niet overal exact hetzelfde zoekwoord.</p>
            <ul className="link-list">
              {rows.map(r => (
                <li key={r.source} className={`link-item${r.alreadyLinks ? " is-done" : ""}`}>
                  <div className="link-top">
                    {r.alreadyLinks ? <CheckCircle2 aria-hidden className="txt-up" /> : <Link2 aria-hidden />}
                    <a href={`${SITE}${r.source}`} target="_blank" rel="noopener noreferrer"><b>{r.source}</b><ExternalLink aria-hidden /></a>
                    <span className="subtle small">{num(r.impressions)} vert. / 28 d</span>
                  </div>
                  <p className="small">{r.alreadyLinks ? `Linkt al${r.existingAnchors.length ? ` met "${r.existingAnchors.join('", "')}"` : ""}.` : r.checked ? r.reason : `${r.reason} (Niet live gecontroleerd: ${r.error}.)`}</p>
                  {!r.alreadyLinks && (
                    <div className="link-anchors">{r.anchors.map(a => <button key={a} className="chip" onClick={() => copy(a)} title="Kopieer linktekst"><Copy aria-hidden />{a}</button>)}</div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </section>
  )
}
