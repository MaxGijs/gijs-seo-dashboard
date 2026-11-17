import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/guard"
import { readAlerts } from "@/lib/server/alerts"
import { readCwv } from "@/lib/server/cwv"

// GET: open (en recent opgeloste) meldingen plus de laatste laadsnelheidsmetingen
export async function GET() {
  const guard = await requireUser(); if (guard.error) return guard.error
  try {
    const [alerts, cwv] = await Promise.all([readAlerts(), readCwv()])
    return NextResponse.json({ alerts, cwv, keyConfigured: !!process.env.PAGESPEED_API_KEY })
  } catch (e: any) { return NextResponse.json({ error: e.message, alerts: [], cwv: [] }, { status: 500 }) }
}
