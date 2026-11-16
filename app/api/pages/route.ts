import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"
import { checkHttpStatus, inspectBatch, syncInventory } from "@/lib/server/inventory"
import { logged } from "@/lib/server/synclog"

export const maxDuration = 60

// GET /api/pages — de volledige pagina-inventaris (alle URL's uit sitemap + Search Console)
export async function GET() {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] })

  try {
    const supabase = getSupabase()
    const rows: any[] = []
    // Supabase geeft maximaal 1.000 rijen per verzoek
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase.from("seo_pages").select("*").order("path").range(from, from + 999)
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    const lastSync = rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), "")
    const lastInspect = rows.reduce((m, r) => (r.inspected_at && r.inspected_at > m ? r.inspected_at : m), "")
    return NextResponse.json({ rows, lastSync: lastSync || null, lastInspect: lastInspect || null })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, rows: [] }, { status: 500 })
  }
}

// POST /api/pages { action: "sync" | "inspect" } — inventaris bijwerken of een batch indexeringscontroles draaien
export async function POST(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })

  try {
    const { action } = await request.json()
    if (action === "sync") {
      const started = Date.now()
      const inventaris = await logged("inventaris", () => syncInventory())
      const status = await logged("http-controle", () => checkHttpStatus({ budgetMs: Math.max(10000, 50000 - (Date.now() - started)) }))
      return NextResponse.json({ ok: true, ...inventaris, http: status })
    }
    if (action === "inspect") return NextResponse.json({ ok: true, ...(await logged("indexering", () => inspectBatch({ budgetMs: 40000, max: 300 }))) })
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
