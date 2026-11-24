"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { AdviceDetail, AdviceRecord, DataCheck, Experiment, GscRow, Level, Priority, Signal, Status, Streak, Task } from "./types"
import { ROUTE_LABEL, toTries, type RouteTry } from "./routes"
import { buildSiteAdvice, planFor, type SiteAdvice } from "./siteadvice"
import { buildCtrModel, type CtrModel } from "./ctr"
import { buildAdhocSignal, kansSignal, signalKey, toPath } from "./signals"
import { columnOf, isVisible, mergeTasks } from "./workflow"
import { runningMeasurements, type RunningHit } from "./running"
import { today } from "./format"
import type { PageRow } from "./pages"
import type { Lesson } from "./learning"
import { signalsFrom, groupTasks, sortByPriority } from "./taskset"

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
    changedPages?: string[]
    predicted?: { gain: number | null; low: number | null; high: number | null; metric: string } | null
  }
  ignoreRunning?: boolean       // waarschuwing over een lopende meting al gezien
}

// Waarschuwing: kaart gaat naar Gepland of In uitvoering terwijl er op dezelfde pagina of hetzelfde zoekwoord al een meting loopt
export interface RunningWarning { task: Task; to: Status; hits: RunningHit[] }

export interface NewTask {
  title: string
  description?: string
  query?: string
  page?: string
  priority: Priority
  status: "nieuw" | "goedgekeurd" | "in_uitvoering"
  effort?: Level
  goal?: "seo" | "conversie" | "overig"
  route?: "inhoud" | "interne-links" | "titel-meta"   // soort aanpassing: telt mee in de lessen en het route-geheugen per pagina
}

export interface NewReminder {
  title: string
  description?: string
  date: string               // JJJJ-MM-DD
  link?: string
  owner?: string | null      // e-mail; standaard wie hem aanmaakt
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
  // Lange lijst (tot 1000 zoekwoorden, ook met weinig vertoningen): voor Bijna op pagina 1. Laadt na de rest.
  longKeywords: GscRow[] | null
  longPrevKeywords: GscRow[] | null
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
  contentTries: RouteTry[]          // bijgewerkte pagina's uit Content, voor "Eerder geprobeerd"
  newSinceLastVisit: Set<string>
  lastVisit: string | null
  // acties
  setStatus: (task: Task, to: Status, opts?: StatusOptions) => Promise<boolean>
  setOwner: (task: Task, owner: string | null) => Promise<boolean>
  removeTask: (task: Task, done?: string) => Promise<boolean>
  // Herinnering: een eigen notitie die op een datum terugkomt (Vandaag en Te beoordelen)
  addReminder: (input: NewReminder) => Promise<string | null>
  snoozeReminder: (task: Task, date: string) => Promise<boolean>
  // Siteadvies: automatisch berekend, plus wat er per advies is besloten (sleutel = advies-key)
  siteAdvice: SiteAdvice[]
  siteDecisions: Map<string, AdviceRecord>
  decideSiteAdvice: (a: SiteAdvice, decision: "ingepland" | "afgewezen" | "later" | "gezien" | "terug", note?: string) => Promise<boolean>
  undoExecution: (task: Task, status: Status) => Promise<boolean>
  // Kaarten samenvoegen tot één opdracht (en weer splitsen). Telt niet als afwijzing.
  mergeTasks: (main: Task, others: Task[], groupTitle?: string | null) => Promise<boolean>
  splitTask: (child: Task) => Promise<boolean>
  // Zoekwoorden zelf op Mijn taken zetten (Bijna op pagina 1); meerdere tegelijk worden één kaart
  pinKeywords: (queries: string[], groupTitle?: string | null) => Promise<boolean>
  // Verkeerd ingevulde opzet van een meting corrigeren (alleen vóór het eerste meetpunt)
  correctExperiment: (id: string, patch: { description?: string; changed_at?: string; changed_pages?: string[]; change_types?: string[] }) => Promise<string | null>
  taskForQuery: (q: string) => Task | null
  setGroupTitle: (main: Task, title: string | null) => Promise<boolean>
  runningWarning: RunningWarning | null
  answerRunningWarning: (goOn: boolean) => void
  setGoal: (task: Task, goal: "seo" | "conversie" | "overig") => Promise<boolean>
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

export function readStorage(key: string) {
  try { return window.localStorage.getItem(key) } catch { return null }
}
export function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* privémodus e.d. */ }
}

export function WorkspaceProvider({ children, user }: { children: ReactNode; user: WorkspaceUser }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [keywords, setKeywords] = useState<GscRow[]>([])
  const [prevKeywords, setPrevKeywords] = useState<GscRow[]>([])
  const [longKeywords, setLongKeywords] = useState<GscRow[] | null>(null)
  const [longPrevKeywords, setLongPrevKeywords] = useState<GscRow[] | null>(null)
  const [pages, setPages] = useState<GscRow[]>([])
  const [overview, setOverview] = useState<GscRow[]>([])
  const [prevOverview, setPrevOverview] = useState<GscRow[]>([])
  const [streaks, setStreaks] = useState<Streak[]>([])
  const [inventory, setInventory] = useState<PageRow[]>([])
  const [ga4Pages, setGa4Pages] = useState<{ path: string; sessions: number; keyEvents: number }[] | null>(null)
  const [listWindow, setListWindow] = useState<{ startDate: string; endDate: string } | null>(null)
  const [records, setRecords] = useState<AdviceRecord[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const experimentsRef = useRef<Experiment[]>([])
  experimentsRef.current = experiments
  const contentTriesRef = useRef<RouteTry[]>([])
  const [runningWarning, setRunningWarning] = useState<RunningWarning | null>(null)
  const runningResolve = useRef<((goOn: boolean) => void) | null>(null)
  const [contentTries, setContentTries] = useState<RouteTry[]>([])
  contentTriesRef.current = contentTries
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [checks, setChecks] = useState<DataCheck[]>([])
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
      getJson(`/api/checks`),
    ])

    Promise.all([core, stored])
      .then(([[kw, prevKw, pg, ov, prevOv], [tr, adv, exp, inv, ga, les, us, chk]]) => {
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
        setContentTries(exp.status === "fulfilled" ? exp.value.contentTries || [] : [])
        setLessons(les.status === "fulfilled" ? les.value.lessons || [] : [])
        setChecks(chk.status === "fulfilled" ? chk.value.rows || [] : [])
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

  // Lange lijst los van de rest, zodat het dashboard er niet op wacht
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getJson(`/api/gsc?type=keywords&days=28&limit=1000&order=impressions`),
      getJson(`/api/gsc?type=keywords&days=28&offset=28&limit=1000&order=impressions`),
    ]).then(([a, b]) => { if (!cancelled) { setLongKeywords(a.rows || []); setLongPrevKeywords(b.rows || []) } })
      .catch(() => { if (!cancelled) { setLongKeywords(null); setLongPrevKeywords(null) } })
    return () => { cancelled = true }
  }, [reloadTick])

  const ctrModel = useMemo(() => buildCtrModel(keywords), [keywords])
  const signals = useMemo(
    () => {
      if (loading) return []
      return signalsFrom({ keywords, prevKeywords, pages, streaks, inventory, ga4Pages, records, lessons, checks, experiments, contentTries, longKeywords: longKeywords || undefined }, ctrModel)
    },
    [loading, keywords, prevKeywords, pages, streaks, inventory, ga4Pages, records, ctrModel, lessons, checks, experiments, contentTries, longKeywords]
  )
  const tasks = useMemo(() => mergeTasks(signals, records, experiments), [signals, records, experiments])

  // Siteadvies (voor de hele site) en wat ermee gedaan is
  const siteAdvice = useMemo(() => (loading ? [] : buildSiteAdvice({
    tasks, inventory, lessons, tries: [...toTries(experiments), ...contentTries], keywords, ctrModel, ga4Pages,
  })), [loading, tasks, inventory, lessons, experiments, contentTries, keywords, ctrModel, ga4Pages])
  const siteDecisions = useMemo(() => {
    const m = new Map<string, AdviceRecord>()
    for (const r of records) if (r.advice_key.startsWith("site:")) m.set(r.advice_key.slice(5), r)
    return m
  }, [records])
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
    let overlapAck: Signal["overlap"] | null = null
    if (!opts.ignoreRunning && columnOf(task.status) === "beoordelen" && (to === "goedgekeurd" || to === "in_uitvoering")) {
      const hits = runningMeasurements(task, experimentsRef.current, undefined, contentTriesRef.current)
      if (hits.length) {
        const goOn = await new Promise<boolean>(resolve => { runningResolve.current = resolve; setRunningWarning({ task, to, hits }) })
        setRunningWarning(null)
        if (!goOn) return false
        // Toch uitvoeren: de overlap wordt vastgelegd op de kaart en later bij de meting
        overlapAck = { at: today(), with: hits.slice(0, 5).map(h => ({ id: h.experiment.id, description: (h.experiment.family_title || h.experiment.description).slice(0, 140), on: h.on.slice(0, 3), changedAt: h.experiment.changed_at })) }
      }
    }
    const snapshot: Signal = { ...task.signal, ...(overlapAck ? { overlap: overlapAck } : {}) }
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
            changed_pages: opts.experiment.changedPages,
            predicted: opts.experiment.predicted ?? null,
            // Eigen groepsnaam van samengevoegde kaarten wordt de naam van de familie in Experimenten
            group_title: task.merged?.length && task.signal.groupTitle ? task.signal.groupTitle : null,
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

  // Doel van een eigen taak wijzigen: bepaalt hoe er gemeten wordt (posities of aanvragen)
  const setGoal = useCallback(async (task: Task, goal: "seo" | "conversie" | "overig") => {
    const s = task.signal
    const signal: Signal = goal === "seo"
      ? { ...s, goal }
      : { ...s, goal, query: undefined, metrics: {}, gain: 0, estimate: undefined, intent: undefined, place: undefined, scope: undefined,
          evidence: "redelijk", evidenceReason: goal === "conversie" ? "Eigen taak, gemeten op energiescanaanvragen in GA4." : "Eigen taak: geen automatisch bewijs." }
    try {
      const res = await getJson<{ row: AdviceRecord }>(`/api/advice`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advice_key: task.key, advice_title: `${s.headline} — ${s.title}`, advice_type: s.legacyType, status: task.status, snapshot: signal }),
      })
      setRecords(rs => [res.row, ...rs.filter(r => r.advice_key !== task.key)])
      return true
    } catch (e: any) {
      toast(`Opslaan mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [toast])

  // Eigenaar toewijzen (wie pakt dit op). Status blijft zoals hij is.
  // Een stap terug uit Evalueren: de nog lopende meting vervalt (alleen vóór het eerste meetmoment)
  const undoExecution = useCallback(async (task: Task, status: Status) => {
    try {
      await getJson(`/api/experiments?key=${encodeURIComponent(task.key)}`, { method: "DELETE" })
      setExperiments(es => es.filter(e => !(e.advice_key === task.key && !e.outcome)))
    } catch (e: any) {
      toast(e?.message || "Terugzetten mislukt", "error")
      return false
    }
    return setStatus(task, status, { note: task.note, snoozeUntil: null })
  }, [toast, setStatus])

  // Zelf toegevoegde taak verwijderen (per ongeluk aangemaakt)
  const removeTask = useCallback(async (task: Task, done = "Taak verwijderd") => {
    try {
      await getJson(`/api/advice?key=${encodeURIComponent(task.key)}`, { method: "DELETE" })
      setRecords(rs => rs.filter(r => r.advice_key !== task.key))
      setExperiments(es => es.filter(e => e.advice_key !== task.key))
      toast(done)
      return true
    } catch (e: any) {
      toast(`Verwijderen mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [toast])

  const setOwner = useCallback(async (task: Task, owner: string | null) => {
    try {
      const res = await getJson<{ row: AdviceRecord }>(`/api/advice`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // snooze_until meesturen: anders wist toewijzen de uitsteldatum (en de datum van een herinnering)
        body: JSON.stringify({ advice_key: task.key, advice_title: `${task.signal.headline} — ${task.signal.title}`, advice_type: task.signal.legacyType, status: task.status, snapshot: { ...task.signal }, owner: owner || null, snooze_until: task.status === "uitgesteld" ? task.snoozeUntil : null }),
      })
      setRecords(rs => [res.row, ...rs.filter(r => r.advice_key !== task.key)])
      return true
    } catch (e: any) {
      toast(`Opslaan mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [toast])

  // Herinnering: opgeslagen als eigen taak die tot de datum is uitgesteld. Op de datum komt hij
  // vanzelf terug (Vandaag, en in Te beoordelen als "uitstel verlopen").
  const addReminder = useCallback(async (input: NewReminder) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const signal: Signal = {
      key: signalKey("eigen", id), kind: "eigen", legacyType: "eigen",
      headline: input.title.trim(),
      title: input.description?.trim().split("\n")[0].slice(0, 140) || "Herinnering",
      summary: input.description?.trim() || "Herinnering.",
      description: input.description?.trim() || undefined,
      metrics: {}, gain: 0, priority: "middel", priorityRank: 0,
      evidence: "redelijk", evidenceReason: "Herinnering: wordt niet gemeten.",
      goal: "overig", score: 0, generatedAt: new Date().toISOString(),
      action: input.title.trim(), effort: "laag", risk: "laag",
      reminder: { date: input.date, link: input.link?.trim() || null },
    }
    try {
      const res = await getJson<{ row: AdviceRecord }>(`/api/advice`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advice_key: signal.key, advice_title: `${signal.headline} — Herinnering`, advice_type: "eigen", status: "uitgesteld", snooze_until: input.date, snapshot: signal, owner: input.owner === undefined ? me : input.owner }),
      })
      setRecords(rs => [res.row, ...rs.filter(r => r.advice_key !== signal.key)])
      return signal.key
    } catch (e: any) {
      toast(`Opslaan mislukt: ${e?.message || "onbekende fout"}`, "error")
      return null
    }
  }, [me, toast])

  // Herinnering naar een nieuwe datum
  const snoozeReminder = useCallback(async (task: Task, date: string) => {
    const signal: Signal = { ...task.signal, reminder: { ...(task.signal.reminder || { link: null }), date } }
    return setStatus({ ...task, signal }, "uitgesteld", { note: task.note, snoozeUntil: date })
  }, [setStatus])

  // Eigen taak toevoegen: wordt als statusregel met momentopname opgeslagen, net als adviezen
  const addTask = useCallback(async (input: NewTask) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const goal = input.goal || "seo"
    // Alleen SEO-taken krijgen een zoekwoord en een Search Console-analyse; conversie- en overige taken niet
    const query = goal === "seo" ? input.query?.trim() || undefined : undefined
    const page = input.page?.trim() ? toPath(input.page.trim()).replace(/\/$/, "") || "/" : undefined
    const base = goal === "seo" && (query || page) ? buildAdhocSignal({ query, page: query ? undefined : page }, { keywords, pages }, ctrModel) : null
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
      evidenceReason: base?.evidenceReason || (goal === "conversie" ? "Eigen taak, gemeten op energiescanaanvragen in GA4." : "Eigen taak: geen automatisch bewijs."),
      goal,
      score: 0,
      generatedAt: new Date().toISOString(),
      intent: base?.intent,
      place: base?.place,
      // De soort aanpassing vooraan, zodat meting en lessen de route herkennen
      action: input.route ? `${ROUTE_LABEL[input.route]}: ${input.title.trim()}` : input.title.trim(),
      effort: input.effort || "middel",
      risk: "laag",
    }
    const task: Task = { key: signal.key, signal, status: "nieuw", note: null, snoozeUntil: null, snoozed: false, current: true, updatedAt: null, experiments: [] }
    const ok = await setStatus(task, input.status, {})
    return ok ? signal.key : null
  }, [keywords, pages, ctrModel, setStatus])

  // Beslissing over een siteadvies vastleggen. Inplannen = bestaande taken plannen en/of per pagina taken maken.
  const decideSiteAdvice = useCallback(async (a: SiteAdvice, decision: "ingepland" | "afgewezen" | "later" | "gezien" | "terug", note?: string) => {
    let made = 0, planned = 0
    if (decision === "ingepland") {
      const p = planFor(a, tasks)
      for (const k of p.plan) {
        const t = tasks.find(x => x.key === k)
        if (t && await setStatus(t, "goedgekeurd", { note: t.note })) planned++
      }
      for (const c of p.create) {
        if (await addTask({ title: c.title, description: c.description, query: c.query, page: c.page, route: c.route, goal: c.goal, priority: c.priority, status: "goedgekeurd", effort: "middel" })) made++
      }
    }
    const status: Status = decision === "afgewezen" ? "afgewezen" : decision === "later" ? "uitgesteld" : decision === "terug" ? "nieuw" : "goedgekeurd"
    const snooze = decision === "later" ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) : null
    const done = decision === "terug" ? null : decision === "ingepland" ? `Ingepland: ${[planned && `${planned} bestaande ${planned === 1 ? "taak" : "taken"}`, made && `${made} nieuwe ${made === 1 ? "taak" : "taken"}`].filter(Boolean).join(" en ") || "niets nieuws"}` : decision === "gezien" ? "Gezien" : note || null
    try {
      const res = await getJson<{ row: AdviceRecord }>(`/api/advice`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advice_key: `site:${a.key}`, advice_title: `${a.title} — Siteadvies`, advice_type: "site", status, note: done, snooze_until: snooze,
          snapshot: { kind: "site", adviceKind: a.kind, headline: a.title, priority: a.priority, gain: a.gain, confidence: a.confidence } }),
      })
      setRecords(rs => [res.row, ...rs.filter(r => r.advice_key !== `site:${a.key}`)])
      toast(decision === "ingepland" ? `${done}. Ze staan in Gepland.` : decision === "afgewezen" ? "Siteadvies afgewezen" : decision === "later" ? "Komt over 2 weken terug" : decision === "terug" ? "Advies staat weer open" : "Gemarkeerd als gezien")
      return true
    } catch (e: any) {
      toast(`Opslaan mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [tasks, setStatus, addTask, toast])

  // Eén record opslaan zonder bijwerkingen (gebruikt door samenvoegen en splitsen)
  const saveRecord = useCallback(async (key: string, signal: Signal, status: Status, extra: { note?: string | null; owner?: string | null; snooze_until?: string | null } = {}) => {
    const res = await getJson<{ row: AdviceRecord }>(`/api/advice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advice_key: key, advice_title: `${signal.headline} — ${signal.title}`, advice_type: signal.legacyType, status, snapshot: signal, ...extra }),
    })
    setRecords(rs => [res.row, ...rs.filter(r => r.advice_key !== key)])
    return res.row
  }, [])

  const mergeTasksInto = useCallback(async (main: Task, others: Task[], groupTitle?: string | null) => {
    try {
      // De hoofdkaart krijgt een eigen record, zodat hij blijft bestaan als het signaal later wegvalt.
      // Een eigen groepsnaam staat op de hoofdkaart.
      const title = groupTitle === undefined ? main.signal.groupTitle : groupTitle?.trim().slice(0, 140) || undefined
      if (!records.some(r => r.advice_key === main.key) || title !== main.signal.groupTitle) {
        const { groupTitle: _g, ...rest } = main.signal
        await saveRecord(main.key, title ? { ...rest, groupTitle: title } : rest, main.status, { note: main.note, owner: main.owner, snooze_until: main.snoozeUntil })
      }
      // Kaarten die zelf al samengevoegd waren, gaan met hun onderdelen mee naar de nieuwe hoofdkaart
      const all = others.flatMap(o => [o, ...(o.merged || [])]).filter(o => o.key !== main.key)
      for (const o of all) {
        const { mergedInto: _a, mergedFrom: _b, groupTitle: _c, ...clean } = o.signal
        const before = o.status === "samengevoegd" ? o.signal.mergedFrom || "nieuw" : o.status
        await saveRecord(o.key, { ...clean, mergedInto: main.key, mergedFrom: before }, "samengevoegd", { note: o.note })
      }
      toast(`${all.length} ${all.length === 1 ? "kaart" : "kaarten"} samengevoegd ${title ? `onder "${title}"` : `met ${main.signal.query ? `"${main.signal.query}"` : main.signal.headline}`}`)
      return true
    } catch (e: any) {
      if (e instanceof HttpError && e.status === 401) setAuthError(true)
      toast(`Samenvoegen mislukt: ${e?.message || "onbekende fout"}. Ververs de pagina en probeer het opnieuw.`, "error")
      return false
    }
  }, [records, saveRecord, toast])

  const correctExperiment = useCallback(async (id: string, patch: { description?: string; changed_at?: string; changed_pages?: string[]; change_types?: string[] }) => {
    try {
      const res = await getJson<{ experiment: Experiment; replaced?: string; unchanged?: boolean }>(`/api/experiments`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }),
      })
      if (res.unchanged) { toast("Niets gewijzigd"); return null }
      setExperiments(es => es.map(e => (e.id === (res.replaced || id) ? res.experiment : e)))
      toast("Opzet gecorrigeerd")
      return null
    } catch (e: any) {
      if (e instanceof HttpError && e.status === 401) setAuthError(true)
      return e?.message || "Corrigeren mislukt"
    }
  }, [toast])

  // De kaart waar een zoekwoord nu in zit: een eigen kaart, of de hoofdkaart waarin hij is samengevoegd
  const taskForQuery = useCallback((q: string): Task | null => {
    const own = (t: Task) => t.signal.query === q && !t.signal.reminder && !["afgewezen", "onvoldoende_bewijs"].includes(t.status)
    return tasks.find(t => own(t) && t.status !== "samengevoegd" && isVisible(t))
      || tasks.find(t => isVisible(t) && (t.merged || []).some(own))
      || null
  }, [tasks])

  const pinKeywords = useCallback(async (queries: string[], groupTitle?: string | null) => {
    const rows = queries.map(q => keywords.find(k => k.keys[0] === q) || longKeywords?.find(k => k.keys[0] === q)).filter((k): k is GscRow => !!k)
    if (!rows.length) return false
    const asTask = (k: GscRow): Task => ({ key: signalKey("kans", k.keys[0]), signal: kansSignal(k, ctrModel), status: "nieuw", note: null, snoozeUntil: null, snoozed: false, current: true, updatedAt: null, experiments: [] })
    // Bestaande kaart (Te beoordelen) gebruiken; wat al gepland of gemeten wordt, blijft waar het is
    const items = rows.map(k => ({ k, t: taskForQuery(k.keys[0]) }))
    const loose = items.filter(x => !x.t).map(x => asTask(x.k))
    const existing = [...new Map(items.filter(x => x.t).map(x => [x.t!.key, x.t!])).values()]
    try {
      if (rows.length === 1 || !groupTitle) {
        for (const t of loose) await saveRecord(t.key, t.signal, "nieuw")
        toast(loose.length ? `${loose.length === 1 ? `"${rows[0].keys[0]}" staat` : `${loose.length} zoekwoorden staan`} op Mijn taken` : "Staat al op Mijn taken")
        return true
      }
      const step = (t: Task) => ["beoordelen", "gepland", "uitvoering", "evalueren", "afgerond"].indexOf(columnOf(t.status))
      const usable = existing.filter(t => step(t) <= 2)
      // Hoofdkaart: die het verst is, anders het zoekwoord met de meeste vertoningen
      const pool = [...usable, ...loose].sort((a, b) => step(b) - step(a) || (b.signal.metrics.impressions || 0) - (a.signal.metrics.impressions || 0))
      const [main, ...others] = pool
      if (!main) { toast("Deze zoekwoorden worden al gemeten of zijn afgerond"); return false }
      // Alleen kaarten die nog beoordeeld moeten worden, gaan op in de hoofdkaart
      const join = others.filter(t => step(t) === 0)
      if (!join.length) {
        if (loose.includes(main)) await saveRecord(main.key, main.signal, "nieuw")
        toast(loose.includes(main) ? `"${main.signal.query}" staat op Mijn taken` : "Staat al op Mijn taken")
        return true
      }
      return await mergeTasksInto(main, join, groupTitle)
    } catch (e: any) {
      if (e instanceof HttpError && e.status === 401) setAuthError(true)
      toast(`Op Mijn taken zetten mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [keywords, longKeywords, ctrModel, taskForQuery, saveRecord, mergeTasksInto, toast])

  const splitTask = useCallback(async (child: Task) => {
    try {
      const { mergedInto: _a, mergedFrom, ...clean } = child.signal
      // Een uitgestelde kaart had een datum; die is bij het samenvoegen vervallen, dus terug naar Te beoordelen
      await saveRecord(child.key, clean, !mergedFrom || mergedFrom === "uitgesteld" ? "nieuw" : mergedFrom, { note: child.note })
      toast(`${child.signal.query ? `"${child.signal.query}"` : child.signal.headline} is weer een losse kaart`)
      return true
    } catch (e: any) {
      toast(`Splitsen mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [saveRecord, toast])

  // Groepsnaam van een hoofdkaart wijzigen of weghalen. Loopt er al een meting, dan krijgt die dezelfde naam in Experimenten.
  const setGroupTitle = useCallback(async (main: Task, title: string | null) => {
    try {
      const clean = title?.trim().slice(0, 140) || null
      const { groupTitle: _g, ...rest } = main.signal
      await saveRecord(main.key, clean ? { ...rest, groupTitle: clean } : rest, main.status, { note: main.note, owner: main.owner, snooze_until: main.snoozeUntil })
      const keys = [main.key, ...(main.merged || []).map(m => m.key)]
      if (clean && experiments.some(e => keys.includes(e.advice_key))) {
        const res = await getJson<{ rows: Experiment[] }>(`/api/experiments`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ advice_keys: keys, family_title: clean }) })
        const upd = new Map(res.rows.map(r => [r.id, r]))
        setExperiments(es => es.map(e => upd.get(e.id) || e))
      }
      toast(clean ? `Groepsnaam: "${clean}"` : "Groepsnaam weggehaald")
      return true
    } catch (e: any) {
      toast(`Groepsnaam opslaan mislukt: ${e?.message || "onbekende fout"}`, "error")
      return false
    }
  }, [experiments, saveRecord, toast])

  const answerRunningWarning = useCallback((goOn: boolean) => { runningResolve.current?.(goOn); runningResolve.current = null }, [])

  const value: WorkspaceValue = {
    user,
    loading, error, authError, storageError,
    keywords, prevKeywords, longKeywords, longPrevKeywords, pages, overview, prevOverview, dataUntil, listWindow, inventory, ga4Pages,
    ctrModel, signals, tasks, visibleTasks, experiments, contentTries,
    newSinceLastVisit, lastVisit,
    setStatus, setOwner, setGoal, removeTask, undoExecution, addTask, mergeTasks: mergeTasksInto, splitTask, pinKeywords, taskForQuery, correctExperiment, setGroupTitle, runningWarning, answerRunningWarning, addReminder, snoozeReminder, openTask,
    siteAdvice, siteDecisions, decideSiteAdvice, openSubject, closePanel, panelTask, panelIntent,
    getDetail, getAnalytics,
    toast, toasts, dismissToast,
    reload: () => setReloadTick(t => t + 1),
    reloadTick,
    lessons, users, me,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

// ── Afgeleide selecties die meerdere schermen gebruiken ──────────────────────

export { sortByPriority }

export function useTaskGroups() {
  const { visibleTasks } = useWorkspace()
  return useMemo(() => {
    const { toReview, snoozed, active, evaluating, done, resolved } = groupTasks(visibleTasks)
    return { toReview, snoozed, active, evaluating, done, resolved }
  }, [visibleTasks])
}

export { toPath }
