// Bijna op pagina 1 (pure functies, getest).
//
// Alle zoekwoorden die net buiten de top 10 staan (positie 11–20), niet alleen de sterkste die
// vanzelf een taak worden. Zoekwoorden over hetzelfde onderwerp in dezelfde plaats (bv.
// "spouwmuurisolatie borne" en "isolatie borne") horen bij één aanpak: één kaart, één pagina.

import type { GscRow } from "./types"
import { isBrandQuery } from "./signals"
import { placeIn, prettyPlace } from "./intent"
import { SCAN_SERVICE, SERVICE_TERMS, serviceLabel, servicesIn } from "./content/model"

export const NEAR_MIN_IMPRESSIONS = 10

export interface NearRow {
  q: string
  position: number
  prevPosition: number | null
  impressions: number
  clicks: number
  place: string | null   // regio-segment, bv. "borne"
  topic: string | null   // onderwerp: dienst, of "isolatie" voor alle isolatiesoorten samen
}

export interface NearGroup {
  id: string             // `${place}|${topic}`
  title: string          // voorstel voor de kaartnaam, bv. "Isolatie Borne"
  rows: NearRow[]
  impressions: number
}

// Alle isolatiesoorten vallen samen: één lokale pagina beantwoordt "isolatie borne" én "spouwmuurisolatie borne"
const ISOLATIE = ["spouwmuurisolatie", "dakisolatie", "vloerisolatie", "isolatieglas"]
export function topicOf(query: string): string | null {
  const q = query.toLowerCase()
  const specific = servicesIn(q, Object.keys(SERVICE_TERMS)).find(s => s in SERVICE_TERMS)
  if (specific) return ISOLATIE.includes(specific) ? "isolatie" : specific
  if (/isol/.test(q)) return "isolatie"
  return servicesIn(q, [SCAN_SERVICE]).length ? "verduurzamen" : null
}
export function topicLabel(t: string) {
  return t === "isolatie" ? "Isolatie" : t === "verduurzamen" ? "Verduurzamen" : serviceLabel(t)
}

export function nearPage1(keywords: GscRow[], prevKeywords: GscRow[], regions: Set<string>): NearRow[] {
  const prev = new Map(prevKeywords.map(k => [k.keys[0], k]))
  return keywords
    .filter(k => k.position > 10 && k.position <= 20 && k.impressions >= NEAR_MIN_IMPRESSIONS && !isBrandQuery(k.keys[0]))
    .map(k => {
      const q = k.keys[0]
      return { q, position: k.position, prevPosition: prev.get(q)?.position ?? null, impressions: k.impressions, clicks: k.clicks, place: placeIn(q, regions), topic: topicOf(q) }
    })
    .sort((a, b) => a.position - b.position || b.impressions - a.impressions)
}

// Groepen van twee of meer zoekwoorden met dezelfde plaats en hetzelfde onderwerp
export function nearGroups(rows: NearRow[]): NearGroup[] {
  const by = new Map<string, NearRow[]>()
  for (const r of rows) {
    if (!r.place || !r.topic) continue
    const id = `${r.place}|${r.topic}`
    by.set(id, [...(by.get(id) || []), r])
  }
  return [...by.entries()]
    .filter(([, rs]) => rs.length >= 2)
    .map(([id, rs]) => {
      const [place, topic] = id.split("|")
      return { id, title: `${topicLabel(topic)} ${prettyPlace(place)}`, rows: [...rs].sort((a, b) => b.impressions - a.impressions), impressions: rs.reduce((s, r) => s + r.impressions, 0) }
    })
    .sort((a, b) => b.impressions - a.impressions)
}
