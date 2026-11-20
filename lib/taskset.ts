// Van ruwe data naar de takenlijst. Gedeeld door het dashboard (browser) en de Claude-koppeling
// (server), zodat beide precies dezelfde taken, prioriteiten en kolommen zien.
import type { AdviceRecord, DataCheck, Experiment, GscRow, Signal, Streak, Task } from "./types"
import type { PageRow } from "./pages"
import type { Lesson } from "./learning"
import type { CtrModel } from "./ctr"
import { buildSignals } from "./signals"
import { columnOf, isVisible, mergeTasks, PRIORITY_ORDER } from "./workflow"
import { toTries, type RouteTry } from "./routes"
import { PREFERENCE_MIN } from "./learning"

export interface TaskInputs {
  keywords: GscRow[]; prevKeywords: GscRow[]; pages: GscRow[]; streaks: Streak[]
  inventory: PageRow[]; ga4Pages: any[] | null; records: AdviceRecord[]; lessons: Lesson[]; checks: DataCheck[]; experiments: Experiment[]
  contentTries?: RouteTry[]   // bijgewerkte pagina's uit Content (route "inhoud")
}

export function signalsFrom(d: TaskInputs, ctrModel: CtrModel): Signal[] {
  const feedbackAll = d.records
    .filter(r => (r.status === "afgewezen" || r.status === "onvoldoende_bewijs") && r.snapshot?.kind && !(r.note || "").startsWith("Al opgelost"))
    .map(r => ({ key: r.advice_key, kind: r.snapshot!.kind, intent: r.snapshot!.intent }))
    // Teruggedraaide afwijzingslessen: die afwijzingen tellen niet meer mee voor de prioriteit
    .filter(f => !d.lessons.some(l => l.status === "teruggedraaid" && l.effect?.type === "afwijzing" && l.effect.match?.kind === f.kind && (l.effect.match?.intent ?? undefined) === (l.effect.match?.intent ? f.intent : undefined)))
  // Eén afwijzing van een soort is een voorstel: pas vanaf twee (of na bevestiging) zakken vergelijkbare adviezen
  const groupKey = (f: { kind: string; intent?: string }) => `afwijzing|${f.kind}|${f.intent || "-"}`
  const counts = new Map<string, number>()
  for (const f of feedbackAll) counts.set(groupKey(f), (counts.get(groupKey(f)) || 0) + 1)
  const confirmed = new Set(d.lessons.filter(l => l.confirmed_at && l.status === "actief").map(l => l.key))
  const feedback = feedbackAll.filter(f => (counts.get(groupKey(f)) || 0) >= PREFERENCE_MIN || confirmed.has(groupKey(f)))
  return buildSignals({ keywords: d.keywords, prevKeywords: d.prevKeywords, pages: d.pages, streaks: d.streaks, inventory: d.inventory, ga4Pages: d.ga4Pages || undefined, feedback, lessons: d.lessons, checks: d.checks, tries: [...toTries(d.experiments), ...(d.contentTries || [])] }, ctrModel)
}

export function sortByPriority(a: Task, b: Task) {
  return PRIORITY_ORDER[a.signal.priority] - PRIORITY_ORDER[b.signal.priority] || b.signal.score - a.signal.score
}

export function groupTasks(tasks: Task[]) {
  const visible = tasks.filter(isVisible)
  // Al opgeloste signalen (bv. doorverwijzing staat al) tellen niet mee in de wachtrij: controleer en sluit
  const resolved = visible.filter(t => columnOf(t.status) === "beoordelen" && !!t.signal.resolved && t.current)
  const toReview = visible.filter(t => columnOf(t.status) === "beoordelen" && !t.snoozed && !(t.signal.resolved && t.current)).sort(sortByPriority)
  const snoozed = visible.filter(t => t.snoozed)
  const active = visible.filter(t => ["gepland", "uitvoering"].includes(columnOf(t.status)))
    .sort((a, b) => (a.status === "in_uitvoering" ? -1 : 0) - (b.status === "in_uitvoering" ? -1 : 0) || sortByPriority(a, b))
  const evaluating = visible.filter(t => columnOf(t.status) === "evalueren")
  const done = visible.filter(t => columnOf(t.status) === "afgerond")
  return { visible, toReview, snoozed, active, evaluating, done, resolved }
}

export { mergeTasks }
