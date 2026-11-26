// Microsoft Clarity (pure functies, getest): gedrag per pagina. De export-API geeft per aanvraag de
// laatste 24 uur, per metric een lijst met per URL de waarden. Veldnamen zijn niet allemaal
// gedocumenteerd; daarom lezen we ze ruim en bewaren we het origineel (raw).

export interface ClarityDay {
  day: string
  path: string
  sessions: number | null
  bot_sessions: number | null
  users: number | null
  pages_per_session: number | null
  scroll_depth: number | null       // gemiddelde scrolldiepte in %
  active_time: number | null        // actieve tijd per sessie (seconden)
  total_time: number | null
  dead_click_pct: number | null     // % sessies met een dode klik
  rage_click_pct: number | null     // % sessies met woedeklikken
  quickback_pct: number | null      // % sessies die snel teruggaan
  excessive_scroll_pct: number | null
  error_click_pct: number | null
  script_error_pct: number | null
  raw: Record<string, unknown>
}

const num = (v: unknown) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "")

// Volledige URL → pad zoals in de rest van het dashboard
export function clarityPath(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://x${url.startsWith("/") ? "" : "/"}${url}`)
    let p = decodeURIComponent(u.pathname).toLowerCase()
    if (p.length > 1) p = p.replace(/\/+$/, "")
    return p || "/"
  } catch { return null }
}

function urlOf(item: Record<string, unknown>) {
  const k = Object.keys(item).find(x => norm(x) === "url")
  return k && typeof item[k] === "string" ? (item[k] as string) : null
}
// Eerste getal waarvan de naam past
function pick(item: Record<string, unknown>, ...patterns: RegExp[]) {
  for (const re of patterns) for (const [k, v] of Object.entries(item)) if (re.test(k)) { const n = num(v); if (n !== null) return n }
  return null
}

const PCT: Record<string, keyof ClarityDay> = {
  deadclickcount: "dead_click_pct", rageclickcount: "rage_click_pct", quickbackclick: "quickback_pct",
  excessivescroll: "excessive_scroll_pct", errorclickcount: "error_click_pct", scripterrorcount: "script_error_pct",
}

export function parseClarity(json: unknown, day: string): ClarityDay[] {
  const by = new Map<string, ClarityDay>()
  const row = (path: string) => {
    let r = by.get(path)
    if (!r) { r = { day, path, sessions: null, bot_sessions: null, users: null, pages_per_session: null, scroll_depth: null, active_time: null, total_time: null, dead_click_pct: null, rage_click_pct: null, quickback_pct: null, excessive_scroll_pct: null, error_click_pct: null, script_error_pct: null, raw: {} }; by.set(path, r) }
    return r
  }
  for (const metric of Array.isArray(json) ? json : []) {
    const name = norm(String(metric?.metricName || ""))
    for (const item of (Array.isArray(metric?.information) ? metric.information : []) as Record<string, unknown>[]) {
      const url = urlOf(item); if (!url) continue
      const path = clarityPath(url); if (!path) continue
      const r = row(path)
      r.raw[name] = item
      if (name === "traffic") {
        // Meerdere URL-varianten (bv. met ?utm) tellen op
        r.sessions = (r.sessions || 0) + (pick(item, /^totalsessioncount$/i) || 0)
        r.bot_sessions = (r.bot_sessions || 0) + (pick(item, /bot/i) || 0)
        r.users = (r.users || 0) + (pick(item, /distinctusercount|distantusercount|usercount/i) || 0)
        r.pages_per_session = pick(item, /pagespersession/i)
      } else if (name === "scrolldepth") r.scroll_depth = pick(item, /averagescrolldepth/i, /scroll/i, /average/i)
      else if (name === "engagementtime") { r.active_time = pick(item, /active/i); r.total_time = pick(item, /total/i) }
      else if (PCT[name]) (r as any)[PCT[name]] = pick(item, /sessionswithmetricpercentage/i, /percentage/i)
    }
  }
  return [...by.values()].filter(r => r.path)
}

export interface Behavior {
  path: string; days: number; sessions: number; users: number
  scroll_depth: number | null; active_time: number | null
  dead_click_pct: number | null; rage_click_pct: number | null; quickback_pct: number | null; excessive_scroll_pct: number | null
  from: string | null; to: string | null
}
// Dagen samenvatten: sessies opgeteld, de rest gewogen naar sessies
export function summarizeBehavior(path: string, rows: Pick<ClarityDay, "day" | "sessions" | "users" | "scroll_depth" | "active_time" | "dead_click_pct" | "rage_click_pct" | "quickback_pct" | "excessive_scroll_pct">[]): Behavior {
  const w = (k: "scroll_depth" | "active_time" | "dead_click_pct" | "rage_click_pct" | "quickback_pct" | "excessive_scroll_pct") => {
    let s = 0, n = 0
    for (const r of rows) { const v = r[k]; const ws = r.sessions || 0; if (v === null || v === undefined || !ws) continue; s += Number(v) * ws; n += ws }
    return n ? Math.round((s / n) * 10) / 10 : null
  }
  const days = [...new Set(rows.map(r => r.day))].sort()
  return {
    path, days: days.length, sessions: rows.reduce((a, r) => a + (r.sessions || 0), 0), users: rows.reduce((a, r) => a + (r.users || 0), 0),
    scroll_depth: w("scroll_depth"), active_time: w("active_time"), dead_click_pct: w("dead_click_pct"), rage_click_pct: w("rage_click_pct"),
    quickback_pct: w("quickback_pct"), excessive_scroll_pct: w("excessive_scroll_pct"), from: days[0] || null, to: days[days.length - 1] || null,
  }
}

// Wat valt op? Korte, voorzichtige signalen (alleen bij genoeg sessies)
export function behaviorNotes(b: Behavior): { tone: "warning" | "info"; text: string }[] {
  const out: { tone: "warning" | "info"; text: string }[] = []
  if (b.sessions < 30) return [{ tone: "info", text: `Nog weinig bezoek (${b.sessions} sessies); de cijfers schommelen nog sterk.` }]
  if (b.scroll_depth !== null && b.scroll_depth < 35) out.push({ tone: "warning", text: `Bezoekers scrollen gemiddeld maar ${Math.round(b.scroll_depth)}% van de pagina: het belangrijkste staat beter bovenaan.` })
  if (b.quickback_pct !== null && b.quickback_pct >= 20) out.push({ tone: "warning", text: `${Math.round(b.quickback_pct)}% van de sessies gaat snel terug: de pagina sluit mogelijk niet aan bij wat mensen zochten.` })
  if (b.rage_click_pct !== null && b.rage_click_pct >= 3) out.push({ tone: "warning", text: `${b.rage_click_pct.toString().replace(".", ",")}% heeft woedeklikken: iets reageert niet zoals verwacht.` })
  if (b.dead_click_pct !== null && b.dead_click_pct >= 10) out.push({ tone: "info", text: `${Math.round(b.dead_click_pct)}% klikt op iets dat niets doet (bv. een afbeelding of tekst die op een knop lijkt).` })
  return out
}
