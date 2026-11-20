// Lessen berekenen en vastleggen (server). Draait na de nachtelijke experimentmeting
// en op verzoek vanaf de pagina "Wat hebben we geleerd?".

import { getSupabase } from "./guard"
import { explainedRejection, feedbackLessons, learnFromFeedback, noteOf, REASONS } from "@/lib/content/feedback"
import { familyOutcome, VALIDATION_METRICS, type Outcome } from "@/lib/experiment"
import { computeLessons, featuresOf, type ContentFact, type DecisionFact, type ExperimentFact, type Lesson } from "@/lib/learning"

export async function recomputeLessons(by = "systeem") {
  const sb = getSupabase()
  const [{ data: exps }, { data: statuses }, { data: ideas }, { data: existing }] = await Promise.all([
    sb.from("seo_experiments").select("id, advice_key, description, outcome, query, page, baseline, kind, family_id, family_title"),
    // Beslissingen over siteadvies (site:…) zijn geen SEO-adviezen; die tellen niet mee in de lessen
    sb.from("seo_advice_status").select("advice_key, status, note, snapshot").not("advice_key", "like", "site:%"),
    sb.from("content_ideas").select("id, title, service, origin, status, feedback, format, evals, text_check, advice, summary, why_now, impact, decision_note"),
    sb.from("seo_lessons").select("*"),
  ])
  const snap = new Map((statuses || []).map(s => [s.advice_key, s.snapshot]))
  // Alleen echte SEO-experimenten: geen validaties (techniek, indexering, controles), geen metingen
  // zonder oordeel, geen conversietaken. Een experimentfamilie (één aanpassing op meerdere pagina's)
  // telt als één experiment, met de uitkomst die het vaakst voorkomt onder de meetpunten.
  const real = (exps || []).filter(e => (e.kind || "experiment") === "experiment" && !VALIDATION_METRICS.has(e.baseline?.successMetric) && !["conversie", "geen"].includes(e.baseline?.successMetric))
  const byFamily = new Map<string, typeof real>()
  for (const e of real) byFamily.set(e.family_id || e.id, [...(byFamily.get(e.family_id || e.id) || []), e])
  const decisive = (o: string | null): ExperimentFact["outcome"] => (o === "succesvol" || o === "niet_succesvol" || o === "onduidelijk" ? o : null)
  const experiments: ExperimentFact[] = [...byFamily.values()].map(list => {
    const e = list[0]
    const s: any = snap.get(e.advice_key) || {}
    const outcome = list.length > 1 ? decisive(familyOutcome(list.map(x => x.outcome as Outcome | null))) : decisive(e.outcome)
    return {
      outcome,
      features: featuresOf({ kind: s.kind, intent: s.intent, position: s.metrics?.position ?? null, page: e.page || s.page || s.conversions?.page || null, action: `${e.description || ""} ${s.action || ""}` }),
      label: (list.length > 1 ? `${e.family_title || e.description} (${list.length} meetpunten, telt als één experiment)` : `${e.query ? `"${e.query}"` : e.page || e.advice_key}: ${e.description}`).slice(0, 160),
    }
  })
  const decisions: DecisionFact[] = (statuses || []).filter(s => s.snapshot?.kind).map(s => ({ kind: s.snapshot.kind, intent: s.snapshot.intent, status: s.status, note: s.note }))
  // Bijgewerkte bestaande pagina's met een afgeronde voor/na-meting tellen mee als meting van de route "inhoud"
  for (const i of ideas || []) {
    const u = i.advice === "bijwerken" ? i.evals?.update : null
    if (!u?.outcome || u.evidence !== "telt mee") continue
    experiments.push({
      outcome: u.outcome,
      features: { ...featuresOf({ position: u.baseline?.queries?.position ?? null, page: u.page, action: "inhoud uitbreiden" }), action: "inhoud" },
      label: `${u.page}: pagina bijgewerkt (contentkans "${i.title}")`.slice(0, 160),
    })
  }
  const content: ContentFact[] = (ideas || []).map(i => ({ id: i.id, title: i.title, service: i.service, origin: i.origin, status: i.status, advice: i.advice, alreadyOnSite: i.status === "afgewezen" && REASONS.dubbel.pattern.test(noteOf(i)), explained: i.status === "afgewezen" && explainedRejection(i as any), tags: (i.feedback || []).map((f: any) => f.tag), format: i.format, clicks30: i.evals?.d30?.clicks ?? null, views30: i.evals?.d30?.ga4?.views ?? null, leads30: i.evals?.d30?.ga4 ? (i.evals.d30.ga4.measurement === "ok" ? i.evals.d30.ga4.requests ?? 0 : 0) + (i.evals.d30.ga4.contacts ?? 0) : null, engagement30: i.evals?.d30?.ga4?.engagementSec ?? null, text: i.text_check?.readable ? i.text_check.features ?? null : null }))

  // Plus: lessen uit wat medewerkers zelf schrijven bij een afwijzing
  const drafts = [...computeLessons({ experiments, decisions, content }), ...feedbackLessons(learnFromFeedback((ideas || []) as any[]))]
  const old = new Map<string, any>((existing || []).map(l => [l.key, l]))
  const now = new Date().toISOString()
  const log: { lesson_key: string; action: string; detail: string; by: string }[] = []
  const upserts: any[] = []
  for (const d of drafts) {
    const prev = old.get(d.key)
    // Bevestigd door een medewerker: een voorstel wordt dan wel toegepast
    const effect = d.effect && d.effect.pending && prev?.confirmed_at ? { ...d.effect, pending: false } : d.effect
    const row = { key: d.key, source: d.source, title: d.title, conclusion: d.conclusion, evidence: d.evidence, confidence: d.confidence, effect, updated_at: now }
    if (!prev) {
      upserts.push({ ...row, status: "actief", first_seen: now })
      log.push({ lesson_key: d.key, action: "nieuw", detail: `${d.title}. ${d.effect?.text || ""}`, by })
    } else {
      // Een teruggedraaide les blijft teruggedraaid, ook als het bewijs groeit
      const status = prev.status === "teruggedraaid" ? "teruggedraaid" : "actief"
      // first_seen altijd meesturen: bij een gemengde upsert (nieuw + bestaand) vult de database
      // ontbrekende velden anders met null, en first_seen mag niet leeg zijn
      upserts.push({ ...row, status, first_seen: prev.first_seen || now })
      if (prev.status === "vervallen") log.push({ lesson_key: d.key, action: "weer-geldig", detail: d.conclusion, by })
      else if (prev.effect?.factor !== d.effect?.factor || prev.confidence !== d.confidence || !!prev.effect?.pending !== !!effect?.pending) log.push({ lesson_key: d.key, action: "bijgewerkt", detail: `${d.conclusion} ${d.effect?.text || ""}`, by })
    }
  }
  const keep = new Set(drafts.map(d => d.key))
  const expired = (existing || []).filter(l => !keep.has(l.key) && l.status === "actief")
  for (const l of expired) log.push({ lesson_key: l.key, action: "vervallen", detail: "Wordt niet meer afgeleid uit de huidige metingen, afwijzingen en regels; heeft geen invloed meer.", by })
  if (upserts.length) { const { error } = await sb.from("seo_lessons").upsert(upserts); if (error) throw new Error(error.message) }
  if (expired.length) await sb.from("seo_lessons").update({ status: "vervallen", updated_at: now }).in("key", expired.map(l => l.key))
  if (log.length) await sb.from("seo_lesson_log").insert(log)
  return { lessen: drafts.length, nieuw: log.filter(l => l.action === "nieuw").length, bijgewerkt: log.filter(l => l.action === "bijgewerkt").length, vervallen: expired.length, metingen: experiments.filter(e => e.outcome).length }
}

export async function readLessons() {
  const sb = getSupabase()
  const [{ data: lessons }, { data: log }, { count: open }, { count: done }, { count: rejected }, { count: published }] = await Promise.all([
    sb.from("seo_lessons").select("*").order("updated_at", { ascending: false }),
    sb.from("seo_lesson_log").select("*").order("at", { ascending: false }).limit(60),
    sb.from("seo_experiments").select("id", { count: "exact", head: true }).is("outcome", null),
    // Afgeronde echte experimenten: met een oordeel (geen validaties of metingen zonder oordeel)
    sb.from("seo_experiments").select("id", { count: "exact", head: true }).eq("kind", "experiment").in("outcome", ["succesvol", "niet_succesvol", "onduidelijk"]),
    sb.from("seo_advice_status").select("advice_key", { count: "exact", head: true }).in("status", ["afgewezen", "onvoldoende_bewijs"]).not("advice_key", "like", "site:%"),
    sb.from("content_ideas").select("id", { count: "exact", head: true }).eq("status", "gepubliceerd"),
  ])
  const list = (lessons || []) as Lesson[]
  await attachRejections(sb, list).catch(() => { /* uitleg is extra; de lessen zelf blijven zichtbaar */ })
  return { lessons: list, log: log || [], stats: { lopend: open || 0, afgerond: done || 0, afgewezen: rejected || 0, gepubliceerd: published || 0 } }
}

// Waarom is iets afgewezen? Live uit de beslissingen, zodat de uitleg altijd klopt (ook zonder herberekening)
export async function attachRejections(sb: ReturnType<typeof getSupabase>, lessons: Lesson[]) {
  const needContent = lessons.some(l => (l.key.startsWith("content|") && l.effect?.type === "content-afwijzing") || l.key.startsWith("feedback|"))
  const needSeo = lessons.some(l => l.key.startsWith("afwijzing|"))
  const [{ data: ideas }, { data: statuses }] = await Promise.all([
    needContent ? sb.from("content_ideas").select("id, title, service, origin, status, feedback, decision_note, updated_at").eq("status", "afgewezen") : Promise.resolve({ data: [] as any[] }),
    needSeo ? sb.from("seo_advice_status").select("advice_key, advice_title, status, note, snapshot, updated_at").in("status", ["afgewezen", "onvoldoende_bewijs"]) : Promise.resolve({ data: [] as any[] }),
  ])
  const toRejection = (i: any) => {
    const fb: any[] = (i.feedback || []).filter((f: any) => f && f.tag)
    const last = fb[fb.length - 1]
    return {
      title: i.title, href: `/content/${i.id}?van=geleerd`,
      reasons: [...new Set(fb.map(f => f.tag).filter((t: string) => t !== "opmerking"))] as string[],
      note: fb.map(f => f.note).filter(Boolean).pop() || i.decision_note || null,
      by: last?.by || null, at: last?.at || i.updated_at || null,
    }
  }
  for (const l of lessons) {
    if (l.key.startsWith("feedback|")) {
      const ids = new Set((l.evidence.items || []).map(x => x.id))
      l.rejections = (ideas || []).filter(i => ids.has(i.id)).map(toRejection)
    } else if (l.key.startsWith("content|") && l.effect?.type === "content-afwijzing") {
      const [, service, origin] = l.key.split("|")
      l.rejections = (ideas || []).filter(i => (i.service || "-") === service && i.origin === origin)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map(i => {
          const fb: any[] = (i.feedback || []).filter((f: any) => f && f.tag)
          const last = fb[fb.length - 1]
          return {
            title: i.title, href: `/content/${i.id}?van=geleerd`,
            reasons: [...new Set(fb.map(f => f.tag).filter((t: string) => t !== "opmerking"))],
            note: fb.map(f => f.note).filter(Boolean).pop() || i.decision_note || null,
            by: last?.by || null, at: last?.at || i.updated_at || null,
          }
        })
    } else if (l.key.startsWith("afwijzing|")) {
      const [, kind, intent] = l.key.split("|")
      l.rejections = (statuses || []).filter(r => r.snapshot?.kind === kind && (r.snapshot?.intent || "-") === intent && !(r.note || "").startsWith("Al opgelost"))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map(r => ({
          title: r.snapshot?.query ? `"${r.snapshot.query}"` : r.snapshot?.headline || r.advice_title,
          taskKey: r.advice_key,
          reasons: r.status === "onvoldoende_bewijs" ? ["onvoldoende bewijs"] : [],
          note: r.note || null, by: null, at: r.updated_at || null,
        }))
    }
  }
}

// Een voorstel (bijvoorbeeld uit één afwijzing) bevestigen: dan wordt het wel toegepast
export async function confirmLesson(key: string, by: string) {
  const sb = getSupabase()
  const { data: l } = await sb.from("seo_lessons").select("key, title, effect").eq("key", key).maybeSingle()
  if (!l) throw new Error("Les niet gevonden")
  const now = new Date().toISOString()
  const { error } = await sb.from("seo_lessons").update({ confirmed_at: now, confirmed_by: by, effect: l.effect ? { ...l.effect, pending: false } : l.effect, updated_at: now }).eq("key", key)
  if (error) throw new Error(error.message)
  await sb.from("seo_lesson_log").insert({ lesson_key: key, action: "bevestigd", detail: l.title, by })
}

export async function setLessonStatus(key: string, to: "teruggedraaid" | "actief", by: string) {
  const sb = getSupabase()
  const { data: l } = await sb.from("seo_lessons").select("key, title, status").eq("key", key).maybeSingle()
  if (!l) throw new Error("Les niet gevonden")
  const now = new Date().toISOString()
  const { error } = await sb.from("seo_lessons").update(to === "teruggedraaid" ? { status: to, reverted_at: now, reverted_by: by, updated_at: now } : { status: to, reverted_at: null, reverted_by: null, updated_at: now }).eq("key", key)
  if (error) throw new Error(error.message)
  await sb.from("seo_lesson_log").insert({ lesson_key: key, action: to === "teruggedraaid" ? "teruggedraaid" : "hersteld", detail: l.title, by })
}
