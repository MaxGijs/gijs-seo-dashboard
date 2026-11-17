import { NextResponse } from "next/server"
import { logged } from "@/lib/server/synclog"
import { runAlerts } from "@/lib/server/alerts"
import { refreshCwv } from "@/lib/server/cwv"
import { cwvPages } from "@/lib/server/cwv-pages"

export const maxDuration = 300

// Elke ochtend: laadsnelheid van een paar belangrijke pagina's meten en meldingen bepalen
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await logged("meldingen", async () => {
      const snelheid = await refreshCwv(await cwvPages(), 4).catch(e => [{ path: "*", ok: false, error: e?.message }])
      const meldingen = await runAlerts()
      return { meldingen, snelheid }
    })) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }) }
}
