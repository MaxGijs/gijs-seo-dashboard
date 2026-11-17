// Interne-linkvoorstellen: vanaf welke pagina's link je naar een doelpagina, met welke tekst,
// en bestaat die link al? Leest de site alleen; wijzigt niets.

import { getSupabase } from "./guard"
import { decodeEntities } from "./audit"
import { classifyPath, prettySlug } from "@/lib/pages"
import { SERVICE_TERMS } from "@/lib/content/model"

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
    const html = (await res.text()).split(/<body[^>]*>/i)[1] || ""
    const out: { href: string; text: string }[] = []
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = (m[1].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || ""
      const p = href.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").split(/[?#]/)[0].replace(/\/$/, "") || "/"
      if (!p.startsWith("/")) continue
      out.push({ href: p, text: decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() })
    }
    return out
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
  const { data: pages } = await sb.from("seo_pages").select("path, page_type, provincie, gemeente, plaats, imp_28d, in_sitemap, http_status").eq("in_sitemap", true)
  const ok = (pages || []).filter(p => !(p.http_status && p.http_status >= 400) && p.path !== target)
  const imp = (p: { imp_28d: number | null }) => p.imp_28d || 0
  const cand: { path: string; reason: string; impressions: number }[] = []
  const add = (path: string | undefined, reason: string) => {
    if (!path || path === target || cand.some(x => x.path === path)) return
    const p = ok.find(x => x.path === path)
    if (p) cand.push({ path, reason, impressions: imp(p) })
  }
  const service = query ? serviceIn(query) : null
  if (c.type === "plaats" || c.type === "gemeente") {
    add(`/regio/${c.provincie}/${c.gemeente}`, "De gemeentepagina is de logische ingang naar deze plaats.")
    add(`/regio/${c.provincie}`, "De provinciepagina verdeelt bezoekers over de gemeenten.")
    ok.filter(p => p.gemeente === c.gemeente && p.page_type === "plaats").sort((a, b) => imp(b) - imp(a)).slice(0, 2)
      .forEach(p => add(p.path, "Buurplaats in dezelfde gemeente met al vertoningen in Google."))
    ok.filter(p => p.provincie === c.provincie && p.page_type === "gemeente" && p.gemeente !== c.gemeente).sort((a, b) => imp(b) - imp(a)).slice(0, 1)
      .forEach(p => add(p.path, "Sterke gemeentepagina in dezelfde provincie (geeft autoriteit door)."))
  }
  if (c.type === "provincie") add("/regio", "Het regio-overzicht linkt naar alle provincies.")
  if (service) add(`/maatregelen/${service}`, `De maatregelpagina over ${prettySlug(service).toLowerCase()} past bij de zoekvraag.`)
  if (c.type === "maatregel") {
    add("/maatregelen", "Het overzicht van maatregelen.")
    ok.filter(p => p.page_type === "gemeente").sort((a, b) => imp(b) - imp(a)).slice(0, 2).forEach(p => add(p.path, "Drukbezochte lokale pagina; kan doorverwijzen naar de uitleg over deze maatregel."))
  }
  add("/", "De homepage geeft de meeste autoriteit door, maar alleen voor de belangrijkste pagina's.")
  const list = cand.slice(0, 6)
  const anchors = anchorsFor(target, query)
  const suggestions = await Promise.all(list.map(async x => {
    try {
      const links = await linksOn(x.path)
      const hits = links.filter(l => l.href === target)
      return { source: x.path, reason: x.reason, impressions: x.impressions, alreadyLinks: hits.length > 0, existingAnchors: [...new Set(hits.map(h => h.text).filter(Boolean))].slice(0, 3), anchors, checked: true }
    } catch (e: any) {
      return { source: x.path, reason: x.reason, impressions: x.impressions, alreadyLinks: false, existingAnchors: [], anchors, checked: false, error: e?.name === "AbortError" ? "Pagina reageerde niet" : e?.message || "Niet gecontroleerd" }
    }
  }))
  // Eerst de pagina's die nog niet linken, daarna op vertoningen
  suggestions.sort((a, b) => Number(a.alreadyLinks) - Number(b.alreadyLinks) || b.impressions - a.impressions)
  return { target, suggestions }
}
