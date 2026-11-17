import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/guard"
import { measurePage } from "@/lib/server/cwv"
import { getSupabase } from "@/lib/server/guard"
import { toPath } from "@/lib/server/gsc"

export const maxDuration = 60

// POST { path }: één pagina nu meten (knop "Nu meten")
export async function POST(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  const b = await req.json().catch(() => ({}))
  const path = b.path ? toPath(String(b.path)) : "/"
  if (!path.startsWith("/")) return NextResponse.json({ error: "Alleen pagina's van groeninjestraat.nl" }, { status: 400 })
  try {
    const row = await measurePage(path)
    const full = { ...row, measured_at: new Date().toISOString() }
    await getSupabase().from("seo_cwv").upsert(full)
    return NextResponse.json({ ok: true, row: full })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 502 }) }
}
