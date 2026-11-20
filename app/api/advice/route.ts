import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"

const VALID_STATUSES = [
  "nieuw", "onderzoeken", "uitgesteld", "goedgekeurd", "in_uitvoering", "uitgevoerd",
  "in_evaluatie", "succesvol", "niet_succesvol", "afgewezen", "onvoldoende_bewijs", "samengevoegd",
]

// GET /api/advice — alle opgeslagen statussen, inclusief momentopname van het advies
export async function GET() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [], error: "Opslag niet geconfigureerd" })

  try {
    const { data, error } = await getSupabase()
      .from("seo_advice_status")
      .select("advice_key, advice_title, advice_type, status, note, snapshot, snooze_until, created_at, updated_at, owner")
      .order("updated_at", { ascending: false })
    if (error) throw error
    return NextResponse.json({ rows: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, rows: [] }, { status: 500 })
  }
}

// POST /api/advice — status van een advies bijwerken (upsert op advice_key)
// Body: { advice_key, advice_title, advice_type, status, note?, snapshot?, snooze_until? }
export async function POST(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })

  try {
    const body = await request.json()
    const { advice_key, advice_title, advice_type, status, note, snapshot, snooze_until, owner } = body
    if (!advice_key || !status) {
      return NextResponse.json({ error: "advice_key en status zijn verplicht" }, { status: 400 })
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Onbekende status: ${status}` }, { status: 400 })
    }
    if (snooze_until && !/^\d{4}-\d{2}-\d{2}$/.test(snooze_until)) {
      return NextResponse.json({ error: "snooze_until moet een datum zijn (JJJJ-MM-DD)" }, { status: 400 })
    }

    const row: Record<string, unknown> = {
      advice_key,
      advice_title: advice_title || advice_key,
      advice_type: advice_type || "onbekend",
      status,
      snooze_until: status === "uitgesteld" ? snooze_until || null : null,
      updated_at: new Date().toISOString(),
    }
    // Alleen overschrijven wat is meegestuurd, zodat een statuswijziging een eerdere notitie
    // of momentopname niet per ongeluk wist.
    if (note !== undefined) row.note = note
    if (snapshot !== undefined) row.snapshot = snapshot
    if (owner !== undefined) row.owner = typeof owner === "string" && /^[^\s@]+@[^\s@]+$/.test(owner) ? owner.toLowerCase() : null

    const { data, error } = await getSupabase()
      .from("seo_advice_status")
      .upsert(row, { onConflict: "advice_key" })
      .select("advice_key, advice_title, advice_type, status, note, snapshot, snooze_until, created_at, updated_at, owner")
      .single()
    if (error) throw error

    return NextResponse.json({ ok: true, row: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/advice?key=eigen:… — een zelf toegevoegde taak verwijderen (bijv. per ongeluk aangemaakt).
// Taken die uit de data komen kun je niet verwijderen: die komen terug; die wijs je af.
export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const key = new URL(request.url).searchParams.get("key") || ""
  if (!key.startsWith("eigen:")) return NextResponse.json({ error: "Alleen zelf toegevoegde taken kun je verwijderen. Taken uit de data wijs je af, dan leert het systeem daarvan." }, { status: 400 })
  const sb = getSupabase()
  const { error: e1 } = await sb.from("seo_experiments").delete().eq("advice_key", key)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  const { error: e2 } = await sb.from("seo_advice_status").delete().eq("advice_key", key)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  await sb.from("seo_attachments").update({ deleted_at: new Date().toISOString() }).eq("ref_kind", "taak").eq("ref_id", key)
  return NextResponse.json({ ok: true })
}
