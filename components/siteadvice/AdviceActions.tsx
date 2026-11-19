"use client"

import { useState } from "react"
import { CalendarClock, CalendarPlus, Check, Undo2, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { planFor, type SiteAdvice } from "@/lib/siteadvice"
import { dateShort, today } from "@/lib/format"

// Wat er met een siteadvies gebeurd is, of de knoppen om te beslissen
export function decisionOf(rec: { status: string; snooze_until: string | null } | undefined) {
  if (!rec || rec.status === "nieuw") return null
  if (rec.status === "uitgesteld") return rec.snooze_until && rec.snooze_until > today() ? "later" : null
  return rec.status === "afgewezen" ? "afgewezen" : "ingepland"
}

// Eén primaire knop per scherm: alleen het belangrijkste advies krijgt een gevulde knop
export default function AdviceActions({ a, compact = false, primary = false }: { a: SiteAdvice; compact?: boolean; primary?: boolean }) {
  const { tasks, siteDecisions, decideSiteAdvice } = useWorkspace()
  const [mode, setMode] = useState<null | "plan" | "reject">(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const rec = siteDecisions.get(a.key)
  const d = decisionOf(rec)
  const plan = planFor(a, tasks)
  const nothing = !plan.plan.length && !plan.create.length

  const decide = async (x: "ingepland" | "afgewezen" | "later" | "gezien" | "terug", n?: string) => {
    setBusy(true)
    const ok = await decideSiteAdvice(a, x, n)
    setBusy(false)
    if (ok) { setMode(null); setNote("") }
  }

  if (d) {
    return (
      <div className="advice-decided">
        <span className={`badge tone-${d === "afgewezen" ? "neutral" : d === "later" ? "info" : "success"}`}>
          {d === "ingepland" ? <><Check aria-hidden />{rec?.note || "Ingepland"}</> : d === "afgewezen" ? <><X aria-hidden />Afgewezen</> : <><CalendarClock aria-hidden />Later: terug op {dateShort(rec!.snooze_until!)}</>}
        </span>
        {rec?.updated_at && <span className="subtle small">{dateShort(rec.updated_at)}</span>}
        {d === "afgewezen" && rec?.note && <span className="subtle small">“{rec.note}”</span>}
        {d !== "ingepland" && <button className="link-btn" disabled={busy} onClick={() => decide("terug")}><Undo2 aria-hidden />Terugzetten</button>}
      </div>
    )
  }

  if (mode === "plan") {
    return (
      <div className="advice-confirm">
        <p className="small"><b>{nothing ? "Er valt niets in te plannen." : `Dit gaat ${plan.summary.toLowerCase()}.`}</b>{plan.create.length ? " Ze komen in Gepland; per pagina wordt na uitvoeren gemeten." : ""}</p>
        <div className="advice-btns">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(nothing ? "gezien" : "ingepland")}>{busy ? "Bezig…" : nothing ? "Markeer als gezien" : "Ja, inplannen"}</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode(null)}>Annuleren</button>
        </div>
      </div>
    )
  }
  if (mode === "reject") {
    return (
      <div className="advice-confirm">
        <label className="field-label" htmlFor={`rej-${a.key}`} style={{ margin: 0 }}>Waarom niet? <span className="subtle">(helpt het advies beter te maken)</span></label>
        <textarea id={`rej-${a.key}`} className="textarea" rows={compact ? 2 : 3} value={note} onChange={e => setNote(e.target.value)} placeholder="Bijvoorbeeld: daar hebben we nu geen capaciteit voor, of: die pagina's gaan we samenvoegen" />
        <div className="advice-btns">
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => decide("afgewezen", note.trim() || undefined)}>Afwijzen</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode(null)}>Annuleren</button>
        </div>
      </div>
    )
  }
  return (
    <div className="advice-btns">
      {a.kind === "route-stoppen"
        ? <button className={`btn ${primary ? "btn-primary" : "btn-secondary"} btn-sm`} disabled={busy} onClick={() => decide("gezien")}><Check aria-hidden />Gezien</button>
        : <button className={`btn ${primary ? "btn-primary" : "btn-secondary"} btn-sm`} disabled={busy} onClick={() => setMode("plan")} title={plan.summary}><CalendarPlus aria-hidden />Inplannen</button>}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide("later")}><CalendarClock aria-hidden />Later</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode("reject")}><X aria-hidden />Afwijzen</button>
    </div>
  )
}
