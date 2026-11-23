import { NextResponse } from "next/server"
import { evaluatePublished, scanContent } from "@/lib/server/content"
import { logged } from "@/lib/server/synclog"

export const maxDuration = 180

// Nachtelijk: nieuwe contentkansen zoeken en gepubliceerde content meten (7, 14, 28; 56 bij SEO-doel of te weinig data)
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const out: Record<string, unknown> = {}
  try { out.scan = await logged("actualiteiten", () => scanContent()) } catch (e: any) { out.scan = { fout: e.message } }
  try { out.metingen = await logged("content-metingen", () => evaluatePublished()) } catch (e: any) { out.metingen = { fout: e.message } }
  return NextResponse.json({ ok: true, ...out })
}
