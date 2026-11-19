// Kernpagina's van groeninjestraat.nl lezen (alleen lezen) en de zinnen over regels,
// bedragen en regelingen vastleggen voor de actualiteitscontrole.

import { getSupabase } from "./guard"
import { decodeEntities } from "./audit"
import { extractFacts, type PageFacts } from "@/lib/content/freshness"

const UA = "GijsIntelligence/1.0 (+actualiteitscontrole, alleen lezen)"
const ORIGIN = "https://www.groeninjestraat.nl"

// Kopjes en omschrijving van een pagina: genoeg om te zien welk onderwerp hij behandelt (controle "staat al op de site")
function pageOutline(html: string) {
  const clean = (t: string) => decodeEntities(t.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1]
  const heads = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => clean(m[2])).filter(h => h.length > 2 && h.length < 200)
  return [desc ? clean(desc) : "", ...heads].filter(Boolean).join(". ").slice(0, 3000) || null
}

function pageText(html: string) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
  const body = (html.split(/<body[^>]*>/i)[1] || html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|li|h[1-6]|div|section|td|br)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
  return { title: title ? decodeEntities(title.replace(/<[^>]+>/g, "")).trim() : null, outline: pageOutline(html), text: decodeEntities(body).replace(/\s+/g, " ").replace(/(\.\s*){2,}/g, ". ").trim() }
}

async function fetchPage(path: string) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 9000)
  try {
    const res = await fetch(`${ORIGIN}${path}`, { signal: ctrl.signal, cache: "no-store", headers: { "User-Agent": UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return pageText(await res.text())
  } finally { clearTimeout(t) }
}

// Welke pagina's: alle maatregel-, artikel- en losse pagina's, plus één voorbeeld per regiosjabloon
// (provincie, gemeente, plaats). Wat in een sjabloon staat, staat op alle pagina's van dat type.
export async function refreshPageFacts(force = false) {
  const sb = getSupabase()
  const { data: last } = await sb.from("seo_page_facts").select("checked_at").order("checked_at", { ascending: false }).limit(1).maybeSingle()
  if (!force && last && Date.now() - new Date(last.checked_at).getTime() < 20 * 3600e3) return { overgeslagen: true }

  const { data: pages } = await sb.from("seo_pages").select("path, page_type, imp_28d, http_status").eq("in_sitemap", true)
  const ok = (pages || []).filter(p => !(p.http_status && p.http_status >= 400))
  const core = ok.filter(p => ["home", "maatregel", "artikel", "overig"].includes(p.page_type)).map(p => ({ path: p.path, template: null as string | null }))
  const TEMPLATE: Record<string, string> = { provincie: "alle provinciepagina's", gemeente: "alle gemeentepagina's", plaats: "alle plaats- en wijkpagina's" }
  for (const type of ["provincie", "gemeente", "plaats"]) {
    const best = ok.filter(p => p.page_type === type).sort((a, b) => (b.imp_28d || 0) - (a.imp_28d || 0))[0]
    if (best) core.push({ path: best.path, template: TEMPLATE[type] })
  }
  const list = core.slice(0, 40)
  const rows: any[] = []
  let failed = 0
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(list.slice(i, i + 5).map(async p => {
      try {
        const { title, text, outline } = await fetchPage(p.path)
        rows.push({ path: p.path, checked_at: new Date().toISOString(), title, outline, template: p.template, facts: extractFacts(text), error: null })
      } catch (e: any) {
        failed++
        rows.push({ path: p.path, checked_at: new Date().toISOString(), title: null, outline: null, template: p.template, facts: [], error: e?.name === "AbortError" ? "time-out" : e?.message || "mislukt" })
      }
    }))
  }
  if (rows.length) { const { error } = await sb.from("seo_page_facts").upsert(rows); if (error) throw new Error(error.message) }
  return { gelezen: rows.length - failed, mislukt: failed, zinnen: rows.reduce((s, r) => s + r.facts.length, 0) }
}

export async function readPageFacts(): Promise<(PageFacts & { outline: string | null })[]> {
  const { data } = await getSupabase().from("seo_page_facts").select("path, title, template, facts, outline").is("error", null)
  return (data || []) as (PageFacts & { outline: string | null })[]
}
