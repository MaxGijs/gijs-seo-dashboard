import type { ActionType, AdviceDetail, GscRow, Level, MetricSet, Signal } from "./types"
import type { CtrModel } from "./ctr"
import { gainFromMove } from "./ctr"
import { capitalize, dateShort, normalize, num, pct, pos } from "./format"
import { isBrandQuery, toPath } from "./signals"
import { ageDays, assessPage, coverageNl, OPBOUW_DAGEN, phaseOf } from "./pages"
import { measurePlan, SUCCESS_METRIC, type MeasurePlan, type SuccessMetric } from "./measure"

export type FindingTone = "feit" | "aanwijzing" | "check" | "spoed"
export interface Finding { tone: FindingTone; text: string }
export interface Step { title: string; detail?: string }

export interface Diagnosis {
  situation: string
  target: string | null                 // pagina waar het om gaat
  facts: { label: string; value: string; sub?: string }[]
  history: { weekStart: string; position: number; impressions: number }[]
  importance: { gainText: string; relativeText: string; evidenceText: string; visibilityText: string }
  verdict: { kind: "inplannen" | "spoed" | "afwachten"; label: string; text: string }
  findings: Finding[]
  steps: Step[]
  expected: string[]
  measurement: string[]
  successMetric: SuccessMetric
  actionType: ActionType
  plan: MeasurePlan
  effort: Level
  risk: Level
  cluster: PageCluster | null
}

// Zoekwoordcluster van een pagina: waar gaat de pagina (volgens Google) vooral over?
export interface PageCluster {
  page: string
  topic: string | null          // hoofdonderwerp (woord met het meeste vertoningsgewicht)
  topicShare: number            // aandeel vertoningen van zoekwoorden met dat woord
  queries: { query: string; impressions: number; share: number; inTopic: boolean }[]
  query?: { share: number; inTopic: boolean } // het zoekwoord van dit advies
}

const STOP = new Set(["de", "het", "een", "in", "van", "voor", "en", "met", "op", "bij", "te", "wat", "hoe", "is", "je", "mijn", "uw", "aan", "of"])

const MAATREGEL_PAGES: [RegExp, string, string][] = [
  [/spouw/, "/maatregelen/spouwmuurisolatie", "spouwmuurisolatie"],
  [/dakisol/, "/maatregelen/dakisolatie", "dakisolatie"],
  [/vloerisol/, "/maatregelen/vloerisolatie", "vloerisolatie"],
  [/glas/, "/maatregelen/isolatieglas", "isolatieglas"],
  [/zonnepan/, "/maatregelen/zonnepanelen", "zonnepanelen"],
  [/warmtepomp/, "/maatregelen/warmtepomp", "warmtepompen"],
  [/vloerverwarm/, "/maatregelen/vloerverwarming", "vloerverwarming"],
  [/isol/, "/isolatie", "isolatie"],
]

function tokens(q: string) {
  return normalize(q).split(" ").filter(t => t && !STOP.has(t))
}

// Woordvarianten tellen mee (isoleren ≈ isolatie, warmtepompen ≈ warmtepomp);
// algemene woorden als "huis" of "kosten" hoeven niet letterlijk in een title.
const GENERIC = new Set(["huis", "woning", "woningen", "kosten", "prijs", "prijzen", "info", "beste", "goedkoop", "laten", "nieuwe"])
function stem(tok: string) {
  return tok.length >= 6 ? tok.slice(0, 4) : tok
}
function missingTokens(q: string, text?: string) {
  const toks = tokens(q).filter(t => !GENERIC.has(t))
  if (!text) return toks
  const t = normalize(text)
  return toks.filter(tok => !t.includes(tok) && !t.includes(stem(tok)))
}

export function pageCluster(page: string, pq: { query: string; impressions: number }[], q?: string | null): PageCluster | null {
  if (!pq.length) return null
  const placeToks = new Set(page.split("/").filter(Boolean).flatMap(seg => seg.split("-")))
  const skip = (t: string) => STOP.has(t) || GENERIC.has(t) || placeToks.has(t) || t.length < 4 || /^gijs$/.test(t)
  const weight = new Map<string, number>()
  for (const r of pq) for (const t of new Set(tokens(r.query).map(stem))) if (!skip(t)) weight.set(t, (weight.get(t) || 0) + r.impressions)
  const total = pq.reduce((a, r) => a + r.impressions, 0) || 1
  const topicStem = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const has = (query: string) => !!topicStem && tokens(query).map(stem).includes(topicStem)
  // Toon het onderwerp als het meest voorkomende volledige woord met die stam
  const topicWord = topicStem ? (pq.flatMap(r => tokens(r.query)).find(t => stem(t) === topicStem) || topicStem) : null
  const queries = pq.map(r => ({ query: r.query, impressions: r.impressions, share: r.impressions / total, inTopic: has(r.query) }))
  const own = q ? queries.find(r => r.query === q) : undefined
  return {
    page, topic: topicWord,
    topicShare: queries.filter(r => r.inTopic).reduce((a, r) => a + r.share, 0),
    queries,
    query: q ? { share: own?.share ?? 0, inTopic: has(q) } : undefined,
  }
}

function placeFromPath(path: string | null) {
  if (!path || !path.startsWith("/regio/")) return null
  const seg = path.split("/").filter(Boolean).pop()!
  return seg.split("-").map(capitalize).join("-")
}

function gainRange(gain: number) {
  if (gain >= 1) {
    const lo = Math.max(1, Math.floor(gain * 0.6))
    const hi = Math.max(lo + 1, Math.ceil(gain * 1.3))
    return `ongeveer ${lo}–${hi} extra clicks per 28 dagen`
  }
  if (gain >= 0.2) return "minder dan 1 extra click per 28 dagen"
  return "geen meetbare extra clicks op korte termijn"
}


export interface DiagnosisContext {
  model: CtrModel
  pages: GscRow[]
  signalCount: number
}

export function buildDiagnosis(signal: Signal, detail: AdviceDetail | null, ctx: DiagnosisContext): Diagnosis {
  const q = signal.query || null
  const findings: Finding[] = []
  const steps: Step[] = []
  const pagePaths = new Set(ctx.pages.map(p => toPath(p.keys[0])))
  const pageRow = (path: string) => ctx.pages.find(p => toPath(p.keys[0]) === path)

  // ── Cijfers: na het datacontract (lib/contract.ts) staan de live cijfers al in het signaal.
  // Alleen als het signaal niet verzoend is, vallen we terug op de ruwe detaildata.
  const reconciled = signal.scope?.source === "live" || signal.kind === "dubbel" || signal.kind === "techniek"
  const cur = reconciled ? null : (q ? detail?.queryTotals?.cur : detail?.pageTotals?.cur) || null
  const prev = reconciled ? null : (q ? detail?.queryTotals?.prev : detail?.pageTotals?.prev) || null
  const m = {
    position: cur?.position ?? signal.metrics.position,
    impressions: cur?.impressions ?? signal.metrics.impressions,
    clicks: cur?.clicks ?? signal.metrics.clicks,
    ctr: cur?.ctr ?? signal.metrics.ctr,
    prevPosition: prev?.position ?? signal.metrics.prevPosition,
    prevImpressions: prev?.impressions ?? signal.metrics.prevImpressions,
    prevClicks: prev?.clicks ?? signal.metrics.prevClicks,
  }
  const target = detail?.auditTarget ?? signal.page ?? null
  const place = placeFromPath(target)
  const audit = detail?.audit

  const facts: Diagnosis["facts"] = [
    { label: "Gem. positie", value: pos(m.position), sub: m.prevPosition !== undefined ? `vorige 28 d: ${pos(m.prevPosition)}` : undefined },
    { label: "Vertoningen", value: num(m.impressions), sub: m.prevImpressions !== undefined ? `vorige 28 d: ${num(m.prevImpressions)}` : undefined },
    { label: "Clicks", value: num(m.clicks), sub: m.prevClicks !== undefined ? `vorige 28 d: ${num(m.prevClicks)}` : undefined },
    { label: "Doorklik (CTR)", value: pct(m.ctr), sub: m.position ? `verwacht ±${pct(ctx.model.at(m.position))}` : undefined },
  ]

  if (signal.kind === "techniek" && signal.tech) {
    const byProv = new Map<string, number>()
    for (const p of signal.tech.pages) byProv.set(p.provincie || "overig", (byProv.get(p.provincie || "overig") || 0) + 1)
    facts.splice(0, facts.length,
      { label: signal.tech.type === "sitemap-fout" ? "Foute URL's" : "Niet geïndexeerd", value: num(signal.tech.pages.length) },
      ...[...byProv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([prov, n]) => ({ label: capitalize(prov), value: num(n) })),
    )
  }

  // ── Wat speelt er
  const subjectText = q ? `"${q}"` : target || signal.headline
  let situation = ""
  switch (signal.kind) {
    case "trend-dalend":
    case "trend-stijgend":
      situation = `${capitalize(subjectText)} ${signal.kind === "trend-dalend" ? "daalt" : "stijgt"} al ${signal.metrics.weeks} weken op rij: van gemiddeld positie ${pos(signal.metrics.prevPosition)} naar ${pos(signal.metrics.position)}.`
      break
    case "daler":
    case "stijger":
      situation = `${capitalize(subjectText)} ging van gemiddeld positie ${pos(m.prevPosition)} naar ${pos(m.position)} ten opzichte van de vorige 28 dagen.`
      break
    case "kans":
      situation = `${capitalize(subjectText)} staat gemiddeld op positie ${pos(m.position)}: ${m.position && m.position <= 10.5 ? "onderaan pagina 1" : "net buiten pagina 1"}, waar vrijwel niemand kijkt.`
      break
    case "ctr":
      situation = `${capitalize(subjectText)} staat op pagina 1 (positie ${pos(m.position)}), maar maar ${pct(m.ctr)} van de zoekers klikt door. Op die positie is ±${pct(m.position ? ctx.model.at(m.position) : 0)} normaal.`
      break
    case "pagina":
      situation = `${target} wordt vertoond op gemiddeld positie ${pos(m.position)} (${num(m.impressions)} keer), maar niemand klikt erop.`
      break
    case "dubbel":
      situation = `Meerdere eigen pagina's gaan over hetzelfde onderwerp: ${(signal.relatedPages || []).join(", ")}.`
      break
    case "eigen":
      situation = signal.description || `Door jou toegevoegde taak${target ? ` voor ${target}` : q ? ` voor "${q}"` : ""}.`
      if (q && m.position) situation += ` "${q}" staat nu gemiddeld op positie ${pos(m.position)} (${num(m.impressions)} vertoningen in 28 dagen).`
      else if (!q && target && m.impressions) situation += ` ${target} had ${num(m.impressions)} vertoningen in 28 dagen, gemiddeld positie ${pos(m.position)}.`
      break
    case "techniek": {
      const t = signal.tech
      situation = t?.type === "sitemap-fout"
        ? `${num(t.pages.length)} URL's uit de sitemap geven een foutmelding. Google probeert ze te bezoeken en treft een lege pagina aan. Dat kost crawlbudget en vertrouwen, en de bedoelde pagina's krijgen geen bezoek.`
        : `${num(t?.pages.length || 0)} belangrijke pagina's zijn niet geïndexeerd en staan langer live dan de opbouwfase. Zolang Google ze niet opneemt, kunnen ze nergens op ranken.`
      break
    }
    case "analyse":
      situation = m.impressions
        ? `${capitalize(subjectText)} staat gemiddeld op positie ${pos(m.position)}, met ${num(m.impressions)} vertoningen en ${num(m.clicks)} clicks in 28 dagen.`
        : `${capitalize(subjectText)} had in de laatste 28 dagen geen vertoningen in Google.`
      break
  }
  if (["kans", "ctr", "analyse"].includes(signal.kind) && m.position && m.prevPosition) {
    const d = m.prevPosition - m.position
    if (d >= 3) situation += ` In de vorige 28 dagen stond het nog op positie ${pos(m.prevPosition)}: het zoekwoord is in opkomst.`
    else if (d <= -3) situation += ` Dat is lager dan in de vorige 28 dagen (positie ${pos(m.prevPosition)}).`
  }
  if (q && detail?.queryPages?.cur?.[0]) situation += ` Google toont hiervoor vooral ${detail.queryPages.cur[0].path}.`

  // ── Bevindingen: rankende pagina's
  const pagesCur = detail?.queryPages?.cur || []
  const pagesPrev = detail?.queryPages?.prev || []
  if (q && detail) {
    if (pagesCur.length === 0) {
      findings.push({ tone: "feit", text: "Google koppelde dit zoekwoord in de laatste 28 dagen aan geen enkele pagina met vertoningen." })
    } else {
      const top = pagesCur[0]
      const intended = detail.intendedPage ? pagesCur.find(p => p.path === detail.intendedPage) : undefined
      const totalImp = pagesCur.reduce((s, p) => s + p.impressions, 0)
      if (pagesCur.length >= 4) {
        findings.push({ tone: "feit", text: `Google toont ${pagesCur.length}${pagesCur.length >= 10 ? " of meer" : ""} verschillende eigen pagina's voor dit zoekwoord. De meeste vertoningen gaan naar ${top.path} (positie ${pos(top.position)}, ${num(top.impressions)} van ${num(totalImp)}).` })
      } else {
        findings.push({ tone: "feit", text: `Rankende pagina: ${top.path} (positie ${pos(top.position)}, ${num(top.impressions)} vertoningen).` })
      }
      const rivals = pagesCur.slice(1).filter(p => p.impressions >= Math.max(5, totalImp * 0.15))
      if (intended && intended.path !== top.path) {
        const others = pagesCur.filter(p => p.path !== intended.path).slice(0, 3).map(p => p.path)
        findings.push({ tone: "aanwijzing", text: `De pagina die bij dit zoekwoord hoort, ${intended.path}, staat maar op positie ${pos(intended.position)} (${num(intended.impressions)} vertoningen). Google verspreidt het zoekwoord over andere pagina's, waardoor geen enkele pagina hoog komt.` })
        steps.push({
          title: `Maak ${intended.path} de hoofdpagina voor "${q}"`,
          detail: `Laat ${others.join(", ")} naar ${intended.path} linken, met natuurlijke linkteksten als "${q}" of "isolatie in ${capitalize(intended.path.split("/").pop()!.replace(/-/g, " "))}". Zo weet Google welke pagina het antwoord is. Haal "${q}" niet uit die pagina's weg; ze blijven nuttig voor hun eigen wijk of onderwerp.`,
        })
      } else if (rivals.length) {
        findings.push({
          tone: "aanwijzing",
          text: `Ook ${rivals.map(r => `${r.path} (positie ${pos(r.position)})`).join(" en ")} verschijnt voor dit zoekwoord. Je eigen pagina's concurreren met elkaar.`,
        })
        steps.push({
          title: `Kies ${top.path} als hoofdpagina voor "${q}"`,
          detail: `Laat ${rivals.map(r => r.path).join(" en ")} met de linktekst "${q}" naar ${top.path} linken en haal "${q}" daar uit de title en H1. Twijfel je welke pagina beter is? Kies de pagina met de hoogste positie.`,
        })
      }
      const prevTop = pagesPrev[0]
      if (prevTop && prevTop.path !== top.path && prevTop.impressions >= 3) {
        findings.push({
          tone: "feit",
          text: `Google wisselde van pagina: vorige periode vooral ${prevTop.path} (positie ${pos(prevTop.position)}), nu ${top.path} (positie ${pos(top.position)}).`,
        })
      }
    }
  }

  // ── Bevindingen: indexering en fase (uit de pagina-audit)
  const info = detail?.pageInfo
  let opbouwFase = false
  if (target && info) {
    const phase = phaseOf(info)
    const age = ageDays(info)
    opbouwFase = phase === "opbouw"
    if (opbouwFase) {
      findings.push({ tone: "feit", text: `${target} is nieuw: ${age} dagen live${info.launch_date ? ` (provincie gelanceerd op ${dateShort(info.launch_date)})` : ""}. Tot ${OPBOUW_DAGEN / 7} weken na lancering beoordelen we de basis, niet de prestaties.` })
    }
    if (info.inspected_at && !info.inspect_error) {
      const state = coverageNl(info.coverage_state)
      if (info.index_verdict === "PASS") findings.push({ tone: "feit", text: `Google heeft de pagina geïndexeerd${info.last_crawl_time ? ` (laatst gecrawld ${dateShort(info.last_crawl_time)})` : ""}.` })
      else findings.push({ tone: opbouwFase ? "feit" : "spoed", text: `Indexering: ${state || "niet geïndexeerd"}${opbouwFase ? ", voor een nieuwe pagina nog niet zorgwekkend" : ""}.` })
    } else {
      findings.push({ tone: "check", text: "De indexeringsstatus is nog niet gecontroleerd. Dat gebeurt automatisch in de pagina-audit." })
    }
    if (!info.in_sitemap) findings.push({ tone: "aanwijzing", text: `${target} staat niet in de sitemap.` })
    // Technische blokkades zijn altijd spoed, ook in de opbouwfase
    const pa = assessPage(info)
    if (pa.status === "technisch") {
      findings.push({ tone: "spoed", text: pa.reason })
      steps.unshift({ title: pa.next })
    }
  }

  // ── Bevindingen: historie
  const history = (detail?.history || []).filter(h => h.impressions > 0)
  if (history.length >= 3) {
    const last = history.slice(-4)
    findings.push({
      tone: "feit",
      text: `Positie per week: ${last.map(h => pos(h.position)).join(" → ")} (weken vanaf ${dateShort(last[0].weekStart)}).`,
    })
  }

  // ── Bevindingen: pagina-check
  let titleMissing: string[] = []
  let h1Missing: string[] = []
  if (target && audit) {
    if (!audit.ok) {
      findings.push({ tone: "check", text: `De pagina-check van ${target} lukte niet (${audit.error}). Open de pagina zelf om title en koppen te controleren.` })
    } else {
      if (audit.noindex) {
        findings.push({ tone: "spoed", text: `${target} heeft een noindex-instelling: Google mag deze pagina niet tonen.` })
        steps.unshift({ title: `Haal de noindex weg op ${target}`, detail: "Zolang die er staat, heeft geen enkele inhoudelijke aanpassing effect. Laat dit aanpassen door wie de site beheert." })
      }
      if (audit.canonical && toPath(audit.canonical) !== target && /groeninjestraat\.nl/i.test(audit.canonical)) {
        findings.push({ tone: "feit", text: `De canonical van ${target} wijst naar ${toPath(audit.canonical)}. Google ziet die andere pagina dan als de echte.` })
      }
      const finalPath = audit.finalUrl ? toPath(audit.finalUrl) : target
      if (finalPath !== target) {
        findings.push({ tone: "feit", text: `${target} verwijst door naar ${finalPath}. De gegevens hieronder gaan over die pagina.` })
      }
      const titleLen = audit.title?.length || 0
      if (!audit.title) findings.push({ tone: "feit", text: `${target} heeft geen title tag.` })
      else findings.push({ tone: "feit", text: `Title tag (${titleLen} tekens): "${audit.title}".` })
      if (q && !isBrandQuery(q)) {
        titleMissing = missingTokens(q, audit.title)
        h1Missing = missingTokens(q, audit.h1.join(" "))
        if (titleMissing.length) findings.push({ tone: "feit", text: `De title bevat ${titleMissing.map(t => `"${t}"`).join(" en ")} niet.` })
        if (!audit.h1.length) findings.push({ tone: "feit", text: "De pagina heeft geen H1-kop." })
        else if (h1Missing.length) findings.push({ tone: "feit", text: `De H1 ("${audit.h1[0]}") bevat ${h1Missing.map(t => `"${t}"`).join(" en ")} niet.` })
      }
      if (q && !isBrandQuery(q) && audit.title && audit.h1.length && !titleMissing.length && !h1Missing.length) {
        findings.push({ tone: "feit", text: `Title en H1 bevatten de kernwoorden ${tokens(q).filter(t => !GENERIC.has(t)).map(t => `"${t}"`).join(" en ")}: de basis op de pagina is in orde.` })
      }
      if (titleLen > 62) findings.push({ tone: "aanwijzing", text: `De title is ${titleLen} tekens; Google kapt rond 60 tekens af, dus het eind valt weg.` })
      if (!audit.metaDescription) findings.push({ tone: "feit", text: "Er is geen meta description. Google kiest dan zelf een stukje tekst als omschrijving." })
      if (audit.wordCount && audit.wordCount < 300) findings.push({ tone: "aanwijzing", text: `De pagina heeft ongeveer ${num(audit.wordCount)} woorden inhoud: weinig om op te ranken.` })
    }
  }

  // ── Bevindingen: waar rankt de pagina verder op (zoekwoordcluster)
  const pq = detail?.pageQueries || []
  const cluster = target && pq.length ? pageCluster(target, pq, q) : null
  if (cluster && cluster.topic && q && pq.length >= 3) {
    const top = cluster.queries.slice(0, 3).map(r => `"${r.query}"`).join(", ")
    findings.push({
      tone: cluster.query?.inTopic ? "feit" : "aanwijzing",
      text: `Zoekwoordcluster van ${target}: vooral "${cluster.topic}" (${Math.round(cluster.topicShare * 100)}% van de vertoningen; top: ${top}). "${q}" ${cluster.query?.inTopic ? "valt binnen dat hoofdonderwerp" : "valt erbuiten"} en is ${Math.round((cluster.query?.share ?? 0) * 100)}% van de vertoningen van deze pagina.`,
    })
  }
  if (target && pq.length && q && !(cluster?.topic && pq.length >= 3)) {
    const own = pq.findIndex(r => r.query === q)
    const best = pq[0]
    if (own === -1 || own > 2) {
      findings.push({ tone: "aanwijzing", text: `${target} wordt vooral vertoond voor "${best.query}" (${num(best.impressions)} vertoningen). "${q}" is voor deze pagina bijzaak.` })
    }
  }
  if (signal.kind === "pagina" && pq.length) {
    findings.push({ tone: "feit", text: `Deze pagina verschijnt vooral voor: ${pq.slice(0, 3).map(r => `"${r.query}" (positie ${pos(r.position)})`).join(", ")}.` })
  }

  // ── Technische signalen uit de pagina-audit
  if (signal.kind === "techniek" && signal.tech) {
    const t = signal.tech
    if (t.type === "sitemap-fout") {
      const same = t.pages.filter(p => p.plaats && p.gemeente && p.plaats === p.gemeente)
      const statuses = [...new Set(t.pages.map(p => p.status ?? "geen antwoord"))]
      findings.push({ tone: "spoed", text: `${num(t.pages.length)} URL's in de sitemap geven HTTP ${statuses.join("/")} (nachtelijke controle).` })
      if (same.length >= t.pages.length * 0.6) {
        findings.push({ tone: "aanwijzing", text: `${num(same.length)} van de ${num(t.pages.length)} zijn plaatspagina's met dezelfde naam als de gemeente, zoals ${same[0].path}. De gemeentepagina zelf (${same[0].path.split("/").slice(0, -1).join("/")}) werkt wel. Dit wijst op één fout in hoe de sitemap wordt opgebouwd.` })
      }
      findings.push({ tone: "feit", text: `Voorbeelden: ${t.pages.slice(0, 4).map(p => p.path).join(", ")}${t.pages.length > 4 ? ` en ${num(t.pages.length - 4)} andere` : ""}.` })
      steps.push({
        title: same.length ? "Haal plaatspagina's met dezelfde naam als de gemeente uit de sitemap" : "Haal de foutieve URL's uit de sitemap",
        detail: "Zoek in de code die de sitemap opbouwt waar plaatsen worden toegevoegd en sla een plaats over als die dezelfde naam heeft als de gemeente. Laat dit doen door wie de site beheert; dit dashboard wijzigt de site niet.",
      })
      steps.push({
        title: "Stuur de oude URL's door naar de gemeentepagina (301)",
        detail: "Google kent de URL's al. Een permanente doorverwijzing naar de gemeentepagina voorkomt dat bezoekers en Google op een foutpagina landen.",
      })
      steps.push({ title: "Dien de sitemap opnieuw in via Search Console", detail: "Daarna controleert het dashboard elke nacht of alle URL's 200 of 301 geven." })
    } else {
      findings.push({ tone: "spoed", text: `${num(t.pages.length)} pagina's buiten de opbouwfase zijn niet geïndexeerd.` })
      for (const p of t.pages.slice(0, 5)) findings.push({ tone: "feit", text: `${p.path}: ${p.reason || "niet geïndexeerd"}.` })
      steps.push({ title: "Vraag indexering aan in Search Console", detail: "Open de URL-inspectie per pagina en kies ‘Indexering aanvragen’. Begin bij de pagina's met de meeste zakelijke waarde." })
      steps.push({ title: "Link vanaf de navigatie of een overzichtspagina naar deze pagina's", detail: "Pagina's zonder interne links worden later of niet opgenomen." })
      steps.push({ title: "Controleer of de inhoud uniek genoeg is", detail: "‘Gecrawld, niet geïndexeerd’ betekent vaak dat Google de pagina te veel vindt lijken op een andere." })
    }
  }

  // ── Concrete stappen per type
  const linkSources = (): string[] => {
    const out: string[] = []
    if (target) {
      const parent = target.split("/").slice(0, -1).join("/") || "/"
      if (parent !== target && pagePaths.has(parent)) out.push(parent)
    }
    if (q) {
      const nq = normalize(q)
      for (const [re, path] of MAATREGEL_PAGES) {
        if (re.test(nq) && path !== target && pagePaths.has(path)) { out.push(path); break }
      }
    }
    return [...new Set(out)].slice(0, 2)
  }

  // Zoekwoord met een plaatsnaam, maar Google toont een algemene (niet-regio) pagina?
  // Dan hoort de plaatsnaam níet in de title van die landelijke pagina.
  const TOPIC_WORD = /isol|spouw|dak|vloer|glas|zonne|panel|warmte|pomp|energie|label|fundering|kozijn|verwarm|schoorsteen|bedrijf|kosten|subsidie|besparing|hybride|plaatsen|huis|woning|info|aanvra|installat|advies|prijs|premie/
  const placeTokens = q && target && !target.startsWith("/regio/") ? titleMissing.filter(t => !TOPIC_WORD.test(t) && t.length > 2) : []
  const localMismatch = placeTokens.length > 0

  const localSteps = () => {
    if (!q || !target) return
    const place = placeTokens.map(capitalize).join(" ")
    const regionPage = [...pagePaths].find(p => p.startsWith("/regio/") && placeTokens.some(t => p.endsWith(`/${t}`) || p.includes(`/${t}-`) || p.endsWith(`-${t}`)))
    findings.push({ tone: "aanwijzing", text: `Google toont voor "${q}" een algemene pagina (${target}), geen pagina over ${place}. Lokale zoekers vinden daar niet wat ze zoeken.` })
    if (regionPage) {
      steps.push({
        title: `Laat ${regionPage} ranken in plaats van ${target}`,
        detail: `Er bestaat al een regiopagina. Link vanaf ${target} naar ${regionPage} met de linktekst "${q}", en zorg dat "${q}" in de title en H1 van ${regionPage} staat.`,
      })
    } else {
      steps.push({
        title: `Geef ${place} een eigen plek op de site`,
        detail: `Er verschijnt geen regiopagina voor ${place} in Search Console. Noem ${place} op de dichtstbijzijnde regiopagina (met een eigen alinea over de aanpak daar), of maak een regiopagina als ${place} een werkgebied is dat je wilt laten groeien.`,
      })
    }
    steps.push({ title: `Pas de title van ${target} níet aan voor ${place}`, detail: "Een landelijke onderwerppagina wordt zwakker als je er één plaatsnaam in zet." })
  }

  // Title en H1 alleen aanpassen als het de moeite waard is en de pagina niet breder moet blijven.
  // Eén longtail-zoekwoord mag een brede pagina niet overnemen (overoptimalisatie).
  const broadPage = !!target && (target.startsWith("/maatregelen/") || target === "/" || target.split("/").filter(Boolean).length === 1)
  // Valt het zoekwoord buiten het hoofdcluster van de pagina, of is het er maar een klein deel van,
  // dan beschermen we title en H1: die moeten het hoofdonderwerp blijven dienen.
  const outsideCluster = !!cluster?.query && pq.length >= 3 && (!cluster.query.inTopic || cluster.query.share < 0.15)
  const protectTitle = signal.gain < 1 || opbouwFase || outsideCluster || (broadPage && (signal.intent === "informatief" || tokens(q || "").length >= 3))
  const onPageSteps = () => {
    if (!q || !target || !audit?.ok) return
    if (localMismatch) { localSteps(); return }
    if (protectTitle && (titleMissing.length || h1Missing.length)) {
      const why = opbouwFase ? "de pagina zit nog in de opbouwfase"
        : signal.gain < 1 ? "de verwachte winst is minder dan één click per maand"
        : outsideCluster ? `het hoofdonderwerp van deze pagina is "${cluster!.topic}"; dit zoekwoord is daar ${cluster!.query!.inTopic ? "maar een klein deel van" : "geen onderdeel van"}`
        : `${target} moet een breder onderwerp blijven dekken dan dit ene zoekwoord`
      findings.push({ tone: "aanwijzing", text: `Title en H1 niet aanpassen voor "${q}": ${why}. Een exacte longtail in title én H1 kan de pagina voor haar hoofdonderwerp juist verzwakken.` })
      steps.push({
        title: `Beantwoord "${q}" in een eigen alinea op ${target}`,
        detail: "Een tussenkop en een kort, concreet antwoord in de tekst helpt Google het zoekwoord te koppelen, zonder de title en H1 van de pagina te veranderen.",
      })
      return
    }
    if (titleMissing.length) {
      const suggestion = `${capitalize(q)}${place && !normalize(q).includes(normalize(place)) ? ` in ${place}` : ""} | Gijs`
      steps.push({
        title: `Zet "${q}" vooraan in de title van ${target}`,
        detail: `Nu: "${audit.title || "(geen title)"}". Bijvoorbeeld: "${suggestion}", aangevuld met wat Gijs daar concreet doet. Houd het onder 60 tekens.`,
      })
    }
    if (h1Missing.length && audit.h1.length) {
      steps.push({ title: `Neem "${q}" op in de H1`, detail: `Nu: "${audit.h1[0]}". De H1 vertelt Google en de bezoeker waar de pagina over gaat.` })
    } else if (!audit.h1.length) {
      steps.push({ title: `Geef ${target} één H1-kop met "${q}"` })
    }
  }

  const linkStep = () => {
    if (localMismatch) return
    const sources = linkSources()
    if (!target || !q) return
    if (sources.length) {
      steps.push({
        title: `Link vanaf ${sources.join(" en ")} naar ${target}`,
        detail: `Gebruik natuurlijke, wisselende linkteksten, bijvoorbeeld "${q}"${place ? ` of "${q.replace(new RegExp(place, "i"), "").trim() || q} in ${place}"` : ""} of de naam van de pagina, niet overal exact hetzelfde zoekwoord. Interne links vanaf gerelateerde pagina's zijn de snelste manier om een pagina een paar posities te laten stijgen.`,
      })
    } else {
      steps.push({ title: `Voeg interne links naar ${target} toe`, detail: `Vanaf pagina's die over hetzelfde onderwerp gaan, met de linktekst "${q}".` })
    }
  }

  const contentStep = () => {
    if (localMismatch || !target || !audit?.ok || !q) return
    if (audit.wordCount < 450) {
      steps.push({
        title: `Breid ${target} uit met inhoud over "${q}"`,
        detail: `${place ? `Schrijf specifiek over ${place}: welke woningen daar veel voorkomen, wat de aanpak kost, welke subsidie er geldt en een voorbeeld uit de buurt. ` : ""}Nu ±${num(audit.wordCount)} woorden. Unieke, lokale informatie weegt zwaarder dan meer woorden.`,
      })
    }
  }

  const brand = isBrandQuery(q || undefined)
  if (brand) {
    findings.push({
      tone: "aanwijzing",
      text: `"${q}" is een merkzoekwoord: mensen zoeken Gijs zelf.${/\bgijs\b/i.test(q || "") && !/groen/i.test(q || "") ? " \"Gijs\" is ook een voornaam en komt in andere bedrijfsnamen voor, dus je concurreert met sites die niets met verduurzaming te maken hebben." : ""}`,
    })
  }

  switch (brand ? "merk" : signal.kind) {
    case "merk": {
      steps.push({
        title: `Zoek zelf op "${q}" en kijk wat erboven staat`,
        detail: "Staan er andere bedrijven of personen met dezelfde naam boven, dan is de daling geen probleem van je eigen site. Staat er een oude of verkeerde pagina van Gijs, dan is dat wel iets om op te lossen.",
      })
      steps.push({
        title: "Houd 'Groen in je straat' zichtbaar naast 'Gijs'",
        detail: "In title, H1 en vermeldingen elders (Google Bedrijfsprofiel, sociale media). Zo koppelt Google de naam Gijs aan jullie en niet aan anderen.",
      })
      break
    }
    case "kans":
    case "stijger":
    case "trend-stijgend":
    case "analyse":
      onPageSteps(); linkStep(); contentStep()
      break
    case "ctr":
    case "pagina": {
      const t = target || signal.page
      if (audit?.ok) {
        steps.push({
          title: `Herschrijf de title van ${t}`,
          detail: `Nu: "${audit.title || "(geen title)"}". Begin met waar mensen op zoeken${q ? ` ("${q}")` : pq[0] ? ` ("${pq[0].query}")` : ""} en geef een reden om te klikken, bijvoorbeeld de gratis energiescan.`,
        })
        steps.push({
          title: audit.metaDescription ? "Maak de meta description concreter" : "Schrijf een meta description",
          detail: `${audit.metaDescription ? `Nu: "${audit.metaDescription}". ` : ""}120–155 tekens, met het zoekwoord en een concreet voordeel (kosten, besparing, wat de bezoeker krijgt).`,
        })
      } else {
        steps.push({ title: `Controleer title en meta description van ${t}`, detail: "Ze bepalen wat mensen in Google zien en of ze doorklikken." })
      }
      break
    }
    case "daler":
    case "trend-dalend": {
      const drift = history.length >= 3 ? history.find((h, i) => i > 0 && h.position > history[i - 1].position + 1) : undefined
      steps.push({
        title: "Ga na wat er rond het begin van de daling veranderde",
        detail: `${drift ? `De daling begon rond de week van ${dateShort(drift.weekStart)}. ` : ""}Is de pagina toen aangepast, verplaatst of is er een nieuwe pagina over hetzelfde onderwerp bijgekomen?`,
      })
      onPageSteps(); linkStep()
      break
    }
    case "techniek":
      break
    case "eigen":
      steps.push({ title: signal.headline, detail: signal.description })
      break
    case "dubbel": {
      const rel = signal.relatedPages || []
      const main = signal.page || rel[0]
      const others = rel.filter(p => p !== main)
      const checks = detail?.redirects || []
      // Waar komt elke URL uiteindelijk uit? Als alles op één pagina eindigt, is het al opgelost.
      const finals = rel.map(p => checks.find(c => c.path === p)?.finalPath ?? p)
      const unique = [...new Set(finals)]
      for (const c of checks) {
        if (c.redirected) findings.push({ tone: "feit", text: `${c.path} verwijst al door naar ${c.finalPath}.` })
        else if (c.status) findings.push({ tone: "feit", text: `${c.path} bestaat als losse pagina (HTTP ${c.status}).` })
      }
      if (signal.resolved || (checks.length === rel.length && unique.length === 1)) {
        const oldUrls = rel.filter(p => p !== (unique.length === 1 ? unique[0] : main))
        findings.push({ tone: "aanwijzing", text: "Search Console toont een oude URL nog enkele weken na een doorverwijzing. Dat verdwijnt vanzelf." })
        steps.push({
          title: "Niets aanpassen: de doorverwijzing staat al",
          detail: `Controleer over ±4 weken in SEO-analyses of ${oldUrls.join(" en ")} uit de pagina's verdwenen is.`,
        })
        break
      }
      steps.push({
        title: `Kies ${main} als hoofdpagina`,
        detail: `Dit is de pagina met de meeste vertoningen die niet doorverwijst${m.position ? ` (positie ${pos(m.position)})` : pageRow(main) ? ` (${pos(pageRow(main)!.position)})` : ""}.`,
      })
      steps.push({
        title: `Stuur ${others.join(" en ")} door naar ${main}`,
        detail: "Met een permanente doorverwijzing (301) of, als de pagina moet blijven bestaan, een canonical naar de hoofdpagina. Laat dit uitvoeren door wie de site beheert.",
      })
      break
    }
  }
  if (!steps.length) steps.push({ title: "Bekijk de pagina zelf", detail: "De data geeft geen eenduidige technische oorzaak. Kijk of de inhoud nog klopt met wat mensen zoeken." })

  // ── Verwacht resultaat
  const gainText = gainRange(signal.gain)
  const expected: string[] = []
  if (signal.kind === "ctr" || signal.kind === "pagina") {
    const exp = m.position ? ctx.model.at(m.position) : 0
    expected.push(`Als de doorklik naar het gemiddelde voor positie ${pos(m.position)} gaat (±${pct(exp)}), levert dat ${gainText} op.`)
  } else if (signal.kind === "techniek") {
    expected.push("Geen directe clicks, wel een randvoorwaarde: zolang Google op foutpagina's of niet-geïndexeerde pagina's stuit, hebben inhoudelijke verbeteringen minder effect.")
  } else if (signal.kind === "dubbel") {
    expected.push(`Eén sterke pagina in plaats van twee halve: naar verwachting stijgt de hoofdpagina, goed voor ${gainText}.`)
  } else if (signal.kind === "trend-dalend" || signal.kind === "daler") {
    expected.push(`Terug naar positie ${pos(m.prevPosition)} betekent ${gainText}.`)
    if ((m.position || 0) > 20 && (m.prevPosition || 0) > 20) expected.push("Beide posities liggen voorbij pagina 2: het belang zit in zichtbaarheid, niet in directe clicks.")
  } else if (m.position) {
    const to = m.position <= 10.5 ? 5 : m.position <= 20 ? 8 : Math.max(1, m.position - 5)
    const g = gainFromMove(ctx.model, m.impressions || 0, m.position, to)
    expected.push(`Van positie ${pos(m.position)} naar ±${pos(to)} levert ${gainRange(g)} op, bij gelijkblijvende vertoningen.`)
  }
  expected.push("Indicatief, op basis van de gemiddelde doorklik per positie. Google verwerkt aanpassingen meestal binnen 2 tot 6 weken.")

  // ── Soort aanpassing en meetplan (succescriterium past bij de aanpassing)
  const spoedFound = findings.some(f => f.tone === "spoed")
  const indexIssue = findings.some(f => f.tone === "spoed" && /^Indexering/.test(f.text))
  const alreadyResolved = signal.kind === "dubbel" && steps[0]?.title.startsWith("Niets aanpassen")
  const actionType: ActionType =
    alreadyResolved ? "geen"
    : signal.kind === "techniek" ? (signal.tech?.type === "niet-geindexeerd" ? "indexering" : "technisch")
    : spoedFound && !indexIssue ? "technisch"
    : indexIssue ? "indexering"
    : signal.kind === "eigen" ? (q || target ? "ranking" : "handmatig")
    : brand ? "merk"
    : signal.kind === "dubbel" ? "consolidatie"
    : signal.kind === "ctr" || signal.kind === "pagina" ? "snippet"
    : "ranking"
  const successMetric = SUCCESS_METRIC[actionType]
  // Inspanning en risico van precies deze aanpassing
  const titleChange = steps.some(st => /title|H1/i.test(st.title) && !/níet|niet aanpassen/i.test(st.title))
  const contentWork = steps.some(st => /^Breid|eigen plek|unieke/i.test(st.title))
  const ER: Record<ActionType, [Level, Level]> = {
    technisch: ["middel", "laag"], indexering: ["laag", "laag"], consolidatie: ["middel", "middel"],
    snippet: ["laag", "middel"], handmatig: [signal.effort || "middel", signal.risk || "laag"], ranking: [contentWork ? "middel" : "laag", titleChange ? "middel" : "laag"], merk: ["laag", "laag"], geen: ["laag", "laag"],
  }
  const [effort, risk] = ER[actionType]
  const plan = measurePlan(actionType, { page: target, query: q, count: signal.tech?.pages.length })
  const measurement = [plan.success]

  // ── Oordeel: eerlijk over bewijs
  const spoed = spoedFound
  const alreadyHandled = alreadyResolved
  let verdict: Diagnosis["verdict"]
  if (alreadyHandled) {
    verdict = { kind: "afwachten", label: "Al opgelost", text: `${signal.resolved || "De doorverwijzing staat al."} Er hoeft niets te gebeuren: controleer en sluit dit advies.` }
  } else if (signal.kind === "eigen" && !spoed) {
    verdict = { kind: "inplannen", label: "Eigen taak", text: "Door jou toegevoegd. De diagnose hieronder helpt bij de uitvoering." }
  } else if (spoed) {
    verdict = { kind: "spoed", label: "Spoed", text: "Er is een technische blokkade gevonden. Los die eerst op; daarna pas inhoudelijke aanpassingen." }
  } else if (opbouwFase && ["daler", "trend-dalend", "pagina", "analyse"].includes(signal.kind)) {
    verdict = { kind: "afwachten", label: "In opbouw", text: "De pagina is nieuw. Schommelingen en weinig vertoningen zijn in deze fase normaal: controleer de basis (indexering, interne links, unieke inhoud) en beoordeel prestaties pas na de opbouwfase." }
  } else if (signal.evidence === "zwak" && signal.gain < 0.5) {
    verdict = { kind: "afwachten", label: "Nog afwachten", text: "Te weinig vertoningen en te weinig te winnen om nu iets te veranderen. Kies 'Onvoldoende bewijs' of stel het uit." }
  } else if (signal.gain < 0.2 && signal.kind !== "dubbel") {
    verdict = { kind: "afwachten", label: "Lage impact", text: "Weinig directe winst. Alleen oppakken als het in een bredere aanpassing van deze pagina meeloopt." }
  } else {
    verdict = { kind: "inplannen", label: "Inplannen", text: "Concrete aanpassing met een redelijke kans op winst. Plan het in als taak." }
  }

  const importance = {
    gainText: signal.kind === "techniek" ? "Randvoorwaarde: geen directe clicks, wel nodig voordat andere verbeteringen effect hebben" : capitalize(gainText),
    relativeText: signal.priorityRank
      ? `Prioriteit ${signal.priority}: nummer ${signal.priorityRank} van ${ctx.signalCount} signalen, gerangschikt op verwachte winst × bewijskracht × zoekintentie × inspanning × risico${signal.conversions?.keyEvents ? " × conversies (GA4)" : ""}.${signal.rejectedSimilar ? ` Je wees ${signal.rejectedSimilar} vergelijkbare ${signal.rejectedSimilar === 1 ? "advies" : "adviezen"} eerder af; dat telt mee (×${Math.max(0.5, Math.pow(0.85, signal.rejectedSimilar)).toFixed(2).replace(".", ",")}).` : ""}${signal.lesson ? ` Geleerd uit eerdere metingen: ${signal.lesson.title.charAt(0).toLowerCase() + signal.lesson.title.slice(1)} (×${signal.lesson.factor.toFixed(2).replace(/0$/, "").replace(".", ",")}; terug te draaien op "Wat hebben we geleerd?").` : ""}`
      : "Eigen analyse: geen automatische prioriteit.",
    evidenceText: `Bewijskracht ${signal.evidence}. ${signal.evidenceReason}`,
    visibilityText: m.impressions ? `${num(m.impressions)} keer vertoond in 28 dagen.` : "Geen vertoningen in de laatste 28 dagen.",
  }

  return {
    situation, target, facts,
    history: (detail?.history || []).map(h => ({ weekStart: h.weekStart, position: h.position, impressions: h.impressions })),
    importance, verdict, findings, steps: steps.slice(0, 5), expected, measurement, successMetric, actionType, plan,
    effort, risk, cluster,
  }
}

// Nulmeting: legt vast wat bij dit soort aanpassing gemeten wordt, met de scope erbij.
export function baselineFrom(signal: Signal, detail: AdviceDetail | null, diag: Pick<Diagnosis, "successMetric" | "actionType" | "target">, targetRow?: (MetricSet & { path: string }) | null) {
  const m = signal.metrics
  const base: Record<string, unknown> = {
    position: m.position ?? null,
    impressions: m.impressions ?? null,
    clicks: m.clicks ?? null,
    ctr: m.ctr ?? null,
    window: "28d",
    windowStart: signal.scope?.window?.startDate ?? detail?.window?.startDate ?? null,
    windowEnd: signal.scope?.window?.endDate ?? detail?.window?.endDate ?? null,
    scope: signal.scope?.kind ?? null,
    successMetric: diag.successMetric,
    actionType: diag.actionType,
    source: signal.scope?.source === "live" ? "search-console" : signal.scope?.source ?? "signaal",
    capturedAt: new Date().toISOString(),
    predictedGain: signal.estimate ? Math.round(signal.estimate.gain * 10) / 10 : null,
  }
  if (signal.query && diag.target) {
    base.targetPage = diag.target
    base.pairPosition = targetRow?.position ?? null
    base.pairImpressions = targetRow?.impressions ?? null
  }
  if (signal.kind === "dubbel") {
    base.pages = (detail?.relatedTotals || []).map(t => ({ path: t.path, impressions: t.cur?.impressions ?? 0, clicks: t.cur?.clicks ?? 0, position: t.cur?.position ?? null }))
    base.mainPage = signal.page ?? null
  }
  if (signal.kind === "techniek" && signal.tech) {
    base.paths = signal.tech.pages.map(p => p.path)
    base.count = signal.tech.pages.length
  }
  return base
}

export function buildClaudePrompt(signal: Signal, diag: Diagnosis) {
  const lines = [
    "Ik beheer het SEO-dashboard van groeninjestraat.nl (Gijs: verduurzaming van woningen — isolatie, zonnepanelen, warmtepompen — met regiopagina's in vooral Overijssel en Gelderland).",
    "Help me met een kritische tweede blik op dit advies. Gebruik alleen de cijfers hieronder en zeg het als iets niet uit de data volgt.",
    "",
    `ONDERWERP: ${signal.query ? `zoekwoord "${signal.query}"` : `pagina ${signal.page}`}${diag.target ? ` · pagina ${diag.target}` : ""}`,
    `SIGNAAL: ${signal.title}`,
    `WAT SPEELT ER: ${diag.situation}`,
    "",
    "CIJFERS (laatste 28 dagen)",
    ...diag.facts.map(f => `- ${f.label}: ${f.value}${f.sub ? ` (${f.sub})` : ""}`),
    "",
    "BEVINDINGEN",
    ...diag.findings.map(f => `- [${f.tone}] ${f.text}`),
    "",
    "VOORGESTELDE STAPPEN",
    ...diag.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ""}`),
    "",
    "VRAAG",
    "1. Klopt de diagnose, of zie je een andere verklaring die beter bij deze cijfers past?",
    "2. Welke stap zou jij als eerste doen, en waarom?",
    "3. Schrijf voor de belangrijkste stap een concreet voorstel (bijvoorbeeld de nieuwe title en meta description).",
  ]
  return lines.join("\n")
}
