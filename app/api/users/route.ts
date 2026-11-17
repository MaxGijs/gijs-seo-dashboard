import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"

// GET /api/users — legt vast dat jij het dashboard gebruikt en geeft de lijst van collega's
// (voor het toewijzen van taken). Alleen naam en e-mail; geen activiteit of tijdregistratie.
export async function GET() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] })
  const u = guard.session!.user!
  const sb = getSupabase()
  await sb.from("seo_users").upsert({ email: u.email!.toLowerCase(), name: u.name || null, image: u.image || null, last_seen: new Date().toISOString() })
  const { data } = await sb.from("seo_users").select("email, name, image").order("name")
  return NextResponse.json({ rows: data || [], me: u.email!.toLowerCase() })
}
