import { NextResponse } from "next/server"
import { getSupabase, requireUser } from "@/lib/server/guard"
import { CAPACITY_META } from "@/lib/content/model"

// PUT /api/content/capacity — capaciteit per dienst (telt mee in de score en de call-to-action)
export async function PUT(req: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const body = await req.json().catch(() => ({}))
  const service = String(body.service || "").trim()
  const mode = String(body.mode || "")
  if (!service || !(mode in CAPACITY_META)) return NextResponse.json({ error: "Ongeldige dienst of capaciteit" }, { status: 400 })
  const { error } = await getSupabase().from("content_capacity").upsert({
    service, mode, note: body.note ? String(body.note).slice(0, 500) : null, updated_at: new Date().toISOString(),
    updated_by: guard.session.user?.name || guard.session.user?.email || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
