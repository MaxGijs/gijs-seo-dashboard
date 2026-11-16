// Lichte, alleen-lezende pagina-check van groeninjestraat.nl. Haalt de server-HTML op
// (dezelfde HTML die Google als eerste ziet) en leest de onderdelen die voor een
// zoekwoord het meest uitmaken. Wijzigt niets aan de site.

export interface PageAudit {
  url: string
  ok: boolean
  status?: number
  error?: string
  finalUrl?: string
  title?: string
  metaDescription?: string
  h1: string[]
  h2: string[]
  wordCount: number
  internalLinks: number
  canonical?: string
  noindex: boolean
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", eacute: "é", euml: "ë", iuml: "ï",
}

export function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

function stripTags(s: string) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function parseAttrs(tag: string) {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "")
  return attrs
}

export function parseHtml(html: string, url: string): Omit<PageAudit, "ok" | "status" | "error" | "finalUrl"> {
  const head = html.split(/<\/head>/i)[0] || html
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]

  let metaDescription: string | undefined
  let noindex = false
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag)
    const name = (a.name || a.property || "").toLowerCase()
    if (name === "description" && metaDescription === undefined) metaDescription = a.content
    if ((name === "robots" || name === "googlebot") && /noindex/i.test(a.content || "")) noindex = true
  }

  let canonical: string | undefined
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag)
    if ((a.rel || "").toLowerCase() === "canonical") { canonical = a.href; break }
  }

  const bodyHtml = (html.split(/<body[^>]*>/i)[1] || html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")

  const h1 = [...bodyHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => stripTags(m[1])).filter(Boolean)
  const h2 = [...bodyHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => stripTags(m[1])).filter(Boolean)

  // Navigatie en footer tellen we niet mee als inhoud
  const mainHtml = bodyHtml.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ")
  const text = stripTags(mainHtml)
  const wordCount = text ? text.split(" ").filter(w => /[a-zà-ÿ0-9]/i.test(w)).length : 0

  let internalLinks = 0
  for (const tag of bodyHtml.match(/<a\b[^>]*>/gi) || []) {
    const href = parseAttrs(tag).href || ""
    if (/^\/(?!\/)/.test(href) || /^https?:\/\/(www\.)?groeninjestraat\.nl/i.test(href)) internalLinks++
  }

  return {
    url,
    title: title ? stripTags(title) : undefined,
    metaDescription: metaDescription?.trim() || undefined,
    h1, h2, wordCount, internalLinks, canonical, noindex,
  }
}

export async function auditPage(url: string): Promise<PageAudit> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "GijsSEODashboard/1.0 (+pagina-check, alleen lezen)" },
      cache: "no-store",
    })
    const html = await res.text()
    if (!res.ok) return { url, ok: false, status: res.status, error: `HTTP ${res.status}`, h1: [], h2: [], wordCount: 0, internalLinks: 0, noindex: false }
    return { ...parseHtml(html, url), ok: true, status: res.status, finalUrl: res.url }
  } catch (err: any) {
    return {
      url, ok: false, error: err?.name === "AbortError" ? "Pagina reageerde niet binnen 8 seconden" : err?.message || "Ophalen mislukt",
      h1: [], h2: [], wordCount: 0, internalLinks: 0, noindex: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface RedirectCheck { path: string; status?: number; finalPath?: string; redirected: boolean; error?: string }

// Controleert of een pad (nog) bestaat of doorverwijst — zonder iets te wijzigen.
export async function checkRedirect(url: string, toPath: (u: string) => string): Promise<RedirectCheck> {
  const path = toPath(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", cache: "no-store", headers: { "User-Agent": "GijsSEODashboard/1.0 (+pagina-check, alleen lezen)" } })
    try { await res.body?.cancel() } catch {}
    const finalPath = toPath(res.url || url)
    return { path, status: res.status, finalPath, redirected: finalPath !== path }
  } catch (err: any) {
    return { path, redirected: false, error: err?.message || "Ophalen mislukt" }
  } finally {
    clearTimeout(timer)
  }
}
