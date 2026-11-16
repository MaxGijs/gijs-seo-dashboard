"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Database, RefreshCw, XCircle } from "lucide-react"
import { Alert, Badge, Skeleton } from "@/components/ui"
import { dateShort, num } from "@/lib/format"

interface Job { job: string; last: { run_at: string; ok: boolean; duration_ms: number | null; details: any; error: string | null } | null; lastOk: string | null; failures7d: number }
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
  experimenten: { label: "Experimentmetingen", what: "Metingen na 14, 28 en 56 dagen", maxAgeH: 30 },
  actualiteiten: { label: "Contentkansen", what: "Nieuws van Rijksoverheid en Milieu Centraal, webtrends (maandag), zoekdata en seizoen", maxAgeH: 30 },
  "content-metingen": { label: "Contentmetingen", what: "Gepubliceerde artikelen na 7, 30 en 90 dagen", maxAgeH: 30 },
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
  if (!j.last) return { tone: "neutral", label: "Nog niet gedraaid" }
  if (!j.last.ok) return { tone: "error", label: "Laatste run mislukt" }
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
    default: return ""
  }
}

export default function DataStatusView() {
  const [data, setData] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ga4, setGa4] = useState<{ ok: boolean; code?: string; serviceAccount?: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch("/api/datastatus", { cache: "no-store" }).then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`); return b }),
      fetch("/api/ga4?days=1", { cache: "no-store" }).then(async r => ({ ok: r.ok, ...(r.ok ? {} : await r.json().catch(() => ({}))) })).catch(() => ({ ok: false, code: "error" })),
    ])
      .then(([s, g]) => { setData(s); setGa4({ ok: g.ok, code: (g as any).code, serviceAccount: (g as any).serviceAccount }) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const inv = data?.inventory
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Datastatus</h1>
          <p className="page-sub">Welke gegevens het dashboard gebruikt, wanneer ze voor het laatst zijn bijgewerkt en wat er misging. Adviezen zijn zo betrouwbaar als deze bronnen.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}><RefreshCw aria-hidden />Vernieuwen</button>
      </div>

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
                    <td className="nowrap">{time(j.last?.run_at ?? null)}<div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{ago(j.last?.run_at ?? null)}</div></td>
                    <td className="nowrap">{time(j.lastOk)}</td>
                    <td style={{ fontSize: "var(--fs-sm)" }}>{j.last?.ok ? summary(j.job, j.last.details) : <span className="text-error">{j.last?.error || "—"}</span>}</td>
                    <td className="num">{j.failures7d || "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {data && data.jobs.every(j => !j.last) && <p className="field-hint" style={{ padding: "0 20px 16px" }}>Het logboek is vandaag gestart; de eerste nachtelijke run verschijnt hier morgenochtend.</p>}
      </section>

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
            <p className="ds-ok"><CheckCircle2 aria-hidden />Gekoppeld. Conversies per pagina wegen mee in de prioriteit.</p>
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
