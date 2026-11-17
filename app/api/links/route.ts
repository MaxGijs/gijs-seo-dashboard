import { NextResponse } from "next/server"
import { requireUser, supabaseConfigured } from "@/lib/server/guard"
import { suggestLinks } from "@/lib/server/links"

export const maxDuration = 30

// GET /api/links?target=/regio/overijssel/zwolle&query=isolatie zwolle — interne-linkvoorstellen
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const sp = new URL(request.url).searchParams
  const target = sp.get("target") || ""
  if (!/^\/[a-z0-9\-/]*$/i.test(target)) return NextResponse.json({ error: "Ongeldige doelpagina" }, { status: 400 })
  try { return NextResponse.json(await suggestLinks(target.replace(/\/$/, "") || "/", sp.get("query"))) }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
