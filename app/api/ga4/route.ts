import { NextResponse } from "next/server"
import { BetaAnalyticsDataClient } from "@google-analytics/data"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get("days") || "28")

  const propertyId = process.env.GA4_PROPERTY_ID
  if (!propertyId) {
    return NextResponse.json({ error: "GA4_PROPERTY_ID not set" }, { status: 500 })
  }

  let credentials
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  } catch {
    return NextResponse.json({ error: "Invalid service account JSON" }, { status: 500 })
  }

  const client = new BetaAnalyticsDataClient({ credentials })

  try {
    const [response] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      metrics: [
        { name: "sessions" },
        { name: "conversions" },
        { name: "totalRevenue" },
      ],
      dimensions: [{ name: "date" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    })

    return NextResponse.json(response)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
