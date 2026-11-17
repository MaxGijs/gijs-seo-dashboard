import { NextResponse } from "next/server"
import { buildReport } from "@/lib/server/report"
import { logged } from "@/lib/server/synclog"

export const maxDuration = 120

// Elke vrijdagmiddag: het weekrapport vastleggen (ook als er weinig veranderde)
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try { return NextResponse.json({ ok: true, ...(await logged("vrijdagrapport", () => buildReport())) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }) }
}
