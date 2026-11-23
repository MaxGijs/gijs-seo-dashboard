// De Claude-koppeling: dezelfde taken, cijfers en acties als het dashboard, als tools voor een
// chat in de Claude-app. Alles loopt via de bestaande API-handlers, zodat de regels (statussen,
// meting, eigenaar) precies gelijk blijven aan wat het dashboard doet.

import { nextMeasurement } from "@/lib/experiment"
import { GET as gscGET } from "@/app/api/gsc/route"
import { GET as trendsGET } from "@/app/api/trends/route"
import { GET as adviceGET, POST as advicePOST } from "@/app/api/advice/route"
import { GET as detailGET } from "@/app/api/advice/detail/route"
import { GET as expGET, POST as expPOST } from "@/app/api/experiments/route"
import { GET as pagesGET } from "@/app/api/pages/route"
import { GET as ga4GET } from "@/app/api/ga4/route"
import { GET as lessonsGET } from "@/app/api/lessons/route"
import { GET as usersGET } from "@/app/api/users/route"
import { GET as checksGET } from "@/app/api/checks/route"
import { GET as contentGET } from "@/app/api/content/route"
import { GET as dashboardGET } from "@/app/api/dashboard/route"
import { buildCtrModel } from "@/lib/ctr"
import { buildAdhocSignal, signalKey, toPath } from "@/lib/signals"
import { groupTasks, mergeTasks, signalsFrom } from "@/lib/taskset"
import { columnOf, COLUMNS, KIND_META, STATUS_META } from "@/lib/workflow"
import { reconcile } from "@/lib/contract"
import { experimentFor } from "@/lib/execute"
import { baselineFrom, buildDiagnosis } from "@/lib/diagnosis"
import { addDays, today } from "@/lib/format"
import { readAlerts } from "@/lib/server/alerts"
import { PATCH as contentPATCH } from "@/app/api/content/[id]/route"
import { buildBriefing, lessonsFrom, styleGuideFrom } from "@/lib/content/briefing"
import { briefingNotes, learnFromFeedback } from "@/lib/content/feedback"
import { GET as campGET, POST as campPOST } from "@/app/api/campaigns/route"
import { CAMPAIGN_KINDS, describe, type Campaign } from "@/lib/campaigns"
import type { AdviceDetail, AdviceRecord, Experiment, GscRow, Priority, Signal, Status, Task } from "@/lib/types"

type Handler = (req: Request) => Promise<Response>

async function call<T = any>(h: Handler | (() => Promise<Response>), path: string, body?: unknown): Promise<T> {
  const req = new Request(`http://gijs.intern${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const res = await (h as Handler)(req)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json as T
}
const settle = <T,>(p: Promise<T>) => p.then(v => v, () => null)

// ── Werkruimte laden (zelfde bronnen als het dashboard) ───────────────────────────
interface Workspace {
  keywords: GscRow[]; pages: GscRow[]; overview: GscRow[]; listWindow: { startDate: string; endDate: string } | null
  tasks: Task[]; signals: Signal[]; records: AdviceRecord[]; experiments: Experiment[]
  users: { email: string; name: string | null }[]; checks: any[]; ctrModel: ReturnType<typeof buildCtrModel>
}
let cache: { at: number; ws: Workspace } | null = null
export const invalidate = () => { cache = null }

async function loadWorkspace(): Promise<Workspace> {
  if (cache && Date.now() - cache.at < 3 * 60_000) return cache.ws
  const [kw, prevKw, pg, ov] = await Promise.all([
    call(gscGET, `/api/gsc?type=keywords&days=28&limit=250&order=impressions`),
    call(gscGET, `/api/gsc?type=keywords&days=28&offset=28&limit=250&order=impressions`),
    call(gscGET, `/api/gsc?type=pages&days=28&limit=100&order=impressions`),
    call(gscGET, `/api/gsc?type=overview&days=28`),
  ])
  const [tr, adv, exp, inv, ga, les, us, chk] = await Promise.all([
    settle(call(trendsGET, `/api/trends?type=streaks`)),
    call(adviceGET as any, `/api/advice`),
    call(expGET, `/api/experiments`),
    settle(call(pagesGET as any, `/api/pages`)),
    settle(call(ga4GET, `/api/ga4?type=pages&days=28`)),
    settle(call(lessonsGET as any, `/api/lessons`)),
    settle(call(usersGET as any, `/api/users`)),
    settle(call(checksGET, `/api/checks`)),
  ])
  const keywords = kw.rows || [], pages = pg.rows || []
  const records: AdviceRecord[] = adv.rows || [], experiments: Experiment[] = exp.rows || []
  const ctrModel = buildCtrModel(keywords)
  const checks = chk?.rows || []
  const signals = signalsFrom({ keywords, prevKeywords: prevKw.rows || [], pages, streaks: tr?.rows || [], inventory: inv?.rows || [], ga4Pages: ga?.rows || null, records, lessons: les?.lessons || [], checks, experiments, contentTries: exp.contentTries || [] }, ctrModel)
  const ws: Workspace = {
    keywords, pages, overview: ov.rows || [], listWindow: kw.startDate && kw.endDate ? { startDate: kw.startDate, endDate: kw.endDate } : null,
    tasks: mergeTasks(signals, records, experiments), signals, records, experiments,
    users: (us?.rows || []).map((u: any) => ({ email: u.email, name: u.name })), checks, ctrModel,
  }
  cache = { at: Date.now(), ws }
  return ws
}

// ── Weergave ──────────────────────────────────────────────────────────────────
const colLabel = (s: Status) => COLUMNS.find(c => c.id === columnOf(s))?.label || s
const ownerLabel = (ws: Workspace, email?: string | null) => email ? (ws.users.find(u => u.email === email)?.name || email) : null
const goalLabel = (s: Signal) => s.kind !== "eigen" ? "beter gevonden worden" : s.goal === "conversie" ? "meer aanvragen" : s.goal === "overig" ? "overig" : "beter gevonden worden"

function brief(ws: Workspace, t: Task) {
  const s = t.signal
  return {
    key: t.key,
    soort: KIND_META[s.kind]?.label || s.kind,
    onderwerp: s.headline,
    taak: s.action || s.title,
    waarom: s.summary,
    prioriteit: s.priority,
    kolom: colLabel(t.status),
    status: STATUS_META[t.status]?.label || t.status,
    eigenaar: ownerLabel(ws, t.owner),
    zoekwoord: s.query || null,
    pagina: s.page || null,
    verwachte_winst: s.estimate ? `±${Math.round(s.estimate.low)}–${Math.round(s.estimate.high)} clicks per 28 dagen` : null,
    doel: goalLabel(s),
    al_opgelost: s.resolved || null,
    uitgesteld_tot: t.snoozed ? t.snoozeUntil : null,
    notitie: t.note,
  }
}

function findTask(ws: Workspace, key: string) {
  const t = ws.tasks.find(x => x.key === key)
  if (!t) throw new Error(`Taak "${key}" niet gevonden. Gebruik eerst taken_zoeken of vandaag om de juiste key te vinden.`)
  return t
}

function resolveOwner(ws: Workspace, who: string | null | undefined, me: string): string | null | undefined {
  if (who === undefined) return undefined
  if (who === null || who === "" || /^(niemand|geen)$/i.test(who)) return null
  if (/^(ik|mij|me|mezelf)$/i.test(who)) return me
  const w = who.toLowerCase().trim()
  const hit = ws.users.find(u => u.email === w) || ws.users.find(u => (u.name || "").toLowerCase() === w) || ws.users.find(u => (u.name || "").toLowerCase().split(" ")[0] === w)
  if (hit) return hit.email
  if (/^[^\s@]+@groeninjestraat\.nl$/.test(w)) return w
  throw new Error(`Onbekende collega "${who}". Bekend: ${ws.users.map(u => u.name || u.email).join(", ") || "nog niemand"}.`)
}

async function saveTask(t: Task, status: Status, extra: { note?: string | null; snooze_until?: string | null; owner?: string | null; signal?: Signal } = {}) {
  const signal = extra.signal || t.signal
  const res = await call<{ row: AdviceRecord }>(advicePOST, `/api/advice`, {
    advice_key: t.key, advice_title: `${signal.headline} — ${signal.title}`, advice_type: signal.legacyType, status,
    note: extra.note, snooze_until: extra.snooze_until ?? null, snapshot: signal, ...(extra.owner !== undefined ? { owner: extra.owner } : {}),
  })
  invalidate()
  return res.row
}

// ── Tools ─────────────────────────────────────────────────────────────────────
export interface ToolCtx { email: string; name: string | null }
interface Tool { name: string; title: string; description: string; inputSchema: any; readOnly: boolean; run: (args: any, ctx: ToolCtx) => Promise<unknown> }

const str = (description: string, extra: object = {}) => ({ type: "string", description, ...extra })

export const TOOLS: Tool[] = [
  {
    name: "vandaag", title: "Wat moet ik vandaag doen?", readOnly: true,
    description: "Overzicht voor vandaag uit het Gijs-dashboard: de belangrijkste taken om te beoordelen, wat gepland of in uitvoering is, controletaken (meting/techniek), nieuwe contentkansen en de eerstvolgende metingen. Begin hiermee als iemand vraagt wat er moet gebeuren.",
    inputSchema: { type: "object", properties: { alleen_mijn_taken: { type: "boolean", description: "Alleen taken van de gebruiker zelf (of zonder eigenaar)" } } },
    run: async (a, ctx) => {
      const ws = await loadWorkspace()
      const mine = (t: Task) => !a?.alleen_mijn_taken || !t.owner || t.owner === ctx.email
      const g = groupTasks(ws.tasks)
      const content = await settle(call(contentGET, `/api/content`))
      const ideas = (content?.ideas || []).filter((i: any) => i.status === "nieuw").slice(0, 5)
      const byKey = new Map(ws.tasks.map(t => [t.key, t]))
      const metingen = ws.experiments.map(e => {
        const n = nextMeasurement(e as any)
        return { e, date: n ? n.date : null }
      }).filter(x => x.date && byKey.has(x.e.advice_key)).sort((a, b) => a.date! < b.date! ? -1 : 1).slice(0, 5)
      return {
        datum: today(),
        search_console_tot: ws.overview.length ? ws.overview[ws.overview.length - 1].keys[0] : null,
        te_beoordelen: { aantal: g.toReview.length, hoog: g.toReview.filter(t => t.signal.priority === "hoog").length, eerst_doen: g.toReview.filter(mine).filter(t => t.signal.intent !== "merk").slice(0, 6).map(t => brief(ws, t)) },
        bezig: g.active.filter(mine).slice(0, 10).map(t => brief(ws, t)),
        meldingen: (await readAlerts(0).catch(() => [])).map(a => ({ wat: a.title, detail: a.detail, sinds: a.first_seen.slice(0, 10) })),
        controletaken: ws.checks.map((c: any) => ({ wat: c.what, effect: c.effect, ernst: c.severity })),
        al_opgelost_te_sluiten: g.resolved.length,
        contentkansen_nieuw: { aantal: (content?.ideas || []).filter((i: any) => i.status === "nieuw").length, voorbeelden: ideas.map((i: any) => ({ titel: i.title, dienst: i.service, waarom_nu: i.why_now })) },
        volgende_metingen: metingen.map(m => ({ taak: byKey.get(m.e.advice_key)!.signal.headline, aanpassing: m.e.description, datum: m.date })),
        dashboard: "https://gijs-dashboard.vercel.app/vandaag",
      }
    },
  },
  {
    name: "taken_zoeken", title: "Taken zoeken", readOnly: true,
    description: "Zoek taken op het takenbord, op kolom, eigenaar of tekst (zoekwoord, pagina, titel). Geeft per taak de key die je nodig hebt om hem te bekijken of bij te werken.",
    inputSchema: { type: "object", properties: {
      kolom: str("Kolom op het bord", { enum: COLUMNS.map(c => c.label) }),
      eigenaar: str("Naam of e-mail van de eigenaar, 'ik' voor jezelf, of 'niemand'"),
      tekst: str("Zoek in onderwerp, taak, zoekwoord en pagina"),
      limiet: { type: "number", description: "Maximaal aantal resultaten (standaard 20)" },
    } },
    run: async (a, ctx) => {
      const ws = await loadWorkspace()
      let list = groupTasks(ws.tasks).visible
      if (a?.kolom) list = list.filter(t => colLabel(t.status).toLowerCase() === String(a.kolom).toLowerCase())
      if (a?.eigenaar !== undefined) { const o = resolveOwner(ws, a.eigenaar, ctx.email); list = list.filter(t => (t.owner || null) === o) }
      if (a?.tekst) { const q = String(a.tekst).toLowerCase(); list = list.filter(t => [t.signal.headline, t.signal.title, t.signal.action, t.signal.query, t.signal.page].some(x => x?.toLowerCase().includes(q))) }
      const order: Record<Priority, number> = { hoog: 0, middel: 1, laag: 2 }
      list = list.sort((x, y) => order[x.signal.priority] - order[y.signal.priority] || y.signal.score - x.signal.score)
      return { aantal: list.length, taken: list.slice(0, Math.min(Number(a?.limiet) || 20, 60)).map(t => brief(ws, t)) }
    },
  },
  {
    name: "taak_bekijken", title: "Taak bekijken", readOnly: true,
    description: "Alle details van één taak: wat er speelt, de diagnose, de concrete stappen, hoe gemeten wordt en eerdere pogingen. Gebruik dit voordat je iemand helpt een taak uit te voeren.",
    inputSchema: { type: "object", properties: { key: str("De key van de taak") }, required: ["key"] },
    run: async a => {
      const ws = await loadWorkspace()
      const t = findTask(ws, a.key)
      const { signal, diag } = await diagnose(ws, t)
      return {
        ...brief(ws, { ...t, signal }),
        situatie: diag.situation,
        bevindingen: diag.findings.slice(0, 8).map(f => f.text),
        stappen: diag.steps.map(s => ({ stap: s.title, uitleg: s.detail })),
        verwacht: diag.importance.gainText,
        meting: { hoe: diag.plan.label, nulmeting: diag.plan.baselineText, geslaagd_als: diag.plan.success },
        eerdere_metingen: t.experiments.map(e => ({ datum: e.changed_at, aanpassing: e.description, uitkomst: e.outcome || "loopt nog", laatste: (e.result_56d || e.result_28d || e.result_14d)?.summary || null })),
        openen_in_dashboard: `https://gijs-dashboard.vercel.app/taken`,
      }
    },
  },
  {
    name: "taak_toevoegen", title: "Taak toevoegen", readOnly: false,
    description: "Voeg een eigen taak toe aan het takenbord. Kies het doel goed: 'seo' als het om vindbaarheid in Google gaat (dan wordt op posities gemeten), 'conversie' als het om meer energiescanaanvragen of gebruiksgemak gaat (dan wordt op aanvragen in GA4 gemeten), 'overig' als het niet automatisch te meten is.",
    inputSchema: { type: "object", properties: {
      titel: str("Korte titel, bijvoorbeeld 'Woningscan verkorten'"),
      omschrijving: str("Wat moet er gebeuren en waarom"),
      doel: str("Waarop de taak wordt gemeten", { enum: ["seo", "conversie", "overig"] }),
      pagina: str("Pagina (pad of URL). Bij conversie: alleen bezoekers via deze pagina meten; leeg = hele site"),
      zoekwoord: str("Alleen bij doel seo: het zoekwoord waar het om gaat"),
      prioriteit: str("Prioriteit", { enum: ["hoog", "middel", "laag"] }),
      inspanning: str("Inspanning", { enum: ["laag", "middel", "hoog"] }),
      kolom: str("Waar de taak komt te staan", { enum: ["Te beoordelen", "Gepland"] }),
      eigenaar: str("Naam of e-mail, of 'ik'"),
    }, required: ["titel", "doel"] },
    run: async (a, ctx) => {
      const ws = await loadWorkspace()
      const goal = (["seo", "conversie", "overig"].includes(a.doel) ? a.doel : "seo") as "seo" | "conversie" | "overig"
      const owner = resolveOwner(ws, a.eigenaar, ctx.email)
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const query = goal === "seo" ? String(a.zoekwoord || "").trim() || undefined : undefined
      const page = a.pagina?.trim() ? toPath(a.pagina.trim()).replace(/\/$/, "") || "/" : undefined
      const base = goal === "seo" && (query || page) ? buildAdhocSignal({ query, page: query ? undefined : page }, { keywords: ws.keywords, pages: ws.pages }, ws.ctrModel) : null
      const desc = String(a.omschrijving || "").trim()
      const signal: Signal = {
        key: signalKey("eigen", id), kind: "eigen", legacyType: "eigen", query, page,
        headline: String(a.titel).trim(), title: desc.split("\n")[0].slice(0, 140) || "Eigen taak",
        summary: desc || `Toegevoegd via Claude door ${ctx.name || ctx.email}.`, description: desc || undefined,
        metrics: base?.metrics || {}, gain: base?.gain ?? 0, estimate: base?.estimate,
        priority: (["hoog", "middel", "laag"].includes(a.prioriteit) ? a.prioriteit : "middel") as Priority, priorityRank: 0,
        evidence: base?.evidence || "redelijk",
        evidenceReason: base?.evidenceReason || (goal === "conversie" ? "Eigen taak, gemeten op energiescanaanvragen in GA4." : "Eigen taak: geen automatisch bewijs."),
        goal, score: 0, generatedAt: new Date().toISOString(), intent: base?.intent, place: base?.place,
        action: String(a.titel).trim(), effort: (["laag", "middel", "hoog"].includes(a.inspanning) ? a.inspanning : "middel"), risk: "laag",
      }
      const task: Task = { key: signal.key, signal, status: "nieuw", note: null, snoozeUntil: null, snoozed: false, current: true, updatedAt: null, experiments: [] }
      await saveTask(task, a.kolom === "Gepland" ? "goedgekeurd" : "nieuw", { owner: owner ?? undefined })
      return { ok: true, key: signal.key, kolom: a.kolom === "Gepland" ? "Gepland" : "Te beoordelen", doel: goalLabel(signal), gemeten_op: goal === "seo" ? "posities en clicks in Google" : goal === "conversie" ? "energiescanaanvragen in GA4" : "niet automatisch" }
    },
  },
  {
    name: "taak_bijwerken", title: "Taak bijwerken", readOnly: false,
    description: "Verplaats een taak (inplannen, starten, uitstellen, afwijzen, terug naar beoordelen), wijs een eigenaar toe, voeg een notitie toe of wijzig het doel van een eigen taak. Afwijzen vraagt een reden: daar leert het systeem van. Uitstellen vraagt een datum. Gebruik taak_uitgevoerd als het werk klaar is.",
    inputSchema: { type: "object", properties: {
      key: str("De key van de taak"),
      actie: str("Wat er met de taak gebeurt", { enum: ["inplannen", "starten", "uitstellen", "afwijzen", "terug_naar_beoordelen"] }),
      uitstellen_tot: str("Bij uitstellen: datum JJJJ-MM-DD"),
      reden: str("Bij afwijzen verplicht: waarom niet"),
      notitie: str("Notitie bij de taak (vervangt de bestaande notitie)"),
      eigenaar: str("Naam of e-mail, 'ik', of 'niemand'"),
      doel: str("Alleen eigen taken: nieuw doel", { enum: ["seo", "conversie", "overig"] }),
    }, required: ["key"] },
    run: async (a, ctx) => {
      const ws = await loadWorkspace()
      const t = findTask(ws, a.key)
      const map: Record<string, Status> = { inplannen: "goedgekeurd", starten: "in_uitvoering", uitstellen: "uitgesteld", afwijzen: "afgewezen", terug_naar_beoordelen: "nieuw" }
      let status: Status = a.actie ? map[a.actie] : t.status
      if (a.actie && !status) throw new Error("Onbekende actie")
      if (status === "uitgesteld" && !/^\d{4}-\d{2}-\d{2}$/.test(a.uitstellen_tot || "")) throw new Error("Geef bij uitstellen een datum (JJJJ-MM-DD).")
      if (status === "afgewezen" && !a.reden?.trim()) throw new Error("Geef bij afwijzen een reden; daar leert het dashboard van.")
      if (["uitgevoerd", "in_evaluatie", "succesvol", "niet_succesvol"].includes(t.status) && a.actie && a.actie !== "terug_naar_beoordelen") throw new Error(`Deze taak staat al op "${STATUS_META[t.status].label}"; de meting loopt.`)
      let signal = t.signal
      if (a.doel) {
        if (t.signal.kind !== "eigen") throw new Error("Alleen bij eigen taken kun je het doel wijzigen.")
        signal = a.doel === "seo" ? { ...signal, goal: "seo" } : { ...signal, goal: a.doel, query: undefined, metrics: {}, gain: 0, estimate: undefined, intent: undefined, place: undefined, scope: undefined, evidence: "redelijk", evidenceReason: a.doel === "conversie" ? "Eigen taak, gemeten op energiescanaanvragen in GA4." : "Eigen taak: geen automatisch bewijs." }
      }
      const note = status === "afgewezen" ? a.reden.trim() : a.notitie !== undefined ? (String(a.notitie).trim() || null) : undefined
      const row = await saveTask(t, status, { note, snooze_until: status === "uitgesteld" ? a.uitstellen_tot : null, owner: resolveOwner(ws, a.eigenaar, ctx.email), signal })
      return { ok: true, key: t.key, kolom: colLabel(row.status as Status), status: STATUS_META[row.status as Status]?.label, eigenaar: ownerLabel(ws, row.owner), doel: goalLabel(signal) }
    },
  },
  {
    name: "taak_uitgevoerd", title: "Taak uitgevoerd melden", readOnly: false,
    description: "Meld dat een taak is uitgevoerd. Legt de nulmeting vast en start de meting (na 7 dagen (signalering), 14 dagen (eerste beoordeling met advies) en 28 dagen (eindmeting; 56 alleen bij te weinig data)). Vraag de gebruiker eerst wat er precies is aangepast en roep dit pas aan als het werk echt live staat.",
    inputSchema: { type: "object", properties: { key: str("De key van de taak"), wat_aangepast: str("Wat er concreet is aangepast, bijvoorbeeld 'interne links vanaf /regio/overijssel naar /regio/overijssel/borne toegevoegd'") }, required: ["key", "wat_aangepast"] },
    run: async a => {
      const ws = await loadWorkspace()
      const t = findTask(ws, a.key)
      if (!String(a.wat_aangepast || "").trim()) throw new Error("Beschrijf wat er is aangepast.")
      if (["uitgevoerd", "in_evaluatie", "succesvol", "niet_succesvol"].includes(t.status)) throw new Error("Deze taak is al als uitgevoerd gemeld; de meting loopt.")
      const { signal, diag, detail, rec } = await diagnose(ws, t)
      if (rec.blocked) throw new Error(`De cijfers van deze taak zijn niet te bevestigen: ${rec.blocked} Rond hem af in het dashboard.`)
      const ov = ws.overview
      const site = ov.length ? { impressionsPerDay: Math.round(ov.reduce((s, r) => s + r.impressions, 0) / ov.length), clicksPerDay: Math.round((ov.reduce((s, r) => s + r.clicks, 0) / ov.length) * 10) / 10, days: ov.length } : null
      const target = diag.target ?? null
      await saveTask({ ...t, signal }, "uitgevoerd", { signal })
      await call(expPOST, `/api/experiments`, {
        advice_key: t.key, description: String(a.wat_aangepast).trim(),
        // Zelfde vastlegging als in het dashboard (lib/execute.ts), inclusief samengevoegde kaarten
        ...(() => { const e = experimentFor(signal, detail, diag, rec.targetRow, site, String(a.wat_aangepast), (t.merged || []).map(m => m.signal)); return { baseline: e.baseline, hypothesis: e.hypothesis, target_pages: e.targetPages, target_queries: e.targetQueries, changed_pages: e.changedPages, predicted: e.predicted } })(),
        query: signal.query ?? null,
        page: (rec.targetRow ? target : null) ?? (signal.kind === "dubbel" ? signal.page ?? null : signal.query ? null : signal.page ?? null),
      })
      invalidate()
      return { ok: true, key: t.key, kolom: "Evalueren", gemeten_op: diag.plan.label, nulmeting: diag.plan.baselineText, geslaagd_als: diag.plan.success, metingen: [7, 14, 28].map(d => addDays(today(), d)), eindmeting_verlengd_tot_56_bij_te_weinig_data: true }
    },
  },
  {
    name: "dashboard_cijfers", title: "Cijfers van het dashboard", readOnly: true,
    description: "De cijfers en conclusie van het Gijs-dashboard: zoekwoorden op pagina 1, clicks, vertoningen, sessies, energiescanaanvragen, wat de groei verklaart en waarschuwingen. Standaard de laatste 28 dagen tegen de 28 dagen ervoor.",
    inputSchema: { type: "object", properties: { dagen: { type: "number", enum: [7, 28, 90], description: "Periode" }, vergelijk: str("Vergelijk met", { enum: ["vorige_periode", "vorig_jaar"] }) } },
    run: async a => {
      const d = await call(dashboardGET, `/api/dashboard?period=${[7, 28, 90].includes(Number(a?.dagen)) ? a.dagen : 28}&compare=${a?.vergelijk === "vorig_jaar" ? "year" : "prev"}`)
      const m = (x: any) => x ? { nu: x.value, ervoor: x.prev } : null
      return {
        periode: d.range, vergeleken_met: d.compareRange, search_console_tot: d.dataUntil,
        conclusie: d.conclusion,
        cijfers: Object.fromEntries(Object.entries(d.cards || {}).map(([k, v]) => [k, m(v)])),
        verklaring: (d.drivers || []).slice(0, 6).map((x: any) => x.summary || x.label),
        meting_aanvragen: d.measurement,
        waarschuwingen: (d.warnings || []).map((w: any) => w.text || w.title || w),
        loopt_vast: (d.stalled || []).map((s: any) => s.text),
      }
    },
  },
  {
    name: "contentkansen", title: "Contentkansen", readOnly: true,
    description: "Contentkansen (artikelen, updates van bestaande pagina's) die het dashboard uit nieuws, zoekdata en vragen heeft gehaald, met status en waarom ze nu spelen. Alleen lezen; beoordelen en schrijven gebeurt in het dashboard.",
    inputSchema: { type: "object", properties: { status: str("Filter op status, bijvoorbeeld nieuw, briefing, concept, goedgekeurd, gepubliceerd") } },
    run: async a => {
      const c = await call(contentGET, `/api/content`)
      const list = (c.ideas || []).filter((i: any) => !a?.status || i.status === a.status).filter((i: any) => !["verlopen", "afgewezen"].includes(i.status) || a?.status)
      return { aantal: list.length, kansen: list.slice(0, 25).map((i: any) => ({ titel: i.title, status: i.status, dienst: i.service, advies: i.advice, doelpagina: i.target_page, waarom_nu: i.why_now, samenvatting: i.summary })), openen: "https://gijs-dashboard.vercel.app/content" }
    },
  },
  {
    name: "artikel_opzet", title: "Opzet voor een artikel ophalen", readOnly: true,
    description: "Haalt alles op wat nodig is om de opzet (basis) van een artikel of pagina-update te maken voor een contentkans: aanleiding, bronnen met datum, zoekvragen uit Search Console, doelgroep, dienst, doelpagina, interne links, regio, call-to-action, de schrijfregels van Gijs, lessen uit eerdere correcties en stijlvoorbeelden uit eigen artikelen die goed werkten. Gebruik daarna de instructie in het resultaat om de opzet te schrijven en sla hem op met artikel_opzet_opslaan.",
    inputSchema: { type: "object", properties: { kans: str("De id van de contentkans, of een stuk van de titel (bijvoorbeeld 'hybride warmtepomp')") }, required: ["kans"] },
    run: async a => {
      const c = await call(contentGET, `/api/content`)
      const ideas: any[] = c.ideas || []
      const idea = findIdea(ideas, a.kans)
      const style = styleGuideFrom(ideas, idea.id)
      const briefing = buildBriefing(idea, [...lessonsFrom(ideas), ...briefingNotes(learnFromFeedback(ideas))], style)
      return {
        kans: { id: idea.id, titel: idea.title, status: idea.status, advies: idea.advice === "bijwerken" ? `Bestaande pagina ${idea.target_page} bijwerken` : idea.advice === "nieuw" ? "Nieuw artikel" : idea.advice, pagina: `https://gijs-dashboard.vercel.app/content/${idea.id}` },
        briefing,
        bestaande_opzet: idea.outline || null,
        instructie: OUTLINE_INSTRUCTIE,
      }
    },
  },
  {
    name: "artikel_opzet_opslaan", title: "Opzet opslaan bij de contentkans", readOnly: false,
    description: "Slaat de opzet die je hebt gemaakt op bij de contentkans in het dashboard, zodat een medewerker hem kan uitwerken. Vervangt een eerdere opzet. Laat de gebruiker de opzet eerst zien en sla pas op als die akkoord is of erom vraagt.",
    inputSchema: { type: "object", properties: { kans: str("De id van de contentkans"), opzet: str("De volledige opzet als platte tekst (Markdown mag)") }, required: ["kans", "opzet"] },
    run: async a => {
      const c = await call(contentGET, `/api/content`)
      const idea = findIdea(c.ideas || [], a.kans)
      const res = await contentPATCH(new Request(`http://gijs.intern/api/content/${idea.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "outline", outline: a.opzet }) }), { params: Promise.resolve({ id: idea.id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      return { ok: true, kans: idea.title, bekijken: `https://gijs-dashboard.vercel.app/content/${idea.id}` }
    },
  },
  {
    name: "contentkans_relevantie", title: "Relevantie van een contentkans beoordelen", readOnly: true,
    description: "Haalt alles op om te beoordelen of een contentkans (nog niet geaccepteerd) het schrijven waard is: aanleiding, bron(nen) met betrouwbaarheid en datum, zoekvragen en vertoningen uit Search Console, dienst, doelgroep, regio en of de onderbouwing consistent is. Gebruik dit om kritisch te checken of het onderwerp relevant genoeg is voor Gijs (verduurzaming voor huiseigenaren in Overijssel, Gelderland, Utrecht en Flevoland) vóórdat iemand tijd steekt in schrijven. Sla je oordeel op met contentkans_relevantie_opslaan.",
    inputSchema: { type: "object", properties: { kans: str("De id van de contentkans, of een stuk van de titel") }, required: ["kans"] },
    run: async a => {
      const c = await call(contentGET, `/api/content`)
      const ideas: any[] = c.ideas || []
      const idea = findIdea(ideas, a.kans)
      const related = ideas.filter(i => i.id !== idea.id && i.service === idea.service && (i.status === "gepubliceerd" || i.target_page === idea.target_page)).slice(0, 5)
      return {
        kans: {
          id: idea.id, titel: idea.title, status: idea.status, dienst: idea.service, advies: idea.advice, doelpagina: idea.target_page,
          waarom_nu: idea.why_now, samenvatting: idea.summary, doelgroep: idea.audience, regio: idea.regions, impact: idea.impact,
          score: idea.score, score_onderbouwing: idea.score_parts, bronnen: idea.sources, zoekwoorden: idea.keywords,
          bestaand_relevantie_oordeel: idea.relevance_check || null,
        },
        gerelateerde_contentkansen_of_paginas: related.map((i: any) => ({ titel: i.title, status: i.status, doelpagina: i.target_page })),
        instructie: RELEVANTIE_INSTRUCTIE,
      }
    },
  },
  {
    name: "contentkans_relevantie_opslaan", title: "Relevantie-oordeel opslaan bij de contentkans", readOnly: false,
    description: "Slaat je oordeel over de relevantie van een contentkans op, met een toelichting. Een medewerker ziet dit oordeel bij het beoordelen van de kans (vóór accepteren). Dit neemt de beslissing niet over: een medewerker beslist nog steeds zelf.",
    inputSchema: {
      type: "object",
      properties: {
        kans: str("De id van de contentkans"),
        oordeel: str("Je oordeel", { enum: ["relevant", "twijfel", "niet_relevant"] }),
        toelichting: str("Waarom dit oordeel: leg uit in een paar zinnen, concreet en onderbouwd"),
      },
      required: ["kans", "oordeel", "toelichting"],
    },
    run: async a => {
      const c = await call(contentGET, `/api/content`)
      const idea = findIdea(c.ideas || [], a.kans)
      const res = await contentPATCH(new Request(`http://gijs.intern/api/content/${idea.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "relevantie", verdict: a.oordeel, reasoning: a.toelichting }) }), { params: Promise.resolve({ id: idea.id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      return { ok: true, kans: idea.title, oordeel: a.oordeel, bekijken: `https://gijs-dashboard.vercel.app/content/${idea.id}` }
    },
  },
  {
    name: "campagnes", title: "Offline campagnes", readOnly: true,
    description: "Offline campagnes (brieven, flyers, advertenties, informatieavonden) die zijn vastgelegd. Die verklaren bezoek en aanvragen die niet uit Google komen.",
    inputSchema: { type: "object", properties: {} },
    run: async () => { const r = await call(campGET as any, `/api/campaigns`); return { campagnes: (r.rows as Campaign[]).map(c => ({ id: c.id, beschrijving: describe(c), verwijst_naar: c.landing_page, notitie: c.note })) } },
  },
  {
    name: "campagne_toevoegen", title: "Offline campagne vastleggen", readOnly: false,
    description: "Leg een offline campagne vast, zoals een verstuurde brief of flyer. Het dashboard toont hem dan in de grafiek en weegt hem mee bij metingen (een meting die erdoor beïnvloed kan zijn, krijgt geen oordeel). Zonder einddatum rekent het systeem 21 dagen na-effect.",
    inputSchema: { type: "object", properties: {
      naam: str("Bijvoorbeeld 'Brief isolatiesubsidie Borne'"),
      soort: str("Soort", { enum: CAMPAIGN_KINDS.map(k => k.id) }),
      startdatum: str("Datum van versturen of start, JJJJ-MM-DD"),
      einddatum: str("Optioneel, JJJJ-MM-DD"),
      gebied: str("Gemeenten of provincies, met komma's"),
      aantal: { type: "number", description: "Aantal brieven/flyers (optioneel)" },
      pagina: str("Pagina waar de brief naar verwijst (optioneel)"),
      notitie: str("Optioneel"),
    }, required: ["naam", "soort", "startdatum"] },
    run: async a => {
      const r = await call(campPOST, `/api/campaigns`, { name: a.naam, kind: a.soort, start_date: a.startdatum, end_date: a.einddatum || null, regions: a.gebied || "", amount: a.aantal || null, landing_page: a.pagina || null, note: a.notitie || null })
      return { ok: true, vastgelegd: describe(r.row) }
    },
  },
  {
    name: "collegas", title: "Collega's", readOnly: true,
    description: "Wie het dashboard gebruikt (voor het toewijzen van taken).",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => { const ws = await loadWorkspace(); return { jij: ctx.email, collegas: ws.users } },
  },
]

function findIdea(ideas: any[], q: string) {
  const v = String(q || "").trim().toLowerCase()
  const byId = ideas.find(i => i.id === q)
  if (byId) return byId
  const hits = ideas.filter(i => !["verlopen"].includes(i.status) && i.title.toLowerCase().includes(v))
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new Error(`Geen contentkans gevonden voor "${q}". Gebruik contentkansen om de juiste te vinden.`)
  throw new Error(`Meerdere kansen passen bij "${q}": ${hits.slice(0, 6).map(i => `${i.title} (id ${i.id})`).join("; ")}. Kies er één met de id.`)
}

const OUTLINE_INSTRUCTIE = `Maak op basis van de briefing een OPZET, geen volledig artikel. Een medewerker van Gijs schrijft de tekst daarna zelf uit; de opzet zorgt dat de juiste raakpunten erin komen.
Lever in deze vorm (Nederlands, je-vorm):
1. Drie titelopties (positief, probleemgericht, neutraal) en een meta description van max. 155 tekens.
2. Inleiding: 2-4 raakpunten (welk probleem of welke vraag, voor wie, wat de lezer na het lezen weet). Het hoofdzoekwoord staat in de inleiding.
3. Per tussenkop (H2, 4-7 stuks): de kop zelf, 3-5 raakpunten in steekwoorden, welke zoekvraag uit Search Console hier beantwoord wordt, en welke bron erbij hoort.
4. Waar en naar welke pagina van groeninjestraat.nl een interne link logisch is.
5. Drie veelgestelde vragen met in één zin de kern van het antwoord.
6. Het afsluitende blok met de vervolgstap (energiescan of contact), passend bij het onderwerp.
7. Een lijst [CHECK] met alle feiten, bedragen, data en voorwaarden die de redactie moet controleren, met de bron per feit. Verzin geen bedragen of datums.
8. Richtlijn voor lengte en toon (uit de stijlvoorbeelden als die er zijn).
Laat de opzet eerst aan de gebruiker zien. Sla hem op met artikel_opzet_opslaan als de gebruiker akkoord is of daarom vraagt.`

const RELEVANTIE_INSTRUCTIE = `Beoordeel kritisch of deze contentkans het schrijven waard is voor Gijs (verduurzamingsadvies aan huiseigenaren in Overijssel, Gelderland, Utrecht en Flevoland). Let op:
1. Klopt de aanleiding nog, en is de bron betrouwbaar en recent genoeg?
2. Is dit relevant voor een huiseigenaar in dit gebied, en niet te landelijk, te specifiek of te niche?
3. Is het onderwerp al gedekt door een bestaande of eerder geschreven pagina (zie gerelateerde contentkansen of pagina's)? Zo ja, is een nieuw artikel dan nog zinvol, of is bijwerken van de bestaande pagina logischer?
4. Is de onderbouwing (score, zoekvragen, aanleiding) consistent, of lijkt de score hoger dan de aanleiding rechtvaardigt?
Geef een kort, concreet oordeel: relevant, twijfel, of niet_relevant, met een toelichting van een paar zinnen die de reden benoemt. Laat je oordeel eerst aan de gebruiker zien. Sla het op met contentkans_relevantie_opslaan als de gebruiker akkoord is of erom vraagt.`

async function diagnose(ws: Workspace, t: Task) {
  const isSeo = !(t.signal.kind === "eigen" && t.signal.goal && t.signal.goal !== "seo")
  const raw = t.signal
  const needsDetail = isSeo && raw.kind !== "techniek" && !(raw.kind === "eigen" && !raw.query && !raw.page)
  let detail: AdviceDetail | null = null
  if (needsDetail) {
    const p = new URLSearchParams()
    if (raw.query) p.set("query", raw.query)
    if (raw.page && (!raw.query || raw.kind === "pagina" || raw.kind === "dubbel")) p.set("page", raw.page)
    if (raw.kind === "dubbel" && raw.relatedPages?.length) p.set("related", raw.relatedPages.join(","))
    detail = await call<AdviceDetail>(detailGET, `/api/advice/detail?${p}`).catch(() => null)
  }
  const rec = reconcile(raw, detail, ws.ctrModel, ws.listWindow || undefined)
  const diag = buildDiagnosis(rec.signal, detail, { model: ws.ctrModel, pages: ws.pages, signalCount: ws.signals.length })
  return { signal: rec.signal, diag, detail, rec }
}

export const INSTRUCTIONS = `Dit is het Gijs-dashboard van groeninjestraat.nl (verduurzaming van woningen in Overijssel en Gelderland).
Het takenbord heeft vijf kolommen: Te beoordelen → Gepland → In uitvoering → Evalueren → Afgerond.
- Begin met "vandaag" als iemand vraagt wat er moet gebeuren; gebruik "taak_bekijken" voor de stappen van één taak.
- Elke uitgevoerde aanpassing wordt gemeten na 7 dagen (signalering), 14 dagen (eerste beoordeling met advies) en 28 dagen (eindmeting; 56 alleen bij te weinig data). Na 14 dagen is er een voorlopige beoordeling, geen eindoordeel. Meld een taak pas als uitgevoerd ("taak_uitgevoerd") als de gebruiker bevestigt dat het live staat, en vraag wat er precies is aangepast.
- Eigen taken hebben een doel: seo (gemeten in Google), conversie (gemeten op energiescanaanvragen in GA4) of overig. Kies conversie voor alles rond leads en gebruiksgemak.
- Afwijzen vraagt een reden: het systeem leert daarvan.
- Wordt er een brief, flyer of andere offline actie verstuurd? Leg die vast met "campagne_toevoegen", zodat metingen er rekening mee houden.
- Voor een artikel: gebruik artikel_opzet om alles op te halen en maak dan een opzet met raakpunten per sectie (geen volledig artikel); sla hem op met artikel_opzet_opslaan.
- Wordt gevraagd of een (nog niet geaccepteerde) contentkans relevant genoeg is om over te schrijven: gebruik contentkans_relevantie om alles op te halen, beoordeel kritisch en sla het oordeel op met contentkans_relevantie_opslaan.
- De live website wordt niet via deze koppeling aangepast; teksten en titels stel je voor, de gebruiker zet ze zelf live.
Antwoord in het Nederlands.`
