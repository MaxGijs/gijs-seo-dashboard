import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const VALID_STATUSES = [
  "nieuw", "onderzoeken", "goedgekeurd", "uitgevoerd",
  "in_evaluatie", "succesvol", "niet_succesvol", "afgewezen", "onvoldoende_bewijs",
]

// GET /api/advice — huidige status van alle actiepunten (key -> status/note/updated_at)
export async function GET() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ rows: [] })
  }
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from("seo_advice_status")
      .select("advice_key, advice_title, advice_type, status, note, updated_at")
    if (error) throw error
    return NextResponse.json({ rows: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, rows: [] }, { status: 500 })
  }
}

// POST /api/advice — status van een actiepunt bijwerken (upsert op advice_key)
export async function POST(request: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })
  }
  try {
    const body = await request.json()
    const { advice_key, advice_title, advice_type, status, note } = body
    if (!advice_key || !status) {
      return NextResponse.json({ error: "advice_key en status zijn verplicht" }, { status: 400 })
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Onbekende status: ${status}` }, { status: 400 })
    }

    const supabase = getSupabase()
    const { error } = await supabase.from("seo_advice_status").upsert({
      advice_key,
      advice_title: advice_title || advice_key,
      advice_type: advice_type || "onbekend",
      status,
      note: note ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "advice_key" })
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
