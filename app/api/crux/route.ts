import { NextResponse } from "next/server"
import { requireUser, supabaseConfigured } from "@/lib/server/guard"
import { cruxConfigured, cruxSeries, syncCrux } from "@/lib/server/crux"
import { cwvPages } from "@/lib/server/cwv-pages"
import { logged } from "@/lib/server/synclog"

// GET /api/crux?scope=origin — laadsnelheid van echte bezoekers per week (CrUX History)
// POST /api/crux             — nu ophalen (anders wekelijks automatisch)
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const scope = new URL(request.url).searchParams.get("scope") || "origin"
  if (!supabaseConfigured()) return NextResponse.json({ configured: cruxConfigured(), points: [] })
  try { return NextResponse.json({ configured: cruxConfigured(), points: await cruxSeries(scope) }) }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
export async function POST() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  try {
    const out = await logged("snelheid-historie", async () => syncCrux(await cwvPages().catch(() => ["/"]), true))
    return NextResponse.json({ ok: true, ...out, points: await cruxSeries("origin") })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
