// Lessen berekenen en vastleggen (server). Draait na de nachtelijke experimentmeting
// en op verzoek vanaf de pagina "Wat hebben we geleerd?".

import { getSupabase } from "./guard"
import { computeLessons, featuresOf, type ContentFact, type DecisionFact, type ExperimentFact, type Lesson } from "@/lib/learning"

export async function recomputeLessons(by = "systeem") {
  const sb = getSupabase()
  const [{ data: exps }, { data: statuses }, { data: ideas }, { data: existing }] = await Promise.all([
    sb.from("seo_experiments").select("advice_key, description, outcome, query, page, baseline"),
    sb.from("seo_advice_status").select("advice_key, status, note, snapshot"),
    sb.from("content_ideas").select("id, title, service, origin, status, feedback, format, evals, text_check"),
    sb.from("seo_lessons").select("*"),
  ])
  const snap = new Map((statuses || []).map(s => [s.advice_key, s.snapshot]))
  // Alleen SEO-aanpassingen: conversie- en controletaken leren niets over routes in Google
  const experiments: ExperimentFact[] = (exps || []).filter(e => !['conversie', 'controle', 'geen'].includes(e.baseline?.successMetric)).map(e => {
    const s: any = snap.get(e.advice_key) || {}
    return {
      outcome: e.outcome,
      features: featuresOf({ kind: s.kind, intent: s.intent, position: s.metrics?.position ?? null, page: e.page || s.page || s.conversions?.page || null, action: `${e.description || ""} ${s.action || ""}` }),
      label: `${e.query ? `"${e.query}"` : e.page || e.advice_key}: ${e.description}`.slice(0, 160),
    }
  })
  const decisions: DecisionFact[] = (statuses || []).filter(s => s.snapshot?.kind).map(s => ({ kind: s.snapshot.kind, intent: s.snapshot.intent, status: s.status, note: s.note }))
  const content: ContentFact[] = (ideas || []).map(i => ({ id: i.id, title: i.title, service: i.service, origin: i.origin, status: i.status, tags: (i.feedback || []).map((f: any) => f.tag), format: i.format, clicks30: i.evals?.d30?.clicks ?? null, views30: i.evals?.d30?.ga4?.views ?? null, leads30: i.evals?.d30?.ga4 ? (i.evals.d30.ga4.measurement === "ok" ? i.evals.d30.ga4.requests ?? 0 : 0) + (i.evals.d30.ga4.contacts ?? 0) : null, engagement30: i.evals?.d30?.ga4?.engagementSec ?? null, text: i.text_check?.readable ? i.text_check.features ?? null : null }))

  const drafts = computeLessons({ experiments, decisions, content })
  const old = new Map<string, any>((existing || []).map(l => [l.key, l]))
  const now = new Date().toISOString()
  const log: { lesson_key: string; action: string; detail: string; by: string }[] = []
  const upserts: any[] = []
  for (const d of drafts) {
    const prev = old.get(d.key)
    const row = { key: d.key, source: d.source, title: d.title, conclusion: d.conclusion, evidence: d.evidence, confidence: d.confidence, effect: d.effect, updated_at: now }
    if (!prev) {
      upserts.push({ ...row, status: "actief", first_seen: now })
      log.push({ lesson_key: d.key, action: "nieuw", detail: `${d.title}. ${d.effect?.text || ""}`, by })
    } else {
      // Een teruggedraaide les blijft teruggedraaid, ook als het bewijs groeit
      const status = prev.status === "teruggedraaid" ? "teruggedraaid" : "actief"
      upserts.push({ ...row, status })
      if (prev.status === "vervallen") log.push({ lesson_key: d.key, action: "weer-geldig", detail: d.conclusion, by })
      else if (prev.effect?.factor !== d.effect?.factor || prev.confidence !== d.confidence) log.push({ lesson_key: d.key, action: "bijgewerkt", detail: `${d.conclusion} ${d.effect?.text || ""}`, by })
    }
  }
  const keep = new Set(drafts.map(d => d.key))
  const expired = (existing || []).filter(l => !keep.has(l.key) && l.status === "actief")
  for (const l of expired) log.push({ lesson_key: l.key, action: "vervallen", detail: "Het bewijs is niet meer sterk genoeg (nieuwe metingen wijzen een andere kant op).", by })
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
    sb.from("seo_experiments").select("id", { count: "exact", head: true }).not("outcome", "is", null),
    sb.from("seo_advice_status").select("advice_key", { count: "exact", head: true }).in("status", ["afgewezen", "onvoldoende_bewijs"]),
    sb.from("content_ideas").select("id", { count: "exact", head: true }).eq("status", "gepubliceerd"),
  ])
  return { lessons: (lessons || []) as Lesson[], log: log || [], stats: { lopend: open || 0, afgerond: done || 0, afgewezen: rejected || 0, gepubliceerd: published || 0 } }
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
