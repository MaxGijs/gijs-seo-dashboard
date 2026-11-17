import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"
import { hashToken, newToken } from "@/lib/server/mcp-auth"

// GET: je eigen koppelingen (zonder token). POST: nieuwe koppeling, token één keer zichtbaar. DELETE ?id=: intrekken
export async function GET() {
  const guard = await requireUser(); if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] })
  const email = guard.session!.user!.email!.toLowerCase()
  const sb = getSupabase()
  const [{ data }, { data: log }] = await Promise.all([
    sb.from("seo_mcp_tokens").select("id, hint, created_at, last_used_at, revoked_at").eq("email", email).order("created_at", { ascending: false }),
    sb.from("seo_mcp_log").select("at, tool, ok, detail").eq("email", email).order("at", { ascending: false }).limit(15),
  ])
  return NextResponse.json({ rows: data || [], log: log || [] })
}

export async function POST(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const u = guard.session!.user!
  const token = newToken()
  const { data, error } = await getSupabase().from("seo_mcp_tokens").insert({ email: u.email!.toLowerCase(), name: u.name || null, token_hash: hashToken(token), hint: token.slice(-4) }).select("id").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const origin = new URL(req.url).origin
  return NextResponse.json({ id: data.id, url: `${origin}/api/mcp/${token}` })
}

export async function DELETE(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id ontbreekt" }, { status: 400 })
  const { error } = await getSupabase().from("seo_mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("email", guard.session!.user!.email!.toLowerCase())
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
