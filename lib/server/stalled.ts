// Bewaking van werk dat blijft liggen (rustig: alleen wat echt stilstaat).

import { getSupabase } from "./guard"

const DAY = 86400000

export function workdaysSince(fromIso: string, now = new Date()) {
  let d = new Date(fromIso), n = 0
  while (d < now) {
    d = new Date(d.getTime() + DAY)
    if (d > now) break
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return n
}

export interface Stalled { id: string; text: string; href: string; kind: "seo" | "content" }

// Rustig: alleen wat écht blijft liggen. Concepten > 3 werkdagen in controle, geplande taken > 14 dagen stil.
export async function readStalled(): Promise<Stalled[]> {
  const sb = getSupabase()
  const [{ data: ideas }, { data: tasks }] = await Promise.all([
    sb.from("content_ideas").select("id, title, status, updated_at").in("status", ["review", "concept", "briefing", "goedgekeurd"]),
    // Een ingepland siteadvies is geen taak die blijft liggen (de taken die het maakte wel)
    sb.from("seo_advice_status").select("advice_key, advice_title, status, updated_at").in("status", ["goedgekeurd", "in_uitvoering"]).not("advice_key", "like", "site:%"),
  ])
  const out: Stalled[] = []
  const review = (ideas || []).filter(i => i.status === "review" && workdaysSince(i.updated_at) > 3)
  if (review.length) out.push({ id: "review", kind: "content", href: "/taken", text: `${review.length === 1 ? "Eén concept wacht" : `${review.length} concepten wachten`} langer dan drie werkdagen op controle${review.length === 1 ? `: ${review[0].title}` : ""}.` })
  const writing = (ideas || []).filter(i => (i.status === "briefing" || i.status === "concept") && workdaysSince(i.updated_at) > 5)
  if (writing.length) out.push({ id: "schrijven", kind: "content", href: "/taken", text: `${writing.length === 1 ? "Eén artikel ligt" : `${writing.length} artikelen liggen`} al meer dan een week stil in briefing of concept.` })
  const approved = (ideas || []).filter(i => i.status === "goedgekeurd" && workdaysSince(i.updated_at) > 3)
  if (approved.length) out.push({ id: "publiceren", kind: "content", href: "/taken", text: `${approved.length === 1 ? "Eén goedgekeurd artikel is" : `${approved.length} goedgekeurde artikelen zijn`} nog niet gepubliceerd.` })
  const old = (tasks || []).filter(t => Date.now() - new Date(t.updated_at).getTime() > 14 * DAY)
  if (old.length) out.push({ id: "taken", kind: "seo", href: "/taken", text: `${old.length === 1 ? "Eén geplande SEO-taak ligt" : `${old.length} geplande SEO-taken liggen`} al meer dan twee weken stil${old.length === 1 ? `: ${old[0].advice_title}` : ""}.` })
  return out
}

