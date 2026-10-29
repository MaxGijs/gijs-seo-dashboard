import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { google } from "googleapis"

const SITE_URL = "https://groeninjestraat.nl/"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type") || "keywords"
  const days = parseInt(searchParams.get("days") || "28")

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(endDate.getDate() - days)
  const fmt = (d: Date) => d.toISOString().split("T")[0]

  const oauth2 = new google.auth.OAuth2()
  oauth2.setCredentials({ access_token: session.accessToken })

  const sc = google.searchconsole({ version: "v1", auth: oauth2 })

  try {
    if (type === "overview") {
      const res = await sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: {
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ["date"],
          rowLimit: days,
        },
      } as any)
      return NextResponse.json((res as any).data)
    }

    if (type === "keywords") {
      const res = await sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: {
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ["query"],
          rowLimit: 25,
          orderBy: [{ fieldName: "clicks", sortOrder: "DESCENDING" }],
        },
      } as any)
      return NextResponse.json((res as any).data)
    }

    if (type === "pages") {
      const res = await sc.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: {
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ["page"],
          rowLimit: 25,
          orderBy: [{ fieldName: "clicks", sortOrder: "DESCENDING" }],
        },
      } as any)
      return NextResponse.json((res as any).data)
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
