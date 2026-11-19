// Pagina's vinden op plaatsnaam, en plaatsen met zoekvraag naar een onderwerp.
// Gebruikt bij "Taak toevoegen": een medewerker denkt in plaatsen ("Hardenberg"), niet in paden.

import type { GscRow } from "./types"
import { classifyPath, prettySlug, type PageRow } from "./pages"
import { normalize } from "./format"
import { SERVICE_TERMS } from "./content/model"

export interface PlacePage { path: string; label: string; sub: string }

const TYPE: Record<string, string> = { provincie: "provinciepagina", gemeente: "gemeente", plaats: "plaats" }

export function placePage(path: string): PlacePage | null {
  const c = classifyPath(path)
  if (!TYPE[c.type]) return null
  const slug = path.split("/").filter(Boolean).pop()!
  const prov = c.provincie ? prettySlug(c.provincie) : ""
  const gem = c.type === "plaats" && c.gemeente && c.gemeente !== slug ? `gemeente ${prettySlug(c.gemeente)}, ` : ""
  return { path, label: prettySlug(slug), sub: c.type === "provincie" ? "provinciepagina" : `${gem}${prov}` }
}

// Zoeken op (een deel van) een plaatsnaam of pad
export function searchPages(term: string, inventory: PageRow[], limit = 8): PlacePage[] {
  const t = normalize(term).trim().replace(/\s+/g, "-")
  if (t.length < 2) return []
  const out: { p: PlacePage; rank: number }[] = []
  for (const r of inventory) {
    const p = placePage(r.path)
    if (!p) continue
    const slug = r.path.split("/").filter(Boolean).pop()!
    const rank = slug === t ? 0 : slug.startsWith(t) ? 1 : slug.includes(t) ? 2 : r.path.includes(t) ? 3 : -1
    if (rank >= 0) out.push({ p, rank })
  }
  return out.sort((a, b) => a.rank - b.rank || a.p.label.localeCompare(b.p.label, "nl")).slice(0, limit).map(x => x.p)
}

// Termen voor een onderwerp: een dienst van Gijs telt met al zijn varianten mee ("hybride pomp" bij warmtepomp)
export function topicTerms(topic: string): string[] {
  const t = normalize(topic).trim()
  if (!t) return []
  for (const [svc, terms] of Object.entries(SERVICE_TERMS)) {
    if (svc === t || terms.some(x => t.includes(x) || x.includes(t))) return [...new Set([svc, ...terms, t])]
  }
  return [t]
}

export interface PlaceDemand {
  place: string                 // slug
  label: string
  pages: PlacePage[]            // meerdere bij dubbele plaatsnamen (Hengelo in Overijssel én Gelderland)
  queries: { q: string; imp: number; clicks: number; pos: number }[]
  imp: number
  pos: number | null
}

// Welke plaatsen (met een eigen pagina) hebben zoekvraag naar dit onderwerp?
export function demandForTopic(topic: string, keywords: GscRow[], inventory: PageRow[]): PlaceDemand[] {
  const terms = topicTerms(topic)
  if (!terms.length) return []
  const bySlug = new Map<string, PlacePage[]>()
  for (const r of inventory) {
    const p = placePage(r.path)
    if (!p) continue
    const slug = r.path.split("/").filter(Boolean).pop()!
    // Zelfde plaatsnaam als gemeente én plaats in dezelfde provincie (/nijkerk en /nijkerk/nijkerk):
    // de pagina die Google het meest toont, bij gelijke stand de gemeentepagina
    const list = bySlug.get(slug) || []
    const sameProv = list.findIndex(x => x.path.split("/")[2] === r.path.split("/")[2])
    if (sameProv >= 0) {
      const cur = inventory.find(x => x.path === list[sameProv].path)
      const better = r.imp_28d > (cur?.imp_28d || 0) || (r.imp_28d === (cur?.imp_28d || 0) && r.path.length < list[sameProv].path.length)
      if (better) list[sameProv] = p
    } else list.push(p)
    bySlug.set(slug, list)
  }
  const slugs = [...bySlug.keys()].sort((a, b) => b.length - a.length)
  const found = new Map<string, PlaceDemand>()
  for (const k of keywords) {
    const q = normalize(String(k.keys[0] || "")).trim()
    if (!q || !terms.some(t => q.includes(t))) continue
    const joined = `-${q.split(/\s+/).join("-")}-`
    const slug = slugs.find(s => joined.includes(`-${s}-`))
    if (!slug) continue
    const d = found.get(slug) || { place: slug, label: prettySlug(slug), pages: bySlug.get(slug)!, queries: [], imp: 0, pos: null }
    d.queries.push({ q, imp: k.impressions, clicks: k.clicks, pos: k.position })
    d.imp += k.impressions
    found.set(slug, d)
  }
  for (const d of found.values()) {
    d.queries.sort((a, b) => b.imp - a.imp)
    d.pos = d.imp ? Math.round((d.queries.reduce((s, x) => s + x.pos * x.imp, 0) / d.imp) * 10) / 10 : null
  }
  return [...found.values()].sort((a, b) => b.imp - a.imp)
}

// Het zoekwoord voor de taak op één pagina: het meest gezochte met onderwerp en plaats, anders "onderwerp plaats"
export function queryFor(topic: string, page: string, demand: PlaceDemand[]): string {
  const d = demand.find(x => x.pages.some(p => p.path === page))
  if (d?.queries.length) return d.queries[0].q
  const slug = page.split("/").filter(Boolean).pop() || ""
  return `${normalize(topic).trim()} ${slug.replace(/-/g, " ")}`.trim()
}
