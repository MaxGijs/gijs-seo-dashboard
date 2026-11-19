"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BellRing, CalendarClock, Check, ExternalLink, ListTodo, Newspaper, Plus } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import type { Task } from "@/lib/types"
import { addDays, dateLong, dateShort, today } from "@/lib/format"
import ReminderDialog from "./ReminderDialog"

// Herinneringen op Vandaag: wat vandaag (of eerder) terugkomt, en wat eraan komt
export default function RemindersBlock() {
  const { tasks, loading, users } = useWorkspace()
  const [adding, setAdding] = useState(false)
  const all = tasks.filter(t => t.signal.reminder && t.status === "uitgesteld")
  const due = all.filter(t => !t.snoozed).sort((a, b) => (a.snoozeUntil || "").localeCompare(b.snoozeUntil || ""))
  const upcoming = all.filter(t => t.snoozed).sort((a, b) => (a.snoozeUntil || "").localeCompare(b.snoozeUntil || ""))
  const who = (email?: string | null) => (email ? users.find(u => u.email === email)?.name?.split(" ")[0] || email.split("@")[0] : "iedereen")
  if (loading) return null

  return (
    <section className="reminders" aria-labelledby="rem-head">
      <div className="section-head">
        <div>
          <h2 className="section-title" id="rem-head"><BellRing aria-hidden />Herinneringen</h2>
          <p className="section-sub">{due.length ? `${due.length} voor vandaag` : "Niets voor vandaag"}{upcoming.length ? ` · ${upcoming.length} gepland` : ""}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><Plus aria-hidden />Herinnering</button>
      </div>
      {due.map(t => <DueReminder key={t.key} t={t} who={who(t.owner)} />)}
      {upcoming.length > 0 && (
        <ul className="rem-upcoming">
          {upcoming.slice(0, 5).map(t => <UpcomingReminder key={t.key} t={t} who={who(t.owner)} />)}
          {upcoming.length > 5 && <li className="subtle small">en nog {upcoming.length - 5} later</li>}
        </ul>
      )}
      {adding && <ReminderDialog onClose={() => setAdding(false)} />}
    </section>
  )
}

function UpcomingReminder({ t, who }: { t: Task; who: string }) {
  const { openTask } = useWorkspace()
  return (
    <li>
      <CalendarClock aria-hidden />
      <span className="rem-date">{dateShort(t.snoozeUntil!)}</span>
      <button className="link-btn" onClick={() => openTask(t.key)}>{t.signal.headline}</button>
      <span className="subtle small">voor {who}</span>
    </li>
  )
}

function DueReminder({ t, who }: { t: Task; who: string }) {
  const { removeTask, setStatus, snoozeReminder, openTask, toast } = useWorkspace()
  const router = useRouter()
  const [later, setLater] = useState(false)
  const [date, setDate] = useState(addDays(today(), 7))
  const [busy, setBusy] = useState(false)
  const r = t.signal.reminder!
  const late = t.snoozeUntil && t.snoozeUntil < today()

  const toContent = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t.signal.headline, why: t.signal.description || t.signal.headline, sourceUrl: r.link || undefined }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      await removeTask(t, "Contentkans gemaakt; herinnering afgerond")
      router.push(`/content/${j.idea.id}`)
    } catch (e: any) { toast(`Contentkans maken mislukt: ${e.message}`, "error") } finally { setBusy(false) }
  }
  const toTask = async () => {
    setBusy(true)
    const { reminder: _r, ...signal } = t.signal
    const ok = await setStatus({ ...t, signal }, "goedgekeurd", { note: t.note })
    setBusy(false)
    if (ok) { toast("Taak gemaakt en gepland"); openTask(t.key) }
  }
  const reschedule = async () => {
    if (!date || date < today()) return
    setBusy(true)
    const ok = await snoozeReminder(t, date)
    setBusy(false)
    if (ok) { toast(`Herinnering verzet naar ${dateLong(date)}`); setLater(false) }
  }

  return (
    <article className="card rem-card">
      <div className="rem-top">
        <span className="kind-label tone-warning"><BellRing aria-hidden />Herinnering</span>
        <span className="subtle small">{late ? `sinds ${dateShort(t.snoozeUntil!)}` : "vandaag"} · voor {who}</span>
      </div>
      <h3 className="rem-title"><button className="link-btn" onClick={() => openTask(t.key)}>{t.signal.headline}</button></h3>
      {t.signal.description && <p className="rem-desc">{t.signal.description}</p>}
      {r.link && <a className="rem-link" href={r.link} target="_blank" rel="noopener noreferrer">{r.link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)}<ExternalLink aria-hidden /></a>}
      {later ? (
        <div className="rem-actions">
          <input type="date" className="input" min={today()} value={date} onChange={e => setDate(e.target.value)} aria-label="Nieuwe datum" />
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={reschedule}>Verzetten</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setLater(false)}>Annuleren</button>
        </div>
      ) : (
        <div className="rem-actions">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={toContent}><Newspaper aria-hidden />Maak er een contentkans van</button>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={toTask}><ListTodo aria-hidden />Maak er een taak van</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setLater(true)}><CalendarClock aria-hidden />Later opnieuw</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeTask(t, "Herinnering afgerond")}><Check aria-hidden />Gedaan</button>
        </div>
      )}
    </article>
  )
}
