"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { AdviceDetail, AdviceRecord, Experiment, GscRow, Level, Priority, Signal, Status, Streak, Task } from "./types"
import { buildCtrModel, type CtrModel } from "./ctr"
import { buildAdhocSignal, buildSignals, signalKey, toPath } from "./signals"
import { columnOf, isVisible, mergeTasks, PRIORITY_ORDER } from "./workflow"
import { today } from "./format"
import type { PageRow } from "./pages"
import type { Lesson } from "./learning"

// ── Data-ophalen ─────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init })
  let body: any = null
  try { body = await res.json() } catch { /* leeg antwoord */ }
  if (!res.ok) throw new HttpError(res.status, body?.error || `HTTP ${res.status}`)
  return body as T
}

export interface AnalyticsData {
  period: number
  overview: GscRow[]
  prevOverview: GscRow[]
  keywords: GscRow[]
  prevKeywords: GscRow[]
  pages: GscRow[]
  ga4: { sessions: number; keyEvents: number } | null
  ga4Prev: { sessions: number; keyEvents: number } | null
  ga4Error: { code: string; message: string; serviceAccount?: string | null } | null
  range: { startDate: string; endDate: string } | null
}

function sumGa4(resp: any) {
  const rows = resp?.rows || []
  return {
    sessions: rows.reduce((s: number, r: any) => s + (parseFloat(r.metricValues?.[0]?.value) || 0), 0),
    keyEvents: rows.reduce((s: number, r: any) => s + (parseFloat(r.metricValues?.[1]?.value) || 0), 0),
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

export interface Toast { id: number; message: string; tone: "success" | "error" | "info" }

export interface StatusOptions {
  note?: string | null
  snoozeUntil?: string | null
  experiment?: {
    description: string
    baseline: Record<string, unknown>
    hypothesis?: string
    targetPages?: string[]
    targetQueries?: string[]
    predicted?: { gain: number | null; low: number | null; high: number | null; metric: string } | null
  }
}

export interface NewTask {
  title: string
  description?: string
  query?: string
  page?: string
  priority: Priority
  status: "nieuw" | "goedgekeurd" | "in_uitvoering"
  effort?: Level
}

// Waarmee het zijpaneel opent (bv. na slepen naar Evalueren: direct "wat heb je aangepast?")
export type PanelIntent = null | "execute" | "close"

export interface WorkspaceUser { name?: string | null; email?: string | null; image?: string | null }

interface WorkspaceValue {
  user: WorkspaceUser
  loading: boolean
  error: string | null
  authError: boolean
  storageError: string | null
  // basis (laatste 28 dagen)
  keywords: GscRow[]
  prevKeywords: GscRow[]
  pages: GscRow[]
  overview: GscRow[]
  prevOverview: GscRow[]
  dataUntil: string | null
  listWindow: { startDate: string; endDate: string } | null
  inventory: PageRow[]
  ga4Pages: { path: string; sessions: number; keyEvents: number }[] | null  // null = GA4 niet beschikbaar
  ctrModel: CtrModel
  signals: Signal[]
  tasks: Task[]
  visibleTasks: Task[]
  experiments: Experiment[]
  newSinceLastVisit: Set<string>
  lastVisit: string | null
  // acties
  setStatus: (task: Task, to: Status, opts?: StatusOptions) => Promise<boolean>
  setOwner: (task: Task, owner: string | null) => Promise<boolean>
  addTask: (input: NewTask) => Promise<string | null>
  openTask: (key: string, intent?: PanelIntent) => void
  panelIntent: PanelIntent
  openSubject: (subject: { query?: string; page?: string }) => void
  closePanel: () => void
  panelTask: Task | null
  getDetail: (signal: Signal) => Promise<AdviceDetail>
  getAnalytics: (period: number) => Promise<AnalyticsData>
  toast: (message: string, tone?: Toast["tone"]) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  reload: () => void
  reloadTick: number
  lessons: Lesson[]
  users: { email: string; name: string | null; image: string | null }[]
  me: string | null
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace buiten WorkspaceProvider")
  return ctx
}

const SEEN_KEY = "gijs.seo.seenSignals"
const VISIT_KEY = "gijs.seo.lastVisit"

function readStorage(key: string) {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* privémodus e.d. */ }
}

export function WorkspaceProvider({ children, user }: { children: ReactNode; user: WorkspaceUser }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [keywords, setKeywords] = useState<GscRow[]>([])
  const [prevKeywords, setPrevKeywords] = useState<GscRow[]>([])
  const [pages, setPages] = useState<GscRow[]>([])
  const [overview, setOverview] = useState<GscRow[]>([])
  const [prevOverview, setPrevOverview] = useState<GscRow[]>([])
  const [streaks, setStreaks] = useState<Streak[]>([])
  const [inventory, setInventory] = useState<PageRow[]>([])
  const [ga4Pages, setGa4Pages] = useState<{ path: string; sessions: number; keyEvents: number }[] | null>(null)
  const [listWindow, setListWindow] = useState<{ startDate: string; endDate: string } | null>(null)
  const [records, setRecords] = useState<AdviceRecord[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [users, setUsers] = useState<{ email: string; name: string | null; image: string | null }[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [panelKey, setPanelKey] = useState<string | null>(null)
  const [panelIntent, setPanelIntent] = useState<PanelIntent>(null)
  const [adhoc, setAdhoc] = useState<Record<string, Signal>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const [newSinceLastVisit, setNewSinceLastVisit] = useState<Set<string>>(new Set())
  const [lastVisit, setLastVisit] = useState<string | null>(null)
  const detailCache = useRef(new Map<string, Promise<AdviceDetail>>())
  const analyticsCache = useRef(new Map<number, Promise<AnalyticsData>>())
  const toastId = useRef(0)

  const toast = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, message, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === "error" ? 7000 : 3800)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAuthError(false)
    detailCache.current.clear()
    analyticsCache.current.clear()

    const core = Promise.all([
      getJson(`/api/gsc?type=keywords&days=28&limit=250&order=impressions`),
      getJson(`/api/gsc?type=keywords&days=28&offset=28&limit=250&order=impressions`),
      getJson(`/api/gsc?type=pages&days=28&limit=100&order=impressions`),
      getJson(`/api/gsc?type=overview&days=28`),
      getJson(`/api/gsc?type=overview&days=28&offset=28`),
    ])
    const stored = Promise.allSettled([
      getJson(`/api/trends?type=streaks`),
      getJson(`/api/advice`),
      getJson(`/api/experiments`),
      getJson(`/api/pages`),
      getJson(`/api/ga4?type=pages&days=28`),
      getJson(`/api/lessons`),
      getJson(`/api/users`),
    ])

    Promise.all([core, stored])
      .then(([[kw, prevKw, pg, ov, prevOv], [tr, adv, exp, inv, ga, les, us]]) => {
        if (cancelled) return
        setKeywords(kw.rows || [])
        setPrevKeywords(prevKw.rows || [])
        setPages(pg.rows || [])
        setListWindow(kw.startDate && kw.endDate ? { startDate: kw.startDate, endDate: kw.endDate } : null)
        setInventory(inv.status === "fulfilled" ? inv.value.rows || [] : [])
        setGa4Pages(ga.status === "fulfilled" ? ga.value.rows || [] : null)
        setOverview(ov.rows || [])
        setPrevOverview(prevOv.rows || [])
        setStreaks(tr.status === "fulfilled" ? tr.value.rows || [] : [])
        setRecords(adv.status === "fulfilled" ? adv.value.rows || [] : [])
        setExperiments(exp.status === "fulfilled" ? exp.value.rows || [] : [])
        setLessons(les.status === "fulfilled" ? les.value.lessons || [] : [])
        if (us.status === "fulfilled") { setUsers(us.value.rows || []); setMe(us.value.me || null) }
        const failed = [adv, exp].find(r => r.status === "rejected") as PromiseRejectedResult | undefined
        setStorageError(failed ? (failed.reason?.message || "Opslag niet bereikbaar") : null)
      })
      .catch((e: any) => {
        if (cancelled) return
        if (e instanceof HttpError && e.status === 401) setAuthError(true)
        else setError(e?.message || "Ophalen mislukt")
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [reloadTick])

  const ctrModel = useMemo(() => buildCtrModel(keywords), [keywords])
  const signals = useMemo(
    () => {
      if (loading) return []
      const feedback = records
        .filter(r => (r.status === "afgewezen" || r.status === "onvoldoende_bewijs") && r.snapshot?.kind && !(r.note || "").startsWith("Al opgelost"))
        .map(r => ({ key: r.advice_key, kind: r.snapshot!.kind, intent: r.snapshot!.intent }))
        // Teruggedraaide afwijzingslessen: die afwijzingen tellen niet meer mee voor de prioriteit
        .filter(f => !lessons.some(l => l.status === "teruggedraaid" && l.effect?.type === "afwijzing" && l.effect.match?.kind === f.kind && (l.effect.match?.intent ?? undefined) === (l.effect.match?.intent ? f.intent : undefined)))
      return buildSignals({ keywords, prevKeywords, pages, streaks, inventory, ga4Pages: ga4Pages || undefined, feedback, lessons }, ctrModel)
    },
    [loading, keywords, prevKeywords, pages, streaks, inventory, ga4Pages, records, ctrModel, lessons]
  )
  const tasks = useMemo(() => mergeTasks(signals, records, experiments), [signals, records, experiments])
  const visibleTasks = useMemo(() => tasks.filter(isVisible), [tasks])

  // "Sinds je vorige bezoek": welke signalen zijn nieuw t.o.v. de vorige keer dat je keek
  useEffect(() => {
    if (loading || !signals.length) return
    const prevSeen = readStorage(SEEN_KEY)
    const prevVisit = readStorage(VISIT_KEY)
    const seen = new Set<string>(prevSeen ? JSON.parse(prevSeen) : [])
    setLastVisit(prevVisit)
    setNewSinceLastVisit(prevSeen ? new Set(signals.filter(s => !seen.has(s.key)).map(s => s.key)) : new Set())
    const all = new Set([...seen, ...signals.map(s => s.key)])
    writeStorage(SEEN_KEY, JSON.stringify([...all].slice(-500)))
    if (prevVisit !== today()) writeStorage(VISIT_KEY, today())
  }, [loading, signals])

  const dataUntil = overview.length ? overview[overview.length - 1].keys[0] : null

  const findTask = useCallback((key: string): Task | null => {
    const t = tasks.find(x => x.key === key)
    if (t) return t
    const s = adhoc[key]
    return s ? { key, signal: s, status: "nieuw", note: null, snoozeUntil: null, snoozed: false, current: true, updatedAt: null, experiments: [] } : null
  }, [tasks, adhoc])

  const panelTask = panelKey ? findTask(panelKey) : null

  const openTask = useCallback((key: string, intent: PanelIntent = null) => { setPanelIntent(intent); setPanelKey(key) }, [])
  const closePanel = useCallback(() => { setPanelKey(null); setPanelIntent(null) }, [])

  const openSubject = useCallback((subject: { query?: string; page?: string }) => {
    const match = tasks.find(t =>
      t.signal.kind !== "analyse" && t.current &&
      ((subject.query && t.signal.query === subject.query) || (subject.page && !subject.query && t.signal.page === subject.page))
    )
    if (match) { setPanelIntent(null); setPanelKey(match.key); return }
    const existing = tasks.find(t => t.signal.kind === "analyse" &&
      ((subject.query && t.signal.query === subject.query) || (subject.page && t.signal.page === subject.page)))
    if (existing) { setPanelIntent(null); setPanelKey(existing.key); return }
    const s = buildAdhocSignal(subject, { keywords, pages }, ctrModel)
    setAdhoc(a => ({ ...a, [s.key]: s }))
    setPanelIntent(null); setPanelKey(s.key)
  }, [tasks, keywords, pages, ctrModel])

  const getDetail = useCallback((signal: Signal) => {
    const params = new URLSearchParams()
    if (signal.query) params.set("query", signal.query)
    if (signal.page && (!signal.query || signal.kind === "pagina" || signal.kind === "dubbel")) params.set("page", signal.page)
    if (signal.kind === "dubbel" && signal.relatedPages?.length) params.set("related", signal.relatedPages.join(","))
    const cacheKey = params.toString()
    const cached = detailCache.current.get(cacheKey)
    if (cached) return cached
    const p = getJson<AdviceDetail>(`/api/advice/detail?${cacheKey}`).catch(e => {
      detailCache.current.delete(cacheKey)
      throw e
    })
    detailCache.current.set(cacheKey, p)
    return p
  }, [])

  const getAnalytics = useCallback((period: number) => {
    const cached = analyticsCache.current.get(period)
    if (cached) return cached
    const p = (async (): Promise<AnalyticsData> => {
      const reuse = period === 28 && keywords.length > 0
      const [ov, prevOv, kw, prevKw, pg, ga, gaPrev] = await Promise.all([
        getJson(`/api/gsc?type=overview&days=${period}`),
        reuse ? { rows: prevOverview } : getJson(`/api/gsc?type=overview&days=${period}&offset=${period}`),
        reuse ? { rows: keywords } : getJson(`/api/gsc?type=keywords&days=${period}&limit=250&order=impressions`),
        reuse ? { rows: prevKeywords } : getJson(`/api/gsc?type=keywords&days=${period}&offset=${period}&limit=250&order=impressions`),
        reuse ? { rows: pages } : getJson(`/api/gsc?type=pages&days=${period}&limit=100&order=impressions`),
        fetch(`/api/ga4?days=${period}`).then(async r => ({ ok: r.ok, body: await r.json().catch(() => null) })).catch(() => ({ ok: false, body: null })),
        fetch(`/api/ga4?days=${period}&offset=${period}`).then(async r => ({ ok: r.ok, body: await r.json().catch(() => null) })).catch(() => ({ ok: false, body: null })),
      ])
      const ga4Error = ga.ok ? null : {
        code: ga.body?.code || "error",
        message: ga.body?.error || "GA4 niet bereikbaar",
        serviceAccount: ga.body?.serviceAccount ?? null,
      }
      return {
        period,
        overview: ov.rows || [],
        prevOverview: prevOv.rows || [],
        keywords: kw.rows || [],
        prevKeywords: prevKw.rows || [],
        pages: pg.rows || [],
        ga4: ga.ok ? sumGa4(ga.body) : null,
        ga4Prev: gaPrev.ok ? sumGa4(gaPrev.body) : null,
        ga4Error,
        range: (ov as any).startDate ? { startDate: (ov as any).startDate, endDate: (ov as any).endDate } : null,
      }
    })().catch(e => { analyticsCache.current.delete(period); throw e })
    analyticsCache.current.set(period, p)
    return p
  }, [keywords, prevKeywords, pages, overview, prevOverview]) // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = useCallback(async (task: Task, to: Status, opts: StatusOptions = {}) => {
    const snapshot: Signal = { ...task.signal }
    try {
      const res = await getJson<{ row: AdviceRecord }>(`/api/advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advice_key: task.key,
          advice_title: `${task.signal.headline} — ${task.signal.title}`,
          advice_type: task.signal.legacyType,
          status: to,
          note: opts.note === undefined ? undefined : opts.note,
          snooze_until: opts.snoozeUntil ?? null,
          snapshot,
        }),
      })
      setRecords(rs => [res.row, ...rs.filter(r => r.advice_key !== task.key)])

      if (opts.experiment) {
        const exp = await getJson<{ experiment: Experiment }>(`/api/experiments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            advice_key: task.key,
            description: opts.experiment.description,
            baseline: opts.experiment.baseline,
            hypothesis: opts.experiment.hypothesis,
            target_pages: opts.experiment.targetPages,
            target_queries: opts.experiment.targetQueries,
            predicted: opts.experiment.predicted ?? null,
            query: task.signal.query ?? null,
            // Bij een zoekwoord met doelpagina meten we de zoekwoord-paginacombinatie
            page: (opts.experiment.baseline.targetPage as string | undefined) ?? (task.signal.kind === "dubbel" ? task.signal.page ?? null : task.signal.query ? null : task.signal.page ?? null),
          }),
        })
        setExperiments(es => [exp.experiment, ...es])
      }
      return true
    } catch (e: any) {
      if (e instanceof HttpError && e.status === 401) setAuthError(true)
      toast(`Opslaan mislukt: ${e?.message || "onbekende fout"}. Je wijziging is niet bewaard.`, "error")
      return false
    }
  }, [toast])

  // Eigenaar toewijzen (wie pakt dit op). Status blijft zoals hij is.
  const setOwner = useCallback(async (task: Task, owner: string | null) => {
    try {
      const res = await getJson<{ row: AdviceRecord }>(`/api/advice`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advice_key: task.key, advice_title: `${task.signal.headline} — ${task.signal.title}`, advice_type: task.signal.legacyType, status: task.status, snapshot: { ...task.signal }, owner: owner || null }),
      })
      setRecords(rs => [res.row, ...rs.filter(r => r.advice_key !== task.key)])
      return true
    } catch (e: any) {
      toast(`Opslaan mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [toast])

  // Eigen taak toevoegen: wordt als statusregel met momentopname opgeslagen, net als adviezen
  const addTask = useCallback(async (input: NewTask) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const query = input.query?.trim() || undefined
    const page = input.page?.trim() ? toPath(input.page.trim()).replace(/\/$/, "") || "/" : undefined
    const base = query || page ? buildAdhocSignal({ query, page: query ? undefined : page }, { keywords, pages }, ctrModel) : null
    const signal: Signal = {
      key: signalKey("eigen", id),
      kind: "eigen",
      legacyType: "eigen",
      query, page,
      headline: input.title.trim(),
      title: input.description?.trim().split("\n")[0].slice(0, 140) || "Eigen taak",
      summary: input.description?.trim() || "Door jou toegevoegd.",
      description: input.description?.trim() || undefined,
      metrics: base?.metrics || {},
      gain: base?.gain ?? 0,
      estimate: base?.estimate,
      priority: input.priority,
      priorityRank: 0,
      evidence: base?.evidence || "redelijk",
      evidenceReason: base?.evidenceReason || "Eigen taak: geen automatisch bewijs.",
      score: 0,
      generatedAt: new Date().toISOString(),
      intent: base?.intent,
      place: base?.place,
      action: input.title.trim(),
      effort: input.effort || "middel",
      risk: "laag",
    }
    const task: Task = { key: signal.key, signal, status: "nieuw", note: null, snoozeUntil: null, snoozed: false, current: true, updatedAt: null, experiments: [] }
    const ok = await setStatus(task, input.status, {})
    return ok ? signal.key : null
  }, [keywords, pages, ctrModel, setStatus])

  const value: WorkspaceValue = {
    user,
    loading, error, authError, storageError,
    keywords, prevKeywords, pages, overview, prevOverview, dataUntil, listWindow, inventory, ga4Pages,
    ctrModel, signals, tasks, visibleTasks, experiments,
    newSinceLastVisit, lastVisit,
    setStatus, setOwner, addTask, openTask, openSubject, closePanel, panelTask, panelIntent,
    getDetail, getAnalytics,
    toast, toasts, dismissToast,
    reload: () => setReloadTick(t => t + 1),
    reloadTick,
    lessons, users, me,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

// ── Afgeleide selecties die meerdere schermen gebruiken ──────────────────────

export function sortByPriority(a: Task, b: Task) {
  return PRIORITY_ORDER[a.signal.priority] - PRIORITY_ORDER[b.signal.priority] || b.signal.score - a.signal.score
}

export function useTaskGroups() {
  const { visibleTasks } = useWorkspace()
  return useMemo(() => {
    // Al opgeloste signalen (bv. doorverwijzing staat al) tellen niet mee in de wachtrij: controleer en sluit
    const resolved = visibleTasks.filter(t => columnOf(t.status) === "beoordelen" && !!t.signal.resolved && t.current)
    const toReview = visibleTasks.filter(t => columnOf(t.status) === "beoordelen" && !t.snoozed && !(t.signal.resolved && t.current)).sort(sortByPriority)
    const snoozed = visibleTasks.filter(t => t.snoozed)
    const active = visibleTasks.filter(t => ["gepland", "uitvoering"].includes(columnOf(t.status)))
      .sort((a, b) => (a.status === "in_uitvoering" ? -1 : 0) - (b.status === "in_uitvoering" ? -1 : 0) || sortByPriority(a, b))
    const evaluating = visibleTasks.filter(t => columnOf(t.status) === "evalueren")
    const done = visibleTasks.filter(t => columnOf(t.status) === "afgerond")
    return { toReview, snoozed, active, evaluating, done, resolved }
  }, [visibleTasks])
}

export { toPath }
