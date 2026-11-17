import { NextResponse } from "next/server"
import { requireUser, supabaseConfigured } from "@/lib/server/guard"
import { buildReport, listReports } from "@/lib/server/report"

export const maxDuration = 120

// GET /api/reports — alle vrijdagrapporten (nieuwste eerst)
// POST /api/reports — rapport van deze week nu (opnieuw) maken
export async function GET() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] })
  try { return NextResponse.json({ rows: await listReports() }) } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  try { return NextResponse.json(await buildReport(guard.session!.user?.name || guard.session!.user?.email || "onbekend")) } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
