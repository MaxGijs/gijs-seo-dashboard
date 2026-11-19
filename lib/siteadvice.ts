// Siteadvies: het dashboard als adviseur voor de hele site, niet per losse pagina.
// Rekent automatisch (geen AI) met vaste, uitlegbare regels over alle data die er al is:
// open adviezen, metingen en lessen, de pagina-inventaris (indexering, regio, opbouw),
// zoekwoorden per dienst, GA4 en de contentkansen. Elk advies noemt zijn cijfers.

import type { GscRow, Task } from "./types"
import type { Lesson } from "./learning"
import { actionOf, pageGroup } from "./learning"
import { ageDays, classifyPath, LAUNCH_DATES, OPBOUW_DAGEN, prettySlug, type PageRow } from "./pages"
import { ROUTE_LABEL, ROUTE_ORDER, type Route, type RouteTry } from "./routes"
import { columnOf } from "./workflow"
import { gainFromMove, type CtrModel } from "./ctr"
import { servicesIn, SERVICE_TERMS, SCAN_SERVICE, serviceLabel, type ContentIdea } from "./content/model"
import { placeIn, regionSegments } from "./intent"

export type AdviceKind = "groep" | "route-uitrollen" | "route-stoppen" | "regio" | "indexering" | "dienst" | "conversie"
export type Confidence = "laag" | "middel" | "hoog"

export interface SiteAdvice {
  key: string
  kind: AdviceKind
  title: string
  summary: string
  evidence: string[]
  steps: string[]
  gain: number | null            // indicatieve extra klikken per 28 dagen
  gainNote?: string              // aanname achter de schatting
  confidence: Confidence
  confidenceWhy: string
  pages: { path: string; note?: string }[]
  taskKeys: string[]
  ideaIds: string[]
  pageGains?: Record<string, number>   // winst per pagina (om opnieuw op te tellen als pagina's afvallen)
}

export interface SiteAdviceInput {
  tasks: Task[]
  inventory: PageRow[]
  lessons: Lesson[]
  tries: RouteTry[]
  keywords: GscRow[]
  ctrModel: CtrModel | null
  ga4Pages: { path: string; sessions: number; keyEvents: number }[] | null
  ideas?: ContentIdea[] | null
  today?: string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)   // "Title en H1 aanpassen" → "title en H1 aanpassen"
const nl1 = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",")
const nlNum = (n: number) => Math.round(n).toLocaleString("nl-NL")
const pct = (r: number) => `${Math.round(r * 100)}%`
const PROV = (p: string) => prettySlug(p)
const daysSince = (iso: string, today: string) => Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(iso + "T12:00:00Z")) / 86400000)
const wPos = (rows: { imp: number; pos: number | null }[]) => {
  const r = rows.filter(x => x.pos && x.imp > 0)
  const imp = r.reduce((s, x) => s + x.imp, 0)
  return imp ? r.reduce((s, x) => s + x.pos! * x.imp, 0) / imp : null
}

// Groep van een pagina zoals een mens erover praat
function groupOf(path: string): { key: string; label: string; prov: string | null; type: string } | null {
  const c = classifyPath(path)
  if ((c.type === "gemeente" || c.type === "plaats") && c.provincie) return { key: `lokaal|${c.provincie}`, label: `lokale pagina's in ${PROV(c.provincie)}`, prov: c.provincie, type: "lokaal" }
  if (c.type === "maatregel") return { key: "maatregel", label: "maatregelpagina's", prov: null, type: "maatregel" }
  if (c.type === "provincie") return { key: "provincie", label: "provinciepagina's", prov: null, type: "regio-overzicht" }
  return null
}

// Lokale pagina bij een plaats uit een zoekwoord (zoals de rest van het dashboard: plaats → /regio/…/plaats)
function placeIndex(inventory: PageRow[]) {
  const regions = regionSegments(inventory.map(p => p.path))
  const byPlace = new Map<string, string>()
  for (const p of inventory) {
    const c = classifyPath(p.path)
    if (c.type !== "gemeente" && c.type !== "plaats") continue
    const seg = p.path.split("/").filter(Boolean).pop()!
    if (!byPlace.has(seg) || c.type === "plaats") byPlace.set(seg, p.path)
  }
  return { regions, pageFor: (place: string | null | undefined) => (place ? byPlace.get(place) || null : null) }
}

// Lanceringsdatum van een provincie: de vroegste van de pagina's, anders de vaste lijst
function provLaunch(prov: string, rows: PageRow[]) {
  const d = rows.map(r => r.launch_date).filter(Boolean).sort()[0]
  return d || LAUNCH_DATES[prov] || null
}
const inOpbouw = (p: Pick<PageRow, "launch_date" | "first_seen">, today: string) => { const a = ageDays(p, today); return a !== null && a < OPBOUW_DAGEN }

const KIND_GROUP: Record<string, "kans" | "ctr" | "daler" | undefined> = { kans: "kans", ctr: "ctr", daler: "daler", "trend-dalend": "daler" }
const OPEN = new Set(["beoordelen", "gepland"])

// Welke route adviseren we voor een groep? Bewezen route uit de lessen, anders de eerste die er niet faalde.
function routeFor(type: string, pages: string[], lessons: Lesson[], tries: RouteTry[]): { route: Route; why: string } {
  const proven = lessons
    .filter(l => l.status === "actief" && l.source === "meting" && l.effect?.type === "prioriteit" && (l.effect.factor || 1) > 1 && l.effect.match?.action && (!l.effect.match.pageType || l.effect.match.pageType === type))
    .sort((a, b) => (b.effect!.factor || 1) - (a.effect!.factor || 1))[0]
  const set = new Set(pages)
  const failed = (r: string) => tries.filter(t => t.route === r && t.page && set.has(t.page) && t.outcome === "niet_succesvol").length
  if (proven && ROUTE_ORDER.includes(proven.effect!.match!.action as Route) && failed(proven.effect!.match!.action!) < 2)
    return { route: proven.effect!.match!.action as Route, why: `Gekozen op basis van de les "${proven.title}".` }
  const skipped = ROUTE_ORDER.filter(r => failed(r) >= 2)
  const why = skipped.length ? `${skipped.map(r => ROUTE_LABEL[r]).join(" en ")} leverde op deze pagina's al ${skipped.length === 1 ? "twee keer of vaker" : "meerdere keren"} niets op; daarom een andere aanpak.` : ""
  for (const r of ROUTE_ORDER) if (failed(r) < 2) return { route: r, why }
  return { route: "inhoud", why }
}

function routeSteps(route: Route, g: { type: string; prov: string | null }, n: number): string[] {
  const hub = g.prov ? `de provinciepagina /regio/${g.prov}` : "de bovenliggende overzichtspagina"
  if (route === "interne-links") return [
    `Link vanaf ${hub} naar elk van deze ${n} pagina's, met de plaatsnaam in de linktekst.`,
    "Zet op elke pagina 2–3 links naar buurplaatsen in dezelfde gemeente, en een link terug naar de gemeentepagina.",
    "Link vanaf de best bezochte maatregelpagina's naar deze plaatsen waar dat logisch is (bijv. \"isolatie in Borne\").",
  ]
  if (route === "inhoud") return [
    "Breid elke pagina uit met informatie die alleen voor die plaats geldt: wijken, bouwjaren van de woningen, lokale subsidies en een veelgestelde vraag uit die plaats.",
    "Gebruik één vaste opbouw voor alle pagina's in de groep, zodat het snel gaat en de meting eerlijk vergelijkt.",
  ]
  return [
    "Zet de plaatsnaam en het belangrijkste zoekwoord vooraan in de title en de H1 van elke pagina.",
    "Gebruik één sjabloon voor de hele groep, zodat duidelijk is wat het effect is.",
  ]
}

const MEASURE = "Zet de taken op uitgevoerd zodra het staat: het dashboard meet elke pagina na 14, 28 en 56 dagen en leert welke aanpak werkt."

// 1. Patronen in de open adviezen: veel van hetzelfde op dezelfde soort pagina's
function groupAdvice(i: SiteAdviceInput): SiteAdvice[] {
  const groups = new Map<string, { kind: "kans" | "ctr" | "daler"; g: NonNullable<ReturnType<typeof groupOf>>; tasks: Task[]; pageOf: Map<string, string> }>()
  const idx = placeIndex(i.inventory)
  const pageOfTask = (t: Task) => t.signal.page || t.signal.conversions?.page || idx.pageFor(t.signal.place || (t.signal.query ? placeIn(t.signal.query, idx.regions) : null))
  for (const t of i.tasks) {
    const k = KIND_GROUP[t.signal.kind]
    const page = pageOfTask(t)
    if (!k || !page || !OPEN.has(columnOf(t.status) || "") || t.signal.resolved || t.snoozed) continue
    const g = groupOf(page)
    if (!g) continue
    const key = `${k}|${g.key}`
    const cur = groups.get(key) || { kind: k, g, tasks: [] as Task[], pageOf: new Map<string, string>() }
    cur.tasks.push(t); cur.pageOf.set(t.key, page)
    groups.set(key, cur)
  }
  const out: SiteAdvice[] = []
  for (const [key, { kind, g, tasks, pageOf }] of groups) {
    const pages = [...new Set(tasks.map(t => pageOf.get(t.key)!))]
    if (tasks.length < 4 || pages.length < 3) continue
    const imp = tasks.reduce((s, t) => s + (t.signal.metrics.impressions || 0), 0)
    const pos = wPos(tasks.map(t => ({ imp: t.signal.metrics.impressions || 0, pos: t.signal.metrics.position ?? null })))
    const clicks = tasks.reduce((s, t) => s + (t.signal.metrics.clicks || 0), 0)
    const tried = i.tries.filter(t => t.page && pages.includes(t.page))
    const evidence = [`${tasks.length} adviezen in Mijn taken op ${pages.length} pagina's, samen ${nlNum(imp)} vertoningen per 28 dagen.`]
    if (kind === "kans" && pos) evidence.push(`Gemiddelde positie ${nl1(pos)} (gewogen naar vertoningen): net buiten de eerste pagina van Google.`)
    if (kind === "ctr" && imp) evidence.push(`Gemiddeld klikt ${pct(clicks / imp)} door; voor deze posities is meer gebruikelijk.`)
    if (kind === "daler" && pos) evidence.push(`Gemiddelde positie nu ${nl1(pos)}.`)
    if (tried.length) {
      const byRoute = new Map<string, { ok: number; n: number }>()
      for (const t of tried) { const c = byRoute.get(t.route) || { ok: 0, n: 0 }; c.n++; if (t.outcome === "succesvol") c.ok++; byRoute.set(t.route, c) }
      evidence.push(`Al geprobeerd op deze pagina's: ${[...byRoute].map(([r, c]) => `${lc(ROUTE_LABEL[r] || r)} ${c.n}× (${c.ok} geslaagd)`).join(", ")}.`)
    }
    const sev = tasks.filter(t => t.signal.evidence === "sterk").length / tasks.length
    let steps: string[]
    let title: string
    if (kind === "kans") {
      const r = routeFor(g.type, pages, i.lessons, i.tries)
      title = `${tasks.length} ${g.label} staan net buiten pagina 1`
      steps = [...routeSteps(r.route, g, pages.length), MEASURE]
      if (r.why) evidence.push(r.why)
    } else if (kind === "ctr") {
      title = `${tasks.length} ${g.label} worden vaak getoond maar weinig aangeklikt`
      steps = [
        "Herschrijf title en meta-description met één sjabloon voor de hele groep: plaatsnaam vooraan, een concreet voordeel (onafhankelijk advies, energiescan) en een reden om te klikken.",
        "Controleer in Google hoe de pagina's nu getoond worden; soms kiest Google een andere tekst dan de meta-description.",
        MEASURE,
      ]
    } else {
      title = `${tasks.length} ${g.label} zakken in Google`
      steps = [
        "Controleer eerst of de pagina's nog in Google staan en of er recent iets aan veranderd is (tekst, links, doorverwijzingen).",
        "Kijk welke pagina's nu boven Gijs staan: zijn die concreter of lokaler?",
        "Pak de pagina's met de meeste vertoningen eerst aan.",
      ]
    }
    out.push({
      key: `groep|${key}`, kind: "groep", title,
      summary: "Dit zijn geen losse problemen maar één patroon. Eén aanpak voor de hele groep is sneller en beter te meten dan elke taak apart.",
      evidence, steps,
      gain: Math.round(tasks.reduce((s, t) => s + (t.signal.gain || 0), 0)) || null,
      gainNote: "Som van de geschatte winst van de afzonderlijke adviezen.",
      confidence: tasks.length >= 8 && sev >= 0.5 ? "hoog" : tasks.length >= 5 ? "middel" : "laag",
      confidenceWhy: `${tasks.length} adviezen, ${pct(sev)} met sterk bewijs.`,
      pages: pages.map(p => ({ path: p })), taskKeys: tasks.map(t => t.key), ideaIds: [],
    })
  }
  return out
}

// 2 en 3. Wat de metingen leren: een werkende route uitrollen, een niet-werkende stoppen
function routeAdvice(i: SiteAdviceInput): SiteAdvice[] {
  const out: SiteAdvice[] = []
  for (const l of i.lessons) {
    const e = l.effect
    if (l.status !== "actief" || l.source !== "meting" || e?.type !== "prioriteit" || !e.match?.action || !ROUTE_ORDER.includes(e.match.action as Route)) continue
    const route = e.match.action as Route
    const type = e.match.pageType
    const label = lc(ROUTE_LABEL[route] || route)
    const where = type === "lokaal" ? "lokale pagina's" : type === "maatregel" ? "maatregelpagina's" : type === "regio-overzicht" ? "provinciepagina's" : "deze soort pagina's"
    const ok = l.evidence.success || 0, bad = l.evidence.fail || 0
    if ((e.factor || 1) > 1 && ok >= 2) {
      const triedHere = new Set(i.tries.filter(t => t.route === route && t.page).map(t => t.page!))
      const today = i.today || new Date().toISOString().slice(0, 10)
      const cands = i.inventory.filter(p => (!type || pageGroup(p.path) === type) && !inOpbouw(p, today) && p.position_28d && p.position_28d >= 4 && p.position_28d <= 20 && p.imp_28d >= 30 && !triedHere.has(p.path))
        .sort((a, b) => b.imp_28d - a.imp_28d).slice(0, 15)
      if (cands.length < 3) continue
      const rate = l.evidence.rate ?? ok / Math.max(1, ok + bad)
      const pageGains = i.ctrModel ? Object.fromEntries(cands.map(p => [p.path, gainFromMove(i.ctrModel!, p.imp_28d, p.position_28d!, Math.max(1, p.position_28d! * 0.75)) * rate])) : undefined
      const gain = pageGains ? Math.round(Object.values(pageGains).reduce((a, b) => a + b, 0)) : null
      out.push({
        key: `route-uitrollen|${l.key}`, kind: "route-uitrollen",
        title: `${cap(label)} werkt op ${where}: pas het toe op ${cands.length} vergelijkbare pagina's`,
        summary: `De metingen laten zien dat ${label} hier vaker werkt dan andere aanpakken. Deze pagina's staan op een vergelijkbare plek en het is er nog niet geprobeerd.`,
        evidence: [`${ok} van ${ok + bad} metingen geslaagd (les: "${l.title}", zekerheid ${l.confidence}).`, l.conclusion, `Kandidaten: positie 4–20, minstens 30 vertoningen per 28 dagen, niet meer in opbouw, ${label} nog niet geprobeerd.`],
        steps: [...routeSteps(route, { type: type || "", prov: null }, cands.length), MEASURE],
        gain, gainNote: `Als elke pagina een kwart in positie stijgt, maal het slagingspercentage (${pct(rate)}).`,
        confidence: l.confidence, confidenceWhy: `Gebaseerd op ${ok + bad} metingen.`,
        pages: cands.map(p => ({ path: p.path, note: `positie ${nl1(p.position_28d!)}, ${nlNum(p.imp_28d)} vertoningen` })), taskKeys: [], ideaIds: [], pageGains,
      })
    } else if ((e.factor || 1) < 1 && bad >= 2) {
      const still = i.tasks.filter(t => OPEN.has(columnOf(t.status) || "") && actionOf(t.signal.action) === route && (!type || pageGroup(t.signal.page) === type))
      out.push({
        key: `route-stoppen|${l.key}`, kind: "route-stoppen",
        title: `Stop met ${label} op ${where}: leverde ${bad} van ${ok + bad} keer niets op`,
        summary: `Tijd steken in een aanpak die hier herhaaldelijk niets oplevert, kost capaciteit zonder resultaat. Kies op deze pagina's eerst een andere route.`,
        evidence: [`${bad} van ${ok + bad} metingen niet geslaagd (les: "${l.title}", zekerheid ${l.confidence}).`, l.conclusion, still.length ? `${still.length} open ${still.length === 1 ? "advies stelt" : "adviezen stellen"} deze aanpak nu nog voor.` : "Er staan nu geen open adviezen met deze aanpak."],
        steps: [
          `Kies bij nieuwe adviezen op ${where} eerst ${ROUTE_ORDER.filter(r => r !== route).map(r => lc(ROUTE_LABEL[r] || r)).join(" of ")}.`,
          ...(still.length ? [`Bekijk de ${still.length} open ${still.length === 1 ? "advies" : "adviezen"} hieronder en pas de aanpak aan voordat iemand eraan begint.`] : []),
        ],
        gain: null, confidence: l.confidence, confidenceWhy: `Gebaseerd op ${ok + bad} metingen.`,
        pages: [], taskKeys: still.map(t => t.key), ideaIds: [],
      })
    }
  }
  return out
}

// 4. Regio's: opbouw (alleen de basis) en, zodra volwassen, prestaties vergelijken
function regionAdvice(i: SiteAdviceInput): SiteAdvice[] {
  const today = i.today || new Date().toISOString().slice(0, 10)
  const out: SiteAdvice[] = []
  const provs = new Map<string, PageRow[]>()
  for (const p of i.inventory) {
    const c = classifyPath(p.path)
    if ((c.type === "gemeente" || c.type === "plaats") && c.provincie && p.in_sitemap) provs.set(c.provincie, [...(provs.get(c.provincie) || []), p])
  }
  const stats = [...provs].map(([prov, rows]) => {
    const launch = provLaunch(prov, rows)
    const age = launch ? daysSince(launch, today) : null
    const inspected = rows.filter(r => r.index_verdict)
    const indexed = inspected.filter(r => r.index_verdict === "PASS")
    const imp = rows.reduce((s, r) => s + r.imp_28d, 0), clicks = rows.reduce((s, r) => s + r.clicks_28d, 0)
    return { prov, rows, launch, age, young: age !== null && age < OPBOUW_DAGEN, inspected, indexed, imp, clicks, perPage: rows.length ? imp / rows.length : 0, pos: wPos(rows.map(r => ({ imp: r.imp_28d, pos: r.position_28d }))) }
  })
  for (const s of stats) {
    if (s.inspected.length < 5) continue
    const share = s.indexed.length / s.inspected.length
    const notIdx = s.inspected.filter(r => r.index_verdict !== "PASS")
    const threshold = s.young ? 0.6 : 0.85
    if (share >= threshold) continue
    const states = new Map<string, number>()
    notIdx.forEach(r => states.set(r.coverage_state || "onbekend", (states.get(r.coverage_state || "onbekend") || 0) + 1))
    const topState = [...states].sort((a, b) => b[1] - a[1])[0]
    const crawledNotIndexed = /crawled|gecrawld/i.test(topState?.[0] || "")
    out.push({
      key: `indexering|${s.prov}`, kind: s.young ? "regio" : "indexering",
      title: s.young
        ? `${PROV(s.prov)} is in opbouw: ${notIdx.length} van de ${s.inspected.length} gecontroleerde pagina's staan nog niet in Google`
        : `${notIdx.length} van de ${s.inspected.length} lokale pagina's in ${PROV(s.prov)} staan niet in Google`,
      summary: s.young
        ? `De provincie is ${s.age} dagen live${s.launch ? ` (sinds ${s.launch})` : ""}. In de eerste ${OPBOUW_DAGEN / 7} weken beoordelen we nog geen prestaties, alleen de basis: pagina's die niet in Google staan kunnen nooit gevonden worden.`
        : "Een pagina die niet in Google staat, levert niets op. Dit gaat vóór elke andere verbetering in deze provincie.",
      evidence: [
        `${pct(share)} van de gecontroleerde pagina's staat in Google (${s.indexed.length} van ${s.inspected.length}).`,
        ...(topState ? [`Meest voorkomende status van de rest: "${topState[0]}" (${topState[1]}×).`] : []),
      ],
      steps: [
        crawledNotIndexed
          ? "Google heeft de pagina's gezien maar vindt ze (nog) niet waardevol genoeg. Maak ze onderscheidender: eigen lokale informatie per plaats in plaats van dezelfde tekst met een andere plaatsnaam."
          : "Controleer of alle pagina's in de sitemap staan en of de sitemap in Search Console is ingediend.",
        `Link vanaf /regio/${s.prov} en vanaf de maatregelpagina's naar deze plaatsen, zodat Google ze vaker bezoekt.`,
        "Vraag in Search Console indexering aan voor de pagina's met de meeste inwoners of zoekvraag.",
      ],
      gain: null, confidence: s.inspected.length >= 20 ? "hoog" : "middel", confidenceWhy: `${s.inspected.length} pagina's gecontroleerd met de URL-inspectie van Google.`,
      pages: notIdx.slice(0, 40).map(r => ({ path: r.path, note: r.coverage_state || undefined })), taskKeys: [], ideaIds: [],
    })
  }
  // Volwassen provincies onderling vergelijken (pas zinvol vanaf twee)
  const mature = stats.filter(s => !s.young && s.rows.length >= 10)
  if (mature.length >= 2) {
    const best = [...mature].sort((a, b) => b.perPage - a.perPage)[0]
    for (const s of mature) {
      if (s === best || s.perPage >= best.perPage * 0.5) continue
      out.push({
        key: `regio|${s.prov}`, kind: "regio",
        title: `${PROV(s.prov)} blijft achter: ${nlNum(s.perPage)} vertoningen per pagina tegen ${nlNum(best.perPage)} in ${PROV(best.prov)}`,
        summary: "Zelfde soort pagina's, maar duidelijk minder zichtbaar in Google. Dat wijst op een verschil in de opbouw van de provincie, niet op losse pagina's.",
        evidence: [`${PROV(s.prov)}: ${s.rows.length} pagina's, ${nlNum(s.imp)} vertoningen, ${nlNum(s.clicks)} klikken${s.pos ? `, gem. positie ${nl1(s.pos)}` : ""}.`, `${PROV(best.prov)}: ${best.rows.length} pagina's, ${nlNum(best.imp)} vertoningen, ${nlNum(best.clicks)} klikken${best.pos ? `, gem. positie ${nl1(best.pos)}` : ""}.`],
        steps: [`Vergelijk /regio/${s.prov} met /regio/${best.prov}: aantal links naar plaatsen, hoeveelheid lokale tekst, interne links vanaf maatregelpagina's.`, "Neem over wat in de sterkere provincie anders is, voor de hele provincie tegelijk.", MEASURE],
        gain: null, confidence: "middel", confidenceWhy: "Vergelijking tussen provincies die allebei langer dan 8 weken live zijn.",
        pages: [{ path: `/regio/${s.prov}` }], taskKeys: [], ideaIds: [],
      })
    }
  }
  return out
}

// 5. Zoekvraag per dienst waar Gijs slecht scoort. Twee soorten:
//    - lokaal ("dakisolatie enschede"): mensen zoeken een dienst in hun plaats → de lokale pagina's moeten die dienst behandelen
//    - algemeen ("spouwmuurisolatie kosten"): → de maatregelpagina als hoofdpagina voor het onderwerp
const ISOLATIE = "isolatie-algemeen"
const svcLabel = (s: string) => (s === ISOLATIE ? "isoleren in het algemeen" : s === SCAN_SERVICE ? "verduurzamen in het algemeen" : serviceLabel(s).toLowerCase())
function serviceOf(q: string) {
  // servicesIn valt zonder specifieke dienst terug op de energiescan; hier willen we eerst "isolatie" apart
  const specific = servicesIn(q, Object.keys(SERVICE_TERMS)).find(s => s in SERVICE_TERMS)
  if (specific) return specific
  if (/isol/.test(q)) return ISOLATIE
  return servicesIn(q, [SCAN_SERVICE])[0] || null
}

function serviceAdvice(i: SiteAdviceInput): SiteAdvice[] {
  const idx = placeIndex(i.inventory)
  type Row = { q: string; imp: number; clicks: number; pos: number; place: string | null; svc: string }
  const rows: Row[] = []
  for (const r of i.keywords) {
    const q = String(r.keys[0] || "").toLowerCase()
    if (!q || /gijs|groen ?in ?je ?straat/.test(q)) continue
    const svc = serviceOf(q)
    if (!svc) continue
    rows.push({ q, imp: r.impressions, clicks: r.clicks, pos: r.position, place: placeIn(q, idx.regions), svc })
  }
  const gainOf = (rs: Row[]) => (i.ctrModel ? Math.round(rs.filter(r => r.pos > 8).reduce((a, r) => a + gainFromMove(i.ctrModel!, r.imp, r.pos, 8), 0)) : null)
  const fmt = (rs: Row[]) => [...rs].sort((a, b) => b.imp - a.imp).slice(0, 4).map(r => `"${r.q}" (${nlNum(r.imp)}×, positie ${nl1(r.pos)})`).join(", ")
  const out: SiteAdvice[] = []

  // Lokaal: alle diensten samen, uitgesplitst per dienst
  const local = rows.filter(r => r.place)
  const lImp = local.reduce((a, r) => a + r.imp, 0)
  const lPos = wPos(local.map(r => ({ imp: r.imp, pos: r.pos })))
  if (lImp >= 300 && lPos && lPos > 12) {
    const bySvc = new Map<string, Row[]>()
    local.forEach(r => bySvc.set(r.svc, [...(bySvc.get(r.svc) || []), r]))
    const svcs = [...bySvc].map(([s, rs]) => ({ s, rs, imp: rs.reduce((a, r) => a + r.imp, 0), pos: wPos(rs.map(r => ({ imp: r.imp, pos: r.pos }))) })).sort((a, b) => b.imp - a.imp)
    const places = [...new Set(local.map(r => r.place!))]
    const pages = [...new Set(places.map(p => idx.pageFor(p)).filter(Boolean) as string[])]
    out.push({
      key: "dienst|lokaal", kind: "dienst",
      title: `Mensen zoeken op "dienst + plaats", maar Gijs staat daar gemiddeld op positie ${nl1(lPos)}`,
      summary: `Huiseigenaren zoeken naar een concrete maatregel in hun eigen plaats ("dakisolatie enschede"). De lokale pagina's van Gijs worden op die combinaties nauwelijks gevonden: ze gaan over de plaats, niet over de diensten in die plaats.`,
      evidence: [
        `${nlNum(lImp)} vertoningen in 28 dagen op ${local.length} zoekwoorden met een plaatsnaam, ${nlNum(local.reduce((a, r) => a + r.clicks, 0))} klikken, in ${places.length} plaatsen.`,
        `Per dienst: ${svcs.slice(0, 5).map(x => `${svcLabel(x.s)} ${nlNum(x.imp)}× (positie ${x.pos ? nl1(x.pos) : "—"})`).join(", ")}.`,
        `Meest gezocht: ${fmt(local)}.`,
      ],
      steps: [
        `Geef elke lokale pagina een korte sectie per dienst waar in die plaats op gezocht wordt (begin met ${(svcs.filter(x => x.s in SERVICE_TERMS).length ? svcs.filter(x => x.s in SERVICE_TERMS) : svcs).slice(0, 2).map(x => svcLabel(x.s)).join(" en ")}), met iets wat alleen daar geldt: veelvoorkomende woningen, lokale subsidie, of een voorbeeld uit de buurt.`,
        "Noem de belangrijkste dienst samen met de plaatsnaam in de title en H1, bijvoorbeeld \"Isolatie en verduurzamen in Enschede\".",
        "Link vanaf elke maatregelpagina naar de lokale pagina's, met dienst en plaats in de linktekst (\"dakisolatie in Enschede\").",
        MEASURE,
      ],
      gain: gainOf(local), gainNote: "Als de zoekwoorden die nu lager staan naar positie 8 gaan, bij gelijke zoekvraag.",
      confidence: lImp >= 1000 ? "hoog" : "middel", confidenceWhy: `${nlNum(lImp)} vertoningen gemeten in Search Console.`,
      pages: pages.map(p => ({ path: p })), taskKeys: [], ideaIds: [],
    })
  }

  // Algemeen: per dienst
  const per = new Map<string, Row[]>()
  rows.filter(r => !r.place).forEach(r => per.set(r.svc, [...(per.get(r.svc) || []), r]))
  for (const [s, rs] of per) {
    const imp = rs.reduce((a, r) => a + r.imp, 0)
    const pos = wPos(rs.map(r => ({ imp: r.imp, pos: r.pos })))
    if (imp < 200 || !pos || pos <= 12) continue
    const open = (i.ideas || []).filter(x => x.service === s && ["nieuw", "later", "geaccepteerd", "briefing", "concept", "review", "goedgekeurd"].includes(x.status))
    const hub = s === SCAN_SERVICE ? "de energiescan-pagina" : s === ISOLATIE ? "het overzicht van de isolatiemaatregelen" : `de maatregelpagina over ${svcLabel(s)}`
    out.push({
      key: `dienst|${s}`, kind: "dienst",
      title: `Rond ${svcLabel(s)} zoeken mensen veel, maar Gijs staat gemiddeld op positie ${nl1(pos)}`,
      summary: "Er is aantoonbare, algemene vraag naar dit onderwerp, maar de site wordt er nauwelijks voor gevonden. Dit maak je sterk als onderwerp, met één hoofdpagina en artikelen eromheen, niet met één los artikel.",
      evidence: [
        `${nlNum(imp)} vertoningen in 28 dagen op ${rs.length} zoekwoorden zonder plaatsnaam, ${nlNum(rs.reduce((a, r) => a + r.clicks, 0))} klikken.`,
        `Meest gezocht: ${fmt(rs)}.`,
        open.length ? `${open.length} contentkans${open.length === 1 ? "" : "en"} over dit onderwerp staan al klaar.` : "Er staat nog geen contentkans over dit onderwerp klaar.",
      ],
      steps: [
        `Maak ${hub} de hoofdpagina voor dit onderwerp en beantwoord daar de meest gezochte vragen (kosten, besparing, subsidie, geschikt voor mijn huis?).`,
        ...(open.length ? ["Pak de klaarstaande contentkansen op en link ze naar die hoofdpagina."] : ["Bij de volgende scan zoekt het dashboard contentkansen bij deze zoekvragen."]),
        MEASURE,
      ],
      gain: gainOf(rs), gainNote: "Als de zoekwoorden die nu lager staan naar positie 8 gaan, bij gelijke zoekvraag.",
      confidence: imp >= 1000 ? "hoog" : "middel", confidenceWhy: `${nlNum(imp)} vertoningen gemeten in Search Console.`,
      pages: [], taskKeys: [], ideaIds: open.map(x => x.id),
    })
  }
  return out
}

// 6. Drukbezochte pagina's zonder aanvragen (alleen als de meting van aanvragen werkt)
function conversionAdvice(i: SiteAdviceInput): SiteAdvice[] {
  const g = i.ga4Pages
  if (!g?.length) return []
  const totalEvents = g.reduce((s, r) => s + r.keyEvents, 0), totalSessions = g.reduce((s, r) => s + r.sessions, 0)
  if (totalEvents < 3 || !totalSessions) return []
  const rate = totalEvents / totalSessions
  const zero = g.filter(r => r.sessions >= 100 && r.keyEvents === 0 && r.sessions * rate >= 2).sort((a, b) => b.sessions - a.sessions)
  if (zero.length < 2) return []
  const missed = Math.round(zero.reduce((s, r) => s + r.sessions * rate, 0))
  return [{
    key: "conversie|nul", kind: "conversie",
    title: `${zero.length} drukbezochte pagina's leveren geen aanvragen op`,
    summary: "Bezoekers komen wel, maar vragen niets aan. Op basis van het gemiddelde van de site zou je hier aanvragen verwachten.",
    evidence: [`Gemiddeld levert ${pct(rate)} van de bezoeken een aanvraag op (${totalEvents} op ${nlNum(totalSessions)}).`, `Samen ${nlNum(zero.reduce((s, r) => s + r.sessions, 0))} bezoeken en 0 aanvragen; verwacht ongeveer ${missed}.`],
    steps: [
      "Zet op elke pagina een duidelijke knop naar de energiescan boven de vouw, met wat het kost en wat je krijgt.",
      "Kijk of de pagina de vraag van de bezoeker beantwoordt voordat hij om een aanvraag vraagt.",
      "Leg de wijziging vast als taak met doel \"conversie\": dan meet het dashboard of het aanvragen oplevert.",
    ],
    gain: null, confidence: totalEvents >= 20 ? "middel" : "laag", confidenceWhy: `Gebaseerd op ${totalEvents} aanvragen in GA4 (laatste 28 dagen).`,
    pages: zero.slice(0, 15).map(r => ({ path: r.path, note: `${nlNum(r.sessions)} bezoeken, 0 aanvragen` })), taskKeys: [], ideaIds: [],
  }]
}

const CONF_W: Record<Confidence, number> = { laag: 0.7, middel: 1, hoog: 1.25 }
const BASE: Record<AdviceKind, number> = { indexering: 60, regio: 40, "route-stoppen": 35, conversie: 45, groep: 0, "route-uitrollen": 0, dienst: 0 }

export function buildSiteAdvice(i: SiteAdviceInput): SiteAdvice[] {
  const groups = groupAdvice(i)
  // Pagina's die al in een groepsadvies zitten, niet nog eens in een uitrol-advies
  const inGroup = new Set(groups.flatMap(g => g.pages.map(p => p.path)))
  const routes = routeAdvice(i).flatMap(a => {
    if (a.kind !== "route-uitrollen") return [a]
    const pages = a.pages.filter(p => !inGroup.has(p.path))
    if (pages.length < 3) return []
    const gain = a.pageGains ? Math.round(pages.reduce((x, p) => x + (a.pageGains![p.path] || 0), 0)) : a.gain
    return [{ ...a, pages, gain, title: a.title.replace(/pas het toe op \d+ /, `pas het toe op ${pages.length} `) }]
  })
  const all = [...regionAdvice(i), ...groups, ...routes, ...serviceAdvice(i), ...conversionAdvice(i)]
  return all
    .map(a => ({ a, w: ((a.gain ?? 0) + BASE[a.kind]) * CONF_W[a.confidence] }))
    .sort((x, y) => y.w - x.w)
    .map(x => x.a)
    .slice(0, 10)
}

// De stand van de site in een paar zinnen (bovenaan de pagina)
export function siteState(i: Pick<SiteAdviceInput, "inventory" | "today">) {
  const today = i.today || new Date().toISOString().slice(0, 10)
  const live = i.inventory.filter(p => p.in_sitemap)
  const inspected = live.filter(p => p.index_verdict)
  const indexed = inspected.filter(p => p.index_verdict === "PASS")
  const imp = live.reduce((s, p) => s + p.imp_28d, 0), prev = live.reduce((s, p) => s + p.imp_prev_28d, 0)
  const clicks = live.reduce((s, p) => s + p.clicks_28d, 0)
  const byProv = new Map<string, PageRow[]>()
  for (const p of live) { const c = classifyPath(p.path); if (c.provincie) byProv.set(c.provincie, [...(byProv.get(c.provincie) || []), p]) }
  const young = [...byProv].filter(([prov, rows]) => { const d = provLaunch(prov, rows); return d && daysSince(d, today) < OPBOUW_DAGEN }).map(([p]) => PROV(p))
  return { pages: live.length, inspected: inspected.length, indexed: indexed.length, imp, prev, clicks, young }
}
