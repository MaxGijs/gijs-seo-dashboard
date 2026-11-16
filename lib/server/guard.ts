import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { createClient } from "@supabase/supabase-js"

// Endpoints die met de Supabase service-role sleutel werken mogen alleen door
// ingelogde Gijs-medewerkers gebruikt worden. Zonder deze check kon iedereen met
// een Google-account statussen lezen en wijzigen.
const ALLOWED_DOMAIN = "@groeninjestraat.nl"

function isAllowed(email: string | null | undefined) {
  if (!email) return false
  const extra = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  const e = email.toLowerCase()
  return e.endsWith(ALLOWED_DOMAIN) || extra.includes(e)
}

export async function requireUser() {
  const session = await auth()
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) }
  }
  if (!isAllowed(session.user.email)) {
    return { error: NextResponse.json({ error: `Geen toegang voor ${session.user.email}: alleen accounts op @groeninjestraat.nl (of accounts die in ALLOWED_EMAILS staan) kunnen het dashboard gebruiken.` }, { status: 403 }) }
  }
  return { session }
}

export function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
