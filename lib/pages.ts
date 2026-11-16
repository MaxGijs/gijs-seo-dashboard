// Pagina-inventaris: type, regio, fase en status per URL van groeninjestraat.nl.
// Pure functies — gebruikt door de server (sync) én de interface (pagina-audit, paneel).

import type { Priority } from "./types"

export type PageType = "home" | "overzicht" | "provincie" | "gemeente" | "plaats" | "maatregel" | "artikel" | "overig"

export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  home: "Homepage", overzicht: "Regio-overzicht", provincie: "Provinciepagina", gemeente: "Gemeentepagina",
  plaats: "Plaats- of wijkpagina", maatregel: "Maatregelpagina", artikel: "Artikel of blog", overig: "Overige pagina",
}

// Lanceringsdatums per provincie (opgegeven door Max, 16 nov 2026).
export const LAUNCH_DATES: Record<string, string> = {
  overijssel: "2026-10-13",
  gelderland: "2026-10-28",
  utrecht: "2026-11-09",
  flevoland: "2026-11-09",
}

// Zo lang beoordelen we een pagina niet op prestaties, alleen op de basis (indexering, links, inhoud).
export const OPBOUW_DAGEN = 56

const PARTICLES = new Set(["van", "de", "den", "der", "aan", "op", "het", "in", "bij", "ter", "te"])
export function prettySlug(slug: string) {
  return slug.split("-").map((w, i) => (i > 0 && PARTICLES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ")
}

export const ARTICLE_SECTIONS = new Set(["blog", "blogs", "nieuws", "artikelen", "artikel", "kennis", "kennisbank", "actueel", "inspiratie", "verhalen"])

export function classifyPath(path: string): { type: PageType; provincie: string | null; gemeente: string | null; plaats: string | null } {
  const parts = path.split("/").filter(Boolean)
  if (parts.length === 0) return { type: "home", provincie: null, gemeente: null, plaats: null }
  if (parts[0] === "maatregelen") return { type: "maatregel", provincie: null, gemeente: null, plaats: null }
  // Blogs, nieuws en kennisartikelen (de site heeft nog geen vaste sectie; deze paden worden herkend zodra ze er zijn)
  if (ARTICLE_SECTIONS.has(parts[0]) && parts.length >= 2) return { type: "artikel", provincie: null, gemeente: null, plaats: null }
  if (parts[0] === "regio") {
    if (parts.length === 1) return { type: "overzicht", provincie: null, gemeente: null, plaats: null }
    const provincie = parts[1]
    if (parts.length === 2) return { type: "provincie", provincie, gemeente: null, plaats: null }
    if (parts.length === 3) return { type: "gemeente", provincie, gemeente: parts[2], plaats: null }
    return { type: "plaats", provincie, gemeente: parts[2], plaats: parts[parts.length - 1] }
  }
  return { type: "overig", provincie: null, gemeente: null, plaats: null }
}

export interface PageRow {
  path: string
  url: string
  page_type: PageType
  provincie: string | null
  gemeente: string | null
  plaats: string | null
  in_sitemap: boolean
  launch_date: string | null
  first_seen: string | null
  imp_28d: number
  clicks_28d: number
  position_28d: number | null
  imp_prev_28d: number
  index_verdict: string | null
  coverage_state: string | null
  indexing_state: string | null
  page_fetch_state: string | null
  robots_state: string | null
  google_canonical: string | null
  user_canonical: string | null
  last_crawl_time: string | null
  inspected_at: string | null
  inspect_error: string | null
  http_status?: number | null
  http_final_path?: string | null
  http_checked_at?: string | null
}

export type PageStatus =
  | "technisch" | "niet-geindexeerd" | "geen-vertoningen" | "top" | "pagina1" | "groeikans" | "ver"
  | "doorverwezen" | "buiten-sitemap" | "ongecontroleerd"

export const PAGE_STATUS_META: Record<PageStatus, { label: string; tone: "error" | "warning" | "neutral" | "success" | "accent" | "info" }> = {
  technisch: { label: "Technisch probleem", tone: "error" },
  "niet-geindexeerd": { label: "Niet geïndexeerd", tone: "warning" },
  "geen-vertoningen": { label: "Geen vertoningen", tone: "neutral" },
  top: { label: "Top 3", tone: "success" },
  pagina1: { label: "Pagina 1", tone: "success" },
  groeikans: { label: "Groeikans", tone: "accent" },
  ver: { label: "Ver van pagina 1", tone: "neutral" },
  doorverwezen: { label: "Doorverwezen", tone: "info" },
  "buiten-sitemap": { label: "Niet in sitemap", tone: "info" },
  ongecontroleerd: { label: "Nog niet gecontroleerd", tone: "neutral" },
}

const COVERAGE_NL: Record<string, string> = {
  "Submitted and indexed": "Ingediend en geïndexeerd",
  "Indexed, not submitted in sitemap": "Geïndexeerd, niet in sitemap",
  "Discovered - currently not indexed": "Ontdekt, nog niet geïndexeerd",
  "Crawled - currently not indexed": "Gecrawld, niet geïndexeerd",
  "URL is unknown to Google": "Onbekend bij Google",
  "Page with redirect": "Pagina met doorverwijzing",
  "Excluded by ‘noindex’ tag": "Uitgesloten door noindex",
  "Excluded by 'noindex' tag": "Uitgesloten door noindex",
  "Not found (404)": "Niet gevonden (404)",
  "Soft 404": "Soft 404 (lijkt leeg of foutpagina)",
  "Duplicate, Google chose different canonical than user": "Duplicaat: Google koos een andere canonical",
  "Duplicate without user-selected canonical": "Duplicaat zonder eigen canonical",
  "Alternate page with proper canonical tag": "Alternatieve pagina met canonical",
  "Blocked by robots.txt": "Geblokkeerd door robots.txt",
  "Server error (5xx)": "Serverfout (5xx)",
}
// Google geeft de status in de taal van het verzoek (nl-NL) terug; we herkennen beide talen.
export const isRedirectState = (s: string | null) => !!s && /redirect|doorverw|doorgestuurd|omleiding/i.test(s)
export const isCrawledNotIndexed = (s: string | null) => !!s && /crawled|gecrawld/i.test(s)

export function coverageNl(state: string | null) {
  if (!state) return null
  return COVERAGE_NL[state] || state
}

const FETCH_PROBLEMS: Record<string, string> = {
  SOFT_404: "Google ziet de pagina als lege of foutpagina (soft 404)",
  NOT_FOUND: "De pagina geeft een 404",
  SERVER_ERROR: "Serverfout bij het ophalen",
  REDIRECT_ERROR: "Fout in de doorverwijzing",
  ACCESS_DENIED: "Toegang geweigerd voor Google",
  ACCESS_FORBIDDEN: "Toegang verboden voor Google",
  BLOCKED_4XX: "De pagina geeft een 4xx-fout",
  BLOCKED_ROBOTS_TXT: "Geblokkeerd door robots.txt",
  INTERNAL_CRAWL_ERROR: "Interne crawlfout bij Google",
  INVALID_URL: "Ongeldige URL",
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function ageDays(p: Pick<PageRow, "launch_date" | "first_seen">, now = todayIso()) {
  const start = p.launch_date || p.first_seen
  if (!start) return null
  return Math.round((new Date(`${now}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86400000)
}

export function phaseOf(p: Pick<PageRow, "launch_date" | "first_seen">): "opbouw" | "volwassen" | "onbekend" {
  const a = ageDays(p)
  if (a === null) return "onbekend"
  return a < OPBOUW_DAGEN ? "opbouw" : "volwassen"
}

function samePath(a: string | null, b: string) {
  if (!a) return true
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").replace(/\/$/, "") || "/"
  return norm(a) === norm(b)
}

export interface PageAssessment {
  status: PageStatus
  priority: Priority
  monitor: boolean          // alleen volgen, (nog) geen verbeteradvies
  reason: string            // waarom deze status, met de gegevens
  next: string              // concrete volgende stap of "niets doen"
}

export function assessPage(p: PageRow): PageAssessment {
  const phase = phaseOf(p)
  const age = ageDays(p)
  const opbouw = phase === "opbouw"
  const pos = p.position_28d !== null ? Number(p.position_28d) : null
  const fetchProblem = p.page_fetch_state && p.page_fetch_state !== "SUCCESSFUL" ? FETCH_PROBLEMS[p.page_fetch_state] : null
  const noindex = p.indexing_state === "BLOCKED_BY_META_TAG" || p.indexing_state === "BLOCKED_BY_HTTP_HEADER"
  const robotsBlocked = p.robots_state === "DISALLOWED"
  const canonicalElsewhere = p.google_canonical && !samePath(p.google_canonical, p.path)

  if (!p.in_sitemap) {
    if (isRedirectState(p.coverage_state) || p.page_fetch_state === "REDIRECT_ERROR") {
      return { status: "doorverwezen", priority: "laag", monitor: true, reason: "Deze oude URL verwijst door. Search Console toont hem nog enkele weken.", next: "Niets doen; verdwijnt vanzelf." }
    }
    return {
      status: "buiten-sitemap", priority: p.imp_28d >= 50 ? "middel" : "laag", monitor: p.imp_28d < 50,
      reason: `Google toont deze URL (${p.imp_28d} vertoningen in 28 dagen), maar hij staat niet in de sitemap.`,
      next: "Controleer of deze pagina bewust buiten de sitemap valt of moet doorverwijzen naar een nieuwe pagina.",
    }
  }

  // Live controle gaat voor: een pagina die nu een fout geeft, kan niet ranken — ook als Google hem nog niet gecrawld heeft.
  if (p.http_status && p.http_status >= 400) {
    const parent = p.path.split("/").slice(0, -1).join("/") || "/"
    return {
      status: "technisch", priority: "hoog", monitor: false,
      reason: `De pagina geeft nu een ${p.http_status}${p.http_status === 404 ? " (bestaat niet)" : ""}, maar staat wel in de sitemap. Google stuit hier op een foutpagina.`,
      next: p.page_type === "plaats" && p.plaats === p.gemeente
        ? `Haal deze URL uit de sitemap of verwijs door (301) naar de gemeentepagina ${parent}.`
        : "Haal de URL uit de sitemap of herstel de pagina.",
    }
  }
  if (p.http_final_path && p.http_final_path !== p.path) {
    return {
      status: "technisch", priority: "middel", monitor: false,
      reason: `Deze URL staat in de sitemap, maar verwijst door naar ${p.http_final_path}.`,
      next: `Zet ${p.http_final_path} in de sitemap in plaats van deze URL.`,
    }
  }

  if (fetchProblem || noindex || robotsBlocked) {
    const why = fetchProblem || (noindex ? "De pagina heeft een noindex-instelling" : "robots.txt blokkeert de pagina")
    return { status: "technisch", priority: "hoog", monitor: false, reason: `${why}. Zolang dit zo is, kan de pagina niet ranken.`, next: "Laat dit oplossen door wie de site beheert; daarna opnieuw controleren." }
  }
  if (canonicalElsewhere) {
    return {
      status: "technisch", priority: p.page_type === "plaats" ? "middel" : "hoog", monitor: false,
      reason: `Google kiest ${p.google_canonical!.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "")} als hoofdversie in plaats van deze pagina. Meestal omdat de inhoud te veel lijkt op die andere pagina.`,
      next: "Maak de inhoud duidelijk uniek (lokale informatie) of verwijs bewust door naar de andere pagina.",
    }
  }

  const inspected = Boolean(p.inspected_at && !p.inspect_error)
  const indexed = p.index_verdict === "PASS"
  if (inspected && !indexed) {
    const state = coverageNl(p.coverage_state) || "Niet geïndexeerd"
    if (opbouw) {
      const late = (age ?? 0) >= 28 && !isCrawledNotIndexed(p.coverage_state)
      return {
        status: "niet-geindexeerd", priority: late ? "middel" : "laag", monitor: !late,
        reason: `${state}. De pagina staat ${age} dagen live; voor een nieuwe pagina is dat ${late ? "lang" : "normaal"}.`,
        next: late ? "Controleer of de pagina interne links krijgt vanaf de provincie- en gemeentepagina." : "Monitoren. Zorg dat er interne links naar de pagina gaan.",
      }
    }
    return {
      status: "niet-geindexeerd", priority: "hoog", monitor: false,
      reason: `${state}, terwijl de pagina al ${age ?? "?"} dagen bestaat.`,
      next: isCrawledNotIndexed(p.coverage_state)
        ? "Google vond de pagina niet waardevol genoeg: voeg unieke lokale inhoud toe of voeg samen met een verwante pagina."
        : "Versterk interne links naar deze pagina en vraag indexering aan in Search Console.",
    }
  }

  if (p.imp_28d === 0) {
    if (!inspected) {
      return { status: "ongecontroleerd", priority: "laag", monitor: true, reason: "Nog geen indexeringscontrole uitgevoerd en geen vertoningen in 28 dagen.", next: "Wordt meegenomen in de volgende indexeringscontrole." }
    }
    return opbouw
      ? { status: "geen-vertoningen", priority: "laag", monitor: true, reason: `Geïndexeerd, nog geen vertoningen. Normaal voor een pagina die ${age} dagen live staat.`, next: "Monitoren tot de opbouwfase voorbij is." }
      : { status: "geen-vertoningen", priority: "middel", monitor: false, reason: "Geïndexeerd, maar in 28 dagen nergens vertoond. Mogelijk is er weinig zoekvraag of mist de pagina een duidelijk eigen onderwerp.", next: "Onderzoek of de pagina een eigen zoekvraag bedient; zo niet, overweeg samenvoegen met de bovenliggende pagina." }
  }

  if (pos !== null && pos <= 3) return { status: "top", priority: "laag", monitor: true, reason: `Gemiddeld positie ${pos.toFixed(1).replace(".", ",")}.`, next: "Beschermen; let op de doorklik." }
  if (pos !== null && pos <= 10) return { status: "pagina1", priority: p.imp_28d >= 50 ? "middel" : "laag", monitor: p.imp_28d < 50, reason: `Op pagina 1 (positie ${pos.toFixed(1).replace(".", ",")}), ${p.imp_28d} vertoningen.`, next: "Richting top 3: versterk interne links en de title." }
  if (pos !== null && pos <= 20) return { status: "groeikans", priority: p.imp_28d >= 40 ? "hoog" : "middel", monitor: false, reason: `Net buiten pagina 1 (positie ${pos.toFixed(1).replace(".", ",")}), ${p.imp_28d} vertoningen.`, next: "Open de diagnose voor concrete stappen." }
  return {
    status: "ver", priority: opbouw ? "laag" : "middel", monitor: opbouw,
    reason: `Gemiddeld positie ${pos?.toFixed(1).replace(".", ",") ?? "?"}, ${p.imp_28d} vertoningen.${opbouw ? " In de opbouwfase is dat normaal." : ""}`,
    next: opbouw ? "Monitoren tot de opbouwfase voorbij is." : "Onderzoek welke zoekwoorden de pagina binnenhaalt en of de inhoud daarop aansluit.",
  }
}
