// Contentkansen samenvoegen tot één artikel (pure functies, getest).
//
// Twee of meer ideeën die over hetzelfde gaan, worden één kans: de hoofdkans krijgt de zoekwoorden,
// bronnen, regio's en aanleidingen van de andere, zodat één artikel meerdere vragen beantwoordt.
// De andere krijgen status "samengevoegd" en wijzen naar de hoofdkans. Niets gaat verloren:
// de hoofdkans bewaart zijn oorspronkelijke velden (merge_backup), zodat Splitsen alles terugzet.
// Samenvoegen telt niet als afwijzing.

import type { ContentIdea, IdeaStatus, KeywordRef, SourceRef } from "./model"

// Alleen ideeën waar nog niet aan geschreven is
export const MERGEABLE: IdeaStatus[] = ["nieuw", "later", "geaccepteerd", "briefing"]
export const canMerge = (i: Pick<ContentIdea, "status">) => MERGEABLE.includes(i.status)

export type MergeFields = Pick<ContentIdea, "title" | "keywords" | "sources" | "regions" | "related_pages" | "why_now" | "summary" | "score" | "priority">
type Lite = Pick<ContentIdea, "id" | "title" | "status" | "service" | "impact" | "keywords" | "sources" | "regions" | "related_pages" | "why_now" | "summary" | "score" | "priority" | "target_page" | "advice"> & { merge_backup?: any; merged_into?: string | null }

const PRIO = { hoog: 0, middel: 1, laag: 2 } as const
const firstSentence = (t: string | null | undefined) => { const s = (t || "").replace(/\s+/g, " ").trim(); const i = s.search(/[.!?](\s|$)/); return (i > 20 ? s.slice(0, i + 1) : s.slice(0, 160)).trim() }

export function backupOf(i: Lite): MergeFields {
  return { title: i.title, keywords: i.keywords || [], sources: i.sources || [], regions: i.regions || [], related_pages: i.related_pages || [], why_now: i.why_now, summary: i.summary, score: i.score, priority: i.priority }
}

// Velden van de hoofdkans na samenvoegen: het origineel plus wat de andere toevoegen
export function combine(base: MergeFields, mainTarget: string | null, others: Lite[], title?: string | null): MergeFields {
  const kw = new Map<string, KeywordRef>()
  for (const k of [...(base.keywords || []), ...others.flatMap(o => o.keywords || [])]) {
    const key = k.query.toLowerCase().trim(); const cur = kw.get(key)
    if (!cur || (k.impressions || 0) > (cur.impressions || 0)) kw.set(key, k)
  }
  const src = new Map<string, SourceRef>()
  for (const s of [...(base.sources || []), ...others.flatMap(o => o.sources || [])]) { const key = (s.url || `${s.publisher}|${s.title}`).toLowerCase(); if (!src.has(key)) src.set(key, s) }
  const pages = [...new Set([...(base.related_pages || []), ...others.flatMap(o => [...(o.related_pages || []), ...(o.target_page ? [o.target_page] : [])])])].filter(p => p && p !== mainTarget)
  const also = others.map(o => `"${o.title}"${o.why_now ? ` (${firstSentence(o.why_now)})` : ""}`)
  const prio = [base.priority, ...others.map(o => o.priority)].filter((p): p is NonNullable<typeof p> => !!p).sort((a, b) => PRIO[a] - PRIO[b])[0] || base.priority
  return {
    title: (title || "").trim().slice(0, 200) || base.title,
    keywords: [...kw.values()].sort((a, b) => (b.impressions || 0) - (a.impressions || 0)).slice(0, 60),
    sources: [...src.values()].slice(0, 40),
    regions: [...new Set([...(base.regions || []), ...others.flatMap(o => o.regions || [])])].slice(0, 12),
    related_pages: pages.slice(0, 30),
    why_now: `${base.why_now || ""}${others.length ? `\n\nSamengevoegd: dit artikel beantwoordt ook ${also.join("; ")}.` : ""}`.trim(),
    summary: `${base.summary || ""}${others.length ? `\n\nOok in dit artikel: ${others.map(o => o.title).join("; ")}.` : ""}`.trim(),
    score: Math.max(base.score || 0, ...others.map(o => o.score || 0)),
    priority: prio,
  }
}

// Lijkt een ander idee hierop? Voor voorstellen in het idee en bij het kiezen.
const STOP = new Set(["voor", "met", "een", "het", "de", "van", "wat", "hoe", "je", "jouw", "nu", "dit", "kun", "moet", "zo", "in", "op", "en", "of", "bij", "naar", "over", "aan", "te", "is", "nog", "wel", "niet", "doen", "krijgen", "kost", "regels", "nieuwe", "2026", "2027"])
const words = (t: string) => new Set(t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w)))
export function similarity(a: Lite, b: Lite): string | null {
  if (a.id === b.id) return null
  const qa = new Set((a.keywords || []).map(k => k.query.toLowerCase())), shared = (b.keywords || []).filter(k => qa.has(k.query.toLowerCase())).length
  const wa = words(a.title), sharedWords = [...words(b.title)].filter(w => wa.has(w))
  const sameService = !!a.service && a.service === b.service
  if (shared >= 2) return `${shared} dezelfde zoekwoorden`
  if (sameService && shared === 1) return "zelfde dienst en zoekwoord"
  if (sameService && sharedWords.length >= 2) return `zelfde dienst; titel over ${sharedWords.slice(0, 2).join(" en ")}`
  if (sameService && a.impact && a.impact === b.impact && a.impact !== "overig" && a.impact !== "advies") return "zelfde dienst en soort nieuws"
  return null
}
export function suggestions(idea: Lite, all: Lite[], max = 4): { idea: Lite; why: string }[] {
  if (!canMerge(idea)) return []
  return all.filter(o => o.id !== idea.id && canMerge(o) && !o.merged_into).map(o => ({ idea: o, why: similarity(idea, o) })).filter((x): x is { idea: Lite; why: string } => !!x.why).slice(0, max)
}
