"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ListPlus, Mail, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { dateShort, num, today } from "@/lib/format"
import { AFTER_EFFECT_DAYS, CAMPAIGN_KINDS, effectEnd, kindLabel, type Campaign } from "@/lib/campaigns"
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui"
import { HOUSING, THEMES, themeLabel, themesOf, type Housing, type Opportunity } from "@/lib/campaignOpportunities"

const EMPTY = { id: "", name: "", kind: "brief", start_date: "", end_date: "", regions: "", amount: "", landing_page: "", note: "", housing: "", themes: [] as string[] }

export default function CampaignsView() {
  const { toast, reload, addTask } = useWorkspace()
  const [rows, setRows] = useState<Campaign[] | null>(null)
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/campaigns", { cache: "no-store" }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows(j.rows); setOpps(j.opportunities || []); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k: Exclude<keyof typeof EMPTY, "themes">, v: string) => { setForm(f => f && { ...f, [k]: v }); setFormErr(null) }
  const toggleTheme = (id: string) => setForm(f => f && { ...f, themes: f.themes.includes(id) ? f.themes.filter(x => x !== id) : [...f.themes, id] })
  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const r = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, id: form.id || undefined, end_date: form.end_date || null, amount: form.amount || null, housing: form.housing || null }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      toast(form.id ? "Campagne bijgewerkt" : "Campagne vastgelegd"); setForm(null); load(); reload()
    } catch (e: any) { setFormErr(e.message) } finally { setBusy(false) }
  }
  const remove = async (c: Campaign) => {
    const r = await fetch(`/api/campaigns?id=${c.id}`, { method: "DELETE" })
    if (r.ok) { toast("Campagne verwijderd"); load() } else toast("Verwijderen mislukt", "error")
  }
  const edit = (c: Campaign) => setForm({ id: c.id, name: c.name, kind: c.kind, start_date: c.start_date, end_date: c.end_date || "", regions: c.regions.join(", "), amount: c.amount ? String(c.amount) : "", landing_page: c.landing_page || "", note: c.note || "", housing: c.housing || "", themes: c.themes || [] })
  const t = today()

  return (
    <>
      <PageHeader title="Offline campagnes"
        status={!rows ? null : (() => {
          // Loopt nu: tussen start en einde van het na-effect (zonder einddatum 21 dagen)
          const live = rows.filter(c => c.start_date <= t && effectEnd(c) >= t).length, soon = rows.filter(c => c.start_date > t).length
          return { tone: "info", text: rows.length ? `${live ? `${live} ${live === 1 ? "campagne loopt" : "campagnes lopen"} nu` : "Er loopt nu geen campagne"}${soon ? `, ${soon} gepland` : ""}.` : "Nog geen campagnes vastgelegd." }
        })()}
        sub="Brieven, flyers, advertenties en informatieavonden zorgen voor bezoek dat niet uit Google komt. Leg ze vast, dan houdt het dashboard er rekening mee: een gele band in de grafiek, en metingen in die periode krijgen geen oordeel."
        actions={!form ? <button className="btn btn-primary btn-sm" onClick={() => setForm({ ...EMPTY, start_date: t })}><Plus aria-hidden />Campagne toevoegen</button> : undefined} />
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
              <input id="c-regions" className="input" value={form.regions} onChange={e => set("regions", e.target.value)} placeholder="Bijvoorbeeld: Bornsche Maten, Borne" /></div>
            <div><label className="field-label" htmlFor="c-housing">Woningtype <span className="subtle">(optioneel)</span></label>
              <select id="c-housing" className="select" value={form.housing} onChange={e => set("housing", e.target.value)}>
                <option value="">Onbekend</option>{(Object.keys(HOUSING) as Housing[]).map(h => <option key={h} value={h}>{HOUSING[h]}</option>)}
              </select></div>
            <fieldset className="span2 campaign-themes"><legend className="field-label">Onderwerpen <span className="subtle">(voor kansen bij nieuws over subsidies en regels)</span></legend>
              <div className="chips">{THEMES.map(t => (
                <label key={t.id} className={`chip${form.themes.includes(t.id) ? " is-active" : ""}`}><input type="checkbox" className="sr-only" checked={form.themes.includes(t.id)} onChange={() => toggleTheme(t.id)} />{t.label}</label>
              ))}</div>
              <p className="field-hint">Niets gekozen? Dan haalt het dashboard de onderwerpen uit de naam en de notitie.</p>
            </fieldset>
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

      {rows && opps.length > 0 && (
        <section className="card camp-opps" aria-labelledby="camp-opps-title" style={{ marginBottom: 20 }}>
          <div className="card-head"><div><h2 className="card-title" id="camp-opps-title"><Sparkles aria-hidden />Kansen voor je campagnegebieden</h2>
            <p className="card-sub">Actueel nieuws over subsidies, regels, kosten of het stroomnet dat past bij het onderwerp, het gebied en het woningtype van een campagne. Er wordt niets automatisch verstuurd.</p></div></div>
          <div className="card-body">
            {rows.filter(c => opps.some(o => o.campaignId === c.id)).map(c => (
              <div key={c.id} className="camp-opp-group">
                <p className="camp-opp-camp"><b>{c.name}</b> <span className="subtle">· {kindLabel(c.kind).toLowerCase()} {dateShort(c.start_date)}{c.regions.length ? ` · ${c.regions.join(", ")}` : ""}{c.housing ? ` · ${HOUSING[c.housing].toLowerCase()}` : ""}</span></p>
                <ul className="camp-opp-list">{opps.filter(o => o.campaignId === c.id).map(o => (
                  <li key={o.ideaId}>
                    <div className="camp-opp-head"><Badge tone={o.impact === "subsidie" ? "success" : o.impact === "regelgeving" ? "info" : "neutral"}>{o.impactLabel}</Badge><Badge tone="neutral">{themeLabel(o.theme)}</Badge>{o.deadline && <span className="subtle small">{o.deadline}</span>}</div>
                    <p className="camp-opp-title">{o.title}</p>
                    {o.why && <p className="small">{o.why}{o.source && <span className="subtle"> ({o.source})</span>}</p>}
                    <p className="camp-opp-sugg"><b>Voorstel:</b> {o.suggestion}</p>
                    <p className="small subtle">{o.timing} {o.hasArticle ? "Er staat al een artikel over dit onderwerp om naar te verwijzen." : ""}</p>
                    <p className="small subtle">Waarom deze kans: {o.fit.join(" · ")}.</p>
                    <div className="inline-form-actions" style={{ justifyContent: "flex-start" }}>
                      <Link className="btn btn-ghost btn-sm" href={`/content/${o.ideaId}?van=campagnes`}>Aanleiding bekijken</Link>
                      <button className="btn btn-secondary btn-sm" disabled={added.has(o.ideaId + c.id)} onClick={async () => {
                        const ok = await addTask({ title: `Vervolgcampagne ${c.regions[0] || c.name}: ${o.title}`.slice(0, 140), description: `${o.suggestion}\n\nAanleiding: ${o.why}${o.source ? ` (${o.source})` : ""}\n${o.timing}`, priority: o.impact === "subsidie" || o.impact === "regelgeving" ? "hoog" : "middel", status: "nieuw", goal: "conversie" })
                        if (ok) setAdded(a => new Set(a).add(o.ideaId + c.id))
                      }}><ListPlus aria-hidden />{added.has(o.ideaId + c.id) ? "Op je takenlijst" : "Als taak toevoegen"}</button>
                    </div>
                  </li>
                ))}</ul>
              </div>
            ))}
          </div>
        </section>
      )}
      {rows && rows.length > 0 && opps.length === 0 && (
        <p className="muted small" style={{ margin: "0 0 16px" }}>Geen actuele kansen voor je campagnegebieden. Zodra er nieuws is over een subsidie, regel of kosten die bij het onderwerp en gebied van een campagne past, verschijnt het hier.{rows.some(c => !themesOf(c).length) ? " Tip: geef campagnes onderwerpen mee, dan vindt het dashboard ze beter." : ""}</p>
      )}

      {!rows ? <Skeleton height={160} /> : rows.length === 0 ? (
        !form && <div className="card"><EmptyState icon={<Mail />} title="Nog geen campagnes vastgelegd" text="Stuur je brieven of flyers rond? Leg ze hier vast, dan haalt het dashboard dat effect niet door elkaar met SEO." action={<button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...EMPTY, start_date: t })}>Campagne toevoegen</button>} /></div>
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
                <td>{c.regions.join(", ") || <span className="subtle">overal</span>}{c.housing && <span className="subtle" style={{ display: "block", fontSize: 12 }}>{HOUSING[c.housing]}</span>}{themesOf(c).length > 0 && <span className="subtle" style={{ display: "block", fontSize: 12 }}>{themesOf(c).map(themeLabel).join(", ")}</span>}{c.landing_page && <span className="subtle" style={{ display: "block", fontSize: 12 }}>→ {c.landing_page}</span>}</td>
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
