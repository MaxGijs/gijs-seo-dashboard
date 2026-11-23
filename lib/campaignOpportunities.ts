// Kansen bij offline campagnes (pure functies, getest).
//
// Het dashboard volgt al het nieuws over subsidies, regels, kosten en het stroomnet (contentkansen).
// Hier koppelen we dat nieuws aan de gebieden waar een campagne liep: zelfde onderwerp, zelfde gebied
// (of landelijk nieuws) en een woningtype waar het bij past. Voorbeeld: in oktober een brief in de
// Bornsche Maten over warmtepompen; nu wordt de warmtepompsubsidie minder → aanleiding voor een vervolg.
// Er wordt niets automatisch verstuurd: het is een voorstel met de reden erbij.

import type { Campaign } from "./campaigns"

export type Housing = "nieuwbouw" | "bestaand" | "gemengd"
export const HOUSING: Record<Housing, string> = { nieuwbouw: "Nieuwbouw", bestaand: "Bestaande bouw", gemengd: "Gemengd" }

export const THEMES: { id: string; label: string; words: RegExp }[] = [
  { id: "warmtepomp", label: "Warmtepomp", words: /warmtepomp|hybride|all[- ]?electric/i },
  { id: "zonnepanelen", label: "Zonnepanelen", words: /zonnepane|saldering|teruglever/i },
  { id: "thuisbatterij", label: "Thuisbatterij", words: /thuisbatterij|batterij/i },
  { id: "spouwmuurisolatie", label: "Spouwmuurisolatie", words: /spouw/i },
  { id: "dakisolatie", label: "Dakisolatie", words: /dakisolatie|\bdak\b/i },
  { id: "vloerisolatie", label: "Vloerisolatie", words: /vloerisolatie|bodemisolatie|kruipruimte/i },
  { id: "isolatieglas", label: "Isolatieglas", words: /glas|kozijn/i },
  { id: "energiescan", label: "Verduurzamen algemeen", words: /energiescan|verduurzam|isde|subsidiecheck|energielabel/i },
]
const ISOLATION = new Set(["spouwmuurisolatie", "dakisolatie", "vloerisolatie", "isolatieglas"])
const IMPACT_LABEL: Record<string, string> = { subsidie: "Subsidie", regelgeving: "Regels", kosten: "Kosten", net: "Stroomnet" }
export const themeLabel = (id: string) => THEMES.find(t => t.id === id)?.label || id

export type CampaignX = Campaign & { themes?: string[] | null; housing?: Housing | null }
export interface IdeaLite {
  id: string; title: string; origin: string; impact: string | null; service: string | null; status: string
  regions: string[] | null; why_now: string | null; summary?: string | null; advice?: string | null; created_at: string
  sources?: { title?: string; publisher?: string; date?: string; url?: string }[] | null
}
export interface Opportunity {
  campaignId: string; ideaId: string; title: string; impact: string; impactLabel: string; theme: string
  why: string; source: string | null; fit: string[]; suggestion: string; timing: string; deadline: string | null
  hasArticle: boolean; score: number
}

// Onderwerpen van een campagne: zelf gekozen, anders afgeleid uit naam en notitie
export function themesOf(c: CampaignX): string[] {
  if (c.themes?.length) return c.themes
  const text = `${c.name} ${c.note || ""}`
  return THEMES.filter(t => t.words.test(text)).map(t => t.id)
}

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b.slice(0, 10)}T12:00:00Z`).getTime() - new Date(`${a.slice(0, 10)}T12:00:00Z`).getTime()) / 86400000)
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
const ds = (d: string) => { const x = new Date(`${d.slice(0, 10)}T12:00:00Z`); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}` }

// Een datum waarvóór iets verandert ("per 1 januari 2027", "vanaf 2027")
export function deadlineIn(text: string): string | null {
  const m = text.match(/\b(per|vanaf|vóór|voor|tot|na)\s+(\d{1,2}\s+(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+20\d\d|20\d\d)\b/i)
  return m ? `${m[1].toLowerCase()} ${m[2]}` : null
}

const firstSentences = (t: string, max = 260) => { const s = t.replace(/\s+/g, " ").trim(); if (s.length <= max) return s; const cut = s.slice(0, max); const i = cut.lastIndexOf(". "); return (i > 80 ? cut.slice(0, i + 1) : cut.replace(/\s\S*$/, "")) + (i > 80 ? "" : "…") }

export function opportunitiesFor(c: CampaignX, ideas: IdeaLite[], provinceOf: (region: string) => string | null, today: string, effectEnd: string): Opportunity[] {
  const themes = themesOf(c)
  const area = c.regions.length ? c.regions.join(", ") : "het campagnegebied"
  const regions = new Set(c.regions.map(r => r.trim().toLowerCase()))
  const provinces = new Set([...regions].map(r => provinceOf(r)).filter((p): p is string => !!p))
  const out: Opportunity[] = []
  for (const i of ideas) {
    if (!i.impact || !IMPACT_LABEL[i.impact]) continue
    if (!["actualiteit", "trend", "handmatig"].includes(i.origin)) continue
    if (["afgewezen", "verlopen"].includes(i.status)) continue
    if (i.advice === "bijwerken") continue                  // tekst op de eigen site controleren is geen campagne-aanleiding
    if (daysBetween(i.created_at, today) > 45) continue
    const fit: string[] = []
    let score = 0
    // Onderwerp
    const general = !i.service || i.service === "energiescan"
    const theme = i.service && themes.includes(i.service) ? i.service : general && i.impact === "subsidie" ? "energiescan" : null
    if (!theme) continue
    if (theme === i.service && theme !== "energiescan") { score += 3; fit.push(`Zelfde onderwerp als de campagne: ${themeLabel(theme).toLowerCase()}`) }
    else { score += 1; fit.push("Algemeen verduurzamingsnieuws (subsidie)") }
    // Gebied
    const ir = (i.regions || []).map(r => r.toLowerCase())
    if (ir.length) {
      const hit = ir.find(r => regions.has(r) || provinces.has(r))
      if (!hit) continue
      score += 1; fit.push(`Regionaal nieuws (${hit.charAt(0).toUpperCase() + hit.slice(1)})`)
    } else fit.push(`Landelijk nieuws; geldt ook voor ${area}`)
    // Soort nieuws
    score += i.impact === "subsidie" || i.impact === "regelgeving" ? 2 : 1
    // Woningtype
    if (c.housing === "nieuwbouw" && i.service && ISOLATION.has(i.service)) { score -= 2; fit.push("Let op: nieuwbouw is meestal al goed geïsoleerd") }
    else if (c.housing) fit.push(`Past bij ${HOUSING[c.housing].toLowerCase()}`)
    // Vers
    const age = daysBetween(i.created_at, today)
    if (age <= 14) score += 1
    if (score < 3) continue
    const text = `${i.why_now || ""} ${i.summary || ""} ${i.title}`
    const deadline = deadlineIn(text)
    const src = i.sources?.[0]
    const kind = c.kind === "flyer" ? "flyer" : c.kind === "email" ? "e-mail" : c.kind === "evenement" ? "informatieavond" : "brief"
    const subject = themeLabel(theme).toLowerCase()
    const suggestion = i.impact === "subsidie"
      ? `Vervolg-${kind} aan ${area}: "De subsidie voor ${subject === "verduurzamen algemeen" ? "verduurzamen" : `een ${subject}`} verandert${deadline ? ` ${deadline}` : ""}. Nu nog gebruikmaken?" Verwijs naar de subsidiecheck of de energiescan.`
      : i.impact === "regelgeving"
        ? `Vervolg-${kind} aan ${area}: leg in gewone taal uit wat de nieuwe regels voor ${subject} betekenen voor hun huis${deadline ? ` (${deadline})` : ""}, met een uitnodiging voor de energiescan.`
        : i.impact === "net"
          ? `Vervolg-${kind} aan ${area}: wat betekent het volle stroomnet voor ${subject}, en wat kun je wél doen?`
          : `Vervolg-${kind} aan ${area}: een rekenvoorbeeld van wat ${subject} nu kost en oplevert voor een woning in de wijk.`
    const since = daysBetween(c.start_date, today)
    const timing = effectEnd >= today
      ? `De campagne loopt nog na tot ${ds(effectEnd)}. Plan het vervolg daarna, dan blijven bezoek en aanvragen per campagne te onderscheiden.`
      : `De campagne was ${since >= 14 ? `${Math.round(since / 7)} weken` : `${since} dagen`} geleden; een vervolg met nieuws sluit aan op wat ze al ontvingen.`
    out.push({
      campaignId: c.id, ideaId: i.id, title: i.title, impact: i.impact, impactLabel: IMPACT_LABEL[i.impact], theme,
      why: firstSentences(i.why_now || i.summary || ""), source: src ? [src.publisher, src.date ? ds(src.date) : null].filter(Boolean).join(", ") || null : null,
      fit, suggestion, timing, deadline, hasArticle: i.status === "gepubliceerd", score,
    })
  }
  // Eén kans per onderwerp en soort nieuws (de sterkste), maximaal drie per campagne
  const best = new Map<string, Opportunity>()
  for (const o of out.sort((a, b) => b.score - a.score)) { const k = `${o.theme}|${o.impact}`; if (!best.has(k)) best.set(k, o) }
  return [...best.values()].slice(0, 3)
}
