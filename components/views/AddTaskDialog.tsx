"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { useWorkspace, type NewTask } from "@/lib/workspace"
import type { Level, Priority } from "@/lib/types"
import { demandForTopic, placePage, queryFor, searchPages, topicTerms, type PlacePage } from "@/lib/places"
import type { GscRow } from "@/lib/types"
import { normalize } from "@/lib/format"

const MAX_PAGES = 25
type RouteChoice = NonNullable<NewTask["route"]> | "anders"
const ROUTES: [RouteChoice, string][] = [["inhoud", "Tekst of artikel toevoegen"], ["interne-links", "Interne links"], ["titel-meta", "Title en H1"], ["anders", "Anders"]]

// Eigen taak toevoegen. Met een zoekwoord of pagina krijgt de taak dezelfde live analyse
// en automatische meting als de adviezen uit de data. Meerdere pagina's = één taak per pagina,
// zodat het dashboard per pagina meet wat het oplevert.
export default function AddTaskDialog({ onClose }: { onClose: () => void }) {
  const { addTask, toast, openTask, inventory, keywords } = useWorkspace()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [query, setQuery] = useState("")
  const [pages, setPages] = useState<PlacePage[]>([])
  const [pageSearch, setPageSearch] = useState("")
  const [route, setRoute] = useState<RouteChoice>("inhoud")
  const [priority, setPriority] = useState<Priority>("middel")
  const [effort, setEffort] = useState<Level>("middel")
  const [status, setStatusValue] = useState<NewTask["status"]>("goedgekeurd")
  const [goal, setGoal] = useState<NonNullable<NewTask["goal"]>>("seo")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Bevat het zoekwoord al een plaats? Dan is het een zoekwoord; anders een onderwerp ("warmtepomp")
  // Alleen regiopagina's tellen als plaats (niet /maatregelen/warmtepomp)
  const slugs = useMemo(() => new Set(inventory.filter(r => placePage(r.path)).map(r => r.path.split("/").filter(Boolean).pop() || "")), [inventory])
  const typed = normalize(query).trim()
  const hasPlace = typed.split(/\s+/).some(w => slugs.has(w)) || [...slugs].some(s => s.includes("-") && `-${typed.replace(/\s+/g, "-")}-`.includes(`-${s}-`))
  // Onderwerp: alle zoekwoorden met dat onderwerp uit Search Console ophalen (laatste 3 maanden), ook de long tail
  // buiten de top 250 die het dashboard standaard laadt ("warmtepomp hardenberg" met een paar vertoningen)
  const topicOn = goal === "seo" && typed.length >= 3 && !hasPlace
  const [topicRows, setTopicRows] = useState<{ topic: string; rows: GscRow[] } | null>(null)
  const [topicBusy, setTopicBusy] = useState(false)
  const [topicErr, setTopicErr] = useState<string | null>(null)
  useEffect(() => {
    if (!topicOn) return
    const terms = topicTerms(typed)
    if (!terms.length) return
    let stop = false
    setTopicBusy(true); setTopicErr(null)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/gsc?type=keywords&days=90&limit=1000&order=impressions&terms=${encodeURIComponent(terms.join(","))}`, { cache: "no-store" })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        if (!stop) setTopicRows({ topic: typed, rows: j.rows || [] })
      } catch (e: any) { if (!stop) setTopicErr(e.message) } finally { if (!stop) setTopicBusy(false) }
    }, 400)
    return () => { stop = true; clearTimeout(t) }
  }, [topicOn, typed])
  const topicKeywords = topicRows?.topic === typed ? topicRows.rows : keywords
  const demand = useMemo(() => (topicOn ? demandForTopic(typed, topicKeywords, inventory) : []), [topicOn, typed, topicKeywords, inventory])
  const suggestions = useMemo(() => searchPages(pageSearch, inventory).filter(p => !pages.some(x => x.path === p.path)), [pageSearch, inventory, pages])
  const dup = (p: PlacePage) => pages.filter(x => x.label === p.label).length > 1

  const addPage = (p: PlacePage) => {
    if (pages.some(x => x.path === p.path)) return
    if (pages.length >= MAX_PAGES) { setError(`Hooguit ${MAX_PAGES} pagina's tegelijk.`); return }
    setPages(list => [...list, p]); setError(null)
  }
  const removePage = (path: string) => setPages(list => list.filter(p => p.path !== path))
  const togglePage = (p: PlacePage) => (pages.some(x => x.path === p.path) ? removePage(p.path) : addPage(p))

  // Pad of URL plakken en Enter: ook zonder plaatsnaam
  const onPageKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    const v = pageSearch.trim()
    if (suggestions[0] && !v.includes("/")) { addPage(suggestions[0]); setPageSearch(""); return }
    if (!/^(https?:\/\/(www\.)?groeninjestraat\.nl)?\/[^\s]*$/i.test(v)) { setError("Kies een plaats uit de lijst, of plak een pad zoals /regio/overijssel/zwolle."); return }
    const path = v.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "").replace(/\/$/, "") || "/"
    addPage(placePage(path) || { path, label: path, sub: "pagina" }); setPageSearch("")
  }

  const plan = pages.map(p => ({
    p,
    title: pages.length > 1 ? `${title.trim()} – ${p.label}${dup(p) ? ` (${p.sub.split(", ").pop()})` : ""}` : title.trim(),
    query: goal !== "seo" || !typed ? "" : hasPlace ? query.trim() : queryFor(typed, p.path, demand),
  }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError("Geef de taak een titel."); return }
    const base = { description, priority, status, effort, goal, route: goal === "seo" && route !== "anders" ? route : undefined }
    setBusy(true)
    if (pages.length <= 1) {
      const key = await addTask({ ...base, title, query: goal === "seo" ? (plan[0]?.query || query) : "", page: pages[0]?.path || "" })
      setBusy(false)
      if (key) { toast("Taak toegevoegd"); onClose(); if (goal !== "seo" || query.trim() || pages.length) openTask(key) }
      return
    }
    let made = 0
    for (const x of plan) if (await addTask({ ...base, title: x.title, query: x.query, page: x.p.path })) made++
    setBusy(false)
    if (made) { toast(`${made} taken toegevoegd, één per pagina`); onClose() }
    if (made < plan.length) toast(`${plan.length - made} taken konden niet worden opgeslagen`, "error")
  }

  return (
    <>
      <div className="panel-overlay" onClick={onClose} aria-hidden />
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head">
          <h2 id="add-title">Taak toevoegen</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Sluiten"><X /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <label className="field-label" htmlFor="t-title">Titel</label>
          <input id="t-title" ref={firstRef} className="input" value={title} onChange={e => { setTitle(e.target.value); setError(null) }} placeholder="Bijvoorbeeld: Warmtepomp-tekst op regiopagina's" maxLength={140} />

          <label className="field-label" htmlFor="t-desc">Wat moet er gebeuren? <span className="subtle">(optioneel)</span></label>
          <textarea id="t-desc" className="textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Bijvoorbeeld: een korte alinea over warmtepompen in deze plaats, met lokale subsidie en een link naar de maatregelpagina" />

          <span className="field-label">Wat moet het opleveren?</span>
          <div className="seg goal-seg" role="radiogroup" aria-label="Doel van de taak">
            {([["seo", "Beter gevonden worden"], ["conversie", "Meer aanvragen"], ["overig", "Overig"]] as const).map(([v, l]) => (
              <button type="button" key={v} role="radio" aria-checked={goal === v} className={goal === v ? "is-active" : ""} onClick={() => setGoal(v)}>{l}</button>
            ))}
          </div>
          <p className="field-hint" style={{ marginBottom: 12 }}>{goal === "seo" ? "Gemeten op posities, vertoningen en klikken in Google." : goal === "conversie" ? "Bijvoorbeeld de woningscan verkorten of het formulier verbeteren. Gemeten op energiescanaanvragen in GA4 (vóór en na), niet op Google-posities." : "Wordt niet automatisch gemeten."}</p>

          {goal === "seo" && <>
            <span className="field-label">Soort aanpassing</span>
            <div className="seg goal-seg" role="radiogroup" aria-label="Soort aanpassing">
              {ROUTES.map(([v, l]) => <button type="button" key={v} role="radio" aria-checked={route === v} className={route === v ? "is-active" : ""} onClick={() => setRoute(v)}>{l}</button>)}
            </div>
            <p className="field-hint" style={{ marginBottom: 12 }}>Zo weet het dashboard welke aanpak je kiest; dat telt mee in de lessen en per pagina in "eerder geprobeerd".</p>

            <label className="field-label" htmlFor="t-query">Onderwerp of zoekwoord <span className="subtle">(optioneel)</span></label>
            <input id="t-query" className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="warmtepomp, of: isolatie zwolle" />
            {demand.length > 0 && (
              <div className="demand-box">
                <p className="field-hint" style={{ margin: "0 0 6px" }}>Plaatsen met zoekvraag naar „{typed}" in Search Console ({topicRows?.topic === typed ? "laatste 3 maanden" : "laatste 28 dagen"}{topicBusy ? ", wordt bijgewerkt…" : ""}). Vink aan om toe te voegen:</p>
                <ul className="demand-list">
                  {demand.slice(0, 15).flatMap(d => d.pages.map(p => {
                    const on = pages.some(x => x.path === p.path)
                    return (
                      <li key={p.path}>
                        <label className="demand-row">
                          <input type="checkbox" checked={on} onChange={() => togglePage(p)} />
                          <span className="demand-place"><b>{p.label}</b> <span className="subtle small">{p.sub}{d.pages.length > 1 ? " · zelfde plaatsnaam, kies de juiste" : ""}</span></span>
                          <span className="demand-num">{d.imp}× · positie {String(d.pos ?? "—").replace(".", ",")}</span>
                          <span className="demand-q subtle small">„{d.queries[0].q}"{d.queries.length > 1 ? ` +${d.queries.length - 1}` : ""}</span>
                        </label>
                      </li>
                    )
                  }))}
                </ul>
              </div>
            )}
            {topicOn && demand.length === 0 && topicBusy && <p className="field-hint">Zoeken in Search Console naar „{typed}"…</p>}
            {topicOn && demand.length === 0 && !topicBusy && topicRows?.topic === typed && <p className="field-hint">Geen plaatsen met zoekvraag naar „{typed}" gevonden in de laatste 3 maanden. Kies hieronder zelf de pagina's.</p>}
            {topicOn && topicErr && <p className="field-hint">Search Console kon niet worden doorzocht ({topicErr}); de lijst gebruikt alleen de zoekwoorden die het dashboard al had.</p>}
          </>}

          <label className="field-label" htmlFor="t-page">{goal === "conversie" ? "Alleen bezoekers via deze pagina's meten" : "Pagina's"} <span className="subtle">(optioneel{goal === "conversie" ? "; leeg = hele site" : ""})</span></label>
          {pages.length > 0 && (
            <div className="page-chips">
              {pages.map(p => <span key={p.path} className="page-chip" title={p.path}>{p.label}{dup(p) ? ` (${p.sub.split(", ").pop()})` : ""}<button type="button" onClick={() => removePage(p.path)} aria-label={`${p.label} verwijderen`}><X /></button></span>)}
            </div>
          )}
          <div className="page-search">
            <Search aria-hidden />
            <input id="t-page" className="input" value={pageSearch} onChange={e => { setPageSearch(e.target.value); setError(null) }} onKeyDown={onPageKey} placeholder="Zoek een plaats, bijv. Hardenberg, of plak een pad" autoComplete="off" />
          </div>
          {suggestions.length > 0 && (
            <ul className="page-suggest" role="listbox" aria-label="Gevonden pagina's">
              {suggestions.map(p => <li key={p.path}><button type="button" role="option" aria-selected={false} onClick={() => { addPage(p); setPageSearch("") }}><Plus aria-hidden /><b>{p.label}</b> <span className="subtle small">{p.sub} · {p.path}</span></button></li>)}
            </ul>
          )}
          {goal === "seo" && pages.length <= 1 && <p className="field-hint">Met een zoekwoord of pagina krijgt de taak een live diagnose en, als je hem uitvoert, een automatische meting.</p>}
          {pages.length > 1 && (
            <div className="plan-box">
              <p className="field-hint" style={{ margin: "0 0 4px" }}><b>Er worden {pages.length} taken gemaakt, één per pagina</b>, zodat het dashboard per plaats meet wat het oplevert:</p>
              <ul>{plan.map(x => <li key={x.p.path}>{x.p.label}{dup(x.p) ? ` (${x.p.sub.split(", ").pop()})` : ""} <span className="subtle small">{x.p.path}{x.query ? ` · zoekwoord „${x.query}"` : ""}</span></li>)}</ul>
            </div>
          )}

          <div className="modal-row modal-row-3">
            <div>
              <label className="field-label" htmlFor="t-prio">Prioriteit</label>
              <select id="t-prio" className="select" value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                <option value="hoog">Hoog</option><option value="middel">Middel</option><option value="laag">Laag</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="t-effort">Inspanning</label>
              <select id="t-effort" className="select" value={effort} onChange={e => setEffort(e.target.value as Level)}>
                <option value="laag">Laag</option><option value="middel">Middel</option><option value="hoog">Hoog</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="t-status">Kolom</label>
              <select id="t-status" className="select" value={status} onChange={e => setStatusValue(e.target.value as NewTask["status"])}>
                <option value="nieuw">Te beoordelen</option><option value="goedgekeurd">Gepland</option><option value="in_uitvoering">In uitvoering, nog niet live</option>
              </select>
            </div>
          </div>

          {error && <p className="field-error">{error}</p>}
          <div className="inline-form-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annuleren</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Opslaan…" : pages.length > 1 ? `${pages.length} taken toevoegen` : "Taak toevoegen"}</button>
          </div>
        </form>
      </div>
    </>
  )
}
