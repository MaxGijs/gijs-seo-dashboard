"use client"

import { useEffect, useState } from "react"

interface Row { keys: string[]; clicks: number; impressions: number; position: number; ctr: number }
interface PageRow { keys: string[]; clicks: number; impressions: number; position: number }

type ActionType = "kans" | "probleem" | "win" | "stijger" | "daler" | "trend"

type Status =
  | "nieuw" | "onderzoeken" | "goedgekeurd" | "uitgevoerd"
  | "in_evaluatie" | "succesvol" | "niet_succesvol" | "afgewezen" | "onvoldoende_bewijs"

interface Action {
  type: ActionType
  key: string
  title: string
  body: string
  score: number
  metrics: Record<string, number>
  query?: string
  page?: string
}

interface Streak {
  query: string
  weeks: number
  direction: "stijgend" | "dalend"
  positionNow: number
  positionWeeksAgo: number
  impressions: number
}

interface Experiment {
  advice_key: string
  description: string
  changed_at: string
  outcome: string | null
  query: string | null
  page: string | null
}

function getActions(keywords: Row[], prevKeywords: Row[], pages: PageRow[], streaks: Streak[]): Action[] {
  const actions: Action[] = []
  const prevMap = new Map(prevKeywords.map(k => [k.keys[0], k]))

  // Meerweken-trends uit onze eigen dagelijkse opslag — dit is wat het dashboard écht laat
  // leren van de data: een patroon dat je nooit uit één periode-vergelijking ziet.
  streaks.forEach(s => {
    actions.push({
      type: "trend",
      key: `trend:${s.query}`,
      query: s.query,
      title: s.direction === "stijgend"
        ? `"${s.query}" stijgt al ${s.weeks} weken op rij (${s.positionWeeksAgo} → ${s.positionNow})`
        : `"${s.query}" daalt al ${s.weeks} weken op rij (${s.positionWeeksAgo} → ${s.positionNow})`,
      body: s.direction === "stijgend"
        ? `Een structurele stijging, geen toeval van één periode. Dit is het moment om de pagina extra te ondersteunen zodat de trend doorzet richting pagina 1.`
        : `Een structurele daling over meerdere weken. Controleer of de content verouderd is, of een concurrent beter is gaan scoren, of er technische problemen zijn.`,
      score: s.weeks * s.impressions * (s.direction === "dalend" ? 2 : 1.6),
      metrics: { positionNow: s.positionNow, positionWeeksAgo: s.positionWeeksAgo, impressions: s.impressions, weeks: s.weeks },
    })
  })

  // Positie-trend per zoekwoord: vergelijk met vorige periode (kan pas zodra we vorige data hebben)
  keywords.forEach(k => {
    const prev = prevMap.get(k.keys[0])
    if (!prev || !prev.position || !k.position) return
    const diff = prev.position - k.position // positief = gestegen (positie-nummer omlaag is beter)
    if (diff >= 3 && k.impressions >= 15) {
      actions.push({
        type: "stijger",
        key: `stijger:${k.keys[0]}`,
        query: k.keys[0],
        title: `"${k.keys[0]}" stijgt hard: positie ${prev.position.toFixed(0)} → ${k.position.toFixed(0)}`,
        body: `${k.impressions.toLocaleString("nl")} impressies deze periode. Dit zoekwoord wint terrein — overweeg de pagina nu extra te ondersteunen met interne links zodat de stijging doorzet.`,
        score: diff * k.impressions * 1.3,
        metrics: { position: k.position, prevPosition: prev.position, impressions: k.impressions, clicks: k.clicks, ctr: k.ctr },
      })
    } else if (diff <= -3 && k.impressions >= 15) {
      actions.push({
        type: "daler",
        key: `daler:${k.keys[0]}`,
        query: k.keys[0],
        title: `"${k.keys[0]}" zakt weg: positie ${prev.position.toFixed(0)} → ${k.position.toFixed(0)}`,
        body: `${k.impressions.toLocaleString("nl")} impressies deze periode, maar de ranking daalt. Check of de content nog actueel is of dat een concurrent is opgeklommen.`,
        score: Math.abs(diff) * k.impressions * 1.5,
        metrics: { position: k.position, prevPosition: prev.position, impressions: k.impressions, clicks: k.clicks, ctr: k.ctr },
      })
    }
  })

  // Laaghangende vruchten: positie 11-20, net buiten de eerste pagina
  keywords
    .filter(k => k.position > 10 && k.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 4)
    .forEach(k => {
      actions.push({
        type: "kans",
        key: `kans:${k.keys[0]}`,
        query: k.keys[0],
        title: `"${k.keys[0]}" staat op positie ${k.position.toFixed(0)} — net buiten pagina 1`,
        body: `${k.impressions.toLocaleString("nl")} impressies, ${k.clicks} clicks. Voeg interne links toe of versterk de content om deze over de grens naar pagina 1 te trekken.`,
        score: k.impressions * 1.1,
        metrics: { position: k.position, impressions: k.impressions, clicks: k.clicks, ctr: k.ctr },
      })
    })

  // Lage CTR: veel impressies, weinig clicks t.o.v. de positie
  keywords
    .filter(k => k.impressions > 100 && k.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3)
    .forEach(k => {
      actions.push({
        type: "probleem",
        key: `probleem:${k.keys[0]}`,
        query: k.keys[0],
        title: `Lage CTR voor "${k.keys[0]}" — ${(k.ctr * 100).toFixed(1)}%`,
        body: `${k.impressions.toLocaleString("nl")} impressies maar slechts ${k.clicks} clicks. Pas de title tag of meta description aan om meer te verleiden tot klikken.`,
        score: k.impressions * 1.2,
        metrics: { position: k.position, impressions: k.impressions, clicks: k.clicks, ctr: k.ctr },
      })
    })

  // Sterke performers: goed scorende zoekwoorden om te beschermen
  keywords
    .filter(k => k.position <= 5 && k.clicks > 10)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 2)
    .forEach(k => {
      actions.push({
        type: "win",
        key: `win:${k.keys[0]}`,
        query: k.keys[0],
        title: `"${k.keys[0]}" staat op positie ${k.position.toFixed(0)} met ${k.clicks} clicks`,
        body: `Goed bezig! Bescherm deze positie door de pagina up-to-date te houden en interne links te blijven versterken.`,
        score: k.clicks * 4,
        metrics: { position: k.position, impressions: k.impressions, clicks: k.clicks, ctr: k.ctr },
      })
    })

  // Pagina's die Google wel toont, maar niemand bezoekt
  pages
    .filter(p => p.impressions > 50 && p.clicks === 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3)
    .forEach(p => {
      const url = p.keys[0].replace("https://www.groeninjestraat.nl", "") || "/"
      actions.push({
        type: "probleem",
        key: `probleem:page:${url}`,
        page: url,
        title: `${url} heeft ${p.impressions} impressies maar 0 clicks`,
        body: `Google toont de pagina wel, maar niemand klikt. Verbeter de title tag en meta description, of check of de pagina nog relevant is.`,
        score: p.impressions * 1.3,
        metrics: { position: p.position, impressions: p.impressions, clicks: p.clicks },
      })
    })

  return actions.sort((a, b) => b.score - a.score).slice(0, 8)
}

// Accentkleur per type (links op de kaart) — de kaart zelf is altijd wit/licht, zoals een nette taken-lijst.
const typeConfig: Record<ActionType, { label: string; accent: string }> = {
  kans: { label: "Kans", accent: "#06a77d" },
  probleem: { label: "Actie nodig", accent: "#e5533d" },
  win: { label: "Win", accent: "#17bf92" },
  stijger: { label: "Stijgende trend", accent: "#06a77d" },
  daler: { label: "Dalende trend", accent: "#e5533d" },
  trend: { label: "Meerweken-trend", accent: "#133e35" },
}

const statusConfig: Record<Status, { label: string; color: string; bg: string }> = {
  nieuw: { label: "Nieuw", color: "#5a6460", bg: "#eef1f0" },
  onderzoeken: { label: "Onderzoeken", color: "#9a6b05", bg: "#fdf3dc" },
  goedgekeurd: { label: "Goedgekeurd", color: "#1d5fb2", bg: "#e8f1fc" },
  uitgevoerd: { label: "Uitgevoerd", color: "#0d7a63", bg: "#e4f5f0" },
  in_evaluatie: { label: "In evaluatie", color: "#7a4fb2", bg: "#f2ebfa" },
  succesvol: { label: "Succesvol", color: "#0b7a3e", bg: "#e6f6ec" },
  niet_succesvol: { label: "Niet succesvol", color: "#b23225", bg: "#fbecea" },
  afgewezen: { label: "Afgewezen", color: "#75807c", bg: "#eef1f0" },
  onvoldoende_bewijs: { label: "Onvoldoende bewijs", color: "#75807c", bg: "#eef1f0" },
}

// Welke knoppen horen bij welke status (simpele workflow-state-machine)
const nextSteps: Record<Status, { label: string; to: Status }[]> = {
  nieuw: [
    { label: "Onderzoeken", to: "onderzoeken" },
    { label: "Goedkeuren", to: "goedgekeurd" },
    { label: "Afwijzen", to: "afgewezen" },
  ],
  onderzoeken: [
    { label: "Goedkeuren", to: "goedgekeurd" },
    { label: "Onvoldoende bewijs", to: "onvoldoende_bewijs" },
    { label: "Afwijzen", to: "afgewezen" },
  ],
  goedgekeurd: [
    { label: "Markeer als uitgevoerd", to: "uitgevoerd" },
    { label: "Afwijzen", to: "afgewezen" },
  ],
  uitgevoerd: [
    { label: "Succesvol", to: "succesvol" },
    { label: "Niet succesvol", to: "niet_succesvol" },
  ],
  in_evaluatie: [
    { label: "Succesvol", to: "succesvol" },
    { label: "Niet succesvol", to: "niet_succesvol" },
  ],
  succesvol: [{ label: "Heropenen", to: "nieuw" }],
  niet_succesvol: [{ label: "Heropenen", to: "nieuw" }],
  afgewezen: [{ label: "Heropenen", to: "nieuw" }],
  onvoldoende_bewijs: [{ label: "Heropenen", to: "nieuw" }],
}

function buildAnalysisPrompt(action: Action, priorExperiments: Experiment[]): string {
  const lines = [
    `Ik beheer het SEO-dashboard van groeninjestraat.nl (zonnepanelen, isolatie en warmtepompen, regio Twente/Overijssel). Help me met een diagnose en concreet advies voor dit signaal uit Google Search Console.`,
    ``,
    `SIGNAAL`,
    `Type: ${typeConfig[action.type].label}`,
    `${action.title}`,
    `${action.body}`,
    ``,
    `CIJFERS`,
    ...Object.entries(action.metrics).map(([k, v]) => `- ${k}: ${v}`),
  ]
  if (action.query) lines.push(``, `Zoekwoord: "${action.query}"`)
  if (action.page) lines.push(``, `Pagina: ${action.page}`)

  if (priorExperiments.length > 0) {
    lines.push(``, `EERDERE AANPASSINGEN OP DIT ONDERWERP`)
    priorExperiments.forEach(e => {
      lines.push(`- ${e.changed_at}: ${e.description}${e.outcome ? ` (resultaat: ${e.outcome})` : " (resultaat nog niet bekend)"}`)
    })
  }

  lines.push(
    ``,
    `VRAAG`,
    `1. Wat zijn mogelijke oorzaken van dit signaal? Onderscheid feiten, hypotheses en wat ik zelf nog moet checken (bv. door de pagina te bekijken).`,
    `2. Is dit signaal sterk genoeg om nu actie op te ondernemen, of is er te weinig bewijs?`,
    `3. Geef één concrete, uitvoerbare verbeteractie — geen algemene SEO-tips, maar iets specifiek voor deze pagina of dit zoekwoord.`,
  )
  return lines.join("\n")
}

export default function Advisor({
  keywords, prevKeywords, pages, streaks, loading,
}: {
  keywords: Row[]; prevKeywords: Row[]; pages: PageRow[]; streaks: Streak[]; loading: boolean
}) {
  const actions = loading ? [] : getActions(keywords, prevKeywords, pages, streaks)
  const [statuses, setStatuses] = useState<Record<string, Status>>({})
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/advice")
      .then(r => r.json())
      .then(data => {
        const map: Record<string, Status> = {}
        for (const row of data.rows || []) map[row.advice_key] = row.status
        setStatuses(map)
      })
      .catch(() => {})

    fetch("/api/experiments")
      .then(r => r.json())
      .then(data => setExperiments(data.rows || []))
      .catch(() => {})
  }, [])

  async function updateStatus(action: Action, to: Status) {
    setBusyKey(action.key)
    try {
      // Bij "uitgevoerd" leggen we een experiment vast: wat is er veranderd + de nulmeting,
      // zodat een latere cron-check kan vergelijken of het heeft gewerkt.
      if (to === "uitgevoerd") {
        const description = window.prompt(
          `Wat ga je aanpassen voor "${action.title}"?\n(bv. "Title tag herschreven" of "Interne links toegevoegd")`
        )
        if (!description) { setBusyKey(null); return }
        await fetch("/api/experiments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            advice_key: action.key,
            description,
            baseline: action.metrics,
            query: action.query ?? null,
            page: action.page ?? null,
          }),
        })
      }

      await fetch("/api/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advice_key: action.key,
          advice_title: action.title,
          advice_type: action.type,
          status: to,
        }),
      })
      setStatuses(prev => ({ ...prev, [action.key]: to }))
    } finally {
      setBusyKey(null)
    }
  }

  // Geen API-kosten: stelt een complete analyse-prompt samen, zet 'm op het klembord en
  // opent claude.ai — jij plakt en verstuurt zelf, met je eigen (gratis/Pro) Claude-gebruik.
  async function analyzeWithClaude(action: Action) {
    const prior = experiments.filter(e =>
      (action.query && e.query === action.query) || (action.page && e.page === action.page)
    )
    const prompt = buildAnalysisPrompt(action, prior)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedKey(action.key)
      setTimeout(() => setCopiedKey(k => (k === action.key ? null : k)), 2500)
    } catch {
      // Klembord niet beschikbaar (bv. geen https of geen toestemming) — open gewoon, gebruiker plakt handmatig.
    }
    window.open("https://claude.ai/new", "_blank")
  }

  return (
    <div style={{
      background: "#133e35", borderRadius: 20, padding: "22px 24px",
      marginBottom: 16, color: "#fff"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
            SEO Actiepunten
          </h2>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 3 }}>
            {streaks.length > 0
              ? "Automatisch gegenereerd · leert van meerdere weken historie · gesorteerd op impact"
              : "Automatisch gegenereerd op basis van jouw data · gesorteerd op impact"}
          </p>
        </div>
        {!loading && (
          <div style={{
            background: "#17bf92", color: "#133e35",
            borderRadius: 999, padding: "4px 12px",
            fontSize: 12, fontWeight: 700
          }}>
            {actions.length} acties
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 56, background: "rgba(255,255,255,0.08)", borderRadius: 12 }} />
          ))}
        </div>
      ) : actions.length === 0 ? (
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
          Geen opvallende punten gevonden in deze periode. Dat is op zich goed nieuws.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {actions.map((a, i) => {
            const cfg = typeConfig[a.type]
            const status = statuses[a.key] || "nieuw"
            const sCfg = statusConfig[status]
            const steps = nextSteps[status]
            return (
              <div key={a.key} style={{
                background: "#fff", borderRadius: 14,
                borderLeft: `4px solid ${cfg.accent}`,
                boxShadow: "0 1px 2px rgba(19,62,53,0.06)",
                padding: "13px 16px",
                display: "flex", gap: 12, alignItems: "flex-start"
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 7,
                  background: "#f0f3f1", color: "#133e35", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, marginTop: 1
                }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: cfg.accent,
                      letterSpacing: ".06em", textTransform: "uppercase"
                    }}>{cfg.label}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: sCfg.color, background: sCfg.bg,
                      borderRadius: 999, padding: "2px 9px", letterSpacing: ".02em"
                    }}>{sCfg.label}</span>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#133e35", margin: "0 0 2px" }}>{a.title}</p>
                  <p style={{ fontSize: 12, color: "#6b716e", margin: "0 0 10px" }}>{a.body}</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={() => analyzeWithClaude(a)}
                      style={{
                        fontSize: 11, fontWeight: 700, color: "#fff",
                        background: "#133e35", border: "1px solid #133e35",
                        borderRadius: 999, padding: "5px 12px", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 5,
                      }}
                    >
                      🔍 Analyseer met Claude
                    </button>
                    {copiedKey === a.key && (
                      <span style={{ fontSize: 11, color: "#0d7a63", fontWeight: 600 }}>
                        Prompt gekopieerd — plak 'm in het nieuwe tabblad
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {steps.map(step => (
                      <button
                        key={step.to}
                        disabled={busyKey === a.key}
                        onClick={() => updateStatus(a, step.to)}
                        style={{
                          fontSize: 11, fontWeight: 600, color: "#4a4f4d",
                          background: "#fff", border: "1px solid #e1e5e3",
                          borderRadius: 999, padding: "4px 10px", cursor: "pointer",
                          opacity: busyKey === a.key ? 0.5 : 1,
                        }}
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
