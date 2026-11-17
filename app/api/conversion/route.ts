import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/guard"
import { addDaysIso, conversionWindows } from "@/lib/server/conversion"

export const maxDuration = 30

// GET /api/conversion?page=/&days=28 — sessies en energiescanaanvragen, laatste periode en de periode ervoor
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const sp = new URL(request.url).searchParams
  const page = sp.get("page")
  if (page && !/^\/[a-z0-9\-/]*$/i.test(page)) return NextResponse.json({ error: "Ongeldige pagina" }, { status: 400 })
  const days = Math.min(Math.max(parseInt(sp.get("days") || "28"), 7), 90)
  const end = addDaysIso(new Date().toISOString().slice(0, 10), -1)
  const start = addDaysIso(end, -(days - 1))
  try {
    const r = await conversionWindows([{ start, end }, { start: addDaysIso(start, -days), end: addDaysIso(start, -1) }], page)
    return NextResponse.json({ page: page || null, days, measurement: { status: r.measurement.status, used: r.measurement.used, note: r.measurement.note }, cur: r.windows[0], prev: r.windows[1] })
  } catch (e: any) {
    return NextResponse.json({ error: /PERMISSION_DENIED/i.test(e?.message || "") ? "Geen toegang tot GA4" : e?.message || "GA4 niet bereikbaar" }, { status: 500 })
  }
}
