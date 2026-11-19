"use client"

import Attachments from "@/components/Attachments"
import { CONTENT_STEP } from "@/lib/content/useContent"
import { articleVerdict } from "@/lib/content/verdict"
import { compare, isPageUpdate, judgeUpdate, nextMilestone, OUTCOME_META, UPDATE_MILESTONES, UPDATE_RULE, type UpdatePoint } from "@/lib/content/update"
import { ownerName } from "@/components/OwnerSelect"
import { Fragment, useEffect, useMemo, useState } from "react"
import { AlertTriangle, BarChart3, Check, ClipboardCheck, Copy, ExternalLink, FileText, Gauge, HelpCircle, Lightbulb, MessageSquareText, Newspaper, PenLine, Send, Sparkles, StickyNote, Trash2, X, ArrowLeft } from "lucide-react"
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
  type Angle, type ContentIdea, ANGLE_META, effectiveScore, FEEDBACK_TAGS, FORMATS, IMPACT_META, ORIGIN_META, RELEVANCE_META, RELIABILITY_META,
  REVIEW_ROLES, requiredReviews, serviceLabel, STATUS_META, consistencyIssues, type Basis,
} from "@/lib/content/model"
import { buildBriefing, lessonsFrom, styleGuideFrom } from "@/lib/content/briefing"
import { buildRelevancePrompt } from "@/lib/content/relevance"
import { briefingNotes, learnFromFeedback, previewNote } from "@/lib/content/feedback"
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

export default function ContentPanel({ idea, all, onClose, onUpdate, onDeleted, variant = "panel", backLabel = "Terug" }: { idea: ContentIdea; all: ContentIdea[]; onClose: () => void; onUpdate: (i: ContentIdea) => void; onDeleted?: (id: string) => void; variant?: "panel" | "page"; backLabel?: string }) {
  const isPage = variant === "page"
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { toast, users, me } = useWorkspace()
  const [editNote, setEditNote] = useState(false)
  const [attCount, setAttCount] = useState(0)
  const [noteText, setNoteText] = useState(idea.note || "")
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<null | "edit" | "reject" | "later" | "feedback">(null)
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [form, setForm] = useState({ title: idea.title, angle: idea.angle || "neutraal", format: idea.format || "", advice: idea.advice || "nieuw", score: idea.score_override ?? "", priority: idea.priority || "middel" })
  const [briefing, setBriefing] = useState(idea.briefing || "")
  const [concept, setConcept] = useState("")
  const [final, setFinal] = useState(idea.concept_final || "")
  // Bij bijwerken staat de pagina al vast: vul de bestaande URL alvast in
  const [pubUrl, setPubUrl] = useState(idea.published_url || (isPageUpdate(idea) && idea.target_page ? `https://www.groeninjestraat.nl${idea.target_page}` : ""))
  const [pubDate, setPubDate] = useState(idea.published_at || new Date().toISOString().slice(0, 10))

  useEffect(() => {
    if (isPage) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, isPage])
  useEffect(() => { setFinal(idea.concept_final || ""); setBriefing(idea.briefing || "") }, [idea.id, idea.concept_final, idea.briefing])

  // Lessen voor de briefing: vaak gekozen redenen + aandachtspunten uit eigen toelichtingen
  const notePreview = useMemo(() => (mode === "reject" ? previewNote(note, idea, all) : null), [mode, note, idea, all])
  const lessons = useMemo(() => [...lessonsFrom(all), ...briefingNotes(learnFromFeedback(all))], [all])
  const style = useMemo(() => styleGuideFrom(all, idea.id), [all, idea.id])
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
    const text = buildBriefing(idea, lessons, style)
    setBriefing(text)
    const saved = await act({ action: "edit", fields: { briefing: text } })
    if (saved) await act({ action: "status", status: "briefing" }, "Briefing klaar")
  }
  // Opdracht voor Claude (met de Gijs-koppeling): opzet maken en terugzetten in het dashboard
  const askOutline = async () => {
    const prompt = `Gebruik de Gijs-koppeling. Haal met artikel_opzet alles op voor contentkans ${idea.id} ("${idea.title}") en maak de opzet volgens de instructie. Laat hem mij zien en sla hem daarna op met artikel_opzet_opslaan.`
    try {
      await navigator.clipboard.writeText(prompt)
      window.open("https://claude.ai/new", "_blank", "noopener")
      toast("Opdracht gekopieerd. Plak hem in Claude (met de connector Gijs aan).")
    } catch { toast("Kopiëren lukte niet; selecteer de tekst handmatig.", "error") }
  }
  // Relevantie-check: net als de briefing een volledige prompt met alle gegevens van de kans.
  // Alleen kopiëren (geen Claude-tabblad, geen koppeling nodig); het oordeel leg je daarna hier vast.
  type RelVerdict = NonNullable<ContentIdea["relevance_check"]>["verdict"]
  const [relevanceText, setRelevanceText] = useState<string | null>(null)
  const [relevanceCopied, setRelevanceCopied] = useState(false)
  const [relVerdict, setRelVerdict] = useState<RelVerdict | null>(null)
  const [relReason, setRelReason] = useState("")
  const askRelevance = () => { setRelevanceText(buildRelevancePrompt(idea, all)); setRelVerdict(null); setRelReason("") }
  const copyRelevance = async () => {
    if (!relevanceText) return
    try {
      await navigator.clipboard.writeText(relevanceText)
      setRelevanceCopied(true)
      setTimeout(() => setRelevanceCopied(false), 2500)
      toast("Prompt gekopieerd. Plak hem in Claude en leg het oordeel hieronder vast.")
    } catch { toast("Kopiëren lukte niet; selecteer de tekst in het vak en kopieer hem zelf.", "error") }
  }
  // Plakt iemand het hele antwoord van Claude, dan halen we het oordeel uit de regel "OORDEEL: …"
  const onRelReason = (text: string) => {
    setRelReason(text)
    const m = text.match(/OORDEEL\s*:\s*\**\s*(niet[ _-]?relevant|twijfel|relevant)/i)
    if (m && !relVerdict) setRelVerdict(/niet/i.test(m[1]) ? "niet_relevant" : /twijfel/i.test(m[1]) ? "twijfel" : "relevant")
  }
  const saveRelevance = async () => {
    if (!relVerdict || !relReason.trim()) return
    const ok = await act({ action: "relevantie", verdict: relVerdict, reasoning: relReason.trim() }, "Oordeel van Claude vastgelegd")
    if (ok) { setRelevanceText(null); setRelVerdict(null); setRelReason("") }
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

  const headEl = (
    <div className="panel-head">
          <div className="panel-head-top">
            <div className="panel-tags">
              <Badge tone="accent">{ORIGIN_META[idea.origin].label}</Badge>
              {idea.impact && idea.impact !== "overig" && <Badge tone="neutral">{IMPACT_META[idea.impact].label}</Badge>}
              <Badge tone={step < 0 ? "neutral" : "success"} dot>{STATUS_META[idea.status].label}</Badge>
              <OwnerSelect value={idea.owner} onChange={o => act({ action: "owner", owner: o }, o ? "Toegewezen" : "Toewijzing verwijderd")} />
            </div>
            {!isPage && <button className="icon-btn" onClick={onClose} aria-label="Sluiten"><X /></button>}
          </div>
          <h2 className="panel-title" id="cp-title">{idea.title}</h2>
          <p className="panel-subtitle">{idea.format} · {serviceLabel(idea.service)}{idea.regions.length ? ` · ${idea.regions.map(r => r[0].toUpperCase() + r.slice(1)).join(", ")}` : ""} · gevonden {ago(idea.created_at)}</p>
          {step >= 0 && (
            <ol className="flow" aria-label="Voortgang">
              {FLOW.map(s => <li key={s} className={STATUS_META[s].step < step ? "is-done" : STATUS_META[s].step === step ? "is-current" : ""}>{STATUS_META[s].label}</li>)}
            </ol>
          )}
        </div>
  )
  const bodyEl = (
    <>
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

          {["nieuw", "later", "verlopen"].includes(idea.status) && (
            <section className="psec" aria-labelledby="cp-relevance">
              <h3 className="psec-title" id="cp-relevance"><HelpCircle aria-hidden />Relevantie-check door Claude{idea.relevance_check?.at && <span className="subtle">{new Date(idea.relevance_check.at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}</h3>
              {idea.relevance_check && !relevanceText && (
                <>
                  <div className={`verdict-box tone-${RELEVANCE_META[idea.relevance_check.verdict].tone}`}>
                    <p className="verdict-label"><b>{RELEVANCE_META[idea.relevance_check.verdict].label}</b></p>
                    <p style={{ whiteSpace: "pre-line" }}>{idea.relevance_check.reasoning}</p>
                  </div>
                  <p className="field-hint">Vastgelegd door {idea.relevance_check.by} · dit neemt de beslissing niet over, jij beoordeelt nog steeds zelf.</p>
                  <div className="inline-form-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={askRelevance}><HelpCircle aria-hidden />Opnieuw laten beoordelen</button>
                  </div>
                </>
              )}
              {!idea.relevance_check && !relevanceText && (
                <>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Laat Claude kritisch checken of dit onderwerp het schrijven waard is, voordat je er tijd in steekt: klopt de aanleiding nog, past het bij Gijs, is er echte zoekvraag en bestaat er al een pagina over? Je krijgt een volledige prompt met alle gegevens van deze kans om in Claude te plakken.</p>
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={askRelevance}><HelpCircle aria-hidden />Vraag Claude of dit relevant is</button>
                </>
              )}
              {relevanceText && (
                <>
                  <textarea className="textarea mono" rows={12} value={relevanceText} onChange={e => setRelevanceText(e.target.value)} aria-label="Prompt voor de relevantie-check" />
                  <div className="inline-form-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={copyRelevance}>{relevanceCopied ? <><Check aria-hidden />Gekopieerd</> : <><Copy aria-hidden />Kopiëren</>}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setRelevanceText(null)}>Sluiten</button>
                  </div>
                  <div className="inline-form" style={{ marginTop: 14 }}>
                    <p className="field-label" id="rel-verdict-label">Oordeel van Claude vastleggen</p>
                    <div className="tag-pick" role="radiogroup" aria-labelledby="rel-verdict-label">
                      {(Object.keys(RELEVANCE_META) as RelVerdict[]).map(v => (
                        <button key={v} type="button" role="radio" aria-checked={relVerdict === v} className={`chip${relVerdict === v ? " is-active" : ""}`} onClick={() => setRelVerdict(v)}>{v === "relevant" ? "Relevant" : v === "twijfel" ? "Twijfel" : "Niet relevant"}</button>
                      ))}
                    </div>
                    <textarea className="textarea" rows={5} style={{ marginTop: 8 }} value={relReason} onChange={e => onRelReason(e.target.value)} placeholder="Plak hier het antwoord van Claude (het oordeel wordt dan vanzelf herkend)" aria-label="Antwoord van Claude" />
                    <div className="inline-form-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                      <button className="btn btn-secondary btn-sm" disabled={busy || !relVerdict || !relReason.trim()} onClick={saveRelevance}>Oordeel opslaan</button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

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
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>De briefing bevat de aanleiding, bronnen met datum, doelgroep, dienst, zoekwoorden, structuur en de schrijfregels van Gijs{lessons.length ? `, plus ${lessons.length} ${lessons.length === 1 ? "les" : "lessen"} uit eerdere correcties` : ""}{style ? `, en ${style.measured ? "de stijl van jullie best presterende artikelen" : "de stijl van jullie eigen teksten"} als voorbeeld` : ""}.</p>
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
              {!idea.concept_original && idea.concept_final && idea.text_check?.readable ? (
                <>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Tekst gelezen uit <b>{idea.text_check.name}</b>. Upload je een nieuwe versie, lever hem dan opnieuw in of klik op "Tekst controleren".</p>
                  <details className="evidence-details"><summary>Gelezen tekst bekijken</summary><div className="note-box" style={{ marginTop: 8, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" }}>{idea.concept_final}</div></details>
                </>
              ) : !idea.concept_original ? (
                <>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Schrijf je het artikel zelf? Upload het als PDF bij Bijlagen en lever het in; het dashboard leest de tekst dan zelf. Of plak hier een concept van Claude; het origineel blijft bewaard, zodat zichtbaar wordt wat de redactie aanpast.</p>
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

          {step >= 1 && step <= 4 && (
            <section className="psec" aria-labelledby="cp-outline">
              <h3 className="psec-title" id="cp-outline"><Sparkles aria-hidden />Opzet van Claude{idea.outline_at && <span className="subtle">{new Date(idea.outline_at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}</h3>
              {idea.outline ? (
                <>
                  <div className="note-box outline-box">{idea.outline}</div>
                  <div className="inline-form-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(idea.outline || "").then(() => toast("Opzet gekopieerd"), () => toast("Kopiëren lukte niet", "error"))}><Copy aria-hidden />Kopiëren</button>
                    <button className="btn btn-ghost btn-sm" onClick={askOutline}><Sparkles aria-hidden />Nieuwe opzet vragen</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Laat Claude de basis van de pagina maken: titels, tussenkoppen met per sectie de raakpunten, interne links, veelgestelde vragen en wat er gecontroleerd moet worden. Claude haalt via de Gijs-koppeling zelf de aanleiding, zoekvragen, bronnen, jullie stijl en de lessen op. Jij werkt de tekst daarna uit en levert hem hier in als PDF.</p>
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={askOutline}><Sparkles aria-hidden />Opzet maken in Claude</button>
                  <p className="field-hint">Werkt met de Claude-koppeling (connector "Gijs"). Nog niet gekoppeld? Zie Claude-koppeling in de zijbalk, of gebruik Briefing maken en plak die in Claude.</p>
                </>
              )}
            </section>
          )}

          <section className="psec" aria-labelledby="cp-note">
            <h3 className="psec-title" id="cp-note"><StickyNote aria-hidden />Notitie</h3>
            {editNote ? (
              <div className="inline-form">
                <textarea className="textarea" rows={4} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Bijvoorbeeld: afgestemd met Thom, wacht op cijfers van de gemeente" maxLength={2000} autoFocus aria-label="Notitie" />
                <div className="inline-form-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditNote(false); setNoteText(idea.note || "") }}>Annuleren</button>
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await act({ action: "note", note: noteText }, noteText.trim() ? "Notitie opgeslagen" : "Notitie verwijderd"); setEditNote(false) }}>Opslaan</button>
                </div>
              </div>
            ) : idea.note ? (
              <div className="note-box">
                <p>{idea.note}</p>
                <p className="subtle small">{idea.note_by ? ownerName(idea.note_by, users, me) : ""}{idea.note_at ? ` · ${new Date(idea.note_at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""} · <button className="link-btn" onClick={() => { setNoteText(idea.note || ""); setEditNote(true) }}>Bewerken</button></p>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setEditNote(true)}><StickyNote aria-hidden />Notitie toevoegen</button>
            )}
          </section>

          <Attachments kind="content" refId={idea.id} onCount={setAttCount} />
          {["geaccepteerd", "briefing", "concept"].includes(idea.status) && (
            <div className={`submit-box${attCount ? " is-ready" : ""}`}>
              <div>
                <b>{attCount ? "Klaar om in te leveren?" : "Concept inleveren"}</b>
                <p className="subtle small">{attCount ? "Het dashboard leest de tekst uit de PDF en controleert hem. Daarna gaat de kans naar Evalueren, waar een collega hem beoordeelt." : "Upload eerst het concept als PDF (of Word) bij Bijlagen. Daarna lever je het hier in ter beoordeling."}</p>
              </div>
              <div className="submit-actions">
                {attCount > 0 && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act({ action: "textcheck" }, "Tekst gecontroleerd")}><ClipboardCheck aria-hidden />Tekst controleren</button>}
                <button className="btn btn-primary btn-sm" disabled={busy || !attCount} onClick={() => act({ action: "submit" }, "Ingeleverd ter beoordeling")}><Send aria-hidden />Inleveren</button>
              </div>
            </div>
          )}

          {idea.text_check && (
            <section className="psec" aria-labelledby="cp-textcheck">
              <h3 className="psec-title" id="cp-textcheck"><ClipboardCheck aria-hidden />Tekstcontrole<span className="subtle">{idea.text_check.name ? `${idea.text_check.name} · ` : ""}{new Date(idea.text_check.at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></h3>
              {idea.text_check.error ? <p className="field-error">De tekst kon niet worden gelezen: {idea.text_check.error}</p> : (
                <>
                  {idea.text_check.stats && idea.text_check.readable && (
                    <table className="ptable kpi-table">
                      <thead><tr><th>Woorden</th><th>Zinslengte</th><th>Tussenkoppen</th><th>Jaartallen</th></tr></thead>
                      <tbody><tr>
                        <td className="kpi-val">{idea.text_check.stats.words}</td>
                        <td className="kpi-val">{String(idea.text_check.stats.avgSentence).replace(".", ",")} <span className="subtle small">woorden</span></td>
                        <td className="kpi-val">{idea.text_check.stats.headings}</td>
                        <td>{idea.text_check.stats.years.join(", ") || "—"}</td>
                      </tr></tbody>
                    </table>
                  )}
                  <table className="ptable textcheck-table">
                    <thead><tr><th>Controle</th><th>Uitkomst</th></tr></thead>
                    <tbody>{(idea.text_check.checks || []).map(c => (
                      <tr key={c.key}>
                        <th scope="row"><span className={`tc-dot ${c.ok === true ? "is-ok" : c.ok === false ? "is-bad" : "is-info"}`} aria-hidden />{c.label}</th>
                        <td>{c.detail}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  <p className="field-hint">Vaste regels, geen AI. Na publicatie legt het dashboard deze kenmerken naast de resultaten in Google, zodat het leert welke teksten het best werken.</p>
                </>
              )}
            </section>
          )}

          {step >= 3 && (
            <section className="psec" aria-labelledby="cp-review">
              <h3 className="psec-title" id="cp-review"><ClipboardCheck aria-hidden />Controle</h3>
              <ul className="review-list">
                {REVIEW_ROLES.filter(r => needed.includes(r.key)).map(r => {
                  const v = idea.review?.[r.key]
                  return (
                    <li key={r.key} className={v?.ok ? "is-ok" : ""}>
                      <button className="check" disabled={busy || step >= 6} aria-pressed={!!v?.ok} onClick={() => act({ action: "review", role: r.key, ok: v?.ok ? null : true })}>{v?.ok && <Check aria-hidden />}</button>
                      <span><strong>{r.label}</strong>{v?.ok ? <small>{v.by} · {new Date(v.at).toLocaleDateString("nl-NL")}</small> : <small>{needed.includes(r.key) ? "verplicht" : ""}</small>}</span>
                    </li>
                  )
                })}
              </ul>
              <p className="field-hint">Eén vinkje volstaat: lees het concept, controleer de feiten en de toon van Gijs.{(idea.impact === "subsidie" || idea.impact === "regelgeving" || idea.impact === "kosten") ? " Let bij subsidies, regels en kosten extra op bedragen, voorwaarden en datums." : ""}</p>
            </section>
          )}

          {step >= 5 && (
            <section className="psec" aria-labelledby="cp-pub">
              <h3 className="psec-title" id="cp-pub"><Send aria-hidden />Publicatie</h3>
              {step === 5 ? (
                <div className="inline-form">
                  <p style={{ fontSize: "var(--fs-sm)" }}>{isPageUpdate(idea)
                    ? "Het dashboard past de site nooit zelf aan. Werk de pagina bij en leg hier vast welke pagina en op welke dag de nieuwe versie live ging; daarna wordt dezelfde pagina vóór en na vergeleken (na 14, 28 en 56 dagen)."
                    : "Het dashboard publiceert nooit zelf. Plaats het artikel op de site en leg hier vast waar en wanneer; daarna start de meting na 7, 30 en 90 dagen."}</p>
                  <div className="modal-row">
                    <div><label className="field-label" htmlFor="cp-url">URL op groeninjestraat.nl</label><input id="cp-url" className="input" style={{ width: "100%" }} value={pubUrl} onChange={e => setPubUrl(e.target.value)} placeholder="https://www.groeninjestraat.nl/kennis/…" /></div>
                    <div><label className="field-label" htmlFor="cp-date">{isPageUpdate(idea) ? "Datum dat de nieuwe versie live ging" : "Publicatiedatum"}</label><input id="cp-date" type="date" className="input" style={{ width: "100%" }} value={pubDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setPubDate(e.target.value)} /></div>
                  </div>
                  <div className="inline-form-actions"><button className="btn btn-primary btn-sm" disabled={busy || !pubUrl} onClick={() => act({ action: "publish", url: pubUrl, date: pubDate }, isPageUpdate(idea) ? "Vastgelegd als bijgewerkt; voor/na-meting gestart" : "Vastgelegd als gepubliceerd; meting gestart")}>{isPageUpdate(idea) ? "Vastleggen als bijgewerkt" : "Vastleggen als gepubliceerd"}</button></div>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: "var(--fs-sm)" }}>Gepubliceerd op {dateNl(idea.published_at)}: <a href={idea.published_url!} target="_blank" rel="noopener noreferrer">{idea.published_url!.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/, "")}</a></p>
                  <ArticleResults idea={idea} all={all} />
                  {!isPageUpdate(idea) && <p className="field-hint">Waarom 7, 30 en 90 dagen en niet 14, 28 en 56 zoals bij SEO-experimenten? Een nieuw artikel moet eerst gevonden en geïndexeerd worden en bouwt daarna langzaam posities op. Na 7 dagen zie je of het geïndexeerd is, na 90 dagen hoe het presteert. Een aanpassing aan een bestaande pagina werkt sneller en wordt daarom na 56 dagen beoordeeld.</p>}
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
        
    </>
  )
  const footEl = (
    <>
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
              <label className="field-label" htmlFor="cp-reason" style={{ margin: 0 }}>{mode === "reject" ? "Waarom wijs je dit af? Schrijf het in je eigen woorden; het dashboard leert van je tekst." : mode === "later" ? "Waarom later? (optioneel)" : "Feedback op dit voorstel of concept"}</label>
              <textarea id="cp-reason" className="textarea" rows={mode === "reject" ? 5 : 3} value={note} onChange={e => setNote(e.target.value)}
                placeholder={mode === "reject" ? "Bijvoorbeeld: gaat over een rechtszaak tegen ondernemers, niet over een keuze die huiseigenaren maken. Er is ook geen echte zoekvraag naar." : "Toelichting"} />
              {mode === "reject" && notePreview && (notePreview.reasons.length > 0 || notePreview.topics.length > 0) && (
                <div className="note-preview" aria-live="polite">
                  <span className="subtle small">Het dashboard herkent hierin:</span>
                  {notePreview.reasons.map(r => <span key={r.code} className={`badge tone-${r.applies ? "info" : "neutral"}`}>{r.label}</span>)}
                  {notePreview.topics.map(t => <span key={t} className="badge tone-warning">Onderwerp “{t}”</span>)}
                </div>
              )}
              {mode === "reject" && note.trim().length > 15 && notePreview && !notePreview.reasons.length && !notePreview.topics.length && (
                <p className="field-hint">Het dashboard herkent hier (nog) geen vaste reden in. Je toelichting wordt wel bewaard en meegegeven bij volgende relevantie-checks.</p>
              )}
              <p className="field-hint" style={{ marginTop: 6 }}>Of kies een snelle reden (optioneel):</p>
              <Tags value={tags} onChange={setTags} />
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
        
    </>
  )

  if (isPage) {
    const overdue = !!idea.due_date && idea.due_date < new Date().toISOString().slice(0, 10) && step >= 1 && step <= 3
    return (
      <div className="cpage">
        <button className="link-btn cpage-back" onClick={onClose}><ArrowLeft aria-hidden />{backLabel}</button>
        <div className="cpage-head">{headEl}</div>
        <div className="cpage-grid">
          <div className="cpage-main">{bodyEl}</div>
          <aside className="cpage-side" aria-label="Inleverpunt">
            <div className="cpage-card">
              <p className="eyebrow">Inleverpunt</p>
              <table className="ptable ptable-kv">
                <tbody>
                  <tr><th scope="row">Status</th><td>{STATUS_META[idea.status].label}</td></tr>
                  <tr><th scope="row">Volgende stap</th><td>{CONTENT_STEP[idea.status] || "—"}</td></tr>
                  <tr><th scope="row">Deadline</th><td>
                    <input type="date" className={`input input-sm${overdue ? " is-overdue" : ""}`} aria-label="Deadline" value={idea.due_date || ""} onChange={e => act({ action: "due", date: e.target.value || null }, e.target.value ? "Deadline ingesteld" : "Deadline verwijderd")} />
                    {overdue && <span className="txt-down small" style={{ display: "block", marginTop: 4 }}>Verlopen</span>}
                  </td></tr>
                  <tr><th scope="row">Ingeleverd</th><td>{attCount ? `${attCount} ${attCount === 1 ? "bestand" : "versies"}` : "Nog niets"}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="cpage-card cpage-actions">{footEl}</div>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="cp-title">
        {headEl}
        <div className="panel-body">{bodyEl}</div>
        <div className="panel-foot">{footEl}</div>
      </aside>
    </>
  )
}

// Resultaten per artikel: bekeken, tijd op de pagina, aanvragen (GA4) en Google (Search Console)
const dur = (sec: number | null | undefined) => sec === null || sec === undefined ? "—" : sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, "0")} s`
export function ArticleResults({ idea, all }: { idea: ContentIdea; all: ContentIdea[] }) {
  // Bijgewerkte bestaande pagina: voor/na-experiment, geen artikeloordeel
  if (isPageUpdate(idea)) return <UpdateResults idea={idea} />
  return <NewArticleResults idea={idea} all={all} />
}

// Resultaat van een bijgewerkte pagina: dezelfde pagina vóór en na, gecorrigeerd voor de hele site
export function UpdateResults({ idea }: { idea: ContentIdea }) {
  const m = idea.evals?.update || null
  const changedAt = idea.published_at || null
  const j = m ? judgeUpdate(m) : null
  const next = changedAt ? nextMilestone(m || { points: {} }, changedAt) : null
  const cols = UPDATE_MILESTONES.map(d => ({ d, p: m?.points[`d${d}`] }))
  const b = m?.baseline || null
  const cmp = (p: UpdatePoint) => (b ? compare(b, p) : null)
  const cell = (p: UpdatePoint | undefined, f: (p: UpdatePoint) => React.ReactNode) => <td className="num">{p ? f(p) : <span className="subtle">nog niet</span>}</td>
  const leads = (g: any) => (g ? (g.measurement === "ok" ? g.requests || 0 : 0) + (g.contacts || 0) : null)
  const label = !m?.baseline ? "Nulmeting volgt" : !j?.outcome ? "Meting loopt" : j.final ? OUTCOME_META[j.outcome].label : `Voorlopig: ${OUTCOME_META[j.outcome].label.toLowerCase()}`
  const tone = j?.outcome && j.final ? OUTCOME_META[j.outcome].tone : "neutral"
  return (
    <>
      <div className={`verdict-box tone-${tone}`}>
        <p className="verdict-label">Werkte de aanpassing? <b>{label}</b>{j?.at ? <span className="subtle"> · na {j.at} dagen{j.final ? "" : " (eindoordeel na 56 dagen)"}</span> : null}</p>
        {j?.reasons.length ? <ul>{j.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          : <p>{next && changedAt ? `Eerste meting op ${dateNl(next.date)} (${next.days} dagen na de aanpassing). ` : ""}Een bijgewerkte pagina meten we als experiment: dezelfde pagina vóór en na, niet vergeleken met nieuwe artikelen.</p>}
      </div>
      {b && (
        <table className="ptable results-table">
          <thead><tr><th>Per 28 dagen</th><th className="num">Ervóór</th>{cols.map(c => <th key={c.d} className="num">Na {c.d} d</th>)}</tr></thead>
          <tbody>
            <tr className="rt-group"><th colSpan={5}>Google: zoekwoorden van deze kans</th></tr>
            <tr><th scope="row">Gem. positie</th><td className="num">{b.queries.position ? pos(b.queries.position) : "—"}</td>{cols.map(c => <Fragment key={c.d}>{cell(c.p, p => <b>{p.queries.position ? pos(p.queries.position) : "—"}</b>)}</Fragment>)}</tr>
            <tr><th scope="row">Vertoningen</th><td className="num">{num(b.queries.impressions)}</td>{cols.map(c => <Fragment key={c.d}>{cell(c.p, p => num(cmp(p)!.qImpAfter))}</Fragment>)}</tr>
            <tr className="rt-group"><th colSpan={5}>Google: de hele pagina</th></tr>
            <tr><th scope="row">Klikken</th><td className="num">{num(b.page.clicks)}</td>{cols.map(c => <Fragment key={c.d}>{cell(c.p, p => <b>{num(cmp(p)!.clicksAfter, 1)}</b>)}</Fragment>)}</tr>
            <tr><th scope="row">Vertoningen</th><td className="num">{num(b.page.impressions)}</td>{cols.map(c => <Fragment key={c.d}>{cell(c.p, p => num(cmp(p)!.impAfter))}</Fragment>)}</tr>
            <tr><th scope="row">Hele site t.o.v. ervóór</th><td className="num subtle">—</td>{cols.map(c => <Fragment key={c.d}>{cell(c.p, p => (p.growth ? `${p.growth >= 1 ? "+" : ""}${Math.round((p.growth - 1) * 100)}%` : "—"))}</Fragment>)}</tr>
            <tr className="rt-group"><th colSpan={5}>Bezoekers (GA4, ter informatie)</th></tr>
            <tr><th scope="row">Bekeken</th><td className="num">{b.ga4 ? num(b.ga4.views) : "—"}</td>{cols.map(c => <Fragment key={c.d}>{cell(c.p, p => (p.ga4 ? num(Math.round(p.ga4.views * 28 / p.window.days)) : "—"))}</Fragment>)}</tr>
            <tr><th scope="row">Aanvragen via de pagina <span className="subtle">(geteld, niet omgerekend)</span></th><td className="num">{leads(b.ga4) ?? "—"}</td>{cols.map(c => <Fragment key={c.d}>{cell(c.p, p => leads(p.ga4) ?? "—")}</Fragment>)}</tr>
          </tbody>
        </table>
      )}
      <p className="field-hint"><BarChart3 aria-hidden style={{ width: 12, height: 12, verticalAlign: -1 }} /> Gemeten op {m?.page || idea.target_page || "de pagina"}{m?.queries.length ? `, zoekwoorden: ${m.queries.slice(0, 5).map(q => `"${q}"`).join(", ")}${m.queries.length > 5 ? ` en ${m.queries.length - 5} meer` : ""}` : ""}. Ervóór = de 28 dagen vóór de aanpassing; na 14 dagen telt de eerste 14 dagen, daarna steeds de laatste 28 dagen. Klikken en vertoningen zijn omgerekend naar 28 dagen en gecorrigeerd voor groei of krimp van de hele site. {UPDATE_RULE}</p>
    </>
  )
}

function NewArticleResults({ idea, all }: { idea: ContentIdea; all: ContentIdea[] }) {
  const v = articleVerdict(idea, all)
  const keys = ["d7", "d30", "d90"] as const
  const ev = idea.evals || {}
  const before = ev.d30?.ga4Before
  const showBefore = !!before && (idea.advice === "bijwerken" || before.views > 0)
  const g = (k: (typeof keys)[number]) => ev[k]?.ga4
  const cell = (k: (typeof keys)[number], f: (x: NonNullable<ContentIdea["evals"]["d7"]>) => React.ReactNode) => { const x = ev[k]; return <td className="num">{x ? f(x) : <span className="subtle">nog niet</span>}</td> }
  const anyMeasurementIssue = keys.some(k => g(k) && g(k)!.measurement !== "ok")
  const pctOf = (a: number | null | undefined, b: number) => (a === null || a === undefined || !b ? "—" : `${Math.round((a / b) * 100)}%`)
  return (
    <>
      <div className={`verdict-box tone-${v.tone}`}>
        <p className="verdict-label">Werkt dit artikel? <b>{v.label}</b>{v.window ? <span className="subtle"> · {v.window}</span> : null}</p>
        <ul>{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
      <table className="ptable results-table">
        <thead><tr><th>Meting</th>{showBefore && <th className="num">30 d ervóór</th>}{keys.map(k => <th key={k} className="num">Na {k.slice(1)} d</th>)}</tr></thead>
        <tbody>
          <tr className="rt-group"><th colSpan={showBefore ? 5 : 4}>Bezoekers (GA4)</th></tr>
          <tr><th scope="row">Bekeken</th>{showBefore && <td className="num">{num(before!.views)}</td>}{keys.map(k => <Fragment key={k}>{cell(k, x => x.ga4 ? <b>{num(x.ga4.views)}</b> : "—")}</Fragment>)}</tr>
          <tr><th scope="row">Gem. tijd actief op de pagina</th>{showBefore && <td className="num">{dur(before!.engagementSec)}</td>}{keys.map(k => <Fragment key={k}>{cell(k, x => x.ga4 ? dur(x.ga4.engagementSec) : "—")}</Fragment>)}</tr>
          <tr><th scope="row">Binnengekomen via dit artikel</th>{showBefore && <td className="num">{num(before!.landingSessions)}</td>}{keys.map(k => <Fragment key={k}>{cell(k, x => x.ga4 ? num(x.ga4.landingSessions) : "—")}</Fragment>)}</tr>
          <tr><th scope="row">Leest tot onderaan</th>{showBefore && <td className="num">{pctOf(before!.scrolled, before!.views)}</td>}{keys.map(k => <Fragment key={k}>{cell(k, x => x.ga4 ? pctOf(x.ga4.scrolled, x.ga4.views) : "—")}</Fragment>)}</tr>
          <tr><th scope="row">Klikt op de knop naar de energiescan</th>{showBefore && <td className="num">{before!.ctaClicks ?? "—"}</td>}{keys.map(k => <Fragment key={k}>{cell(k, x => x.ga4 ? (x.ga4.ctaClicks ?? "—") : "—")}</Fragment>)}</tr>
          <tr><th scope="row">Energiescanaanvragen</th>{showBefore && <td className="num">{before!.requests ?? "—"}</td>}{keys.map(k => <Fragment key={k}>{cell(k, x => x.ga4 ? (x.ga4.requests === null ? "—" : <b>{num(x.ga4.requests)}</b>) : "—")}</Fragment>)}</tr>
          <tr><th scope="row">Contactaanvragen</th>{showBefore && <td className="num">{before!.contacts ?? "—"}</td>}{keys.map(k => <Fragment key={k}>{cell(k, x => x.ga4 ? (x.ga4.contacts ?? "—") : "—")}</Fragment>)}</tr>
          <tr className="rt-group"><th colSpan={showBefore ? 5 : 4}>Google (Search Console)</th></tr>
          <tr><th scope="row">Klikken</th>{showBefore && <td />}{keys.map(k => <Fragment key={k}>{cell(k, x => num(x.clicks))}</Fragment>)}</tr>
          <tr><th scope="row">Vertoningen</th>{showBefore && <td />}{keys.map(k => <Fragment key={k}>{cell(k, x => num(x.impressions))}</Fragment>)}</tr>
          <tr><th scope="row">Gem. positie</th>{showBefore && <td />}{keys.map(k => <Fragment key={k}>{cell(k, x => (x.position ? pos(x.position) : "—"))}</Fragment>)}</tr>
        </tbody>
      </table>
      <p className="field-hint"><BarChart3 aria-hidden style={{ width: 12, height: 12, verticalAlign: -1 }} /> Telt vanaf de publicatiedatum. Aanvragen = bezoeken die via dit artikel binnenkwamen en daarna een energiescan of contact aanvroegen. "—" bij lezen tot onderaan of klikken op de knop: dat wordt nog niet gemeten; zie de controletaak "Meten per artikel aanvullen via Google Tag Manager".{anyMeasurementIssue ? " Let op: de meting van aanvragen in GA4 klopt nog niet helemaal (zie de controletaak), dus dit aantal is voorlopig." : ""}{keys.some(k => ev[k]?.ga4Error) ? ` GA4 kon niet worden gelezen: ${keys.map(k => ev[k]?.ga4Error).find(Boolean)}` : ""}</p>
    </>
  )
}
