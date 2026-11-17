import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"
import { buildIdea, siteContext, sourceOverview } from "@/lib/server/content"
import { termsInText, topicKeywords } from "@/lib/content/build"
import { impactOf, PROVINCES, regionsIn, reliabilityOf, servicesIn, SCAN_SERVICE } from "@/lib/content/model"

export const maxDuration = 30

// GET /api/content — alle contentkansen, capaciteit per dienst en de laatste scan
export async function GET(req: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const sb = getSupabase()
  if (new URL(req.url).searchParams.get("count")) {
    const { count } = await sb.from("content_ideas").select("id", { count: "exact", head: true }).eq("status", "nieuw")
    return NextResponse.json({ nieuw: count ?? 0 })
  }
  const [ideas, capacity, scan, services, news] = await Promise.all([
    sb.from("content_ideas").select("*").order("score", { ascending: false }).limit(1000),
    sb.from("content_capacity").select("*"),
    sb.from("seo_sync_log").select("run_at, ok, details, error").eq("job", "actualiteiten").order("run_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("seo_pages").select("path").eq("page_type", "maatregel").eq("in_sitemap", true),
    sb.from("content_news").select("id", { count: "exact", head: true }),
  ])
  const sources = await sourceOverview().catch(() => [])
  if (ideas.error) return NextResponse.json({ error: ideas.error.message }, { status: 500 })
  const list = (services.data || []).map(p => p.path.split("/")[2]).filter(Boolean)
  return NextResponse.json({
    ideas: ideas.data || [],
    capacity: capacity.data || [],
    lastScan: scan.data ?? null,
    services: [SCAN_SERVICE, ...list],
    newsCount: news.count ?? 0,
    sources,
  })
}

// POST /api/content — eigen idee toevoegen (bijvoorbeeld een klantvraag)
export async function POST(req: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  const body = await req.json().catch(() => ({}))
  const title = String(body.title || "").trim().slice(0, 200)
  const why = String(body.why || "").trim().slice(0, 2000)
  if (!title) return NextResponse.json({ error: "Titel ontbreekt" }, { status: 400 })
  const sourceUrl = String(body.sourceUrl || "").trim()
  if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) return NextResponse.json({ error: "Bron-URL is ongeldig" }, { status: 400 })
  const ctx = await siteContext()
  const question = String(body.question || "").trim().slice(0, 1000)
  const text = `${title} ${why} ${question}`
  const service = body.service || servicesIn(text, ctx.services).find(s => s !== SCAN_SERVICE) || SCAN_SERVICE
  const impact = impactOf(text)
  const who = guard.session.user?.name || guard.session.user?.email || "medewerker"
  const regions: string[] = Array.isArray(body.regions) ? body.regions.filter((r: unknown) => typeof r === "string" && r in PROVINCES) : []
  const urgency = ["hoog", "middel", "laag"].includes(body.urgency) ? body.urgency : "middel"
  const row = buildIdea({
    fingerprint: `handmatig:${crypto.randomUUID()}`,
    origin: "handmatig",
    subject: title,
    summary: [question ? `Letterlijke klantvraag: "${question}"` : "", why].filter(Boolean).join(" "),
    whyNow: why || (question ? `Klantvraag: "${question}"` : `Idee van ${who}.`),
    service, impact, regions: regions.length ? regions : regionsIn(text),
    sources: [
      ...(sourceUrl ? [{ title: String(body.sourceTitle || sourceUrl).slice(0, 300), url: sourceUrl, publisher: String(body.sourcePublisher || new URL(sourceUrl).hostname.replace(/^www\./, "")), date: body.sourceDate || null, reliability: reliabilityOf(sourceUrl) }] : []),
      { title: body.kind === "klantvraag" ? (question ? `Klantvraag: "${question.slice(0, 200)}"` : "Klantvraag") : "Idee van een medewerker", publisher: who, date: new Date().toISOString(), reliability: "medewerker" as const },
    ],
    ageDays: null, reliability: sourceUrl ? reliabilityOf(sourceUrl) : "medewerker",
    format: body.format || undefined,
    urgency,
    keywords: topicKeywords(termsInText(text, ctx.services), ctx.queries),
    titleOverride: [{ angle: body.angle || "neutraal", title }],
  }, ctx)
  if ("issues" in row) return NextResponse.json({ error: `Controle mislukt: ${(row as any).issues.join(" ")}` }, { status: 500 })
  const { data, error } = await getSupabase().from("content_ideas").insert({ ...row, created_by: who }).select("*").single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ idea: data })
}
