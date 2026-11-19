import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/guard"
import { dateWindow, gscQuery, serviceSearchConsole } from "@/lib/server/gsc"

// GET /api/gsc?type=overview|keywords|pages&days=28&offset=0&limit=25&order=clicks|impressions[&terms=a,b]
// offset = aantal dagen dat het venster terug in de tijd schuift (vorige periode: offset=days).
export async function GET(request: Request) {
  // Alle Gijs-medewerkers zien dezelfde cijfers: opgehaald met het service-account van het dashboard,
  // niet met het eigen Google-account (dat heeft lang niet altijd toegang tot Search Console).
  const guard = await requireUser()
  if (guard.error) return guard.error

  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type") || "keywords"
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "28"), 1), 480)
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0)
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "25"), 1), 1000)
  const order = searchParams.get("order") === "impressions" ? "impressions" : "clicks"
  const { startDate, endDate } = dateWindow(days, offset)
  const sc = serviceSearchConsole()

  try {
    if (type === "overview") {
      const rows = await gscQuery(sc, { startDate, endDate, dimensions: ["date"], rowLimit: days })
      return NextResponse.json({ rows, startDate, endDate })
    }
    if (type === "keywords" || type === "pages") {
      // ?terms=warmtepomp,hybride pomp → alleen zoekwoorden met een van deze termen (ook de long tail buiten de top)
      const terms = type === "keywords"
        ? (searchParams.get("terms") || "").split(",").map(t => t.trim().toLowerCase()).filter(t => /^[a-z0-9 +\-]{2,40}$/.test(t)).slice(0, 12)
        : []
      const rx = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
      const rows = await gscQuery(sc, {
        startDate, endDate,
        dimensions: [type === "keywords" ? "query" : "page"],
        rowLimit: limit,
        orderBy: [{ fieldName: order, sortOrder: "DESCENDING" }],
        ...(rx ? { dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "includingRegex", expression: `(?i)(${rx})` }] }] } : {}),
      })
      return NextResponse.json({ rows, startDate, endDate })
    }
    return NextResponse.json({ error: "Unknown type" }, { status: 400 })
  } catch (err: any) {
    const forbidden = err?.code === 403 || /permission|sufficient/i.test(err?.message || "")
    return NextResponse.json({ error: forbidden ? "Het service-account van het dashboard heeft geen toegang tot Search Console." : err.message, code: forbidden ? "permission" : undefined }, { status: 500 })
  }
}
