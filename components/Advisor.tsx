"use client"

interface Row { keys: string[]; clicks: number; impressions: number; position: number; ctr: number }
interface PageRow { keys: string[]; clicks: number; impressions: number; position: number }

type ActionType = "kans" | "probleem" | "win" | "stijger" | "daler" | "trend"

interface Action {
  type: ActionType
  title: string
  body: string
  score: number
}

interface Streak {
  query: string
  weeks: number
  direction: "stijgend" | "dalend"
  positionNow: number
  positionWeeksAgo: number
  impressions: number
}

function getActions(keywords: Row[], prevKeywords: Row[], pages: PageRow[], streaks: Streak[]): Action[] {
  const actions: Action[] = []
  const prevMap = new Map(prevKeywords.map(k => [k.keys[0], k]))

  // Meerweken-trends uit onze eigen dagelijkse opslag — dit is wat het dashboard écht laat
  // leren van de data: een patroon dat je nooit uit één periode-vergelijking ziet.
  streaks.forEach(s => {
    actions.push({
      type: "trend",
      title: s.direction === "stijgend"
        ? `"${s.query}" stijgt al ${s.weeks} weken op rij (${s.positionWeeksAgo} → ${s.positionNow})`
        : `"${s.query}" daalt al ${s.weeks} weken op rij (${s.positionWeeksAgo} → ${s.positionNow})`,
      body: s.direction === "stijgend"
        ? `Een structurele stijging, geen toeval van één periode. Dit is het moment om de pagina extra te ondersteunen zodat de trend doorzet richting pagina 1.`
        : `Een structurele daling over meerdere weken. Controleer of de content verouderd is, of een concurrent beter is gaan scoren, of er technische problemen zijn.`,
      score: s.weeks * s.impressions * (s.direction === "dalend" ? 2 : 1.6),
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
        title: `"${k.keys[0]}" stijgt hard: positie ${prev.position.toFixed(0)} → ${k.position.toFixed(0)}`,
        body: `${k.impressions.toLocaleString("nl")} impressies deze periode. Dit zoekwoord wint terrein — overweeg de pagina nu extra te ondersteunen met interne links zodat de stijging doorzet.`,
        score: diff * k.impressions * 1.3,
      })
    } else if (diff <= -3 && k.impressions >= 15) {
      actions.push({
        type: "daler",
        title: `"${k.keys[0]}" zakt weg: positie ${prev.position.toFixed(0)} → ${k.position.toFixed(0)}`,
        body: `${k.impressions.toLocaleString("nl")} impressies deze periode, maar de ranking daalt. Check of de content nog actueel is of dat een concurrent is opgeklommen.`,
        score: Math.abs(diff) * k.impressions * 1.5,
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
        title: `"${k.keys[0]}" staat op positie ${k.position.toFixed(0)} — net buiten pagina 1`,
        body: `${k.impressions.toLocaleString("nl")} impressies, ${k.clicks} clicks. Voeg interne links toe of versterk de content om deze over de grens naar pagina 1 te trekken.`,
        score: k.impressions * 1.1,
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
        title: `Lage CTR voor "${k.keys[0]}" — ${(k.ctr * 100).toFixed(1)}%`,
        body: `${k.impressions.toLocaleString("nl")} impressies maar slechts ${k.clicks} clicks. Pas de title tag of meta description aan om meer te verleiden tot klikken.`,
        score: k.impressions * 1.2,
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
        title: `"${k.keys[0]}" staat op positie ${k.position.toFixed(0)} met ${k.clicks} clicks`,
        body: `Goed bezig! Bescherm deze positie door de pagina up-to-date te houden en interne links te blijven versterken.`,
        score: k.clicks * 4,
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
        title: `${url} heeft ${p.impressions} impressies maar 0 clicks`,
        body: `Google toont de pagina wel, maar niemand klikt. Verbeter de title tag en meta description, of check of de pagina nog relevant is.`,
        score: p.impressions * 1.3,
      })
    })

  return actions.sort((a, b) => b.score - a.score).slice(0, 8)
}

const typeConfig: Record<ActionType, { label: string; color: string; bg: string; border: string; dot: string }> = {
  kans: { label: "Kans", color: "#04815f", bg: "#f0f9f6", border: "#a9e4d2", dot: "#06a77d" },
  probleem: { label: "Actie nodig", color: "#b23225", bg: "#fbecea", border: "#f5c6c3", dot: "#e53e3e" },
  win: { label: "Win", color: "#1b5348", bg: "#f0f9f6", border: "#a9e4d2", dot: "#17bf92" },
  stijger: { label: "Stijgende trend", color: "#04815f", bg: "#f0f9f6", border: "#a9e4d2", dot: "#06a77d" },
  daler: { label: "Dalende trend", color: "#b23225", bg: "#fbecea", border: "#f5c6c3", dot: "#e53e3e" },
  trend: { label: "Meerweken-trend", color: "#133e35", bg: "#f0f9f6", border: "#06a77d", dot: "#06a77d" },
}

export default function Advisor({
  keywords, prevKeywords, pages, streaks, loading,
}: {
  keywords: Row[]; prevKeywords: Row[]; pages: PageRow[]; streaks: Streak[]; loading: boolean
}) {
  const actions = loading ? [] : getActions(keywords, prevKeywords, pages, streaks)

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
            return (
              <div key={i} style={{
                background: cfg.bg, border: `1px solid ${cfg.border}`,
                borderRadius: 12, padding: "12px 14px",
                display: "flex", gap: 12, alignItems: "flex-start"
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: "#133e35", color: "#fff", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, marginTop: 1
                }}>{i + 1}</div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: cfg.color,
                      letterSpacing: ".06em", textTransform: "uppercase"
                    }}>{cfg.label}</span>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#133e35", margin: "0 0 2px" }}>{a.title}</p>
                  <p style={{ fontSize: 12, color: "#4a4f4d", margin: 0 }}>{a.body}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
