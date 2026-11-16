import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { dateWindow, gscQuery, userSearchConsole } from "@/lib/server/gsc"

// GET /api/gsc?type=overview|keywords|pages&days=28&offset=0&limit=25&order=clicks|impressions
// offset = aantal dagen dat het venster terug in de tijd schuift (vorige periode: offset=days).
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json({ error: "Google-sessie verlopen" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type") || "keywords"
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "28"), 1), 480)
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0)
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "25"), 1), 1000)
  const order = searchParams.get("order") === "impressions" ? "impressions" : "clicks"
  const { startDate, endDate } = dateWindow(days, offset)
  const sc = userSearchConsole(session.accessToken)

  try {
    if (type === "overview") {
      const rows = await gscQuery(sc, { startDate, endDate, dimensions: ["date"], rowLimit: days })
      return NextResponse.json({ rows, startDate, endDate })
    }
    if (type === "keywords" || type === "pages") {
      const rows = await gscQuery(sc, {
        startDate, endDate,
        dimensions: [type === "keywords" ? "query" : "page"],
        rowLimit: limit,
        orderBy: [{ fieldName: order, sortOrder: "DESCENDING" }],
      })
      return NextResponse.json({ rows, startDate, endDate })
    }
    return NextResponse.json({ error: "Unknown type" }, { status: 400 })
  } catch (err: any) {
    const status = err?.code === 401 || /invalid authentication/i.test(err?.message || "") ? 401 : 500
    return NextResponse.json({ error: err.message }, { status })
  }
}
