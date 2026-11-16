import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/experiments — lijst van gelogde experimenten (optioneel gefilterd op advice_key)
export async function GET(request: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ rows: [] })
  }
  try {
    const { searchParams } = new URL(request.url)
    const adviceKey = searchParams.get("advice_key")

    const supabase = getSupabase()
    let query = supabase
      .from("seo_experiments")
      .select("*")
      .order("changed_at", { ascending: false })
    if (adviceKey) query = query.eq("advice_key", adviceKey)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ rows: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, rows: [] }, { status: 500 })
  }
}

// POST /api/experiments — nieuw experiment loggen met nulmeting (baseline)
// Verwacht: { advice_key, description, baseline: {...}, query?, page? }
export async function POST(request: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })
  }
  try {
    const body = await request.json()
    const { advice_key, description, baseline, query, page } = body
    if (!advice_key || !description || !baseline) {
      return NextResponse.json({ error: "advice_key, description en baseline zijn verplicht" }, { status: 400 })
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from("seo_experiments")
      .insert({
        advice_key,
        description,
        baseline,
        query: query ?? null,
        page: page ?? null,
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
