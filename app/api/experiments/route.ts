import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"

// GET /api/experiments — gelogde experimenten (optioneel gefilterd op advice_key)
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] })

  try {
    const { searchParams } = new URL(request.url)
    const adviceKey = searchParams.get("advice_key")
    let query = getSupabase()
      .from("seo_experiments")
      .select("*")
      .order("changed_at", { ascending: false })
      .order("created_at", { ascending: false })
    if (adviceKey) query = query.eq("advice_key", adviceKey)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ rows: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, rows: [] }, { status: 500 })
  }
}

// POST /api/experiments — nieuw experiment loggen met nulmeting (baseline)
// Body: { advice_key, description, baseline: {...}, query?, page? }
// Het advies moet al een statusregel hebben (foreign key); de client slaat die eerst op.
export async function POST(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })

  try {
    const body = await request.json()
    const { advice_key, description, baseline, query, page, hypothesis, target_pages, target_queries, predicted } = body
    if (!advice_key || !description?.trim() || !baseline) {
      return NextResponse.json({ error: "advice_key, description en baseline zijn verplicht" }, { status: 400 })
    }

    const { data, error } = await getSupabase()
      .from("seo_experiments")
      .insert({
        advice_key,
        description: description.trim(),
        baseline,
        query: query ?? null,
        page: page ?? null,
        hypothesis: typeof hypothesis === "string" ? hypothesis.slice(0, 1000) : null,
        target_pages: Array.isArray(target_pages) ? target_pages.slice(0, 500).map(String) : null,
        target_queries: Array.isArray(target_queries) ? target_queries.slice(0, 50).map(String) : null,
        predicted: predicted && typeof predicted === "object" ? predicted : null,
        changed_at: new Date().toISOString().split("T")[0],
      })
      .select()
      .single()
    if (error) throw error

    return NextResponse.json({ ok: true, experiment: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/experiments?key=… — een per ongeluk gestarte meting terugdraaien (taak een stap terug).
// Kan alleen zolang er nog geen meetmoment is geweest.
export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const key = new URL(request.url).searchParams.get("key")
  if (!key) return NextResponse.json({ error: "key ontbreekt" }, { status: 400 })
  const sb = getSupabase()
  const { data: rows } = await sb.from("seo_experiments").select("id, result_14d, outcome").eq("advice_key", key).is("outcome", null)
  if (!rows?.length) return NextResponse.json({ ok: true, removed: 0 })
  if (rows.some(r => r.result_14d)) return NextResponse.json({ error: "Er is al gemeten (14 dagen). Een stap terug zou die meting weggooien; sleep de taak naar Afgerond als je wilt stoppen." }, { status: 409 })
  const { error } = await sb.from("seo_experiments").delete().in("id", rows.map(r => r.id))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, removed: rows.length })
}
