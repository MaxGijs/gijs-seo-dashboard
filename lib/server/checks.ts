// Controletaken: alles wat niet (goed) gemeten wordt of niet werkt, wordt een taak bovenaan
// Vandaag en Mijn taken. Elke nacht (en bij openen) opnieuw bepaald; opgelost = taak verdwijnt.

import { getSupabase, supabaseConfigured } from "./guard"
import { ga4Client, readMeasurement } from "./dashboard"
import { sourceOverview } from "./content"
import type { DataCheck } from "@/lib/types"

const JOB_LABEL: Record<string, string> = {
  "gsc-snapshot": "Search Console-snapshot", inventaris: "pagina-inventaris", "http-controle": "HTTP-controle van de pagina's", indexering: "indexeringscontrole",
  experimenten: "metingen van experimenten", actualiteiten: "nieuwsscan", "content-metingen": "metingen van gepubliceerde content", lessen: "berekening van lessen", vrijdagrapport: "vrijdagrapport", meldingen: "controle op meldingen en laadsnelheid",
}

let cache: { at: number; value: DataCheck[] } | null = null

export async function readChecks(fresh = false): Promise<DataCheck[]> {
  if (!fresh && cache && Date.now() - cache.at < 30 * 60e3) return cache.value
  const out: DataCheck[] = []

  // 1. Meting van energiescanaanvragen (GA4)
  try {
    const m = await readMeasurement(ga4Client())
    if (m.status === "geen-event") out.push({
      id: "ga4-aanvragen-geen-event", area: "Meting", severity: "error",
      what: "Energiescanaanvragen worden niet gemeten: GA4 ontvangt geen aanvraag-event.",
      effect: "Het dashboard kan niet zien of meer verkeer ook meer aanvragen oplevert; conversie blijft leeg.",
      steps: [
        { title: "Controleer wat het formulier naar GA4 stuurt", detail: "Doe een testaanvraag via het energiescanformulier en kijk in GA4 bij Rapporten → Realtime welke events binnenkomen." },
        { title: "Laat één vast event versturen na een geslaagde aanvraag", detail: "Bij voorkeur energy_scan_request_submitted, alleen na een geslaagde inzending. Dit doet wie de site of Google Tag Manager beheert." },
        { title: "Markeer het event als key event in GA4", detail: "Beheer → Gebeurtenissen → markeer als key event. Het dashboard telt het daarna automatisch mee." },
      ],
    })
    if (m.status === "controleren") out.push({
      id: "ga4-aanvragen-controleren", area: "Meting", severity: "warning",
      what: `Meting van energiescanaanvragen controleren: ${m.note.replace(/^Het dashboard telt[^.]*\.\s*Wel:\s*/, "")}`,
      effect: "Aanvragen kunnen dubbel of onvolledig geteld worden; het dashboard trekt er daarom nog geen conclusies uit.",
      steps: [
        { title: "Doe één testaanvraag en kijk welke events binnenkomen", detail: "GA4 → Rapporten → Realtime. Noteer welke events één inzending veroorzaakt (bijvoorbeeld lead_created én energyscan_requested)." },
        { title: "Kies één officieel event voor een energiescanaanvraag", detail: "Laat de andere events weg of hernoem ze, zodat één aanvraag één event is. Bij voorkeur energy_scan_request_submitted." },
        { title: "Meet opnieuw vanaf de wijzigingsdatum", detail: "Het dashboard telt per sessie en neemt de wijziging vanzelf mee." },
      ],
    })
    if (m.status === "fout") out.push({
      id: "ga4-niet-bereikbaar", area: "Meting", severity: "error",
      what: "GA4 kan niet worden gelezen.", effect: "Sessies en energiescanaanvragen ontbreken op het dashboard.",
      steps: [{ title: "Geef het service-account leestoegang tot de GA4-property", detail: `${m.note} Op Datastatus staat het e-mailadres van het service-account.` }],
    })
  } catch (e: any) {
    out.push({ id: "ga4-niet-bereikbaar", area: "Meting", severity: "error", what: "GA4 kan niet worden gelezen.", effect: "Sessies en energiescanaanvragen ontbreken op het dashboard.", steps: [{ title: "Controleer de GA4-koppeling", detail: e?.message || "Onbekende fout. Zie Datastatus." }] })
  }

  if (supabaseConfigured()) {
    // 2. Nieuwsbronnen die het niet doen
    try {
      const src = await sourceOverview()
      for (const s of src.filter(x => x.status === "geblokkeerd" || x.status === "storing")) out.push({
        id: `bron-${s.id}`, area: "Nieuwsbronnen", severity: s.status === "geblokkeerd" ? "warning" : "warning",
        what: `Nieuwsbron ${s.name} ${s.status === "geblokkeerd" ? `werkt al ${s.failedRuns} nachten niet` : "gaf de laatste keer een fout"} (${s.lastError || "onbekende fout"}).`,
        effect: "Nieuws uit deze bron komt niet binnen; kansen kunnen worden gemist.",
        steps: [
          { title: "Controleer of de feed nog bestaat", detail: "Open de bron in de browser. Is het adres veranderd, geef dan het nieuwe adres door." },
          { title: "Blijft het mislukken: laat de bron via de wekelijkse webzoektaak lopen", detail: "Dan wordt hij alleen nog op maandag via webonderzoek gelezen." },
        ],
      })
    } catch { /* bronnen niet beschikbaar: geen taak */ }

    // 3. Nachtelijke synchronisaties die mislukten
    const { data: logs } = await getSupabase().from("seo_sync_log").select("job, ok, run_at, error").gte("run_at", new Date(Date.now() - 48 * 3600e3).toISOString()).order("run_at", { ascending: false })
    const latest = new Map<string, { ok: boolean; error: string | null }>()
    for (const l of logs || []) if (!latest.has(l.job)) latest.set(l.job, l)
    for (const [job, l] of latest) if (!l.ok) out.push({
      id: `sync-${job}`, area: "Synchronisatie", severity: job === "gsc-snapshot" ? "error" : "warning",
      what: `De nachtelijke ${JOB_LABEL[job] || job} is mislukt: ${(l.error || "onbekende fout").slice(0, 200)}.`,
      effect: "Een deel van de gegevens op het dashboard is daardoor verouderd.",
      steps: [{ title: "Bekijk de foutmelding op Datastatus", detail: "Vaak lost dit zichzelf op bij de volgende run. Komt dezelfde fout twee nachten terug, laat het dan uitzoeken." }],
    })
  }
  // 4. Meldingen die om een controle vragen (sitebrede daling, indexering, laadsnelheid).
  // Dalingen per pagina of zoekwoord staan al als taak op het bord; die komen hier niet dubbel.
  try {
    const { data: alerts } = await getSupabase().from("seo_alerts").select("key, type, subject, severity, title, detail").is("resolved_at", null).in("type", ["site-daling", "indexering-daling", "snelheid"])
    for (const a of alerts || []) out.push({
      id: `melding-${a.key}`, area: a.type === "snelheid" ? "Laadsnelheid" : "Melding", severity: a.severity === "error" ? "error" : "warning",
      what: `${a.title}.`, effect: a.detail || "",
      steps: a.type === "snelheid" ? [
        { title: "Bekijk de pagina in PageSpeed Insights", detail: `pagespeed.web.dev met ${a.subject}, tabblad Mobiel: onder "Diagnose" staat wat het zwaarst weegt.` },
        { title: "Pak de grootste oorzaak aan", detail: "Meestal: afbeeldingen bovenaan kleiner maken (WebP, juiste afmeting), vaste hoogte voor afbeeldingen en banners, scripts van chat/tracking later laden. Dit doet wie de website bouwt." },
      ] : a.type === "indexering-daling" ? [
        { title: "Kijk in Search Console welke pagina's uit de index zijn", detail: "Indexering → Pagina's: vergelijk 'Niet geïndexeerd' met vorige week en lees de reden (noindex, doorverwijzing, 404, duplicaat)." },
        { title: "Herstel de oorzaak en vraag opnieuw indexering aan", detail: "Na het herstel controleert het dashboard de indexering vanzelf opnieuw." },
      ] : [
        { title: "Zoek uit waar de daling zit", detail: "Bekijk op het dashboard de grootste dalers (zoekwoorden en pagina's) en de grafiek: één pagina, één onderwerp of de hele site?" },
        { title: "Controleer techniek en indexering", detail: "Staat de site goed online, is er iets veranderd (nieuwe versie, doorverwijzingen, robots.txt)? Zie ook Datastatus." },
      ],
    })
  } catch { /* meldingen zijn aanvullend */ }

  cache = { at: Date.now(), value: out }
  return out
}
