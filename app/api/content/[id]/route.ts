import { NextResponse } from "next/server"
import { getSupabase, requireUser } from "@/lib/server/guard"
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

  const feedbackFrom = (tags: unknown, note?: unknown) => {
    const list = Array.isArray(tags) ? tags.filter((t): t is string => (FEEDBACK_TAGS as readonly string[]).includes(t)) : []
    const n = note ? String(note).slice(0, 1000) : undefined
    return [...list.map(tag => ({ tag, note: n, at: now, by: who })), ...(!list.length && n ? [{ tag: "opmerking", note: n, at: now, by: who }] : [])]
  }

  switch (body.action) {
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
      break
    }
    default:
      return bad("Onbekende actie")
  }

  const { data, error } = await sb.from("content_ideas").update(patch).eq("id", id).select("*").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ idea: data })
}
