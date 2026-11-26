"use client"

import { useCallback, useEffect, useState } from "react"
import type { DashboardData } from "@/lib/dashboard"
import { CheckCircle2, Database, RefreshCw, XCircle } from "lucide-react"
import { Alert, Badge, PageHeader, Skeleton, type StatusTone } from "@/components/ui"
import { dateShort, num } from "@/lib/format"

interface Job { job: string; dataAt?: string | null; last: { run_at: string; ok: boolean; duration_ms: number | null; details: any; error: string | null } | null; lastOk: string | null; failures7d: number }
interface Status {
  jobs: Job[]
  snapshots: { overview: Snap; keywords: Snap; pages: Snap; daysLast90: number }
  inventory: { total: number; inSitemap: number; httpChecked: number; httpErrors: number; inspectedFresh: number; neverInspected: number; inspectErrors: number; indexed: number; lastSync: string | null; lastInspect: string | null }
  experiments: { total: number; open: number }
  recentErrors: { run_at: string; job: string; error: string | null }[]
}
interface Snap { latest: string | null; rowsLatest: number; since: string | null }

const JOB_META: Record<string, { label: string; what: string; maxAgeH: number }> = {
  "gsc-snapshot": { label: "Search Console-snapshot", what: "Dagcijfers per zoekwoord en pagina, voor trends en metingen", maxAgeH: 30 },
  inventaris: { label: "Pagina-inventaris", what: "Alle URL's uit de sitemap plus URL's die Google toont", maxAgeH: 30 },
  "http-controle": { label: "HTTP-controle", what: "Live statuscode en doorverwijzing van elke URL", maxAgeH: 30 },
  indexering: { label: "Indexeringscontrole", what: "URL-inspectie van Google (max. 2.000 per dag)", maxAgeH: 30 },
  experimenten: { label: "Experimentmetingen", what: "Metingen na 7, 14 en 28 dagen (56 bij verlenging)", maxAgeH: 30 },
  actualiteiten: { label: "Contentkansen", what: "Nieuws van Rijksoverheid en Milieu Centraal, webtrends (maandag), zoekdata en seizoen", maxAgeH: 30 },
  "gedrag-clarity": { label: "Gedrag (Microsoft Clarity)", what: "Scrolldiepte, actieve tijd en klikproblemen per pagina, elke ochtend de afgelopen 24 uur", maxAgeH: 30 },
  "snelheid-historie": { label: "Snelheid echte bezoekers (CrUX)", what: "Laadsnelheid van Chrome-bezoekers per week, tot 40 weken terug; Google ververst wekelijks", maxAgeH: 24 * 8 },
  "content-metingen": { label: "Contentmetingen", what: "Gepubliceerde artikelen en bijgewerkte pagina's na 7, 14 en 28 dagen (56 bij SEO-doel of verlenging)", maxAgeH: 30 },
}

function ago(iso: string | null) {
  if (!iso) return "nog nooit"
  const h = (Date.now() - new Date(iso).getTime()) / 3600000
  if (h < 1) return "minder dan een uur geleden"
  if (h < 24) return `${Math.floor(h)} uur geleden`
  return `${Math.floor(h / 24)} ${Math.floor(h / 24) === 1 ? "dag" : "dagen"} geleden`
}
function time(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })
}

function jobState(j: Job): { tone: "success" | "warning" | "error" | "neutral"; label: string } {
  if (!j.last) {
    // Geen logregel, maar wel data: de taak draaide al vóór het logboek bestond
    if (j.dataAt) return (Date.now() - new Date(j.dataAt).getTime()) / 3600000 > (JOB_META[j.job]?.maxAgeH ?? 30) + 24 ? { tone: "warning", label: "Data verouderd" } : { tone: "success", label: "Data aanwezig" }
    return { tone: "neutral", label: j.job === "content-metingen" || j.job === "experimenten" ? "Nog niets te meten" : "Nog niet gedraaid" }
  }
  if (!j.last.ok) return { tone: "error", label: "Laatste run mislukt" }
  if (typeof j.last.details?.overgeslagen === "string" && j.last.details.overgeslagen.startsWith("Geen")) return { tone: "neutral", label: "Nog niet gekoppeld" }
  const ageH = (Date.now() - new Date(j.last.run_at).getTime()) / 3600000
  if (ageH > (JOB_META[j.job]?.maxAgeH ?? 30)) return { tone: "warning", label: "Verouderd" }
  return { tone: "success", label: "In orde" }
}

function summary(job: string, d: any): string {
  if (!d) return ""
  switch (job) {
    case "gsc-snapshot": return `${dateShort(d.snapshotDate)}: ${num(d.keywords)} zoekwoorden, ${num(d.pages)} pagina's`
    case "inventaris": return `${num(d.sitemap)} in sitemap, ${num(d.totaal)} totaal, ${num(d.buitenSitemap)} buiten sitemap`
    case "http-controle": return `${num(d.gecontroleerd)} gecontroleerd, ${num(d.fouten)} fouten, ${num(d.doorverwijzingen)} doorverwijzingen${d.resterend ? `, ${num(d.resterend)} resterend` : ""}`
    case "indexering": return `${num(d.gecontroleerd)} gecontroleerd${d.mislukt ? `, ${num(d.mislukt)} mislukt` : ""}${d.resterend !== null && d.resterend !== undefined ? `, ${num(d.resterend)} nog te doen` : ""}${d.quotum ? " · dagquotum bereikt" : ""}`
    case "experimenten": return `${num(d.checked)} bekeken, ${num(d.measured)} metingen, ${num(d.finalized)} afgerond`
    case "actualiteiten": return `${num(d.bronnen - (d.bronnenMislukt || 0))}/${num(d.bronnen)} bronnen, ${num(d.relevant)} relevante berichten${d.webVondsten ? `, ${num(d.webVondsten)} webvondsten` : ""}, ${num(d.nieuweKansen)} nieuwe kansen`
    case "content-metingen": return `${num(d.gepubliceerd)} gepubliceerd, ${num(d.metingen)} nieuwe metingen`
    case "gedrag-clarity": return d.overgeslagen ? d.overgeslagen : `${dateShort(d.dag)}: ${num(d.paginas)} pagina's, ${num(d.sessies)} sessies`
    case "snelheid-historie": return d.overgeslagen ? d.overgeslagen : `${num(d.perioden)} weken site-data, ${num(d.paginasMetData)} van ${num(d.paginasGeprobeerd)} pagina's met eigen data`
    default: return ""
  }
}

export default function DataStatusView() {
  const [data, setData] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ga4, setGa4] = useState<{ ok: boolean; code?: string; serviceAccount?: string | null; sessions?: number; keyEvents?: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch("/api/datastatus", { cache: "no-store" }).then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`); return b }),
      fetch("/api/ga4?days=28", { cache: "no-store" }).then(async r => {
        const b = await r.json().catch(() => ({}))
        if (!r.ok) return { ok: false, ...b }
        const rows: any[] = b.rows || []
        const sum = (i: number) => rows.reduce((s, x) => s + Number(x.metricValues?.[i]?.value || 0), 0)
        return { ok: true, sessions: sum(0), keyEvents: sum(1) }
      }).catch(() => ({ ok: false, code: "error" })),
    ])
      .then(([s, g]) => { setData(s); setGa4({ ok: g.ok, code: (g as any).code, serviceAccount: (g as any).serviceAccount, sessions: (g as any).sessions, keyEvents: (g as any).keyEvents }) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const inv = data?.inventory
  return (
    <>
      <PageHeader title="Datastatus"
        status={!data ? null : (() => {
          const st = data.jobs.map(jobState), failed = st.filter(x => x.tone === "error").length, old = st.filter(x => x.tone === "warning").length
          return failed || old
            ? { tone: (failed ? "problem" : "attention") as StatusTone, text: [failed ? `${failed} ${failed === 1 ? "synchronisatie mislukte" : "synchronisaties mislukten"}` : "", old ? `${old} ${old === 1 ? "bron is" : "bronnen zijn"} verouderd` : ""].filter(Boolean).join(", ") + ". Cijfers en adviezen kunnen daardoor onvolledig zijn." }
            : { tone: "good" as StatusTone, text: "Alle bronnen zijn bijgewerkt." }
        })()}
        sub="Welke gegevens het dashboard gebruikt, wanneer ze voor het laatst zijn bijgewerkt en wat er misging. Technische fouten, quota en koppelingen staan hier, niet op de andere pagina's."
        actions={<button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}><RefreshCw aria-hidden />Vernieuwen</button>} />

      {error && <Alert tone="error" title="Datastatus niet opgehaald">{error}</Alert>}

      <section className="card" aria-labelledby="ds-jobs" style={{ marginBottom: 20 }}>
        <div className="card-head"><h2 className="card-title" id="ds-jobs">Synchronisaties</h2><p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Elke nacht om ±06:17; handmatig via de pagina-audit</p></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Bron</th><th>Status</th><th>Laatste run</th><th>Laatst gelukt</th><th>Resultaat</th><th className="num">Fouten (7 d)</th></tr></thead>
            <tbody>
              {loading && !data ? [0, 1, 2, 3, 4].map(i => <tr key={i}><td colSpan={6}><Skeleton height={18} /></td></tr>) : data?.jobs.map(j => {
                const st = jobState(j)
                return (
                  <tr key={j.job}>
                    <td><b>{JOB_META[j.job]?.label || j.job}</b><div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{JOB_META[j.job]?.what}</div></td>
                    <td><Badge tone={st.tone} dot>{st.label}</Badge></td>
                    <td className="nowrap">{j.last ? <>{time(j.last.run_at)}<div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{ago(j.last.run_at)}</div></> : j.dataAt ? <>{time(j.dataAt)}<div className="muted" style={{ fontSize: "var(--fs-xs)" }}>afgeleid uit de data</div></> : "—"}</td>
                    <td className="nowrap">{time(j.lastOk ?? j.dataAt ?? null)}</td>
                    <td style={{ fontSize: "var(--fs-sm)" }}>{!j.last ? <span className="muted">{j.dataAt ? "Draaide vóór het logboek bestond; de volgende run wordt gelogd." : "—"}</span> : j.last.ok ? summary(j.job, j.last.details) : <span className="text-error">{j.last.error || "—"}</span>}</td>
                    <td className="num">{j.failures7d || "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {data && data.jobs.some(j => !j.last && j.dataAt) && <p className="field-hint" style={{ padding: "0 20px 16px" }}>Het logboek bestaat sinds 16 november. Voor taken zonder logregel is het laatste moment afgeleid uit de opgeslagen data; vanaf de volgende nachtelijke run staat hier het echte resultaat.</p>}
      </section>

      <DataQuality />

      <div className="ds-grid">
        <section className="card card-pad" aria-labelledby="ds-gsc">
          <h2 className="card-title" id="ds-gsc"><Database aria-hidden />Search Console-historie</h2>
          {data ? (
            <dl className="ds-list">
              <div><dt>Laatste dag in de snapshots</dt><dd>{data.snapshots.keywords.latest ? dateShort(data.snapshots.keywords.latest) : "—"}</dd></div>
              <div><dt>Zoekwoorden op die dag</dt><dd>{num(data.snapshots.keywords.rowsLatest)}</dd></div>
              <div><dt>Pagina&apos;s op die dag</dt><dd>{num(data.snapshots.pages.rowsLatest)}</dd></div>
              <div><dt>Historie sinds</dt><dd>{data.snapshots.keywords.since ? dateShort(data.snapshots.keywords.since) : "—"}</dd></div>
              <div><dt>Dagen met data (laatste 90)</dt><dd>{num(data.snapshots.daysLast90)} van 90</dd></div>
            </dl>
          ) : <Skeleton height={120} />}
          <p className="field-hint">De live cijfers in adviezen komen rechtstreeks uit Search Console (±2 dagen vertraging). De snapshots zijn voor trends en experimentmetingen.</p>
        </section>

        <section className="card card-pad" aria-labelledby="ds-inv">
          <h2 className="card-title" id="ds-inv"><Database aria-hidden />Pagina-inventaris</h2>
          {inv ? (
            <dl className="ds-list">
              <div><dt>URL&apos;s in de sitemap</dt><dd>{num(inv.inSitemap)} <span className="muted">(+{num(inv.total - inv.inSitemap)} buiten sitemap)</span></dd></div>
              <div><dt>HTTP-status gecontroleerd</dt><dd>{num(inv.httpChecked)} van {num(inv.total)}</dd></div>
              <div><dt>Foutcodes in de sitemap</dt><dd className={inv.httpErrors ? "text-error" : ""}>{num(inv.httpErrors)}</dd></div>
              <div><dt>Indexering, gecontroleerd &lt; 7 dagen</dt><dd>{num(inv.inspectedFresh)} van {num(inv.inSitemap)}</dd></div>
              <div><dt>Nog nooit gecontroleerd</dt><dd>{num(inv.neverInspected)}</dd></div>
              <div><dt>Geïndexeerd (laatste controle)</dt><dd>{num(inv.indexed)}</dd></div>
              {inv.inspectErrors > 0 && <div><dt>Inspectiefouten</dt><dd className="text-error">{num(inv.inspectErrors)}</dd></div>}
              <div><dt>Laatste inventaris / inspectie</dt><dd>{time(inv.lastSync)} / {time(inv.lastInspect)}</dd></div>
            </dl>
          ) : <Skeleton height={160} />}
        </section>

        <section className="card card-pad" aria-labelledby="ds-ga4">
          <h2 className="card-title" id="ds-ga4"><Database aria-hidden />Google Analytics 4</h2>
          {!ga4 ? <Skeleton height={60} /> : ga4.ok ? (
            ga4.keyEvents ? (
              <p className="ds-ok"><CheckCircle2 aria-hidden />Gekoppeld: {num(ga4.keyEvents)} conversies bij {num(ga4.sessions || 0)} sessies (28 dagen). Conversies per pagina wegen mee in de prioriteit.</p>
            ) : (
              <>
                <p className="ds-bad" style={{ color: "var(--warning)" }}><XCircle aria-hidden />Gekoppeld, maar 0 conversies bij {num(ga4.sessions || 0)} sessies (28 dagen)</p>
                <p className="field-hint">De verbinding werkt, maar er zijn nog geen key events. Markeer in GA4 (Beheer → Gebeurtenissen) de gebeurtenissen voor energiescan, adviesgesprek en aanvraag als <b>key event</b>. Tot die tijd wegen conversies niet mee en is de commerciële waarde in contentkansen een aanname.</p>
              </>
            )
          ) : (
            <>
              <p className="ds-bad"><XCircle aria-hidden />{ga4.code === "permission" ? "Geen leesrechten" : ga4.code === "config" ? "Niet geconfigureerd" : "Niet bereikbaar"}</p>
              {ga4.code === "permission" && (
                <p className="field-hint">Geef <b>{ga4.serviceAccount || "het service-account"}</b> de rol <b>Lezer</b> in Google Analytics: Beheer → Toegangsbeheer property. Daarna wegen aanvragen en energiescans per pagina mee in de prioriteit.</p>
              )}
            </>
          )}
        </section>

        <section className="card card-pad" aria-labelledby="ds-exp">
          <h2 className="card-title" id="ds-exp"><Database aria-hidden />Experimenten</h2>
          {data ? (
            <dl className="ds-list">
              <div><dt>Totaal vastgelegd</dt><dd>{num(data.experiments.total)}</dd></div>
              <div><dt>Nog lopend</dt><dd>{num(data.experiments.open)}</dd></div>
            </dl>
          ) : <Skeleton height={60} />}
          <p className="field-hint">Nulmeting, hypothese en doelen van een experiment kunnen na het vastleggen niet meer worden gewijzigd (afgedwongen in de database).</p>
        </section>
      </div>

      {data && data.recentErrors.length > 0 && (
        <section className="card" aria-labelledby="ds-err" style={{ marginTop: 20 }}>
          <div className="card-head"><h2 className="card-title" id="ds-err">Recente fouten</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Moment</th><th>Bron</th><th>Fout</th></tr></thead>
              <tbody>{data.recentErrors.map((e, i) => <tr key={i}><td className="nowrap">{time(e.run_at)}</td><td>{JOB_META[e.job]?.label || e.job}</td><td style={{ fontSize: "var(--fs-sm)" }}>{e.error}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

// Wat nog niet betrouwbaar wordt gemeten (stond eerder op het dashboard). Zelfde gegevens als het
// dashboard met de standaardperiode van 28 dagen.
function DataQuality() {
  const [d, setD] = useState<DashboardData | null>(null)
  useEffect(() => { fetch("/api/dashboard?period=28&compare=prev", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)) }, [])
  if (!d) return null
  const items = [
    ...d.warnings.map(w => ({ key: w.id, tone: w.severity, title: w.what, text: w.effect, advice: w.action })),
    ...d.notes.filter(n => n.id !== "filter" && n.id !== "campagne").map(n => ({ key: n.id, tone: "info" as const, title: n.title, text: n.text, advice: n.advice })),
  ]
  if (!items.length) return null
  return (
    <section className="card" aria-labelledby="ds-quality" style={{ marginBottom: 20 }}>
      <div className="card-head"><div><h2 className="card-title" id="ds-quality">Wat nog niet betrouwbaar wordt gemeten</h2><p className="card-sub">En hoe je dat oplost. Laatste 28 dagen.</p></div></div>
      <div className="card-body">
        <ul className="dash-notes">
          {items.map(i => (
            <li key={i.key}><span className={`warn-dot ${i.tone === "error" ? "is-problem" : i.tone === "warning" ? "" : "is-info"}`} aria-hidden /><div><b>{i.title}</b><p>{i.text}</p><p className="dash-advice"><b>Zo los je dit op:</b> {i.advice}</p></div></li>
          ))}
        </ul>
      </div>
    </section>
  )
}
