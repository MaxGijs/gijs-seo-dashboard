import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/guard"
import { readChecks } from "@/lib/server/checks"

export const maxDuration = 30

// GET /api/checks — wat niet (goed) gemeten wordt of niet werkt; wordt een taak in Vandaag en Mijn taken
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  try { return NextResponse.json({ rows: await readChecks(new URL(request.url).searchParams.get("fresh") === "1") }) }
  catch (e: any) { return NextResponse.json({ rows: [], error: e.message }) }
}
