import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/guard"
import { readDashboard } from "@/lib/server/dashboard"
import type { Compare, DashboardQuery, PresetPeriod } from "@/lib/dashboard"

export const maxDuration = 60

// GET /api/dashboard?period=28&compare=prev[&start=&end=][&regio=][&dienst=]
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const sp = new URL(request.url).searchParams
  const period = sp.get("period")
  const compare = sp.get("compare")
  const q: DashboardQuery = {
    period: (["1", "7", "28", "90", "custom"].includes(period || "") ? period : "28") as PresetPeriod | "custom",
    compare: (["prev", "year", "none"].includes(compare || "") ? compare : "prev") as Compare,
    start: sp.get("start") || undefined,
    end: sp.get("end") || undefined,
    regio: sp.get("regio"),
    dienst: sp.get("dienst"),
  }
  const fresh = sp.get("fresh") === "1"
  try {
    return NextResponse.json(await readDashboard(q, fresh))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Dashboard kon niet worden opgebouwd" }, { status: 500 })
  }
}
