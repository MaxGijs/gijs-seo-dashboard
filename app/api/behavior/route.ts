import { NextResponse } from "next/server"
import { requireUser, supabaseConfigured } from "@/lib/server/guard"
import { behaviorFor, behaviorTop, clarityConfigured } from "@/lib/server/clarity"
import { behaviorNotes } from "@/lib/clarity"

// GET /api/behavior?path=/x — gedrag op één pagina (Clarity, laatste 28 dagen)
// GET /api/behavior          — pagina's met het meeste bezoek
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const configured = clarityConfigured()
  if (!supabaseConfigured()) return NextResponse.json({ configured, behavior: null, top: [] })
  const u = new URL(request.url)
  const path = u.searchParams.get("path")
  const days = Math.min(90, Math.max(7, Number(u.searchParams.get("days")) || 28))
  try {
    if (path) { const b = await behaviorFor(path, days); return NextResponse.json({ configured, behavior: b.days ? b : null, notes: b.days ? behaviorNotes(b) : [] }) }
    return NextResponse.json({ configured, top: await behaviorTop(days) })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
