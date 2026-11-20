"use client"

// Hoe goed klopt de voorspelling? Voorspelde winst (met bandbreedte) tegen de gemeten winst per
// experiment, plus de samenvattende cijfers. Alleen eindmetingen met genoeg data tellen mee.

import { useMemo, useState } from "react"
import { Target } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { accuracySentence, computeAccuracy, LEVELS, type Accuracy, type AccuracyRow } from "@/lib/accuracy"
import type { Experiment, Task } from "@/lib/types"
import { dateShort, num } from "@/lib/format"
import { Badge, StatusLine, type StatusTone } from "@/components/ui"

const nl = (x: number, d = 1) => num(x, d)
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${nl(Math.abs(x))}`
const pctOf = (x: number | null) => x === null ? "—" : `${Math.round(x * 100)}%`
const HIT: Record<AccuracyRow["hit"], { label: string; tone: "success" | "warning" | "info" }> = {
  binnen: { label: "Binnen verwachting", tone: "success" },
  onder: { label: "Te optimistisch", tone: "warning" },
  boven: { label: "Beter dan verwacht", tone: "info" },
}

export function subjectOf(e: Experiment, byKey: Map<string, Task>) {
  const t = byKey.get(e.advice_key)
  return t ? (t.signal.query ? `"${t.signal.query}"` : t.signal.headline) : e.query ? `"${e.query}"` : e.page || e.advice_key
}

export function useAccuracy(): Accuracy {
  const { experiments, tasks } = useWorkspace()
  return useMemo(() => {
    const byKey = new Map(tasks.map(t => [t.key, t]))
    return computeAccuracy(experiments, e => subjectOf(e, byKey))
  }, [experiments, tasks])
}

function levelStatus(a: Accuracy): { tone: StatusTone; text: string } {
  if (a.level === "geen" || a.level === "te-weinig") return { tone: "info", text: accuracySentence(a) }
  const good = (a.hitRate ?? 0) >= 0.5 && (a.skill ?? 0) > 0
  return { tone: good ? "good" : "attention", text: accuracySentence(a) }
}

export default function AccuracyCard() {
  const { openTask, tasks } = useWorkspace()
  const a = useAccuracy()
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<"tabel" | "grafiek">("tabel")
  const known = useMemo(() => new Set(tasks.map(t => t.key)), [tasks])
  if (!a.rows.length) return (
    <section className="card accuracy" aria-labelledby="acc-title">
      <div className="card-head"><div><h2 className="card-title" id="acc-title"><Target aria-hidden />Hoe goed klopt de voorspelling?</h2></div></div>
      <div className="card-body"><p className="muted small" style={{ margin: 0 }}>Nog geen experiment met een voorspelling én een meting. Na de eerste meting (14 dagen) zie je hier per taak wat er voorspeld werd en wat het werkelijk opleverde; na de eindmeting (56 dagen) telt het mee in de nauwkeurigheid.</p></div>
    </section>
  )

  const byDate = (x: AccuracyRow, y: AccuracyRow) => (y.measuredAt || "").localeCompare(x.measuredAt || "")
  const plotted = [...a.scored, ...a.provisional].sort(byDate)
  const tableRows = [...a.rows].sort((x, y) => Number(y.counts) - Number(x.counts) || Number(y.final) - Number(x.final) || byDate(x, y))
  const tableShown = showAll ? tableRows : tableRows.slice(0, 10)
  const shown = showAll ? plotted : plotted.slice(0, 8)
  const lo = Math.min(0, ...plotted.map(r => Math.min(r.low, r.actual)))
  const hi = Math.max(1, ...plotted.map(r => Math.max(r.high, r.actual)))
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const status = levelStatus(a)
  const optimistic = a.bias !== null && a.bias < 0

  return (
    <section className="card accuracy" aria-labelledby="acc-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="acc-title"><Target aria-hidden />Hoe goed klopt de voorspelling?</h2>
          <p className="card-sub">Voorspelde extra klikken per 28 dagen tegen wat de meting liet zien, gecorrigeerd voor groei van de hele site.</p>
        </div>
      </div>
      <div className="card-body">
        <StatusLine tone={status.tone}>{status.text}</StatusLine>

        <div className="acc-stats" role="list">
          <Stat label="Eindmetingen die meetellen" value={String(a.n)} foot={a.provisional.length ? `${a.provisional.length} nog voorlopig` : `bruikbaar vanaf ${LEVELS.bruikbaar}`} />
          <Stat label="Binnen de bandbreedte" value={pctOf(a.hitRate)} foot={a.n ? `${a.inBand} van ${a.n}` : "nog geen eindmeting"} />
          <Stat label="Gemiddeld ernaast" value={a.meanAbsError === null ? "—" : nl(a.meanAbsError)} foot="klikken per 28 dagen" />
          <Stat label="Richting van de fout" text value={a.bias === null ? "—" : Math.abs(a.bias) < 0.5 ? "Zuiver" : optimistic ? "Te optimistisch" : "Te voorzichtig"}
            foot={a.bias === null ? "nog geen eindmeting" : `gemiddeld ${signed(a.bias)} klikken t.o.v. voorspeld`} />
        </div>

        <div className="acc-view">
          <div className="seg" role="tablist" aria-label="Weergave">
            <button role="tab" aria-selected={view === "tabel"} className={view === "tabel" ? "is-active" : ""} onClick={() => setView("tabel")}>Tabel</button>
            <button role="tab" aria-selected={view === "grafiek"} className={view === "grafiek" ? "is-active" : ""} onClick={() => setView("grafiek")}>Grafiek</button>
          </div>
        </div>

        {view === "tabel" ? (
          <div className="table-wrap acc-table">
            <table className="table">
              <caption className="sr-only">Voorspelde en gemeten extra klikken per experiment</caption>
              <thead><tr><th scope="col">Taak</th><th scope="col" className="num">Voorspeld</th><th scope="col" className="num">Bandbreedte</th><th scope="col" className="num">Gemeten</th><th scope="col" className="num">Verschil</th><th scope="col">Uitkomst</th><th scope="col">Meting</th></tr></thead>
              <tbody>{tableShown.map(r => (
                <tr key={r.id} className={r.counts ? undefined : "is-muted"}>
                  <th scope="row">{known.has(r.adviceKey) ? <button className="link-btn" onClick={() => openTask(r.adviceKey)}>{r.subject}</button> : r.subject}</th>
                  <td className="num">{signed(r.predicted)}</td>
                  <td className="num">{nl(r.low, 0)} tot {nl(r.high, 0)}</td>
                  <td className="num"><b>{signed(r.actual)}</b></td>
                  <td className="num">{signed(r.error)}</td>
                  <td><Badge tone={HIT[r.hit].tone}>{HIT[r.hit].label}</Badge></td>
                  <td className="small">{r.counts ? "Eindmeting, telt mee" : r.final ? "Eindmeting, telt niet mee (te weinig vertoningen)" : "Voorlopig (tussenmeting)"}{r.measuredAt ? <span className="subtle"> · {dateShort(r.measuredAt)}</span> : null}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="subtle small acc-table-note">Alle getallen in extra klikken per 28 dagen. Verschil = gemeten min voorspeld: negatief betekent dat de voorspelling te hoog was.</p>
            {tableRows.length > 10 && <button className="link-btn" onClick={() => setShowAll(v => !v)}>{showAll ? "Minder tonen" : `Alle ${tableRows.length} tonen`}</button>}
          </div>
        ) : (
        <figure className="acc-plot" aria-label="Voorspelde bandbreedte en gemeten winst per experiment">
          <div className="acc-legend" aria-hidden>
            <span><i className="acc-key-band" />Voorspelde bandbreedte</span>
            <span><i className="acc-key-pred" />Verwachting</span>
            <span><i className="acc-key-dot" />Gemeten (eindmeting)</span>
            <span><i className="acc-key-dot is-open" />Voorlopig (tussenmeting)</span>
            {lo < 0 && <span><i className="acc-key-zero" />Geen effect (0)</span>}
          </div>
          <ul className="acc-rows">
            {shown.map(r => (
              <li key={r.id} className="acc-row">
                <span className="acc-name">
                  {known.has(r.adviceKey) ? <button className="link-btn" onClick={() => openTask(r.adviceKey)}>{r.subject}</button> : r.subject}
                  <span className="subtle small">{r.final ? "eindmeting" : "voorlopig"}{r.measuredAt ? ` · ${dateShort(r.measuredAt)}` : ""}{r.counts || !r.final ? "" : " · telt niet mee"}</span>
                </span>
                <span className="acc-track" role="img" aria-label={`Voorspeld ${nl(r.low, 0)} tot ${nl(r.high, 0)}, gemeten ${signed(r.actual)}: ${HIT[r.hit].label.toLowerCase()}`}>
                  {lo < 0 && <span className="acc-zero" style={{ left: x(0) }} />}
                  <span className="acc-band" style={{ left: x(r.low), width: `calc(${x(r.high)} - ${x(r.low)})` }} />
                  <span className="acc-pred" style={{ left: x(r.predicted) }} />
                  <span className={`acc-dot tone-${HIT[r.hit].tone}${r.final ? "" : " is-open"}`} style={{ left: x(r.actual) }} />
                </span>
                <span className="acc-nums">
                  <span>{nl(r.low, 0)}–{nl(r.high, 0)} → <b>{signed(r.actual)}</b></span>
                  <Badge tone={HIT[r.hit].tone}>{HIT[r.hit].label}</Badge>
                </span>
              </li>
            ))}
          </ul>
          {plotted.length > 8 && <button className="link-btn" onClick={() => setShowAll(v => !v)}>{showAll ? "Minder tonen" : `Alle ${plotted.length} tonen`}</button>}
        </figure>
        )}

        <details className="acc-more">
          <summary>Hoe lees je dit, en hoe betrouwbaar is het?</summary>
          <ul>
            <li><b>Binnen de bandbreedte:</b> hoe vaak de gemeten winst tussen de laagste en hoogste verwachting viel. Bij een goede voorspelling is dat ongeveer de helft of meer.</li>
            <li><b>Gemiddeld ernaast:</b> het gemiddelde verschil tussen voorspeld en gemeten, in klikken per 28 dagen, ongeacht of het meeviel of tegenviel.</li>
            <li><b>Richting van de fout:</b> zit de voorspelling structureel te hoog (te optimistisch) of te laag? Een fout die steeds dezelfde kant op gaat, kun je corrigeren.</li>
            <li><b>Beter dan niets voorspellen?</b> {a.skill === null ? "Nog niet te berekenen." : `${a.skill > 0 ? "Ja" : "Nee"}: de voorspelling zit ${Math.abs(Math.round(a.skill * 100))}% ${a.skill > 0 ? "dichter bij" : "verder van"} de uitkomst dan wanneer je "geen effect" zou voorspellen.`}{a.realisation !== null && ` Samen leverde het ${Math.round(a.realisation * 100)}% op van wat voorspeld was.`}</li>
            <li><b>Betrouwbaarheid:</b> onder {LEVELS.indicatief} eindmetingen zegt dit nog niets; vanaf {LEVELS.indicatief} is het indicatief en vanaf {LEVELS.bruikbaar} bruikbaar om doelen op te baseren. Eén experiment met veel verkeer kan het gemiddelde sterk bepalen.</li>
            <li><b>Wat telt mee:</b> alleen de eindmeting na 56 dagen van zoekwoorden met minstens 100 vertoningen. {a.excluded.length ? `${a.excluded.length} ${a.excluded.length === 1 ? "eindmeting telt" : "eindmetingen tellen"} niet mee door te weinig vertoningen.` : ""} Tussenmetingen staan erbij als voorlopig.</li>
            <li><b>Let op:</b> seizoen, nieuws of een update van Google kunnen de uitkomst beïnvloeden. De meting corrigeert voor de groei van de hele site, niet voor alles.</li>
          </ul>
        </details>
      </div>
    </section>
  )
}

function Stat({ label, value, foot, text }: { label: string; value: string; foot: string; text?: boolean }) {
  return <div className="acc-stat" role="listitem"><span className="metric-label">{label}</span><span className={`metric-value${text ? " is-text" : ""}`}>{value}</span><span className="metric-foot">{foot}</span></div>
}
