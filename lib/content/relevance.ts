// Relevantie-check voor een contentkans, vóór er tijd in schrijven gaat. Net als de briefing:
// een volledige, op zichzelf staande prompt die via het klembord naar Claude gaat (geen betaalde
// API, geen koppeling nodig). Het oordeel wordt daarna hier vastgelegd.

import { type ContentIdea, IMPACT_META, ORIGIN_META, RELIABILITY_META, serviceLabel, STATUS_META } from "./model"

const SITE = "https://www.groeninjestraat.nl"
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "datum onbekend")
const nl = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(n * 10) / 10).replace(".", ","))

// Andere kansen over hetzelfde onderwerp: zelfde dienst of zelfde doelpagina
export function relatedIdeas(idea: ContentIdea, all: ContentIdea[]) {
  return all.filter(o => o.id !== idea.id && ((idea.service && o.service === idea.service) || (idea.target_page && o.target_page === idea.target_page)))
}

export function buildRelevancePrompt(idea: ContentIdea, all: ContentIdea[] = []): string {
  const L: string[] = []
  const update = idea.advice === "bijwerken"
  L.push(`Je bent een kritische contentstrateeg en adviseur voor Gijs – Groen in je straat (${SITE}). Gijs helpt particuliere woningeigenaren in Overijssel, Gelderland, Utrecht en Flevoland hun huis te verduurzamen: een onafhankelijke energiescan als startpunt, daarna isolatie (spouwmuur, vloer, dak, glas), warmtepompen en zonnepanelen, met begeleiding van A tot Z.`)
  L.push("")
  L.push(`VRAAG: is deze contentkans relevant genoeg om ${update ? "de bestaande pagina voor bij te werken" : "een artikel over te schrijven"}? Het team is klein; elke uur schrijven moet iets opleveren (bezoekers uit Google die bij Gijs passen, en uiteindelijk aanvragen voor een energiescan). Wees eerlijk en kritisch: "niet doen" is een goed antwoord als het zo is.`)
  L.push("")
  L.push("DE CONTENTKANS")
  L.push(`Titel: ${idea.title}`)
  L.push(`Soort: ${update ? `bestaande pagina bijwerken${idea.target_page ? ` (${SITE}${idea.target_page})` : ""}` : `nieuw artikel${idea.format ? ` (${idea.format.toLowerCase()})` : ""}`}`)
  L.push(`Gevonden via: ${ORIGIN_META[idea.origin].label.toLowerCase()}, op ${date(idea.created_at)}`)
  L.push(`Dienst van Gijs: ${serviceLabel(idea.service)}`)
  if (idea.regions?.length) L.push(`Regio: ${idea.regions.join(", ")}`)
  L.push(`Doelgroep: ${idea.audience || "particuliere woningeigenaren"}`)
  if (idea.impact) L.push(`Soort onderwerp: ${IMPACT_META[idea.impact].label.toLowerCase()}`)
  if (idea.shelf_life) L.push(`Houdbaarheid: ${idea.shelf_life === "actueel" ? "actueel (nieuws, veroudert snel)" : "evergreen (blijft lang relevant)"}`)
  L.push(`Waarom nu (volgens het dashboard): ${idea.why_now || "—"}`)
  if (idea.summary) L.push(`Samenvatting: ${idea.summary}`)
  if (idea.goal) L.push(`Doel: ${idea.goal}`)
  L.push("")
  L.push("BRONNEN")
  if (idea.sources.length) idea.sources.forEach((s, i) => L.push(`${i + 1}. ${s.publisher} (${(RELIABILITY_META[s.reliability]?.label || s.reliability).toLowerCase()}), ${date(s.date)}${s.firstSeen ? " (datum = moment van vinden)" : ""}: ${s.title}${s.url ? ` – ${s.url}` : ""}`))
  else L.push("Geen bronnen vastgelegd.")
  L.push("")
  L.push("ZOEKVRAAG (Google Search Console van groeninjestraat.nl, laatste 28 dagen)")
  if (idea.keywords?.length) {
    const tot = idea.keywords.reduce((s, k) => s + (k.impressions || 0), 0)
    idea.keywords.slice(0, 12).forEach(k => L.push(`- "${k.query}": ${k.impressions} vertoningen, ${k.clicks} klikken${k.position ? `, Gijs gemiddeld op positie ${nl(k.position)}` : ""}`))
    L.push(`Totaal: ${tot} vertoningen op ${idea.keywords.length} zoekwoorden.`)
  } else L.push("Geen zoekwoorden gekoppeld: er is (nog) geen gemeten zoekvraag naar dit onderwerp op de site.")
  L.push("")
  L.push(`SCORE VAN HET DASHBOARD: ${idea.score_override ?? idea.score} van 100${idea.score_override !== null ? ` (handmatig aangepast; berekend was ${idea.score})` : ""}`)
  ;(idea.score_parts || []).forEach(p => L.push(`- ${p.label}: ${p.points} van ${p.max}${p.basis ? ` (${p.basis})` : ""} – ${p.why}`))
  L.push("")
  L.push("BESTAANDE CONTENT OP DE SITE")
  if (idea.advice_note) L.push(idea.advice_note)
  if (idea.target_page) L.push(`Meest passende bestaande pagina: ${SITE}${idea.target_page}`)
  if (idea.related_pages?.length) L.push(`Verwante pagina's: ${idea.related_pages.map(p => SITE + p).join(", ")}`)
  if (!idea.advice_note && !idea.target_page && !idea.related_pages?.length) L.push("Geen bestaande pagina gevonden over dit onderwerp.")
  const rel = relatedIdeas(idea, all)
  const done = rel.filter(o => ["gepubliceerd", "goedgekeurd", "review", "concept", "briefing", "geaccepteerd"].includes(o.status))
  const rejected = rel.filter(o => o.status === "afgewezen")
  if (done.length) {
    L.push("")
    L.push("AL GESCHREVEN OF IN PRODUCTIE OVER DEZELFDE DIENST OF PAGINA")
    done.slice(0, 8).forEach(o => L.push(`- ${o.title} (${STATUS_META[o.status].label.toLowerCase()}${o.published_url ? `: ${o.published_url}` : ""})`))
  }
  if (rejected.length) {
    L.push("")
    L.push("EERDER AFGEWEZEN VERGELIJKBARE KANSEN (en waarom)")
    rejected.slice(0, 8).forEach(o => {
      const why = [...new Set(o.feedback.map(f => f.tag))].join(", ")
      const note = o.feedback.map(f => f.note).find(Boolean) || o.decision_note
      L.push(`- ${o.title}${why ? ` – reden: ${why}` : ""}${note ? ` ("${note}")` : ""}`)
    })
  }
  L.push("")
  L.push("BEOORDEEL KRITISCH")
  L.push("1. Klopt de aanleiding nog? Open de bronnen en zoek zo nodig zelf op het web of er nieuwer nieuws, een besluit of een correctie is. Is de bron betrouwbaar en recent genoeg?")
  L.push("2. Past het bij Gijs: gaat het over een dienst van Gijs, voor huiseigenaren in Overijssel, Gelderland, Utrecht of Flevoland? Of is het te landelijk, te technisch, te niche of eigenlijk voor huurders, bedrijven of installateurs?")
  L.push("3. Is er echte vraag? Kijk naar de zoekwoorden en vertoningen. Weinig vertoningen kan nog steeds de moeite waard zijn bij een actueel of commercieel belangrijk onderwerp, maar zeg dat dan expliciet.")
  L.push(`4. Overlap: bestaat er al een pagina of artikel dat dit dekt? Is ${update ? "bijwerken van die pagina" : "een nieuw artikel"} dan de juiste vorm, of ${update ? "juist een eigen artikel" : "beter de bestaande pagina bijwerken"} (zodat eigen pagina's niet met elkaar concurreren)?`)
  L.push("5. Klopt de score met de onderbouwing, of lijkt hij hoger (of lager) dan de aanleiding rechtvaardigt?")
  L.push("6. Leidt het logisch naar een energiescan of een dienst van Gijs, zonder geforceerd te zijn?")
  L.push("")
  L.push("ANTWOORD IN DEZE VORM")
  L.push("OORDEEL: relevant / twijfel / niet relevant")
  L.push("TOELICHTING: drie tot zes zinnen, concreet, met de doorslaggevende reden eerst.")
  L.push("ALS HET DOORGAAT: de beste invalshoek en vorm in één zin (of: welke bestaande pagina bijwerken).")
  L.push("NOG UITZOEKEN: wat moet er eerst gecontroleerd worden (of: niets).")
  return L.join("\n")
}
