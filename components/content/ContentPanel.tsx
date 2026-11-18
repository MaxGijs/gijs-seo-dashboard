"use client"

import Attachments from "@/components/Attachments"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, BarChart3, Check, ClipboardCheck, Copy, ExternalLink, FileText, Gauge, Lightbulb, MessageSquareText, Newspaper, PenLine, Send, Trash2, X } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { Alert, Badge } from "@/components/ui"
import OwnerSelect from "@/components/OwnerSelect"

const BASIS_META: Record<Basis, { label: string; tone: "success" | "info" | "neutral"; hint: string }> = {
  gemeten: { label: "gemeten", tone: "success", hint: "Rechtstreeks uit data: Search Console of de publicatiedatum van de bron" },
  afgeleid: { label: "afgeleid", tone: "info", hint: "Door een vaste regel bepaald op basis van gemeten gegevens" },
  aangenomen: { label: "aangenomen", tone: "neutral", hint: "Vaste aanname tot er echte data is" },
}
import { num, pct, pos } from "@/lib/format"
import {
  type Angle, type ContentIdea, ANGLE_META, effectiveScore, FEEDBACK_TAGS, FORMATS, IMPACT_META, ORIGIN_META, RELIABILITY_META,
  REVIEW_ROLES, requiredReviews, serviceLabel, STATUS_META, consistencyIssues, type Basis,
} from "@/lib/content/model"
import { buildBriefing, lessonsFrom } from "@/lib/content/briefing"
import { ago, scoreTone } from "./ContentView"

const SITE = "https://www.groeninjestraat.nl"
const FLOW = ["nieuw", "geaccepteerd", "briefing", "concept", "review", "goedgekeurd", "gepubliceerd"] as const

function dateNl(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "datum onbekend"
}

function Tags({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="tag-pick">
      {FEEDBACK_TAGS.map(t => (
        <button type="button" key={t} className={`chip chip-sm${value.includes(t) ? " is-active" : ""}`} onClick={() => onChange(value.includes(t) ? value.filter(x => x !== t) : [...value, t])}>{t}</button>
      ))}
    </div>
  )
}

export default function ContentPanel({ idea, all, onClose, onUpdate, onDeleted }: { idea: ContentIdea; all: ContentIdea[]; onClose: () => void; onUpdate: (i: ContentIdea) => void; onDeleted?: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { toast } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<null | "edit" | "reject" | "later" | "feedback">(null)
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [form, setForm] = useState({ title: idea.title, angle: idea.angle || "neutraal", format: idea.format || "", advice: idea.advice || "nieuw", score: idea.score_override ?? "", priority: idea.priority || "middel" })
  const [briefing, setBriefing] = useState(idea.briefing || "")
  const [concept, setConcept] = useState("")
  const [final, setFinal] = useState(idea.concept_final || "")
  const [pubUrl, setPubUrl] = useState(idea.published_url || "")
  const [pubDate, setPubDate] = useState(idea.published_at || new Date().toISOString().slice(0, 10))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  useEffect(() => { setFinal(idea.concept_final || ""); setBriefing(idea.briefing || "") }, [idea.id, idea.concept_final, idea.briefing])

  const lessons = useMemo(() => lessonsFrom(all), [all])
  const score = effectiveScore(idea)
  const step = STATUS_META[idea.status].step
  const needed = requiredReviews(idea)
  const issues = consistencyIssues(idea)
  const kwTotal = idea.keywords.reduce((s, k) => s + k.impressions, 0)

  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/content/${idea.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onUpdate(json.idea)
      if (ok) toast(ok)
      setMode(null); setTags([]); setNote("")
      return true
    } catch (e: any) { toast(e.message, "error"); return false }
    finally { setBusy(false) }
  }

  const makeBriefing = async () => {
    const text = buildBriefing(idea, lessons)
    setBriefing(text)
    const saved = await act({ action: "edit", fields: { briefing: text } })
    if (saved) await act({ action: "status", status: "briefing" }, "Briefing klaar")
  }
  const copyBriefing = async () => {
    try {
      await navigator.clipboard.writeText(briefing)
      window.open("https://claude.ai/new", "_blank", "noopener")
      toast("Briefing gekopieerd. Plak hem in claude.ai en zet het concept daarna hier terug.")
    } catch { toast("Kopiëren lukte niet; selecteer de tekst handmatig.", "error") }
  }

  const sourcesByDate = [...idea.sources].sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0))
  const corrections = idea.score_parts.filter(p => p.label === "Correctie")
  const parts = idea.score_parts.filter(p => p.label !== "Correctie")

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="cp-title">
        <div className="panel-head">
          <div className="panel-head-top">
            <div className="panel-tags">
              <Badge tone="accent">{ORIGIN_META[idea.origin].label}</Badge>
              {idea.impact && idea.impact !== "overig" && <Badge tone="neutral">{IMPACT_META[idea.impact].label}</Badge>}
              <Badge tone={step < 0 ? "neutral" : "success"} dot>{STATUS_META[idea.status].label}</Badge>
              <OwnerSelect value={idea.owner} onChange={o => act({ action: "owner", owner: o }, o ? "Toegewezen" : "Toewijzing verwijderd")} />
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Sluiten"><X /></button>
          </div>
          <h2 className="panel-title" id="cp-title">{idea.title}</h2>
          <p className="panel-subtitle">{idea.format} · {serviceLabel(idea.service)}{idea.regions.length ? ` · ${idea.regions.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")}` : ""} · gevonden {ago(idea.created_at)}</p>
          {step >= 0 && (
            <ol className="flow" aria-label="Voortgang">
              {FLOW.map(s => <li key={s} className={STATUS_META[s].step < step ? "is-done" : STATUS_META[s].step === step ? "is-current" : ""}>{STATUS_META[s].label}</li>)}
            </ol>
          )}
        </div>

        <div className="panel-body">
          {issues.length > 0 && (
            <div className="psec" style={{ paddingBottom: 0 }}>
              <Alert tone="error" title="Dit voorstel is geblokkeerd: de onderbouwing klopt niet">{issues.join(" ")}</Alert>
            </div>
          )}
          <section className="psec" aria-label="Samenvatting">
            <div className={`summary${score < 45 ? " summary-afwachten" : ""}`}>
              <span className="summary-verdict"><Lightbulb aria-hidden />{idea.advice === "bijwerken" ? "Bestaande pagina bijwerken" : idea.advice === "niets" ? "Niets doen" : "Nieuw artikel schrijven"}</span>
              <p className="summary-task">{idea.why_now}</p>
              {idea.advice_note && <p className="summary-note">{idea.advice_note}</p>}
              <table className="ptable ptable-kv summary-table">
                <tbody>
                  <tr><th scope="row">Score</th><td><span className={`score-inline score-${scoreTone(score)}`}>{score}</span>{idea.score_override !== null && <span className="subtle"> (berekend {idea.score})</span>}</td></tr>
                  <tr><th scope="row">Prioriteit</th><td>{idea.priority ? idea.priority[0].toUpperCase() + idea.priority.slice(1) : "—"}</td></tr>
                  <tr><th scope="row">Invalshoek</th><td>{idea.angle ? ANGLE_META[idea.angle].label : "—"}</td></tr>
                  <tr><th scope="row">Commercieel</th><td>{idea.commercial_value?.split(":")[0]}</td></tr>
                  <tr><th scope="row">Bereik en autoriteit</th><td>{idea.reach_value}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="psec" aria-labelledby="cp-why">
            <h3 className="psec-title" id="cp-why"><span className="psec-num">1</span>Aanleiding en bronnen</h3>
            {idea.summary && idea.summary !== idea.why_now && <p className="lead" style={{ fontSize: "var(--fs-sm)" }}>{idea.summary}</p>}
            <table className="ptable src-table">
              <thead><tr><th>Bron</th><th>Uitgever</th><th>Datum</th><th>Betrouwbaarheid</th></tr></thead>
              <tbody>{sourcesByDate.map((s, i) => (
                <tr key={i}>
                  <td>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} <ExternalLink aria-hidden /></a> : <b>{s.title}</b>}</td>
                  <td>{s.publisher}</td>
                  <td className="nowrap">{dateNl(s.date)}{s.firstSeen ? <span className="subtle small" style={{ display: "block" }}>gevonden op</span> : null}</td>
                  <td>{RELIABILITY_META[s.reliability]?.label}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>

          <section className="psec" aria-labelledby="cp-score">
            <h3 className="psec-title" id="cp-score"><span className="psec-num">2</span>Waarom deze score</h3>
            <table className="ptable score-parts">
              <thead><tr><th>Onderdeel</th><th className="num">Punten</th><th>Waarom</th></tr></thead>
              <tbody>
                {parts.map(p => (
                  <tr key={p.label}>
                    <td style={{ width: "32%" }}><strong>{p.label}</strong>{p.basis && <div style={{ marginTop: 3 }}><span className={`badge tone-${BASIS_META[p.basis].tone}`} title={BASIS_META[p.basis].hint}>{BASIS_META[p.basis].label}</span></div>}</td>
                    <td className="num" style={{ width: 56 }}>{p.points}/{p.max}</td><td>{p.why}</td>
                  </tr>
                ))}
                {corrections.map((c, i) => <tr key={i}><td><strong>Correctie</strong></td><td /><td>{c.why}</td></tr>)}
              </tbody>
            </table>
            {idea.score_override !== null && <p className="field-hint">Een medewerker heeft de score aangepast naar {idea.score_override}.</p>}
            <p className="field-hint"><b>Gemeten</b>: rechtstreeks uit data. <b>Afgeleid</b>: door een vaste regel bepaald. <b>Aangenomen</b>: aanname tot er echte data is.</p>
          </section>

          <section className="psec" aria-labelledby="cp-plan">
            <h3 className="psec-title" id="cp-plan"><span className="psec-num">3</span>Voorstel</h3>
            <table className="ptable ptable-kv">
              <tbody>
                <tr><th scope="row">Doelgroep</th><td>{idea.audience}</td></tr>
                <tr><th scope="row">Dienst</th><td>{serviceLabel(idea.service)}{idea.target_page && <> · <a href={SITE + idea.target_page} target="_blank" rel="noopener noreferrer">{idea.target_page}</a></>}</td></tr>
                <tr><th scope="row">Zoekintentie</th><td>{idea.intent}</td></tr>
                <tr><th scope="row">Doel</th><td>{idea.goal}</td></tr>
                <tr><th scope="row">Call-to-action</th><td>{idea.cta}</td></tr>
                <tr><th scope="row">Houdbaarheid</th><td>{idea.shelf_life === "actueel" ? "Actueel (veroudert snel; plan een update)" : "Evergreen"}</td></tr>
                <tr><th scope="row">Commerciële waarde</th><td>{idea.commercial_value}</td></tr>
              </tbody>
            </table>
            {idea.title_options.length > 1 && (
              <>
                <p className="field-label" style={{ marginTop: 14 }}>Titelopties per invalshoek</p>
                <table className="ptable title-table">
                  <thead><tr><th>Invalshoek</th><th>Titel</th><th /></tr></thead>
                  <tbody>{idea.title_options.map(o => (
                    <tr key={o.title} className={o.title === idea.title ? "is-chosen" : ""}>
                      <td className="nowrap"><Badge tone={o.title === idea.title ? "success" : "neutral"}>{ANGLE_META[o.angle].label}</Badge></td>
                      <td>{o.title === idea.title ? <b>{o.title}</b> : o.title}</td>
                      <td className="nowrap">{o.title === idea.title ? <span className="subtle small">gekozen</span> : step <= 2 && step >= 0 ? <button className="link-btn" disabled={busy} onClick={() => act({ action: "edit", fields: { title: o.title, angle: o.angle } }, "Titel en invalshoek aangepast")}>Kiezen</button> : null}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </>
            )}
            <p className="field-label" style={{ marginTop: 14 }}>Zoekwoorden waarop de zoekvraag is gebaseerd <span className="subtle">(Search Console, 28 dagen)</span></p>
            {idea.keywords.length > 0 ? (
              <div className="kw-scroll">
                <table className="ptable">
                  <thead><tr><th>Zoekwoord</th><th className="num">Vertoningen</th><th className="num">Klikken</th><th className="num">Positie</th></tr></thead>
                  <tbody>{idea.keywords.map(k => <tr key={k.query}><td>{k.query}</td><td className="num">{num(k.impressions)}</td><td className="num">{num(k.clicks)}</td><td className="num">{k.position ? pos(k.position) : "—"}</td></tr>)}</tbody>
                  <tfoot><tr><td><strong>Totaal ({idea.keywords.length})</strong></td><td className="num"><strong>{num(kwTotal)}</strong></td><td className="num"><strong>{num(idea.keywords.reduce((s, k) => s + k.clicks, 0))}</strong></td><td /></tr></tfoot>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Geen zoekwoorden in Search Console die precies over dit onderwerp gaan. Dat telt als 0 punten voor zoekvraag; het bereik is onzeker.</p>
            )}
          </section>

          <section className="psec" aria-labelledby="cp-risk">
            <h3 className="psec-title" id="cp-risk"><span className="psec-num">4</span>Risico&apos;s en onzekerheden</h3>
            <table className="ptable risk-table">
              <thead><tr><th className="col-n">#</th><th>Risico of onzekerheid</th></tr></thead>
              <tbody>{idea.risks.map((r, i) => <tr key={r}><td className="col-n"><AlertTriangle aria-hidden /></td><td>{r}</td></tr>)}</tbody>
            </table>
          </section>

          {/* ── Productie ─────────────────────────────────────────── */}
          {step >= 1 && (
            <section className="psec" aria-labelledby="cp-brief">
              <h3 className="psec-title" id="cp-brief"><FileText aria-hidden />Briefing voor Claude</h3>
              {!idea.briefing ? (
                <>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>De briefing bevat de aanleiding, bronnen met datum, doelgroep, dienst, zoekwoorden, structuur en de schrijfregels van Gijs{lessons.length ? `, plus ${lessons.length} ${lessons.length === 1 ? "les" : "lessen"} uit eerdere correcties` : ""}.</p>
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={makeBriefing}><FileText aria-hidden />Briefing maken</button>
                </>
              ) : (
                <>
                  <textarea className="textarea mono" rows={10} value={briefing} onChange={e => setBriefing(e.target.value)} aria-label="Briefing" />
                  <div className="inline-form-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={copyBriefing}><Copy aria-hidden />Kopiëren en Claude openen</button>
                    {briefing !== idea.briefing && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act({ action: "edit", fields: { briefing } }, "Briefing opgeslagen")}>Wijzigingen opslaan</button>}
                  </div>
                </>
              )}
            </section>
          )}

          {step >= 2 && (
            <section className="psec" aria-labelledby="cp-concept">
              <h3 className="psec-title" id="cp-concept"><PenLine aria-hidden />Concept{idea.concept_change_pct !== null && idea.concept_original && <span className="subtle">redactie wijzigde {idea.concept_change_pct}% van de tekst</span>}</h3>
              {!idea.concept_original ? (
                <>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Plak hier het concept dat Claude schreef. Het origineel blijft altijd bewaard, zodat zichtbaar wordt wat de redactie aanpast.</p>
                  <textarea className="textarea" rows={8} value={concept} onChange={e => setConcept(e.target.value)} placeholder="Plak het volledige concept…" aria-label="Concept plakken" />
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy || concept.trim().length < 200} onClick={() => act({ action: "concept", original: concept }, "Concept vastgelegd")}>Concept vastleggen</button>
                </>
              ) : (
                <>
                  <label className="field-label" htmlFor="cp-final">Bewerkte versie (de versie die gepubliceerd wordt)</label>
                  <textarea id="cp-final" className="textarea" rows={12} value={final} onChange={e => setFinal(e.target.value)} readOnly={step >= 5} />
                  <div className="inline-form-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                    {step < 5 && final !== idea.concept_final && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act({ action: "concept", final }, "Bewerkte versie opgeslagen")}>Opslaan</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(idea.concept_final || "").then(() => toast("Tekst gekopieerd"))}><Copy aria-hidden />Kopiëren</button>
                  </div>
                  <details className="evidence-details"><summary>Oorspronkelijk concept bekijken</summary><div className="note-box" style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>{idea.concept_original}</div></details>
                </>
              )}
            </section>
          )}

          <Attachments kind="content" refId={idea.id} />

          {step >= 3 && (
            <section className="psec" aria-labelledby="cp-review">
              <h3 className="psec-title" id="cp-review"><ClipboardCheck aria-hidden />Controle</h3>
              <ul className="review-list">
                {REVIEW_ROLES.filter(r => needed.includes(r.key) || idea.review?.[r.key]).map(r => {
                  const v = idea.review?.[r.key]
                  return (
                    <li key={r.key} className={v?.ok ? "is-ok" : ""}>
                      <button className="check" disabled={busy || step >= 6} aria-pressed={!!v?.ok} onClick={() => act({ action: "review", role: r.key, ok: v?.ok ? null : true })}>{v?.ok && <Check aria-hidden />}</button>
                      <span><strong>{r.label}</strong>{v?.ok ? <small>{v.by} · {new Date(v.at).toLocaleDateString("nl-NL")}</small> : <small>{needed.includes(r.key) ? "verplicht" : ""}</small>}</span>
                    </li>
                  )
                })}
              </ul>
              {(idea.impact === "subsidie" || idea.impact === "regelgeving" || idea.impact === "kosten") && <p className="field-hint">Bij subsidies, regels en kosten zijn de technische controle en de controle op actualiteit verplicht.</p>}
            </section>
          )}

          {step >= 5 && (
            <section className="psec" aria-labelledby="cp-pub">
              <h3 className="psec-title" id="cp-pub"><Send aria-hidden />Publicatie</h3>
              {step === 5 ? (
                <div className="inline-form">
                  <p style={{ fontSize: "var(--fs-sm)" }}>Het dashboard publiceert nooit zelf. Plaats het artikel op de site en leg hier vast waar en wanneer; daarna start de meting na 7, 30 en 90 dagen.</p>
                  <div className="modal-row">
                    <div><label className="field-label" htmlFor="cp-url">URL op groeninjestraat.nl</label><input id="cp-url" className="input" style={{ width: "100%" }} value={pubUrl} onChange={e => setPubUrl(e.target.value)} placeholder="https://www.groeninjestraat.nl/kennis/…" /></div>
                    <div><label className="field-label" htmlFor="cp-date">Publicatiedatum</label><input id="cp-date" type="date" className="input" style={{ width: "100%" }} value={pubDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setPubDate(e.target.value)} /></div>
                  </div>
                  <div className="inline-form-actions"><button className="btn btn-primary btn-sm" disabled={busy || !pubUrl} onClick={() => act({ action: "publish", url: pubUrl, date: pubDate }, "Vastgelegd als gepubliceerd; meting gestart")}>Vastleggen als gepubliceerd</button></div>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: "var(--fs-sm)" }}>Gepubliceerd op {dateNl(idea.published_at)}: <a href={idea.published_url!} target="_blank" rel="noopener noreferrer">{idea.published_url!.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/, "")}</a></p>
                  <div className="exp-measures" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 10 }}>
                    {(["d7", "d30", "d90"] as const).map(k => {
                      const e = idea.evals?.[k]
                      return (
                        <div key={k} className={`measure${e ? "" : " is-pending"}`}>
                          <div className="measure-label">Na {k.slice(1)} dagen</div>
                          {e ? <><div className="measure-value">{num(e.clicks)} klikken</div><div className="measure-sub">{num(e.impressions)} vertoningen · {pct(e.ctr)} · pos. {e.position ? pos(e.position) : "—"}</div></>
                            : <div className="measure-sub">nog niet gemeten</div>}
                        </div>
                      )
                    })}
                  </div>
                  <p className="field-hint"><BarChart3 aria-hidden style={{ width: 12, height: 12, verticalAlign: -1 }} /> Search Console-cijfers van deze URL. Aanvragen en energiescans per artikel volgen zodra die gekoppeld zijn.</p>
                  <p className="field-hint">Waarom 7, 30 en 90 dagen en niet 14, 28 en 56 zoals bij SEO-experimenten? Een nieuw artikel moet eerst gevonden en geïndexeerd worden en bouwt daarna langzaam posities op. Na 7 dagen zie je of het geïndexeerd is, na 90 dagen hoe het presteert. Een aanpassing aan een bestaande pagina werkt sneller en wordt daarom na 56 dagen beoordeeld.</p>
                </>
              )}
            </section>
          )}

          {idea.feedback.length > 0 && (
            <section className="psec" aria-labelledby="cp-fb">
              <h3 className="psec-title" id="cp-fb"><MessageSquareText aria-hidden />Feedback</h3>
              <ul className="fb-list">
                {idea.feedback.map((f, i) => <li key={i}><Badge tone="neutral">{f.tag}</Badge>{f.note && <span>{f.note}</span>}<small>{f.by} · {new Date(f.at).toLocaleDateString("nl-NL")}</small></li>)}
              </ul>
            </section>
          )}
        </div>

        <div className="panel-foot">
          {mode === "edit" && (
            <div className="inline-form">
              <label className="field-label" htmlFor="e-title">Titel</label>
              <input id="e-title" className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              <div className="modal-row">
                <div><label className="field-label" htmlFor="e-angle">Invalshoek</label>
                  <select id="e-angle" className="select" style={{ width: "100%" }} value={form.angle} onChange={e => setForm({ ...form, angle: e.target.value as Angle })}>{(Object.keys(ANGLE_META) as Angle[]).map(a => <option key={a} value={a}>{ANGLE_META[a].label}</option>)}</select></div>
                <div><label className="field-label" htmlFor="e-format">Contentvorm</label>
                  <select id="e-format" className="select" style={{ width: "100%" }} value={form.format} onChange={e => setForm({ ...form, format: e.target.value })}>{FORMATS.map(f => <option key={f}>{f}</option>)}</select></div>
                <div><label className="field-label" htmlFor="e-advice">Advies</label>
                  <select id="e-advice" className="select" style={{ width: "100%" }} value={form.advice} onChange={e => setForm({ ...form, advice: e.target.value as any })}>
                    <option value="nieuw">Nieuw maken</option><option value="bijwerken">Bestaande bijwerken</option><option value="samenvoegen">Samenvoegen</option><option value="niets">Niets doen</option>
                  </select></div>
                <div><label className="field-label" htmlFor="e-score">Score (leeg = berekend: {idea.score})</label>
                  <input id="e-score" className="input" style={{ width: "100%" }} inputMode="numeric" value={form.score} onChange={e => setForm({ ...form, score: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></div>
              </div>
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Annuleren</button>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act({ action: "edit", fields: { title: form.title, angle: form.angle, format: form.format, advice: form.advice, score_override: form.score === "" ? null : Number(form.score), priority: form.score === "" ? idea.priority : Number(form.score) >= 65 ? "hoog" : Number(form.score) >= 45 ? "middel" : "laag" } }, "Voorstel aangepast")}>Opslaan</button>
              </div>
            </div>
          )}
          {(mode === "reject" || mode === "later" || mode === "feedback") && (
            <div className="inline-form">
              <p className="field-label" style={{ margin: 0 }}>{mode === "reject" ? "Waarom afwijzen? Het dashboard leert hiervan." : mode === "later" ? "Waarom later? (optioneel)" : "Feedback op dit voorstel of concept"}</p>
              <Tags value={tags} onChange={setTags} />
              <textarea className="textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Toelichting (optioneel)" />
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Annuleren</button>
                <button className={`btn btn-sm ${mode === "reject" ? "btn-danger" : "btn-primary"}`} disabled={busy || (mode !== "later" && !tags.length && !note.trim())}
                  onClick={() => mode === "feedback" ? act({ action: "feedback", tags, note }, "Feedback opgeslagen") : act({ action: "status", status: mode === "reject" ? "afgewezen" : "later", tags, note }, mode === "reject" ? "Afgewezen" : "Op later gezet")}>
                  {mode === "reject" ? "Afwijzen" : mode === "later" ? "Op later zetten" : "Opslaan"}
                </button>
              </div>
            </div>
          )}
          {!mode && (
            <div className="panel-actions">
              {(idea.status === "nieuw" || idea.status === "later" || idea.status === "verlopen") && (
                <>
                  <button className="btn btn-primary" disabled={busy || issues.length > 0} title={issues.length ? "Geblokkeerd: de onderbouwing klopt niet" : undefined} onClick={() => act({ action: "status", status: "geaccepteerd" }, "Geaccepteerd. Maak nu de briefing.")}><Check aria-hidden />Accepteren</button>
                  <button className="btn btn-secondary" onClick={() => setMode("edit")}><Gauge aria-hidden />Aanpassen</button>
                  <span className="grow" />
                  {idea.status !== "later" && <button className="btn btn-ghost btn-sm" onClick={() => setMode("later")}>Later</button>}
                  <button className="btn btn-danger btn-sm" onClick={() => setMode("reject")}>Afwijzen</button>
                </>
              )}
              {idea.status === "afgewezen" && <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: "status", status: "nieuw" }, "Teruggezet naar te beoordelen")}>Opnieuw beoordelen</button>}
              {step >= 1 && step <= 4 && (
                <>
                  {step >= 3 && <button className="btn btn-primary" disabled={busy || needed.some(r => !idea.review?.[r]?.ok)} title={needed.some(r => !idea.review?.[r]?.ok) ? "Eerst alle verplichte controles afvinken" : undefined}
                    onClick={() => act({ action: "status", status: "goedgekeurd" }, "Goedgekeurd. Publiceren doet een medewerker.")}><Check aria-hidden />Goedkeuren</button>}
                  {step <= 2 && <button className="btn btn-secondary" onClick={() => setMode("edit")}><Gauge aria-hidden />Aanpassen</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setMode("feedback")}><MessageSquareText aria-hidden />Feedback</button>
                  <span className="grow" />
                  <button className="btn btn-danger btn-sm" onClick={() => setMode("reject")}>Stoppen</button>
                </>
              )}
              {step >= 5 && <button className="btn btn-ghost btn-sm" onClick={() => setMode("feedback")}><MessageSquareText aria-hidden />Feedback</button>}
            </div>
          )}
          {!mode && idea.origin === "handmatig" && idea.status !== "gepubliceerd" && (confirmDelete ? (
            <div className="inline-form inline-form-danger">
              <p className="field-label">Deze kans definitief verwijderen?</p>
              <p className="field-hint">De kans en eventuele bijlagen verdwijnen. Dit kun je niet ongedaan maken. Is hij alleen niet nodig? Wijs hem dan liever af, dan leert het systeem ervan.</p>
              <div className="inline-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Annuleren</button>
                <button className="btn btn-danger-solid btn-sm" disabled={busy} onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await fetch(`/api/content/${idea.id}`, { method: "DELETE" }); const j = await r.json().catch(() => ({}))
                    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
                    toast("Kans verwijderd"); onDeleted?.(idea.id); onClose()
                  } catch (e: any) { toast(`Verwijderen mislukt: ${e.message}`, "error") } finally { setBusy(false) }
                }}><Trash2 aria-hidden />Verwijderen</button>
              </div>
            </div>
          ) : (
            <div className="panel-links"><button className="link-btn link-danger" onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden />Kans verwijderen</button></div>
          ))}
        </div>
      </aside>
    </>
  )
}
