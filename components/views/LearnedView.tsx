"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { BookOpenCheck, CheckCircle2, CircleSlash, History, RotateCcw, Sparkles, Undo2 } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import type { Lesson } from "@/lib/learning"
import { dateShort } from "@/lib/format"
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui"

interface LogRow { id: number; lesson_key: string; at: string; action: string; detail: string | null; by: string | null }
interface Data { lessons: Lesson[]; log: LogRow[]; stats: { lopend: number; afgerond: number; afgewezen: number; gepubliceerd: number } | null }

const SOURCE_LABEL: Record<Lesson["source"], string> = { meting: "Uit metingen", afwijzing: "Uit afwijzingen", content: "Uit content" }
const ACTION_LABEL: Record<string, string> = { nieuw: "Nieuwe les", bijgewerkt: "Bijgewerkt", vervallen: "Vervallen", "weer-geldig": "Weer geldig", teruggedraaid: "Teruggedraaid", hersteld: "Hersteld" }

export default function LearnedView() {
  const { toast, reload } = useWorkspace()
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/lessons", { cache: "no-store" })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(String(body.key || body.action))
    try {
      const r = await fetch("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      toast(done); await load(); reload()
    } catch (e: any) { toast(e.message, "error") } finally { setBusy(null) }
  }

  const active = (data?.lessons || []).filter(l => l.status === "actief")
  const applied = active.filter(l => l.effect && l.effect.type !== "info")
  const watching = active.filter(l => !applied.includes(l))
  const inactive = (data?.lessons || []).filter(l => l.status !== "actief")
  const s = data?.stats

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Wat hebben we geleerd?</h1>
          <p className="page-sub">Conclusies uit afgeronde metingen en jullie beslissingen, en wat het systeem daardoor zelf anders doet. Alles is terug te draaien.</p>
          <p className="page-sub small"><Rule /></p>
        </div>
        <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => act({ action: "recompute" }, "Lessen opnieuw berekend")}><RotateCcw aria-hidden />Nu opnieuw berekenen</button>
      </div>

      {err && <Alert tone="error" title="Lessen konden niet worden geladen">{err}</Alert>}

      <div className="learn-stats">
        <Stat label="Afgeronde metingen" value={s?.afgerond} />
        <Stat label="Lopende metingen" value={s?.lopend} />
        <Stat label="Afgewezen adviezen" value={s?.afgewezen} />
        <Stat label="Gemeten publicaties" value={s?.gepubliceerd} />
      </div>

      {!data ? <Skeleton height={160} /> : data.lessons.length === 0 ? (
        <div className="card"><EmptyState icon={<BookOpenCheck />} title="Nog niets geleerd"
          text={<><Rule /> Een meting is na 14, 28 en 56 dagen klaar. <b>Zo versnel je dit:</b> markeer elke uitgevoerde taak als uitgevoerd (dan start de meting), pas per pagina één ding tegelijk aan, en geef bij afwijzen altijd een reden.</>} /></div>
      ) : (
        <>
          <Section title="Automatisch toegepast" sub="Deze lessen veranderen nu de volgorde van adviezen of de score van contentkansen." icon={<Sparkles aria-hidden />}>
            {applied.length === 0 ? <p className="muted small">Nog geen lessen met voldoende zekerheid om zelf toe te passen.</p> : applied.map(l => <LessonCard key={l.key} l={l} busy={busy === l.key} onRevert={() => act({ action: "revert", key: l.key }, "Les teruggedraaid")} />)}
          </Section>
          {watching.length > 0 && (
            <Section title="Ter informatie" sub="Wordt (nog) niet automatisch toegepast." icon={<BookOpenCheck aria-hidden />}>
              {watching.map(l => <LessonCard key={l.key} l={l} busy={busy === l.key} onRevert={() => act({ action: "revert", key: l.key }, "Les uitgezet")} />)}
            </Section>
          )}
          {inactive.length > 0 && (
            <Section title="Teruggedraaid of vervallen" sub="Hebben geen invloed meer." icon={<CircleSlash aria-hidden />}>
              {inactive.map(l => <LessonCard key={l.key} l={l} busy={busy === l.key} onRestore={l.status === "teruggedraaid" ? () => act({ action: "restore", key: l.key }, "Les weer actief") : undefined} />)}
            </Section>
          )}
        </>
      )}

      {data && data.log.length > 0 && (
        <section className="card" style={{ marginTop: 24 }} aria-labelledby="log-title">
          <div className="card-head"><div><h2 className="card-title" id="log-title"><History aria-hidden />Logboek</h2><p className="card-sub">Wat het systeem zelf heeft aangepast, en wie iets terugdraaide</p></div></div>
          <div className="card-body">
            <ul className="learn-log">
              {data.log.map(r => (
                <li key={r.id}><span className="learn-log-date">{dateShort(r.at)}</span><Badge tone={r.action === "teruggedraaid" || r.action === "vervallen" ? "neutral" : "success"}>{ACTION_LABEL[r.action] || r.action}</Badge><span>{r.detail}{r.by && r.by !== "systeem" ? <span className="subtle"> · {r.by}</span> : null}</span></li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  return <div className="learn-stat"><span className="learn-stat-value">{value ?? "—"}</span><span className="learn-stat-label">{label}</span></div>
}

function Section({ title, sub, icon, children }: { title: string; sub: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="learn-section">
      <div className="section-head"><div><h2 className="section-title learn-section-title">{icon}{title}</h2><p className="section-sub">{sub}</p></div></div>
      <div className="learn-list">{children}</div>
    </section>
  )
}

function LessonCard({ l, busy, onRevert, onRestore }: { l: Lesson; busy: boolean; onRevert?: () => void; onRestore?: () => void }) {
  return (
    <article className={`card learn-card${l.status !== "actief" ? " is-inactive" : ""}`}>
      <div className="learn-card-top">
        <Badge tone="neutral">{SOURCE_LABEL[l.source]}</Badge>
        <Badge tone={l.confidence === "hoog" ? "success" : l.confidence === "middel" ? "info" : "neutral"}>Zekerheid {l.confidence}</Badge>
        {l.first_seen && <span className="subtle small">sinds {dateShort(l.first_seen)}</span>}
        {l.status === "teruggedraaid" && <span className="subtle small">teruggedraaid{l.reverted_by ? ` door ${l.reverted_by}` : ""}{l.reverted_at ? ` op ${dateShort(l.reverted_at)}` : ""}</span>}
      </div>
      <h3 className="learn-title">{l.title}</h3>
      <p><b>Bewijs:</b> {l.conclusion}</p>
      {l.effect && <p className="learn-effect"><CheckCircle2 aria-hidden /><span><b>Effect:</b> {l.effect.text}</span></p>}
      {l.evidence.examples?.length ? (
        <details className="learn-examples"><summary>Gebruikte metingen ({l.evidence.examples.length})</summary><ul>{l.evidence.examples.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
      ) : null}
      {l.evidence.items?.length ? (
        <details className="learn-examples"><summary>Welke contentkansen ({l.evidence.items.length})</summary>
          <ul>{l.evidence.items.map(it => <li key={it.id}><Link href={`/content/${it.id}?van=geleerd`}>{it.title}</Link></li>)}</ul>
        </details>
      ) : null}
      <div className="learn-actions">
        {onRevert && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onRevert}><Undo2 aria-hidden />Terugdraaien</button>}
        {onRestore && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onRestore}><RotateCcw aria-hidden />Weer toepassen</button>}
      </div>
    </article>
  )
}

// Eén regel, op elke plek hetzelfde (zie lib/learning.ts)
function Rule() {
  return <>De regel: elk afgerond resultaat telt direct mee. Eén resultaat verschuift de prioriteit een klein beetje (bijvoorbeeld ×1,07); hoe vaker uitkomsten elkaar bevestigen, hoe groter het effect (nooit meer dan ×0,7 tot ×1,3). Een afgewezen advies telt ook direct mee (×0,85 per afwijzing, nooit lager dan ×0,5). En per pagina onthoudt het systeem welke routes al geprobeerd zijn.</>
}
