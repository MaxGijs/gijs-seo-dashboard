import { NextResponse } from "next/server"
import { requireUser, supabaseConfigured } from "@/lib/server/guard"
import { scanContent } from "@/lib/server/content"
import { logged } from "@/lib/server/synclog"

export const maxDuration = 120

// POST /api/content/scan — nu zoeken naar nieuwe kansen (dezelfde scan als 's nachts)
export async function POST() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  try {
    const result = await logged("actualiteiten", () => scanContent())
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
