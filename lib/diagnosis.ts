import type { AdviceDetail, GscRow, Signal, SignalKind } from "./types"
import type { CtrModel } from "./ctr"
import { gainFromMove } from "./ctr"
import { capitalize, dateShort, normalize, num, pct, pos } from "./format"
import { isBrandQuery, toPath } from "./signals"

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
  successMetric: "position" | "ctr"
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

function successMetricFor(kind: SignalKind): "position" | "ctr" {
  return kind === "ctr" || kind === "pagina" ? "ctr" : "position"
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

  // ── Cijfers: actuele detaildata gaat voor, anders de cijfers van het signaal
  const cur = (q ? detail?.queryTotals?.cur : detail?.pageTotals?.cur) || null
  const prev = (q ? detail?.queryTotals?.prev : detail?.pageTotals?.prev) || null
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
          detail: `Laat ${others.join(", ")} naar ${intended.path} linken met de linktekst "${q}". Zo weet Google welke pagina het antwoord is. Haal "${q}" niet uit die pagina's weg; ze blijven nuttig voor hun eigen wijk of onderwerp.`,
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

  // ── Bevindingen: waar rankt de pagina verder op
  const pq = detail?.pageQueries || []
  if (target && pq.length && q) {
    const own = pq.findIndex(r => r.query === q)
    const best = pq[0]
    if (own === -1 || own > 2) {
      findings.push({ tone: "aanwijzing", text: `${target} wordt vooral vertoond voor "${best.query}" (${num(best.impressions)} vertoningen). "${q}" is voor deze pagina bijzaak.` })
    }
  }
  if (signal.kind === "pagina" && pq.length) {
    findings.push({ tone: "feit", text: `Deze pagina verschijnt vooral voor: ${pq.slice(0, 3).map(r => `"${r.query}" (positie ${pos(r.position)})`).join(", ")}.` })
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

  const onPageSteps = () => {
    if (!q || !target || !audit?.ok) return
    if (localMismatch) { localSteps(); return }
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
        detail: `Gebruik een linktekst als "${q}"${place ? ` of "${q.replace(new RegExp(place, "i"), "").trim() || q} in ${place}"` : ""}. Interne links vanaf gerelateerde pagina's zijn de snelste manier om een pagina een paar posities te laten stijgen.`,
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
      if (checks.length === rel.length && unique.length === 1) {
        const oldUrls = rel.filter(p => p !== unique[0])
        findings.push({ tone: "aanwijzing", text: "Search Console toont een oude URL nog enkele weken na een doorverwijzing. Dat verdwijnt vanzelf." })
        steps.push({
          title: "Niets aanpassen: de doorverwijzing staat al",
          detail: `Controleer over ±4 weken in SEO-analyses of ${oldUrls.join(" en ")} uit de pagina's verdwenen is.`,
        })
        break
      }
      steps.push({
        title: `Kies ${main} als hoofdpagina`,
        detail: `Dit is de pagina met de beste positie${pageRow(main) ? ` (${pos(pageRow(main)!.position)})` : ""}.`,
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

  // ── Meetplan
  const successMetric = successMetricFor(signal.kind)
  const measurement = [
    "Als je het advies als uitgevoerd markeert, wordt de nulmeting vastgelegd: positie, vertoningen, clicks en doorklik.",
    "Daarna meet het dashboard automatisch na 14, 28 en 56 dagen.",
    successMetric === "ctr"
      ? "Geslaagd als de doorklik na 56 dagen minstens 20% hoger ligt dan bij de nulmeting."
      : "Geslaagd als de gemiddelde positie na 56 dagen minstens 0,5 beter is dan bij de nulmeting.",
  ]

  // ── Oordeel: eerlijk over bewijs
  const spoed = findings.some(f => f.tone === "spoed")
  const alreadyHandled = signal.kind === "dubbel" && steps[0]?.title.startsWith("Niets aanpassen")
  let verdict: Diagnosis["verdict"]
  if (alreadyHandled) {
    verdict = { kind: "afwachten", label: "Al opgelost", text: "De doorverwijzing staat al. Wijs dit advies af of markeer het als onvoldoende bewijs; er hoeft niets te gebeuren." }
  } else if (spoed) {
    verdict = { kind: "spoed", label: "Spoed", text: "Er is een technische blokkade gevonden. Los die eerst op; daarna pas inhoudelijke aanpassingen." }
  } else if (signal.evidence === "zwak" && signal.gain < 0.5) {
    verdict = { kind: "afwachten", label: "Nog afwachten", text: "Te weinig vertoningen en te weinig te winnen om nu iets te veranderen. Kies 'Onvoldoende bewijs' of stel het uit." }
  } else if (signal.gain < 0.2 && signal.kind !== "dubbel") {
    verdict = { kind: "afwachten", label: "Lage impact", text: "Weinig directe winst. Alleen oppakken als het in een bredere aanpassing van deze pagina meeloopt." }
  } else {
    verdict = { kind: "inplannen", label: "Inplannen", text: "Concrete aanpassing met een redelijke kans op winst. Plan het in als taak." }
  }

  const importance = {
    gainText: capitalize(gainText),
    relativeText: signal.priorityRank
      ? `Prioriteit ${signal.priority}: nummer ${signal.priorityRank} van ${ctx.signalCount} signalen, gerangschikt op verwachte winst × bewijskracht × zoekintentie.`
      : "Eigen analyse: geen automatische prioriteit.",
    evidenceText: `Bewijskracht ${signal.evidence}. ${signal.evidenceReason}`,
    visibilityText: m.impressions ? `${num(m.impressions)} keer vertoond in 28 dagen.` : "Geen vertoningen in de laatste 28 dagen.",
  }

  return {
    situation, target, facts,
    history: (detail?.history || []).map(h => ({ weekStart: h.weekStart, position: h.position, impressions: h.impressions })),
    importance, verdict, findings, steps: steps.slice(0, 5), expected, measurement, successMetric,
  }
}

export function baselineFrom(signal: Signal, detail: AdviceDetail | null, successMetric: "position" | "ctr") {
  const cur = (signal.query ? detail?.queryTotals?.cur : detail?.pageTotals?.cur) || null
  return {
    position: cur?.position ?? signal.metrics.position ?? null,
    impressions: cur?.impressions ?? signal.metrics.impressions ?? null,
    clicks: cur?.clicks ?? signal.metrics.clicks ?? null,
    ctr: cur?.ctr ?? signal.metrics.ctr ?? null,
    window: "28d",
    windowEnd: detail?.window?.endDate ?? null,
    successMetric,
    source: cur ? "search-console" : "signaal",
  }
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
