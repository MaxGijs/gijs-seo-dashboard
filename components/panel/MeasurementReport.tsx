"use client"

// Resultaat van een SEO-meting, zo dat de conclusie binnen tien seconden te begrijpen is:
// status en signaal, één kernzin, het vervolgadvies. Daaronder de cijfers (nulmeting, nu, verschil),
// het onderscheid waargenomen / mogelijke bijdrage / oorzaak, en uitklapbaar alle onderliggende gegevens.

import { useState } from "react"
import { Badge } from "@/components/ui"
import { dateShort, num, pct, pos } from "@/lib/format"
import { ADVICE, CRAWL_DAY, EARLY_DAY, EXTENDED_DAY, FINAL_DAY, measureDate, SIGNAL, STATUS, latestReport, statusOf, summarizeSignals, type Report, type Row } from "@/lib/measureLogic"
import { CHANGE_TYPES, changeTypesOf } from "@/lib/experiment"
import type { Experiment } from "@/lib/types"

const LEVEL: Record<string, "success" | "warning" | "neutral"> = { hoog: "success", redelijk: "neutral", laag: "warning" }

function fmt(r: Row, v: number | null) {
  if (v === null) return "—"
  return r.unit === "positie" ? pos(v) : r.unit === "pct" ? pct(v, 2) : num(v)
}
function Diff({ r }: { r: Row }) {
  if (r.abs === null) return <span className="subtle">—</span>
  if (r.better === null) return <span className="delta-flat">gelijk</span>
  const abs = r.unit === "positie" ? `${r.abs > 0 ? "+" : "−"}${pos(Math.abs(r.abs))}` : r.unit === "pct" ? `${r.abs > 0 ? "+" : "−"}${num(Math.abs(r.abs) * 100, 2)} pp` : `${r.abs > 0 ? "+" : "−"}${num(Math.abs(r.abs))}`
  return <span className={r.better ? "delta-up" : "delta-down"}>{abs}</span>
}

export function StatusBadges({ e }: { e: Experiment }) {
  const st = STATUS[statusOf(e)]
  const rep = latestReport(e)
  return (
    <span className="mr-badges">
      <Badge tone={st.tone} dot>{st.label}</Badge>
      {rep && <Badge tone={SIGNAL[rep.effect].tone}>{SIGNAL[rep.effect].label}</Badge>}
    </span>
  )
}

// Tijdlijn: 7 signalering, 14 eerste beoordeling, 28 eindmeting, 56 alleen bij verlenging
export function MeasureTimeline({ e, members }: { e: Experiment; members?: Experiment[] }) {
  // Bij een familie: per meetmoment een samenvatting over alle meetpunten
  const all = members && members.length > 1 ? members : [e]
  const col = (d: number) => `result_${d}d` as "result_7d" | "result_14d" | "result_28d" | "result_56d"
  const extended = all.some(m => m.result_28d && (m.result_28d.report?.extend || m.result_28d.extend))
  const text = (d: number) => {
    const rs = all.map(m => m[col(d)]).filter(Boolean) as any[]
    if (!rs.length) return null
    if (d === CRAWL_DAY) {
      if (all.length === 1) return rs[0].summary || "gemeten"
      const ok = rs.filter(r => r.crawl?.state === "verwerkt").length
      return `${ok} van ${all.length} meetpunten opnieuw gecrawld`
    }
    const reps = rs.map(r => r.report).filter(Boolean) as Report[]
    if (!reps.length) return rs[0].summary || "gemeten"
    if (d === FINAL_DAY && reps.some(r => r.extend) && all.length === 1) return "verlengd"
    if (all.length === 1) return SIGNAL[reps[0].effect].label
    const sum = summarizeSignals(reps.map(r => r.effect))
    return `${SIGNAL[sum.overall].label} (${reps.length} van ${all.length} gemeten)`
  }
  const steps = [
    { day: CRAWL_DAY, label: "Signalering" },
    { day: EARLY_DAY, label: "Eerste beoordeling" },
    { day: FINAL_DAY, label: "Eindmeting" },
    { day: EXTENDED_DAY, label: "Verlenging", optional: !extended && !all.some(m => m.result_56d) },
  ].map(s => ({ ...s, done: text(s.day) }))
  return (
    <ol className="mr-timeline" aria-label="Meetmomenten">
      {steps.map(s => (
        <li key={s.day} className={s.done ? "is-done" : s.optional ? "is-optional" : ""}>
          <span className="mr-tl-day">Dag {s.day}</span>
          <span className="mr-tl-label">{s.label}</span>
          <span className="mr-tl-text">{s.done ? s.done : s.optional ? "alleen bij verlenging" : all.every(m => m.outcome) ? "niet nodig" : `rond ${dateShort(measureDate(e.changed_at, s.day))}`}</span>
        </li>
      ))}
    </ol>
  )
}

export function MeasurementReport({ e, compact = false }: { e: Experiment; compact?: boolean }) {
  const r = latestReport(e)
  const overlap = e.baseline?.overlapWith as { at: string; with: { description: string; changedAt: string }[] } | undefined
  if (!r) {
    // Nog geen beoordeling, of een meting zonder zoekcijfers (validatie, conversie)
    const last = e.result_56d || e.result_28d || e.result_14d || e.result_7d
    return (
      <div className="mr">
        <div className="mr-head"><StatusBadges e={e} /></div>
        <p className="mr-headline">{last?.summary || (e.result_7d ? "Signaleringsmeting gedaan; de eerste beoordeling volgt na 14 dagen." : "Nog geen meting. Na 7 dagen volgt de signaleringsmeting (crawlcontrole).")}</p>
        {overlap && <p className="mr-overlap">Overlap vastgelegd: uitgevoerd terwijl op dezelfde pagina &ldquo;{overlap.with[0]?.description}&rdquo; werd gemeten.</p>}
      </div>
    )
  }
  return (
    <div className="mr">
      <div className="mr-head">
        <StatusBadges e={e} />
        <Badge tone={LEVEL[r.reliability.level]} title={r.reliability.reasons.join("; ")}>Betrouwbaarheid: {r.reliability.level}</Badge>
        {r.provisional && <span className="subtle small">voorlopig, dag {r.day}</span>}
      </div>
      <p className="mr-headline">{r.headline}</p>
      <p className="mr-expl">{r.explanation}</p>
      <p className="mr-next"><b>Vervolgadvies: {ADVICE[r.advice]}.</b> {r.next.replace(/^(Behouden|Verder meten|Onderzoeken|Opnieuw optimaliseren)[.:]?\s*/i, "")}</p>
      {r.rows.length > 0 && (
        <div className="table-wrap">
          <table className="mini-table mr-table">
            <thead><tr><th>Meetwaarde</th><th className="num">Nulmeting ({r.day} d vóór)</th><th className="num">Nu ({r.day} d na)</th><th className="num">Verschil</th><th className="num">%</th></tr></thead>
            <tbody>{r.rows.map(row => (
              <tr key={row.key}><td>{row.label}</td><td className="num">{fmt(row, row.before)}</td><td className="num">{fmt(row, row.after)}</td><td className="num"><Diff r={row} /></td><td className="num">{row.pct === null ? "—" : `${row.pct > 0 ? "+" : ""}${num(row.pct, 1)}%`}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <dl className="mr-evidence">
        <div><dt>Waargenomen verandering</dt><dd>{r.observed}</dd></div>
        <div><dt>Mogelijke bijdrage van de wijziging</dt><dd>{r.contribution}</dd></div>
        <div><dt>Oorzakelijk effect</dt><dd>{r.causal}</dd></div>
      </dl>
      {!compact && <p className="subtle small mr-period">Meetperiode: {r.period}.</p>}
      {overlap && <p className="mr-overlap">Overlap vastgelegd: uitgevoerd op {dateShort(overlap.at)} terwijl op dezelfde pagina &ldquo;{overlap.with[0]?.description}&rdquo; werd gemeten.</p>}
      <details className="mr-more">
        <summary>Onderliggende cijfers en uitleg</summary>
        {r.why.length > 0 && <><p className="mr-sub">Waarom dit signaal</p><ul>{r.why.map(w => <li key={w}>{w}</li>)}</ul></>}
        {r.missing.length > 0 && <><p className="mr-sub">Wat nog ontbreekt</p><ul>{r.missing.map(w => <li key={w}>{w}</li>)}</ul></>}
        {r.extendReasons.length > 0 && <p className="small">Verlengd omdat: {r.extendReasons.join("; ")}.</p>}
        <p className="mr-sub">Betrouwbaarheid {r.reliability.level}</p>
        <ul>{r.reliability.reasons.map(w => <li key={w}>{w}</li>)}</ul>
        {r.influencedBy.length > 0 && <><p className="mr-sub">Andere aanpassingen aan dezelfde pagina in de meetperiode</p><ul>{r.influencedBy.map(w => <li key={w}>{w}</li>)}</ul></>}
        {r.ranking && (
          <>
            <p className="mr-sub">Welke URL toont Google voor &ldquo;{r.ranking.query}&rdquo;?</p>
            <ul>{r.ranking.shown.map(x => <li key={x.page}>{x.page} · {num(x.impressions)} vertoningen{x.position !== null ? ` · positie ${pos(x.position)}` : ""}</li>)}</ul>
            {r.ranking.intendedShown === false && <p className="small subtle">Google toont vooral een andere URL dan de aangepaste pagina. Dat is een diagnostisch signaal, geen bewijs dat het experiment verkeerd is ingesteld.</p>}
          </>
        )}
        {r.points.length > 0 && (
          <>
            <p className="mr-sub">Per aangepaste pagina</p>
            <div className="table-wrap"><table className="mini-table">
              <thead><tr><th>Pagina</th><th className="num">Vertoningen</th><th className="num">Klikken</th><th className="num">Positie</th><th>Signaal</th></tr></thead>
              <tbody>{r.points.map(p => { const g = (k: string) => p.rows.find(x => x.key === k)!; return (
                <tr key={p.page}><td>{p.page}</td><td className="num">{num(g("impressions").before)} → {num(g("impressions").after)}</td><td className="num">{num(g("clicks").before)} → {num(g("clicks").after)}</td><td className="num">{pos(g("position").before)} → {pos(g("position").after)}</td><td><Badge tone={SIGNAL[p.signal].tone}>{SIGNAL[p.signal].label}</Badge></td></tr>
              ) })}</tbody>
            </table></div>
          </>
        )}
        {(() => { const q = (e.result_56d?.scoped || e.result_28d?.scoped || e.result_14d?.scoped)?.perQuery as any[] | undefined; return q?.length ? (
          <>
            <p className="mr-sub">Relevante zoekopdrachten</p>
            <div className="table-wrap"><table className="mini-table">
              <thead><tr><th>Zoekopdracht</th><th className="num">Vertoningen</th><th className="num">Klikken</th><th className="num">Positie</th></tr></thead>
              <tbody>{q.map(x => <tr key={x.query}><td>{x.tracked ? <b>&ldquo;{x.query}&rdquo;</b> : <>&ldquo;{x.query}&rdquo;</>}</td><td className="num">{num(x.before.impressions)} → {num(x.after.impressions)}</td><td className="num">{num(x.before.clicks)} → {num(x.after.clicks)}</td><td className="num">{pos(x.before.position)} → {pos(x.after.position)}</td></tr>)}</tbody>
            </table></div>
            <p className="small subtle">Vetgedrukt: de zoekwoorden van de aanpassing. De andere zijn de grootste zoekopdrachten van de pagina vóór de wijziging.</p>
          </>
        ) : null })()}
        {e.result_7d?.crawl && <p className="small">Crawlcontrole (dag 7): {e.result_7d.summary}.</p>}
      </details>
    </div>
  )
}

// Wat, waarom, waar en wanneer: de vaste gegevens van een experiment
export { pathsIn } from "@/lib/paths"
import { pathsIn } from "@/lib/paths"
const capW = (s: string) => s.split("-").map(w => (["van", "de", "den", "aan", "op", "en"].includes(w) ? w : w[0]?.toUpperCase() + w.slice(1))).join(" ")
// Leesbare plaats bij een regiopagina: "Zwolle (Overijssel)" of "Brinkhoek, Zwolle"
export function placeLabel(path: string): string | null {
  const s = path.split("/").filter(Boolean)
  if (s[0] !== "regio" || s.length < 2) return null
  if (s.length === 2) return capW(s[1])
  if (s.length === 3) return `${capW(s[2])} (${capW(s[1])})`
  return `${capW(s[s.length - 1])}, ${capW(s[2])}`
}

type PageRole = "gemeten" | "google" | "genoemd"
const ROLE: Record<PageRole, { label: string; hint: string }> = {
  gemeten: { label: "Gemeten", hint: "Hierop wordt de meting gedaan" },
  google: { label: "Google toonde", hint: "De URL die Google bij de nulmeting voor het zoekwoord liet zien" },
  genoemd: { label: "Genoemd in omschrijving", hint: "Staat in de omschrijving; hierop wordt niet apart gemeten" },
}
export function pageRows(e: Experiment, measured: string[]): { path: string; role: PageRole }[] {
  const norm = (p: string) => p.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "").toLowerCase() || "/"
  const seen = new Set<string>()
  const rows: { path: string; role: PageRole }[] = []
  const push = (p: string | null | undefined, role: PageRole) => { if (!p) return; const n = norm(p); if (seen.has(n)) return; seen.add(n); rows.push({ path: n, role }) }
  measured.forEach(p => push(p, "gemeten"))
  push(e.baseline?.targetPage, "google")
  pathsIn(e.description || "").forEach(p => push(p, "genoemd"))
  return rows
}

// Lange tekst: eerst een paar regels, met "Lees alles"
function LongText({ text, lines = 3 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220
  return (
    <span className="mr-long">
      <span className={long && !open ? "mr-clamp" : undefined} style={long && !open ? { WebkitLineClamp: lines } : undefined}>{text}</span>
      {long && <button type="button" className="link-btn mr-more" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? "Minder" : "Lees alles"}</button>}
    </span>
  )
}

export function ExperimentFacts({ e, pages }: { e: Experiment; pages: string[] }) {
  const cts = changeTypesOf(e.baseline)
  const rows = pageRows(e, pages)
  const queries = [...new Set([e.query, ...(e.target_queries || [])].filter((q): q is string => !!q))]
  return (
    <dl className="mr-facts">
      <div><dt>Wat is aangepast</dt><dd>{cts.length ? <span className="mr-type">{cts.map(t => <Badge key={t} tone="neutral">{CHANGE_TYPES[t]}</Badge>)}</span> : null}<LongText text={e.description} /></dd></div>
      {e.hypothesis && <div><dt>Waarom (hypothese en doel)</dt><dd><LongText text={e.hypothesis} lines={2} /></dd></div>}
      <div><dt>Pagina&apos;s</dt><dd>
        {rows.length ? (
          <table className="mr-pages">
            <thead><tr><th scope="col">Pagina</th><th scope="col">Plaats</th><th scope="col">Rol</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.path} className={`is-${r.role}`}>
                <td className="mr-path">{r.path}</td>
                <td>{placeLabel(r.path) || <span className="subtle">—</span>}</td>
                <td title={ROLE[r.role].hint}>{r.role === "gemeten" ? <Badge tone="info">{ROLE[r.role].label}</Badge> : <span className="subtle">{ROLE[r.role].label}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <span className="subtle">Geen pagina; gemeten op het zoekwoord</span>}
      </dd></div>
      {queries.length > 0 && <div><dt>Zoekwoorden</dt><dd className="mr-chips">{queries.map(q => <span key={q} className="mr-chip">{q}</span>)}</dd></div>}
      <div><dt>Wanneer</dt><dd>Live op {dateShort(e.changed_at)}</dd></div>
    </dl>
  )
}
