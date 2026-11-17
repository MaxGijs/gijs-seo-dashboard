import { getSupabase, supabaseConfigured } from "./guard"
import { overlaps, type Campaign } from "@/lib/campaigns"

export async function readCampaigns(range?: { start: string; end: string }): Promise<Campaign[]> {
  if (!supabaseConfigured()) return []
  const { data, error } = await getSupabase().from("seo_campaigns").select("*").order("start_date", { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  const rows = (data || []) as Campaign[]
  return range ? rows.filter(c => overlaps(c, range.start, range.end)) : rows
}
