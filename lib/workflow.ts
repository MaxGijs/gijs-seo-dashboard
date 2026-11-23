import type { AdviceRecord, Experiment, Signal, SignalKind, Status, Task } from "./types"
import { today } from "./format"

export type ColumnId = "beoordelen" | "gepland" | "uitvoering" | "evalueren" | "afgerond"

export const COLUMNS: { id: ColumnId; label: string; hint: string }[] = [
  { id: "beoordelen", label: "Te beoordelen", hint: "Nieuwe signalen: inplannen, uitstellen of afwijzen" },
  { id: "gepland", label: "Gepland", hint: "Goedgekeurd, nog niet begonnen" },
  { id: "uitvoering", label: "In uitvoering", hint: "Je bent ermee bezig" },
  { id: "evalueren", label: "Evalueren", hint: "Aangepast; metingen na 14, 28 en 56 dagen" },
  { id: "afgerond", label: "Afgerond", hint: "Beoordeeld of afgesloten" },
]

export function columnOf(status: Status): ColumnId {
  switch (status) {
    case "nieuw":
    case "onderzoeken":
    case "uitgesteld": return "beoordelen"
    case "goedgekeurd": return "gepland"
    case "in_uitvoering": return "uitvoering"
    case "uitgevoerd":
    case "in_evaluatie": return "evalueren"
    default: return "afgerond"
  }
}

export type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "error"

export const STATUS_META: Record<Status, { label: string; tone: Tone }> = {
  nieuw: { label: "Nieuw", tone: "neutral" },
  onderzoeken: { label: "In onderzoek", tone: "warning" },
  uitgesteld: { label: "Uitgesteld", tone: "neutral" },
  goedgekeurd: { label: "Gepland", tone: "info" },
  in_uitvoering: { label: "In uitvoering", tone: "accent" },
  uitgevoerd: { label: "Wordt gemeten", tone: "accent" },
  in_evaluatie: { label: "Wordt gemeten", tone: "accent" },
  succesvol: { label: "Succesvol", tone: "success" },
  niet_succesvol: { label: "Niet succesvol", tone: "error" },
  afgewezen: { label: "Afgewezen", tone: "neutral" },
  onvoldoende_bewijs: { label: "Onvoldoende bewijs", tone: "neutral" },
  samengevoegd: { label: "Samengevoegd", tone: "neutral" },
}

export const KIND_META: Record<SignalKind, { label: string; tone: Tone }> = {
  "trend-dalend": { label: "Dalende trend", tone: "error" },
  "trend-stijgend": { label: "Stijgende trend", tone: "success" },
  daler: { label: "Daling", tone: "error" },
  stijger: { label: "Stijging", tone: "success" },
  kans: { label: "Kans", tone: "accent" },
  ctr: { label: "Lage doorklik", tone: "warning" },
  pagina: { label: "Geen clicks", tone: "warning" },
  dubbel: { label: "Dubbele pagina's", tone: "warning" },
  analyse: { label: "Eigen analyse", tone: "info" },
  techniek: { label: "Technisch", tone: "error" },
  eigen: { label: "Eigen taak", tone: "info" },
}

// Fallback voor statusregels van vóór de momentopname (bv. het eerder gezette "onderzoeken")
function signalFromRecord(r: AdviceRecord): Signal {
  const [prefix, ...rest] = r.advice_key.split(":")
  let subject = rest.join(":")
  let kind: SignalKind = "analyse"
  let page: string | undefined
  let query: string | undefined
  if (prefix === "trend") kind = "trend-dalend"
  else if (prefix === "daler") kind = "daler"
  else if (prefix === "stijger") kind = "stijger"
  else if (prefix === "kans") kind = "kans"
  else if (prefix === "dubbel") kind = "dubbel"
  else if (prefix === "techniek") kind = "techniek"
  else if (prefix === "eigen") kind = "eigen"
  else if (prefix === "probleem") {
    if (subject.startsWith("page:")) { kind = "pagina"; subject = subject.slice(5); page = subject }
    else kind = "ctr"
  } else if (prefix === "analyse") {
    if (subject.startsWith("page:")) { page = subject.slice(5); subject = page }
    else if (subject.startsWith("query:")) { query = subject.slice(6); subject = query }
  }
  if (!page && kind !== "dubbel" && kind !== "techniek" && kind !== "eigen") query = query ?? subject
  return {
    key: r.advice_key,
    kind,
    legacyType: r.advice_type,
    query,
    page,
    headline: subject,
    title: r.advice_title,
    summary: "Dit signaal komt niet meer voor in de actuele data. De laatst bekende gegevens staan hieronder.",
    metrics: {},
    gain: 0,
    priority: "laag",
    priorityRank: 0,
    evidence: "zwak",
    evidenceReason: "Geen actuele cijfers bij dit signaal.",
    score: 0,
    generatedAt: r.created_at,
  }
}

export function mergeTasks(signals: Signal[], records: AdviceRecord[], experiments: Experiment[]): Task[] {
  const recMap = new Map(records.map(r => [r.advice_key, r]))
  const expMap = new Map<string, Experiment[]>()
  for (const e of experiments) expMap.set(e.advice_key, [...(expMap.get(e.advice_key) || []), e])
  const t = today()
  const tasks: Task[] = []
  const seen = new Set<string>()

  const make = (signal: Signal, rec: AdviceRecord | undefined, current: boolean): Task => {
    const status = rec?.status || "nieuw"
    const snoozeUntil = rec?.snooze_until || null
    return {
      key: signal.key,
      signal,
      status,
      note: rec?.note || null,
      snoozeUntil,
      snoozed: status === "uitgesteld" && !!snoozeUntil && snoozeUntil > t,
      current,
      updatedAt: rec?.updated_at || null,
      experiments: expMap.get(signal.key) || [],
      owner: rec?.owner || null,
    }
  }

  for (const s of signals) {
    // Actuele cijfers, maar de koppeling aan een hoofdkaart komt uit de opgeslagen kaart
    const rec = recMap.get(s.key)
    const groupTitle = rec?.snapshot?.groupTitle ? { groupTitle: rec.snapshot.groupTitle } : {}
    tasks.push(make(rec?.status === "samengevoegd" ? { ...s, mergedInto: rec.snapshot?.mergedInto, mergedFrom: rec.snapshot?.mergedFrom } : { ...s, ...groupTitle }, rec, true))
    seen.add(s.key)
  }
  for (const r of records) {
    // Beslissingen over siteadvies (site:…) zijn geen taken; die staan in de adviesrij
    if (seen.has(r.advice_key) || r.advice_key.startsWith("site:")) continue
    const signal = r.snapshot && r.snapshot.key ? { ...r.snapshot, key: r.advice_key } : signalFromRecord(r)
    // Eigen taken zijn altijd actueel: ze komen niet uit de data maar van jou
    tasks.push(make(signal, r, signal.kind === "eigen"))
  }
  // Samengevoegde kaarten hangen onder hun hoofdkaart. Bestaat die niet meer (bv. verwijderd),
  // dan komt de kaart weer los terug met zijn oude status.
  const byKey = new Map(tasks.map(x => [x.key, x]))
  for (const x of tasks) {
    if (x.status !== "samengevoegd") continue
    const main = x.signal.mergedInto ? byKey.get(x.signal.mergedInto) : undefined
    if (main && main.status !== "samengevoegd") main.merged = [...(main.merged || []), x]
    else { x.status = x.signal.mergedFrom || "nieuw"; x.snoozed = false }
  }
  return tasks
}

// Taken die in "Te beoordelen" horen maar niet meer actueel zijn en nooit zijn aangeraakt,
// tonen we niet: dan zou het bord vollopen met verouderde signalen.
export function isVisible(task: Task) {
  // Samengevoegde kaarten staan alleen in hun hoofdkaart
  if (task.status === "samengevoegd") return false
  if (task.current) return true
  return task.status !== "nieuw"
}

export const PRIORITY_ORDER = { hoog: 0, middel: 1, laag: 2 } as const

// ── Samengevoegde groep: naam en onderdelen ─────────────────────────────────
// Met een eigen groepsnaam staat de kaart onder die naam, met alle onderdelen (zoekwoord en pagina) eronder.
export const groupName = (t: Task) => (t.merged?.length && t.signal.groupTitle ? t.signal.groupTitle : null)
export const memberLabel = (t: Task) => {
  const s = t.signal
  if (s.query) return s.page ? `"${s.query}" · ${s.page}` : `"${s.query}"`
  return s.page && s.kind !== "eigen" ? s.page : s.page ? `${s.headline} · ${s.page}` : s.headline
}
export const groupMembers = (t: Task) => [t, ...(t.merged || [])]
