// Briefing voor een contentkans. De briefing gaat via het klembord naar claude.ai
// (geen betaalde API). Hij bevat alles wat de schrijver nodig heeft: aanleiding,
// bronnen met datum, doelgroep, dienst, zoekwoorden, structuur en de regels van Gijs.

import { type ContentIdea, ANGLE_META, serviceLabel } from "./model"

const SITE = "https://www.groeninjestraat.nl"

function date(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "datum onbekend"
}

export function buildBriefing(idea: ContentIdea, learned: string[] = []): string {
  const L: string[] = []
  L.push(`Je schrijft als contentredacteur voor Gijs – Groen in je straat (${SITE}). Gijs helpt particuliere woningeigenaren hun huis te verduurzamen, met een energiescan (digitaal of bij je thuis) als startpunt, en voert daarna isolatie- en installatiemaatregelen uit.`)
  L.push("")
  L.push(`OPDRACHT: schrijf een concept voor een ${idea.format?.toLowerCase() || "artikel"}.`)
  L.push(`Werktitel: ${idea.title}`)
  if (idea.title_options?.length) L.push(`Titelopties per invalshoek: ${idea.title_options.map(o => `[${ANGLE_META[o.angle].label}] ${o.title}`).join(" | ")}`)
  L.push(`Gekozen invalshoek: ${idea.angle ? ANGLE_META[idea.angle].label.toLowerCase() : "neutraal"}`)
  L.push("")
  L.push(`WAAROM NU: ${idea.why_now || ""}`)
  if (idea.summary) L.push(`Samenvatting van de aanleiding: ${idea.summary}`)
  L.push("")
  L.push("BRONNEN (gebruik voor feiten alleen deze bronnen of de oorspronkelijke bron waarnaar ze verwijzen; open de links en controleer):")
  idea.sources.forEach((s, i) => L.push(`${i + 1}. ${s.publisher}, ${date(s.date)}${s.firstSeen ? " (datum = moment van vinden)" : ""}: ${s.title}${s.url ? ` – ${s.url}` : ""}`))
  L.push("")
  L.push(`DOELGROEP: ${idea.audience || "Particuliere woningeigenaren"}.`)
  L.push(`DIENST VAN GIJS: ${serviceLabel(idea.service)}${idea.target_page ? ` (pagina: ${SITE}${idea.target_page})` : ""}.`)
  if (idea.regions?.length) L.push(`REGIO: ${idea.regions.join(", ")}.`)
  L.push(`DOEL: ${idea.goal || ""}`)
  L.push(`CALL-TO-ACTION: ${idea.cta || "Plan een energiescan"}.`)
  if (idea.keywords?.length) {
    L.push("")
    L.push("ZOEKWOORDEN waarop mensen nu zoeken (Search Console, 28 dagen; verwerk de belangrijkste natuurlijk in titel, tussenkoppen en tekst):")
    idea.keywords.slice(0, 8).forEach(k => L.push(`- ${k.query} (${k.impressions} vertoningen${k.position ? `, positie ${String(k.position).replace(".", ",")}` : ""})`))
  }
  L.push("")
  L.push(`BESTAANDE CONTENT: ${idea.advice_note || ""}`)
  if (idea.related_pages?.length) L.push(`Link waar het logisch is naar: ${idea.related_pages.map(p => SITE + p).join(", ")}.`)
  L.push("")
  L.push("STRUCTUUR:")
  L.push("1. Herkenbaar probleem of actuele aanleiding.")
  L.push("2. Waarom dit belangrijk is voor woningeigenaren.")
  L.push("3. Feiten, gevolgen en de nodige nuance (met bron en datum bij bedragen, regels en technische claims).")
  L.push("4. Mogelijke oplossingen of keuzes.")
  L.push("5. Wanneer welke oplossing past.")
  L.push("6. Hoe een energiescan duidelijkheid geeft.")
  L.push("7. Welke diensten van Gijs hierbij aansluiten.")
  L.push("8. Een passende vervolgstap (de call-to-action), inhoudelijk logisch en niet losstaand.")
  L.push("")
  L.push("REGELS:")
  L.push("- Schrijf in helder Nederlands, je-vorm, zonder vakjargon of met uitleg erbij.")
  L.push("- Een stevige kop mag, maar het artikel is nooit onnodig angstig of misleidend: altijd nuance en een praktische oplossing.")
  L.push("- Verzin geen bedragen, percentages, data of voorwaarden. Staat iets niet in de bronnen, zet dan [CHECK: …] in de tekst.")
  L.push("- Is iets een voorstel en nog geen besluit, schrijf dat dan zo.")
  L.push("- Commerciële verwijzingen naar Gijs alleen waar ze inhoudelijk logisch zijn.")
  idea.risks?.forEach(r => L.push(`- ${r}`))
  if (learned.length) {
    L.push("")
    L.push("LESSEN UIT EERDERE CORRECTIES VAN DE REDACTIE:")
    learned.forEach(l => L.push(`- ${l}`))
  }
  L.push("")
  L.push("LEVER:")
  L.push("- 3 titelopties (positief, probleemgericht, neutraal) en een meta description van max. 155 tekens;")
  L.push("- een korte intro;")
  L.push("- het artikel met H2-tussenkoppen;")
  L.push("- 3 veelgestelde vragen met korte antwoorden;")
  L.push("- een afsluitend call-to-action-blok;")
  L.push("- onderaan: een lijst met alle feiten die de redactie moet controleren, met de bron per feit.")
  return L.join("\n")
}

// Lessen uit menselijke feedback: welke correcties komen vaker voor?
const LESSON: Record<string, string> = {
  "technisch onjuist": "Technische uitspraken zijn eerder gecorrigeerd: blijf voorzichtig en markeer twijfel met [CHECK].",
  "onvoldoende onderbouwd": "Onderbouw elke bewering met een bron of een concreet voorbeeld.",
  "te commercieel": "Houd de commerciële verwijzing kort en pas aan het eind; de uitleg staat voorop.",
  "te negatief": "Balanceer problemen met concrete oplossingen; vermijd een angstige toon.",
  "te algemeen": "Maak het concreet: voorbeelden van woningtypen, bouwjaren en situaties.",
  "call-to-action verbeteren": "Maak de call-to-action specifieker en laat hem logisch volgen uit het artikel.",
  "verkeerde dienst gekoppeld": "Controleer of de gekoppelde dienst echt de logische oplossing is.",
  "past niet bij Gijs": "Blijf dicht bij wat Gijs doet: energiescan, isolatie en installaties voor particulieren.",
}
export function lessonsFrom(ideas: Pick<ContentIdea, "feedback">[]): string[] {
  const count = new Map<string, number>()
  ideas.forEach(i => (i.feedback || []).forEach(f => count.set(f.tag, (count.get(f.tag) || 0) + 1)))
  return [...count.entries()].filter(([t, n]) => n >= 2 && LESSON[t]).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${LESSON[t]} (${n}× genoemd)`)
}
