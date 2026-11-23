import { NextResponse } from "next/server"
import { getSupabase, requireUser } from "@/lib/server/guard"
import { backupOf, canMerge, combine, type MergeFields } from "@/lib/content/merge"
import type { ContentIdea } from "@/lib/content/model"

// POST /api/content/merge
//   { action: "merge", mainId, ids: [...], title? }  → de andere ideeën gaan op in de hoofdkans
//   { action: "split", id }                           → één samengevoegd idee weer los
// Samenvoegen telt niet als afwijzing; Splitsen zet alles terug zoals het was.
export async function POST(req: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const who = guard.session.user?.name || guard.session.user?.email || "medewerker"
  const body = await req.json().catch(() => ({}))
  const sb = getSupabase()
  const now = new Date().toISOString()
  const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })
  const get = async (ids: string[]) => { const { data, error } = await sb.from("content_ideas").select("*").in("id", ids); if (error) throw new Error(error.message); return (data || []) as ContentIdea[] }
  const children = async (mainId: string) => { const { data } = await sb.from("content_ideas").select("*").eq("merged_into", mainId).eq("status", "samengevoegd"); return (data || []) as ContentIdea[] }
  const fields = (f: MergeFields) => ({ title: f.title, keywords: f.keywords, sources: f.sources, regions: f.regions, related_pages: f.related_pages, why_now: f.why_now, summary: f.summary, score: f.score, priority: f.priority })

  try {
    if (body.action === "merge") {
      const mainId = String(body.mainId || "")
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x: string) => x && x !== mainId)
      if (!mainId || !ids.length) return bad("Kies een hoofdkans en minstens één andere kans.")
      const [main] = await get([mainId])
      const others = await get(ids)
      if (!main) return bad("Hoofdkans niet gevonden", 404)
      if (others.length !== ids.length) return bad("Niet alle kansen gevonden", 404)
      const blocked = [main, ...others].filter(i => !canMerge(i) || i.merged_into)
      if (blocked.length) return bad(`Alleen kansen waar nog niet aan geschreven is kunnen samen: ${blocked.map(b => `"${b.title}"`).join(", ")}.`)
      // Al eerder samengevoegd: verder bouwen op het origineel, met alle onderdelen
      const base: MergeFields = main.merge_backup?.fields || backupOf(main as any)
      const existing = await children(main.id)
      const merged = combine(base, main.target_page, [...existing, ...others] as any, body.title ?? main.title)
      const { data: upd, error: e1 } = await sb.from("content_ideas").update({ ...fields(merged), merge_backup: { fields: base, at: main.merge_backup?.at || now, by: main.merge_backup?.by || who }, updated_at: now }).eq("id", main.id).select("*").single()
      if (e1) throw new Error(e1.message)
      for (const o of others) {
        const { error } = await sb.from("content_ideas").update({ status: "samengevoegd", merged_into: main.id, merge_backup: { status: o.status, at: now, by: who }, updated_at: now }).eq("id", o.id)
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ ok: true, idea: upd, merged: others.map(o => o.id) })
    }

    if (body.action === "split") {
      const [child] = await get([String(body.id || "")])
      if (!child || child.status !== "samengevoegd" || !child.merged_into) return bad("Deze kans is niet samengevoegd.")
      const [main] = await get([child.merged_into])
      const prev = (child.merge_backup?.status as string) || "nieuw"
      const { error: e1 } = await sb.from("content_ideas").update({ status: canMerge({ status: prev as any }) ? prev : "nieuw", merged_into: null, merge_backup: null, updated_at: now }).eq("id", child.id)
      if (e1) throw new Error(e1.message)
      let idea: ContentIdea | null = null
      if (main) {
        // Hoofdkans opnieuw opbouwen uit het origineel en de onderdelen die overblijven
        const base: MergeFields | undefined = main.merge_backup?.fields
        const rest = (await children(main.id)).filter(c => c.id !== child.id)
        if (base) {
          const next = rest.length ? combine(base, main.target_page, rest as any, main.title) : base
          const { data, error } = await sb.from("content_ideas").update({ ...fields(next), merge_backup: rest.length ? main.merge_backup : null, updated_at: now }).eq("id", main.id).select("*").single()
          if (error) throw new Error(error.message)
          idea = data as ContentIdea
        }
      }
      return NextResponse.json({ ok: true, idea, split: child.id })
    }
    return bad("Onbekende actie")
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Samenvoegen mislukt" }, { status: 500 })
  }
}
