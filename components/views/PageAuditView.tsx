"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, DatabaseZap, FileSearch, RefreshCw, ScanSearch, SearchX } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import {
  ageDays, assessPage, coverageNl, OPBOUW_DAGEN, PAGE_STATUS_META, PAGE_TYPE_LABEL, phaseOf, prettySlug,
  type PageRow, type PageStatus, type PageType,
} from "@/lib/pages"
import type { Priority } from "@/lib/types"
import { dateShort, normalize, num, plural, pos } from "@/lib/format"
import { Alert, Badge, Breakable, EmptyState, PriorityMeter, Skeleton } from "@/components/ui"

interface Inventory { rows: PageRow[]; lastSync: string | null; lastInspect: string | null }
let cache: Inventory | null = null

const PRIO_ORDER: Record<Priority, number> = { hoog: 0, middel: 1, laag: 2 }
const STATUS_ORDER: PageStatus[] = ["technisch", "niet-geindexeerd", "groeikans", "geen-vertoningen", "pagina1", "ver", "buiten-sitemap", "top", "ongecontroleerd", "doorverwezen"]
const PROVINCE_ORDER = ["overijssel", "gelderland", "utrecht", "flevoland"]

export default function PageAuditView() {
  const { openSubject, toast } = useWorkspace()
  const [data, setData] = useState<Inventory | null>(cache)
  const [state, setState] = useState<"loading" | "ready" | "error">(cache ? "ready" : "loading")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | "sync" | "inspect">(null)
  const [progress, setProgress] = useState<string | null>(null)
  const stopRef = useRef(false)

  const [prov, setProv] = useState("alle")
  const [gem, setGem] = useState("alle")
  const [type, setType] = useState<"alle" | PageType>("alle")
  const [status, setStatus] = useState<"alle" | PageStatus>("alle")
  const [prio, setPrio] = useState<"alle" | Priority>("alle")
  const [phase, setPhase] = useState<"alle" | "opbouw" | "volwassen">("alle")
  const [onlyAction, setOnlyAction] = useState(false)
  const [q, setQ] = useState("")
  const [limit, setLimit] = useState(100)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pages", { cache: "no-store" })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      cache = body
      setData(body)
      setState("ready")
    } catch (e: any) {
      setErr(e?.message || "Ophalen mislukt")
      setState("error")
    }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (action: "sync" | "inspect") => {
    const res = await fetch("/api/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body
  }

  const runSync = async () => {
    setBusy("sync"); setProgress("Sitemap wordt ingelezen…")
    try {
      const r = await post("sync")
      toast(`Inventaris bijgewerkt: ${num(r.sitemap)} pagina's in de sitemap, ${num(r.metVertoningen)} met vertoningen.`)
      await load()
    } catch (e: any) { toast(`Bijwerken mislukt: ${e.message}`, "error") }
    setBusy(null); setProgress(null)
  }

  const runInspect = async () => {
    setBusy("inspect"); stopRef.current = false
    let total = 0
    try {
      for (let i = 0; i < 40 && !stopRef.current; i++) {
        const r = await post("inspect")
        total += r.gecontroleerd || 0
        setProgress(`${num(total)} gecontroleerd${r.resterend !== null ? ` · nog ${num(r.resterend)} te gaan` : ""}`)
        if (r.quotum) { toast("Het dagquotum van Google is bereikt. De rest wordt morgen automatisch gecontroleerd.", "info"); break }
        if (!r.resterend || r.gecontroleerd === 0) break
      }
      toast(`Indexering gecontroleerd voor ${plural(total, "pagina", "pagina's")}.`)
    } catch (e: any) { toast(`Controle onderbroken: ${e.message}`, "error") }
    await load()
    setBusy(null); setProgress(null)
  }

  const assessed = useMemo(() => (data?.rows || []).map(r => ({ row: r, a: assessPage(r), phase: phaseOf(r) })), [data])

  const provinces = useMemo(() => {
    const set = new Set(assessed.map(x => x.row.provincie).filter(Boolean) as string[])
    return [...set].sort((a, b) => (PROVINCE_ORDER.indexOf(a) + 1 || 99) - (PROVINCE_ORDER.indexOf(b) + 1 || 99))
  }, [assessed])
  const gemeenten = useMemo(() => {
    if (prov === "alle") return []
    return [...new Set(assessed.filter(x => x.row.provincie === prov && x.row.gemeente).map(x => x.row.gemeente!))].sort()
  }, [assessed, prov])

  const filtered = useMemo(() => {
    const n = normalize(q)
    return assessed
      .filter(x => prov === "alle" || x.row.provincie === prov)
      .filter(x => gem === "alle" || x.row.gemeente === gem)
      .filter(x => type === "alle" || x.row.page_type === type)
      .filter(x => status === "alle" || x.a.status === status)
      .filter(x => prio === "alle" || x.a.priority === prio)
      .filter(x => phase === "alle" || x.phase === phase)
      .filter(x => !onlyAction || !x.a.monitor)
      .filter(x => !n || normalize(x.row.path).includes(n))
      .sort((a, b) => PRIO_ORDER[a.a.priority] - PRIO_ORDER[b.a.priority] || Number(a.a.monitor) - Number(b.a.monitor) || STATUS_ORDER.indexOf(a.a.status) - STATUS_ORDER.indexOf(b.a.status) || b.row.imp_28d - a.row.imp_28d || a.row.path.localeCompare(b.row.path))
  }, [assessed, prov, gem, type, status, prio, phase, onlyAction, q])

  const statusCounts = useMemo(() => {
    const c: Partial<Record<PageStatus, number>> = {}
    for (const x of assessed) c[x.a.status] = (c[x.a.status] || 0) + 1
    return c
  }, [assessed])

  const perProvince = useMemo(() => provinces.map(p => {
    const rows = assessed.filter(x => x.row.provincie === p && x.row.in_sitemap)
    const inspected = rows.filter(x => x.row.inspected_at && !x.row.inspect_error)
    return {
      p, total: rows.length,
      indexed: inspected.filter(x => x.row.index_verdict === "PASS").length,
      inspected: inspected.length,
      visible: rows.filter(x => x.row.imp_28d > 0).length,
      launch: rows[0]?.row.launch_date || null,
      opbouw: rows.filter(x => x.phase === "opbouw").length,
      problems: rows.filter(x => x.a.status === "technisch").length,
    }
  }), [assessed, provinces])

  const resetFilters = () => { setProv("alle"); setGem("alle"); setType("alle"); setStatus("alle"); setPrio("alle"); setPhase("alle"); setOnlyAction(false); setQ("") }
  const anyFilter = prov !== "alle" || type !== "alle" || status !== "alle" || prio !== "alle" || phase !== "alle" || onlyAction || q !== ""

  if (state === "loading") return <div className="card card-pad" style={{ display: "grid", gap: 12 }}><Skeleton height={22} width="40%" /><Skeleton height={120} /><Skeleton height={240} /></div>
  if (state === "error") return <Alert tone="error" title="Pagina-audit kon niet worden geladen" action={<button className="btn btn-secondary btn-sm" onClick={load}>Opnieuw</button>}>{err}</Alert>

  const notInspected = assessed.filter(x => x.row.in_sitemap && !x.row.inspected_at).length

  if (!data?.rows.length) {
    return (
      <div className="card">
        <EmptyState icon={<DatabaseZap />} title="Nog geen pagina-inventaris"
          text="Bouw de inventaris op uit de sitemap van groeninjestraat.nl. Daarna kun je per pagina zien of Google hem kent, toont en hoe hij scoort."
          action={<button className="btn btn-primary btn-sm" onClick={runSync} disabled={!!busy}>{busy ? progress : "Inventaris opbouwen"}</button>} />
      </div>
    )
  }

  return (
    <>
      {/* Stand per provincie */}
      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="per-provincie">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="per-provincie"><ScanSearch aria-hidden />Stand per provincie</h2>
            <p className="card-sub">Nieuwe provincies vergelijken we niet met oudere: tot {OPBOUW_DAGEN / 7} weken na lancering telt alleen de basis.</p>
          </div>
          <div className="page-actions">
            {progress && <span className="meta-line">{progress}</span>}
            {busy === "inspect"
              ? <button className="btn btn-secondary btn-sm" onClick={() => { stopRef.current = true }}>Stoppen</button>
              : <button className="btn btn-secondary btn-sm" onClick={runInspect} disabled={!!busy}><FileSearch aria-hidden />Indexering controleren{notInspected ? ` (${num(notInspected)} open)` : ""}</button>}
            <button className="btn btn-ghost btn-sm" onClick={runSync} disabled={!!busy}><RefreshCw aria-hidden />Inventaris bijwerken</button>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead><tr><th>Provincie</th><th>Live sinds</th><th className="num">Pagina&apos;s</th><th className="num">Geïndexeerd</th><th className="num">Met vertoningen</th><th className="num">Technische problemen</th><th>Fase</th></tr></thead>
            <tbody>
              {perProvince.map(r => (
                <tr key={r.p} className="is-clickable" onClick={() => { setProv(r.p); setGem("alle") }} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") { setProv(r.p); setGem("alle") } }}>
                  <td className="cell-main">{prettySlug(r.p)}</td>
                  <td>{r.launch ? dateShort(r.launch) : "—"}</td>
                  <td className="num">{num(r.total)}</td>
                  <td className="num">{r.inspected ? `${num(r.indexed)} van ${num(r.inspected)}` : <span className="subtle">nog niet gecontroleerd</span>}</td>
                  <td className="num">{num(r.visible)} <span className="subtle">({Math.round((r.visible / Math.max(r.total, 1)) * 100)}%)</span></td>
                  <td className="num">{r.problems ? <span className="delta-down">{r.problems}</span> : <span className="subtle">0</span>}</td>
                  <td>{r.opbouw === r.total ? <Badge tone="info">Opbouw</Badge> : r.opbouw ? <Badge tone="info">Deels opbouw</Badge> : <Badge tone="neutral">Volwassen</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card-sub" style={{ padding: "10px 22px 16px" }}>
          Inventaris bijgewerkt {data.lastSync ? dateShort(data.lastSync) : "—"} · indexering laatst gecontroleerd {data.lastInspect ? dateShort(data.lastInspect) : "nog nooit"}. Beide worden elke nacht automatisch bijgewerkt.
        </p>
      </section>

      {notInspected > 0 && !busy && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info" title={`${plural(notInspected, "pagina is", "pagina's zijn")} nog niet op indexering gecontroleerd`}
            action={<button className="btn btn-primary btn-sm" onClick={runInspect}>Nu controleren</button>}>
            Google staat 2.000 controles per dag toe. Zonder deze controle kan het dashboard niet onderscheiden tussen &quot;nog niet ontdekt&quot; en &quot;wel ontdekt, maar nooit vertoond&quot;.
          </Alert>
        </div>
      )}

      {/* Status-filters */}
      <div className="toolbar">
        <div className="toolbar-left" role="group" aria-label="Filter op status">
          <button className={`chip${status === "alle" ? " is-active" : ""}`} onClick={() => setStatus("alle")}>Alle<span className="chip-count">{num(assessed.length)}</span></button>
          {(Object.keys(PAGE_STATUS_META) as PageStatus[]).filter(s => statusCounts[s]).map(s => (
            <button key={s} className={`chip${status === s ? " is-active" : ""}`} onClick={() => setStatus(s)} aria-pressed={status === s}>
              {PAGE_STATUS_META[s].label}<span className="chip-count">{num(statusCounts[s]!)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <div className="toolbar-left">
          <select className="select" aria-label="Provincie" style={{ width: 150, height: 36, borderRadius: 999 }} value={prov} onChange={e => { setProv(e.target.value); setGem("alle"); setLimit(100) }}>
            <option value="alle">Alle provincies</option>
            {provinces.map(p => <option key={p} value={p}>{prettySlug(p)}</option>)}
          </select>
          <select className="select" aria-label="Gemeente" style={{ width: 200, height: 36, borderRadius: 999 }} value={gem} onChange={e => setGem(e.target.value)} disabled={prov === "alle"}>
            <option value="alle">{prov === "alle" ? "Kies eerst provincie" : "Alle gemeenten"}</option>
            {gemeenten.map(g => <option key={g} value={g}>{prettySlug(g)}</option>)}
          </select>
          <select className="select" aria-label="Paginatype" style={{ width: 180, height: 36, borderRadius: 999 }} value={type} onChange={e => setType(e.target.value as any)}>
            <option value="alle">Alle paginatypes</option>
            {(Object.keys(PAGE_TYPE_LABEL) as PageType[]).map(t => <option key={t} value={t}>{PAGE_TYPE_LABEL[t]}</option>)}
          </select>
          <select className="select" aria-label="Fase" style={{ width: 140, height: 36, borderRadius: 999 }} value={phase} onChange={e => setPhase(e.target.value as any)}>
            <option value="alle">Alle fases</option><option value="opbouw">In opbouw</option><option value="volwassen">Volwassen</option>
          </select>
          <select className="select" aria-label="Prioriteit" style={{ width: 150, height: 36, borderRadius: 999 }} value={prio} onChange={e => setPrio(e.target.value as any)}>
            <option value="alle">Alle prioriteiten</option><option value="hoog">Hoog</option><option value="middel">Middel</option><option value="laag">Laag</option>
          </select>
        </div>
        <div className="toolbar-left">
          <label className="chip" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={onlyAction} onChange={e => setOnlyAction(e.target.checked)} style={{ accentColor: "var(--green-800)" }} />Alleen actie nodig
          </label>
          <input className="input" aria-label="Zoek pagina" placeholder="Zoek op pad" style={{ width: 200, height: 36, borderRadius: 999, paddingLeft: 14 }} value={q} onChange={e => setQ(e.target.value)} />
          {anyFilter && <button className="btn btn-ghost btn-sm" onClick={resetFilters}>Wissen</button>}
        </div>
      </div>

      <section className="card" aria-label="Pagina's">
        {filtered.length === 0 ? (
          <EmptyState compact icon={<SearchX />} title="Geen pagina's met deze filters" action={<button className="btn btn-secondary btn-sm" onClick={resetFilters}>Filters wissen</button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Pagina</th><th>Fase</th><th>Indexering</th><th className="num">Vertoningen</th><th className="num">Positie</th><th>Status</th><th>Prioriteit</th><th>Volgende stap</th><th aria-label="Openen" /></tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map(({ row, a, phase: ph }) => {
                    const age = ageDays(row)
                    const open = () => openSubject({ page: row.path })
                    return (
                      <tr key={row.path} className="is-clickable" onClick={open} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") open() }}>
                        <td className="cell-main" style={{ maxWidth: 300 }}>
                          <span style={{ display: "block", wordBreak: "normal" }}><Breakable text={row.path} /></span>
                          <span className="subtle" style={{ fontSize: 12, fontWeight: 400 }}>{PAGE_TYPE_LABEL[row.page_type]}{row.gemeente && row.page_type === "plaats" ? ` · ${prettySlug(row.gemeente)}` : ""}</span>
                        </td>
                        <td className="nowrap">{ph === "opbouw" ? <Badge tone="info">Opbouw · {age} d</Badge> : ph === "volwassen" ? <span className="muted">Volwassen</span> : <span className="subtle">—</span>}</td>
                        <td style={{ fontSize: 12 }}>
                          {row.inspected_at && !row.inspect_error
                            ? <span className={row.index_verdict === "PASS" ? "delta-up" : "muted"}>{row.index_verdict === "PASS" ? "Geïndexeerd" : coverageNl(row.coverage_state) || "Niet geïndexeerd"}</span>
                            : row.inspect_error ? <span className="subtle" title={row.inspect_error}>Controle mislukt</span> : <span className="subtle">Nog niet gecontroleerd</span>}
                        </td>
                        <td className="num">{num(row.imp_28d)}</td>
                        <td className="num">{row.position_28d !== null ? pos(Number(row.position_28d)) : <span className="subtle">—</span>}</td>
                        <td><Badge tone={PAGE_STATUS_META[a.status].tone} dot>{PAGE_STATUS_META[a.status].label}</Badge></td>
                        <td>{a.monitor ? <span className="subtle" style={{ fontSize: 12 }}>Monitoren</span> : <PriorityMeter priority={a.priority} />}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 220, maxWidth: 320 }} title={a.reason}>{a.next}</td>
                        <td className="cell-arrow"><ChevronRight aria-hidden /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 22px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="subtle" style={{ fontSize: 12 }}>{num(filtered.length)} pagina&apos;s · gesorteerd op prioriteit, daarna vertoningen</span>
              {filtered.length > limit && <button className="btn btn-secondary btn-sm" onClick={() => setLimit(l => l + 200)}>Nog {num(Math.min(200, filtered.length - limit))} tonen</button>}
            </div>
          </>
        )}
      </section>
    </>
  )
}
