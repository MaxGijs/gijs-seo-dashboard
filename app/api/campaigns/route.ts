import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"
import { readCampaigns } from "@/lib/server/campaigns"
import { CAMPAIGN_KINDS, effectEnd } from "@/lib/campaigns"
import { opportunitiesFor, THEMES, type CampaignX, type IdeaLite, type Opportunity } from "@/lib/campaignOpportunities"

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)

// GET: alle campagnes. POST: toevoegen of (met id) wijzigen. DELETE ?id=: verwijderen
export async function GET() {
  const guard = await requireUser(); if (guard.error) return guard.error
  try {
    const rows = await readCampaigns() as CampaignX[]
    return NextResponse.json({ rows, opportunities: await opportunities(rows).catch(() => [] as Opportunity[]) })
  } catch (e: any) { return NextResponse.json({ error: e.message, rows: [] }, { status: 500 }) }
}

// Kansen: actueel nieuws (subsidie, regels, kosten, stroomnet) dat past bij het gebied en onderwerp van een campagne
async function opportunities(rows: CampaignX[]): Promise<Opportunity[]> {
  if (!rows.length || !supabaseConfigured()) return []
  const sb = getSupabase()
  const since = new Date(Date.now() - 45 * 86400000).toISOString()
  const [{ data: ideas }, { data: pages }] = await Promise.all([
    sb.from("content_ideas").select("id, title, origin, impact, service, status, regions, why_now, summary, advice, created_at, sources").gte("created_at", since).limit(400),
    sb.from("seo_pages").select("provincie, gemeente, plaats").not("provincie", "is", null).limit(5000),
  ])
  const prov = new Map<string, string>()
  for (const p of (pages || []) as { provincie: string; gemeente: string | null; plaats: string | null }[]) {
    if (p.gemeente) prov.set(p.gemeente.toLowerCase(), p.provincie)
    if (p.plaats) prov.set(p.plaats.toLowerCase(), p.provincie)
    prov.set(p.provincie.toLowerCase(), p.provincie)
  }
  const today = new Date().toISOString().slice(0, 10)
  // Wijknamen ("Bornsche Maten, Borne"): elk deel apart opzoeken
  const provinceOf = (r: string) => prov.get(r.toLowerCase()) || null
  return rows.flatMap(c => opportunitiesFor(c, (ideas || []) as IdeaLite[], provinceOf, today, effectEnd(c)))
}

export async function POST(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const name = String(b.name || "").trim().slice(0, 140)
  if (!name) return NextResponse.json({ error: "Geef de campagne een naam" }, { status: 400 })
  if (!isDate(b.start_date)) return NextResponse.json({ error: "Startdatum ontbreekt (JJJJ-MM-DD)" }, { status: 400 })
  if (b.end_date && (!isDate(b.end_date) || b.end_date < b.start_date)) return NextResponse.json({ error: "Einddatum moet na de startdatum liggen" }, { status: 400 })
  const row = {
    name,
    kind: CAMPAIGN_KINDS.some(k => k.id === b.kind) ? b.kind : "overig",
    start_date: b.start_date, end_date: b.end_date || null,
    regions: (Array.isArray(b.regions) ? b.regions : String(b.regions || "").split(",")).map((r: string) => String(r).trim()).filter(Boolean).slice(0, 30),
    amount: Number.isFinite(Number(b.amount)) && Number(b.amount) > 0 ? Math.round(Number(b.amount)) : null,
    landing_page: b.landing_page ? String(b.landing_page).trim().slice(0, 300) : null,
    note: b.note ? String(b.note).trim().slice(0, 1000) : null,
    themes: (Array.isArray(b.themes) ? b.themes : []).filter((t: unknown) => THEMES.some(x => x.id === t)).slice(0, 10),
    housing: ["nieuwbouw", "bestaand", "gemengd"].includes(b.housing) ? b.housing : null,
    updated_at: new Date().toISOString(),
  }
  const sb = getSupabase()
  const q = b.id
    ? sb.from("seo_campaigns").update(row).eq("id", b.id).select("*").single()
    : sb.from("seo_campaigns").insert({ ...row, created_by: guard.session!.user!.email!.toLowerCase() }).select("*").single()
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, row: data })
}

export async function DELETE(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id ontbreekt" }, { status: 400 })
  const { error } = await getSupabase().from("seo_campaigns").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
