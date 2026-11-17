"use client"

import { useCallback, useEffect, useState } from "react"
import { Mail, Pencil, Plus, Trash2 } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { dateShort, num, today } from "@/lib/format"
import { AFTER_EFFECT_DAYS, CAMPAIGN_KINDS, effectEnd, kindLabel, type Campaign } from "@/lib/campaigns"
import { Alert, EmptyState, Skeleton } from "@/components/ui"

const EMPTY = { id: "", name: "", kind: "brief", start_date: "", end_date: "", regions: "", amount: "", landing_page: "", note: "" }

export default function CampaignsView() {
  const { toast, reload } = useWorkspace()
  const [rows, setRows] = useState<Campaign[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/campaigns", { cache: "no-store" }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows(j.rows); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k: keyof typeof EMPTY, v: string) => { setForm(f => f && { ...f, [k]: v }); setFormErr(null) }
  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const r = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, id: form.id || undefined, end_date: form.end_date || null, amount: form.amount || null }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      toast(form.id ? "Campagne bijgewerkt" : "Campagne vastgelegd"); setForm(null); load(); reload()
    } catch (e: any) { setFormErr(e.message) } finally { setBusy(false) }
  }
  const remove = async (c: Campaign) => {
    const r = await fetch(`/api/campaigns?id=${c.id}`, { method: "DELETE" })
    if (r.ok) { toast("Campagne verwijderd"); load() } else toast("Verwijderen mislukt", "error")
  }
  const edit = (c: Campaign) => setForm({ id: c.id, name: c.name, kind: c.kind, start_date: c.start_date, end_date: c.end_date || "", regions: c.regions.join(", "), amount: c.amount ? String(c.amount) : "", landing_page: c.landing_page || "", note: c.note || "" })
  const t = today()

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Offline campagnes</h1>
          <p className="page-sub">Brieven, flyers, advertenties en informatieavonden. Ze zorgen voor bezoek en aanvragen die niet uit Google komen. Leg ze hier vast, dan houdt het dashboard er rekening mee: ze staan als gele band in de grafiek en een meting die erdoor beïnvloed kan zijn, krijgt geen oordeel.</p>
        </div>
        {!form && <button className="btn btn-primary btn-sm" onClick={() => setForm({ ...EMPTY, start_date: t })}><Plus aria-hidden />Campagne toevoegen</button>}
      </div>
      {err && <Alert tone="error" title="Campagnes konden niet worden geladen">{err}</Alert>}

      {form && (
        <section className="card" style={{ marginBottom: 20 }}>
          <div className="card-head"><div><h2 className="card-title"><Mail aria-hidden />{form.id ? "Campagne wijzigen" : "Nieuwe campagne"}</h2></div></div>
          <div className="card-body campaign-form">
            <div className="span2"><label className="field-label" htmlFor="c-name">Naam</label>
              <input id="c-name" className="input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Bijvoorbeeld: Brief isolatiesubsidie Borne" maxLength={140} autoFocus /></div>
            <div><label className="field-label" htmlFor="c-kind">Soort</label>
              <select id="c-kind" className="select" value={form.kind} onChange={e => set("kind", e.target.value)}>{CAMPAIGN_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></div>
            <div><label className="field-label" htmlFor="c-amount">Aantal <span className="subtle">(optioneel)</span></label>
              <input id="c-amount" className="input" type="number" min={1} value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="Bijvoorbeeld: 2500" /></div>
            <div><label className="field-label" htmlFor="c-start">Verstuurd / start</label>
              <input id="c-start" className="input" type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)} /></div>
            <div><label className="field-label" htmlFor="c-end">Einde <span className="subtle">(optioneel)</span></label>
              <input id="c-end" className="input" type="date" value={form.end_date} onChange={e => set("end_date", e.target.value)} />
              <p className="field-hint">Leeg = we rekenen {AFTER_EFFECT_DAYS} dagen na-effect.</p></div>
            <div className="span2"><label className="field-label" htmlFor="c-regions">Gebied <span className="subtle">(gemeenten of provincies, met komma's)</span></label>
              <input id="c-regions" className="input" value={form.regions} onChange={e => set("regions", e.target.value)} placeholder="Bijvoorbeeld: Borne, Hengelo" /></div>
            <div className="span2"><label className="field-label" htmlFor="c-page">Verwijst naar pagina <span className="subtle">(optioneel, bv. de QR-code)</span></label>
              <input id="c-page" className="input" value={form.landing_page} onChange={e => set("landing_page", e.target.value)} placeholder="/regio/overijssel/borne" /></div>
            <div className="span2"><label className="field-label" htmlFor="c-note">Notitie <span className="subtle">(optioneel)</span></label>
              <textarea id="c-note" className="textarea" value={form.note} onChange={e => set("note", e.target.value)} placeholder="Bijvoorbeeld: samen met de gemeente, alleen koopwoningen voor 1975" /></div>
            {formErr && <p className="field-error span2">{formErr}</p>}
            <div className="inline-form-actions span2">
              <button className="btn btn-ghost btn-sm" onClick={() => { setForm(null); setFormErr(null) }}>Annuleren</button>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "Opslaan…" : "Opslaan"}</button>
            </div>
          </div>
        </section>
      )}

      {!rows ? <Skeleton height={160} /> : rows.length === 0 ? (
        !form && <div className="card"><EmptyState icon={<Mail />} title="Nog geen campagnes vastgelegd" text="Stuur je brieven of flyers rond? Leg ze hier vast, dan haalt het dashboard dat effect niet door elkaar met SEO." action={<button className="btn btn-primary btn-sm" onClick={() => setForm({ ...EMPTY, start_date: t })}>Campagne toevoegen</button>} /></div>
      ) : (
        <div className="card"><div className="table-wrap"><table className="table">
          <thead><tr><th>Campagne</th><th>Soort</th><th>Periode (met na-effect)</th><th>Gebied</th><th className="num">Aantal</th><th /></tr></thead>
          <tbody>{rows.map(c => {
            const end = effectEnd(c), live = c.start_date <= t && end >= t
            return (
              <tr key={c.id}>
                <td className="cell-main">{c.name}{live && <span className="badge tone-warning" style={{ marginLeft: 6 }}>Loopt nu</span>}{c.note && <span className="subtle" style={{ display: "block", fontSize: 12, fontWeight: 400 }}>{c.note}</span>}</td>
                <td className="nowrap">{kindLabel(c.kind)}</td>
                <td className="nowrap">{dateShort(c.start_date)} – {dateShort(end)}{!c.end_date && <span className="subtle"> (na-effect)</span>}</td>
                <td>{c.regions.join(", ") || <span className="subtle">overal</span>}{c.landing_page && <span className="subtle" style={{ display: "block", fontSize: 12 }}>→ {c.landing_page}</span>}</td>
                <td className="num">{c.amount ? num(c.amount) : "—"}</td>
                <td className="nowrap"><button className="icon-btn" aria-label={`Wijzig ${c.name}`} onClick={() => edit(c)}><Pencil /></button><button className="icon-btn" aria-label={`Verwijder ${c.name}`} onClick={() => remove(c)}><Trash2 /></button></td>
              </tr>
            )
          })}</tbody>
        </table></div></div>
      )}
    </>
  )
}
