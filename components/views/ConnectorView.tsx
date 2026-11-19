"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, Link2, MessageSquare, Trash2 } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { dateShort } from "@/lib/format"
import { Alert, PageHeader, Skeleton } from "@/components/ui"

interface Row { id: string; hint: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Log { at: string; tool: string; ok: boolean; detail: string | null }

const EXAMPLES = [
  "Wat moet ik vandaag doen?",
  "Voeg een taak toe: woningscan verkorten, doel meer aanvragen, wijs toe aan Thom",
  "Plan de taak over isolatie Borne in en zet hem op mijn naam",
  "Ik heb interne links naar /regio/overijssel/borne gezet, meld de taak als uitgevoerd",
  "Hoe staan we ervoor deze maand ten opzichte van vorige maand?",
  "Welke contentkansen liggen er over warmtepompen?",
]

export default function ConnectorView() {
  const { toast } = useWorkspace()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [log, setLog] = useState<Log[]>([])
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/mcp-tokens", { cache: "no-store" }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows(j.rows); setLog(j.log || []); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const create = async () => {
    setBusy(true)
    try {
      const r = await fetch("/api/mcp-tokens", { method: "POST" }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setUrl(j.url); load()
    } catch (e: any) { toast(`Aanmaken mislukt: ${e.message}`, "error") } finally { setBusy(false) }
  }
  const revoke = async (id: string) => {
    const r = await fetch(`/api/mcp-tokens?id=${id}`, { method: "DELETE" })
    if (r.ok) { toast("Koppeling ingetrokken"); load() } else toast("Intrekken mislukt", "error")
  }
  const copy = async () => { try { await navigator.clipboard.writeText(url!); toast("Gekopieerd") } catch { toast("Kopiëren lukte niet; selecteer de tekst handmatig", "error") } }
  const active = (rows || []).filter(r => !r.revoked_at)

  return (
    <>
      <PageHeader title="Claude-koppeling"
        status={!rows ? null : active.length ? { tone: "good", text: `${active.length} ${active.length === 1 ? "actieve koppeling" : "actieve koppelingen"}.` } : { tone: "info", text: "Nog geen actieve koppeling." }}
        sub="Praat in de Claude-app met het dashboard: vraag wat er vandaag moet gebeuren, voeg taken toe, plan ze in of meld ze als uitgevoerd. Loopt via je eigen Claude-abonnement, zonder extra kosten." />
      {err && <Alert tone="error" title="Koppelingen konden niet worden geladen">{err}</Alert>}

      <div className="connector-grid">
        <section className="card">
          <div className="card-head"><div><h2 className="card-title"><Link2 aria-hidden />Jouw koppeling</h2><p className="card-sub">Persoonlijk: alles wat Claude doet, gebeurt onder jouw naam.</p></div></div>
          <div className="card-body stack">
            {url ? (
              <>
                <Alert tone="warning" title="Kopieer deze link nu">Hij wordt maar één keer getoond. Deel hem niet: wie de link heeft, kan je taken lezen en wijzigen.</Alert>
                <div className="connector-url"><code>{url}</code><button className="btn btn-secondary btn-sm" onClick={copy}><Copy aria-hidden />Kopieer</button></div>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={create} style={{ alignSelf: "flex-start" }}>{busy ? "Bezig…" : active.length ? "Nieuwe link maken" : "Link maken"}</button>
            )}
            <ol className="connector-steps">
              <li>Open de Claude-app of claude.ai en ga naar <b>Instellingen → Connectors</b>.</li>
              <li>Kies <b>Aangepaste connector toevoegen</b>, noem hem <b>Gijs</b> en plak de link. Laat de geavanceerde (OAuth) velden leeg.</li>
              <li>Zet in een nieuw gesprek de connector <b>Gijs</b> aan (via het + of het hulpmiddelen-menu) en stel je vraag.</li>
            </ol>
            <p className="subtle small">Op een Team- of Enterprise-abonnement kan alleen een beheerder connectors toevoegen. Werkt dat niet, vraag het dan aan de beheerder van jullie Claude-account.</p>
            {!rows ? <Skeleton height={60} /> : active.length > 0 && (
              <table className="table small">
                <thead><tr><th>Link</th><th>Gemaakt</th><th>Laatst gebruikt</th><th /></tr></thead>
                <tbody>{active.map(r => (
                  <tr key={r.id}><td><code>…{r.hint}</code></td><td>{dateShort(r.created_at)}</td><td>{r.last_used_at ? dateShort(r.last_used_at) : "nog niet"}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => revoke(r.id)}><Trash2 aria-hidden />Intrekken</button></td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2 className="card-title"><MessageSquare aria-hidden />Wat je kunt vragen</h2><p className="card-sub">Claude gebruikt dezelfde taken, cijfers en regels als dit dashboard.</p></div></div>
          <div className="card-body">
            <ul className="plain-list">{EXAMPLES.map(e => <li key={e}><span aria-hidden>›</span><span>“{e}”</span></li>)}</ul>
            <p className="subtle small" style={{ marginTop: 12 }}>De website zelf wordt nooit via de koppeling aangepast. Claude meldt een taak pas als uitgevoerd als jij bevestigt wat er live staat.</p>
          </div>
        </section>
      </div>

      {log.length > 0 && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="card-head"><div><h2 className="card-title">Laatste acties via Claude</h2></div></div>
          <div className="card-body">
            <table className="table small"><tbody>{log.map((l, i) => (
              <tr key={i}><td>{new Date(l.at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>{l.tool}</td><td>{l.ok ? "gelukt" : "mislukt"}</td><td className="truncate" style={{ maxWidth: 420 }}>{l.detail || ""}</td></tr>
            ))}</tbody></table>
          </div>
        </section>
      )}
    </>
  )
}
