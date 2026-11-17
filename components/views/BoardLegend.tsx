"use client"

import { BarChart3, Dot, StickyNote, UserRound } from "lucide-react"

const STEPS = [
  { id: "beoordelen", label: "Te beoordelen", text: "Nieuwe signalen uit Search Console, GA4 en de nachtelijke controles, plus taken die je zelf toevoegt. Jij beslist: inplannen, uitstellen of afwijzen (met reden, daar leert het systeem van)." },
  { id: "gepland", label: "Gepland", text: "Goedgekeurd, nog niet begonnen. Wijs een eigenaar toe, zodat duidelijk is wie het oppakt." },
  { id: "uitvoering", label: "In uitvoering", text: "Iemand is ermee bezig. Gebruik de notitie voor tussenstanden (\"half af\", \"wacht op livegang\")." },
  { id: "evalueren", label: "Evalueren", text: "Het staat live. Bij het verplaatsen vul je in wat je hebt aangepast; het systeem legt een nulmeting vast en meet zelf na 14, 28 en 56 dagen. Jij hoeft niets te doen." },
  { id: "afgerond", label: "Afgerond", text: "Er is een oordeel: geslaagd, niet geslaagd, geen duidelijk effect of afgewezen. De uitkomst telt mee in \"Wat hebben we geleerd?\" en bepaalt welke adviezen later voorrang krijgen." },
]

export default function BoardLegend({ onClose }: { onClose: () => void }) {
  return (
    <section className="card board-legend" aria-labelledby="legend-title">
      <div className="card-head">
        <div><h2 className="card-title" id="legend-title">Hoe werkt het bord?</h2><p className="card-sub">Een taak loopt van links naar rechts: van signaal naar gemeten resultaat.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Sluiten</button>
      </div>
      <div className="card-body">
        <ol className="legend-steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={`legend-step col-${s.id}`}>
              <span className="legend-num">{i + 1}</span>
              <div><b>{s.label}</b><p>{s.text}</p></div>
            </li>
          ))}
        </ol>
        <div className="legend-grid">
          <div>
            <h3>Op de kaarten</h3>
            <table className="table small legend-table">
              <thead><tr><th>Label</th><th>Betekenis</th></tr></thead>
              <tbody>
                <tr><td><span className="legend-chip"><BarChart3 aria-hidden />Hoog</span></td><td>Prioriteit: hoog, middel of laag. Rekent met verwachte winst, bewijs en wat eerder werkte.</td></tr>
                <tr><td><span className="new-dot">Nieuw</span></td><td>Nieuw sinds je vorige bezoek.</td></tr>
                <tr><td><span className="tcard-note" style={{ display: "inline-flex", marginTop: 0 }}><StickyNote aria-hidden /><span>Notitie</span></span></td><td>Notitie bij de taak.</td></tr>
                <tr><td><span className="owner-chip"><UserRound aria-hidden />Thom</span></td><td>Wie de taak oppakt.</td></tr>
                <tr><td><span className="legend-chip"><Dot aria-hidden />Niet actueel</span></td><td>Het signaal komt niet meer uit de data (bijvoorbeeld vanzelf opgelost). Controleer en sluit af.</td></tr>
                <tr><td><span className="legend-chip">Uitgesteld</span></td><td>Lichter weergegeven tot de gekozen datum; daarna komt de taak terug.</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3>Soorten taken</h3>
            <table className="table small legend-table">
              <thead><tr><th>Soort</th><th>Wat het is</th><th>Gemeten op</th></tr></thead>
              <tbody>
                <tr><td><b>Kans, daling, dubbele pagina&apos;s</b></td><td>SEO-adviezen uit Search Console</td><td>Positie en klikken in Google</td></tr>
                <tr><td><b>Technisch</b></td><td>Fouten, indexering en controletaken (zoals de meting van aanvragen)</td><td>Of het probleem weg is</td></tr>
                <tr><td><b>Content</b></td><td>Contentkansen uit nieuws en zoekdata</td><td>Bezoek en posities na publicatie</td></tr>
                <tr><td><b>Eigen taak</b></td><td>Zelf toegevoegd, met een doel</td><td>Doel &quot;meer aanvragen&quot;: energiescanaanvragen in GA4. Doel &quot;beter gevonden worden&quot;: Google. Doel &quot;overig&quot;: niet automatisch</td></tr>
              </tbody>
            </table>
            <p className="subtle small" style={{ marginTop: 10 }}>Tip: meld een taak pas als uitgevoerd als de wijziging echt live staat, anders start de meting te vroeg.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
