import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"
import { readCampaigns } from "@/lib/server/campaigns"
import { CAMPAIGN_KINDS } from "@/lib/campaigns"

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)

// GET: alle campagnes. POST: toevoegen of (met id) wijzigen. DELETE ?id=: verwijderen
export async function GET() {
  const guard = await requireUser(); if (guard.error) return guard.error
  try { return NextResponse.json({ rows: await readCampaigns() }) } catch (e: any) { return NextResponse.json({ error: e.message, rows: [] }, { status: 500 }) }
}

export async function POST(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const name = String(b.name || "").trim().slice(0, 140)
  if (!name) return NextResponse.json({ error: "Geef de campagne een naam" }, { status: 400 })
  if (!isDate(b.start_date)) return NextResponse.json({ error: "Startdatum ontbreekt (JJJJ-MM-DD)" }, { status: 400 })
  if (b.end_date && (!isDate(b.end_date) || b.end_date < b.start_date)) return NextResponse.json({ error: "Einddatum moet na de startdatum liggen" }, { status: 400 })
  const row = {
    name,
    kind: CAMPAIGN_KINDS.some(k => k.id === b.kind) ? b.kind : "overig",
    start_date: b.start_date, end_date: b.end_date || null,
    regions: (Array.isArray(b.regions) ? b.regions : String(b.regions || "").split(",")).map((r: string) => String(r).trim()).filter(Boolean).slice(0, 30),
    amount: Number.isFinite(Number(b.amount)) && Number(b.amount) > 0 ? Math.round(Number(b.amount)) : null,
    landing_page: b.landing_page ? String(b.landing_page).trim().slice(0, 300) : null,
    note: b.note ? String(b.note).trim().slice(0, 1000) : null,
    updated_at: new Date().toISOString(),
  }
  const sb = getSupabase()
  const q = b.id
    ? sb.from("seo_campaigns").update(row).eq("id", b.id).select("*").single()
    : sb.from("seo_campaigns").insert({ ...row, created_by: guard.session!.user!.email!.toLowerCase() }).select("*").single()
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, row: data })
}

export async function DELETE(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id ontbreekt" }, { status: 400 })
  const { error } = await getSupabase().from("seo_campaigns").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
