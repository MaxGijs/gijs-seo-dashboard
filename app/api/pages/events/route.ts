import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"
import { readEvents, readWatch } from "@/lib/server/watch"

export const maxDuration = 30

// GET /api/pages/events?paths=/a,/b  → tijdlijn van die pagina's
// GET /api/pages/events?feed=14      → gebeurtenissen van de laatste 14 dagen (voor Vandaag)
// Altijd mee: waarom een pagina gevolgd wordt en de laatste stand bij Google.
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ events: [], watch: {}, pages: {} })
  try {
    const url = new URL(request.url)
    const paths = (url.searchParams.get("paths") || "").split(",").map(p => p.trim()).filter(Boolean).slice(0, 20)
    const feed = Number(url.searchParams.get("feed") || 0)
    const [events, watch] = await Promise.all([
      readEvents(paths.length ? { paths } : { sinceDays: feed || 14 }),
      readWatch(),
    ])
    const wanted = [...new Set([...paths, ...events.map(e => e.path)])]
    const { data: pages } = wanted.length
      ? await getSupabase().from("seo_pages").select("path, index_verdict, coverage_state, last_crawl_time, inspected_at, imp_28d, clicks_28d, position_28d").in("path", wanted)
      : { data: [] as any[] }
    return NextResponse.json({
      events,
      watch: Object.fromEntries([...watch.entries()].filter(([p]) => !paths.length || paths.includes(p) || events.some(e => e.path === p))),
      watchedCount: watch.size,
      pages: Object.fromEntries((pages || []).map(p => [p.path, p])),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, events: [], watch: {}, pages: {} }, { status: 500 })
  }
}
