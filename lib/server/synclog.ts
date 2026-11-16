import { getSupabase, supabaseConfigured } from "./guard"

// Elke synchronisatie (nachtelijk of handmatig) komt in seo_sync_log, zodat het
// datastatusscherm laat zien wat wanneer gelukt of mislukt is.
export async function logged<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    const out = await fn()
    await write(job, true, Date.now() - started, out as unknown, null)
    return out
  } catch (e: any) {
    await write(job, false, Date.now() - started, null, e?.message || String(e))
    throw e
  }
}

async function write(job: string, ok: boolean, duration: number, details: unknown, error: string | null) {
  if (!supabaseConfigured()) return
  try {
    // Een object met een "fout"-veld telt als mislukt (deelstappen vangen hun eigen fouten af)
    const failed = !!(details && typeof details === "object" && "fout" in (details as any))
    await getSupabase().from("seo_sync_log").insert({
      job, ok: ok && !failed, duration_ms: duration,
      details: details ?? null, error: error ?? (failed ? String((details as any).fout) : null),
    })
  } catch { /* loggen mag nooit de taak zelf breken */ }
}
