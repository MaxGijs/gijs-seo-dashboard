import { latestAttachmentText } from "@/lib/server/readdoc"
import { analyzeText } from "@/lib/content/textcheck"
import { NextResponse } from "next/server"
import { getSupabase, requireUser } from "@/lib/server/guard"
import { CONTENT_GOALS, type ContentGoal, type SuccessPlan } from "@/lib/content/plan"
import { ANGLE_META, changePct, FEEDBACK_TAGS, FORMATS, REVIEW_ROLES, requiredReviews, STATUS_META, type ContentIdea } from "@/lib/content/model"

// PATCH /api/content/:id — elke stap in de workflow. Het dashboard publiceert nooit:
// "publiceren" legt alleen vast dat een medewerker het artikel heeft geplaatst.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const { id } = await params
  const who = guard.session.user?.name || guard.session.user?.email || "medewerker"
  const body = await req.json().catch(() => ({}))
  const sb = getSupabase()
  const { data: idea, error: getErr } = await sb.from("content_ideas").select("*").eq("id", id).maybeSingle()
  if (getErr || !idea) return NextResponse.json({ error: "Kans niet gevonden" }, { status: 404 })
  const cur = idea as ContentIdea
  const now = new Date().toISOString()
  const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })
  let patch: Record<string, unknown> = {}
  // Doel en succesgrens controleren (zie lib/content/plan.ts)
  const cleanPlan = (raw: any, by: string, afterwards: boolean): SuccessPlan | string => {
    const goal = raw?.goal as ContentGoal
    if (!goal || !(goal in CONTENT_GOALS)) return "Kies een primair doel."
    // Succesgrens is optioneel: leeg = alleen volgen
    const threshold = raw?.threshold === null || raw?.threshold === undefined || raw?.threshold === "" ? null : Number(raw.threshold)
    if (threshold !== null && (!Number.isFinite(threshold) || threshold <= 0)) return "Een succesgrens moet groter dan 0 zijn (of laat hem leeg)."
    const prediction = raw?.prediction === null || raw?.prediction === undefined || raw?.prediction === "" ? null : Number(raw.prediction)
    if (prediction !== null && (!Number.isFinite(prediction) || prediction < 0)) return "De verwachting moet een getal zijn."
    const comparables = Array.isArray(raw?.comparables) ? raw.comparables.filter((x: unknown) => typeof x === "string").slice(0, 20) : []
    return { goal, window: CONTENT_GOALS[goal].window, threshold: threshold === null ? null : Math.round(threshold), prediction: prediction === null ? null : Math.round(prediction), comparables, setAt: now, setBy: by, ...(afterwards ? { afterwards: true } : {}) }
  }

  const feedbackFrom = (tags: unknown, note?: unknown) => {
    const list = Array.isArray(tags) ? tags.filter((t): t is string => (FEEDBACK_TAGS as readonly string[]).includes(t)) : []
    const n = note ? String(note).slice(0, 1000) : undefined
    return [...list.map(tag => ({ tag, note: n, at: now, by: who })), ...(!list.length && n ? [{ tag: "opmerking", note: n, at: now, by: who }] : [])]
  }

  switch (body.action) {
    case "outline": {
      // Opzet (raakpunten per sectie) die Claude via de koppeling maakte; een medewerker werkt hem uit
      const t = String(body.outline ?? "").trim()
      if (t && t.length < 100) return bad("De opzet is te kort.")
      patch.outline = t ? t.slice(0, 20000) : null
      patch.outline_at = t ? now : null
      patch.outline_by = t ? who : null
      break
    }
    case "due": {
      const d = body.date ? String(body.date) : null
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return bad("Ongeldige datum")
      patch.due_date = d
      break
    }
    case "note": {
      const n = String(body.note ?? "").trim().slice(0, 2000)
      patch.note = n || null
      patch.note_by = n ? who : null
      patch.note_at = n ? now : null
      break
    }
    case "relevantie": {
      // Relevantie-oordeel van Claude (via de koppeling), vóór acceptatie
      const verdict = String(body.verdict || "")
      if (!["relevant", "twijfel", "niet_relevant"].includes(verdict)) return bad("Onbekend oordeel")
      const reasoning = String(body.reasoning || "").trim().slice(0, 4000)
      if (!reasoning) return bad("Geef een toelichting bij het oordeel")
      patch.relevance_check = { verdict, reasoning, at: now, by: who }
      break
    }
    case "owner": {
      patch.owner = typeof body.owner === "string" && /^[^\s@]+@[^\s@]+$/.test(body.owner) ? body.owner.toLowerCase() : null
      break
    }
    case "edit": {
      // Aanpassingen door een medewerker; het oorspronkelijke voorstel blijft in "original"
      const f = body.fields || {}
      if (f.title !== undefined) patch.title = String(f.title).trim().slice(0, 200) || cur.title
      if (f.angle !== undefined) { if (!(f.angle in ANGLE_META)) return bad("Onbekende invalshoek"); patch.angle = f.angle }
      if (f.format !== undefined) { if (!(FORMATS as readonly string[]).includes(f.format)) return bad("Onbekende contentvorm"); patch.format = f.format }
      if (f.advice !== undefined) { if (!["nieuw", "bijwerken", "samenvoegen", "niets"].includes(f.advice)) return bad("Onbekend advies"); patch.advice = f.advice }
      if (f.cta !== undefined) patch.cta = String(f.cta).slice(0, 300)
      if (f.regions !== undefined && Array.isArray(f.regions)) patch.regions = f.regions.map(String).slice(0, 12)
      if (f.score_override !== undefined) {
        const v = f.score_override === null || f.score_override === "" ? null : Math.max(0, Math.min(100, Math.round(Number(f.score_override))))
        if (v !== null && isNaN(v)) return bad("Score moet een getal zijn")
        patch.score_override = v
      }
      if (f.priority !== undefined) { if (!["hoog", "middel", "laag"].includes(f.priority)) return bad("Onbekende prioriteit"); patch.priority = f.priority }
      if (f.briefing !== undefined) patch.briefing = String(f.briefing).slice(0, 30000)
      break
    }
    case "status": {
      const to = String(body.status || "")
      if (!(to in STATUS_META) || to === "gepubliceerd" || to === "verlopen") return bad("Ongeldige status")
      if (to === "afgewezen" && !feedbackFrom(body.tags, body.note).length) return bad("Geef aan waarom je de kans afwijst; daar leert het dashboard van.")
      if (to === "goedgekeurd") {
        const missing = requiredReviews(cur).filter(r => !cur.review?.[r]?.ok)
        if (missing.length) return bad(`Nog niet gecontroleerd: ${missing.map(m => REVIEW_ROLES.find(r => r.key === m)?.label).join(", ")}`)
      }
      patch.status = to
      patch.decision_note = body.note ? String(body.note).slice(0, 1000) : cur.decision_note
      const fb = feedbackFrom(body.tags, to === "afgewezen" || to === "later" ? body.note : undefined)
      if (fb.length) patch.feedback = [...(cur.feedback || []), ...fb]
      break
    }
    case "submit": {
      // Ingeleverd (PDF of Word bij Bijlagen): naar beoordeling door een collega
      if (!["geaccepteerd", "briefing", "concept"].includes(cur.status)) return bad("Deze kans staat niet in een stap waarin je iets kunt inleveren.")
      const { count } = await sb.from("seo_attachments").select("id", { count: "exact", head: true }).eq("ref_kind", "content").eq("ref_id", id).eq("confirmed", true).is("deleted_at", null)
      if (!count) return bad("Upload eerst het concept (PDF) bij Bijlagen; daarna kun je het inleveren.")
      patch.status = "review"
      Object.assign(patch, await readAndCheck(cur).catch(e => ({ text_check: { error: String(e?.message || e), at: now } })))
      break
    }
    case "textcheck": {
      // Alleen de tekst controleren (zonder in te leveren)
      const r = await readAndCheck(cur).catch(e => ({ text_check: { error: String(e?.message || e), at: now } }))
      if (!r) return bad("Upload eerst het concept (PDF of Word) bij Bijlagen.")
      Object.assign(patch, r)
      break
    }
    case "concept": {
      if (body.original !== undefined) {
        if (cur.concept_original) return bad("Het oorspronkelijke concept is al vastgelegd.")
        const text = String(body.original).trim()
        if (text.length < 200) return bad("Plak het volledige concept (minimaal een paar alinea's).")
        patch = { concept_original: text.slice(0, 60000), concept_original_at: now, concept_final: text.slice(0, 60000), concept_change_pct: 0, status: "concept" }
      } else if (body.final !== undefined) {
        if (!cur.concept_original) return bad("Er is nog geen concept.")
        const text = String(body.final).slice(0, 60000)
        patch = { concept_final: text, concept_change_pct: changePct(cur.concept_original, text) }
        if (cur.status === "concept") patch.status = "review"
      } else return bad("Geen concept meegegeven")
      break
    }
    case "review": {
      const role = String(body.role || "")
      if (!REVIEW_ROLES.some(r => r.key === role)) return bad("Onbekende controle")
      const review = { ...(cur.review || {}) }
      if (body.ok === null) delete review[role]
      else review[role] = { by: who, at: now, ok: !!body.ok, note: body.note ? String(body.note).slice(0, 500) : undefined }
      patch = { review }
      if (cur.status === "concept") patch.status = "review"
      break
    }
    case "feedback": {
      const fb = feedbackFrom(body.tags, body.note)
      if (!fb.length) return bad("Kies minstens één label of schrijf een opmerking")
      patch = { feedback: [...(cur.feedback || []), ...fb] }
      break
    }
    case "publish": {
      if (cur.status !== "goedgekeurd" && cur.status !== "gepubliceerd") return bad("Alleen goedgekeurde content kan als gepubliceerd worden gemarkeerd.")
      const url = String(body.url || "").trim()
      if (!/^https:\/\/(www\.)?groeninjestraat\.nl\/\S*$/i.test(url)) return bad("Vul de volledige URL op groeninjestraat.nl in.")
      const date = String(body.date || now.slice(0, 10))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date) > new Date()) return bad("Ongeldige publicatiedatum")
      patch = { status: "gepubliceerd", published_url: url, published_at: date }
      if (body.plan) { const plan = cleanPlan(body.plan, who, false); if (typeof plan === "string") return bad(plan); patch.success_plan = plan }
      break
    }
    case "plan": {
      // Doel en succesgrens (ook achteraf vast te leggen; dan staat dat erbij)
      const plan = cleanPlan(body.plan, who, cur.status === "gepubliceerd" && !!cur.published_at && cur.published_at < now.slice(0, 10))
      if (typeof plan === "string") return bad(plan)
      patch = { success_plan: plan }
      break
    }
    default:
      return bad("Onbekende actie")
  }

  const { data, error } = await sb.from("content_ideas").update(patch).eq("id", id).select("*").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ idea: data })
}

// DELETE /api/content/:id — een zelf toegevoegde, nog niet gepubliceerde contentkans verwijderen
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const { id } = await params
  const sb = getSupabase()
  const { data: idea } = await sb.from("content_ideas").select("origin, status").eq("id", id).maybeSingle()
  if (!idea) return NextResponse.json({ error: "Kans niet gevonden" }, { status: 404 })
  if (idea.origin !== "handmatig") return NextResponse.json({ error: "Alleen zelf toegevoegde kansen kun je verwijderen. Kansen uit nieuws of zoekdata wijs je af, dan leert het systeem daarvan." }, { status: 400 })
  if (idea.status === "gepubliceerd") return NextResponse.json({ error: "Een gepubliceerd artikel wordt nog gemeten en kan niet worden verwijderd." }, { status: 400 })
  const { error } = await sb.from("content_ideas").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from("seo_attachments").update({ deleted_at: new Date().toISOString() }).eq("ref_kind", "content").eq("ref_id", id)
  return NextResponse.json({ ok: true })
}

// Lees de nieuwste PDF/Word-bijlage en controleer de tekst. De eigen tekst wordt de definitieve versie;
// is er een eerder (AI-)concept, dan wordt vastgelegd hoeveel de redactie veranderde.
async function readAndCheck(cur: ContentIdea) {
  const doc = await latestAttachmentText(cur.id)
  if (!doc) return null
  const a = analyzeText(doc.text, cur)
  const out: Record<string, unknown> = {
    text_check: { at: new Date().toISOString(), attachment: doc.attachmentId, name: doc.name, stats: a.stats, checks: a.checks, features: a.features, firstLine: a.firstLine.slice(0, 200), readable: a.readable },
  }
  if (a.readable) {
    out.concept_final = doc.text.slice(0, 60000)
    if (cur.concept_original) out.concept_change_pct = changePct(cur.concept_original, doc.text)
  }
  return out
}
