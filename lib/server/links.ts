// Interne-linkvoorstellen: vanaf welke pagina's link je naar een doelpagina, met welke tekst,
// en bestaat die link al? Leest de site alleen; wijzigt niets.

import { getSupabase } from "./guard"
import { decodeEntities } from "./audit"
import { classifyPath, prettySlug } from "@/lib/pages"
import { SERVICE_TERMS } from "@/lib/content/model"
import { MAATREGEL_PAGES } from "@/lib/diagnosis"

const ORIGIN = "https://www.groeninjestraat.nl"
const UA = "GijsIntelligence/1.0 (+linkvoorstellen, alleen lezen)"

export interface LinkSuggestion {
  source: string
  reason: string
  impressions: number
  alreadyLinks: boolean
  existingAnchors: string[]
  anchors: string[]
  checked: boolean
  error?: string
}

async function linksOn(path: string) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${ORIGIN}${path}`, { signal: ctrl.signal, cache: "no-store", headers: { "User-Agent": UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const finalPath = (res.url || "").replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").split(/[?#]/)[0].replace(/\/$/, "") || path
    const html = (await res.text()).split(/<body[^>]*>/i)[1] || ""
    const out: { href: string; text: string }[] = []
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = (m[1].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || ""
      const p = href.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").split(/[?#]/)[0].replace(/\/$/, "") || "/"
      if (!p.startsWith("/")) continue
      out.push({ href: p, text: decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() })
    }
    return { links: out, finalPath: finalPath || path }
  } finally { clearTimeout(t) }
}

function serviceIn(q: string) {
  const low = q.toLowerCase()
  return Object.entries(SERVICE_TERMS).find(([, terms]) => terms.some(t => low.includes(t)))?.[0] || null
}

export function anchorsFor(target: string, query: string | null) {
  const c = classifyPath(target)
  const place = c.plaats || c.gemeente || c.provincie
  const placeName = place ? prettySlug(place) : null
  const service = query ? serviceIn(query) : c.type === "maatregel" ? target.split("/")[2] : null
  const out = new Set<string>()
  if (query) out.add(query)
  if (service && placeName) out.add(`${prettySlug(service).toLowerCase()} in ${placeName}`)
  if (placeName) out.add(`verduurzamen in ${placeName}`)
  if (placeName && !service) out.add(`isolatie en warmtepompen in ${placeName}`)
  if (service && !placeName) out.add(`meer over ${prettySlug(service).toLowerCase()}`)
  if (placeName) out.add(placeName)
  return [...out].slice(0, 4)
}

export async function suggestLinks(target: string, query: string | null): Promise<{ target: string; suggestions: LinkSuggestion[] }> {
  const sb = getSupabase()
  const c = classifyPath(target)
  const since = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)
  const [{ data: pages }, { data: gsc }] = await Promise.all([
    sb.from("seo_pages").select("path, page_type, provincie, gemeente, plaats, imp_28d, in_sitemap, http_status"),
    sb.from("seo_daily_pages").select("page, impressions").gte("snapshot_date", since),
  ])
  // Bestaande pagina's: uit de sitemap-inventaris én pagina's die Google de afgelopen maand toonde (zoals /isolatie)
  const imp = new Map<string, number>()
  for (const r of gsc || []) { const p = r.page.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").replace(/\/$/, "") || "/"; imp.set(p, (imp.get(p) || 0) + r.impressions) }
  const ok = (pages || []).filter(p => !(p.http_status && p.http_status >= 400) && p.path !== target)
  const exists = new Set([...ok.map(p => p.path), ...imp.keys()])
  const impOf = (path: string) => Math.max(imp.get(path) || 0, ok.find(p => p.path === path)?.imp_28d || 0)
  const cand: { path: string; reason: string; impressions: number }[] = []
  const add = (path: string | undefined | null, reason: string) => {
    if (!path || path === target || !exists.has(path) || cand.some(x => x.path === path)) return
    cand.push({ path, reason, impressions: impOf(path) })
  }
  // Volgorde = inhoudelijke logica, niet autoriteit: eerst het onderwerp, dan de regio, dan de wijken.
  const nq = (query || "").toLowerCase()
  const hub = nq ? MAATREGEL_PAGES.find(([re]) => re.test(nq)) : null
  if (hub) add(hub[1], `De onderwerppagina over ${hub[2]} past bij de zoekvraag: bezoekers die daar lezen, zoeken vaak een vakman in hun plaats.`)
  if (/isol|spouw|dak|vloer|glas/.test(nq)) add("/isolatie", "Het overzicht van isolatie verwijst bezoekers door naar hun eigen plaats.")
  if (c.type === "plaats") add(`/regio/${c.provincie}/${c.gemeente}`, "De gemeentepagina is de logische ingang naar deze wijk of kern.")
  if (c.type === "plaats" || c.type === "gemeente") add(`/regio/${c.provincie}`, "De provinciepagina verdeelt bezoekers over de gemeenten.")
  ok.filter(p => p.page_type === "artikel" && nq && nq.split(" ").some(w => w.length > 4 && p.path.includes(w))).slice(0, 2)
    .forEach(p => add(p.path, "Artikel over hetzelfde onderwerp."))
  if (c.type === "gemeente") ok.filter(p => p.gemeente === c.gemeente && p.page_type === "plaats").sort((a, b) => impOf(b.path) - impOf(a.path)).slice(0, 2)
    .forEach(p => add(p.path, "Wijk- of kernpagina binnen deze gemeente; een link terug naar de gemeente hoort erbij."))
  if (c.type === "provincie") add("/regio", "Het regio-overzicht linkt naar alle provincies.")
  if (c.type === "maatregel") add("/maatregelen", "Het overzicht van maatregelen.")
  // Homepage alleen voor strategische pagina's (provincie, onderwerp, maatregel), niet voor elke plaats
  if (c.type === "provincie" || c.type === "maatregel" || c.type === "overig") add("/", "De homepage geeft de meeste autoriteit door; alleen voor de belangrijkste pagina's.")
  const list = cand.slice(0, 6)
  const anchors = anchorsFor(target, query)
  const checked = await Promise.all(list.map(async (x): Promise<LinkSuggestion | null> => {
    try {
      const { links, finalPath } = await linksOn(x.path)
      if (finalPath !== x.path) return null // bron verwijst door: geen echte bronpagina
      const hits = links.filter(l => l.href === target)
      return { source: x.path, reason: x.reason, impressions: x.impressions, alreadyLinks: hits.length > 0, existingAnchors: [...new Set(hits.map(h => h.text).filter(Boolean))].slice(0, 3), anchors, checked: true }
    } catch (e: any) {
      return { source: x.path, reason: x.reason, impressions: x.impressions, alreadyLinks: false, existingAnchors: [], anchors, checked: false, error: e?.name === "AbortError" ? "Pagina reageerde niet" : e?.message || "Niet gecontroleerd" }
    }
  }))
  // Volgorde blijft de inhoudelijke volgorde; wel eerst de pagina's die nog niet linken
  const suggestions = checked.filter((x): x is LinkSuggestion => !!x)
  suggestions.sort((a, b) => Number(a.alreadyLinks) - Number(b.alreadyLinks))
  return { target, suggestions }
}
