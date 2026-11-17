import { NextResponse } from "next/server"
import { requireUser, supabaseConfigured } from "@/lib/server/guard"
import { readLessons, recomputeLessons, setLessonStatus } from "@/lib/server/learning"

// GET  /api/lessons — lessen, logboek en hoeveel metingen er zijn
// POST /api/lessons { action: "revert" | "restore", key } of { action: "recompute" }
export async function GET() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ lessons: [], log: [], stats: null })
  try { return NextResponse.json(await readLessons()) } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const by = guard.session!.user?.name || guard.session!.user?.email || "onbekend"
  const body = await request.json().catch(() => ({}))
  try {
    if (body.action === "recompute") return NextResponse.json(await recomputeLessons(by))
    if ((body.action === "revert" || body.action === "restore") && typeof body.key === "string") {
      await setLessonStatus(body.key, body.action === "revert" ? "teruggedraaid" : "actief", by)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
