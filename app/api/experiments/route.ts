import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"
import { updateTry } from "@/lib/content/update"
import type { RouteTry } from "@/lib/routes"
import { prepareStart } from "@/lib/server/experimentStart"
import { baselineAt, normPath } from "@/lib/server/scopedMeasure"
import { addDaysIso } from "@/lib/measureLogic"
import { CHANGE_TYPES, changeTypeFields, changeTypesOf, type ChangeType } from "@/lib/experiment"

// GET /api/experiments — gelogde experimenten (optioneel gefilterd op advice_key)
export async function GET(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] })

  try {
    const { searchParams } = new URL(request.url)
    const adviceKey = searchParams.get("advice_key")
    let query = getSupabase()
      .from("seo_experiments")
      .select("*")
      .order("changed_at", { ascending: false })
      .order("created_at", { ascending: false })
    if (adviceKey) query = query.eq("advice_key", adviceKey)

    const { data, error } = await query
    if (error) throw error
    // Bijgewerkte pagina's uit Content tellen mee in het route-geheugen per pagina (geen eigen experimentregel)
    let contentTries: RouteTry[] = []
    if (!adviceKey) {
      const { data: ideas } = await getSupabase().from("content_ideas").select("id, title, advice, status, published_at, evals").eq("advice", "bijwerken").eq("status", "gepubliceerd")
      contentTries = (ideas || []).map(i => updateTry(i as any)).filter((t): t is RouteTry => !!t)
    }
    return NextResponse.json({ rows: data || [], contentTries })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, rows: [] }, { status: 500 })
  }
}

// POST /api/experiments — nieuw experiment loggen met nulmeting (baseline)
// Body: { advice_key, description, baseline: {...}, query?, page? }
// Het advies moet al een statusregel hebben (foreign key); de client slaat die eerst op.
export async function POST(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })

  try {
    const body = await request.json()
    const { advice_key, description, baseline, query, page, hypothesis, target_pages, target_queries, predicted } = body
    const groupTitle = typeof body.group_title === "string" && body.group_title.trim() ? body.group_title.trim().slice(0, 140) : null
    if (!advice_key || !description?.trim() || !baseline) {
      return NextResponse.json({ error: "advice_key, description en baseline zijn verplicht" }, { status: 400 })
    }

    const today = new Date().toISOString().split("T")[0]
    // Geschiktheidscontrole, soort en familie (bij een fout: gewoon als experiment vastleggen)
    const start = await prepareStart({ advice_key, description: description.trim(), baseline, query: query ?? null, page: page ?? null }, today).catch(() => null)
    // Eigen groepsnaam (samengevoegde kaarten) gaat voor de automatisch bedachte familienaam
    if (start && groupTitle) { start.family_id = start.family_id || randomUUID(); start.family_title = groupTitle; if (start.familyRoot) start.familyRoot.family_title = groupTitle }
    if (start?.familyRoot) await getSupabase().from("seo_experiments").update({ family_id: start.family_id, family_title: start.familyRoot.family_title }).or(`id.eq.${start.familyRoot.id},family_id.eq.${start.family_id}`)
    else if (start?.family_id && groupTitle) await getSupabase().from("seo_experiments").update({ family_title: groupTitle }).eq("family_id", start.family_id)
    const { data, error } = await getSupabase()
      .from("seo_experiments")
      .insert({
        ...(start ? { kind: start.kind, suitability: start.suitability, family_id: start.family_id, family_title: start.family_title } : groupTitle ? { family_id: randomUUID(), family_title: groupTitle } : {}),
        advice_key,
        description: description.trim(),
        baseline,
        query: query ?? null,
        page: page ?? null,
        hypothesis: typeof hypothesis === "string" ? hypothesis.slice(0, 1000) : null,
        target_pages: Array.isArray(target_pages) ? target_pages.slice(0, 500).map(String) : null,
        target_queries: Array.isArray(target_queries) ? target_queries.slice(0, 50).map(String) : null,
        changed_pages: Array.isArray(body.changed_pages) ? body.changed_pages.slice(0, 100).map(String) : null,
        predicted: predicted && typeof predicted === "object" ? predicted : null,
        changed_at: today,
      })
      .select()
      .single()
    if (error) throw error

    return NextResponse.json({ ok: true, experiment: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/experiments — naam van een familie (groep) wijzigen
// Body: { family_id, family_title } of { advice_keys: [...], family_title } (vanuit een samengevoegde kaart).
// Bij advice_keys komen metingen van die kaarten zonder familie in dezelfde familie: het was één gezamenlijke wijziging.
export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  try {
    const body = await request.json()
    const title = typeof body.family_title === "string" ? body.family_title.trim().slice(0, 140) : ""
    if (!title) return NextResponse.json({ error: "family_title is verplicht" }, { status: 400 })
    const sb = getSupabase()
    if (typeof body.family_id === "string" && body.family_id) {
      const { data, error } = await sb.from("seo_experiments").update({ family_title: title }).eq("family_id", body.family_id).select()
      if (error) throw error
      if (!data?.length) return NextResponse.json({ error: "Familie niet gevonden" }, { status: 404 })
      return NextResponse.json({ ok: true, rows: data })
    }
    const keys = Array.isArray(body.advice_keys) ? body.advice_keys.filter((k: unknown) => typeof k === "string").slice(0, 100) : []
    if (!keys.length) return NextResponse.json({ error: "family_id of advice_keys is verplicht" }, { status: 400 })
    const { data: rows, error } = await sb.from("seo_experiments").select("id, family_id").in("advice_key", keys)
    if (error) throw error
    if (!rows?.length) return NextResponse.json({ ok: true, rows: [] })
    const families = [...new Set(rows.map(r => r.family_id).filter(Boolean))] as string[]
    const target = families[0] || randomUUID()
    const loose = rows.filter(r => !r.family_id).map(r => r.id)
    if (loose.length) { const { error: e1 } = await sb.from("seo_experiments").update({ family_id: target, family_title: title }).in("id", loose); if (e1) throw e1 }
    if (families.length) { const { error: e2 } = await sb.from("seo_experiments").update({ family_title: title }).in("family_id", families); if (e2) throw e2 }
    const { data } = await sb.from("seo_experiments").select("*").in("family_id", [...new Set([target, ...families])])
    return NextResponse.json({ ok: true, rows: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/experiments?key=… — een per ongeluk gestarte meting terugdraaien (taak een stap terug).
// Kan alleen zolang er nog geen meetmoment is geweest.
export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const key = new URL(request.url).searchParams.get("key")
  if (!key) return NextResponse.json({ error: "key ontbreekt" }, { status: 400 })
  const sb = getSupabase()
  const { data: rows } = await sb.from("seo_experiments").select("id, result_14d, outcome").eq("advice_key", key).is("outcome", null)
  if (!rows?.length) return NextResponse.json({ ok: true, removed: 0 })
  if (rows.some(r => r.result_14d)) return NextResponse.json({ error: "Er is al gemeten (14 dagen). Een stap terug zou die meting weggooien; sleep de taak naar Afgerond als je wilt stoppen." }, { status: 409 })
  const { error } = await sb.from("seo_experiments").delete().in("id", rows.map(r => r.id))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, removed: rows.length })
}

// PUT /api/experiments — opzet corrigeren (verkeerd ingevuld), alleen vóór het eerste meetpunt.
// Body: { id, description?, changed_at?, changed_pages?, change_types? (of change_type) }
// De opzet is onveranderlijk zodra hij is vastgelegd (databaseregel). Corrigeren vervangt daarom de
// meting door een nieuwe regel met de juiste opzet, net als "stap terug" en opnieuw starten. Bij een
// andere live-datum wordt de nulmeting opnieuw opgehaald over de 28 dagen vóór die datum. Wat er stond,
// blijft bewaard in baseline.correction.
export async function PUT(request: Request) {
  const guard = await requireUser()
  if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ error: "Opslag niet geconfigureerd" }, { status: 500 })
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
  try {
    const body = await request.json()
    const sb = getSupabase()
    const { data: old, error: e0 } = await sb.from("seo_experiments").select("*").eq("id", String(body.id || "")).maybeSingle()
    if (e0) throw e0
    if (!old) return bad("Meting niet gevonden", 404)
    if (old.outcome || old.result_7d || old.result_14d || old.result_28d || old.result_56d || old.result_84d) {
      return bad("Er is al een meetpunt geweest. Corrigeren kan alleen vóór het eerste meetpunt, anders klopt de vergelijking niet meer. Rond deze meting af en start een nieuwe.", 409)
    }
    const today = new Date().toISOString().slice(0, 10)
    const date = body.changed_at === undefined ? old.changed_at : String(body.changed_at)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return bad("Ongeldige datum")
    if (date > today) return bad("De live-datum kan niet in de toekomst liggen")
    if (date < addDaysIso(today, -90)) return bad("De live-datum ligt meer dan 90 dagen terug")
    const description = body.description === undefined ? old.description : String(body.description).trim().slice(0, 4000)
    if (!description) return bad("Omschrijving is verplicht")
    const pages = body.changed_pages === undefined ? old.changed_pages
      : (Array.isArray(body.changed_pages) ? body.changed_pages : []).map((p: unknown) => normPath(String(p))).filter((p: string) => p.startsWith("/")).slice(0, 100)
    const asked = Array.isArray(body.change_types) ? body.change_types.map(String) : body.change_type !== undefined ? [String(body.change_type)] : null
    if (asked && (!asked.length || asked.some((t: string) => !(t in CHANGE_TYPES)))) return bad("Onbekend soort wijziging")
    const oldTypes = changeTypesOf(old.baseline)
    const types = asked ? [...new Set(asked)] as ChangeType[] : oldTypes
    const dateChanged = date !== old.changed_at
    if (!dateChanged && description === old.description && JSON.stringify(pages || []) === JSON.stringify(old.changed_pages || []) && types.join() === oldTypes.join()) {
      return NextResponse.json({ ok: true, experiment: old, unchanged: true })
    }

    const baseline = { ...(old.baseline || {}), ...(types.length ? changeTypeFields(types) : {}) }
    if (dateChanged) {
      // Nulmeting over de 28 dagen vóór de juiste datum; lukt dat niet, dan niets wijzigen (anders meet hij verkeerd)
      const fresh = await baselineAt({ ...old, changed_pages: pages }, date)
      if (!fresh) return bad("De nulmeting voor de nieuwe datum kon niet uit Search Console worden opgehaald. Er is niets gewijzigd; probeer het later opnieuw.", 502)
      Object.assign(baseline, fresh)
    }
    const who = guard.session.user?.name || guard.session.user?.email || "medewerker"
    baseline.correction = [...(Array.isArray(old.baseline?.correction) ? old.baseline.correction : []),
      { at: new Date().toISOString(), by: who, from: { changed_at: old.changed_at, description: old.description, changed_pages: old.changed_pages, changeType: old.baseline?.changeType ?? null, changeTypes: oldTypes, ...(dateChanged ? { baseline: old.baseline } : {}) } }]

    // Zelfde id houden (koppelingen, open detail): oude regel weg, gecorrigeerde regel erin. Lukt het
    // invoegen niet, dan komt de oude regel ongewijzigd terug.
    const { error: e1 } = await sb.from("seo_experiments").delete().eq("id", old.id)
    if (e1) throw e1
    const { data: created, error: e2 } = await sb.from("seo_experiments").insert({ ...old, description, changed_at: date, changed_pages: pages, baseline }).select().single()
    if (e2) { await sb.from("seo_experiments").insert(old); throw e2 }
    return NextResponse.json({ ok: true, experiment: created, replaced: old.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
