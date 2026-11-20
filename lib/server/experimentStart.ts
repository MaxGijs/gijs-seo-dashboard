// Bij de start van een meting: geschiktheidscontrole, soort (experiment, validatie of meting)
// en experimentfamilie. Op de server, zodat het taakpaneel, "Meerdere afronden" en de
// Claude-koppeling precies hetzelfde vastleggen.

import { getSupabase } from "./guard"
import { dateWindow, gscQuery, serviceSearchConsole, toUrl } from "./gsc"
import { ageDays } from "@/lib/pages"
import { familyFor, familyTitle, kindOf, suitabilityOf, type ExpKind, type Suitability } from "@/lib/experiment"

const normPath = (p: string | null | undefined) => (p ? p.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").replace(/(.)\/$/, "$1") || "/" : null)

// Gemiddelde positie per week (gewogen naar vertoningen) in de 28 dagen vóór de aanpassing
async function weeklyPositions(query: string | null, page: string | null): Promise<{ weeks: number[]; impressions: number | null }> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || (!query && !page)) return { weeks: [], impressions: null }
  try {
    const filters: any[] = []
    if (query) filters.push({ dimension: "query", operator: "equals", expression: query })
    if (page) filters.push({ dimension: "page", operator: "equals", expression: toUrl(page) })
    const rows = await gscQuery(serviceSearchConsole(), { ...dateWindow(28, 0), dimensions: ["date"], dimensionFilterGroups: [{ filters }], rowLimit: 100 })
    const sorted = [...rows].sort((a, b) => a.keys[0].localeCompare(b.keys[0]))
    const weeks: number[] = []
    for (let i = 0; i < 4; i++) {
      const start = new Date(`${dateWindow(28, 0).startDate}T12:00:00Z`); start.setUTCDate(start.getUTCDate() + i * 7)
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6)
      const inWeek = sorted.filter(r => r.keys[0] >= start.toISOString().slice(0, 10) && r.keys[0] <= end.toISOString().slice(0, 10))
      const imp = inWeek.reduce((s, r) => s + r.impressions, 0)
      if (imp > 0) weeks.push(inWeek.reduce((s, r) => s + r.position * r.impressions, 0) / imp)
    }
    return { weeks, impressions: rows.reduce((s, r) => s + r.impressions, 0) }
  } catch { return { weeks: [], impressions: null } }
}

export interface StartInfo { kind: ExpKind; suitability: Suitability; family_id: string | null; family_title: string | null; familyRoot: { id: string; family_title: string } | null }

export async function prepareStart(b: { advice_key: string; description: string; baseline: any; query: string | null; page: string | null }, today: string): Promise<StartInfo> {
  const sb = getSupabase()
  const metric: string = b.baseline?.successMetric || "position"
  const target = normPath(b.baseline?.targetPage || b.page)

  // Familie: zelfde beschrijving, binnen 3 dagen gestart
  const since = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10)
  const { data: recent } = await sb.from("seo_experiments").select("id, advice_key, description, changed_at, family_id, family_title").gte("changed_at", since)
  const fam = familyFor(b.description, today, (recent || []).filter(r => r.advice_key !== b.advice_key))
  let family_id: string | null = null, family_title: string | null = null, familyRoot: StartInfo["familyRoot"] = null
  if (fam) {
    family_id = fam.family_id || fam.id
    const members = (recent || []).filter(r => (r.family_id || r.id) === family_id || r.id === fam.id)
    const { data: titles } = await sb.from("seo_advice_status").select("advice_title").in("advice_key", [...members.map(m => m.advice_key), b.advice_key])
    family_title = familyTitle((titles || []).map(t => t.advice_title || ""), b.description)
    if (!fam.family_id || fam.family_title !== family_title) familyRoot = { id: fam.id, family_title }
  }

  // Lopende aanpassingen op dezelfde pagina of hetzelfde zoekwoord (buiten de eigen familie)
  const { data: open } = await sb.from("seo_experiments").select("id, advice_key, description, query, page, target_pages, family_id").is("outcome", null)
  const overlapping = (open || [])
    .filter(o => o.advice_key !== b.advice_key && !(family_id && (o.family_id || o.id) === family_id))
    .filter(o => (b.query && o.query === b.query) || (target && [o.page, ...(o.target_pages || [])].map(normPath).includes(target)))
    .map(o => `${o.query ? `"${o.query}"` : o.page}: ${String(o.description).split("\n")[0].slice(0, 60)}`)

  // Doelpagina: leeftijd en status
  const { data: pageRow } = target ? await sb.from("seo_pages").select("launch_date, first_seen, http_status, http_final_path").eq("path", target).maybeSingle() : { data: null }
  const pair = !!(b.query && b.baseline?.targetPage)
  const live = ["position", "ctr"].includes(metric) ? await weeklyPositions(b.query, pair ? target : b.query ? null : target) : { weeks: [], impressions: null }
  const impressions = live.impressions ?? (pair ? b.baseline?.pairImpressions ?? b.baseline?.impressions : b.baseline?.impressions) ?? null
  const suitability = suitabilityOf({
    metric, query: b.query, page: target,
    impressions: typeof impressions === "number" ? impressions : null,
    weeklyPositions: live.weeks,
    pageAgeDays: pageRow ? ageDays(pageRow as any) : null,
    pageHttp: pageRow?.http_status ?? null,
    pageRedirectsTo: normPath(pageRow?.http_final_path),
    queryOnPage: pair ? typeof b.baseline?.pairPosition === "number" : null,
    overlapping,
    conversionMeasured: null,
  })
  return { kind: kindOf(metric, suitability), suitability, family_id, family_title, familyRoot }
}
