// Offline campagnes (brieven, flyers, advertenties). Ze verklaren pieken in bezoek en aanvragen
// die niet uit Google komen, en worden daarom meegewogen bij metingen en in het dashboard.

export type CampaignKind = "brief" | "flyer" | "advertentie" | "evenement" | "email" | "overig"
export const CAMPAIGN_KINDS: { id: CampaignKind; label: string }[] = [
  { id: "brief", label: "Brief" }, { id: "flyer", label: "Flyer / huis-aan-huis" }, { id: "advertentie", label: "Advertentie (krant, radio)" },
  { id: "evenement", label: "Evenement / informatieavond" }, { id: "email", label: "E-mail / nieuwsbrief" }, { id: "overig", label: "Overig" },
]
export const kindLabel = (k: string) => CAMPAIGN_KINDS.find(x => x.id === k)?.label || k

export interface Campaign {
  id: string; name: string; kind: CampaignKind; start_date: string; end_date: string | null
  regions: string[]; amount: number | null; landing_page: string | null; note: string | null
  created_by: string | null; created_at: string
}

// Een brief of flyer heeft nog weken na het versturen effect; zonder einddatum rekenen we 21 dagen.
export const AFTER_EFFECT_DAYS = 21
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10)
export function effectEnd(c: Pick<Campaign, "start_date" | "end_date">) {
  return c.end_date && c.end_date > c.start_date ? c.end_date : addDays(c.start_date, AFTER_EFFECT_DAYS)
}
export function overlaps(c: Pick<Campaign, "start_date" | "end_date">, start: string, end: string) {
  return c.start_date <= end && effectEnd(c) >= start
}
export function describe(c: Campaign) {
  const what = `${kindLabel(c.kind).toLowerCase()}${c.amount ? ` (${c.amount.toLocaleString("nl-NL")} stuks)` : ""}`
  return `Offline campagne "${c.name}": ${what}${c.regions.length ? ` in ${c.regions.join(", ")}` : ""}, vanaf ${c.start_date}${c.end_date ? ` t/m ${c.end_date}` : ""}`
}
