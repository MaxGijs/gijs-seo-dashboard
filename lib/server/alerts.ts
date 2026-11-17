// Meldingen: wat in korte tijd duidelijk misgaat, zodat je het niet pas ziet als je toevallig kijkt.
// Elke ochtend opnieuw bepaald (week tegen week). Een melding blijft open zolang het probleem er is
// en sluit vanzelf als het over is. Nieuwe meldingen gaan via een geplande Claude-taak als pushbericht.
import { getSupabase } from "./guard"
import { dateWindow, gscQuery, serviceSearchConsole, toPath, type GscRow } from "./gsc"
import { isBrandQuery } from "@/lib/signals"
import { cwvProblems, type CwvRow } from "@/lib/cwv"

export interface Alert {
  key: string; type: "pagina-daling" | "pagina1-kwijt" | "site-daling" | "indexering-daling" | "snelheid"
  subject: string | null; severity: "error" | "warning"; title: string; detail: string; data?: Record<string, unknown>
}
export interface AlertRow extends Alert { first_seen: string; last_seen: string; resolved_at: string | null; notified_at: string | null }

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100)
const p1 = (n: number) => n.toFixed(1).replace(".", ",")

// Pure regels (getest): uit twee weken Search Console-data en de indexeringshistorie
export function alertRules(input: {
  pagesCur: GscRow[]; pagesPrev: GscRow[]; queriesCur: GscRow[]; queriesPrev: GscRow[]
  indexedNow: number | null; indexedBefore: number | null; cwv: CwvRow[]
}): Alert[] {
  const out: Alert[] = []
  const sum = (rows: GscRow[]) => rows.reduce((s, r) => s + r.clicks, 0)
  const sc = sum(input.pagesCur), sp = sum(input.pagesPrev)
  if (sp >= 30 && sc <= sp * 0.7) out.push({ key: "site-daling", type: "site-daling", subject: null, severity: "error", title: `Google-klikken op de hele site ${pct(sc, sp)}% t.o.v. de week ervoor`, detail: `${sc} klikken in de laatste 7 dagen, tegen ${sp} de week ervoor. Kijk of één pagina of zoekwoord de daling verklaart, of dat het sitebreed is (techniek, indexering, seizoen).`, data: { cur: sc, prev: sp } })

  const curPages = new Map(input.pagesCur.map(r => [toPath(r.keys[0]), r]))
  for (const prev of input.pagesPrev) {
    const path = toPath(prev.keys[0]), cur = curPages.get(path)
    const c = cur?.clicks || 0
    if (prev.clicks >= 10 && c <= prev.clicks * 0.7) out.push({
      key: `pagina-daling|${path}`, type: "pagina-daling", subject: path, severity: prev.clicks >= 30 ? "error" : "warning",
      title: `${path}: ${pct(c, prev.clicks)}% Google-klikken`,
      detail: `${c} klikken in de laatste 7 dagen, tegen ${prev.clicks} de week ervoor${cur ? ` (positie ${p1(prev.position)} → ${p1(cur.position)})` : " (geen vertoningen meer)"}.`,
      data: { cur: c, prev: prev.clicks, posNow: cur?.position ?? null, posPrev: prev.position },
    })
  }

  const curQ = new Map(input.queriesCur.map(r => [r.keys[0], r]))
  for (const prev of input.queriesPrev) {
    const q = prev.keys[0]
    if (isBrandQuery(q) || prev.position > 10 || prev.impressions < 20) continue
    const cur = curQ.get(q)
    if (!cur || cur.position > 10) out.push({
      key: `pagina1-kwijt|${q}`, type: "pagina1-kwijt", subject: q, severity: prev.clicks >= 5 ? "error" : "warning",
      title: `"${q}" is van pagina 1 af`,
      detail: cur ? `Positie ${p1(prev.position)} → ${p1(cur.position)} (week tegen week, ${prev.impressions} vertoningen de week ervoor).` : `Stond op positie ${p1(prev.position)} en heeft deze week geen vertoningen meer.`,
      data: { posPrev: prev.position, posNow: cur?.position ?? null },
    })
  }

  if (input.indexedNow !== null && input.indexedBefore !== null) {
    const drop = input.indexedBefore - input.indexedNow
    if (drop >= Math.max(3, input.indexedBefore * 0.05)) out.push({
      key: "indexering-daling", type: "indexering-daling", subject: null, severity: "error",
      title: `${drop} pagina's minder geïndexeerd`,
      detail: `Google heeft nu ${input.indexedNow} pagina's in de index, tegen ${input.indexedBefore} bij de vorige controle.`,
      data: { now: input.indexedNow, before: input.indexedBefore },
    })
  }

  for (const r of input.cwv) if (r.status === "slecht" && !r.error) out.push({
    key: `snelheid|${r.path}`, type: "snelheid", subject: r.path, severity: "warning",
    title: `${r.path} laadt slecht op mobiel`,
    detail: `${cwvProblems(r).join("; ") || "Core Web Vitals onder de grens van Google"}${r.score !== null ? ` (PageSpeed-score ${r.score})` : ""}.`,
  })
  return out
}

export async function runAlerts() {
  const sb = getSupabase()
  const sc = serviceSearchConsole()
  const w1 = dateWindow(7), w0 = dateWindow(7, 7)
  const q = (w: { startDate: string; endDate: string }, dim: string) => gscQuery(sc, { startDate: w.startDate, endDate: w.endDate, dimensions: [dim], rowLimit: 5000 })
  const [pagesCur, pagesPrev, queriesCur, queriesPrev] = await Promise.all([q(w1, "page"), q(w0, "page"), q(w1, "query"), q(w0, "query")])

  // Aantal geïndexeerde pagina's bijhouden en vergelijken met de vorige meting
  const today = new Date().toISOString().slice(0, 10)
  const { count } = await sb.from("seo_pages").select("path", { count: "exact", head: true }).eq("index_verdict", "PASS")
  const indexedNow = typeof count === "number" ? count : null
  const { data: hist } = await sb.from("seo_metric_history").select("date, value").eq("key", "indexed").lt("date", today).order("date", { ascending: false }).limit(1)
  if (indexedNow !== null) await sb.from("seo_metric_history").upsert({ date: today, key: "indexed", value: indexedNow })
  const { data: cwv } = await sb.from("seo_cwv").select("*").eq("strategy", "mobile")

  const alerts = alertRules({ pagesCur, pagesPrev, queriesCur, queriesPrev, indexedNow, indexedBefore: hist?.[0] ? Number(hist[0].value) : null, cwv: (cwv || []) as CwvRow[] })
  const now = new Date().toISOString()
  const { data: open } = await sb.from("seo_alerts").select("key").is("resolved_at", null)
  const openKeys = new Set((open || []).map(r => r.key))
  const fresh = alerts.filter(a => !openKeys.has(a.key))
  if (alerts.length) {
    // Bestaande open meldingen: alleen bijwerken; nieuwe (of weer opgetreden) meldingen: opnieuw melden
    for (const a of alerts) {
      if (openKeys.has(a.key)) await sb.from("seo_alerts").update({ title: a.title, detail: a.detail, data: a.data ?? null, severity: a.severity, last_seen: now }).eq("key", a.key)
      else await sb.from("seo_alerts").upsert({ ...a, data: a.data ?? null, first_seen: now, last_seen: now, resolved_at: null, notified_at: null })
    }
  }
  const gone = [...openKeys].filter(k => !alerts.some(a => a.key === k))
  if (gone.length) await sb.from("seo_alerts").update({ resolved_at: now }).in("key", gone)
  return { open: alerts.length, nieuw: fresh.length, opgelost: gone.length, week: w1 }
}

export async function readAlerts(includeResolvedDays = 14): Promise<AlertRow[]> {
  const since = new Date(Date.now() - includeResolvedDays * 86400e3).toISOString()
  const { data } = await getSupabase().from("seo_alerts").select("*").or(`resolved_at.is.null,resolved_at.gte.${since}`).order("first_seen", { ascending: false }).limit(100)
  return (data || []) as AlertRow[]
}
