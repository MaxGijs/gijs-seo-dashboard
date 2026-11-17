// MCP-server (Streamable HTTP, zonder sessies) voor de Claude-koppeling.
// Toe te voegen in de Claude-app als eigen connector met de persoonlijke URL van /koppeling.
import { NextResponse } from "next/server"
import { actorForToken } from "@/lib/server/mcp-auth"
import { fail, handle, type Msg } from "@/lib/server/mcp"
import { supabaseConfigured } from "@/lib/server/guard"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const actor = supabaseConfigured() ? await actorForToken(token) : null
  if (!actor) return NextResponse.json(fail(null, -32001, "Ongeldige of ingetrokken koppeling. Maak een nieuwe aan op /koppeling in het dashboard."), { status: 401 })
  let body: Msg | Msg[]
  try { body = await req.json() } catch { return NextResponse.json(fail(null, -32700, "Ongeldige JSON"), { status: 400 }) }
  const list = Array.isArray(body) ? body : [body]
  const out = (await Promise.all(list.map(m => handle(m, actor)))).filter(Boolean)
  if (!out.length) return new Response(null, { status: 202 })
  return NextResponse.json(Array.isArray(body) ? out : out[0])
}

// Geen server-naar-client stream: alleen POST
export async function GET() { return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } }) }
export async function DELETE() { return new Response(null, { status: 405, headers: { Allow: "POST" } }) }
