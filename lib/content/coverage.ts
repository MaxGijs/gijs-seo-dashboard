// "Staat dit al op de site?" Geen AI: een uitlegbare vergelijking van woorden en getallen.
//
// Het dashboard kent drie soorten bestaande inhoud:
// 1. artikelen die via het dashboard zijn gepubliceerd (titel, samenvatting en de nieuwsberichten erachter),
// 2. de pagina's die de nachtelijke scan van groeninjestraat.nl leest (titel, kopjes en omschrijving),
// 3. kansen die een medewerker afwees met "staat al op de site" (die tekst staat dus al ergens).
//
// Twee uitkomsten:
// - "zelfde-nieuws": hetzelfde bericht via een andere bron (binnen 7 dagen, zelfde dienst, minstens drie
//   gedeelde kenmerken, of twee met een vrijwel gelijk getal zoals ongeveer 430.000). Geen nieuwe kans.
// - "onderwerp": de site behandelt dit onderwerp al (minstens drie gedeelde kenmerken). Advies wordt
//   "bestaande pagina bijwerken" in plaats van een nieuw artikel.

import { SERVICE_TERMS, type ContentIdea, type SourceRef } from "./model"
import { isGeneric, noteOf, REASONS } from "./feedback"

export interface CoverDoc {
  id: string
  kind: "artikel" | "pagina" | "afgewezen"
  path: string | null
  title: string
  text: string
  service: string | null
  newsDate: string | null       // datum van het nieuws achter een artikel (voor "zelfde nieuws")
}

export interface Coverage {
  strength: "zelfde-nieuws" | "onderwerp"
  id: string
  kind: CoverDoc["kind"]
  path: string | null
  title: string
  shared: string[]
}

const SITE = /^https?:\/\/(www\.)?groeninjestraat\.nl/i
const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
// Stam: twee keer verbuiging eraf ("huishoudens" en "huishouden" vallen samen), en "verdubbeld"/"verdubbelt" ook
const stem1 = (w: string) => w.replace(/(ingen|heden|en|es|s|e)$/, "")
export const coverStem = (w: string) => {
  let s = stem1(stem1(w))
  if (s.length > 7 && s.startsWith("ge")) s = s.slice(2)          // "geschrapt" en "schrapt" vallen samen
  if (s.length > 6 && /[dt]$/.test(s)) s = s.slice(0, -1)          // "verdubbeld" en "verdubbelt"
  return s
}

// Woorden die niets over het onderwerp zeggen, naast de algemene lijst uit de feedback-lessen
const STOP = new Set(["waarom", "welke", "worden", "hebben", "kunnen", "zullen", "moeten", "blijft", "blijkt", "staat", "steeds", "onder", "boven", "tegen",
  "zoals", "jouw", "jullie", "eigen", "betekent", "betekenen", "weten", "vragen", "vraag", "antwoord", "artikel", "nieuws", "gijs", "kennis", "uitleg",
  "veelgestelde", "dit", "deze", "wordt", "werden", "gaat", "gaan", "komt", "komen", "maakt", "maken", "geeft", "laatste", "volgende", "jaren", "maanden",
  "januari", "februari", "maart", "april", "augustus", "september", "oktober", "november", "december", "procent", "miljoen", "miljard", "aantal", "stuks"].map(coverStem))

// Distinctieve kenmerken van een tekst: woordstammen (5+ letters) en grote getallen
export function features(text: string, service: string | null) {
  const t = norm(text)
  const own = service ? SERVICE_TERMS[service] || [service] : []
  const stems = new Map<string, string>()      // stam → het woord zoals het er staat
  for (const w of t.match(/[a-z]{5,}/g) || []) {
    if (own.some(x => w.includes(x.replace(/\s+/g, ""))) || isGeneric(w)) continue
    const s = coverStem(w)
    if (s.length < 5 || STOP.has(s) || stems.has(s)) continue
    stems.set(s, w)
  }
  // 430.000, 225.000 stuks, 1,2 miljoen: getallen vanaf 1.000
  const nums: number[] = []
  for (const m of t.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{4,})(?!\d)|(\d+(?:,\d+)?)\s*miljoen/g)) {
    const n = m[1] ? Number(m[1].replace(/\./g, "")) : Number(m[2].replace(",", ".")) * 1e6
    if (n >= 1000 && !(n >= 1990 && n <= 2100)) nums.push(n)
  }
  return { stems, nums }
}

function shared(a: ReturnType<typeof features>, b: ReturnType<typeof features>) {
  const out = [...a.stems].filter(([s]) => b.stems.has(s)).map(([, w]) => w)
  // Getallen binnen 5% van elkaar tellen als hetzelfde ("425.000" en "bijna 430.000")
  for (const n of a.nums) {
    const m = b.nums.find(x => Math.abs(x - n) / Math.max(x, n) <= 0.05)
    if (m !== undefined && !out.includes(`~${m.toLocaleString("nl-NL")}`)) out.push(`~${m.toLocaleString("nl-NL")}`)
  }
  return out
}

export const toPath = (u: string | null | undefined) => {
  if (!u) return null
  const p = u.trim().replace(SITE, "").replace(/[?#].*$/, "").replace(/\/$/, "")
  return p.startsWith("/") ? p : null
}
// "Staat al op de site: /kennis/…" of een volledige URL in een toelichting
export function pathFromNote(note: string | null | undefined) {
  if (!note) return null
  const m = note.match(/(?:https?:\/\/(?:www\.)?groeninjestraat\.nl)?(\/[a-z0-9][a-z0-9\-/]*)/i)
  return m ? toPath(m[1]) : null
}

type IdeaLike = Pick<ContentIdea, "id" | "title" | "status" | "origin" | "service"> & Partial<Pick<ContentIdea, "summary" | "why_now" | "sources" | "published_url" | "published_at" | "target_page" | "feedback" | "decision_note" | "created_at" | "advice">>
export interface PageLike { path: string; title: string | null; outline?: string | null; template?: string | null }

const serviceOfPath = (path: string) => { const m = path.match(/^\/maatregelen\/([^/]+)/); return m ? m[1] : null }
const serviceOfText = (text: string) => {
  const t = norm(text)
  const hits = Object.entries(SERVICE_TERMS).filter(([, terms]) => terms.some(x => t.includes(x)))
  return hits.length === 1 ? hits[0][0] : null
}
const newsDateOf = (srcs: SourceRef[] | undefined, fallback?: string) => {
  const ds = (srcs || []).map(s => s.date).filter(Boolean) as string[]
  return ds.length ? ds.sort().slice(-1)[0] : fallback || null
}

// Alle bestaande inhoud waarmee een nieuwe kans vergeleken wordt
export function coverDocs(ideas: IdeaLike[], pages: PageLike[]): CoverDoc[] {
  const docs: CoverDoc[] = []
  for (const i of ideas) {
    const text = `${i.title} ${i.summary || ""} ${i.why_now || ""} ${(i.sources || []).map(s => s.title).join(" ")}`
    if (i.status === "gepubliceerd") {
      // Een bijgewerkte bestaande pagina telt als die pagina; een nieuw artikel als het artikel
      docs.push({ id: i.id, kind: "artikel", path: toPath(i.published_url) || i.target_page || null, title: i.title, text, service: i.service, newsDate: newsDateOf(i.sources, i.published_at || i.created_at) })
    } else if (i.status === "afgewezen") {
      const note = noteOf(i as any)
      if (!note || !REASONS.dubbel.pattern.test(note)) continue
      docs.push({ id: i.id, kind: "afgewezen", path: pathFromNote(note), title: i.title, text, service: i.service, newsDate: newsDateOf(i.sources, i.created_at) })
    }
  }
  for (const p of pages) {
    if (p.template || !p.title || p.path === "/" ) continue
    const text = `${p.title.split("|")[0]} ${p.outline || ""}`
    docs.push({ id: `pagina:${p.path}`, kind: "pagina", path: p.path, title: p.title.split("|")[0].trim(), text, service: serviceOfPath(p.path) || serviceOfText(p.title), newsDate: null })
  }
  return docs
}

const DAY = 864e5

// Staat deze nieuwe kans (al) op de site? Sterkste overeenkomst wint; zelfde nieuws gaat voor onderwerp.
export function coverageFor(d: { id?: string; subject: string; summary?: string | null; whyNow?: string | null; sourceTitles?: string[]; service: string | null; date?: string | null }, docs: CoverDoc[]): Coverage | null {
  if (!d.service) return null
  const mine = features(`${d.subject} ${d.summary || ""} ${d.whyNow || ""} ${(d.sourceTitles || []).join(" ")}`, d.service)
  let best: (Coverage & { n: number }) | null = null
  for (const doc of docs) {
    if (doc.id === d.id) continue
    if (doc.service !== d.service) continue
    // De hoofdpagina van een dienst (/maatregelen/thuisbatterij) dekt het onderwerp altijd in het algemeen;
    // daar zorgt het bestaande advies al voor ("link naar de dienstpagina")
    if (doc.kind === "pagina" && doc.path && /^\/maatregelen\/[^/]+$/.test(doc.path)) continue
    const sh = shared(mine, features(doc.text, d.service))
    const close = doc.newsDate && d.date ? Math.abs(new Date(doc.newsDate).getTime() - new Date(d.date).getTime()) <= 7 * DAY : false
    // Zelfde nieuws: drie gedeelde kenmerken, of twee als er een (vrijwel) gelijk getal bij zit
    const sameNews = doc.kind !== "pagina" && close && (sh.length >= 3 || (sh.length >= 2 && sh.some(x => x.startsWith("~"))))
    const strength: Coverage["strength"] | null = sameNews ? "zelfde-nieuws" : sh.length >= 3 ? "onderwerp" : null
    if (!strength) continue
    const rank = (strength === "zelfde-nieuws" ? 100 : 0) + sh.length
    if (!best || rank > best.n) best = { strength, id: doc.id, kind: doc.kind, path: doc.path, title: doc.title, shared: sh.slice(0, 6), n: rank }
  }
  if (!best) return null
  const { n: _n, ...cov } = best
  return cov
}

export function coverageText(c: Coverage) {
  const where = c.path ? ` (${c.path})` : ""
  const what = c.kind === "artikel" ? `het artikel "${c.title}"${where}` : c.kind === "pagina" ? `de pagina "${c.title}"${where}` : `"${c.title}", eerder afgewezen omdat het al op de site staat${where}`
  return c.strength === "zelfde-nieuws"
    ? `Hetzelfde nieuws staat al op de site in ${what}. Gedeeld: ${c.shared.join(", ")}.`
    : `Dit onderwerp staat al op de site in ${what}. Gedeeld: ${c.shared.join(", ")}.`
}
