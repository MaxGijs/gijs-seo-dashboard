"use client"

import type { ReactNode } from "react"
import { Activity, AlertCircle, CheckCircle2, Info, Sparkle, X, XCircle } from "lucide-react"
import type { Priority, Signal, Status, Task } from "@/lib/types"
import { KIND_META, STATUS_META, type Tone } from "@/lib/workflow"
import { dateShort, pos } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export function Badge({ tone = "neutral", children, dot = false, title }: { tone?: Tone; children: ReactNode; dot?: boolean; title?: string }) {
  return <span className={`badge tone-${tone}${dot ? " badge-dot" : ""}`} title={title}>{children}</span>
}

export function KindLabel({ signal }: { signal: Signal }) {
  if (signal.reminder) return <span className="kind-label tone-warning">Herinnering</span>
  const meta = KIND_META[signal.kind]
  return <span className={`kind-label tone-${meta.tone}`}>{meta.label}</span>
}

// Rood afgewezen-label met kruis (takenbord en lijsten)
export function RejectedBadge() {
  return <span className="badge badge-rejected"><XCircle aria-hidden />Afgewezen</span>
}

// Groen nieuw-label (takenbord): kaart die nieuw is sinds je vorige bezoek
export function NewBadge() {
  return <span className="badge badge-new"><Sparkle aria-hidden />Nieuw</span>
}

// Blauw meet-label (takenbord): kaart staat in Evalueren en wordt nu gemeten
export function MeasuringBadge() {
  return <span className="badge badge-measuring"><Activity aria-hidden />Wordt gemeten</span>
}

export function StatusBadge({ task }: { task: Pick<Task, "status" | "snoozeUntil" | "snoozed"> }) {
  if (task.status === "afgewezen") return <RejectedBadge />
  const meta = STATUS_META[task.status]
  const label = task.status === "uitgesteld" && task.snoozeUntil
    ? (task.snoozed ? `Uitgesteld tot ${dateShort(task.snoozeUntil)}` : "Uitstel verlopen")
    : meta.label
  return <Badge tone={meta.tone} dot>{label}</Badge>
}

export function statusLabel(status: Status) {
  return STATUS_META[status].label
}

const PRIO_LABEL: Record<Priority, string> = { hoog: "Hoog", middel: "Middel", laag: "Laag" }
export function PriorityMeter({ priority, showLabel = true }: { priority: Priority; showLabel?: boolean }) {
  return (
    <span className={`prio prio-${priority}`} title={`Prioriteit ${PRIO_LABEL[priority].toLowerCase()}`}>
      <span className="prio-bars" aria-hidden><i /><i /><i /></span>
      {showLabel ? PRIO_LABEL[priority] : <span className="sr-only">Prioriteit {PRIO_LABEL[priority]}</span>}
    </span>
  )
}

export function EmptyState({ icon, title, text, action, compact = true }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? " empty-compact" : ""}`}>
      <span className="empty-icon" aria-hidden>{icon}</span>
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ height = 16, width = "100%", radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skel" style={{ height, width, borderRadius: radius }} aria-hidden />
}

export function Alert({ tone = "info", title, children, action }: { tone?: "info" | "warning" | "error" | "success"; title: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === "error" ? AlertCircle : tone === "warning" ? AlertCircle : tone === "success" ? CheckCircle2 : Info
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon aria-hidden />
      <div style={{ flex: 1 }}>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  )
}

// Positie per week. Lager getal = beter, dus de lijn loopt omhoog als het beter gaat.
export function Sparkline({ points }: { points: { weekStart: string; position: number }[] }) {
  if (points.length < 2) return null
  const w = 520, h = 64, padY = 8
  const values = points.map(p => p.position)
  const min = Math.min(...values), max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const x = (i: number) => (i / (points.length - 1)) * (w - 12) + 6
  const y = (v: number) => padY + ((v - min) / span) * (h - padY * 2)
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.position).toFixed(1)}`).join(" ")
  const last = points[points.length - 1]
  return (
    <div className="spark-wrap">
      <div className="spark-head"><span>Gemiddelde positie per week</span><span>beste {pos(min)} · slechtste {pos(max)}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`Positie per week, van ${pos(points[0].position)} naar ${pos(last.position)}`}>
        <line x1="0" x2={w} y1={y(min)} y2={y(min)} stroke="var(--grey-100)" />
        <line x1="0" x2={w} y1={y(max)} y2={y(max)} stroke="var(--grey-100)" />
        <path d={d} fill="none" stroke="var(--accent-600)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.weekStart} cx={x(i)} cy={y(p.position)} r={i === points.length - 1 ? 4 : 2.5} fill={i === points.length - 1 ? "var(--green-800)" : "var(--accent-600)"}>
            <title>{`Week van ${dateShort(p.weekStart)}: positie ${pos(p.position)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="spark-axis"><span>{dateShort(points[0].weekStart)}</span><span>week van {dateShort(last.weekStart)}</span></div>
    </div>
  )
}

export function Toasts() {
  const { toasts, dismissToast } = useWorkspace()
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
          {t.tone === "error" ? <AlertCircle aria-hidden /> : t.tone === "info" ? <Info aria-hidden /> : <CheckCircle2 aria-hidden />}
          <span>{t.message}</span>
          <button className="icon-btn" onClick={() => dismissToast(t.id)} aria-label="Melding sluiten"><X /></button>
        </div>
      ))}
    </div>
  )
}

// Toont een pad met afbreekpunten na elke schuine streep, zodat lange URL's netjes afbreken.
export function Breakable({ text }: { text: string }) {
  const parts = text.split("/")
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <>/<wbr /></>}</span>)}</>
}

export function posClass(p: number) {
  if (p <= 3) return "pos-top"
  if (p <= 10) return "pos-p1"
  if (p <= 20) return "pos-p2"
  return "pos-far"
}

const INTENT_LABEL = { lokaal: "Lokaal", commercieel: "Commercieel", informatief: "Informatief", merk: "Merk" } as const
const INTENT_TONE = { lokaal: "accent", commercieel: "info", informatief: "neutral", merk: "neutral" } as const
export function IntentBadge({ intent }: { intent: keyof typeof INTENT_LABEL }) {
  return <span className={`badge tone-${INTENT_TONE[intent]}`} title="Zoekintentie">{INTENT_LABEL[intent]}</span>
}

// ── Paginakop ────────────────────────────────────────────────────────────────
// Elke pagina beantwoordt hier drie vragen (zie docs/DESIGN.md):
// wat zie ik (titel + conclusie), is het goed (status met stip), wat doe ik nu (één primaire actie).
export type StatusTone = "good" | "attention" | "problem" | "info"

export function StatusLine({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <p className={`page-status is-${tone}`}><span className="page-status-dot" aria-hidden />{children}</p>
}

export function PageHeader({ title, status, sub, actions, children }: {
  title: ReactNode
  status?: { tone: StatusTone; text: ReactNode } | null
  sub?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="page-head">
      <div className="page-head-main">
        <h1 className="page-title">{title}</h1>
        {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}
        {sub && <p className="page-sub">{sub}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

// Verdieping: één blok tegelijk via tabs, zodat er geen muur van kaarten ontstaat
export function SectionTabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: { id: T; label: ReactNode; count?: number | null }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="section-tabs" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`tabpanel-${t.id}`}
          className={`section-tab${value === t.id ? " is-active" : ""}`} onClick={() => onChange(t.id)}
          onKeyDown={e => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
            const i = tabs.findIndex(x => x.id === value), n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
            onChange(n.id); document.getElementById(`tab-${n.id}`)?.focus()
          }}>
          {t.label}{t.count != null && <span className="chip-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
